import * as vscode from 'vscode';
import { MuDebugAdapter } from '../common/debugAdapter';
import { IDevice, MuDevice } from './deviceDetector';
import { SerialMonitorCooperativeManager } from './serialMonitorCooperativeManager';
import { getLogger } from '../../utils/unifiedLogger';

/**
 * Device Connection State
 */
export interface DeviceConnectionState {
	isConnected: boolean;
	isConnecting: boolean;
	port?: string;
	baudRate?: number;
	lastError?: string;
	lastConnected?: Date;
	connectionAttempts: number;
}

/**
 * Device Configuration for DAP
 */
export interface DeviceConfiguration {
	port: string;
	baudRate: number;
	enableRepl: boolean;
	autoDetect: boolean;
	device?: MuDevice;
	/** Runtime type for this device connection */
	runtime?: 'circuitpython' | 'micropython' | 'python';
}

/**
 * Mu Two Device Manager
 *
 * Runtime-agnostic device management supporting CircuitPython, MicroPython, and Python.
 * Maintains CircuitPython as flagship experience while enabling multi-runtime support.
 *
 * Responsible for:
 * - Managing device connection state and configuration
 * - Preparing debug adapter with proper connection parameters
 * - Runtime selection and device compatibility
 * - Low-level serial communication setup
 */
export class DeviceManager implements vscode.DebugAdapterDescriptorFactory {
	private _connectionStates = new Map<string, DeviceConnectionState>();
	private _activeSession: vscode.DebugSession | null = null;
	private _logger = getLogger();
	private _onDidSessionStart = new vscode.EventEmitter<vscode.DebugSession>();
	private _onDidSessionEnd = new vscode.EventEmitter<vscode.DebugSession>();
	private _onConnectionStateChanged = new vscode.EventEmitter<{device: IDevice, state: DeviceConnectionState}>();

	public readonly onDidSessionStart = this._onDidSessionStart.event;
	public readonly onDidSessionEnd = this._onDidSessionEnd.event;
	public readonly onConnectionStateChanged = this._onConnectionStateChanged.event;

	constructor(
		private context: vscode.ExtensionContext,
		private serialMonitorManager?: SerialMonitorCooperativeManager
	) {
		// Using unified logger instead of separate output channel
	}

	/**
	 * Register the device manager with VS Code
	 */
	public register(): vscode.Disposable[] {
		const disposables: vscode.Disposable[] = [];

		// Register debug adapter descriptor factory
		disposables.push(
			vscode.debug.registerDebugAdapterDescriptorFactory('circuitpython', this)
		);

		// Track debug sessions for connection state
		disposables.push(
			vscode.debug.onDidStartDebugSession(session => {
				if (session.type === 'circuitpython') {
					this._activeSession = session;
					this._onDidSessionStart.fire(session);
					this._updateConnectionState(session.configuration?.port, {
						isConnected: true,
						isConnecting: false,
						lastConnected: new Date(),
						connectionAttempts: 0
					});
				}
			})
		);

		disposables.push(
			vscode.debug.onDidTerminateDebugSession(session => {
				if (session.type === 'circuitpython') {
					this._activeSession = null;
					this._onDidSessionEnd.fire(session);
					this._updateConnectionState(session.configuration?.port, {
						isConnected: false,
						isConnecting: false
					});
				}
			})
		);

		return disposables;
	}

