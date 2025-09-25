import * as vscode from 'vscode';
import { ReplViewProvider } from '../providers/views/replViewProvider';
import { EditorPanelProvider } from '../providers/views/editorPanelProvider';
import { PythonEnvManager } from '../execution/pythonEnvManager';
import { MuTwoLanguageClient } from '../devices/core/client';
import { DeviceManager } from '../devices/core/deviceManager';
// import { TerminalIntegration } from '../tui/terminal/terminalIntegration'; // File deleted
import { MuTwoFileSystemProvider } from '../workspace/filesystem/fileSystemProvider';
import { MuTwoWorkspaceManager } from '../workspace/workspaceManager';
import { MuDeviceDetector } from '../devices/core/deviceDetector';
// import { HeadlessTerminalTaskProvider, HeadlessTaskExecutionHelper } from '../tui/terminal/headlessTaskProvider'; // File deleted
import { SerialMonitorCooperativeManager } from '../devices/core/serialMonitorCooperativeManager';
// import { UnifiedDebugManager } from './unifiedDebugManager';
// import { EnhancedSerialDebugging } from '../debug/enhancedSerialDebugging'; // File deleted
// import { TransactionLoggerManager } from '../debug/transactionLoggerManager'; // File deleted
// import { EnhancedSerialDebugger } from '../debug/enhancedSerialDebugger'; // File deleted
// import { DebugVisualizationProvider } from '../debug/debugVisualization'; // File deleted
// import { BlinkaExecutionManager } from '../devices/execution/blinka/blinkaExecutionManager';
// import { DualExecutionInterface } from '../devices/execution/blinka/dualExecutionInterface';
// import { ComparisonVisualizationPanel } from '../devices/execution/blinka/comparisonVisualizationPanel';
// import { CircuitPythonDebugProvider } from '../devices/execution/blinka/circuitPythonDebugProvider';
// Removed imports for deleted files: DeviceChannelManager, DeviceServiceIntegration, PyScriptDebugIntegration, PyScriptWorkspaceManager

/*
	TODO: The state manager needs to have a flag for whether a Python venv has been activated so
	the extension can prevent activating or initializing components that depend on Python -jef
*/

/**
 * Extension state interface for type safety
 */
export interface ExtensionState {
	context: vscode.ExtensionContext;

	// Python environment state tracking
	pythonVenvActivated: boolean;
	pythonVenvPath?: string;
	pythonDependenciesSafe: boolean; // If false, prevent Python-dependent operations

	viewProvider?: ReplViewProvider;
	editorPanelProvider?: EditorPanelProvider;
	pythonEnvManager?: PythonEnvManager;
	languageClient?: MuTwoLanguageClient;
	debugManager?: CircuitPythonDebugManager;
	terminalIntegration?: TerminalIntegration;
	fileSystemProvider?: MuTwoFileSystemProvider;
	workspaceManager?: MuTwoWorkspaceManager;
	deviceDetector?: MuDeviceDetector;
	headlessTaskProvider?: HeadlessTerminalTaskProvider;
	headlessTaskHelper?: HeadlessTaskExecutionHelper;
	// Enhanced debugging and monitoring components
	serialMonitorManager?: SerialMonitorCooperativeManager;
	unifiedDebugManager?: UnifiedDebugManager;
	enhancedSerialDebugging?: EnhancedSerialDebugging;
	replDebuggingPanel?: any; // Will be defined when component is implemented
	transactionLoggerManager?: TransactionLoggerManager;
	enhancedSerialDebugger?: EnhancedSerialDebugger;
	debugVisualizationProvider?: DebugVisualizationProvider;
	blinkaExecutionManager?: BlinkaExecutionManager;
	dualExecutionInterface?: DualExecutionInterface;
	comparisonVisualizationPanel?: ComparisonVisualizationPanel;
	// PyScript components
	circuitPythonDebugProvider?: CircuitPythonDebugProvider;
	// Removed deleted components: deviceChannelManager, deviceDriveIntegration, pyScriptDebugIntegration, pyScriptWorkspaceManager
	isActivated: boolean;
	isDisposing: boolean;
}

/**
 * Centralized state manager for the Mu Two extension
 * Provides type-safe access to extension components and lifecycle management
 */
export class ExtensionStateManager implements vscode.Disposable {
	private static _instance: ExtensionStateManager | undefined;
	private _state: ExtensionState;
	private _disposables: vscode.Disposable[] = [];
	private _stateChangeEmitter = new vscode.EventEmitter<Partial<ExtensionState>>();

	/**
	 * Event fired when extension state changes
	 */
	public readonly onStateChange = this._stateChangeEmitter.event;

