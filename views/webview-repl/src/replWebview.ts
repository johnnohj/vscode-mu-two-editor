// File: src/replWebview.ts - WASM-enhanced command-based terminal implementation
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import {ClipboardAddon} from '@xterm/addon-clipboard';
import { CircuitPythonLanguageClient, CompletionItem } from './CircuitPythonLanguageClient';

declare global {
	interface Window {
		terminal?: CommandTerminal;
		acquireVsCodeApi?: () => any;
	}
}

// Get VS Code API - ensure single instance
const vscode = (() => {
	if (typeof window !== 'undefined') {
		// Check if already acquired
		if ((window as any).vscode) {
			return (window as any).vscode;
		}

		// Acquire and store globally
		try {
			const api = window.acquireVsCodeApi();
			(window as any).vscode = api;
			return api;
		} catch (error) {
			console.warn('Failed to acquire VS Code API:', error);
			return null;
		}
	}
	return null;
})();

const _el = document.getElementsByTagName('html')[0];
const vscStyle = _el.style;

interface ExtensionMessage {
  type: 'display' | 'commandHistory' | 'sessionRestore' | 'clear' | 'serialData' | 'serialConnect' | 'serialDisconnect' |
        'runtime.statusUpdate' | 'wasm.initializationStart' | 'wasm.initializationComplete' | 'hardware.stateUpdate' | 'runtime.error' |
        // Phase 4C: CLI Response Messages
        'cli-response' | 'interrupt-ack' | 'restart-ack' | 'task-started' | 'task-ended' | 'task-progress' | 'task-completed' |
        // Unified Terminal Backend
        'venv_ready' | 'venv_progress' | 'pty_ready' | 'terminal_output';
  data: {
    content?: string;
    commands?: string[];
    sessionContent?: string;
    port?: string;
    progress?: number;
    message?: string;
  };
  // WASM-specific properties
  runtime?: 'blinka-python' | 'wasm-circuitpython' | 'pyscript';
  status?: 'disconnected' | 'connecting' | 'connected' | 'error';
  hardwareState?: any;
  success?: boolean;
  error?: string;
  // Phase 4C: CLI and Task properties
  uuid?: string;
  taskId?: string;
  message?: string;
  timestamp?: number;
  processId?: number;
  exitCode?: number;
}

interface TerminalMessage {
  type: 'command' | 'requestHistory' | 'requestRestore' | 'syncContent' |
        'runtime.switch' | 'runtime.connect' | 'runtime.disconnect' |
        // Phase 4C: CLI Command Messages
        'cli-command' | 'keyboard-interrupt' | 'soft-restart' | 'task-status' | 'task-cancel' |
        // PTY Bridge Messages
        'terminal_input';
  data: {
    command?: string;
    historyDirection?: 'up' | 'down';
    terminalContent?: string;
    // PTY Bridge data
    input?: string;
  };
  // Runtime-specific properties
  runtime?: 'blinka-python' | 'wasm-circuitpython' | 'pyscript';
  timestamp?: number;
  // Phase 4C: CLI properties
  uuid?: string;
  args?: string[];
  taskId?: string;
}

class CommandTerminal {
	private terminal: Terminal | null;
	private fitAddon: FitAddon | null;
	private serializeAddon: SerializeAddon | null;
	private vscode: any;
	private languageClient: CircuitPythonLanguageClient | null;
	private state: {
		connected: boolean;
		currentInput: string;
		historyIndex: number;
		commandHistory: string[];
		isInitialized: boolean;
		isFirstContent: boolean;
		tabCompletions: CompletionItem[];
		completionIndex: number;
		originalInput: string;
		// Unified backend state
		deviceConnected: boolean;
		// Phase 4C: Micro-repl patterns
		replState: 'awaiting_venv' | 'idle' | 'executing' | 'waiting_prompt' | 'error';
		commandQueue: Map<string, {resolve: Function, reject: Function, timeout?: number}>;
		sessionActive: boolean;
		// Blinka glyph support
		blinkaGlyphAvailable: boolean;
		fontLoaded: boolean;
		// PTY Bridge state
		ptyMode: boolean;
	};

	constructor() {
		this.terminal = null;
		this.fitAddon = null;
		this.serializeAddon = null;
		this.vscode = vscode;
		this.languageClient = null;
		this.state = {
			connected: false,
			currentInput: '',
			historyIndex: -1,
			commandHistory: [],
			isInitialized: false,
			isFirstContent: true,
			tabCompletions: [],
			completionIndex: -1,
			originalInput: '',
			// Unified backend initialization
			deviceConnected: false,
			// Phase 4C: Micro-repl patterns initialization
			replState: 'awaiting_venv',
			commandQueue: new Map(),
			sessionActive: false,
			// Blinka glyph support initialization
			blinkaGlyphAvailable: false,
			fontLoaded: false,
			// PTY Bridge state
			ptyMode: false
		};

		this.init();
	}

