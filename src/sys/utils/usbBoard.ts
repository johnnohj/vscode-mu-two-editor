// src/core/usbBoard.ts
// USB Board using CircuitPython REPL JS patterns

import * as vscode from 'vscode';
import { IBoard, BoardType, BoardConnectionState, BoardCapabilities, ExecutionResult, FileInfo, DeviceInfo } from '../boardManager';
import { CircuitPythonRepl, ReplState, ReplMode, ReplCommand } from '../../devices/protocols/repl';

/**
 * USB CircuitPython Board using CircuitPython REPL JS patterns
 * Replaces the basic UsbCircuitPythonBoard with robust REPL communication
 */
export class UsbCircuitPythonBoard implements IBoard {
    private repl: CircuitPythonRepl;
    private _connectionState: BoardConnectionState;
    private replSessions = new Map<string, { created: Date; lastUsed: Date }>();
    
    private _onConnectionStateChanged = new vscode.EventEmitter<BoardConnectionState>();
    private _onFileSystemChanged = new vscode.EventEmitter<{ type: 'created' | 'modified' | 'deleted'; path: string }>();
    private _onReplOutput = new vscode.EventEmitter<{ sessionId: string; output: string; type: 'stdout' | 'stderr' | 'input'; timestamp: Date }>();
    
    public readonly onConnectionStateChanged = this._onConnectionStateChanged.event;
    public readonly onFileSystemChanged = this._onFileSystemChanged.event;
    public readonly onReplOutput = this._onReplOutput.event;
    
    public readonly type: BoardType = 'usb';
    public readonly capabilities: BoardCapabilities = {
        hasFileSystem: true,
        hasRepl: true,
        supportsDebugging: true,
        supportsFileTransfer: true,
        maxFileSize: 2 * 1024 * 1024
    };
    
    constructor(
        public readonly id: string,
        public readonly name: string,
        private deviceInfo: DeviceInfo
    ) {
        this.repl = new CircuitPythonRepl(
            this.deviceInfo.path,
            this.deviceInfo.baudRate || 115200
        );
        
        this._connectionState = {
            connected: false,
            connecting: false,
            deviceInfo: this.deviceInfo
        };
        
        this.setupReplEventHandlers();
    }
    
    public get connectionState(): BoardConnectionState {
        return { ...this._connectionState };
    }
    
    private setupReplEventHandlers(): void {
        this.repl.onStateChanged((state) => {
            this.updateConnectionStateFromRepl(state);
        });
        
        this.repl.onOutput((output) => {
            // Forward output to any active REPL sessions
            for (const sessionId of this.replSessions.keys()) {
                this._onReplOutput.fire({
                    sessionId,
                    output,
                    type: 'stdout',
                    timestamp: new Date()
                });
            }
        });
        
        this.repl.onError((error) => {
            this.setConnectionState({
                connected: false,
                connecting: false,
                error
            });
        });
    }
    
    private updateConnectionStateFromRepl(replState: ReplState): void {
        switch (replState) {
            case ReplState.Connecting:
                this.setConnectionState({ connecting: true, connected: false });
                break;
            case ReplState.Connected:
            case ReplState.Normal:
                this.setConnectionState({
                    connected: true,
                    connecting: false,
                    lastConnected: new Date(),
                    error: undefined
                });
                break;
            case ReplState.Disconnected:
                this.setConnectionState({ connected: false, connecting: false });
                break;
            case ReplState.Error:
                this.setConnectionState({
                    connected: false,
                    connecting: false,
                    error: 'REPL communication error'
                });
                break;
        }
    }
    