	private constructor(context: vscode.ExtensionContext) {
		this._state = {
			context,
			isActivated: false,
			isDisposing: false,
			// Initialize Python environment state as unsafe
			pythonVenvActivated: false,
			pythonDependenciesSafe: false
		};

		// Register for cleanup
		this._disposables.push(this._stateChangeEmitter);
		context.subscriptions.push(this);
	}

	/**
	 * Get or create the singleton instance
	 */
	public static getInstance(context?: vscode.ExtensionContext): ExtensionStateManager {
		if (!ExtensionStateManager._instance) {
			if (!context) {
				throw new Error('ExtensionStateManager requires context for first initialization');
			}
			ExtensionStateManager._instance = new ExtensionStateManager(context);
		}
		return ExtensionStateManager._instance;
	}

	/**
	 * Check if the extension is properly initialized
	 */
	public get isInitialized(): boolean {
		return this._state.isActivated && !this._state.isDisposing;
	}

	/**
	 * Get the extension context
	 */
	public get context(): vscode.ExtensionContext {
		return this._state.context;
	}

	/**
	 * Get current state (read-only)
	 */
	public get state(): Readonly<ExtensionState> {
		return { ...this._state };
	}

	/**
	 * Update extension state with type safety and change notifications
	 */
	public updateState(updates: Partial<ExtensionState>): void {
		if (this._state.isDisposing) {
			console.warn('Attempted to update state during disposal, ignoring');
			return;
		}

		const previousState = { ...this._state };
		Object.assign(this._state, updates);

		// Emit change event with only the changed properties
		const changes: Partial<ExtensionState> = {};
		for (const key in updates) {
			if (updates.hasOwnProperty(key)) {
				changes[key] = updates[key];
			}
		}

		this._stateChangeEmitter.fire(changes);

		// Log significant state changes
		if (updates.isActivated !== undefined && updates.isActivated !== previousState.isActivated) {
			console.log(`Extension activation state changed: ${updates.isActivated}`);
		}
		if (updates.isDisposing !== undefined && updates.isDisposing !== previousState.isDisposing) {
			console.log(`Extension disposal state changed: ${updates.isDisposing}`);
		}
	}

	/**
	 * Safely get a component with type checking
	 */
	public getComponent<K extends keyof ExtensionState>(key: K): ExtensionState[K] {
		const component = this._state[key];
		if (key !== 'context' && key !== 'isActivated' && key !== 'isDisposing' && !component) {
			throw new Error(`Component '${String(key)}' is not initialized. Ensure extension is properly activated.`);
		}
		return component;
	}

	/**
	 * Safely try to get a component without throwing
	 */
	public tryGetComponent<K extends keyof ExtensionState>(key: K): ExtensionState[K] | undefined {
		return this._state[key];
	}

	/**
	 * Set a component with validation
	 */
	public setComponent<K extends keyof ExtensionState>(key: K, value: ExtensionState[K]): void {
		if (this._state.isDisposing) {
			console.warn(`Attempted to set component '${String(key)}' during disposal, ignoring`);
			return;
		}

		// Dispose previous component if it exists and is disposable
		const previous = this._state[key];
		if (previous && typeof previous === 'object' && 'dispose' in previous) {
			try {
				(previous as vscode.Disposable).dispose();
			} catch (error) {
				console.warn(`Error disposing previous component '${String(key)}':`, error);
			}
		}

		this.updateState({ [key]: value } as Partial<ExtensionState>);
	}

	/**
	 * Mark extension as activated
	 */
	public markActivated(): void {
		this.updateState({ isActivated: true });
	}

	/**
	 * Begin disposal process
	 */
	public beginDisposal(): void {
		console.log('Beginning extension state disposal...');
		this.updateState({ isDisposing: true });
	}

	/**
	 * Get connection status based on language client state
	 */
	public get isConnectedToDevice(): boolean {
		const languageClient = this.tryGetComponent('languageClient');
		// Add your connection logic here based on language client state
		return languageClient !== undefined;
	}

	/**
	 * Get workspace information
	 */
	public get workspaceInfo(): { hasWorkspace: boolean; workspaceFolders: readonly vscode.WorkspaceFolder[] | undefined } {
		return {
			hasWorkspace: !!vscode.workspace.workspaceFolders?.length,
			workspaceFolders: vscode.workspace.workspaceFolders
		};
	}

	// === Python Environment Safety Methods ===

	/**
	 * Mark Python virtual environment as successfully activated
	 */
	public setPythonVenvActivated(venvPath: string): void {
		this.updateState({
			pythonVenvActivated: true,
			pythonVenvPath: venvPath,
			pythonDependenciesSafe: true
		});
		console.log(`Python venv activated: ${venvPath}`);
	}

