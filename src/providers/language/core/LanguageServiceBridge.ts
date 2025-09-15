/**
 * CircuitPython Language Service JSON-RPC Bridge
 * 
 * Handles JSON-RPC communication between VS Code extension and webviews
 * for CircuitPython language services. Designed for future extraction.
 */

import * as vscode from 'vscode';
import { 
    createMessageConnection, 
    MessageConnection, 
    AbstractMessageReader, 
    AbstractMessageWriter, 
    DataCallback, 
    Message 
} from 'vscode-jsonrpc/node';

import { 
    CircuitPythonLanguageService, 
    ICircuitPythonLanguageService 
} from './CircuitPythonLanguageService';
import { 
    Position, 
    CompletionItem, 
    HoverInfo, 
    SignatureHelp, 
    Diagnostic,
    CircuitPythonBoard,
    CircuitPythonLanguageServiceConfig
} from '../types';
import { TerminalHistoryManager, HistoryEntry } from '../../helpers/historyManager';
import { CommandProcessor, CommandResult } from '../../helpers/commandProcessor';

export interface LanguageServiceBridgeConfig {
    enableDiagnostics?: boolean;
    enableCompletions?: boolean;
    enableHover?: boolean;
    enableSignatureHelp?: boolean;
    defaultBoard?: string;
    // REPL-specific configuration
    enableREPL?: boolean;
    enableCommandProcessor?: boolean;
    maxREPLHistory?: number;
}

// REPL Session interfaces
export interface REPLSession {
    id: string;
    webviewId: string;
    created: number;
    lastActivity: number;
    isActive: boolean;
}

export interface REPLExecutionContext {
    sessionId: string;
    command: string;
    timestamp: number;
    source: 'repl' | 'editor';
}

export interface REPLExecutionResult extends CommandResult {
    sessionId: string;
    executionTime: number;
    completions?: CompletionItem[];
}

export class LanguageServiceBridge {
    private languageService: ICircuitPythonLanguageService;
    private connections: Map<string, MessageConnection> = new Map();
    private disposables: vscode.Disposable[] = [];
    
    // REPL-specific components
    private historyManager?: TerminalHistoryManager;
    private commandProcessor?: CommandProcessor;
    private replSessions: Map<string, REPLSession> = new Map();
    private config: LanguageServiceBridgeConfig;
    
    // Event emitters for REPL communication
    private _onREPLOutput = new vscode.EventEmitter<{sessionId: string; data: string}>();
    private _onREPLExecutionResult = new vscode.EventEmitter<REPLExecutionResult>();
    private _onREPLConnectionStatus = new vscode.EventEmitter<{sessionId: string; connected: boolean}>();
    
    public readonly onREPLOutput = this._onREPLOutput.event;
    public readonly onREPLExecutionResult = this._onREPLExecutionResult.event;
    public readonly onREPLConnectionStatus = this._onREPLConnectionStatus.event;

    constructor(config?: LanguageServiceBridgeConfig, context?: vscode.ExtensionContext) {
        this.config = {
            enableDiagnostics: true,
            enableCompletions: true,
            enableHover: true,
            enableSignatureHelp: true,
            enableREPL: true,
            enableCommandProcessor: true,
            maxREPLHistory: 1000,
            ...config
        };
        
        // Initialize the core language service
        this.languageService = new CircuitPythonLanguageService({
            enableDiagnostics: this.config.enableDiagnostics,
            enableCompletions: this.config.enableCompletions,
            enableHover: this.config.enableHover,
            enableSignatureHelp: this.config.enableSignatureHelp,
            strictPinValidation: true,
            enableBoardSpecificCompletions: true
        });

        // Initialize REPL components if enabled
        if (this.config.enableREPL && context) {
            this.historyManager = new TerminalHistoryManager(context);
            
            if (this.config.enableCommandProcessor) {
                // Create basic command processor with minimal services
                this.commandProcessor = new CommandProcessor({
                    languageClient: null, // Will be set by consumer if needed
                    historyManager: this.historyManager,
                    deviceDetector: null, // Will be set by consumer if needed
                });
            }
        }

        // Set default board if provided
        if (config?.defaultBoard) {
            const board = this.languageService.getAvailableBoards()
                .find(b => b.id === config.defaultBoard);
            if (board) {
                this.languageService.setBoard(board);
            }
        }
    }

