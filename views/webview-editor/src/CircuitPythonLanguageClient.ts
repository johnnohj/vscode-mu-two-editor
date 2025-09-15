/**
 * CircuitPython Language Client for Monaco Editor
 * 
 * JSON-RPC client that provides language services (completions, hover, diagnostics)
 * for the Monaco Editor webview.
 */

import { 
    createMessageConnection, 
    MessageConnection, 
    AbstractMessageReader, 
    AbstractMessageWriter, 
    DataCallback, 
    Message 
} from 'vscode-jsonrpc/browser';

import * as monaco from 'monaco-editor';

export interface CompletionItem {
    label: string;
    kind: string;
    detail?: string;
    documentation?: string;
    insertText?: string;
}

export interface CompletionResult {
    items: CompletionItem[];
}

export interface Position {
    line: number;
    character: number;
}

export interface HoverInfo {
    contents: string;
    range?: { start: number; end: number };
}

export interface DiagnosticResult {
    items: Array<{
        message: string;
        severity: 'error' | 'warning' | 'information' | 'hint';
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
        source: string;
    }>;
}

export interface CircuitPythonBoard {
    id: string;
    name: string;
    displayName: string;
    pins: Array<{
        name: string;
        capabilities: string[];
    }>;
}

export class CircuitPythonLanguageClient {
    private connection: MessageConnection | null = null;
    private vscode: any;
    private isReady: boolean = false;
    private diagnosticsCallback?: (diagnostics: monaco.editor.IMarkerData[]) => void;

    constructor(vscode: any) {
        this.vscode = vscode;
        this.setupConnection();
    }

    private setupConnection(): void {
        // Create custom reader for VS Code webview
        class VSCodeMessageReader extends AbstractMessageReader {
            constructor(private vscode: any) {
                super();
            }

            listen(callback: DataCallback): void {
                window.addEventListener('message', (event) => {
                    const message = event.data;
                    // Only handle JSON-RPC messages (they have id, method, or result properties)
                    if (message && (message.id !== undefined || message.method || message.result !== undefined || message.error !== undefined)) {
                        callback(message);
                    }
                });
            }
        }

        // Create custom writer for VS Code webview
        class VSCodeMessageWriter extends AbstractMessageWriter {
            constructor(private vscode: any) {
                super();
            }

            write(msg: Message): Promise<void> {
                this.vscode.postMessage(msg);
                return Promise.resolve();
            }

            end(): void {
                // No-op for webview
            }
        }

        // Create JSON-RPC connection
        const reader = new VSCodeMessageReader(this.vscode);
        const writer = new VSCodeMessageWriter(this.vscode);
        this.connection = createMessageConnection(reader, writer);

        // Handle service ready notification
        this.connection.onNotification('service/ready', (params: any) => {
            console.log('CircuitPython Language Service ready:', params);
            this.isReady = true;
        });

        // Handle board changes
        this.connection.onNotification('boardChanged', (params: any) => {
            console.log('Board changed:', params.board);
        });

        // Handle configuration changes
        this.connection.onNotification('configurationChanged', (params: any) => {
            console.log('Configuration changed:', params.config);
        });

        // Start listening
        this.connection.listen();

        // Send client ready notification
        setTimeout(() => {
            if (this.connection) {
                this.connection.sendNotification('client/ready', {
                    clientType: 'monaco-editor',
                    version: '1.0.0'
                });
            }
        }, 100);
    }

    /**
     * Get Monaco-compatible completion suggestions
     */
    async getMonacoCompletions(
        model: monaco.editor.ITextModel,
        position: monaco.Position
    ): Promise<monaco.languages.CompletionItem[]> {
        if (!this.connection || !this.isReady) {
            return [];
        }

        try {
            const document = model.getValue();
            const pos: Position = {
                line: position.lineNumber - 1, // Monaco is 1-based, LSP is 0-based
                character: position.column - 1
            };

            const result: CompletionResult = await this.connection.sendRequest('textDocument/completion', {
                document,
                position: pos,
                context: {
                    triggerKind: 'invoked'
                }
            });

            return this.convertToMonacoCompletions(result.items || []);
        } catch (error) {
            console.error('Error getting Monaco completions:', error);
            return [];
        }
    }

    /**
     * Get Monaco-compatible hover information
     */
    async getMonacoHover(
        model: monaco.editor.ITextModel,
        position: monaco.Position
    ): Promise<monaco.languages.Hover | null> {
        if (!this.connection || !this.isReady) {
            return null;
        }

        try {
            const document = model.getValue();
            const pos: Position = {
                line: position.lineNumber - 1,
                character: position.column - 1
            };

            const result: HoverInfo | null = await this.connection.sendRequest('textDocument/hover', {
                document,
                position: pos
            });

            if (!result) {
                return null;
            }

            return {
                contents: [{ value: result.contents }],
                range: result.range ? new monaco.Range(
                    position.lineNumber,
                    result.range.start + 1,
                    position.lineNumber,
                    result.range.end + 1
                ) : undefined
            };
        } catch (error) {
            console.error('Error getting Monaco hover:', error);
            return null;
        }
    }