	async init() {
		// Wait for vscode API to be available
		if (!this.vscode) {
			console.error('VSCode API not available');
			return;
		}

		// Phase 4C: Initialize Blinka font detection
		await this.initializeBlinkaFont();

		// Initialize CircuitPython language client for tab completion
		this.languageClient = new CircuitPythonLanguageClient(this.vscode);

		this.setupTerminal();
		this.setupEventListeners();
		this.setupMicroReplPatterns();

		// Send webviewReady message to trigger initial state
		this.sendMessage({
			type: 'webviewReady',
			data: {}
		});

		// Request session restoration
		this.sendMessage({
			type: 'requestRestore',
			data: {}
		});

		// Initial sync after setup
		setTimeout(() => this.syncTerminalContent(), 100);
	}

	/**
	 * Phase 4C: Initialize proper Blinka font detection with xterm.js support
	 */
	private async initializeBlinkaFont(): Promise<void> {
		try {
			// Check if Blinka font is declared in CSS
			const fontFaceRules = Array.from(document.styleSheets)
				.flatMap(sheet => {
					try {
						return Array.from(sheet.cssRules || []);
					} catch (e) {
						return [];
					}
				})
				.filter(rule => rule instanceof CSSFontFaceRule);

			const hasBlinkaFontFace = fontFaceRules.some(rule =>
				rule.style.fontFamily?.includes('FreeMono-Terminal-Blinka')
			);

			if (hasBlinkaFontFace) {
				// Wait for font to load
				await this.waitForFontLoad('FreeMono-Terminal-Blinka');
				this.state.fontLoaded = true;

				// Test if Blinka glyph renders properly
				this.state.blinkaGlyphAvailable = await this.testBlinkaGlyph();
			}

			console.log('Blinka font status:', {
				fontLoaded: this.state.fontLoaded,
				glyphAvailable: this.state.blinkaGlyphAvailable
			});

		} catch (error) {
			console.warn('Blinka font initialization failed:', error);
			this.state.fontLoaded = false;
			this.state.blinkaGlyphAvailable = false;
		}
	}

	/**
	 * Wait for font to load using FontFace API
	 */
	private async waitForFontLoad(fontFamily: string): Promise<boolean> {
		if (!document.fonts) {
			return false;
		}

		try {
			// Wait for font to be ready
			await document.fonts.ready;

			// Check if font is loaded
			const fontFace = Array.from(document.fonts).find(font =>
				font.family === fontFamily || font.family.includes(fontFamily)
			);

			if (fontFace) {
				return fontFace.status === 'loaded';
			}

			// Fallback: try to load font explicitly
			await document.fonts.load(`12px "${fontFamily}"`);
			return true;

		} catch (error) {
			console.warn('Font loading failed:', error);
			return false;
		}
	}

	/**
	 * Test if Blinka glyph (ϴ) renders properly in the font
	 */
	// TODO: Blinka glyph is in the Unicode extended private use - try that sequence
	private async testBlinkaGlyph(): Promise<boolean> {
		try {
			const canvas = document.createElement('canvas');
			const ctx = canvas.getContext('2d');
			if (!ctx) return false;

			canvas.width = 50;
			canvas.height = 30;

			// Test with Blinka font
			ctx.font = '16px FreeMono-Terminal-Blinka, monospace';
			ctx.fillStyle = '#ffffff';
			ctx.fillText('ϴ', 10, 20); // Blinka glyph (U+03F4)

			// Get image data
			const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const data = imageData.data;

			// Check if any pixels are non-transparent (font rendered something)
			for (let i = 3; i < data.length; i += 4) {
				if (data[i] > 0) { // Alpha channel > 0
					return true;
				}
			}

			return false;

		} catch (error) {
			console.warn('Blinka glyph test failed:', error);
			return false;
		}
	}

	/**
	 * Phase 4C: Setup micro-repl patterns for terminal interaction
	 */
	private setupMicroReplPatterns(): void {
		if (!this.terminal) return;

		// Enhanced data handler with micro-repl control character support
		this.terminal.onData((data) => {
			// Handle control characters like micro-repl
			// TODO: Check if user text selection first - don't block Ctrl+C = copy
			if (data === '\x03') { // Ctrl+C
				this.handleKeyboardInterrupt();
				return;
			}
			if (data === '\x04') { // Ctrl+D
				this.handleSoftRestart();
				return;
			}
			if (data === '\x05') { // Ctrl+E (enter paste mode)
				this.enterPasteMode();
				return;
			}

			// Handle regular input with enhanced state management
			this.handleRegularInput(data);
		});

		// Set up command queue cleanup
		setInterval(() => this.cleanupExpiredCommands(), 30000); // Clean up every 30 seconds
	}