    /**
     * Connect a webview to the language service via JSON-RPC
     */
    connectWebview(webview: vscode.Webview, connectionId: string): void {
        // Create custom reader for webview messages
        class WebviewMessageReader extends AbstractMessageReader {
            constructor(private webview: vscode.Webview) {
                super();
            }

            listen(callback: DataCallback): void {
                this.webview.onDidReceiveMessage(callback);
            }
        }

        // Create custom writer for webview messages
        class WebviewMessageWriter extends AbstractMessageWriter {
            constructor(private webview: vscode.Webview) {
                super();
            }

            write(msg: Message): Promise<void> {
                this.webview.postMessage(msg);
                return Promise.resolve();
            }

            end(): void {
                // No-op for webview
            }
        }

        // Create JSON-RPC connection
        const reader = new WebviewMessageReader(webview);
        const writer = new WebviewMessageWriter(webview);
        const connection = createMessageConnection(reader, writer);

        // Set up language service RPC handlers
        this.setupLanguageServiceHandlers(connection);
        
        // Set up REPL RPC handlers if enabled
        if (this.config.enableREPL) {
            this.setupREPLHandlers(connection, connectionId);
        }

        // Store connection and start listening
        this.connections.set(connectionId, connection);
        connection.listen();

        console.log(`CircuitPython Language Service connected to webview: ${connectionId}`);
    }

    /**
     * Disconnect a webview from the language service
     */
    disconnectWebview(connectionId: string): void {
        const connection = this.connections.get(connectionId);
        if (connection) {
            connection.dispose();
            this.connections.delete(connectionId);
            console.log(`CircuitPython Language Service disconnected from webview: ${connectionId}`);
        }
    }

    /**
     * Get the underlying language service (for direct access if needed)
     */
    getLanguageService(): ICircuitPythonLanguageService {
        return this.languageService;
    }

    /**
     * Broadcast a notification to all connected webviews
     */
    broadcastNotification(method: string, params?: any): void {
        for (const connection of this.connections.values()) {
            connection.sendNotification(method, params);
        }
    }

    /**
     * Update language service configuration
     */
    updateConfiguration(config: Partial<CircuitPythonLanguageServiceConfig>): void {
        this.languageService.updateConfig(config);
        
        // Notify all connected webviews of configuration change
        this.broadcastNotification('configurationChanged', {
            config: this.languageService.getConfig()
        });
    }

    /**
     * Set the active board for all connections
     */
    setActiveBoard(boardId: string): boolean {
        const board = this.languageService.getAvailableBoards()
            .find(b => b.id === boardId);
        
        if (board) {
            this.languageService.setBoard(board);
            
            // Notify all connected webviews of board change
            this.broadcastNotification('boardChanged', {
                board: board
            });
            
            return true;
        }
        
        return false;
    }

