// src/sys/boardManager.ts
// Board Manager - the "phone directory" system for board tracking and workspace integration

import * as vscode from 'vscode';
import { DeviceManager } from '../core/deviceManager';
import { MuTwoLanguageClient } from '../core/client';
import { CtpyDeviceFileSystemProvider } from '../../workspace/filesystem/ctpyDeviceFSProvider'
import { MuDeviceDetector, IDevice, MuDevice } from '../core/deviceDetector';
import { getDeviceRegistry, RegisteredDevice } from '../core/deviceRegistry';
// import { BoardFactory } from '../../utils/usbBoard'; // Circular dependency - temporarily commented out
import { getLogger } from '../../utils/unifiedLogger';
import { getDevLogger } from '../../utils/devLogger';

export type BoardType = 'usb' | 'ble' | 'virtual';

export interface BoardConnectionState {
    connected: boolean;
    connecting: boolean;
    error?: string;
    lastConnected?: Date;
    deviceInfo?: DeviceInfo;
}

export interface DeviceInfo {
    path: string;
    baudRate?: number;
    boardId?: string;
    displayName?: string;
    version?: string;
}

export interface BoardCapabilities {
    hasFileSystem: boolean;
    hasRepl: boolean;
    supportsDebugging: boolean;
    supportsFileTransfer: boolean;
    supportsBluetooth?: boolean;
    maxFileSize?: number;
}

export interface ExecutionResult {
    success: boolean;
    output?: string;
    error?: string;
    executionTime?: number;
}

export interface FileInfo {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size?: number;
    modified?: Date;
}

/**
 * Primary Board interface - this IS the system, not an addition to it
 */
export interface IBoard {
    readonly id: string;
    readonly name: string;
    readonly type: BoardType;
    readonly connectionState: BoardConnectionState;
    readonly capabilities: BoardCapabilities;

    // Connection management
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;

    // Code execution
    eval(code: string): Promise<ExecutionResult>;
    executeFile(filePath: string): Promise<ExecutionResult>;
    interrupt(): Promise<void>;
    restart(): Promise<void>;

    // File operations
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    listFiles(path?: string): Promise<FileInfo[]>;
    deleteFile(path: string): Promise<void>;

    // REPL operations
    createReplSession(): Promise<string>;
    sendToRepl(sessionId: string, command: string): Promise<string>;
    closeReplSession(sessionId: string): Promise<void>;

    // Events
    onConnectionStateChanged: vscode.Event<BoardConnectionState>;
    onFileSystemChanged: vscode.Event<{ type: 'created' | 'modified' | 'deleted'; path: string }>;
    onReplOutput: vscode.Event<{ sessionId: string; output: string; type: 'stdout' | 'stderr' | 'input'; timestamp: Date }>;

    dispose(): void;
}

/**
 * USB CircuitPython Board - primary implementation
 */
export class UsbCircuitPythonBoard implements IBoard {
	private _connectionState: BoardConnectionState
	private _onConnectionStateChanged =
		new vscode.EventEmitter<BoardConnectionState>()
	private _onFileSystemChanged = new vscode.EventEmitter<{
		type: 'created' | 'modified' | 'deleted'
		path: string
	}>()
	private _onReplOutput = new vscode.EventEmitter<{
		sessionId: string
		output: string
		type: 'stdout' | 'stderr' | 'input'
		timestamp: Date
	}>()

	public readonly onConnectionStateChanged =
		this._onConnectionStateChanged.event
	public readonly onFileSystemChanged = this._onFileSystemChanged.event
	public readonly onReplOutput = this._onReplOutput.event

	public readonly type: BoardType = 'usb'
	public readonly capabilities: BoardCapabilities = {
		hasFileSystem: true,
		hasRepl: true,
		supportsDebugging: true,
		supportsFileTransfer: true,
		maxFileSize: 2 * 1024 * 1024,
	}