	setupTerminal() {
		this.terminal = new Terminal({
			cursorBlink: false,
			cursorStyle: 'block',
			fontSize: 14,
			fontFamily: 'Consolas, "Courier New", monospace',
			scrollback: 1000,
			theme: {
			background: vscStyle.getPropertyValue('--vscode-panel-background') || '#1e1e1e',
			foreground: '#e4e4e4',
			cursor: '#e4e4e4',
			selectionBackground: '#264f78',
			scrollbarSliderBackground: vscStyle.getPropertyValue('--vscode-scrollbarSlider-background') || 'rgba(121, 121, 121, 0.4)',
			scrollbarSliderHoverBackground: vscStyle.getPropertyValue('--vscode-scrollbarSlider-hoverBackground') || 'rgba(100, 100, 100, 0.7)',
			scrollbarSliderActiveBackground: vscStyle.getPropertyValue('--vscode-scrollbarSlider-activeBackground') || 'rgba(191, 191, 191, 0.4)',
			overviewRulerBorder: vscStyle.getPropertyValue('--vscode-scrollbarSlider-background') || 'rgba(121, 121, 121, 0.1)',
			black: "#1E1E1D",
			brightBlack: "#303030",
			red: "#C72C2C",
			brightRed: "#EF0000",
			yellow: "#CCCC5B",
			brightYellow: "#FFFF00",
			green: "#5BCC5B",
			brightGreen: "#72FF72",
			blue: "#5FAFFF",
			brightBlue: "#2AC7FF",
			magenta: "#BC5ED1",
			brightMagenta: "#E572FF",
			cyan: "#5DA5D5",
			brightCyan: "#72F0FF",
			white: "#E4E4E4",
			brightWhite: "#FFFFFF",
			extendedAnsi: {
				orange: "#d27537ff",
				brightOrange: "#F7A500"
			}
			} as any
		});

		this.fitAddon = new FitAddon();
		this.serializeAddon = new SerializeAddon();

		this.terminal.loadAddon(this.fitAddon);
		this.terminal.loadAddon(this.serializeAddon);

		const container = document.getElementById('terminal');
		if (!container) {
			console.error('Terminal container not found! Creating fallback...');
			// Create fallback container
			const fallbackContainer = document.createElement('div');
			fallbackContainer.id = 'terminal';
			document.body.appendChild(fallbackContainer);
			this.terminal.open(fallbackContainer);
		} else {
			console.log('Terminal container found, opening terminal...');
			this.terminal.open(container);
		}

		this.fitAddon.fit();
		console.log('Terminal opened and fitted');

		// Terminal input is handled by setupMicroReplPatterns()

		// Handle key events for special keys
		this.terminal.onKey(({ key, domEvent }) => {
			this.handleKeyEvent(key, domEvent);
		});

		// Handle mouse clicks to prevent clicking in the pre-padded blank area
		this.terminal.element?.addEventListener('click', (event) => {
			this.handleTerminalClick(event);
		});

		// Handle resize
		window.addEventListener('resize', () => {
			if (this.fitAddon) {
				this.fitAddon.fit();
			}
		});

		this.state.isInitialized = true;
	}

	setupEventListeners() {
		// Handle messages from extension
		window.addEventListener('message', event => {
			const message: ExtensionMessage = event.data;
			this.handleExtensionMessage(message);
		});
	}