    public async connect(): Promise<void> {
        if (this.isConnected()) {
            return; // Already connected
        }
        
        try {
            await this.repl.connect();
        } catch (error) {
            this.setConnectionState({
                connected: false,
                connecting: false,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    public async disconnect(): Promise<void> {
        try {
            // Close all REPL sessions
            this.replSessions.clear();
            
            // Disconnect REPL
            await this.repl.disconnect();
            
            this.setConnectionState({
                connected: false,
                connecting: false
            });
        } catch (error) {
            console.error('Error during disconnect:', error);
        }
    }
    
    public isConnected(): boolean {
        return this._connectionState.connected;
    }
    
    /**
     * Code execution using CircuitPython REPL JS patterns
     */
    public async eval(code: string): Promise<ExecutionResult> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        try {
            // Choose appropriate REPL mode based on code characteristics
            const mode = this.selectReplMode(code);
            
            const command: ReplCommand = {
                code,
                mode,
                timeout: 10000,
                expectResult: true
            };
            
            const result = await this.repl.execute(command);
            
            return {
                success: result.success,
                output: result.output,
                error: result.error,
                executionTime: result.executionTime
            };
            
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    
    /**
     * Select appropriate REPL mode based on code characteristics
     */
    private selectReplMode(code: string): ReplMode {
        // Use paste mode for multi-line code or large blocks
        if (code.includes('\n') || code.length > 100) {
            return ReplMode.Paste;
        }
        
        // Use raw mode for file operations or system commands
        if (code.includes('import ') || 
            code.includes('open(') || 
            code.includes('os.') ||
            code.includes('gc.')) {
            return ReplMode.Raw;
        }
        
        // Default to normal mode for simple expressions
        return ReplMode.Normal;
    }
    
    public async executeFile(filePath: string): Promise<ExecutionResult> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        try {
            // First, check if the file exists on the board
            const files = await this.listFiles('/');
            const fileName = filePath.split('/').pop() || filePath;
            
            if (!files.some(f => f.name === fileName)) {
                return {
                    success: false,
                    error: `File ${fileName} not found on board`
                };
            }
            
            // Execute the file using exec(open(...).read())
            const command: ReplCommand = {
                code: `exec(open('${fileName}').read())`,
                mode: ReplMode.Raw,
                timeout: 30000
            };
            
            const result = await this.repl.execute(command);
            
            return {
                success: result.success,
                output: result.output || `Executed file: ${fileName}`,
                error: result.error,
                executionTime: result.executionTime
            };
            
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
    
    public async interrupt(): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        await this.repl.interrupt();
    }
    
    public async restart(): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        await this.repl.softReset();
    }
    
    /**
     * File operations using CircuitPython REPL JS file handling
     */
    public async readFile(path: string): Promise<string> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        try {
            const content = await this.repl.readFile(path);
            return content;
        } catch (error) {
            throw new Error(`Failed to read file ${path}: ${error}`);
        }
    }
    
    public async writeFile(path: string, content: string): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        try {
            await this.repl.writeFile(path, content);
            
            // Emit file system change event
            this._onFileSystemChanged.fire({
                type: 'modified',
                path
            });
            
        } catch (error) {
            throw new Error(`Failed to write file ${path}: ${error}`);
        }
    }
    
    public async listFiles(path: string = '/'): Promise<FileInfo[]> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        try {
            const fileNames = await this.repl.listDirectory(path);
            
            // Convert to FileInfo objects
            const files: FileInfo[] = fileNames.map(name => ({
                name,
                path: path === '/' ? `/${name}` : `${path}/${name}`,
                type: name.includes('.') ? 'file' : 'directory'
            }));
            
            return files;
            
        } catch (error) {
            throw new Error(`Failed to list files in ${path}: ${error}`);
        }
    }
    
    public async deleteFile(path: string): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        try {
            const command: ReplCommand = {
                code: `
import os
try:
    os.remove('${path}')
    print('File deleted successfully')
except Exception as e:
    print('ERROR:', str(e))
                `.trim(),
                mode: ReplMode.Raw,
                timeout: 5000
            };
            
            const result = await this.repl.execute(command);
            
            if (!result.success || (result.output && result.output.includes('ERROR:'))) {
                throw new Error(result.error || 'Failed to delete file');
            }
            
            // Emit file system change event
            this._onFileSystemChanged.fire({
                type: 'deleted',
                path
            });
            
        } catch (error) {
            throw new Error(`Failed to delete file ${path}: ${error}`);
        }
    }
    