	/**
	 * Create debug adapter descriptor - prepares the execution environment
	 */
	createDebugAdapterDescriptor(
		session: vscode.DebugSession,
		executable: vscode.DebugAdapterExecutable | undefined
	): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
		// Prepare debug adapter with connection configuration
		const adapter = new MuDebugAdapter();
		return new vscode.DebugAdapterInlineImplementation(adapter);
	}

	/**
	 * Configure device for connection - prepare the "phone lines"
	 */
	public async configureDevice(device: IDevice, options: Partial<DeviceConfiguration> = {}): Promise<DeviceConfiguration> {
		const config: DeviceConfiguration = {
			port: device.path,
			baudRate: options.baudRate || 115200,
			enableRepl: options.enableRepl !== false,
			autoDetect: options.autoDetect !== false,
			device: device
		};

		// Check serial monitor conflicts
		await this._checkSerialMonitorConflicts(config);

		return config;
	}

	/**
	 * Get connection state for a device
	 */
	public getConnectionState(devicePath: string): DeviceConnectionState | undefined {
		return this._connectionStates.get(devicePath);
	}

	/**
	 * Set connection state for a device
	 */
	public setConnectionState(devicePath: string, state: Partial<DeviceConnectionState>): void {
		this._updateConnectionState(devicePath, state);
	}

	/**
	 * Check if device connection is ready
	 */
	public isDeviceReady(devicePath: string): boolean {
		const state = this._connectionStates.get(devicePath);
		return state?.isConnected === true && !state.isConnecting;
	}

	/**
	 * Prepare debug session with device configuration
	 */
	public async prepareDebugSession(config: DeviceConfiguration): Promise<vscode.DebugConfiguration> {
		// Set connection state to connecting
		this._updateConnectionState(config.port, {
			isConnecting: true,
			isConnected: false,
			port: config.port,
			baudRate: config.baudRate,
			connectionAttempts: (this._connectionStates.get(config.port)?.connectionAttempts || 0) + 1
		});

		return {
			name: `Device ${config.device?.displayName || config.port}`,
			type: 'circuitpython',
			request: 'attach',
			port: config.port,
			baudRate: config.baudRate,
			enableRepl: config.enableRepl,
			autoDetect: config.autoDetect
		};
	}

	/**
	 * Start debug session with prepared configuration
	 */
	public async startDebugSession(config: vscode.DebugConfiguration): Promise<boolean> {
		try {
			const success = await vscode.debug.startDebugging(undefined, config);
			if (!success && config.port) {
				this._updateConnectionState(config.port, {
					isConnecting: false,
					lastError: 'Failed to start debug session'
				});
			}
			return success;
		} catch (error) {
			if (config.port) {
				this._updateConnectionState(config.port, {
					isConnecting: false,
					lastError: error instanceof Error ? error.message : String(error)
				});
			}
			throw error;
		}
	}

	/**
	 * Stop the active debug session
	 */
	public async stopDebugSession(): Promise<void> {
		if (this._activeSession) {
			await vscode.debug.stopDebugging(this._activeSession);
		}
	}

	/**
	 * Get active debug session
	 */
	public getActiveSession(): vscode.DebugSession | null {
		return this._activeSession;
	}

	/**
	 * Check if a debug session is active
	 */
	public isSessionActive(): boolean {
		return this._activeSession !== null;
	}

	/**
	 * Attach to device - establish connection and start debug session
	 */
	public async attachToDevice(devicePath: string, baudRate: number = 115200): Promise<boolean> {
		try {
			// Create device configuration
			const device: IDevice = {
				path: devicePath,
				confidence: 'medium',
				displayName: `Device at ${devicePath}`,
				hasConflict: false
			};
			const config = await this.configureDevice(device, { baudRate });
			
			// Prepare and start debug session
			const debugConfig = await this.prepareDebugSession(config);
			return await this.startDebugSession(debugConfig);
		} catch (error) {
			this._logger.error('DEVICE_MANAGER', `Failed to attach to device ${devicePath}: ${error}`);
			return false;
		}
	}

	/**
	 * Upload and run a file on the connected device
	 */
	public async uploadAndRun(filePath: string): Promise<boolean> {
		if (!this._activeSession) {
			throw new Error('No active debug session');
		}

		try {
			const result = await this._activeSession.customRequest('uploadAndRun', {
				filePath: filePath
			});
			return result?.success === true;
		} catch (error) {
			this._logger.error('DEVICE_MANAGER', `Failed to upload and run file: ${error}`);
			return false;
		}
	}

	/**
	 * Send command to active debug session (REPL communication)
	 */
	public async sendToRepl(command: string): Promise<void> {
		if (this._activeSession) {
			await this._activeSession.customRequest('evaluate', {
				expression: command,
				context: 'repl'
			});
		} else {
			throw new Error('No active debug session');
		}
	}

	/**
	 * Restart device (soft reboot)
	 */
	public async restartDevice(): Promise<void> {
		if (this._activeSession) {
			await this._activeSession.customRequest('restart');
		} else {
			throw new Error('No active debug session');
		}
	}

	/**
	 * Update connection state and notify listeners
	 */
	private _updateConnectionState(devicePath: string, state: Partial<DeviceConnectionState>): void {
		const current = this._connectionStates.get(devicePath) || {
			isConnected: false,
			isConnecting: false,
			connectionAttempts: 0
		};

		const updated = { ...current, ...state };
		this._connectionStates.set(devicePath, updated);

		// Find the associated device if available
		// Note: This would ideally be injected by boardManager
		// For now, we emit with path only
		this._onConnectionStateChanged.fire({
			device: { path: devicePath } as IDevice,
			state: updated
		});
	}










	/**
	 * Check for serial monitor conflicts before connection
	 */
	private async _checkSerialMonitorConflicts(config: DeviceConfiguration): Promise<void> {
		if (!this.serialMonitorManager || !config.port) {
			return;
		}

		const conflictAction = await this.serialMonitorManager.handlePortConflict(config.port, config.baudRate);
		
		if (conflictAction === 'cancel') {
			throw new Error('Connection cancelled due to port conflict');
		} else if (conflictAction === 'redirect') {
			throw new Error('Port redirected to Serial Monitor - connection not established');
		}

		this._logger.info('DEVICE_MANAGER', `✅ Serial monitor conflict check passed for port ${config.port}`);
	}

	/**
	 * Dispose resources
	 */
	public dispose(): void {
		// No longer using separate output channel - using unified logger
		this._onDidSessionStart.dispose();
		this._onDidSessionEnd.dispose();
		this._onConnectionStateChanged.dispose();
	}
}