	handleExtensionMessage(message: ExtensionMessage) {
		console.log('[Webview] Received message:', message);

		switch (message.type) {
			case 'display':
				if (message.data.content) {
					this.writeOutput(message.data.content);
				}
				// Don't call showPrompt() here - the output should already include the next prompt
				// Sync terminal content after display update
				setTimeout(() => this.syncTerminalContent(), 50);
				break;

			case 'clear':
				this.terminal?.clear();
				this.showPrompt();
				// Sync terminal content after clear
				setTimeout(() => this.syncTerminalContent(), 50);
				break;

			case 'sessionRestore':
				if (message.data.sessionContent) {
					this.restoreSession(message.data.sessionContent);
				} else {
					this.showPrompt();
				}
				// Sync terminal content after session restore
				setTimeout(() => this.syncTerminalContent(), 50);
				break;

			case 'commandHistory':
				if (message.data.commands) {
					this.state.commandHistory = message.data.commands;
				}
				break;

			case 'serialConnect':
				this.state.connected = true;
				this.state.deviceConnected = true;
				if (message.data.port) {
					this.writeOutput(`Connected to ${message.data.port}`);
				}
				break;

			case 'serialDisconnect':
				this.state.connected = false;
				this.state.deviceConnected = false;
				this.writeOutput('Disconnected from device');
				break;

			case 'serialData':
				// Handle direct serial communication data
				if (message.data.content) {
					this.writeOutput(message.data.content);
				}
				break;

			// WASM Runtime Messages
			case 'runtime.statusUpdate':
				this.state.runtimeStatus = message.status || 'disconnected';
				if (message.runtime) {
					this.state.currentRuntime = message.runtime;
				}
				this.updatePromptForRuntime();
				break;

			case 'wasm.initializationStart':
				this.state.wasmInitializing = true;
				console.log('\r\n🔧 Initializing WASM CircuitPython runtime...\r\n');
				break;

			case 'wasm.initializationComplete':
				this.state.wasmInitializing = false;
				this.state.runtimeStatus = message.success ? 'connected' : 'error';
				if (message.success) {
					console.log('✅ WASM CircuitPython runtime ready!\r\n');
				} else {
					this.writeOutput('❌ WASM initialization failed\r\n');
				}
				this.showPrompt();
				break;

			case 'hardware.stateUpdate':
				if (message.hardwareState) {
					this.state.hardwareState = message.hardwareState;
					// Could add hardware state change notifications to terminal
				}
				break;

			case 'runtime.error':
				this.state.runtimeStatus = 'error';
				this.writeOutput(`\r\n❌ Runtime Error: ${message.error}\r\n`);
				this.showPrompt();
				break;

			// Phase 4C: CLI Response Messages
			case 'cli-response':
				if (message.uuid) {
					this.handleCLIResponse(message);
				}
				break;

			case 'interrupt-ack':
				this.terminal?.write('\r\nKeyboard interrupt\r\n');
				break;

			case 'restart-ack':
				this.terminal?.write('\r\nSoft restart\r\n');
				this.showPrompt();
				break;

			case 'task-started':
				if (message.taskId) {
					this.terminal?.write(`🚀 Task started: ${message.taskId}\r\n`);
				}
				break;

			case 'task-ended':
				if (message.taskId) {
					this.terminal?.write(`✅ Task completed: ${message.taskId}\r\n`);
				}
				break;

			case 'task-progress':
				this.handleTaskProgress(message);
				break;

			case 'task-completed':
				if (message.taskId) {
					this.terminal?.write(`🎉 Task finished: ${message.taskId}\r\n`);
				}
				break;

			case 'venv_ready':
				// Virtual environment is ready - switch from waiting state to active REPL
				if (this.state.replState === 'awaiting_venv') {
					this.state.replState = 'idle';
					this.terminal?.clear(); // Clear the waiting message
					this.writeOutput('✅ Python virtual environment ready!\r\n');
					this.showPrompt(); // Show the normal prompt
				}
				break;

			case 'pty_ready':
				// PTY-based unified REPL is ready - transition to PTY mode for webview bridge
				if (this.state.replState === 'awaiting_venv') {
					this.state.ptyMode = true;
					this.state.replState = 'idle';
					this.terminal?.clear();

					// Show educational message about dual-mode functionality
					const welcomeMsg = `🐍 Mu Two Editor - Unified REPL

Shell commands (pip, circup, ls) → Python virtual environment
Python REPL commands → CircuitPython device (when connected)

📚 Learning Tip: This REPL is available in TWO ways:
  1. 🎯 Here (beginner-friendly): Centrally located for quick access
  2. 🔧 Native Terminal: Run "Mu 2: Open Mu 2 Shell Terminal" from Command Palette

Each mode gets its own independent session - perfect for running multiple operations!

`;
					this.writeOutput(welcomeMsg);
					// PTY will handle the prompt
				}
				break;

			case 'terminal_output':
				// Display PTY output in webview terminal
				if (this.state.ptyMode && message.data.content) {
					this.terminal?.write(message.data.content);
				}
				break;

			case 'venv_progress':
				// Update venv creation progress bar
				if (this.state.replState === 'awaiting_venv' && message.data.progress !== undefined) {
					this.updateVenvProgress(message.data.progress, message.data.message || '');
				}
				break;
		}
	}

	// Legacy method removed - using micro-repl patterns only

	/**
	 * Phase 4C: Enhanced input handling with micro-repl patterns
	 */
	private handleRegularInput(data: string): void {
		if (!this.terminal) return;

		// If in PTY mode, forward all input to PTY backend
		if (this.state.ptyMode) {
			this.sendMessage({
				type: 'terminal_input',
				data: {
					input: data
				}
			});
			return;
		}

		// Legacy webview input handling for non-PTY mode
		if (data === '\r') {
			// Enter pressed - process command with micro-repl patterns
			this.terminal.writeln('');
			const command = this.state.currentInput.trim();

			if (command.startsWith('mu ')) {
				// CLI command - use promise-based execution
				this.executeCLICommand(command);
			} else {
				// Regular REPL command - use existing execution
				this.executeReplCommand(command);
			}
			this.state.currentInput = '';
		} else if (data === '\x7f' || data === '\b') {
			// Backspace with proper terminal handling
			if (this.state.currentInput.length > 0) {
				this.state.currentInput = this.state.currentInput.slice(0, -1);
				this.terminal.write('\b \b');
			}
		} else if (data.charCodeAt(0) >= 32) {
			// Regular character with state awareness
			this.state.currentInput += data;
			this.terminal.write(data);
		}
	}

	/**
	 * Phase 4C: Promise-based CLI command execution with UUID tracking
	 */
	private async executeCLICommand(command: string): Promise<void> {
		this.addToHistory(command);

		// Generate UUID for command tracking (micro-repl pattern)
		const commandId = this.generateUUID();
		const executionPromise = new Promise<any>((resolve, reject) => {
			this.state.commandQueue.set(commandId, {
				resolve,
				reject,
				timeout: Date.now() + 10000 // 10 second timeout
			});
		});

		// Parse CLI command
		const parts = command.split(/\s+/);
		const cliCommand = parts[1]; // Skip 'mu'
		const args = parts.slice(2);

		// Send to extension with unique ID (micro-repl pattern)
		this.sendMessage({
			type: 'cli-command',
			uuid: commandId,
			data: {
				command: cliCommand
			},
			args: args,
			timestamp: Date.now()
		});

		try {
			this.state.replState = 'executing';
			this.showProcessingIndicator();

			// Wait for response with timeout (micro-repl pattern)
			const result = await Promise.race([
				executionPromise,
				this.createTimeoutPromise(10000) // 10 second timeout
			]);

			this.displayResult(result);
		} catch (error) {
			this.displayError(error);
		} finally {
			this.state.replState = 'idle';
			this.state.commandQueue.delete(commandId);
			this.showPrompt();
		}
	}