    // REPL Session Management
    createREPLSession(webviewId: string): string {
        const sessionId = `repl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const session: REPLSession = {
            id: sessionId,
            webviewId,
            created: Date.now(),
            lastActivity: Date.now(),
            isActive: true
        };
        
        this.replSessions.set(sessionId, session);
        console.log(`Created REPL session: ${sessionId} for webview: ${webviewId}`);
        return sessionId;
    }
    
    closeREPLSession(sessionId: string): boolean {
        const session = this.replSessions.get(sessionId);
        if (session) {
            session.isActive = false;
            this.replSessions.delete(sessionId);
            console.log(`Closed REPL session: ${sessionId}`);
            return true;
        }
        return false;
    }
    
    getREPLSession(sessionId: string): REPLSession | undefined {
        return this.replSessions.get(sessionId);
    }
    
    getActiveREPLSessions(): REPLSession[] {
        return Array.from(this.replSessions.values()).filter(s => s.isActive);
    }

    // REPL Command Execution with Language Service Integration
    async executeREPLCommand(context: REPLExecutionContext): Promise<REPLExecutionResult> {
        const startTime = Date.now();
        
        try {
            // Update session activity
            const session = this.replSessions.get(context.sessionId);
            if (session) {
                session.lastActivity = Date.now();
            }
            
            // Add to history if available
            if (this.historyManager) {
                this.historyManager.addCommand(context.command);
            }
            
            let result: CommandResult;
            
            // Use command processor if available and command starts with dot
            if (this.commandProcessor && context.command.startsWith('.')) {
                result = await this.commandProcessor.executeCommand(context.command);
            } else {
                // Basic execution - will be enhanced with actual device communication
                result = {
                    output: `Executing: ${context.command}`,
                    success: true,
                    requiresTerminalUpdate: true
                };
            }
            
            const executionResult: REPLExecutionResult = {
                ...result,
                sessionId: context.sessionId,
                executionTime: Date.now() - startTime
            };
            
            // Fire execution result event
            this._onREPLExecutionResult.fire(executionResult);
            
            return executionResult;
            
        } catch (error) {
            const errorResult: REPLExecutionResult = {
                output: '',
                success: false,
                sessionId: context.sessionId,
                executionTime: Date.now() - startTime
            };
            
            console.error('REPL execution error:', error);
            return errorResult;
        }
    }

    // REPL-aware completions (enhanced with CircuitPython context)
    async getREPLCompletions(document: string, position: Position, sessionId: string): Promise<CompletionItem[]> {
        try {
            // Get base CircuitPython completions from language service
            const completions = await this.languageService.getCompletions(document, position);
            
            // Add REPL-specific completions if history manager is available
            if (this.historyManager) {
                const historyCompletions = this.getHistoryBasedCompletions(document, position);
                completions.push(...historyCompletions);
            }
            
            return completions;
        } catch (error) {
            console.error('Error getting REPL completions:', error);
            return [];
        }
    }
    
    private getHistoryBasedCompletions(document: string, position: Position): CompletionItem[] {
        if (!this.historyManager) return [];
        
        // Get recent commands for context-based suggestions
        const allCommands = this.historyManager.getCommandHistory();
        const recentCommands = allCommands.slice(-10); // Get last 10 commands
        const currentLine = document.split('\n')[position.line] || '';
        const prefix = currentLine.substring(0, position.character);
        
        return recentCommands
            .filter(cmd => cmd.startsWith(prefix) && cmd !== prefix)
            .slice(0, 5)
            .map((cmd, index) => ({
                label: cmd,
                kind: 'Text' as any, // Will be properly typed
                detail: 'Recent command',
                sortText: `z${index}`, // Sort at bottom
                insertText: cmd.substring(prefix.length)
            }));
    }

    /**
     * Dispose of all connections and resources
     */
    dispose(): void {
        // Dispose REPL sessions
        this.replSessions.clear();
        
        // Dispose REPL event emitters
        this._onREPLOutput.dispose();
        this._onREPLExecutionResult.dispose();
        this._onREPLConnectionStatus.dispose();
        
        // Dispose REPL components
        if (this.historyManager) {
            this.historyManager.dispose();
        }
        
        // Dispose all RPC connections
        for (const connection of this.connections.values()) {
            connection.dispose();
        }
        this.connections.clear();

        // Dispose VS Code subscriptions
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    private setupLanguageServiceHandlers(connection: MessageConnection): void {
        // Code completion request
        connection.onRequest('textDocument/completion', async (params: {
            document: string;
            position: Position;
            context?: any;
        }) => {
            try {
                const completions = await this.languageService.getCompletions(
                    params.document,
                    params.position,
                    params.context
                );
                return { items: completions };
            } catch (error) {
                console.error('Error in completion request:', error);
                return { items: [] };
            }
        });

        // Hover information request
        connection.onRequest('textDocument/hover', async (params: {
            document: string;
            position: Position;
        }) => {
            try {
                const hover = await this.languageService.getHover(
                    params.document,
                    params.position
                );
                return hover;
            } catch (error) {
                console.error('Error in hover request:', error);
                return null;
            }
        });

        // Signature help request
        connection.onRequest('textDocument/signatureHelp', async (params: {
            document: string;
            position: Position;
        }) => {
            try {
                const signatureHelp = await this.languageService.getSignatureHelp(
                    params.document,
                    params.position
                );
                return signatureHelp;
            } catch (error) {
                console.error('Error in signature help request:', error);
                return null;
            }
        });

        // Diagnostics request
        connection.onRequest('textDocument/diagnostic', async (params: {
            document: string;
        }) => {
            try {
                const diagnostics = await this.languageService.getDiagnostics(
                    params.document
                );
                return { items: diagnostics };
            } catch (error) {
                console.error('Error in diagnostics request:', error);
                return { items: [] };
            }
        });

        // Board management requests
        connection.onRequest('board/list', async () => {
            try {
                return {
                    boards: this.languageService.getAvailableBoards()
                };
            } catch (error) {
                console.error('Error listing boards:', error);
                return { boards: [] };
            }
        });

        connection.onRequest('board/set', async (params: { boardId: string }) => {
            try {
                const success = this.setActiveBoard(params.boardId);
                return { 
                    success,
                    board: success ? this.languageService.getBoard() : null
                };
            } catch (error) {
                console.error('Error setting board:', error);
                return { success: false, board: null };
            }
        });

        connection.onRequest('board/get', async () => {
            try {
                return {
                    board: this.languageService.getBoard()
                };
            } catch (error) {
                console.error('Error getting current board:', error);
                return { board: null };
            }
        });

        // Module information requests
        connection.onRequest('module/list', async () => {
            try {
                return {
                    modules: this.languageService.getAvailableModules()
                };
            } catch (error) {
                console.error('Error listing modules:', error);
                return { modules: [] };
            }
        });

        connection.onRequest('module/get', async (params: { moduleName: string }) => {
            try {
                const module = this.languageService.getModule(params.moduleName);
                return { module };
            } catch (error) {
                console.error('Error getting module:', error);
                return { module: null };
            }
        });

        // Configuration requests
        connection.onRequest('config/get', async () => {
            try {
                return {
                    config: this.languageService.getConfig()
                };
            } catch (error) {
                console.error('Error getting configuration:', error);
                return { config: {} };
            }
        });

        connection.onRequest('config/update', async (params: {
            config: Partial<CircuitPythonLanguageServiceConfig>
        }) => {
            try {
                this.languageService.updateConfig(params.config);
                return {
                    success: true,
                    config: this.languageService.getConfig()
                };
            } catch (error) {
                console.error('Error updating configuration:', error);
                return { success: false, config: {} };
            }
        });

        // Health check / ping
        connection.onRequest('service/ping', async () => {
            return {
                status: 'healthy',
                timestamp: new Date().toISOString(),
                version: '1.0.0' // TODO: Get from package.json
            };
        });

        // Connection ready notification
        connection.onNotification('client/ready', (params: any) => {
            console.log('CircuitPython Language Service client ready:', params);
            
            // Send initial state to client
            connection.sendNotification('service/ready', {
                config: this.languageService.getConfig(),
                board: this.languageService.getBoard(),
                availableBoards: this.languageService.getAvailableBoards(),
                availableModules: this.languageService.getAvailableModules()
            });
        });
    }

    private setupREPLHandlers(connection: MessageConnection, connectionId: string): void {
        // REPL Session Management
        connection.onRequest('repl/createSession', async () => {
            try {
                const sessionId = this.createREPLSession(connectionId);
                return { success: true, sessionId };
            } catch (error) {
                console.error('Error creating REPL session:', error);
                return { success: false, sessionId: null };
            }
        });

        connection.onRequest('repl/closeSession', async (params: { sessionId: string }) => {
            try {
                const success = this.closeREPLSession(params.sessionId);
                return { success };
            } catch (error) {
                console.error('Error closing REPL session:', error);
                return { success: false };
            }
        });

        connection.onRequest('repl/getActiveSessions', async () => {
            try {
                const sessions = this.getActiveREPLSessions();
                return { sessions };
            } catch (error) {
                console.error('Error getting active REPL sessions:', error);
                return { sessions: [] };
            }
        });

        // REPL Command Execution
        connection.onRequest('repl/execute', async (params: {
            sessionId: string;
            command: string;
            source?: 'repl' | 'editor';
        }) => {
            try {
                const context: REPLExecutionContext = {
                    sessionId: params.sessionId,
                    command: params.command,
                    timestamp: Date.now(),
                    source: params.source || 'repl'
                };
                
                const result = await this.executeREPLCommand(context);
                return result;
            } catch (error) {
                console.error('Error executing REPL command:', error);
                return {
                    output: `Error executing command: ${error}`,
                    success: false,
                    sessionId: params.sessionId,
                    executionTime: 0
                };
            }
        });

        // REPL Completions (enhanced with CircuitPython + history context)
        connection.onRequest('repl/getCompletions', async (params: {
            document: string;
            position: Position;
            sessionId: string;
        }) => {
            try {
                const completions = await this.getREPLCompletions(
                    params.document, 
                    params.position, 
                    params.sessionId
                );
                return { items: completions };
            } catch (error) {
                console.error('Error getting REPL completions:', error);
                return { items: [] };
            }
        });

        // Raw Data Communication (for binary device communication)
        connection.onRequest('repl/sendRaw', async (params: {
            sessionId: string;
            data: string; // Base64 encoded binary data
        }) => {
            try {
                // TODO: Implement raw data sending to device
                // This will connect to the actual device communication pipeline
                console.log(`Sending raw data for session ${params.sessionId}:`, params.data);
                
                // For now, just acknowledge receipt
                return { success: true, bytesWritten: params.data.length };
            } catch (error) {
                console.error('Error sending raw data:', error);
                return { success: false, bytesWritten: 0 };
            }
        });

        // REPL History Management
        connection.onRequest('repl/getHistory', async (params: {
            sessionId: string;
            limit?: number;
        }) => {
            try {
                if (!this.historyManager) {
                    return { history: [] };
                }
                
                const allCommands = this.historyManager.getCommandHistory();
                const recentCommands = allCommands.slice(-(params.limit || 50)); // Get recent commands
                const history = recentCommands.map((command, index) => ({
                    command,
                    timestamp: Date.now() - (recentCommands.length - index) * 1000, // Approximate
                    index
                }));
                
                return { history };
            } catch (error) {
                console.error('Error getting REPL history:', error);
                return { history: [] };
            }
        });

        connection.onRequest('repl/clearHistory', async (params: {
            sessionId: string;
        }) => {
            try {
                if (this.historyManager) {
                    // TODO: Add clear method to TerminalHistoryManager if not exists
                    console.log(`Clearing history for session ${params.sessionId}`);
                }
                return { success: true };
            } catch (error) {
                console.error('Error clearing REPL history:', error);
                return { success: false };
            }
        });

        // REPL Status and Connection Management
        connection.onRequest('repl/getStatus', async (params: {
            sessionId: string;
        }) => {
            try {
                const session = this.getREPLSession(params.sessionId);
                const isConnected = session ? session.isActive : false;
                
                return {
                    sessionId: params.sessionId,
                    isConnected,
                    lastActivity: session?.lastActivity,
                    created: session?.created
                };
            } catch (error) {
                console.error('Error getting REPL status:', error);
                return {
                    sessionId: params.sessionId,
                    isConnected: false,
                    lastActivity: null,
                    created: null
                };
            }
        });

        // Handle REPL notifications from webview
        connection.onNotification('repl/output', (params: {
            sessionId: string;
            data: string;
        }) => {
            // Forward output event
            this._onREPLOutput.fire(params);
        });

        connection.onNotification('repl/connectionStatus', (params: {
            sessionId: string;
            connected: boolean;
        }) => {
            // Update session status and forward event
            const session = this.getREPLSession(params.sessionId);
            if (session) {
                session.isActive = params.connected;
                session.lastActivity = Date.now();
            }
            
            this._onREPLConnectionStatus.fire(params);
        });
    }
}