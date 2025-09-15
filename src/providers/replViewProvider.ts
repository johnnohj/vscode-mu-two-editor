import * as vscode from 'vscode';
// import { HybridTerminalManager, HybridTerminalInstance } from './hybridTerminalManager'; // File deleted
import { UnifiedDebugManager } from '../../sys/unifiedDebugManager';
import { BoardManager, IBoard } from '../../sys/boardManager';
import { MuTwoLanguageClient } from '../../interface/client';
import { WorkspaceValidator, DeviceConnectionPermissions } from '../../workspace/workspaceValidator';
import { MuTwoWorkspaceManager } from '../../workspace/workspaceManager';
import { IDevice } from '../../devices/deviceDetector';
import { TerminalHistoryManager } from '../../interface/historyManager';
// import { HeadlessTerminalProcessor, TerminalState } from './headlessTerminalProcessor'; // File deleted
import { getNonce } from '../../sys/utils/webview';
import { LanguageServiceBridge } from './language/core/LanguageServiceBridge';

/**
 * REPL View Provider with Hybrid PTY Backend support
 * 
 * This provider works to:
 * - Use PTY backend for heavy processing (30-40% memory reduction)
 * - Maintain webview UX for interactive features
 * - Provide progressive enhancement with fallback options
 * - Coordinate with Unified Debug Manager
 */