/**
 * Debug configuration provider for CircuitPython
 */
class CircuitPythonDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
	
	/**
	 * Resolve debug configuration
	 */
	resolveDebugConfiguration(
		folder: vscode.WorkspaceFolder | undefined,
		config: vscode.DebugConfiguration,
		token?: vscode.CancellationToken
	): vscode.ProviderResult<vscode.DebugConfiguration> {
		
		// If no configuration is provided, return default
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'python') {
				config.type = 'circuitpython';
				config.name = 'Launch CircuitPython';
				config.request = 'launch';
				config.program = editor.document.fileName;
				config.autoDetect = true;
				config.enableRepl = true;
			}
		}

		// Set defaults for missing properties
		if (config.type === 'circuitpython') {
			config.autoDetect = config.autoDetect !== false;
			config.enableRepl = config.enableRepl !== false;
			config.baudRate = config.baudRate || 115200;
		}

		return config;
	}

	/**
	 * Provide initial debug configurations
	 */
	provideDebugConfigurations(
		folder: vscode.WorkspaceFolder | undefined,
		token?: vscode.CancellationToken
	): vscode.ProviderResult<vscode.DebugConfiguration[]> {
		return [
			{
				name: 'CircuitPython: Launch REPL',
				type: 'circuitpython',
				request: 'launch',
				autoDetect: true,
				enableRepl: true
			},
			{
				name: 'CircuitPython: Upload Current File',
				type: 'circuitpython',
				request: 'launch',
				program: '${file}',
				autoDetect: true,
				enableRepl: true
			},
			{
				name: 'CircuitPython: Attach to Device',
				type: 'circuitpython',
				request: 'attach',
				port: '${input:serialPort}',
				baudRate: 115200
			}
		];
	}
}