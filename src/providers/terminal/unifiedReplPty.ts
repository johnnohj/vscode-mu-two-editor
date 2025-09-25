import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { getLogger } from '../../utils/unifiedLogger';

/**
 * Unified REPL Pseudoterminal
 *
 * This PTY implementation provides the intelligent backend for the unified REPL.
 * It handles:
 * - Shell command routing (pip, circup, ls, etc.) → Python venv environment
 * - Device command routing (Python REPL) → CircuitPython device communication
 * - Natural terminal input/output behavior
 * - Proper environment variable handling
 */
export class UnifiedReplPty implements vscode.Pseudoterminal {
    private writeEmitter = new vscode.EventEmitter<string>();
    private closeEmitter = new vscode.EventEmitter<number | void>();

    onDidWrite: vscode.Event<string> = this.writeEmitter.event;
    onDidClose: vscode.Event<number | void> = this.closeEmitter.event;

    private logger = getLogger();
    private extensionContext: vscode.ExtensionContext;
    private currentLine = '';
    private cursorPosition = 0;
    private commandHistory: string[] = [];
    private historyIndex = -1;

    // State management
    private deviceConnected = false;
    private replState: 'idle' | 'executing' | 'device_mode' = 'idle';

    constructor(extensionContext: vscode.ExtensionContext) {
        this.extensionContext = extensionContext;
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this.logger.info('PTY', 'UnifiedReplPty opened');

        // Show welcome message and initial prompt
        this.writeWelcomeMessage();
        this.showPrompt();
    }

    close(): void {
        this.logger.info('PTY', 'UnifiedReplPty closed');
        this.closeEmitter.fire();
    }

    handleInput(data: string): void {
        // Handle special keys first
        if (data === '\r') { // Enter
            this.handleEnterKey();
        } else if (data === '\x7f' || data === '\b') { // Backspace
            this.handleBackspace();
        } else if (data === '\x1b[A') { // Up arrow
            this.navigateHistory('up');
        } else if (data === '\x1b[B') { // Down arrow
            this.navigateHistory('down');
        } else if (data === '\x1b[C') { // Right arrow
            this.moveCursor('right');
        } else if (data === '\x1b[D') { // Left arrow
            this.moveCursor('left');
        } else if (data === '\x03') { // Ctrl+C
            this.handleInterrupt();
        } else if (data === '\x04') { // Ctrl+D
            this.handleEOF();
        } else if (data.charCodeAt(0) >= 32) { // Printable character
            this.insertCharacter(data);
        }
    }

    /**
     * Display welcome message
     */
    private writeWelcomeMessage(): void {
        const welcomeMsg = `\r\n🐍 Mu Two Editor - Unified REPL\r\n`;
        const infoMsg = `Shell commands (pip, circup, ls) → Python venv\r\n`;
        const deviceMsg = `Python REPL commands → CircuitPython device (when connected)\r\n\r\n`;

        this.writeEmitter.fire(welcomeMsg + infoMsg + deviceMsg);
    }

    /**
     * Show appropriate prompt based on state
     */
    private showPrompt(): void {
        let prompt: string;

        if (this.deviceConnected) {
            prompt = '\x1b[32mϴ>>\x1b[0m '; // Green CircuitPython prompt
        } else {
            prompt = '\x1b[33mmuϴ>\x1b[0m '; // Yellow shell prompt
        }

        this.writeEmitter.fire(`\r\n${prompt}`);
    }

    /**
     * Handle Enter key - execute command
     */
    private async handleEnterKey(): Promise<void> {
        if (this.currentLine.trim()) {
            this.addToHistory(this.currentLine.trim());
            await this.executeCommand(this.currentLine.trim());
        }

        this.currentLine = '';
        this.cursorPosition = 0;
        this.showPrompt();
    }

    /**
     * Execute command based on routing logic
     */
    private async executeCommand(command: string): Promise<void> {
        this.writeEmitter.fire('\r\n'); // Move to new line

        if (this.isShellCommand(command)) {
            await this.executeShellCommand(command);
        } else {
            await this.executeDeviceCommand(command);
        }
    }