export class ReplViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'muTwo.replView';
	
	private extensionUri: vscode.Uri;
	private extensionContext: vscode.ExtensionContext;
	private workspaceValidator: WorkspaceValidator;
	private workspaceManager: MuTwoWorkspaceManager;
	private historyManager: TerminalHistoryManager;
	private boardManager?: BoardManager;
	
	private deviceConnectionEnabled: boolean = true;
	private view?: vscode.WebviewView;
	private isWebviewReady = false;
	private currentDevice?: IDevice;
	private hybridModeEnabled: boolean = true;
	private currentHybridInstance?: HybridTerminalInstance;
	private hybridTerminalManager?: HybridTerminalManager;
	private languageServiceBridge: LanguageServiceBridge;

	constructor(
		extensionUri: vscode.Uri,
		extensionContext: vscode.ExtensionContext
	) {
		this.extensionUri = extensionUri;
		this.extensionContext = extensionContext;
		
		// Access services on-demand via global exports from extension.ts
		this.workspaceValidator = new WorkspaceValidator(extensionContext);
		this.workspaceManager = new MuTwoWorkspaceManager(extensionContext);
		this.historyManager = new TerminalHistoryManager(extensionContext);
		
		// Initialize CircuitPython language service for REPL completions
		this.languageServiceBridge = new LanguageServiceBridge({
			enableDiagnostics: false, // Disable for REPL - too noisy
			enableCompletions: true,
			enableHover: true,
			enableSignatureHelp: true,
			defaultBoard: 'circuitplayground_express' // TODO: Get from device detection
		});
		
		// Initialize hybrid terminal manager if available
		try {
			this.hybridTerminalManager = new HybridTerminalManager();
			this.loadHybridConfiguration();
		} catch (error) {
			console.warn('Hybrid terminal manager not available:', error);
			this.hybridModeEnabled = false;
		}
		
		// Initialize headless processor
		this.headlessProcessor = new HeadlessTerminalProcessor();
		
		// Simplified initialization - removed complex dependencies
		console.log('REPL View Provider initialized with simplified architecture');
	}

	/**
	 * Set board manager after construction (called from extension.ts)
	 */
	public setBoardManager(boardManager: BoardManager): void {
		this.boardManager = boardManager;
		this.setupBoardEventForwarding();
	}

	private setupBoardEventForwarding(): void {
		if (!this.boardManager) return;
		
		this.boardManager.onBoardAdded((board) => {
			this.sendMessage({
				type: 'boardAdded',
				data: this.serializeBoardForWebview(board)
			});
		});
		
		this.boardManager.onBoardRemoved((board) => {
			this.sendMessage({
				type: 'boardRemoved',
				data: { id: board.id }
			});
		});
		
		this.boardManager.onBoardConnectionChanged(({ board, state }) => {
			this.sendMessage({
				type: 'boardConnectionChanged',
				data: {
					boardId: board.id,
					connectionState: state
				}
			});
		});
	}

	private serializeBoardForWebview(board: IBoard) {
		return {
			id: board.id,
			name: board.name,
			type: board.type,
			connected: board.isConnected(),
			connectionState: board.connectionState,
			capabilities: board.capabilities
		};
	}

	/**
	 * Resolve webview view with workspace validation and device connection handling
	 */
	async resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken
	): Promise<void> {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			enableCommandUris: true,
			localResourceRoots: [this.extensionUri]
		};

		// Perform workspace validation
		await this.performWorkspaceValidation();

		// Set up webview content based on connection status
		await this.updateWebviewContent();

		// Connect webview to CircuitPython language service for completions
		this.languageServiceBridge.connectWebview(
			webviewView.webview, 
			'muTwo.replView'
		);

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			await this.handleWebviewMessage(data);
		});

		// Set up basic message handling
		this.setupMessageHandling(webviewView);

		console.log('REPL View Provider resolved successfully');
	}

	/**
	 * Perform workspace validation and determine device connection status
	 */
	private async performWorkspaceValidation(): Promise<void> {
		// Check global device connection permissions first
		const deviceConnectionStatus = this.workspaceValidator.shouldEnableDeviceConnections(this.currentDevice);
		
		switch (deviceConnectionStatus) {
			case 'enabled':
				this.deviceConnectionEnabled = true;
				break;
			case 'disabled':
				this.deviceConnectionEnabled = true;
				break;
			case 'prompt':
				// Will be handled when user attempts to connect
				this.deviceConnectionEnabled = true;
				break;
		}

		// Validate workspace
		const validationResult = await this.workspaceValidator.validateWorkspace({
			checkCircuitPyDrive: true,
			requireBoardAssociation: false, // Not required for REPL
			respectGlobalPermissions: true
		});

		// Store validation result for status display
		this.extensionContext.workspaceState.update('workspaceValidation', validationResult);
	}

	/**
	 * Update webview content based on connection status and workspace validation
	 */
	private async updateWebviewContent(): Promise<void> {
		if (!this.view) {return};

		const permissions = this.workspaceValidator.getDeviceConnectionPermissions();
		const validationResult = this.extensionContext.workspaceState.get('workspaceValidation');
		this.view.webview.html = this.getReplHtml(permissions, validationResult);
		// if (this.deviceConnectionEnabled) {
		// 	// Show full REPL with connection capabilities
			
		// } else {
		// 	// Show status messages and permission options
			
		// }
	}

	/**
	 * Handle messages from the webview
	 */
	private async handleWebviewMessage(data: any): Promise<void> {
		switch (data.type) {
			case 'webviewReady':
				this.isWebviewReady = true;
				await this.sendInitialState();
				break;

			case 'enableDeviceConnection':
				await this.handleEnableDeviceConnection();
				break;

			case 'openExtensionSettings':
				vscode.commands.executeCommand('workbench.action.openSettings', 'muTwo.device');
				break;

			case 'openWorkspaceSettings':
				vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'muTwo');
				break;

			default:
				// Handle other REPL-specific messages when device connection is enabled
				if (this.deviceConnectionEnabled) {
					await this.handleReplMessage(data);
				}
				break;
		}
	}

	/**
	 * Handle enabling device connection
	 */
	private async handleEnableDeviceConnection(): Promise<void> {
		const permissions = this.workspaceValidator.getDeviceConnectionPermissions();
		
		// If globally disabled, direct to settings
		if (!permissions.hasGlobalPermission && permissions.skipPermissionPrompts) {
			vscode.window.showInformationMessage(
				'Device connections are globally disabled. Please change this in Extension Settings.',
				'Open Settings'
			).then(choice => {
				if (choice === 'Open Settings') {
					vscode.commands.executeCommand('workbench.action.openSettings', 'muTwo.device');
				}
			});
			return;
		}

		// Show permission dialog and update settings
		const allowed = await this.workspaceValidator.showDeviceConnectionWarning(this.currentDevice, true);
		
		if (allowed) {
			this.deviceConnectionEnabled = true;
			await this.updateWebviewContent();
			
			// Connection enabled - ready for device communication
		}
	}

	/**
	 * Send initial state to webview
	 */
	private async sendInitialState(): Promise<void> {
		if (!this.view) {return};

		const permissions = this.workspaceValidator.getDeviceConnectionPermissions();
		const validationResult = this.extensionContext.workspaceState.get('workspaceValidation');

		// Get board information if board manager is available
		const boardList = this.boardManager ? 
			this.boardManager.getAllBoards().map(b => this.serializeBoardForWebview(b)) : [];

		this.view.webview.postMessage({
			type: 'initialState',
			data: {
				deviceConnectionEnabled: this.deviceConnectionEnabled,
				hybridModeEnabled: this.hybridModeEnabled,
				permissions,
				validationResult,
				currentDevice: this.currentDevice,
				boards: boardList
			}
		});
	}

	/**
	 * Set up hybrid PTY backend for the webview
	 */
	private async setupHybridBackend(webviewView: vscode.WebviewView): Promise<void> {
		try {
			// Create hybrid terminal instance
			this.currentHybridInstance = await this.hybridTerminalManager.createHybridWebviewView(
				webviewView,
				{
					enablePTYBackend: this.hybridModeEnabled,
					enableWebviewFallback: true,
					memoryOptimization: true
				}
			);

			console.log(`Hybrid PTY backend created for REPL view: ${this.currentHybridInstance.sessionId}`);


		} catch (error) {
			console.error('Failed to setup hybrid backend, falling back to pure webview mode:', error);
			this.hybridModeEnabled = false;
			
			// Show warning to user
			vscode.window.showWarningMessage(
				'Hybrid terminal mode failed to initialize. Using standard webview mode.',
				'Learn More'
			).then(selection => {
				if (selection === 'Learn More') {
					vscode.env.openExternal(vscode.Uri.parse('https://github.com/'));
				}
			});
		}
	}
	private setupHybridMessageHandling(webviewView: vscode.WebviewView): void {
		const originalMessageHandler = webviewView.webview.onDidReceiveMessage;

		// Enhance message handling for hybrid features
		webviewView.webview.onDidReceiveMessage((message) => {
			// Handle hybrid-specific messages
			switch (message.type) {
				case 'toggleHybridMode':
					this.toggleHybridMode();
					break;

				case 'requestMemoryUsage':
					this.sendMemoryUsageUpdate(webviewView);
					break;

				case 'terminalInput':
					// Route through hybrid backend if available
					if (this.currentHybridInstance?.ptyBackend) {
						this.currentHybridInstance.ptyBackend.handleInput(message.data);
					} else {
						// Fall back to original handling
						this.handleWebviewMessage(message);
					}
					break;

				default:
					// Route other messages to original handler
					this.handleWebviewMessage(message);
					break;
			}
		});
	}

	/**
	 * Toggle between hybrid and pure webview mode
	 */
	private async toggleHybridMode(): Promise<void> {
		if (!this.currentHybridInstance) {
			console.log('No hybrid instance available for mode toggle');
			return;
		}

		try {
			if (this.hybridModeEnabled) {
				// Switch to pure webview mode
				await this.hybridTerminalManager.switchToPureWebviewMode(
					this.currentHybridInstance.sessionId
				);
				this.hybridModeEnabled = false;
				
				vscode.window.showInformationMessage('Switched to pure webview mode');
			} else {
				// Switch to hybrid mode
				await this.hybridTerminalManager.switchToHybridMode(
					this.currentHybridInstance.sessionId
				);
				this.hybridModeEnabled = true;
				
				vscode.window.showInformationMessage('Switched to hybrid PTY mode');
			}

			// Update webview
			if (this.currentHybridInstance.webviewView) {
				this.sendHybridModeUpdate(this.currentHybridInstance.webviewView);
			}

		} catch (error) {
			vscode.window.showErrorMessage(`Failed to toggle hybrid mode: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Send hybrid mode update to webview
	 */
	private sendHybridModeUpdate(webviewView: vscode.WebviewView): void {
		webviewView.webview.postMessage({
			type: 'hybridModeChanged',
			enabled: this.hybridModeEnabled,
			sessionId: this.currentHybridInstance?.sessionId
		});
	}

	/**
	 * Send memory usage update to webview
	 */
	private sendMemoryUsageUpdate(webviewView: vscode.WebviewView): void {
		if (this.currentHybridInstance?.ptyBackend) {
			const metrics = this.currentHybridInstance.ptyBackend.getPerformanceMetrics();
			webviewView.webview.postMessage({
				type: 'memoryUsageUpdate',
				data: metrics.memoryUsage
			});
		}
	}

	/**
	 * Get current hybrid instance
	 */
	getCurrentHybridInstance(): HybridTerminalInstance | undefined {
		return this.currentHybridInstance;
	}

	/**
	 * Check if hybrid mode is enabled
	 */
	isHybridModeEnabled(): boolean {
		return this.hybridModeEnabled;
	}

	/**
	 * Get performance metrics
	 */
	getPerformanceMetrics(): any {
		if (this.currentHybridInstance?.ptyBackend) {
			return this.currentHybridInstance.ptyBackend.getPerformanceMetrics();
		}
		return null;
	}

	/**
	 * Load hybrid configuration from settings
	 */
	private loadHybridConfiguration(): void {
		const config = vscode.workspace.getConfiguration('muTwo.terminal');
		this.hybridModeEnabled = config.get('enableHybridMode', true);
		
		console.log(`Loaded hybrid configuration: hybridModeEnabled=${this.hybridModeEnabled}`);
	}

	/**
	 * Handle REPL-specific messages when device connection is enabled
	 */
	private async handleReplMessage(data: any): Promise<void> {
		console.log('REPL message received:', data);
		
		// Access global services from extension.ts
		const { debugManager, languageClient } = await import('../../extension');
		
		// Handle board-related messages
		if (data.type.startsWith('board.') && this.boardManager) {
			await this.handleBoardMessage(data);
			return;
		}

		switch (data.type) {
			case 'command':
				// Send command through debug manager
				if (data.data?.command && debugManager) {
					try {
						await debugManager.executeCommand(data.data.command);
						this.view?.webview.postMessage({
							type: 'display',
							data: { content: `Executed: ${data.data.command}\n` }
						});
					} catch (error) {
						this.view?.webview.postMessage({
							type: 'display', 
							data: { content: `Error: ${error}\n` }
						});
					}
				}
				break;
				
			case 'requestHistory':
				// Return command history
				const history = this.historyManager.getHistory();
				this.view?.webview.postMessage({
					type: 'commandHistory',
					data: { commands: history }
				});
				break;
				
			case 'syncContent':
				// Store terminal content for session restoration
				if (data.data?.terminalContent) {
					this.extensionContext.workspaceState.update('replContent', data.data.terminalContent);
				}
				break;
		}
	}

	/**
	 * Set up message handling for the webview
	 */
	private setupMessageHandling(webviewView: vscode.WebviewView): void {
		// Additional message handling setup if needed
		// Most of the handling is already done in resolveWebviewView
	}

	private async handleBoardMessage(message: any): Promise<void> {
		if (!this.boardManager) return;
		
		const { type, data } = message;
		
		switch (type) {
			case 'board.list':
				this.sendBoardList();
				break;
				
			case 'board.connect':
				const boardToConnect = this.boardManager.getBoard(data.boardId);
				if (boardToConnect) {
					try {
						await boardToConnect.connect();
						this.sendMessage({
							type: 'board.connectResponse',
							data: { success: true, boardId: data.boardId }
						});
					} catch (error) {
						this.sendMessage({
							type: 'board.connectResponse',
							data: { success: false, boardId: data.boardId, error: String(error) }
						});
					}
				}
				break;
				
			case 'board.disconnect':
				const boardToDisconnect = this.boardManager.getBoard(data.boardId);
				if (boardToDisconnect && boardToDisconnect.isConnected()) {
					try {
						await boardToDisconnect.disconnect();
						this.sendMessage({
							type: 'board.disconnectResponse',
							data: { success: true, boardId: data.boardId }
						});
					} catch (error) {
						this.sendMessage({
							type: 'board.disconnectResponse',
							data: { success: false, boardId: data.boardId, error: String(error) }
						});
					}
				}
				break;
				
			case 'board.execute':
				const boardToExecute = this.boardManager.getBoard(data.boardId);
				if (boardToExecute && boardToExecute.isConnected()) {
					try {
						const result = await boardToExecute.eval(data.code);
						this.sendMessage({
							type: 'board.executeResponse',
							data: { ...result, boardId: data.boardId }
						});
					} catch (error) {
						this.sendMessage({
							type: 'board.executeResponse',
							data: { 
								success: false, 
								boardId: data.boardId, 
								error: String(error) 
							}
						});
					}
				}
				break;
		}
	}

	private sendBoardList(): void {
		if (!this.boardManager) return;
		
		const boards = this.boardManager.getAllBoards();
		this.sendMessage({
			type: 'board.listResponse',
			data: boards.map(b => this.serializeBoardForWebview(b))
		});
	}

	public sendMessage(message: any): void {
		if (this.view) {
			this.view.webview.postMessage(message);
		}
	}

	/**
	 * Set device for connection
	 */
	public setDevice(device?: IDevice): void {
		this.currentDevice = device;

	}

	/**
	 * Enhanced dispose with hybrid cleanup
	 */
	dispose(): void {
		if (this.currentHybridInstance) {
			this.hybridTerminalManager.getTerminalInstance(this.currentHybridInstance.sessionId);
		}
		
		// Disconnect from language service
		this.languageServiceBridge.disconnectWebview('muTwo.replView');
		this.languageServiceBridge.dispose();
		
		// Dispose resources
		this.workspaceValidator.dispose();
		this.workspaceManager.dispose();
		this.historyManager.dispose();
	}
	
	/**
	 * Get HTML for full REPL
	 */
	private async getReplHtml(permissions: DeviceConnectionPermissions, validationResult: any): string {
		const nonce = getNonce();
		
		const scriptUri = this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'public', 'repl', 'index.js'));
		const styleUri = this.view?.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'public', 'repl', 'xterm.css'));
		
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">	
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-resource: https:; script-src 'nonce-${nonce}'; style-src vscode-resource: 'unsafe-inline' http: https: data:; worker-src 'self' blob:;">
	<link rel="stylesheet" href="${styleUri}">
	<title>Mu 2 REPL</title>
</head>
<body>
	<div id="terminal"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	/**
	 * Execute headless command - delegates to HeadlessTerminalProcessor
	 */
	public async executeHeadlessCommand(command: string): Promise<TerminalState> {
		return await this.headlessProcessor.processCommand(command);
	}

	/**
	 * Get headless state - delegates to HeadlessTerminalProcessor
	 */
	public getHeadlessState(): TerminalState {
		return this.headlessProcessor.getCurrentState();
	}
}