	constructor(
		public readonly id: string,
		public readonly name: string,
		private deviceInfo: DeviceInfo,
		private deviceManager: DeviceManager,
		private languageClient: MuTwoLanguageClient,
		private fileSystemProvider: CtpyDeviceFileSystemProvider
	) {
		this._connectionState = {
			connected: false,
			connecting: false,
			deviceInfo: this.deviceInfo,
		}

		this.setupEventForwarding()
	}

	public get connectionState(): BoardConnectionState {
		return { ...this._connectionState }
	}

	public async connect(): Promise<void> {
		this.setConnectionState({ connecting: true, connected: false })

		try {
			const success = await this.deviceManager.attachToDevice(
				this.deviceInfo.path,
				this.deviceInfo.baudRate || 115200
			)

			if (success) {
				this.fileSystemProvider.registerBoard(this.id, this.deviceInfo.path)
				this.setConnectionState({
					connected: true,
					connecting: false,
					lastConnected: new Date(),
				})
			} else {
				throw new Error('Failed to attach to device')
			}
		} catch (error) {
			this.setConnectionState({
				connected: false,
				connecting: false,
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	public async disconnect(): Promise<void> {
		try {
			await this.deviceManager.stopDebugSession()
			this.fileSystemProvider.unregisterBoard(this.id)
			this.setConnectionState({ connected: false, connecting: false })
		} catch (error) {
			console.error('Error during disconnect:', error)
		}
	}

	public isConnected(): boolean {
		return this._connectionState.connected
	}

	public async eval(code: string): Promise<ExecutionResult> {
		if (!this.isConnected()) {
			throw new Error('Board not connected')
		}

		try {
			await this.deviceManager.sendToRepl(code)
			return {
				success: true,
				output: `Executed: ${code}`,
				executionTime: 0,
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	public async executeFile(filePath: string): Promise<ExecutionResult> {
		if (!this.isConnected()) {
			throw new Error('Board not connected')
		}

		try {
			const success = await this.deviceManager.uploadAndRun(filePath)
			return {
				success,
				output: success ? `Executed file: ${filePath}` : undefined,
				error: success ? undefined : 'Failed to execute file',
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			}
		}
	}

	public async interrupt(): Promise<void> {
		if (!this.isConnected()) throw new Error('Board not connected')
		await this.deviceManager.sendToRepl('\x03')
	}

	public async restart(): Promise<void> {
		if (!this.isConnected()) throw new Error('Board not connected')
		await this.deviceManager.restartDevice()
	}

	public async readFile(path: string): Promise<string> {
		if (!this.isConnected()) throw new Error('Board not connected')
		const uri = vscode.Uri.parse(`ctpy://${this.id}${path}`)
		const content = await this.fileSystemProvider.readFile(uri)
		return new TextDecoder().decode(content)
	}

	public async writeFile(path: string, content: string): Promise<void> {
		if (!this.isConnected()) throw new Error('Board not connected')
		const uri = vscode.Uri.parse(`ctpy://${this.id}${path}`)
		const encoded = new TextEncoder().encode(content)
		await this.fileSystemProvider.writeFile(uri, encoded, {
			create: true,
			overwrite: true,
		})
	}

	public async listFiles(path: string = '/'): Promise<FileInfo[]> {
		if (!this.isConnected()) throw new Error('Board not connected')
		const uri = vscode.Uri.parse(`ctpy://${this.id}${path}`)
		const entries = await this.fileSystemProvider.readDirectory(uri)

		return entries.map(([name, type]) => ({
			name,
			path: `${path}${path.endsWith('/') ? '' : '/'}${name}`,
			type: type === vscode.FileType.Directory ? 'directory' : 'file',
		}))
	}

	public async deleteFile(path: string): Promise<void> {
		if (!this.isConnected()) throw new Error('Board not connected')
		const uri = vscode.Uri.parse(`ctpy://${this.id}${path}`)
		await this.fileSystemProvider.delete(uri, { recursive: false })
	}

	public async createReplSession(): Promise<string> {
		if (!this.isConnected()) throw new Error('Board not connected')
		return await this.languageClient.createSession('repl', {
			enableCompletion: true,
			enableHistory: true,
		})
	}

	public async sendToRepl(
		sessionId: string,
		command: string
	): Promise<string> {
		if (!this.isConnected()) throw new Error('Board not connected')
		const result = await this.languageClient.executeText(sessionId, command)
		return result.output || result.error || ''
	}

	public async closeReplSession(sessionId: string): Promise<void> {
		await this.languageClient.closeSession(sessionId)
	}

	private setupEventForwarding(): void {
		this.deviceManager.onDidSessionStart(() => {
			this.setConnectionState({ connected: true, connecting: false })
		})

		this.deviceManager.onDidSessionEnd(() => {
			this.setConnectionState({ connected: false, connecting: false })
		})

		this.languageClient.onTextData((data) => {
			this._onReplOutput.fire({
				sessionId: data.sessionId,
				output: data.content,
				type: data.type === 'input' ? 'input' : 'stdout',
				timestamp: new Date(data.timestamp),
			})
		})

		this.fileSystemProvider.onDidChangeFile((events) => {
			events.forEach((event) => {
				if (event.uri.authority === this.id) {
					this._onFileSystemChanged.fire({
						type:
							event.type === vscode.FileChangeType.Created
								? 'created'
								: event.type === vscode.FileChangeType.Changed
								? 'modified'
								: 'deleted',
						path: event.uri.path,
					})
				}
			})
		})
	}

	private setConnectionState(state: Partial<BoardConnectionState>): void {
		this._connectionState = { ...this._connectionState, ...state }
		this._onConnectionStateChanged.fire(this.connectionState)
	}

	public dispose(): void {
		this.disconnect()
		this._onConnectionStateChanged.dispose()
		this._onFileSystemChanged.dispose()
		this._onReplOutput.dispose()
	}
}

/**
 * Board Manager - the "phone directory" system
 *
 * Responsible for:
 * - Board discovery and tracking (who's available to call)
 * - Device selection UI and information displays
 * - Workspace integration and board associations
 * - Global storage of board-workspace mappings
 * - Board registry and lookup services
 */
export class BoardManager {
	private boards = new Map<string, IBoard>()
	private _onBoardAdded = new vscode.EventEmitter<IBoard>()
	private _onBoardRemoved = new vscode.EventEmitter<IBoard>()
	private _onBoardConnectionChanged = new vscode.EventEmitter<{
		board: IBoard
		state: BoardConnectionState
	}>()

	public readonly onBoardAdded = this._onBoardAdded.event
	public readonly onBoardRemoved = this._onBoardRemoved.event
	public readonly onBoardConnectionChanged =
		this._onBoardConnectionChanged.event

	private _workspaceBoardMap = new Map<string, string>() // workspace -> boardId
	private _logger = getLogger()

	constructor(
		private context: vscode.ExtensionContext,
		private deviceManager: DeviceManager,
		private languageClient: MuTwoLanguageClient,
		private fileSystemProvider: CtpyDeviceFileSystemProvider
	) {
		// Using unified logger instead of separate output channel
		// Phase 2: DeviceRegistry replaces deviceDetector parameter
		this.loadWorkspaceBoardMappings()
	}

	public async initialize(): Promise<void> {
		await this.refreshDevices()
	}

	public addBoard(board: IBoard): void {
		this.boards.set(board.id, board)

		board.onConnectionStateChanged((state) => {
			this._onBoardConnectionChanged.fire({ board, state })
		})

		this._onBoardAdded.fire(board)
	}

	public removeBoard(boardId: string): void {
		const board = this.boards.get(boardId)
		if (board) {
			board.dispose()
			this.boards.delete(boardId)
			this._onBoardRemoved.fire(board)
		}
	}

	public getBoard(boardId: string): IBoard | undefined {
		return this.boards.get(boardId)
	}

	public getAllBoards(): IBoard[] {
		return Array.from(this.boards.values())
	}

	public getConnectedBoards(): IBoard[] {
		return this.getAllBoards().filter((board) => board.isConnected())
	}

	public getBoardsByType(type: BoardType): IBoard[] {
		return this.getAllBoards().filter((board) => board.type === type)
	}

	/**
	 * Primary device detection - replaces the old scattered detection logic
	 * Now uses DeviceRegistry for single source of truth
	 */
	public async refreshDevices(): Promise<void> {
		try {
			const devLogger = getDevLogger();
			const deviceRegistry = getDeviceRegistry();

			// Get CircuitPython devices from registry
			const devices = deviceRegistry.getCircuitPythonDevices();
			devLogger.board(`Refreshing boards: found ${devices.length} CircuitPython devices`);

			// Remove boards that are no longer detected
			const currentBoardIds = new Set(this.boards.keys());
			const detectedBoardIds = new Set<string>();

			// Create/update enhanced boards from detected devices
			for (const device of devices) {
				const boardId = device.boardId ||
					`usb-${device.path.replace(/[^a-zA-Z0-9]/g, '-')}`;
				detectedBoardIds.add(boardId);

				if (!this.boards.has(boardId)) {
					// Import the enhanced board factory
					const { BoardFactory } = await import('../../utils/usbBoard');

					const board = BoardFactory.createUsbBoard({
						path: device.path,
						boardId: device.boardId,
						displayName: device.displayName,
					});

					this.addBoard(board);
					devLogger.board(`Added board: ${device.displayName} (${boardId})`);
				}
			}

			// Remove boards that are no longer detected
			for (const boardId of currentBoardIds) {
				if (!detectedBoardIds.has(boardId)) {
					devLogger.board(`Removing board: ${boardId}`);
					this.removeBoard(boardId);
				}
			}
		} catch (error) {
			console.error('Failed to refresh devices:', error)
			throw error
		}
	}

	/**
	 * Get the best board for automatic operations
	 */
	public getBestBoard(): IBoard | undefined {
		const connected = this.getConnectedBoards()
		if (connected.length > 0) {
			return connected[0]
		}

		const available = this.getAllBoards()
		return available.length > 0 ? available[0] : undefined
	}

	/**
	 * Connect to the best available board
	 */
	public async connectToBestBoard(): Promise<IBoard | undefined> {
		const board = this.getBestBoard()
		if (board && !board.isConnected()) {
			await board.connect()
		}
		return board
	}

	/**
	 * Detect available CircuitPython devices - core "phone directory" function
	 * Now uses DeviceRegistry
	 */
	public async detectDevices(): Promise<void> {
		try {
			const devLogger = getDevLogger();
			const deviceRegistry = getDeviceRegistry();

			devLogger.board('Detecting CircuitPython devices...');

			// Refresh device registry
			const allDevices = await deviceRegistry.refresh();
			const cpDevices = deviceRegistry.getCircuitPythonDevices();

			devLogger.board('Detection Results:');
			devLogger.board(`- Total serial devices: ${allDevices.length}`);
			devLogger.board(`- CircuitPython devices: ${cpDevices.length}`);

			if (cpDevices.length > 0) {
				devLogger.board('\nFound CircuitPython devices:');
				for (let i = 0; i < cpDevices.length; i++) {
					const device = cpDevices[i];
					devLogger.board(`${i + 1}. ${device.displayName}`);
					devLogger.board(`   Path: ${device.path}`);
					devLogger.board(`   Confidence: ${device.confidence}`);
					if (device.boardId) {
						devLogger.board(`   Board: ${device.boardId}`);
					}
				}
			}

			// Note: DeviceRegistry doesn't track database stats like MuDeviceDetector did
			// This information is less critical now that we have centralized detection

			// Update our board registry
			await this.refreshDevices()
		} catch (error) {
			vscode.window.showErrorMessage(`Device detection failed: ${error}`)
			this._logger.error('BOARD_MANAGER', `Error: ${error}`)
		}
	}

	/**
	 * Show device information dialog
	 */
	public async showDeviceInfo(): Promise<void> {
		try {
			const bestDevice = await this.deviceDetector.getBestDevice()

			if (bestDevice) {
				const deviceInfo = await this.deviceDetector.getDeviceInfo(
					bestDevice
				)
				await vscode.window.showInformationMessage(
					'CircuitPython Device Information',
					{ modal: true, detail: deviceInfo }
				)
			} else {
				vscode.window.showWarningMessage('No CircuitPython devices found')
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to get device info: ${error}`)
		}
	}

	/**
	 * Show device selection dialog
	 */
	public async selectDevice(): Promise<IBoard | undefined> {
		try {
			const result = await this.deviceDetector.detectDevices()

			if (result.devices.length === 0) {
				vscode.window.showWarningMessage('No CircuitPython devices found')
				return undefined
			}

			const selectedDevice =
				await this.deviceDetector.showDeviceSelectionDialog(result.devices)

			if (selectedDevice) {
				const deviceInfo = await this.deviceDetector.getDeviceInfo(
					selectedDevice
				)
				const attach = await vscode.window.showInformationMessage(
					`Selected: ${selectedDevice.displayName}`,
					{ modal: true, detail: deviceInfo },
					'Add to Workspace',
					'Connect Now'
				)

				if (attach) {
					// Find or create board for this device
					let board = this.getBoardByDevicePath(selectedDevice.path)
					if (!board) {
						await this.refreshDevices() // Ensure board is created
						board = this.getBoardByDevicePath(selectedDevice.path)
					}

					if (board) {
						if (attach === 'Add to Workspace') {
							await this.associateBoardWithWorkspace(board.id)
						} else if (attach === 'Connect Now') {
							await board.connect()
						}
						return board
					}
				}
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Device selection failed: ${error}`)
		}
		return undefined
	}

	/**
	 * Get device detection results for integration
	 * Now uses DeviceRegistry
	 */
	public async getDetectedDevices(): Promise<RegisteredDevice[]> {
		const deviceRegistry = getDeviceRegistry();
		return deviceRegistry.getCircuitPythonDevices();
	}

	/**
	 * Get the best available device from detector
	 * Now uses DeviceRegistry - returns first CircuitPython device
	 */
	public async getBestDevice(): Promise<RegisteredDevice | undefined> {
		const deviceRegistry = getDeviceRegistry();
		const devices = deviceRegistry.getCircuitPythonDevices();
		// Return highest confidence device
		return devices.sort((a, b) => {
			const confidenceOrder = { high: 3, medium: 2, low: 1 };
			return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
		})[0];
	}

	/**
	 * Get device by path lookup
	 * Now uses DeviceRegistry
	 */
	public async getDeviceByPath(path: string): Promise<RegisteredDevice | undefined> {
		const deviceRegistry = getDeviceRegistry();
		return deviceRegistry.getDeviceByPath(path);
	}

	/**
	 * Find device by board ID lookup
	 * Now uses DeviceRegistry
	 */
	public async getDeviceByBoardId(
		boardId: string
	): Promise<RegisteredDevice | undefined> {
		const deviceRegistry = getDeviceRegistry();
		const devices = deviceRegistry.getCircuitPythonDevices();
		return devices.find((device) => device.boardId === boardId);
	}

	/**
	 * Get board by device path
	 */
	public getBoardByDevicePath(devicePath: string): IBoard | undefined {
		return this.getAllBoards().find((board) => {
			// Access the deviceInfo through the board's connection state
			const state = board.connectionState;
			return state.deviceInfo?.path === devicePath;
		});
	}


	// === Workspace Integration Methods ===

	/**
	 * Associate a board with the current workspace
	 */
	public async associateBoardWithWorkspace(boardId: string): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) {
			vscode.window.showWarningMessage('No workspace folder is open')
			return
		}

		const workspaceKey = workspaceFolder.uri.fsPath
		this._workspaceBoardMap.set(workspaceKey, boardId)

		await this.saveWorkspaceBoardMappings()

		this._logger.info(
			'BOARD_MANAGER',
			`Associated board ${boardId} with workspace: ${workspaceKey}`
		)
		vscode.window.showInformationMessage(
			`Board associated with this workspace`
		)
	}

	/**
	 * Get the board associated with current workspace
	 */
	public getWorkspaceBoard(): IBoard | undefined {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) return undefined

		const workspaceKey = workspaceFolder.uri.fsPath
		const boardId = this._workspaceBoardMap.get(workspaceKey)

		return boardId ? this.getBoard(boardId) : undefined
	}

	/**
	 * Get all workspace-board associations
	 */
	public getWorkspaceBoardMappings(): Map<string, string> {
		return new Map(this._workspaceBoardMap)
	}

	/**
	 * Remove board association from workspace
	 */
	public async removeWorkspaceBoardAssociation(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) return

		const workspaceKey = workspaceFolder.uri.fsPath
		this._workspaceBoardMap.delete(workspaceKey)

		await this.saveWorkspaceBoardMappings()
		vscode.window.showInformationMessage(
			'Board association removed from workspace'
		)
	}

	/**
	 * Connect to workspace-associated board or show selection
	 */
	public async connectToWorkspaceBoard(): Promise<IBoard | undefined> {
		let board = this.getWorkspaceBoard()

		if (!board) {
			// No association, show selection dialog
			const selection = await vscode.window.showInformationMessage(
				'No board is associated with this workspace.',
				'Select Board',
				'Auto-detect'
			)

			if (selection === 'Select Board') {
				board = await this.selectDevice()
			} else if (selection === 'Auto-detect') {
				board = this.getBestBoard()
				if (board) {
					await this.associateBoardWithWorkspace(board.id)
				}
			}
		}

		if (board && !board.isConnected()) {
			await board.connect()
		}

		return board
	}

	/**
	 * Load workspace-board mappings from global storage
	 */
	private loadWorkspaceBoardMappings(): void {
		try {
			const mappings = this.context.globalState.get<Record<string, string>>(
				'workspaceBoardMappings',
				{}
			)
			this._workspaceBoardMap = new Map(Object.entries(mappings))
			this._logger.info(
				'BOARD_MANAGER',
				`Loaded ${this._workspaceBoardMap.size} workspace-board mappings`
			)
		} catch (error) {
			this._logger.error(
				'BOARD_MANAGER',
				`Failed to load workspace mappings: ${error}`
			)
		}
	}

	/**
	 * Save workspace-board mappings to global storage
	 */
	private async saveWorkspaceBoardMappings(): Promise<void> {
		try {
			const mappings = Object.fromEntries(this._workspaceBoardMap)
			await this.context.globalState.update(
				'workspaceBoardMappings',
				mappings
			)
			this._logger.info(
				'BOARD_MANAGER',
				`Saved ${this._workspaceBoardMap.size} workspace-board mappings`
			)
		} catch (error) {
			this._logger.error(
				'BOARD_MANAGER',
				`Failed to save workspace mappings: ${error}`
			)
		}
	}

	public dispose(): void {
		this.getAllBoards().forEach((board) => board.dispose())
		this.boards.clear()
		this._onBoardAdded.dispose()
		this._onBoardRemoved.dispose()
		this._onBoardConnectionChanged.dispose()
		// Using unified logger - no disposal needed
	}
}