	/**
	 * Enhanced REPL command execution
	 */
	private executeReplCommand(command: string): void {
		this.addToHistory(command);

		// Send regular REPL command
		this.sendMessage({
			type: 'command',
			runtime: this.state.currentRuntime || undefined,
			data: {
				command: command
			}
		});
	}

	/**
	 * Phase 4C: Control character handlers
	 */
	private handleKeyboardInterrupt(): void {
		this.terminal?.write('^C\r\n');

		// Clear any pending commands
		this.clearCommandQueue();

		// Send interrupt signal
		const interruptId = this.generateUUID();
		this.sendMessage({
			type: 'keyboard-interrupt',
			uuid: interruptId,
			timestamp: Date.now()
		});

		this.state.replState = 'idle';
		this.showPrompt();
	}

	private handleSoftRestart(): void {
		this.terminal?.write('^D\r\n');

		// Clear state
		this.clearCommandQueue();

		// Send soft restart signal
		const restartId = this.generateUUID();
		this.sendMessage({
			type: 'soft-restart',
			uuid: restartId,
			timestamp: Date.now()
		});

		this.state.replState = 'idle';
	}

	private enterPasteMode(): void {
		this.terminal?.write('^E\r\n');
		this.terminal?.write('paste mode; Ctrl-C to cancel, Ctrl-D to finish\r\n');

		// Could implement multi-line paste mode here
		// For now, just show the message
		this.showPrompt();
	}