    /**
     * Get Monaco-compatible diagnostics
     */
    async getMonacoDiagnostics(model: monaco.editor.ITextModel): Promise<monaco.editor.IMarkerData[]> {
        if (!this.connection || !this.isReady) {
            return [];
        }

        try {
            const document = model.getValue();
            const result: DiagnosticResult = await this.connection.sendRequest('textDocument/diagnostic', {
                document
            });

            return this.convertToMonacoDiagnostics(result.items || []);
        } catch (error) {
            console.error('Error getting Monaco diagnostics:', error);
            return [];
        }
    }

    /**
     * Set the active CircuitPython board
     */
    async setBoard(boardId: string): Promise<boolean> {
        if (!this.connection || !this.isReady) {
            return false;
        }

        try {
            const result = await this.connection.sendRequest('board/set', {
                boardId
            });

            return result.success || false;
        } catch (error) {
            console.error('Error setting board:', error);
            return false;
        }
    }

    /**
     * Get list of available boards
     */
    async getAvailableBoards(): Promise<CircuitPythonBoard[]> {
        if (!this.connection || !this.isReady) {
            return [];
        }

        try {
            const result = await this.connection.sendRequest('board/list', {});
            return result.boards || [];
        } catch (error) {
            console.error('Error getting boards:', error);
            return [];
        }
    }

    /**
     * Register a callback for diagnostics updates
     */
    onDiagnostics(callback: (diagnostics: monaco.editor.IMarkerData[]) => void): void {
        this.diagnosticsCallback = callback;
    }

    /**
     * Trigger diagnostics update for a model
     */
    async updateDiagnostics(model: monaco.editor.ITextModel): Promise<void> {
        if (this.diagnosticsCallback) {
            const diagnostics = await this.getMonacoDiagnostics(model);
            this.diagnosticsCallback(diagnostics);
        }
    }

    /**
     * Check if the language client is ready
     */
    isLanguageServiceReady(): boolean {
        return this.isReady && this.connection !== null;
    }

    /**
     * Dispose of the connection
     */
    dispose(): void {
        if (this.connection) {
            this.connection.dispose();
            this.connection = null;
        }
        this.isReady = false;
        this.diagnosticsCallback = undefined;
    }

    // Helper methods for converting between LSP and Monaco types
    private convertToMonacoCompletions(items: CompletionItem[]): monaco.languages.CompletionItem[] {
        return items.map(item => ({
            label: item.label,
            kind: this.convertCompletionKind(item.kind),
            detail: item.detail,
            documentation: item.documentation,
            insertText: item.insertText || item.label,
            range: undefined as any // Will be filled by Monaco
        }));
    }

    private convertCompletionKind(kind: string): monaco.languages.CompletionItemKind {
        switch (kind.toLowerCase()) {
            case 'function':
                return monaco.languages.CompletionItemKind.Function;
            case 'method':
                return monaco.languages.CompletionItemKind.Method;
            case 'class':
                return monaco.languages.CompletionItemKind.Class;
            case 'module':
                return monaco.languages.CompletionItemKind.Module;
            case 'property':
                return monaco.languages.CompletionItemKind.Property;
            case 'constant':
                return monaco.languages.CompletionItemKind.Constant;
            case 'variable':
                return monaco.languages.CompletionItemKind.Variable;
            case 'keyword':
                return monaco.languages.CompletionItemKind.Keyword;
            default:
                return monaco.languages.CompletionItemKind.Text;
        }
    }

    private convertToMonacoDiagnostics(items: DiagnosticResult['items']): monaco.editor.IMarkerData[] {
        return items.map(item => ({
            message: item.message,
            severity: this.convertDiagnosticSeverity(item.severity),
            startLineNumber: item.range.start.line + 1, // Convert to 1-based
            startColumn: item.range.start.character + 1,
            endLineNumber: item.range.end.line + 1,
            endColumn: item.range.end.character + 1,
            source: item.source
        }));
    }

    private convertDiagnosticSeverity(severity: string): monaco.MarkerSeverity {
        switch (severity.toLowerCase()) {
            case 'error':
                return monaco.MarkerSeverity.Error;
            case 'warning':
                return monaco.MarkerSeverity.Warning;
            case 'information':
                return monaco.MarkerSeverity.Info;
            case 'hint':
                return monaco.MarkerSeverity.Hint;
            default:
                return monaco.MarkerSeverity.Info;
        }
    }
}