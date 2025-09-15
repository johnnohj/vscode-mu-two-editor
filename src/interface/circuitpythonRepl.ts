// src/circuitpython/circuitPythonRepl.ts
// Enhanced CircuitPython REPL using @adafruit/circuitpython-repl patterns

import * as vscode from 'vscode';
import { SerialPort } from 'serialport';

/**
 * REPL State Management - based on CircuitPython REPL JS patterns
 */
export enum ReplState {
    Disconnected = 'disconnected',
    Connecting = 'connecting',
    Connected = 'connected',
    Normal = 'normal',        // Normal REPL mode
    RawPaste = 'rawpaste',    // Raw paste mode for file operations
    Error = 'error'
}

export enum ReplMode {
    Normal = 'normal',
    Raw = 'raw',
    Paste = 'paste'
}

export interface ReplCommand {
    code: string;
    mode?: ReplMode;
    timeout?: number;
    expectResult?: boolean;
}

export interface ReplResult {
    success: boolean;
    output?: string;
    error?: string;
    executionTime?: number;
    mode: ReplMode;
}

/**
 * Enhanced CircuitPython REPL using patterns from @adafruit/circuitpython-repl-js
 * Provides robust REPL communication with proper state management
 */
export class CircuitPythonRepl {
    private port: SerialPort | null = null;
    private state: ReplState = ReplState.Disconnected;
    private currentMode: ReplMode = ReplMode.Normal;
    private outputBuffer: string = '';
    private pendingCommands: Array<{
        command: ReplCommand;
        resolve: (result: ReplResult) => void;
        reject: (error: Error) => void;
        timestamp: number;
    }> = [];
    
    private _onStateChanged = new vscode.EventEmitter<ReplState>();
    private _onOutput = new vscode.EventEmitter<string>();
    private _onError = new vscode.EventEmitter<string>();
    
    public readonly onStateChanged = this._onStateChanged.event;
    public readonly onOutput = this._onOutput.event;
    public readonly onError = this._onError.event;
    
    constructor(
        private devicePath: string,
        private baudRate: number = 115200
    ) {}
    
    /**
     * Connect to CircuitPython device with enhanced protocol handling
     */
    public async connect(): Promise<void> {
        if (this.state !== ReplState.Disconnected) {
            throw new Error(`Cannot connect: current state is ${this.state}`);
        }
        
        this.setState(ReplState.Connecting);
        
        try {
            this.port = new SerialPort({
                path: this.devicePath,
                baudRate: this.baudRate,
                autoOpen: false
            });
            
            await this.openPort();
            this.setupEventHandlers();
            
            // Initialize REPL connection using CircuitPython REPL JS patterns
            await this.initializeRepl();
            
            this.setState(ReplState.Connected);
            
        } catch (error) {
            this.setState(ReplState.Error);
            throw new Error(`Failed to connect to ${this.devicePath}: ${error}`);
        }
    }
    
    /**
     * Initialize REPL connection using CircuitPython REPL JS patterns
     */
    private async initializeRepl(): Promise<void> {
        // Send Ctrl+C to interrupt any running code
        await this.sendRaw('\x03');
        await this.waitForPrompt('>>> ', 2000);
        
        // Send Ctrl+D to do a soft reboot and get a clean REPL
        await this.sendRaw('\x04');
        await this.waitForBoot();
        
        // We should now be in normal REPL mode
        this.currentMode = ReplMode.Normal;
        this.setState(ReplState.Normal);
    }
    