    /**
     * Check if command should go to shell vs device
     */
    private isShellCommand(command: string): boolean {
        const shellCommands = ['pip', 'circup', 'ls', 'dir', 'cd', 'python', 'mu', 'help', 'clear'];
        const firstWord = command.trim().split(' ')[0].toLowerCase();
        return shellCommands.includes(firstWord);
    }

    /**
     * Execute shell command in Python venv environment
     */
    private async executeShellCommand(command: string): Promise<void> {
        this.replState = 'executing';

        try {
            // Handle special commands first
            if (command.toLowerCase() === 'clear') {
                this.writeEmitter.fire('\x1b[2J\x1b[H'); // Clear screen and move cursor home
                return;
            }

            if (command.toLowerCase() === 'help') {
                this.showHelpMessage();
                return;
            }

            // Execute in venv environment
            const output = await this.runCommandInVenv(command);
            this.writeEmitter.fire(output);

        } catch (error) {
            this.writeEmitter.fire(`\x1b[31mError: ${error}\x1b[0m`);
        } finally {
            this.replState = 'idle';
        }
    }

    /**
     * Execute Python/device command
     */
    private async executeDeviceCommand(command: string): Promise<void> {
        this.replState = 'device_mode';

        if (!this.deviceConnected) {
            this.writeEmitter.fire(`\x1b[33mNo CircuitPython device connected. Trying to execute locally...\x1b[0m\r\n`);
            // Could fall back to local Python execution in venv
            await this.executeShellCommand(`python -c "${command}"`);
        } else {
            // TODO: Send to actual CircuitPython device
            this.writeEmitter.fire(`\x1b[36m[Device]: ${command}\x1b[0m\r\n`);
            this.writeEmitter.fire(`\x1b[90m(CircuitPython device communication not yet implemented)\x1b[0m`);
        }

        this.replState = 'idle';
    }

    /**
     * Run command in Python virtual environment
     */
    private async runCommandInVenv(command: string): Promise<string> {
        return new Promise((resolve) => {
            const venvPath = this.extensionContext.globalStorageUri.with({
                path: this.extensionContext.globalStorageUri.path + '/venv'
            }).fsPath;

            const env = {
                ...process.env,
                VIRTUAL_ENV: venvPath,
                PATH: this.getVenvPATH(venvPath)
            };

            // Parse command
            const [cmd, ...args] = command.split(' ');

            const child = spawn(cmd, args, {
                env,
                shell: true,
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
            });

            let output = '';

            child.stdout?.on('data', (data) => {
                output += data.toString();
            });

            child.stderr?.on('data', (data) => {
                output += `\x1b[31m${data.toString()}\x1b[0m`; // Red for stderr
            });

            child.on('close', (code) => {
                if (code !== 0 && !output) {
                    output = `\x1b[31mCommand failed with exit code: ${code}\x1b[0m`;
                }
                resolve(output || '\x1b[32m✓\x1b[0m'); // Green checkmark for silent success
            });

            child.on('error', (error) => {
                resolve(`\x1b[31mError executing command: ${error.message}\x1b[0m`);
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                child.kill('SIGTERM');
                resolve(`\x1b[31mCommand timed out after 30 seconds\x1b[0m`);
            }, 30000);
        });
    }

    /**
     * Get Python virtual environment PATH
     */
    private getVenvPATH(venvPath: string): string {
        const venvBin = process.platform === 'win32' ? `${venvPath}\\Scripts` : `${venvPath}/bin`;
        const separator = process.platform === 'win32' ? ';' : ':';
        return `${venvBin}${separator}${process.env.PATH}`;
    }