    /**
     * REPL session management
     */
    public async createReplSession(): Promise<string> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        const sessionId = `repl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.replSessions.set(sessionId, {
            created: new Date(),
            lastUsed: new Date()
        });
        
        return sessionId;
    }
    
    public async sendToRepl(sessionId: string, command: string): Promise<string> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        const session = this.replSessions.get(sessionId);
        if (!session) {
            throw new Error(`REPL session ${sessionId} not found`);
        }
        
        // Update session last used time
        session.lastUsed = new Date();
        
        try {
            // Emit input event
            this._onReplOutput.fire({
                sessionId,
                output: command,
                type: 'input',
                timestamp: new Date()
            });
            
            // Execute command using appropriate mode
            const mode = this.selectReplMode(command);
            const replCommand: ReplCommand = {
                code: command,
                mode,
                timeout: 10000
            };
            
            const result = await this.repl.execute(replCommand);
            
            // Emit output event
            if (result.output) {
                this._onReplOutput.fire({
                    sessionId,
                    output: result.output,
                    type: 'stdout',
                    timestamp: new Date()
                });
            }
            
            if (result.error) {
                this._onReplOutput.fire({
                    sessionId,
                    output: result.error,
                    type: 'stderr',
                    timestamp: new Date()
                });
            }
            
            return result.output || result.error || '';
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            this._onReplOutput.fire({
                sessionId,
                output: errorMessage,
                type: 'stderr',
                timestamp: new Date()
            });
            
            return errorMessage;
        }
    }
    
    public async closeReplSession(sessionId: string): Promise<void> {
        this.replSessions.delete(sessionId);
    }
    
    /**
     * Advanced CircuitPython operations using REPL
     */
    public async getDeviceInfo(): Promise<{ version: string; board: string; features: string[] }> {
        if (!this.isConnected()) {
            throw new Error('Board not connected');
        }
        
        try {
            const command: ReplCommand = {
                code: `
import sys
import board
print('VERSION:', sys.implementation.version)
print('BOARD:', sys.implementation._machine)
try:
    import os
    print('FEATURES:', ','.join(dir(board)))
except:
    print('FEATURES: basic')
                `.trim(),
                mode: ReplMode.Raw,
                timeout: 5000
            };
            
            const result = await this.repl.execute(command);
            
            if (!result.success) {
                throw new Error('Failed to get device info');
            }
            
            const output = result.output || '';
            const lines = output.split('\n');
            
            let version = 'Unknown';
            let boardName = 'Unknown';
            let features: string[] = [];
            
            for (const line of lines) {
                if (line.startsWith('VERSION:')) {
                    version = line.substring(8).trim();
                } else if (line.startsWith('BOARD:')) {
                    boardName = line.substring(6).trim();
                } else if (line.startsWith('FEATURES:')) {
                    const featuresStr = line.substring(9).trim();
                    features = featuresStr.split(',').map(f => f.trim());
                }
            }
            
            return { version, board: boardName, features };
            
        } catch (error) {
            throw new Error(`Failed to get device info: ${error}`);
        }
    }
    
    /**
     * Get current REPL mode information
     */
    public getReplInfo(): { state: string; mode: string; connected: boolean } {
        return {
            state: this.repl.getState(),
            mode: this.repl.getCurrentMode(),
            connected: this.repl.isConnected()
        };
    }
    
    private setConnectionState(state: Partial<BoardConnectionState>): void {
        this._connectionState = { ...this._connectionState, ...state };
        this._onConnectionStateChanged.fire(this.connectionState);
    }
    
    public dispose(): void {
        this.disconnect();
        this.repl.dispose();
        this._onConnectionStateChanged.dispose();
        this._onFileSystemChanged.dispose();
        this._onReplOutput.dispose();
    }
}

/**
 * Factory for creating USB boards
 */
export class BoardFactory {
    static createUsbBoard(
        deviceInfo: DeviceInfo
    ): UsbCircuitPythonBoard {
        const boardId = deviceInfo.boardId || `usb-${deviceInfo.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
        
        return new UsbCircuitPythonBoard(
            boardId,
            deviceInfo.displayName || `USB Board (${deviceInfo.path})`,
            deviceInfo
        );
    }
}
