// src/core/virtualTaskBoard.ts
// Virtual Board using VS Code Tasks and PyScript WASM in background

import * as vscode from 'vscode';
import * as path from 'path';
import { IBoard, BoardType, BoardConnectionState, BoardCapabilities, ExecutionResult, FileInfo, DeviceInfo } from '../boardManager';
import { PythonEnvManager } from '../../sys/pythonEnvManager';

/**
 * Task-based PyScript execution using VS Code Task API
 * Runs PyScript/WASM in background task instead of child processes
 */
class PyScriptTaskExecutor {
    private taskProvider: vscode.Disposable | null = null;
    private activeTask: vscode.TaskExecution | null = null;
    
    constructor(
        private context: vscode.ExtensionContext,
        private boardType: string
    ) {
        this.registerTaskProvider();
    }
    
    private registerTaskProvider(): void {
        this.taskProvider = vscode.tasks.registerTaskProvider('pyscript-wasm', {
            provideTasks: () => {
                return [
                    this.createPyScriptTask('execute'),
                    this.createPyScriptTask('install-packages'),
                    this.createPyScriptTask('setup-blinka')
                ];
            },
            resolveTask: (task) => {
                return task;
            }
        });
    }
    
    private createPyScriptTask(operation: string): vscode.Task {
        const taskDef: vscode.TaskDefinition = {
            type: 'pyscript-wasm',
            operation,
            board: this.boardType
        };
        
        // Use the PyScript task script (we'll create this)
        const scriptPath = path.join(this.context.extensionPath, 'scripts', 'pyscript-task.js');
        
        const task = new vscode.Task(
            taskDef,
            vscode.TaskScope.Workspace,
            `PyScript ${operation}`,
            'pyscript-wasm',
            new vscode.ShellExecution('node', [scriptPath, operation, this.boardType]),
            ['$pyscript-wasm-matcher']
        );
        
        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            echo: false,
            reveal: vscode.TaskRevealKind.Silent,
            focus: false,
            panel: vscode.TaskPanelKind.Dedicated,
            showReuseMessage: false,
            clear: false
        };
        