    /**
     * Show help message
     */
    private showHelpMessage(): void {
        const helpMsg = `
\x1b[1mMu Two Editor - Unified REPL Commands:\x1b[0m

\x1b[33mShell Commands:\x1b[0m
  pip --version          Check pip version
  pip install <package>  Install Python package
  circup install <lib>   Install CircuitPython library
  ls / dir              List files
  clear                 Clear terminal
  help                  Show this help

\x1b[32mPython/Device Commands:\x1b[0m
  import board          CircuitPython imports
  print("hello")        Python code execution

\x1b[36mControl Keys:\x1b[0m
  Ctrl+C                Interrupt current command
  Ctrl+D                EOF (exit)
  ↑/↓                   Command history
`;
        this.writeEmitter.fire(helpMsg);
    }

    // Input handling helpers
    private handleBackspace(): void {
        if (this.cursorPosition > 0) {
            this.currentLine = this.currentLine.slice(0, this.cursorPosition - 1) +
                              this.currentLine.slice(this.cursorPosition);
            this.cursorPosition--;
            this.redrawLine();
        }
    }

    private insertCharacter(char: string): void {
        this.currentLine = this.currentLine.slice(0, this.cursorPosition) +
                          char +
                          this.currentLine.slice(this.cursorPosition);
        this.cursorPosition++;
        this.writeEmitter.fire(char);
    }

    private moveCursor(direction: 'left' | 'right'): void {
        if (direction === 'left' && this.cursorPosition > 0) {
            this.cursorPosition--;
            this.writeEmitter.fire('\x1b[D'); // Move cursor left
        } else if (direction === 'right' && this.cursorPosition < this.currentLine.length) {
            this.cursorPosition++;
            this.writeEmitter.fire('\x1b[C'); // Move cursor right
        }
    }

    private redrawLine(): void {
        // Clear line and redraw
        this.writeEmitter.fire('\r\x1b[K'); // Clear line
        const prompt = this.deviceConnected ? '\x1b[32mϴ>>\x1b[0m ' : '\x1b[33mmuϴ>\x1b[0m ';
        this.writeEmitter.fire(prompt + this.currentLine);

        // Move cursor to correct position
        const targetPos = this.cursorPosition;
        const currentPos = this.currentLine.length;
        if (targetPos < currentPos) {
            this.writeEmitter.fire(`\x1b[${currentPos - targetPos}D`);
        }
    }

    private navigateHistory(direction: 'up' | 'down'): void {
        if (this.commandHistory.length === 0) return;

        if (direction === 'up') {
            this.historyIndex = Math.min(this.historyIndex + 1, this.commandHistory.length - 1);
        } else {
            this.historyIndex = Math.max(this.historyIndex - 1, -1);
        }

        if (this.historyIndex >= 0) {
            this.currentLine = this.commandHistory[this.commandHistory.length - 1 - this.historyIndex];
        } else {
            this.currentLine = '';
        }

        this.cursorPosition = this.currentLine.length;
        this.redrawLine();
    }

    private addToHistory(command: string): void {
        // Don't add duplicates or empty commands
        if (command && command !== this.commandHistory[this.commandHistory.length - 1]) {
            this.commandHistory.push(command);
            // Limit history size
            if (this.commandHistory.length > 100) {
                this.commandHistory.shift();
            }
        }
        this.historyIndex = -1;
    }

    private handleInterrupt(): void {
        this.writeEmitter.fire('\r\n^C\r\n');
        this.currentLine = '';
        this.cursorPosition = 0;
        this.replState = 'idle';
        this.showPrompt();
    }

    private handleEOF(): void {
        if (this.currentLine === '') {
            this.writeEmitter.fire('\r\n^D\r\n');
            this.close();
        }
    }

    /**
     * Set device connection state
     */
    public setDeviceConnected(connected: boolean): void {
        this.deviceConnected = connected;
        if (connected) {
            this.writeEmitter.fire(`\r\n\x1b[32m✓ CircuitPython device connected\x1b[0m`);
        } else {
            this.writeEmitter.fire(`\r\n\x1b[33m○ CircuitPython device disconnected\x1b[0m`);
        }
        this.showPrompt();
    }
}