    /**
     * Wait for device to boot and show REPL prompt
     */
    private async waitForBoot(timeout: number = 10000): Promise<void> {
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
            const checkForPrompt = () => {
                if (Date.now() - startTime > timeout) {
                    reject(new Error('Timeout waiting for device boot'));
                    return;
                }
                
                // Look for CircuitPython boot messages and REPL prompt
                if (this.outputBuffer.includes('>>> ') || 
                    this.outputBuffer.includes('Adafruit CircuitPython')) {
                    resolve();
                } else {
                    setTimeout(checkForPrompt, 100);
                }
            };
            
            checkForPrompt();
        });
    }
    
    /**
     * Execute code using appropriate REPL mode based on CircuitPython REPL JS patterns
     */
    public async execute(command: ReplCommand): Promise<ReplResult> {
        if (this.state !== ReplState.Normal && this.state !== ReplState.Connected) {
            throw new Error(`Cannot execute: REPL not ready (state: ${this.state})`);
        }
        
        const startTime = Date.now();
        
        try {
            let result: ReplResult;
            
            switch (command.mode || ReplMode.Normal) {
                case ReplMode.Normal:
                    result = await this.executeNormal(command);
                    break;
                case ReplMode.Raw:
                    result = await this.executeRaw(command);
                    break;
                case ReplMode.Paste:
                    result = await this.executePaste(command);
                    break;
                default:
                    throw new Error(`Unsupported REPL mode: ${command.mode}`);
            }
            
            result.executionTime = Date.now() - startTime;
            return result;
            
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - startTime,
                mode: command.mode || ReplMode.Normal
            };
        }
    }
    
    /**
     * Execute code in normal REPL mode
     */
    private async executeNormal(command: ReplCommand): Promise<ReplResult> {
        if (this.currentMode !== ReplMode.Normal) {
            await this.switchToNormalMode();
        }
        
        this.clearOutputBuffer();
        
        // Send the code
        await this.sendRaw(command.code + '\r\n');
        
        // Wait for execution and response
        const output = await this.waitForPrompt('>>> ', command.timeout || 5000);
        
        return {
            success: true,
            output: this.cleanOutput(output),
            mode: ReplMode.Normal
        };
    }
    
    /**
     * Execute code using raw REPL mode (like CircuitPython REPL JS)
     */
    private async executeRaw(command: ReplCommand): Promise<ReplResult> {
        await this.switchToRawMode();
        
        this.clearOutputBuffer();
        
        // In raw mode, send the code and wait for specific responses
        await this.sendRaw(command.code);
        await this.sendRaw('\x04'); // Ctrl+D to execute
        
        // Wait for execution to complete
        const output = await this.waitForRawResponse(command.timeout || 10000);
        
        await this.switchToNormalMode();
        
        return {
            success: !output.includes('Traceback'),
            output: this.cleanOutput(output),
            error: output.includes('Traceback') ? output : undefined,
            mode: ReplMode.Raw
        };
    }
    
    /**
     * Execute code using paste mode for larger code blocks
     */
    private async executePaste(command: ReplCommand): Promise<ReplResult> {
        if (this.currentMode !== ReplMode.Normal) {
            await this.switchToNormalMode();
        }
        
        // Enter paste mode
        await this.sendRaw('\x05'); // Ctrl+E
        await this.waitForPrompt('=== ', 1000);
        
        this.currentMode = ReplMode.Paste;
        this.clearOutputBuffer();
        
        // Send the code
        await this.sendRaw(command.code);
        
        // Exit paste mode and execute
        await this.sendRaw('\x04'); // Ctrl+D
        
        // Wait for execution
        const output = await this.waitForPrompt('>>> ', command.timeout || 10000);
        
        this.currentMode = ReplMode.Normal;
        
        return {
            success: !output.includes('Traceback'),
            output: this.cleanOutput(output),
            error: output.includes('Traceback') ? output : undefined,
            mode: ReplMode.Paste
        };
    }
    
    /**
     * Switch to raw REPL mode (Ctrl+A)
     */
    private async switchToRawMode(): Promise<void> {
        if (this.currentMode === ReplMode.Raw) return;
        
        await this.sendRaw('\x01'); // Ctrl+A
        await this.waitForPrompt('raw REPL; CTRL-B to exit\r\n>', 2000);
        this.currentMode = ReplMode.Raw;
    }
    
    /**
     * Switch to normal REPL mode (Ctrl+B)
     */
    private async switchToNormalMode(): Promise<void> {
        if (this.currentMode === ReplMode.Normal) return;
        
        await this.sendRaw('\x02'); // Ctrl+B
        await this.waitForPrompt('>>> ', 2000);
        this.currentMode = ReplMode.Normal;
    }
    
    /**
     * Send interrupt signal (Ctrl+C)
     */
    public async interrupt(): Promise<void> {
        await this.sendRaw('\x03');
        await this.waitForPrompt('>>> ', 2000);
        this.currentMode = ReplMode.Normal;
    }
    
    /**
     * Perform soft reset (Ctrl+D)
     */
    public async softReset(): Promise<void> {
        if (this.currentMode !== ReplMode.Normal) {
            await this.switchToNormalMode();
        }
        
        await this.sendRaw('\x04');
        await this.waitForBoot();
        this.currentMode = ReplMode.Normal;
    }
    
    /**
     * File operations using raw paste mode (like CircuitPython REPL JS 3.x)
     */
    public async writeFile(path: string, content: string): Promise<void> {
        const command: ReplCommand = {
            code: `
import os
with open('${path}', 'w') as f:
    f.write('''${content.replace(/'/g, "\\'")}''')
print('File written successfully')
            `.trim(),
            mode: ReplMode.Raw,
            timeout: 10000
        };
        
        const result = await this.execute(command);
        if (!result.success) {
            throw new Error(`Failed to write file: ${result.error}`);
        }
    }
    
    public async readFile(path: string): Promise<string> {
        const command: ReplCommand = {
            code: `
import os
try:
    with open('${path}', 'r') as f:
        content = f.read()
    print('FILE_CONTENT_START')
    print(content)
    print('FILE_CONTENT_END')
except Exception as e:
    print('ERROR:', str(e))
            `.trim(),
            mode: ReplMode.Raw,
            timeout: 10000
        };
        
        const result = await this.execute(command);
        if (!result.success) {
            throw new Error(`Failed to read file: ${result.error}`);
        }
        
        // Extract content between markers
        const output = result.output || '';
        const startMarker = 'FILE_CONTENT_START\r\n';
        const endMarker = '\r\nFILE_CONTENT_END';
        
        const startIndex = output.indexOf(startMarker);
        const endIndex = output.indexOf(endMarker);
        
        if (startIndex === -1 || endIndex === -1) {
            throw new Error('Could not extract file content from response');
        }
        
        return output.substring(startIndex + startMarker.length, endIndex);
    }
    
    public async listDirectory(path: string = '/'): Promise<string[]> {
        const command: ReplCommand = {
            code: `
import os
try:
    files = os.listdir('${path}')
    for f in files:
        print('FILE:', f)
except Exception as e:
    print('ERROR:', str(e))
            `.trim(),
            mode: ReplMode.Raw,
            timeout: 5000
        };
        
        const result = await this.execute(command);
        if (!result.success) {
            throw new Error(`Failed to list directory: ${result.error}`);
        }
        
        // Extract file names from output
        const output = result.output || '';
        const lines = output.split('\n');
        const files: string[] = [];
        
        for (const line of lines) {
            if (line.startsWith('FILE: ')) {
                files.push(line.substring(6).trim());
            }
        }
        
        return files;
    }
    
    /**
     * Low-level serial operations
     */
    private async sendRaw(data: string): Promise<void> {
        if (!this.port || !this.port.isOpen) {
            throw new Error('Port not open');
        }
        
        return new Promise((resolve, reject) => {
            this.port!.write(data, (error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
    
    private async waitForPrompt(prompt: string, timeout: number): Promise<string> {
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
            const checkForPrompt = () => {
                if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout waiting for prompt: ${prompt}`));
                    return;
                }
                
                if (this.outputBuffer.includes(prompt)) {
                    const output = this.outputBuffer;
                    this.clearOutputBuffer();
                    resolve(output);
                } else {
                    setTimeout(checkForPrompt, 50);
                }
            };
            
            checkForPrompt();
        });
    }
    
    private async waitForRawResponse(timeout: number): Promise<string> {
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
            const checkForEnd = () => {
                if (Date.now() - startTime > timeout) {
                    reject(new Error('Timeout waiting for raw response'));
                    return;
                }
                
                // Raw mode ends with specific sequences
                if (this.outputBuffer.includes('\x04') || 
                    this.outputBuffer.includes('>>>')) {
                    const output = this.outputBuffer;
                    this.clearOutputBuffer();
                    resolve(output);
                } else {
                    setTimeout(checkForEnd, 50);
                }
            };
            
            checkForEnd();
        });
    }
    
    private cleanOutput(output: string): string {
        // Remove REPL prompts and control characters
        return output
            .replace(/>>> /g, '')
            .replace(/\.\.\. /g, '')
            .replace(/\r/g, '')
            .replace(/\x04/g, '')
            .replace(/raw REPL.*?\n/g, '')
            .trim();
    }
    
    private clearOutputBuffer(): void {
        this.outputBuffer = '';
    }
    
    private openPort(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.port) {
                reject(new Error('Port not initialized'));
                return;
            }
            
            this.port.open((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }
    
    private setupEventHandlers(): void {
        if (!this.port) return;
        
        this.port.on('data', (data: Buffer) => {
            const text = data.toString();
            this.outputBuffer += text;
            this._onOutput.fire(text);
        });
        
        this.port.on('error', (error: Error) => {
            this._onError.fire(error.message);
            this.setState(ReplState.Error);
        });
        
        this.port.on('close', () => {
            this.setState(ReplState.Disconnected);
        });
    }
    
    private setState(newState: ReplState): void {
        if (this.state !== newState) {
            this.state = newState;
            this._onStateChanged.fire(newState);
        }
    }
    
    public getState(): ReplState {
        return this.state;
    }
    
    public getCurrentMode(): ReplMode {
        return this.currentMode;
    }
    
    public isConnected(): boolean {
        return this.state === ReplState.Connected || this.state === ReplState.Normal;
    }
    
    public async disconnect(): Promise<void> {
        if (this.port && this.port.isOpen) {
            this.port.close();
        }
        this.setState(ReplState.Disconnected);
    }
    
    public dispose(): void {
        this.disconnect();
        this._onStateChanged.dispose();
        this._onOutput.dispose();
        this._onError.dispose();
    }
}