        return task;
    }
    
    public async executeCode(code: string): Promise<{ success: boolean; output?: string; error?: string }> {
        // Create a temporary file with the code
        const tempDir = path.join(this.context.globalStorageUri.fsPath, 'pyscript-temp');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(tempDir));
        
        const tempFile = path.join(tempDir, `exec_${Date.now()}.py`);
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(tempFile), 
            Buffer.from(code, 'utf8')
        );
        
        // Execute using VS Code task
        const executeTask = this.createExecutionTask(tempFile);
        
        return new Promise((resolve, reject) => {
            vscode.tasks.executeTask(executeTask).then(execution => {
                this.activeTask = execution;
                
                const disposable = vscode.tasks.onDidEndTaskProcess(e => {
                    if (e.execution === execution) {
                        disposable.dispose();
                        
                        // Clean up temp file
                        vscode.workspace.fs.delete(vscode.Uri.file(tempFile));
                        
                        if (e.exitCode === 0) {
                            resolve({ success: true, output: 'Code executed successfully' });
                        } else {
                            resolve({ success: false, error: `Task failed with exit code ${e.exitCode}` });
                        }
                    }
                });
            }).catch(reject);
        });
    }
    
    private createExecutionTask(codeFile: string): vscode.Task {
        const taskDef: vscode.TaskDefinition = {
            type: 'pyscript-wasm',
            operation: 'execute',
            file: codeFile,
            board: this.boardType
        };
        
        const scriptPath = path.join(this.context.extensionPath, 'scripts', 'pyscript-task.js');
        
        return new vscode.Task(
            taskDef,
            vscode.TaskScope.Workspace,
            'Execute PyScript Code',
            'pyscript-wasm',
            new vscode.ShellExecution('node', [scriptPath, 'execute', codeFile, this.boardType]),
            ['$pyscript-wasm-matcher']
        );
    }
    
    public async setupBlinka(): Promise<void> {
        const setupTask = this.createPyScriptTask('setup-blinka');
        const execution = await vscode.tasks.executeTask(setupTask);
        
        return new Promise((resolve, reject) => {
            const disposable = vscode.tasks.onDidEndTaskProcess(e => {
                if (e.execution === execution) {
                    disposable.dispose();
                    if (e.exitCode === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Blinka setup failed with exit code ${e.exitCode}`));
                    }
                }
            });
        });
    }
    
    public dispose(): void {
        if (this.activeTask) {
            this.activeTask.terminate();
        }
        if (this.taskProvider) {
            this.taskProvider.dispose();
        }
    }
}

/**
 * Virtual Board using VS Code Tasks instead of child processes
 * Integrates with your existing DAP/LSP system
 */
export class TaskBasedVirtualBoard implements IBoard {
    private taskExecutor: PyScriptTaskExecutor;
    private _connectionState: BoardConnectionState;
    private replSessions = new Map<string, { created: Date; lastUsed: Date }>();
    private virtualFilesystem = new Map<string, string>();
    
    private _onConnectionStateChanged = new vscode.EventEmitter<BoardConnectionState>();
    private _onFileSystemChanged = new vscode.EventEmitter<{ type: 'created' | 'modified' | 'deleted'; path: string }>();
    private _onReplOutput = new vscode.EventEmitter<{ sessionId: string; output: string; type: 'stdout' | 'stderr' | 'input'; timestamp: Date }>();
    
    public readonly onConnectionStateChanged = this._onConnectionStateChanged.event;
    public readonly onFileSystemChanged = this._onFileSystemChanged.event;
    public readonly onReplOutput = this._onReplOutput.event;
    
    public readonly type: BoardType = 'virtual';
    public readonly capabilities: BoardCapabilities = {
        hasFileSystem: true,
        hasRepl: true,
        supportsDebugging: true,
        supportsFileTransfer: true,
        maxFileSize: 10 * 1024 * 1024
    };
    
    constructor(
        public readonly id: string,
        public readonly name: string,
        private config: {
            boardType: string;
            displayName: string;
            pins: string[];
            interfaces: string[];
        },
        private pythonEnvManager: PythonEnvManager,
        private context: vscode.ExtensionContext
    ) {
        this.taskExecutor = new PyScriptTaskExecutor(context, config.boardType);
        
        this._connectionState = {
            connected: false,
            connecting: false,
            deviceInfo: {
                path: `task-virtual://${config.boardType}`,
                displayName: config.displayName,
                boardId: config.boardType
            }
        };
        
        this.initializeVirtualFileSystem();
    }
    
    public get connectionState(): BoardConnectionState {
        return { ...this._connectionState };
    }
    
    private initializeVirtualFileSystem(): void {
        this.virtualFilesystem.set('/boot_out.txt', 
            `PyScript CircuitPython 8.2.0 on 2023-09-12; ${this.config.displayName} with Task WASM\n`);
        this.virtualFilesystem.set('/code.py', 
            '# Write your CircuitPython code here!\nprint("Hello from Task-based Virtual Board!")\n');
        this.virtualFilesystem.set('/lib/.placeholder', '# CircuitPython libraries\n');
    }
    
    public async connect(): Promise<void> {
        if (this.isConnected()) return;
        
        this.setConnectionState({ connecting: true, connected: false });
        
        try {
            // Setup Blinka using VS Code task instead of child process
            await this.taskExecutor.setupBlinka();
            
            // Verify connection by running a simple test
            await this.verifyConnection();
            
            this.setConnectionState({
                connected: true,
                connecting: false,
                lastConnected: new Date(),
                error: undefined
            });
            
        } catch (error) {
            this.setConnectionState({
                connected: false,
                connecting: false,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    
    private async verifyConnection(): Promise<void> {
        const testCode = `
import board
print("Virtual board connected:", hasattr(board, 'D1') or len(dir(board)) > 5)
        `;
        
        const result = await this.taskExecutor.executeCode(testCode);
        if (!result.success) {
            throw new Error('Failed to verify virtual board connection');
        }
    }
    
    public async disconnect(): Promise<void> {
        try {
            this.taskExecutor.dispose();
            this.replSessions.clear();
            
            this.setConnectionState({
                connected: false,
                connecting: false
            });
        } catch (error) {
            console.error('Error during task-based virtual board disconnect:', error);
        }
    }
    
    public isConnected(): boolean {
        return this._connectionState.connected;
    }
    
    /**
     * Execute code using VS Code tasks (integrates with DAP/LSP)
     */
    public async eval(code: string): Promise<ExecutionResult> {
        if (!this.isConnected()) {
            throw new Error('Task-based virtual board not connected');
        }
        
        const startTime = Date.now();
        
        try {
            // Wrap code with Blinka setup for CircuitPython compatibility
            const wrappedCode = this.wrapForCircuitPython(code);
            
            const result = await this.taskExecutor.executeCode(wrappedCode);
            
            return {
                success: result.success,
                output: result.output,
                error: result.error,
                executionTime: Date.now() - startTime
            };
            
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - startTime
            };
        }
    }
    
    private wrapForCircuitPython(code: string): string {
        return `
# Setup virtual CircuitPython environment using Blinka
import os
os.environ['BLINKA_FORCEBOARD'] = '${this.config.boardType}'
os.environ['BLINKA_FORCECHIP'] = 'GENERIC_LINUX_PC'

try:
    # Import CircuitPython-compatible modules
    import board
    import digitalio
    import analogio
    import busio
    import time
    
    # Execute user code
${code.split('\n').map(line => '    ' + line).join('\n')}
    
except ImportError as e:
    print(f"CircuitPython library not available: {e}")
    print("Install with: pip install adafruit-blinka")
except Exception as e:
    print(f"Execution error: {e}")
        `.trim();
    }
    
    public async executeFile(filePath: string): Promise<ExecutionResult> {
        const content = await this.readFile(filePath);
        return await this.eval(content);
    }
    
    public async interrupt(): Promise<void> {
        // Task termination is handled by the task executor
        if (this.taskExecutor) {
            this.taskExecutor.dispose();
            // Recreate for next execution
            this.taskExecutor = new PyScriptTaskExecutor(this.context, this.config.boardType);
        }
    }
    
    public async restart(): Promise<void> {
        await this.disconnect();
        await this.connect();
        
        this._onFileSystemChanged.fire({
            type: 'modified',
            path: '/'
        });
    }
    
    // File system operations (same virtual filesystem as before)
    public async readFile(path: string): Promise<string> {
        if (!this.isConnected()) {
            throw new Error('Task-based virtual board not connected');
        }
        
        const content = this.virtualFilesystem.get(path);
        if (content === undefined) {
            throw new Error(`File not found: ${path}`);
        }
        return content;
    }
    
    public async writeFile(path: string, content: string): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Task-based virtual board not connected');
        }
        
        const existed = this.virtualFilesystem.has(path);
        this.virtualFilesystem.set(path, content);
        
        this._onFileSystemChanged.fire({
            type: existed ? 'modified' : 'created',
            path
        });
    }
    
    public async listFiles(path: string = '/'): Promise<FileInfo[]> {
        if (!this.isConnected()) {
            throw new Error('Task-based virtual board not connected');
        }
        
        const files: FileInfo[] = [];
        const searchPath = path === '/' ? '' : path;
        
        for (const [filePath, content] of this.virtualFilesystem) {
            if (filePath.startsWith(searchPath)) {
                const relativePath = filePath.substring(searchPath.length);
                const pathParts = relativePath.split('/').filter(part => part.length > 0);
                
                if (pathParts.length === 1) {
                    const name = pathParts[0];
                    if (!files.some(f => f.name === name)) {
                        files.push({
                            name,
                            path: filePath,
                            type: 'file',
                            size: content.length
                        });
                    }
                }
            }
        }
        
        return files.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    public async deleteFile(path: string): Promise<void> {
        if (!this.isConnected()) {
            throw new Error('Task-based virtual board not connected');
        }
        
        if (!this.virtualFilesystem.has(path)) {
            throw new Error(`File not found: ${path}`);
        }
        
        this.virtualFilesystem.delete(path);
        
        this._onFileSystemChanged.fire({
            type: 'deleted',
            path
        });
    }
    
    /**
     * REPL sessions that integrate with your existing LSP client
     */
    public async createReplSession(): Promise<string> {
        if (!this.isConnected()) {
            throw new Error('Task-based virtual board not connected');
        }
        
        const sessionId = `task_repl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.replSessions.set(sessionId, {
            created: new Date(),
            lastUsed: new Date()
        });
        
        return sessionId;
    }
    
    public async sendToRepl(sessionId: string, command: string): Promise<string> {
        if (!this.isConnected()) {
            throw new Error('Task-based virtual board not connected');
        }
        
        const session = this.replSessions.get(sessionId);
        if (!session) {
            throw new Error(`REPL session ${sessionId} not found`);
        }
        
        session.lastUsed = new Date();
        
        try {
            // This integrates with your existing REPL output events
            this._onReplOutput.fire({
                sessionId,
                output: command,
                type: 'input',
                timestamp: new Date()
            });
            
            const result = await this.eval(command);
            
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
    
    private setConnectionState(state: Partial<BoardConnectionState>): void {
        this._connectionState = { ...this._connectionState, ...state };
        this._onConnectionStateChanged.fire(this.connectionState);
    }
    
    public dispose(): void {
        this.disconnect();
        this.taskExecutor.dispose();
        this._onConnectionStateChanged.dispose();
        this._onFileSystemChanged.dispose();
        this._onReplOutput.dispose();
    }
}

/**
 * Factory for Task-based Virtual Boards
 */
export class TaskBasedVirtualBoardFactory {
    static createVirtualBoard(
        boardType: string,
        pythonEnvManager: PythonEnvManager,
        context: vscode.ExtensionContext
    ): TaskBasedVirtualBoard {
        const configs = {
            raspberry_pi_4: {
                boardType: 'raspberry_pi_4',
                displayName: 'Raspberry Pi 4 (Task WASM)',
                pins: ['D2', 'D3', 'D4', 'D17', 'D27', 'D22', 'SDA', 'SCL'],
                interfaces: ['i2c', 'spi', 'uart', 'pwm']
            },
            circuitpython_sim: {
                boardType: 'circuitpython_sim',
                displayName: 'CircuitPython Simulator (Task)',
                pins: ['A0', 'A1', 'A2', 'D0', 'D1', 'D2', 'D3', 'LED'],
                interfaces: ['i2c', 'spi', 'analogio', 'digitalio']
            }
        };
        
        const config = configs[boardType as keyof typeof configs];
        if (!config) {
            throw new Error(`Unknown task-based board type: ${boardType}`);
        }
        
        const boardId = `task-virtual-${boardType}-${Date.now()}`;
        
        return new TaskBasedVirtualBoard(
            boardId,
            config.displayName,
            config,
            pythonEnvManager,
            context
        );
    }
}