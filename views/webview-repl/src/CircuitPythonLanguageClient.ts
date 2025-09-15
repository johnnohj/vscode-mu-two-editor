/**
 * CircuitPython Language Client for REPL
 * 
 * JSON-RPC client that provides tab completion and language services
 * for the CircuitPython REPL webview.
 */

import { 
    createMessageConnection, 
    MessageConnection, 
    AbstractMessageReader, 
    AbstractMessageWriter, 
    DataCallback, 
    Message 
} from 'vscode-jsonrpc/browser';

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
                    clientType: 'repl',
                    version: '1.0.0'
                });
            }
        }, 100);
    }

    /**
     * Get tab completions for the current input
     */
    async getCompletions(currentInput: string, cursorPosition: number): Promise<CompletionItem[]> {
        if (!this.connection || !this.isReady) {
            return [];
        }

        try {
            // Parse input into lines to determine position
            const lines = currentInput.split('\n');
            const lastLineIndex = lines.length - 1;
            const lastLine = lines[lastLineIndex] || '';
            
            // Calculate position in the last line
            const position: Position = {
                line: lastLineIndex,
                character: Math.min(cursorPosition, lastLine.length)
            };

            const result: CompletionResult = await this.connection.sendRequest('textDocument/completion', {
                document: currentInput,
                position: position,
                context: {
                    triggerKind: 'invoked'
                }
            });

            return result.items || [];
        } catch (error) {
            console.error('Error getting completions:', error);
            return [];
        }
    }

    /**
     * Get hover information for a word
     */
    async getHover(document: string, position: Position): Promise<HoverInfo | null> {
        if (!this.connection || !this.isReady) {
            return null;
        }

        try {
            const result = await this.connection.sendRequest('textDocument/hover', {
                document,
                position
            });

            return result;
        } catch (error) {
            console.error('Error getting hover info:', error);
            return null;
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
     * Get current board
     */
    async getCurrentBoard(): Promise<CircuitPythonBoard | null> {
        if (!this.connection || !this.isReady) {
            return null;
        }

        try {
            const result = await this.connection.sendRequest('board/get', {});
            return result.board || null;
        } catch (error) {
            console.error('Error getting current board:', error);
            return null;
        }
    }

    /**
     * Ping the language service to check if it's alive
     */
    async ping(): Promise<boolean> {
        if (!this.connection) {
            return false;
        }

        try {
            const result = await this.connection.sendRequest('service/ping', {});
            return result.status === 'healthy';
        } catch (error) {
            console.error('Error pinging service:', error);
            return false;
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
    }
}