	/**
	 * Mark Python virtual environment as failed or unavailable
	 */
	public setPythonVenvFailed(reason?: string): void {
		this.updateState({
			pythonVenvActivated: false,
			pythonVenvPath: undefined,
			pythonDependenciesSafe: false
		});
		console.warn(`Python venv failed: ${reason || 'Unknown reason'}`);
	}

	/**
	 * Check if Python dependencies are safe to install/update
	 */
	public get isPythonDependenciesSafe(): boolean {
		return this._state.pythonDependenciesSafe === true;
	}

	/**
	 * Check if Python venv is activated
	 */
	public get isPythonVenvActivated(): boolean {
		return this._state.pythonVenvActivated === true;
	}

	/**
	 * Get Python venv path if available
	 */
	public get pythonVenvPath(): string | undefined {
		return this._state.pythonVenvPath;
	}

	/**
	 * Guard function to prevent Python-dependent operations
	 * Shows warning to user and returns false if unsafe
	 */
	public guardPythonOperation(operationName: string): boolean {
		if (this.isPythonDependenciesSafe) {
			return true;
		}

		console.warn(`Blocking Python operation '${operationName}' - venv not safely activated`);

		// TODO: Show user-friendly warning with suggestion to fix
		vscode.window.showWarningMessage(
			`Cannot ${operationName} - Mu 2 Python environment is not properly activated. ` +
			`This prevents interfering with your system Python or other virtual environments.`,
			'Learn More',
			'Retry Setup'
		).then(selection => {
			if (selection === 'Learn More') {
				// TODO: Open documentation about Python environment setup
				vscode.env.openExternal(vscode.Uri.parse('https://github.com/mu-editor/mu-two-docs/python-setup'));
			} else if (selection === 'Retry Setup') {
				// Command might not be registered yet during activation
				vscode.commands.getCommands().then(commands => {
					if (commands.includes('muTwo.setupPythonEnvironment')) {
						vscode.commands.executeCommand('muTwo.setupPythonEnvironment');
					} else {
						vscode.window.showInformationMessage('Python environment setup will be available after extension activation completes.');
					}
				});
			}
		});

		return false;
	}

	/**
	 * Guard function specifically for package installations
	 */
	public guardPythonPackageOperation(packageName: string, operationType: 'install' | 'update' | 'uninstall' = 'install'): boolean {
		return this.guardPythonOperation(`${operationType} Python package '${packageName}'`);
	}

	/**
	 * Guard function for CircuitPython-related downloads/updates
	 */
	public guardCircuitPythonOperation(operationName: string): boolean {
		return this.guardPythonOperation(`${operationName} (CircuitPython-related)`);
	}

	/**
	 * Dispose all resources
	 */
	public dispose(): void {
		console.log('Disposing extension state manager...');

		this.beginDisposal();

		// Dispose all components that support disposal
		const componentsToDispose = [
			'viewProvider',
			'editorPanelProvider',
			'pythonEnvManager',
			'languageClient',
			'debugManager',
			// 'terminalIntegration',
			'fileSystemProvider',
			'workspaceManager',
			'deviceDetector',
			// 'headlessTaskProvider',
			// 'headlessTaskHelper',
			'serialMonitorManager',
			'unifiedDebugManager',
			// 'enhancedSerialDebugging',
			// 'replDebuggingPanel',
			'transactionLoggerManager',
			// 'enhancedSerialDebugger',
			'debugVisualizationProvider',
			'blinkaExecutionManager',
			'dualExecutionInterface',
			'comparisonVisualizationPanel',
			// Removed references to deleted components: deviceDriveIntegration
		] as const;

		for (const componentKey of componentsToDispose) {
			const component = this._state[componentKey];
			if (component && typeof component === 'object' && 'dispose' in component) {
				try {
					(component as vscode.Disposable).dispose();
					console.log(`Disposed component: ${componentKey}`);
				} catch (error) {
					console.error(`Error disposing component ${componentKey}:`, error);
				}
			}
		}

		// Dispose internal resources
		this._disposables.forEach(d => {
			try {
				d.dispose();
			} catch (error) {
				console.error('Error disposing internal resource:', error);
			}
		});

		this._disposables.length = 0;

		// Clear singleton
		ExtensionStateManager._instance = undefined;
	}
}

/**
 * Convenience function to get the state manager instance
 * Throws if not initialized
 */
export function getExtensionState(): ExtensionStateManager {
	const instance = ExtensionStateManager.getInstance();
	if (!instance.isInitialized) {
		throw new Error('Extension state manager not initialized. Call during or after activation.');
	}
	return instance;
}

/**
 * Convenience function to safely try to get the state manager
 * Returns undefined if not initialized
 */
export function tryGetExtensionState(): ExtensionStateManager | undefined {
	try {
		return ExtensionStateManager.getInstance();
	} catch {
		return undefined;
	}
}