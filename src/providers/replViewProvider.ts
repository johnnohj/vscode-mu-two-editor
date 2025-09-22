import * as vscode from 'vscode';
// import { HybridTerminalManager, HybridTerminalInstance } from './hybridTerminalManager'; // File deleted
import { BoardManager, IBoard } from '../sys/boardManager';
import { WorkspaceValidator, DeviceConnectionPermissions } from '../workspace/workspaceValidator';
import { MuTwoWorkspaceManager } from '../workspace/workspaceManager';
import { IDevice } from '../devices/core/deviceDetector';
import { TerminalHistoryManager } from './helpers/historyManager';
// HeadlessTerminalProcessor functionality removed
import { getNonce } from '../sys/utils/webview';
import { LanguageServiceBridge } from './language/core/LanguageServiceBridge';
import { WasmRuntimeManager, WasmExecutionResult } from '../sys/wasmRuntimeManager';
import { getLogger } from '../sys/unifiedLogger';
import { MuTwoRuntimeCoordinator } from '../sys/unifiedRuntimeCoordinator';
import { getService } from '../sys/serviceRegistry';

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
	private workspaceValidator?: WorkspaceValidator;
	private workspaceManager?: MuTwoWorkspaceManager;
	private historyManager: TerminalHistoryManager;
	private boardManager?: BoardManager;

	private deviceConnectionEnabled: boolean = true;
	private view?: vscode.WebviewView;
	private isWebviewReady = false;
	private currentDevice?: IDevice;
	private hybridModeEnabled: boolean = true;
	// Hybrid terminal functionality removed (dependencies missing)
	private languageServiceBridge: LanguageServiceBridge;
	private logger = getLogger();

	// WASM Runtime Management
	private wasmRuntimeManager?: WasmRuntimeManager;
	private currentRuntime: 'serial' | 'wasm-circuitpython' | 'blinka-python' | 'pyscript' = 'serial';
	private runtimeStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

	constructor(
		extensionUri: vscode.Uri,
		extensionContext: vscode.ExtensionContext
	) {
		this.extensionUri = extensionUri;
		this.extensionContext = extensionContext;
		
		// Initialize lightweight services first, defer heavy workspace services
		this.historyManager = new TerminalHistoryManager(extensionContext);

		// Lazy-load workspace services to avoid circular dependencies during extension startup
		this.initializeWorkspaceServices(extensionContext);
		
		// Initialize CircuitPython language service for REPL completions
		try {
			this.languageServiceBridge = new LanguageServiceBridge({
				enableDiagnostics: false, // Disable for REPL - too noisy
				enableCompletions: true,
				enableHover: true,
				enableSignatureHelp: true,
				defaultBoard: 'circuitplayground_express' // TODO: Get from device detection
			});
			this.logger.info('EXTENSION', 'REPL: Language service bridge initialized successfully');
		} catch (error) {
			this.logger.error('EXTENSION', 'REPL: Failed to initialize language service bridge:', error);
			// Create a null object that provides safe method calls
			this.languageServiceBridge = this.createNullLanguageServiceBridge();
		}
		
		// Hybrid terminal functionality removed (dependencies missing)
		this.hybridModeEnabled = false;
		this.logger.warn('EXTENSION', 'Hybrid terminal functionality disabled - dependencies removed');
		
		// Headless processor functionality removed (was causing activation errors)
		
		// Simplified initialization - removed complex dependencies
		this.logger.info('EXTENSION', 'REPL View Provider initialized with simplified architecture');
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
		try {
			if (this.languageServiceBridge) {
				this.languageServiceBridge.connectWebview(
					webviewView.webview,
					'muTwo.replView'
				);
				this.logger.info('EXTENSION', 'REPL: Language service bridge connected successfully');
			}
		} catch (error) {
			this.logger.warn('EXTENSION', 'REPL: Failed to connect language service bridge:', error);
		}

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			await this.handleWebviewMessage(data);
		});

		// Set up basic message handling
		this.setupMessageHandling(webviewView);

		this.logger.info('EXTENSION', 'REPL View Provider resolved successfully');
	}

	/**
	 * Perform workspace validation and determine device connection status
	 */
	private async performWorkspaceValidation(): Promise<void> {
		// Check if workspace validator is available
		if (!this.workspaceValidator) {
			this.logger.warn('EXTENSION', 'REPL: Workspace validator not yet initialized, skipping validation');
			this.deviceConnectionEnabled = true;
			return;
		}

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
		if (!this.view) {
			this.logger.warn('EXTENSION', 'REPL: No webview available for content update');
			return;
		}

		this.logger.info('EXTENSION', 'REPL: Updating webview content...');
		const permissions = this.workspaceValidator?.getDeviceConnectionPermissions();
		const validationResult = this.extensionContext.workspaceState.get('workspaceValidation');

		try {
			const html = await this.getReplHtml(permissions, validationResult);
			this.view.webview.html = html;
			this.logger.info('EXTENSION', 'REPL: Webview HTML set successfully');
		} catch (error) {
			this.logger.error('EXTENSION', 'REPL: Failed to set webview HTML:', error);
			// Set fallback HTML to at least show the panel
			this.view.webview.html = this.getFallbackHtml();
		}
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

			// Runtime Management Messages
			case 'runtime.switch':
				await this.handleRuntimeSwitch(data.runtime);
				break;

			case 'runtime.connect':
				await this.handleRuntimeConnect(data.runtime);
				break;

			case 'runtime.disconnect':
				await this.handleRuntimeDisconnect(data.runtime);
				break;

			default:
				// Handle other REPL-specific messages when device connection is enabled
				if (this.deviceConnectionEnabled) {
					// Only pass to handleReplMessage if it has a valid type property
					if (data && typeof data === 'object' && typeof data.type === 'string') {
						await this.handleReplMessage(data);
					} else {
						this.logger.warn('EXTENSION', 'REPL: Ignoring message with invalid format:', data);
					}
				}
				break;
		}
	}

	/**
	 * Handle enabling device connection
	 */
	private async handleEnableDeviceConnection(): Promise<void> {
		if (!this.workspaceValidator) {
			this.logger.warn('EXTENSION', 'REPL: Workspace validator not available');
			return;
		}
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

		const permissions = this.workspaceValidator?.getDeviceConnectionPermissions();
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
	 * Hybrid PTY backend functionality removed
	 */
	private async setupHybridBackend(webviewView: vscode.WebviewView): Promise<void> {
		this.logger.warn('EXTENSION', 'Hybrid PTY backend functionality removed - skipping setup');
		return;
	}
	// Hybrid message handling functionality removed
	private setupHybridMessageHandling(webviewView: vscode.WebviewView): void {
		this.logger.warn('EXTENSION', 'Hybrid message handling functionality removed - skipping setup');
		return;
	}

	/**
	 * Hybrid mode functionality removed
	 */
	private async toggleHybridMode(): Promise<void> {
		this.logger.warn('EXTENSION', 'Hybrid mode functionality removed');
		vscode.window.showWarningMessage('Hybrid mode functionality is not available');
	}

	/**
	 * Hybrid mode update functionality removed
	 */
	private sendHybridModeUpdate(webviewView: vscode.WebviewView): void {
		this.logger.warn('EXTENSION', 'Hybrid mode update functionality removed');
	}

	/**
	 * Memory usage update functionality removed
	 */
	private sendMemoryUsageUpdate(webviewView: vscode.WebviewView): void {
		this.logger.warn('EXTENSION', 'Memory usage update functionality removed');
	}

	/**
	 * Hybrid instance functionality removed
	 */
	getCurrentHybridInstance(): any {
		this.logger.warn('EXTENSION', 'Hybrid instance functionality removed');
		return undefined;
	}

	/**
	 * Check if hybrid mode is enabled
	 */
	isHybridModeEnabled(): boolean {
		return this.hybridModeEnabled;
	}

	/**
	 * Performance metrics functionality removed
	 */
	getPerformanceMetrics(): any {
		this.logger.warn('EXTENSION', 'Performance metrics functionality removed');
		return null;
	}

	/**
	 * Load hybrid configuration from settings
	 */
	private loadHybridConfiguration(): void {
		const config = vscode.workspace.getConfiguration('muTwo.terminal');
		this.hybridModeEnabled = config.get('enableHybridMode', true);
		
		this.logger.info('EXTENSION', `Loaded hybrid configuration: hybridModeEnabled=${this.hybridModeEnabled}`);
	}

	/**
	 * Handle REPL-specific messages when device connection is enabled
	 */
	private async handleReplMessage(data: any): Promise<void> {
		this.logger.info('EXTENSION', 'REPL message received:', data);

		// Validate message structure
		if (!data || typeof data.type !== 'string') {
			this.logger.error('EXTENSION', 'Invalid message format - missing or invalid type:', data);
			return;
		}

		// Access global services safely without circular imports
		const debugManager = this.getDebugManager();
		const languageClient = this.getLanguageClient();

		// Handle board-related messages
		if (data.type.startsWith('board.') && this.boardManager) {
			await this.handleBoardMessage(data);
			return;
		}

		switch (data.type) {
			case 'command':
				// Route command execution based on current runtime
				await this.handleRuntimeCommand(data.data?.command, data.runtime);
				break;
				
			case 'requestHistory': {
				// Return command history
				// Note: TerminalHistoryManager may not have getHistory method
				// This is a placeholder until the method is implemented
				this.view?.webview.postMessage({
					type: 'commandHistory',
					data: { commands: [] }
				});
				break;
			}
				
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
			case 'board.list': {
				this.sendBoardList();
				break;
			}

			case 'board.connect': {
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
			}

			case 'board.disconnect': {
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
			}

			case 'board.execute': {
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
	 * Initialize workspace services lazily to avoid circular dependencies
	 */
	private async initializeWorkspaceServices(extensionContext: vscode.ExtensionContext): Promise<void> {
		try {
			// Delay initialization to avoid blocking extension startup
			setTimeout(() => {
				try {
					this.workspaceValidator = new WorkspaceValidator(extensionContext);
					this.workspaceManager = new MuTwoWorkspaceManager(extensionContext);
					this.logger.info('EXTENSION', 'REPL: Workspace services initialized successfully');
				} catch (error) {
					this.logger.error('EXTENSION', 'REPL: Failed to initialize workspace services:', error);
					// Continue without workspace services - will use fallbacks
				}
			}, 100);
		} catch (error) {
			this.logger.error('EXTENSION', 'REPL: Failed to schedule workspace services initialization:', error);
		}
	}

	/**
	 * Create a null language service bridge for fallback
	 */
	private createNullLanguageServiceBridge(): any {
		return {
			connectWebview: () => this.logger.warn('EXTENSION', 'REPL: Language service not available'),
			disconnectWebview: () => {},
			dispose: () => {}
		};
	}

	/**
	 * Safely get debug manager instance
	 */
	private getDebugManager(): any {
		try {
			// Import service registry to access global service
			const { getService } = require('../sys/serviceRegistry');
			return getService('deviceManager');
		} catch (error) {
			this.logger.warn('EXTENSION', 'Debug manager not available:', error);
			return null;
		}
	}

	/**
	 * Safely get language client instance
	 */
	private getLanguageClient(): any {
		try {
			// Import service registry to access global service
			const { getService } = require('../sys/serviceRegistry');
			return getService('languageClient');
		} catch (error) {
			this.logger.warn('EXTENSION', 'Language client not available:', error);
			return null;
		}
	}

	/**
	 * Runtime Management Methods
	 */
	private async handleRuntimeSwitch(runtime: string): Promise<void> {
		this.logger.info('EXTENSION', `REPL: Switching to runtime: ${runtime}`);

		if (runtime === this.currentRuntime) {
			this.logger.info('EXTENSION', 'REPL: Already on specified runtime');
			return;
		}

		// Disconnect current runtime
		if (this.runtimeStatus === 'connected') {
			await this.handleRuntimeDisconnect(this.currentRuntime);
		}

		// Update current runtime
		this.currentRuntime = runtime as any;

		// Send status update to webview
		this.sendMessage({
			type: 'runtime.statusUpdate',
			runtime: this.currentRuntime,
			status: 'disconnected'
		});
	}

	private async handleRuntimeConnect(runtime: string): Promise<void> {
		this.logger.info('EXTENSION', `REPL: Connecting to runtime: ${runtime}`);

		this.runtimeStatus = 'connecting';
		this.sendMessage({
			type: 'runtime.statusUpdate',
			runtime: runtime,
			status: 'connecting'
		});

		try {
			switch (runtime) {
				case 'wasm-circuitpython':
					await this.connectWASMRuntime();
					break;
				case 'blinka-python':
					await this.connectBlinkaRuntime();
					break;
				case 'pyscript':
					await this.connectPyScriptRuntime();
					break;
				default:
					throw new Error(`Unknown runtime: ${runtime}`);
			}

			this.runtimeStatus = 'connected';
			this.sendMessage({
				type: 'runtime.statusUpdate',
				runtime: runtime,
				status: 'connected'
			});

		} catch (error) {
			this.logger.error('EXTENSION', `REPL: Failed to connect to ${runtime}:`, error);
			this.runtimeStatus = 'error';
			this.sendMessage({
				type: 'runtime.error',
				runtime: runtime,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private async handleRuntimeDisconnect(runtime: string): Promise<void> {
		this.logger.info('EXTENSION', `REPL: Disconnecting from runtime: ${runtime}`);

		try {
			switch (runtime) {
				case 'wasm-circuitpython':
					await this.disconnectWASMRuntime();
					break;
				case 'blinka-python':
					await this.disconnectBlinkaRuntime();
					break;
				case 'pyscript':
					await this.disconnectPyScriptRuntime();
					break;
			}

			this.runtimeStatus = 'disconnected';
			this.sendMessage({
				type: 'runtime.statusUpdate',
				runtime: runtime,
				status: 'disconnected'
			});

		} catch (error) {
			this.logger.error('EXTENSION', `REPL: Failed to disconnect from ${runtime}:`, error);
		}
	}

	private async handleRuntimeCommand(command: string, runtime?: string): Promise<void> {
		if (!command) return;

		const activeRuntime = runtime || this.currentRuntime;

		try {
			switch (activeRuntime) {
				case 'wasm-circuitpython':
					await this.executeWASMCommand(command);
					break;
				case 'blinka-python':
					await this.executeBlinkaCommand(command);
					break;
				case 'pyscript':
					await this.executePyScriptCommand(command);
					break;
				default:
					await this.executeSerialCommand(command);
					break;
			}
		} catch (error) {
			this.logger.error('EXTENSION', `REPL: Command execution failed for ${activeRuntime}:`, error);
			this.sendMessage({
				type: 'display',
				data: { content: `Error: ${error}\n` }
			});
		}
	}

	// WASM Runtime Methods
	private async connectWASMRuntime(): Promise<void> {
		this.sendMessage({
			type: 'wasm.initializationStart'
		});

		if (!this.wasmRuntimeManager) {
			try {
				// Use shared WASM runtime from unified coordinator
				const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
				if (coordinator) {
					this.wasmRuntimeManager = await coordinator.getSharedWasmRuntime();
					this.logger.info('EXTENSION', 'ReplViewProvider: Using shared WASM runtime from coordinator');
				} else {
					// Fallback: create runtime directly if coordinator not available
					this.logger.warn('EXTENSION', 'ReplViewProvider: Coordinator not available, creating runtime directly');
					this.wasmRuntimeManager = new WasmRuntimeManager({
						enableHardwareSimulation: true,
						debugMode: vscode.workspace.getConfiguration('muTwo.wasm').get('debugMode', false)
					}, this.extensionContext);
					await this.wasmRuntimeManager.initialize();
				}

				// Set up hardware state monitoring
				this.wasmRuntimeManager.on('codeExecuted', (result: WasmExecutionResult) => {
					if (result.hardwareChanges && result.hardwareChanges.length > 0) {
						this.sendHardwareStateUpdate();
					}
				});
			} catch (error) {
				this.logger.error('EXTENSION', 'ReplViewProvider: Failed to get WASM runtime', error);
				throw error;
			}
		}

		this.sendMessage({
			type: 'wasm.initializationComplete',
			success: true
		});

		// Send initial hardware state
		await this.sendHardwareStateUpdate();
	}

	private async disconnectWASMRuntime(): Promise<void> {
		if (this.wasmRuntimeManager) {
			this.wasmRuntimeManager.dispose();
			this.wasmRuntimeManager = undefined;
		}
	}

	private async executeWASMCommand(command: string): Promise<void> {
		if (!this.wasmRuntimeManager) {
			throw new Error('WASM runtime not initialized');
		}

		const result = await this.wasmRuntimeManager.executeCode(command, {
			enableHardwareMonitoring: true
		});

		this.sendMessage({
			type: 'display',
			data: { content: result.output }
		});

		// Update hardware state if there were changes
		if (result.hardwareChanges && result.hardwareChanges.length > 0) {
			await this.sendHardwareStateUpdate();
		}
	}

	private async sendHardwareStateUpdate(): Promise<void> {
		if (!this.wasmRuntimeManager) return;

		try {
			const hardwareState = await this.wasmRuntimeManager.getHardwareState();
			this.sendMessage({
				type: 'hardware.stateUpdate',
				hardwareState: hardwareState
			});
		} catch (error) {
			this.logger.warn('EXTENSION', 'REPL: Failed to get hardware state:', error);
		}
	}

	// Blinka Runtime Methods (placeholder for future implementation)
	private async connectBlinkaRuntime(): Promise<void> {
		this.logger.info('EXTENSION', 'REPL: Blinka runtime connection - using existing serial logic');
		// This would connect to the existing serial/board manager logic
	}

	private async disconnectBlinkaRuntime(): Promise<void> {
		this.logger.info('EXTENSION', 'REPL: Blinka runtime disconnection');
		// This would disconnect from serial/board manager
	}

	private async executeBlinkaCommand(command: string): Promise<void> {
		// Use existing debug manager for serial execution
		const debugManager = this.getDebugManager();
		if (debugManager) {
			await debugManager.sendToRepl(command);
		} else {
			throw new Error('Debug manager not available for Blinka runtime');
		}
	}

	// PyScript Runtime Methods (placeholder for future implementation)
	private async connectPyScriptRuntime(): Promise<void> {
		throw new Error('PyScript runtime not yet implemented');
	}

	private async disconnectPyScriptRuntime(): Promise<void> {
		this.logger.info('EXTENSION', 'REPL: PyScript runtime disconnection');
	}

	private async executePyScriptCommand(command: string): Promise<void> {
		throw new Error('PyScript execution not yet implemented');
	}

	// Serial/Legacy Runtime Methods
	private async executeSerialCommand(command: string): Promise<void> {
		// Use existing debug manager for serial execution
		const debugManager = this.getDebugManager();
		if (debugManager) {
			try {
				await debugManager.sendToRepl(command);
				this.sendMessage({
					type: 'display',
					data: { content: `Executed: ${command}\n` }
				});
			} catch (error) {
				this.sendMessage({
					type: 'display',
					data: { content: `Error: ${error}\n` }
				});
			}
		}
	}

	/**
	 * Dispose provider resources
	 */
	dispose(): void {
		// WASM Runtime cleanup
		if (this.wasmRuntimeManager) {
			this.wasmRuntimeManager.dispose();
			this.wasmRuntimeManager = undefined;
		}

		// Disconnect from language service
		this.languageServiceBridge.disconnectWebview('muTwo.replView');
		this.languageServiceBridge.dispose();

		// Dispose resources
		if (this.workspaceValidator) {
			this.workspaceValidator.dispose();
		}
		if (this.workspaceManager) {
			this.workspaceManager.dispose();
		}
		this.historyManager.dispose();
	}
	
	/**
	 * Get fallback HTML when normal HTML generation fails
	 */
	private getFallbackHtml(): string {
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
	<title>Mu 2 REPL</title>
	<style>
		body {
			font-family: var(--vscode-editor-font-family);
			padding: 16px;
			color: var(--vscode-foreground);
			background-color: var(--vscode-editor-background);
		}
		.error-message {
			color: var(--vscode-errorForeground);
			margin-bottom: 12px;
		}
		.info-message {
			color: var(--vscode-descriptionForeground);
		}
	</style>
</head>
<body>
	<div class="error-message">⚠️ REPL initialization failed</div>
	<div class="info-message">The Mu 2 REPL panel is loading. Please check the output console for more details.</div>
	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		vscode.postMessage({ type: 'webviewReady' });
		// Note: This is in webview script, not extension - keeping as console.log
		console.log('Fallback REPL HTML loaded');
	</script>
</body>
</html>`;
	}

	/**
	 * Get HTML for full REPL
	 */
	private async getReplHtml(permissions: DeviceConnectionPermissions | undefined, validationResult: any): Promise<string> {
		const nonce = getNonce();

		if (!this.view) {
			throw new Error('REPL: No webview available for URI generation');
		}

		const scriptUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'public', 'repl', 'index.js'));
		const styleUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'public', 'repl', 'xterm.css'));
		const blinkafontUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'font_experiments', 'FreeMono-Terminal-Blinka.ttf'));

		this.logger.info('EXTENSION', 'REPL: Generated URIs - script:', scriptUri.toString(), 'style:', styleUri.toString(), 'font:', blinkafontUri.toString());

		if (!scriptUri || !styleUri || !blinkafontUri) {
			throw new Error('REPL: Failed to generate webview URIs');
		}
		
		const wasmCssUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'views', 'webview-repl', 'src', 'wasm-repl.css'));
		const uiToolkitUri = this.view.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js'));

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview: vscode-resource: https:; script-src 'nonce-${nonce}' vscode-webview:; style-src vscode-webview: vscode-resource: 'unsafe-inline' http: https: data:; font-src vscode-webview: vscode-resource: data:; worker-src 'self' blob:;">

	<!-- VS Code Webview UI Toolkit -->
	<script type="module" src="${uiToolkitUri}" nonce="${nonce}"></script>

	<!-- Stylesheets -->
	<link rel="stylesheet" href="${styleUri}">
	<link rel="stylesheet" href="${wasmCssUri}">

	<style>
		/* Blinka Font Integration with Fallback */
		@font-face {
			font-family: 'FreeMono-Terminal-Blinka';
			src: url('${blinkafontUri}') format('truetype');
			font-weight: normal;
			font-style: normal;
			font-display: fallback;
		}

		/* Terminal Blinka Font */
		.terminal {
			font-family: 'FreeMono-Terminal-Blinka', 'Courier New', 'Monaco', 'Liberation Mono', monospace !important;
		}
		.xterm {
			font-family: 'FreeMono-Terminal-Blinka', 'Courier New', 'Monaco', 'Liberation Mono', monospace !important;
		}
		.xterm-viewport, .xterm-screen {
			font-family: 'FreeMono-Terminal-Blinka', 'Courier New', 'Monaco', 'Liberation Mono', monospace !important;
		}

		/* CircuitPython Branding */
		.circuitpython-mode .terminal,
		.circuitpython-mode .xterm {
			background: linear-gradient(135deg, #1e1e1e 0%, #0f1419 100%);
		}

		/* Blinka Glyph in Prompt with Snake Emoji Fallback */
		.blinka-prompt::before {
			content: 'ϴ'; /* Blinka glyph from font */
			margin-right: 4px;
			font-family: 'FreeMono-Terminal-Blinka', monospace;
		}

		/* Fallback to snake emoji if Blinka font fails */
		@supports not (font-family: 'FreeMono-Terminal-Blinka') {
			.blinka-prompt::before {
				content: '🐍';
				font-family: inherit;
			}
		}

		/* Additional fallback for when font loads but glyph is missing */
		.blinka-prompt.font-fallback::before {
			content: '🐍⚡';
			font-family: inherit;
		}

		/* WASM Runtime Indicator */
		.wasm-runtime-active {
			border-left: 3px solid var(--vscode-charts-green);
		}

		/* Layout for WASM UI + Terminal */
		.terminal-with-wasm-ui {
			display: flex;
			flex-direction: column;
			height: 100%;
		}

		.wasm-ui-container {
			flex-shrink: 0;
		}

		.terminal-container {
			flex: 1;
			min-height: 200px;
		}
	</style>
	<title>🐍⚡ Mu 2 REPL</title>
</head>
<body class="terminal-with-wasm-ui">
	<!-- WASM Runtime Selection UI will be injected here by WasmReplUI.tsx -->
	<div id="wasm-repl-ui" class="wasm-ui-container"></div>

	<!-- Terminal Container -->
	<div id="terminal" class="terminal-container"></div>

	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

	/**
	 * Execute headless command - stub implementation (HeadlessTerminalProcessor removed)
	 */
	public async executeHeadlessCommand(command: string): Promise<any> {
		this.logger.warn('EXTENSION', 'HeadlessTerminalProcessor functionality removed - command ignored:', command);
		return { output: '', success: false, error: 'HeadlessTerminalProcessor not available' };
	}

	/**
	 * Get headless state - stub implementation (HeadlessTerminalProcessor removed)
	 */
	public getHeadlessState(): any {
		this.logger.warn('EXTENSION', 'HeadlessTerminalProcessor functionality removed');
		return { status: 'unavailable', message: 'HeadlessTerminalProcessor not available' };
	}
}