	/**
	 * Utility methods for micro-repl patterns
	 */
	private generateUUID(): string {
		return 'xxxx-xxxx-4xxx-yxxx-xxxx'.replace(/[xy]/g, function(c) {
			const r = Math.random() * 16 | 0;
			const v = c === 'x' ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	}

	private createTimeoutPromise(ms: number): Promise<never> {
		return new Promise((_, reject) => {
			setTimeout(() => reject(new Error('Command timeout')), ms);
		});
	}

	private addToHistory(command: string): void {
		if (command.trim() && command !== this.state.commandHistory[this.state.commandHistory.length - 1]) {
			this.state.commandHistory.push(command);
			// Limit history size
			if (this.state.commandHistory.length > 100) {
				this.state.commandHistory.shift();
			}
		}
		this.state.historyIndex = -1;
	}

	private clearCommandQueue(): void {
		// Reject all pending commands
		for (const [id, {reject}] of this.state.commandQueue) {
			reject(new Error('Interrupted'));
		}
		this.state.commandQueue.clear();
	}

	private cleanupExpiredCommands(): void {
		const now = Date.now();
		for (const [id, {timeout, reject}] of this.state.commandQueue) {
			if (timeout && now > timeout) {
				reject(new Error('Command timeout'));
				this.state.commandQueue.delete(id);
			}
		}
	}

	private showProcessingIndicator(): void {
		if (!this.terminal) return;
		this.terminal.write('⏳ Processing...\r\n');
	}

	private displayResult(result: any): void {
		if (!this.terminal) return;

		if (result.success) {
			// Enhanced success display with micro-repl formatting
			this.terminal.write(`\x1b[32m✓\x1b[0m ${result.message || result.data || 'Success'}\r\n`);
		} else {
			this.displayError(result.error || result.message || 'Unknown error');
		}
	}

	private displayError(error: any): void {
		if (!this.terminal) return;

		// Enhanced error display with micro-repl formatting
		this.terminal.write(`\x1b[31m✗\x1b[0m ${error.message || error}\r\n`);
	}

	/**
	 * Phase 4C: Handle CLI response messages
	 */
	private handleCLIResponse(message: ExtensionMessage): void {
		const { uuid, success, data, message: responseMessage, error } = message;

		if (!uuid || !this.state.commandQueue.has(uuid)) {
			return; // Unknown or expired command
		}

		const { resolve } = this.state.commandQueue.get(uuid)!;

		// Resolve the promise with the response
		resolve({
			success,
			data,
			message: responseMessage,
			error
		});
	}

	/**
	 * Handle task progress messages
	 */
	private handleTaskProgress(message: ExtensionMessage): void {
		const { taskId, processId, exitCode } = message;

		if (taskId) {
			let progressMsg = `📊 Task ${taskId}`;
			if (processId) {
				progressMsg += ` (PID: ${processId})`;
			}
			if (exitCode !== undefined) {
				progressMsg += ` exited with code ${exitCode}`;
			}
			this.terminal?.write(`${progressMsg}\r\n`);
		}
	}

	handleKeyEvent(key: string, domEvent: KeyboardEvent) {
		if (!this.terminal) return;

		// Handle Tab key for completion
		if (key === '\t') {
			this.handleTabCompletion();
			domEvent.preventDefault();
			return;
		}

		// Reset tab completion state on any other key
		if (key !== '\t') {
			this.resetTabCompletion();
		}

		// Handle arrow keys for history navigation
		if (key === '\x1b[A') { // Up arrow
			this.navigateHistory('up');
			domEvent.preventDefault();
		} else if (key === '\x1b[B') { // Down arrow
			this.navigateHistory('down');
			domEvent.preventDefault();
		}
	}

	handleEnterKey() {
		if (!this.terminal) return;

		// Move to new line
		this.terminal.writeln('');

		const command = this.state.currentInput.trim();
		if (command) {
			// Send command to extension for processing with runtime context
			this.sendMessage({
				type: 'command',
				runtime: this.state.currentRuntime || undefined,
				data: {
					command: command
				}
			});
		} else {
			// Empty command, just show prompt again
			this.showPrompt();
		}

		// Clear current input
		this.state.currentInput = '';
	}

	handleBackspace() {
		if (!this.terminal || this.state.currentInput.length === 0) return;

		// Remove last character from input and terminal display
		this.state.currentInput = this.state.currentInput.slice(0, -1);
		// Use proper backspace sequence: move left, write space, move left again
		this.terminal.write('\x1b[D \x1b[D');
	}

	navigateHistory(direction: 'up' | 'down') {
		if (!this.terminal || this.state.commandHistory.length === 0) {return};

		let newIndex = this.state.historyIndex;

		if (direction === 'up') {
			newIndex = newIndex < this.state.commandHistory.length - 1 ? newIndex + 1 : newIndex;
		} else {
			newIndex = newIndex > -1 ? newIndex - 1 : -1;
		}

		if (newIndex !== this.state.historyIndex) {
			// Clear current input line
			this.clearCurrentLine();

			this.state.historyIndex = newIndex;

			if (newIndex === -1) {
				// Show empty input
				this.state.currentInput = '';
				// Show prompt and position cursor properly
				const prompt = this.state.connected ? '>>> ' : 'mu2> ';
				const colorizedPrompt = `\x1b[38;2;210;117;55m${prompt}\x1b[0m`;
				this.terminal.write(colorizedPrompt);
			} else {
				// Show command from history
				const command = this.state.commandHistory[this.state.commandHistory.length - 1 - newIndex];
				this.state.currentInput = command;
				// Show prompt and command, cursor will be positioned after the command
				const prompt = this.state.connected ? '>>> ' : 'mu2> ';
				const colorizedPrompt = `\x1b[38;2;210;117;55m${prompt}\x1b[0m`;
				this.terminal.write(colorizedPrompt + command);
			}
		}
	}

	clearCurrentLine() {
		if (!this.terminal) return;

		// Move cursor to start of line and clear to end of line
		this.terminal.write('\r\x1b[2K');
	}

	writeOutput(content: string) {
		if (!this.terminal) return;

		// Replace \n with \r\n for proper terminal display
		const normalizedContent = content.replace(/\n/g, '\r\n');

		// Colorize backend output using terminal's orange color
		// Use ANSI 38;2;R;G;B for RGB color matching terminal theme
		const colorizedContent = `\x1b[38;2;210;117;55m${normalizedContent}\x1b[0m`;

		this.terminal.write(colorizedContent);
	}

	private insertBlankLinesAtTop(lineCount: number) {
		if (!this.terminal) return;

		// Move cursor to top and insert blank lines
		this.terminal.write('\x1b[H'); // Move cursor to home position (1,1)

		// Insert lines using xterm.js sequence - this pushes existing content down
		for (let i = 0; i < lineCount; i++) {
			this.terminal.write('\x1b[L'); // Insert line (pushes content down)
		}

		// Move cursor back to home position for content writing
		this.terminal.write('\x1b[H');
	}

	showPrompt() {
		if (!this.terminal) return;

		const prompt = this.getPromptForCurrentRuntime();

		// Colorize prompt using terminal's orange color to match backend output
		const colorizedPrompt = `\x1b[38;2;210;117;55m${prompt}\x1b[0m`;

		// Write newline and prompt, cursor will naturally position after prompt
		this.terminal.write('\r\n' + colorizedPrompt);

		// Add padding below the prompt to create buffer zone
		this.addPaddingBelowPrompt();
	}

	/**
	 * Show message about PTY terminal being ready
	 */
	private showPtyTerminalMessage(terminalId: string): void {
		if (!this.terminal) return;

		this.terminal.clear();

		const message = `🚀 Unified REPL Ready!

The Mu Two Editor unified REPL is now running in a native VS Code terminal.

📍 Terminal Name: "${terminalId}"
📍 Location: Terminal panel (View → Terminal)

✨ Features:
• Shell commands (pip, circup, ls) → Python virtual environment
• Python/CircuitPython code → Device communication
• Native terminal experience with history, copy/paste, etc.

💡 You can use either:
   1. This webview terminal (below)
   2. The native VS Code terminal "${terminalId}"

Both are connected to the same unified REPL backend!
`;

		this.writeOutput(message + '\r\n\r\n');
		this.writeOutput('🎯 Try: pip --version\r\n\r\n');

		// Transition to normal REPL state
		this.state.replState = 'idle';
		this.showPrompt();
	}

	/**
	 * Update virtual environment setup progress with visual progress bar
	 */
	private updateVenvProgress(progress: number, message: string): void {
		if (!this.terminal) return;

		// Move to the beginning of the progress area (2 lines below "Awaiting...")
		this.terminal.write('\r\n\x1b[2K'); // New line and clear line

		// Draw progress bar using ASCII characters
		const barWidth = 40;
		const filled = Math.round((progress / 100) * barWidth);
		const empty = barWidth - filled;

		const filledBar = '█'.repeat(filled);
		const emptyBar = '░'.repeat(empty);

		// Use orange color to match terminal theme
		const progressLine = `\x1b[38;2;210;117;55m[${filledBar}${emptyBar}] ${progress}%\x1b[0m`;

		// Write progress bar and message
		this.terminal.write(progressLine + '\r\n');
		this.terminal.write(`\x1b[38;2;210;117;55m${message}\x1b[0m`);

		// Move cursor back up to keep it positioned correctly
		this.terminal.write('\x1b[2A'); // Move up 2 lines
	}

	/**
	 * Phase 4C: Enhanced state-aware prompt with proper Blinka glyph support
	 */
	private getPromptForCurrentRuntime(): string {
		// Use proper Blinka glyph detection results
		const blinkaGlyph = this.state.blinkaGlyphAvailable ? 'ϴ' : '🐍';

		// Micro-repl style dynamic prompts based on state
		switch (this.state.replState) {
			case 'awaiting_venv':
				return 'Awaiting virtual environment confirmation...';
			case 'executing':
				return '... ';
			case 'waiting_prompt':
				return '>>> ';
			case 'error':
				return '!!! ';
			default:
				break;
		}

		// Unified prompt based on device connection
		if (this.state.deviceConnected) {
			return `>>> `; // Device connected - CircuitPython REPL
		} else {
			return `mu2> `; // Shell mode - pip, circup, etc.
		}
	}

	private updatePromptForRuntime(): void {
		// Update the current prompt display if needed
		// This can be expanded to update the terminal prompt dynamically
	}

	private writeCircuitPythonHelp(): void {
		if (!this.terminal) return;

		// Use proper Blinka glyph detection
		const logo = this.state.blinkaGlyphAvailable ? 'ϴ' : '🐍⚡';

		const welcomeMessage = `
    ${logo} CircuitPython ${this.getCircuitPythonVersion()} on WASM Virtual Hardware ${logo}

╭─────────────────── MU 2 REPL with WASM Backend ───────────────────╮
│                                                                    │
│  💻 Virtual Hardware Simulation: ✅ ACTIVE                        │
│  🔌 GPIO Pins: board.D0-D13, board.A0-A5                         │
│  📊 Sensors: accelerometer, temperature, light                    │
│  ⚡ Real-time Hardware Monitoring: ENABLED                        │
│                                                                    │
│  🚀 Quick Start Commands:                                         │
│     import board, digitalio, time                                 │
│     led = digitalio.DigitalInOut(board.D13)                       │
│     led.direction = digitalio.Direction.OUTPUT                    │
│     led.value = True                                              │
│                                                                    │
│  🔧 Runtime Commands:                                             │
│     which --runtime    # Show current runtime                     │
│     switch -r wasm     # Switch to WASM runtime                   │
│     help               # Show all available commands              │
│                                                                    │
╰────────────────────────────────────────────────────────────────────╯

Ready for CircuitPython magic! ✨
`;
		this.writeOutput(welcomeMessage);
	}

	// Legacy detectBlinkaFont method removed - using proper Phase 4C font detection

	private getCircuitPythonVersion(): string {
		// Could be dynamically fetched from WASM runtime
		return 'wasm';
	}

	private addPaddingBelowPrompt() {
		if (!this.terminal) return;

		// Save current cursor position (after prompt)
		this.terminal.write('\x1b[s'); // Save cursor position

		// Add blank lines below the prompt
		this.terminal.write('\r\n\r\n\r\n\r\n');

		// Restore cursor to original position (right after prompt)
		this.terminal.write('\x1b[u'); // Restore cursor position
	}

	private addSmartOverscrollPadding() {
		if (!this.terminal) return;

		// Get terminal state
		const viewportHeight = this.terminal.rows;
		const currentRow = this.terminal.buffer.active.cursorY;
		const buffer = this.terminal.buffer.active;
		const totalLines = buffer.length;

		// Calculate how much content exists above the current prompt
		const contentAbovePrompt = currentRow;

		// Only add overscroll padding if:
		// 1. We have significant content above (welcome message + some history)
		// 2. We're not already at the bottom causing auto-scroll
		// 3. There's room to add padding without triggering scroll

		const hasSignificantContent = contentAbovePrompt >= 3; // At least welcome message
		const distanceFromBottom = viewportHeight - currentRow - 1;
		const canAddPaddingWithoutScroll = distanceFromBottom >= 2;

		if (hasSignificantContent && canAddPaddingWithoutScroll) {
			// Add conservative padding - just 1-2 lines to enable scroll-up UX
			const paddingLines = Math.min(2, distanceFromBottom - 1);

			if (paddingLines > 0) {
				// Save current cursor position
				this.terminal.write('\x1b[s'); // Save cursor position

				// Add minimal padding lines
				for (let i = 0; i < paddingLines; i++) {
					this.terminal.write('\r\n');
				}

				// Restore cursor to original position (right after prompt)
				this.terminal.write('\x1b[u'); // Restore cursor position
			}
		}

		// If conditions aren't met, no padding is added - natural terminal behavior
	}

	restoreSession(sessionContent: string) {
		if (!this.terminal) return;

		// Clear terminal and write session content
		this.terminal.clear();
		this.writeOutput(sessionContent);

		// Don't show prompt after restoration - let extension handle it
	}

	sendMessage(message: TerminalMessage) {
		if (this.vscode) {
			this.vscode.postMessage(message);
		}
	}

	handleTerminalClick(event: MouseEvent) {
		if (!this.terminal) return;

		// With post-welcome padding, we don't need to prevent clicks in blank areas
		// The blank lines are below the content and users naturally can't interact there
		// This method can be expanded later if needed for other click constraints
	}

	// Sync complete terminal content with extension (maintains 1:1 mapping per spec)
	syncTerminalContent() {
		if (this.serializeAddon && this.vscode) {
			const terminalContent = this.serializeAddon.serialize();
			this.sendMessage({
				type: 'syncContent',
				data: {
					terminalContent: terminalContent
				}
			});
		}
	}

	// Public API methods
	public clear() {
		if (this.terminal) {
			this.terminal.clear();
		}
	}

	public focus() {
		if (this.terminal) {
			this.terminal.focus();
		}
	}

	public resize() {
		if (this.fitAddon) {
			this.fitAddon.fit();
		}
	}

	public getFitAddon() {
		return this.fitAddon;
	}

	// Tab completion methods
	async handleTabCompletion() {
		if (!this.languageClient || !this.terminal) {
			return;
		}

		// If we're already cycling through completions, show next one
		if (this.state.tabCompletions.length > 0) {
			this.cycleCompletion();
			return;
		}

		// Get completions for current input
		const currentInput = this.state.currentInput;
		const cursorPosition = currentInput.length;

		try {
			const completions = await this.languageClient.getCompletions(currentInput, cursorPosition);

			if (completions.length === 0) {
				// No completions available, maybe show a subtle indication
				return;
			}

			// Store completions for cycling
			this.state.tabCompletions = completions;
			this.state.completionIndex = 0;
			this.state.originalInput = currentInput;

			// Show first completion
			this.showCompletion(completions[0]);

		} catch (error) {
			console.error('Error getting tab completions:', error);
		}
	}

	cycleCompletion() {
		if (this.state.tabCompletions.length === 0) {
			return;
		}

		// Move to next completion (wrap around)
		this.state.completionIndex = (this.state.completionIndex + 1) % this.state.tabCompletions.length;
		const completion = this.state.tabCompletions[this.state.completionIndex];

		this.showCompletion(completion);
	}

	showCompletion(completion: CompletionItem) {
		if (!this.terminal) return;

		// Clear current input from terminal
		this.clearCurrentInput();

		// Determine what to insert
		const insertText = completion.insertText || completion.label;

		// Update state and display
		this.state.currentInput = this.getCompletionInput(insertText);
		this.terminal.write(this.state.currentInput);
	}

	clearCurrentInput() {
		if (!this.terminal) return;

		// Move cursor back to beginning of current input
		const inputLength = this.state.currentInput.length;
		if (inputLength > 0) {
			// Move cursor back
			this.terminal.write('\x1b[' + inputLength + 'D');
			// Clear from cursor to end of line
			this.terminal.write('\x1b[K');
		}
	}

	getCompletionInput(insertText: string): string {
		// For simple cases, we can just use the insert text
		// In more complex cases, we might need to parse the current input
		// and replace only the relevant part
		const currentInput = this.state.originalInput || this.state.currentInput;

		// Find the last word/identifier to replace
		const match = currentInput.match(/.*[.\s](\w*)$/);
		if (match) {
			// Replace the last partial word
			const prefix = currentInput.substring(0, currentInput.length - match[1].length);
			return prefix + insertText;
		}

		// If no partial word found, check if we're at module level
		const moduleMatch = currentInput.match(/^(\w*)$/);
		if (moduleMatch) {
			return insertText;
		}

		// Default: append the completion
		return currentInput + insertText;
	}

	resetTabCompletion() {
		this.state.tabCompletions = [];
		this.state.completionIndex = -1;
		this.state.originalInput = '';
	}

	// Dispose method to clean up language client
	dispose() {
		if (this.languageClient) {
			this.languageClient.dispose();
			this.languageClient = null;
		}
	}
}

// Initialize terminal and WASM UI when DOM is ready
function initializeComponents() {
	console.log('Initializing webview components...');

	// Initialize terminal directly with unified backend
	setTimeout(() => {
		console.log('Initializing terminal...');
		window.terminal = new CommandTerminal();
		console.log('Terminal initialized:', !!window.terminal);
	}, 100);
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeComponents);
} else {
	initializeComponents();
}

// Export for module systems
export { CommandTerminal };