import * as vscode from 'vscode';
import { BoardManager, IBoard } from '../../devices/management/boardManager';
import { WorkspaceValidator, DeviceConnectionPermissions } from '../../workspace/workspaceValidator';
import { MuTwoWorkspaceManager } from '../../workspace/workspaceManager';
import { IDevice } from '../../devices/core/deviceDetector';
import { TerminalHistoryManager } from '../helpers/historyManager';
import { getNonce } from '../../utils/webview';
import { LanguageServiceBridge } from '../language/core/LanguageServiceBridge';
import { WasmRuntimeManager, WasmExecutionResult } from '../../runtime/wasm/wasmRuntimeManager';
import { getLogger } from '../../utils/unifiedLogger';
import { UnifiedReplPty } from '../terminal/unifiedReplPty';
import { ReplCoordinator } from '../../services/replCoordinator';
// Removed over-engineered components - using direct imports where needed

/**
 * REPL View Provider with Phase 4 CLI Integration
 *
 * This provider implements:
 * - Phase 4B: CLI message handling and VS Code Tasks integration
 * - Phase 4C: Enhanced webview communication with micro-repl patterns
 * - Runtime coordination for WASM, serial, and Blinka execution
 * - Background task monitoring and progress reporting
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
	private languageServiceBridge: LanguageServiceBridge;
	private logger = getLogger();

	// WASM Runtime Management
	private wasmRuntimeManager?: WasmRuntimeManager;
	private currentRuntime: 'serial' | 'wasm-circuitpython' | 'blinka-python' | 'pyscript' = 'serial';
	private runtimeStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

	// Unified Terminal Backend - PTY-based REPL
	private unifiedReplPty?: UnifiedReplPty;
	private replTerminal?: vscode.Terminal;

	// Track venv readiness state
	private static venvReady: boolean = false;

	/**
	 * Set venv ready state (called from simpleVenv.ts)
	 */
	public static setVenvReady(ready: boolean): void {
		ReplViewProvider.venvReady = ready;
	}

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
		// Temporarily disabled due to MODULE_NOT_FOUND error
		this.logger.info('EXTENSION', 'REPL: Language service bridge temporarily disabled');
		this.languageServiceBridge = this.createNullLanguageServiceBridge();
		// Initialize task progress listeners for Phase 4B
		this.initializeTaskProgressListeners();

		this.logger.info('EXTENSION', 'REPL View Provider initialized with Phase 4 CLI integration');
	}

	/**
	 * Set board manager after construction (called from extension.ts)
	 */
	public setBoardManager(boardManager: BoardManager): void {
		this.boardManager = boardManager;
		this.setupBoardEventForwarding();
	}

	/**
	 * Update device connection state in PTY
	 */
	public updateDeviceConnectionState(connected: boolean): void {
		if (this.unifiedReplPty) {
			this.unifiedReplPty.setDeviceConnected(connected);
		}
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
			localResourceRoots: [
				this.extensionUri,
				this.extensionContext.globalStorageUri
			]
		};

		// Perform workspace validation
		await this.performWorkspaceValidation();

		// Set up webview content based on connection status
		await this.updateWebviewContent();

		// Register main REPL with coordinator for data sharing
		const coordinator = ReplCoordinator.getInstance(this.extensionContext);
		coordinator.registerMainRepl(webviewView);

		// Connect webview to CircuitPython language service for completions
		// Temporarily disabled due to MODULE_NOT_FOUND error
		this.logger.info('EXTENSION', 'REPL: Language service bridge connection skipped (temporarily disabled)');

		// Handle messages from webview
		webviewView.webview.onDidReceiveMessage(async (data) => {
			await this.handleWebviewMessage(data);
		});

		// Set up basic message handling
		this.setupMessageHandling(webviewView);

		this.logger.info('EXTENSION', 'REPL View Provider resolved successfully with data coordination');
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
			// Set minimal fallback HTML
			this.view.webview.html = '<html><body><div>REPL loading...</div></body></html>';
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
				this.logger.info('EXTENSION', 'REPL: Received webviewReady message');
				this.isWebviewReady = true;
				await this.sendInitialState();
				break;

			case 'requestRestore':
				this.logger.info('EXTENSION', 'REPL: Handling requestRestore - also triggering initial state');
				// If webview is requesting restore, it means it's ready - trigger initial state
				if (!this.isWebviewReady) {
					this.isWebviewReady = true;
					await this.sendInitialState();
				}

				// Terminal wants its session content restored
				// For now, just send empty content to show the prompt
				this.sendMessage({
					type: 'sessionRestore',
					data: { sessionContent: '' }
				});

				// Send command history
				this.sendMessage({
					type: 'commandHistory',
					data: { commands: [] }
				});
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

			// Phase 4B: CLI Command Processing
			case 'cli-command':
				await this.handleCLICommand(data);
				break;

			case 'keyboard-interrupt':
				await this.handleKeyboardInterrupt(data);
				break;

			case 'soft-restart':
				await this.handleSoftRestart(data);
				break;

			case 'task-status':
				await this.handleTaskStatusRequest(data);
				break;

			case 'task-cancel':
				await this.handleTaskCancel(data);
				break;

			case 'terminal_input':
				// Forward webview input to PTY backend
				if (this.unifiedReplPty && data.data?.input !== undefined) {
					this.unifiedReplPty.handleInput(data.data.input);
				}
				break;

			// Data coordination messages - handled by ReplCoordinator
			case 'dataPublish':
			case 'dataRequest':
			case 'sensorDataStream':
			case 'hardwareSimulation':
				this.logger.info('EXTENSION', `REPL: Data coordination message: ${data.type}`);
				// ReplCoordinator handles these via its message subscription
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
		this.logger.info('EXTENSION', 'REPL: sendInitialState() called');
		if (!this.view) {
			this.logger.warn('EXTENSION', 'REPL: No view available in sendInitialState');
			return;
		}

		const permissions = this.workspaceValidator?.getDeviceConnectionPermissions();
		const validationResult = this.extensionContext.workspaceState.get('workspaceValidation');

		// Get board information if board manager is available
		const boardList = this.boardManager ?
			this.boardManager.getAllBoards().map(b => this.serializeBoardForWebview(b)) : [];

		// Get active tasks information
		const activeTasks = this.getActiveMuTwoTasks().map(execution => ({
			taskId: execution.task.definition.taskId || execution.task.name,
			name: execution.task.name,
			type: execution.task.definition.taskType || 'unknown',
			started: true
		}));

		// Get terminal backend status (replaces over-engineered CLI processor)
		const terminalStatus = {
			available: true,
			type: 'unified-terminal-backend'
		};

		this.view.webview.postMessage({
			type: 'initialState',
			data: {
				deviceConnectionEnabled: this.deviceConnectionEnabled,
				permissions,
				validationResult,
				currentDevice: this.currentDevice,
				boards: boardList,
				activeTasks,
				terminalStatus,
				currentRuntime: this.currentRuntime,
				runtimeStatus: this.runtimeStatus
			}
		});

		// Check if venv is already ready (set by simpleVenv.ts)
		const venvReady = ReplViewProvider.venvReady;
		this.logger.info('EXTENSION', `REPL: Venv ready state = ${venvReady}`);

		if (venvReady) {
			// Venv is ready - initialize PTY terminal
			this.logger.info('EXTENSION', 'REPL: Initializing PTY-based unified REPL');
			await this.initializeUnifiedReplTerminal();
		} else {
			// Venv not ready yet - REPL will stay in awaiting_venv state
			this.logger.info('EXTENSION', 'REPL: ⏳ Venv not ready yet, staying in awaiting_venv state');
		}
	}

	/**
	 * Initialize the unified REPL with PTY backend bridged to webview
	 */
	private async initializeUnifiedReplTerminal(): Promise<void> {
		try {
			// Create PTY instance
			this.unifiedReplPty = new UnifiedReplPty(this.extensionContext);

			// Set up PTY output bridge to webview
			this.bridgePtyToWebview();

			// Don't create native terminal automatically - only create on-demand
			// This prevents input echo issues between webview and native terminal

			this.logger.info('EXTENSION', 'REPL: ✅ PTY backend initialized with webview bridge (native terminal available on-demand)');

			// Send message to webview to transition from waiting state
			this.sendMessage({
				type: 'pty_ready',
				data: {
					mode: 'webview_primary',
					nativeTerminalAvailable: true
				}
			});

		} catch (error) {
			this.logger.error('EXTENSION', 'REPL: Failed to initialize PTY backend:', error);
		}
	}

	/**
	 * Create native terminal on-demand for advanced users
	 * Creates a separate PTY instance to avoid input echo with webview
	 */
	public createNativeTerminal(): vscode.Terminal | null {
		// Only create one native terminal instance
		if (this.replTerminal) {
			this.replTerminal.show();
			return this.replTerminal;
		}

		this.logger.info('EXTENSION', 'REPL: Creating separate native terminal on-demand');

		try {
			// Create separate PTY instance for native terminal to avoid input conflicts
			const nativePty = new UnifiedReplPty(this.extensionContext);

			this.replTerminal = vscode.window.createTerminal({
				name: 'Mu 2 Shell',
				pty: nativePty,
				iconPath: new vscode.ThemeIcon('terminal', new vscode.ThemeColor('terminal.ansiRed')),
				isTransient: false
			});

			// Show the terminal when created
			this.replTerminal.show();

			this.logger.info('EXTENSION', 'REPL: Native terminal created with separate PTY instance');
			return this.replTerminal;

		} catch (error) {
			this.logger.error('EXTENSION', 'REPL: Failed to create native terminal:', error);
			return null;
		}
	}

	/**
	 * Bridge PTY output to webview terminal
	 */
	private bridgePtyToWebview(): void {
		if (!this.unifiedReplPty) return;

		// Listen to PTY output and forward to webview
		this.unifiedReplPty.onDidWrite((data) => {
			this.sendMessage({
				type: 'terminal_output',
				data: {
					content: data
				}
			});
		});

		// Handle PTY close event
		this.unifiedReplPty.onDidClose(() => {
			this.sendMessage({
				type: 'terminal_closed',
				data: {}
			});
		});
	}

	/**
	 * Execute shell command with output capture using VS Code Task API
	 */
	private async executeShellCommandWithCapture(command: string, uuid: string): Promise<{success: boolean, output: string, error?: string}> {
		return new Promise((resolve) => {
			// Create a task to execute the shell command
			const taskDefinition: vscode.TaskDefinition = {
				type: 'shell',
				taskId: `repl-command-${uuid}`
			};

			const shellExecution = new vscode.ShellExecution(command, {
				// Use the venv environment from our Python setup
				env: {
					...process.env,
					VIRTUAL_ENV: this.extensionContext.globalStorageUri.with({path: this.extensionContext.globalStorageUri.path + '/venv'}).fsPath,
					PATH: this.getVenvPATH()
				}
			});

			const task = new vscode.Task(
				taskDefinition,
				vscode.TaskScope.Workspace,
				`REPL: ${command}`,
				'mu-two-repl',
				shellExecution,
				['$msCompile'] // Use minimal problem matcher
			);

			task.presentationOptions = {
				echo: false,
				reveal: vscode.TaskRevealKind.Never, // Don't show terminal
				focus: false,
				panel: vscode.TaskPanelKind.Dedicated,
				showReuseMessage: false,
				clear: false
			};

			let output = '';
			let hasError = false;

			// Set up task completion listener
			const disposable = vscode.tasks.onDidEndTask(async (event) => {
				if (event.execution.task.definition.taskId === taskDefinition.taskId) {
					disposable.dispose();

					// Try to get the output from the terminal (this is tricky with VS Code tasks)
					// For now, we'll use exit code to determine success
					const success = (event.execution as any).exitCode === 0;

					resolve({
						success,
						output: success ? `✅ Command executed successfully` : `❌ Command failed with exit code ${(event.execution as any).exitCode || 'unknown'}`,
						error: hasError ? 'Command execution failed' : undefined
					});
				}
			});

			// Execute the task
			vscode.tasks.executeTask(task).then(() => {
				// Task started successfully
			}).catch((error) => {
				disposable.dispose();
				resolve({
					success: false,
					output: '',
					error: `Failed to start command: ${error.message}`
				});
			});

			// Set timeout to avoid hanging
			setTimeout(() => {
				disposable.dispose();
				resolve({
					success: false,
					output: '',
					error: 'Command execution timeout'
				});
			}, 30000); // 30 second timeout
		});
	}

	/**
	 * Get Python virtual environment PATH for shell commands
	 */
	private getVenvPATH(): string {
		const venvPath = this.extensionContext.globalStorageUri.with({path: this.extensionContext.globalStorageUri.path + '/venv'}).fsPath;
		const venvBin = process.platform === 'win32' ? `${venvPath}\\Scripts` : `${venvPath}/bin`;
		return `${venvBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`;
	}

	/**
	 * Create hidden terminal backend for unified shell execution
	 */
	private createHiddenTerminal(): vscode.Terminal {
		if (this.hiddenTerminal) {
			return this.hiddenTerminal;
		}

		this.logger.info('REPL', 'Creating hidden terminal backend for unified REPL');

		this.hiddenTerminal = vscode.window.createTerminal({
			name: 'Mu Two Hidden Shell',
			hideFromUser: true,
			env: {
				// Inherit the extension's venv environment variables
				...process.env
			}
		});

		this.logger.info('REPL', 'Hidden terminal backend created successfully');
		return this.hiddenTerminal;
	}

	/**
	 * Execute shell command in hidden terminal backend
	 */
	private async executeShellCommand(command: string): Promise<void> {
		const terminal = this.createHiddenTerminal();

		this.logger.info('REPL', `Executing shell command in hidden terminal: ${command}`);

		// Send command to hidden terminal
		terminal.sendText(command);

		// TODO: Capture terminal output and send back to webview
		// This requires terminal data streams or output capture mechanism
	}

	/**
	 * Handle unified REPL commands - route to shell or device based on command type
	 */
	private async handleUnifiedReplCommand(command: string): Promise<void> {
		// Determine if this is a shell command or device command
		if (this.isShellCommand(command)) {
			await this.executeShellCommand(command);
		} else {
			// Handle as device/CircuitPython command
			await this.handleDeviceCommand(command);
		}
	}

	/**
	 * Check if command should be executed in shell vs device
	 */
	private isShellCommand(command: string): boolean {
		const shellCommands = ['pip', 'circup', 'ls', 'dir', 'cd', 'python', 'mu'];
		const firstWord = command.trim().split(' ')[0].toLowerCase();
		return shellCommands.includes(firstWord);
	}

	/**
	 * Handle device/CircuitPython command execution
	 */
	private async handleDeviceCommand(command: string): Promise<void> {
		// Use existing device communication logic
		this.logger.info('REPL', `Executing device command: ${command}`);
		// TODO: Route to existing device communication handlers
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
	 * Unified Terminal Backend: CLI Command Processing with Output Capture
	 */
	private async handleCLICommand(data: any): Promise<void> {
		try {
			const { command, args = [], uuid } = data;
			this.logger.info('EXTENSION', `REPL: Processing shell command: ${command} with args:`, args);

			// Build full command string
			const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command;

			// Execute using VS Code Task API for proper output capture
			const result = await this.executeShellCommandWithCapture(fullCommand, uuid);

			// Send response with captured output
			this.sendMessage({
				type: 'cli-response',
				uuid,
				success: result.success,
				data: result.output,
				message: result.success ? 'Command completed' : 'Command failed',
				error: result.error
			});

		} catch (error) {
			this.logger.error('EXTENSION', 'Shell command execution failed:', error);
			this.sendMessage({
				type: 'cli-response',
				uuid: data.uuid,
				success: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private async handleKeyboardInterrupt(data: any): Promise<void> {
		this.logger.info('EXTENSION', 'REPL: Keyboard interrupt (Ctrl+C) received');

		try {
			// Send interrupt signal to current runtime
			switch (this.currentRuntime) {
				case 'wasm-circuitpython':
					if (this.wasmRuntimeManager) {
						await this.wasmRuntimeManager.sendInterrupt();
					}
					break;

				case 'serial':
				default:
					// Send Ctrl+C to serial connection
					const debugManager = this.getDebugManager();
					if (debugManager) {
						await debugManager.sendInterrupt();
					}
					break;
			}

			// Notify webview that interrupt was processed
			this.sendMessage({
				type: 'interrupt-ack',
				uuid: data.uuid
			});

		} catch (error) {
			this.logger.error('EXTENSION', 'Failed to process keyboard interrupt:', error);
			this.sendMessage({
				type: 'interrupt-ack',
				uuid: data.uuid,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private async handleSoftRestart(data: any): Promise<void> {
		this.logger.info('EXTENSION', 'REPL: Soft restart (Ctrl+D) received');

		try {
			// Perform soft restart based on current runtime
			switch (this.currentRuntime) {
				case 'wasm-circuitpython':
					if (this.wasmRuntimeManager) {
						await this.wasmRuntimeManager.restart();
						this.sendMessage({
							type: 'display',
							data: { content: '\nsoft reboot\n\nAdafruit CircuitPython 9.1.4 on 2024-08-22; Raspberry Pi Pico with rp2040\n>>> ' }
						});
					}
					break;

				case 'serial':
				default:
					// Send Ctrl+D to serial connection
					const debugManager = this.getDebugManager();
					if (debugManager) {
						await debugManager.sendSoftRestart();
					}
					break;
			}

			// Notify webview that restart was processed
			this.sendMessage({
				type: 'restart-ack',
				uuid: data.uuid
			});

		} catch (error) {
			this.logger.error('EXTENSION', 'Failed to process soft restart:', error);
			this.sendMessage({
				type: 'restart-ack',
				uuid: data.uuid,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private async handleTaskStatusRequest(data: any): Promise<void> {
		const { taskId, uuid } = data;

		try {
			// Check task status using VS Code tasks API
			const execution = vscode.tasks.taskExecutions.find(exec =>
				exec.task.name === taskId || exec.task.definition.taskId === taskId
			);

			if (execution) {
				this.sendMessage({
					type: 'task-status-response',
					uuid,
					taskId,
					status: 'running',
					data: {
						name: execution.task.name,
						started: true
					}
				});
			} else {
				this.sendMessage({
					type: 'task-status-response',
					uuid,
					taskId,
					status: 'completed',
					data: { name: taskId }
				});
			}

		} catch (error) {
			this.logger.error('EXTENSION', 'Failed to get task status:', error);
			this.sendMessage({
				type: 'task-status-response',
				uuid,
				taskId,
				status: 'error',
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	private async handleTaskCancel(data: any): Promise<void> {
		const { taskId, uuid } = data;

		try {
			// Find and terminate the task
			const execution = vscode.tasks.taskExecutions.find(exec =>
				exec.task.name === taskId || exec.task.definition.taskId === taskId
			);

			if (execution) {
				execution.terminate();
				this.sendMessage({
					type: 'task-cancel-response',
					uuid,
					taskId,
					success: true
				});
			} else {
				this.sendMessage({
					type: 'task-cancel-response',
					uuid,
					taskId,
					success: false,
					error: 'Task not found'
				});
			}

		} catch (error) {
			this.logger.error('EXTENSION', 'Failed to cancel task:', error);
			this.sendMessage({
				type: 'task-cancel-response',
				uuid,
				taskId,
				success: false,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	/**
	 * Monitor background task progress and send updates to webview
	 */
	private monitorTask(taskId: string, commandUuid: string): void {
		// Set up task monitoring using VS Code Tasks API
		const disposable = vscode.tasks.onDidEndTask(event => {
			if (event.execution.task.name === taskId ||
				event.execution.task.definition.taskId === taskId) {

				this.sendMessage({
					type: 'task-completed',
					taskId,
					commandUuid,
					success: true,
					exitCode: 0  // VS Code doesn't provide exit code directly
				});

				disposable.dispose();
			}
		});

		// Clean up disposable after reasonable timeout
		setTimeout(() => {
			disposable.dispose();
		}, 5 * 60 * 1000); // 5 minutes
	}

	/**
	 * VS Code Tasks Integration for Background Operations
	 */
	public async createBackgroundTask(
		taskType: 'pip' | 'circup' | 'setup' | 'sync',
		options: {
			command: string;
			args?: string[];
			cwd?: string;
			taskId?: string;
			name?: string;
		}
	): Promise<string> {
		const taskId = options.taskId || `muTwo-${taskType}-${Date.now()}`;
		const taskName = options.name || `Mu Two ${taskType} operation`;

		// Create task definition
		const taskDefinition: vscode.TaskDefinition = {
			type: 'muTwo',
			taskType,
			taskId,
			command: options.command,
			args: options.args || []
		};

		// Create shell execution
		const execution = new vscode.ShellExecution(
			options.command,
			options.args || [],
			{
				cwd: options.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
				env: {
					...process.env,
					MUTWO_TASK_ID: taskId
				}
			}
		);

		// Create task
		const task = new vscode.Task(
			taskDefinition,
			vscode.TaskScope.Workspace,
			taskName,
			'muTwo',
			execution,
			['$circuitpython-compile'] // Problem matcher for CircuitPython errors
		);

		// Configure task properties
		task.group = vscode.TaskGroup.Build;
		task.presentationOptions = {
			echo: true,
			reveal: vscode.TaskRevealKind.Silent, // Don't focus terminal
			focus: false,
			panel: vscode.TaskPanelKind.Shared,
			showReuseMessage: false,
			clear: false
		};

		// Execute task
		try {
			const execution = await vscode.tasks.executeTask(task);
			this.logger.info('EXTENSION', `Background task started: ${taskId} (${taskName})`);

			// Set up progress monitoring for this task
			this.setupTaskProgressMonitoring(taskId, execution);

			return taskId;
		} catch (error) {
			this.logger.error('EXTENSION', `Failed to start background task: ${taskId}`, error);
			throw error;
		}
	}

	/**
	 * Set up comprehensive task progress monitoring
	 */
	private setupTaskProgressMonitoring(taskId: string, execution: vscode.TaskExecution): void {
		// Monitor task start
		const startDisposable = vscode.tasks.onDidStartTask(event => {
			if (event.execution === execution) {
				this.sendMessage({
					type: 'task-started',
					taskId,
					name: event.execution.task.name
				});
				startDisposable.dispose();
			}
		});

		// Monitor task end
		const endDisposable = vscode.tasks.onDidEndTask(event => {
			if (event.execution === execution) {
				this.sendMessage({
					type: 'task-ended',
					taskId,
					name: event.execution.task.name,
					exitCode: 0 // VS Code doesn't provide actual exit code
				});
				endDisposable.dispose();
			}
		});

		// Monitor task process (output streaming would need additional setup)
		const processDisposable = vscode.tasks.onDidStartTaskProcess?.(event => {
			if (event.execution === execution) {
				this.sendMessage({
					type: 'task-process-started',
					taskId,
					processId: event.processId
				});
				processDisposable?.dispose();
			}
		});

		// Clean up all disposables after timeout
		setTimeout(() => {
			startDisposable.dispose();
			endDisposable.dispose();
			processDisposable?.dispose();
		}, 10 * 60 * 1000); // 10 minutes
	}

	/**
	 * Create environment setup task
	 */
	public async createEnvironmentSetupTask(): Promise<string> {
		return this.createBackgroundTask('setup', {
			command: 'python',
			args: ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'],
			name: 'Python Environment Setup',
			taskId: `muTwo-env-setup-${Date.now()}`
		});
	}

	/**
	 * Create library installation task
	 */
	public async createLibraryInstallTask(libraries: string[]): Promise<string> {
		return this.createBackgroundTask('pip', {
			command: 'python',
			args: ['-m', 'pip', 'install', ...libraries],
			name: `Install Libraries: ${libraries.join(', ')}`,
			taskId: `muTwo-lib-install-${Date.now()}`
		});
	}

	/**
	 * Create CircuitPython library sync task
	 */
	public async createCircupSyncTask(operation: 'install' | 'update' | 'freeze', libraries?: string[]): Promise<string> {
		const args = [operation];
		if (libraries && libraries.length > 0) {
			args.push(...libraries);
		}

		return this.createBackgroundTask('circup', {
			command: 'circup',
			args,
			name: `CircUp ${operation}${libraries ? ': ' + libraries.join(', ') : ''}`,
			taskId: `muTwo-circup-${operation}-${Date.now()}`
		});
	}

	/**
	 * Get all active Mu Two tasks
	 */
	public getActiveMuTwoTasks(): vscode.TaskExecution[] {
		return vscode.tasks.taskExecutions.filter(execution =>
			execution.task.definition.type === 'muTwo'
		);
	}

	/**
	 * Cancel all active Mu Two tasks
	 */
	public async cancelAllMuTwoTasks(): Promise<void> {
		const activeTasks = this.getActiveMuTwoTasks();

		for (const execution of activeTasks) {
			try {
				execution.terminate();
				this.logger.info('EXTENSION', `Terminated task: ${execution.task.name}`);
			} catch (error) {
				this.logger.warn('EXTENSION', `Failed to terminate task: ${execution.task.name}`, error);
			}
		}

		if (activeTasks.length > 0) {
			this.sendMessage({
				type: 'tasks-cancelled',
				count: activeTasks.length
			});
		}
	}

	/**
	 * Phase 4B: Task Listeners and Progress Reporting
	 */
	private globalTaskListeners: vscode.Disposable[] = [];

	/**
	 * Initialize global task progress listeners
	 */
	private initializeTaskProgressListeners(): void {
		// Avoid duplicate listeners
		if (this.globalTaskListeners.length > 0) {
			return;
		}

		// Listen for all task starts
		this.globalTaskListeners.push(
			vscode.tasks.onDidStartTask(event => {
				// Only report Mu Two tasks or tasks that might be related
				if (this.isRelevantTask(event.execution.task)) {
					this.broadcastTaskProgress({
						type: 'task-global-started',
						taskId: this.getTaskId(event.execution.task),
						name: event.execution.task.name,
						source: event.execution.task.source,
						timestamp: Date.now()
					});
				}
			})
		);

		// Listen for all task ends
		this.globalTaskListeners.push(
			vscode.tasks.onDidEndTask(event => {
				if (this.isRelevantTask(event.execution.task)) {
					this.broadcastTaskProgress({
						type: 'task-global-ended',
						taskId: this.getTaskId(event.execution.task),
						name: event.execution.task.name,
						source: event.execution.task.source,
						timestamp: Date.now()
					});
				}
			})
		);

		// Listen for task process starts (includes process ID)
		if (vscode.tasks.onDidStartTaskProcess) {
			this.globalTaskListeners.push(
				vscode.tasks.onDidStartTaskProcess(event => {
					if (this.isRelevantTask(event.execution.task)) {
						this.broadcastTaskProgress({
							type: 'task-process-started',
							taskId: this.getTaskId(event.execution.task),
							name: event.execution.task.name,
							processId: event.processId,
							timestamp: Date.now()
						});
					}
				})
			);
		}

		// Listen for task process ends (includes exit code)
		if (vscode.tasks.onDidEndTaskProcess) {
			this.globalTaskListeners.push(
				vscode.tasks.onDidEndTaskProcess(event => {
					if (this.isRelevantTask(event.execution.task)) {
						this.broadcastTaskProgress({
							type: 'task-process-ended',
							taskId: this.getTaskId(event.execution.task),
							name: event.execution.task.name,
							exitCode: event.exitCode,
							timestamp: Date.now()
						});
					}
				})
			);
		}

		this.logger.info('EXTENSION', 'Global task progress listeners initialized');
	}

	/**
	 * Check if a task is relevant for progress reporting
	 */
	private isRelevantTask(task: vscode.Task): boolean {
		// Always report Mu Two tasks
		if (task.definition.type === 'muTwo') {
			return true;
		}

		// Report Python/pip related tasks
		if (task.source === 'python' || task.source === 'pip') {
			return true;
		}

		// Report tasks with CircuitPython/circup in the name
		const name = task.name.toLowerCase();
		if (name.includes('circuitpython') || name.includes('circup') || name.includes('mu')) {
			return true;
		}

		// Report shell tasks that might be relevant
		if (task.execution instanceof vscode.ShellExecution) {
			const command = task.execution.command.toLowerCase();
			if (command.includes('python') || command.includes('pip') || command.includes('circup')) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Get consistent task ID from task
	 */
	private getTaskId(task: vscode.Task): string {
		return task.definition.taskId ||
			   `${task.source}-${task.name}-${task.definition.type || 'task'}`;
	}

	/**
	 * Broadcast task progress to webview and other interested parties
	 */
	private broadcastTaskProgress(progress: {
		type: string;
		taskId: string;
		name: string;
		source?: string;
		processId?: number;
		exitCode?: number;
		timestamp: number;
	}): void {
		// Send to webview
		this.sendMessage({
			type: 'task-progress',
			...progress
		});

		// Log for debugging
		this.logger.info('EXTENSION', `Task progress: ${progress.type} - ${progress.name} (${progress.taskId})`);

		// Task completion notifications handled by unified terminal backend
		// Over-engineered service registry system removed
	}

	/**
	 * Get comprehensive progress report for all tasks
	 */
	public getTaskProgressReport(): {
		activeTasks: any[];
		recentlyCompleted: any[];
		totalTasks: number;
	} {
		const activeTasks = this.getActiveMuTwoTasks().map(execution => ({
			taskId: this.getTaskId(execution.task),
			name: execution.task.name,
			type: execution.task.definition.taskType || execution.task.definition.type,
			source: execution.task.source,
			started: true
		}));

		// For recently completed tasks, we'd need to maintain a cache
		// This is a simplified version
		const recentlyCompleted: any[] = [];

		return {
			activeTasks,
			recentlyCompleted,
			totalTasks: activeTasks.length + recentlyCompleted.length
		};
	}

	/**
	 * Send task progress report to webview
	 */
	public sendTaskProgressReport(): void {
		const report = this.getTaskProgressReport();
		this.sendMessage({
			type: 'task-progress-report',
			data: report
		});
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
					// Unified REPL - all commands go through terminal routing
					this.logger.warn('EXTENSION', `Unknown runtime ${activeRuntime}, using unified terminal backend`);
					const terminal = this.createHiddenTerminal();
					terminal.sendText(command);
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
				// WASM runtime disabled for unified REPL - using terminal backend
				this.logger.info('EXTENSION', 'WASM runtime disabled - using unified terminal backend');
				// this.wasmRuntimeManager = null;
				this.logger.info('EXTENSION', 'ReplViewProvider: Using shared WASM runtime from coordinator');

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

	/**
	 * Blinka Runtime Methods - delegates to runtime coordinator
	 */
	private async connectBlinkaRuntime(): Promise<void> {
		const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
		if (coordinator) {
			await coordinator.switchToRuntime('blinka-python');
		} else {
			throw new Error('Runtime coordinator not available');
		}
	}

	private async disconnectBlinkaRuntime(): Promise<void> {
		const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
		if (coordinator) {
			await coordinator.disconnectFromCurrentRuntime();
		}
	}

	private async executeBlinkaCommand(command: string): Promise<void> {
		const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
		if (coordinator) {
			await coordinator.executeCommand(command);
		} else {
			throw new Error('Runtime coordinator not available for Blinka runtime');
		}
	}

	/**
	 * PyScript Runtime Methods - delegates to runtime coordinator
	 */
	private async connectPyScriptRuntime(): Promise<void> {
		const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
		if (coordinator) {
			await coordinator.switchToRuntime('pyscript');
		} else {
			throw new Error('Runtime coordinator not available');
		}
	}

	private async disconnectPyScriptRuntime(): Promise<void> {
		const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
		if (coordinator) {
			await coordinator.disconnectFromCurrentRuntime();
		}
	}

	private async executePyScriptCommand(command: string): Promise<void> {
		const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
		if (coordinator) {
			await coordinator.executeCommand(command);
		} else {
			throw new Error('Runtime coordinator not available for PyScript runtime');
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

		// PTY and Terminal cleanup
		if (this.unifiedReplPty) {
			this.unifiedReplPty.close();
			this.unifiedReplPty = undefined;
		}
		if (this.replTerminal) {
			this.replTerminal.dispose();
			this.replTerminal = undefined;
		}

		// Disconnect from language service
		this.languageServiceBridge.disconnectWebview('muTwo.replView');
		this.languageServiceBridge.dispose();

		// Phase 4B: Dispose task progress listeners
		this.globalTaskListeners.forEach(disposable => disposable.dispose());
		this.globalTaskListeners = [];

		// Dispose resources
		if (this.workspaceValidator) {
			this.workspaceValidator.dispose();
		}
		if (this.workspaceManager) {
			this.workspaceManager.dispose();
		}
		this.historyManager.dispose();

		this.logger.info('EXTENSION', 'ReplViewProvider disposed');
	}

// 	/**
// 	 * Get fallback HTML when normal HTML generation fails
// 	 */
// 	private getFallbackHtml(): string {
// 		const nonce = getNonce();
// 		return `<!DOCTYPE html>
// <html lang="en">
// <head>
// 	<meta charset="UTF-8">
// 	<meta name="viewport" content="width=device-width, initial-scale=1.0">
// 	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
// 	<title>Mu 2 REPL</title>
// 	<style>
// 		body {
// 			font-family: var(--vscode-editor-font-family);
// 			padding: 16px;
// 			color: var(--vscode-foreground);
// 			background-color: var(--vscode-editor-background);
// 		}
// 		.error-message {
// 			color: var(--vscode-errorForeground);
// 			margin-bottom: 12px;
// 		}
// 		.info-message {
// 			color: var(--vscode-descriptionForeground);
// 		}
// 	</style>
// </head>
// <body>
// 	<div class="error-message">⚠️ REPL initialization failed</div>
// 	<div class="info-message">The Mu 2 REPL panel is loading. Please check the output console for more details.</div>
// 	<script nonce="${nonce}">
// 		const vscode = acquireVsCodeApi();
// 		vscode.postMessage({ type: 'webviewReady' });
// 		// Note: This is in webview script, not extension - keeping as console.log
// 		console.log('Fallback REPL HTML loaded');
// 	</script>
// </body>
// </html>`;
// 	}

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

		// UI toolkit not needed for simplified unified REPL

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview: vscode-resource: https:; script-src 'nonce-${nonce}' vscode-webview:; style-src vscode-webview: vscode-resource: 'unsafe-inline' http: https: data:; font-src vscode-webview: vscode-resource: data:; worker-src 'self' blob:;">

	<!-- Stylesheets -->
	<link rel="stylesheet" href="${styleUri}">


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

		/* Simplified Layout for Unified Terminal */
		.unified-terminal {
			display: flex;
			flex-direction: column;
			height: 100%;
		}

		.terminal-container {
			flex: 1;
			min-height: 200px;
		}
	</style>
	<title>🐍⚡ Mu 2 REPL</title>
</head>
<body class="unified-terminal">
	<!-- Unified REPL Terminal - No runtime selection UI needed -->
	<div id="terminal" class="terminal-container"></div>

	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}

}