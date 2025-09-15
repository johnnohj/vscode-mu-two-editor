// File: src/replWebview.ts - Command-based terminal implementation
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

// Get VS Code API
const vscode = typeof window !== 'undefined' && window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;

const _el = document.getElementsByTagName('html')[0];
const vscStyle = _el.style;

interface ExtensionMessage {
  type: 'display' | 'commandHistory' | 'sessionRestore' | 'clear' | 'serialData' | 'serialConnect' | 'serialDisconnect';
  data: {
    content?: string;
    commands?: string[];
    sessionContent?: string;
    port?: string;
  };
}

interface TerminalMessage {
  type: 'command' | 'requestHistory' | 'requestRestore' | 'syncContent';
  data: {
    command?: string;
    historyDirection?: 'up' | 'down';
    terminalContent?: string;
  };
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
			originalInput: ''
		};
		
		this.init();
	}

	async init() {
		// Wait for vscode API to be available
		if (!this.vscode) {
			console.error('VSCode API not available');
			return;
		}
		
		// Initialize CircuitPython language client for tab completion
		this.languageClient = new CircuitPythonLanguageClient(this.vscode);
		
		this.setupTerminal();
		this.setupEventListeners();
		
		// Request session restoration
		this.sendMessage({
			type: 'requestRestore',
			data: {}
		});
		
		// Initial sync after setup
		setTimeout(() => this.syncTerminalContent(), 100);
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
		this.terminal.open(container!);
		this.fitAddon.fit();

		// Handle terminal input - capture complete lines instead of individual keystrokes
		this.terminal.onData((data) => {
			this.handleTerminalInput(data);
		});

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
				this.showPrompt();
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
				if (message.data.port) {
					this.writeOutput(`Connected to ${message.data.port}`);
				}
				break;
				
			case 'serialDisconnect':
				this.state.connected = false;
				this.writeOutput('Disconnected from device');
				break;
				
			case 'serialData':
				// Handle direct serial communication data
				if (message.data.content) {
					this.writeOutput(message.data.content);
				}
				break;
		}
	}

	handleTerminalInput(data: string) {
		if (!this.terminal) {return};

		const char = data.charCodeAt(0);
		
		// Handle special characters
		if (char === 13) { // Enter key
			this.handleEnterKey();
		} else if (char === 127 || char === 8) { // Backspace/Delete
			this.handleBackspace();
		} else if (char === 27) { // Escape sequences (arrow keys, etc.)
			// For now, ignore escape sequences - they're handled in handleKeyEvent
			return;
		} else {
			// Regular character input
			this.state.currentInput += data;
			this.terminal.write(data);
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
			// Send command to extension for processing
			this.sendMessage({
				type: 'command',
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
				this.terminal.write(prompt);
			} else {
				// Show command from history
				const command = this.state.commandHistory[this.state.commandHistory.length - 1 - newIndex];
				this.state.currentInput = command;
				// Show prompt and command, cursor will be positioned after the command
				const prompt = this.state.connected ? '>>> ' : 'mu2> ';
				this.terminal.write(prompt + command);
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
		this.terminal.write(normalizedContent);
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
		
		const prompt = this.state.connected ? '>>> ' : 'mu2> ';
		
		// Write newline and prompt, cursor will naturally position after prompt
		this.terminal.write('\r\n' + prompt);
		
		// Add padding below the prompt to create buffer zone
		this.addPaddingBelowPrompt();
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

// Initialize terminal when DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', () => {
		window.terminal = new CommandTerminal();
	});
} else {
	window.terminal = new CommandTerminal();
}

// Export for module systems
export { CommandTerminal };