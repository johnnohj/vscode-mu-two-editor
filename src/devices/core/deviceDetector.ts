import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import { getLogger } from '../../sys/unifiedLogger';
const deviceDatabase = import('../../data/circuitpython_devices.json');
const detectionHelpers = import('../../data/detection_helpers.json');

/**
 * Generic device interface - abstraction for detected hardware devices
 */
export interface IDevice {
	/** Serial port path */
	path: string;
	/** USB Vendor ID */
	vendorId?: string;
	/** USB Product ID */
	productId?: string;
	/** Device manufacturer name */
	manufacturer?: string;
	/** Product name/description */
	product?: string;
	/** Board identifier */
	boardId?: string;
	/** Detection confidence level */
	confidence: 'high' | 'medium' | 'low';
	/** Human-readable display name */
	displayName: string;
	/** Whether this device has conflicting VID:PID with others */
	hasConflict: boolean;
}

/**
 * Mu Two compatible device implementation
 * Supports CircuitPython, MicroPython, and other Python runtimes
 */
export interface MuDevice extends IDevice {
	/** Board identifier (runtime-agnostic) */
	boardId?: string;
	/** Hardware port type (e.g., 'atmel-samd', 'espressif', 'esp32') */
	portType?: string;
	/** Supported runtime types for this device */
	supportedRuntimes?: ('circuitpython' | 'micropython' | 'python')[];
	/** Primary/preferred runtime for this device */
	primaryRuntime?: 'circuitpython' | 'micropython' | 'python';
}


export interface DetectionResult {
	devices: MuDevice[];
	conflicts: VidPidConflict[];
	totalDevices: number;
	supportedDevices: number;
	circuitPythonDevices: MuDevice[];
}

export interface VidPidConflict {
	vidPid: string;
	conflictingBoards: string[];
	detectedDevice: MuDevice;
}

export interface DeviceEvent {
	type: 'added' | 'removed' | 'changed';
	device: MuDevice;
}

/**
 * Mu Two Device Detector
 *
 * Enhanced device detection supporting multiple Python runtimes.
 * Maintains CircuitPython as flagship while supporting MicroPython and others.
 */
export class MuDeviceDetector implements vscode.Disposable {
	private _deviceDatabase: any;
	private _detectionHelpers: any;
	private _logger = getLogger();
	private _usbEventEmitter = new vscode.EventEmitter<DeviceEvent>();
	private _disposables: vscode.Disposable[] = [];
	private _lastDetectionResult: DetectionResult | null = null;
	private _detectionInProgress = false;

	// USB event API - make this the primary interface for device changes
	public readonly onDeviceChanged = this._usbEventEmitter.event;

	constructor() {
		this._deviceDatabase = deviceDatabase;
		this._detectionHelpers = detectionHelpers;
		// Note: Currently uses CircuitPython database as flagship, will expand for multi-runtime
		// Using unified logger instead of separate output channel

		// Initialize USB event monitoring as first-line strategy
		this.initializeDeviceMonitoring();
		
		this._disposables.push(this._usbEventEmitter);
	}

	/**
	 * Initialize device monitoring using WebUSB and filesystem watchers
	 */
	private initializeDeviceMonitoring(): void {
		try {
			// Initialize WebUSB device detection
			this.initializeWebUSBMonitoring();

			// Also watch filesystem for CIRCUITPY drives
			this.initializeFilesystemWatching();

			this._logger.info('DEVICE_DETECTOR', '✅ WebUSB and filesystem device monitoring initialized - CircuitPython devices will be detected automatically');
		} catch (error) {
			this._logger.error('DEVICE_DETECTOR', `❌ Failed to initialize device monitoring: ${error instanceof Error ? error.message : String(error)}`);
			// Fallback to periodic scanning
			this.startPeriodicDeviceScanning();
		}
	}

	/**
	 * Initialize WebUSB device monitoring
	 */
	private async initializeWebUSBMonitoring(): Promise<void> {
		try {
			// Check if WebUSB is available (only in webview/browser contexts)
			if (typeof navigator !== 'undefined' && navigator && 'usb' in navigator && navigator.usb) {
				// Listen for device connection events
				navigator.usb.addEventListener('connect', async (event: USBConnectionEvent) => {
					await this.handleWebUSBDeviceChange('connected', event.device);
				});

				navigator.usb.addEventListener('disconnect', async (event: USBConnectionEvent) => {
					await this.handleWebUSBDeviceChange('disconnected', event.device);
				});

				this._logger.info('DEVICE_DETECTOR', '✅ WebUSB event monitoring initialized');
			} else {
				this._logger.warn('DEVICE_DETECTOR', '⚠️ WebUSB not available, falling back to polling');
				this.startPeriodicDeviceScanning();
			}
		} catch (error) {
			this._logger.warn('DEVICE_DETECTOR', `⚠️ WebUSB initialization failed: ${error instanceof Error ? error.message : String(error)}`);
			this.startPeriodicDeviceScanning();
		}
	}

	/**
	 * Initialize filesystem watching for CIRCUITPY drives
	 */
	private initializeFilesystemWatching(): void {
		try {
			// Watch for filesystem changes that might indicate device mounting
			// This catches CIRCUITPY drives appearing/disappearing
			const watcher = vscode.workspace.createFileSystemWatcher('/**/CIRCUITPY/**', false, true, false);

			watcher.onDidCreate(async (uri) => {
				this._logger.info('DEVICE_DETECTOR', `📁 CIRCUITPY filesystem detected: ${uri.fsPath}`);
				await this.handleFilesystemDeviceChange('mounted', uri);
			});

			watcher.onDidDelete(async (uri) => {
				this._logger.info('DEVICE_DETECTOR', `📁 CIRCUITPY filesystem removed: ${uri.fsPath}`);
				await this.handleFilesystemDeviceChange('unmounted', uri);
			});

			this._disposables.push(watcher);
			this._logger.info('DEVICE_DETECTOR', '✅ CIRCUITPY filesystem watching initialized');
		} catch (error) {
			this._logger.warn('DEVICE_DETECTOR', `⚠️ Filesystem watching failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Handle WebUSB device connection/disconnection events
	 */
	private async handleWebUSBDeviceChange(eventType: 'connected' | 'disconnected', device: USBDevice): Promise<void> {
		try {
			const vid = device.vendorId;
			const pid = device.productId;
			const vidHex = `0x${vid.toString(16).toUpperCase().padStart(4, '0')}`;
			const pidHex = `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`;

			// Check if this is a known CircuitPython device
			if (this.isKnownCircuitPythonDevice(vidHex, pidHex)) {
				this._logger.info('DEVICE_DETECTOR', `📱 CircuitPython device ${eventType}: ${vidHex}:${pidHex}`);

				// Trigger device detection after a short delay
				setTimeout(async () => {
					const detectionResult = await this.detectDevices();
					this.emitDeviceChangeEvents(this._lastDetectionResult, detectionResult);
					this._lastDetectionResult = detectionResult;
				}, eventType === 'connected' ? 2000 : 500);
			}
		} catch (error) {
			this._logger.error('DEVICE_DETECTOR', `WebUSB event error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Handle filesystem-based device mounting/unmounting
	 */
	private async handleFilesystemDeviceChange(eventType: 'mounted' | 'unmounted', uri: vscode.Uri): Promise<void> {
		try {
			this._logger.info('DEVICE_DETECTOR', `📁 CIRCUITPY drive ${eventType}: ${uri.fsPath}`);

			// Trigger device detection
			const detectionResult = await this.detectDevices();
			this.emitDeviceChangeEvents(this._lastDetectionResult, detectionResult);
			this._lastDetectionResult = detectionResult;
		} catch (error) {
			this._logger.error('DEVICE_DETECTOR', `Filesystem event error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Check if VID:PID combination is a known CircuitPython device
	 */
	private isKnownCircuitPythonDevice(vidHex: string, pidHex: string): boolean {
		// Check vendor lookup
		if (this._deviceDatabase.vendor_lookup[vidHex]) {
			return true;
		}

		// Check specific board lookup
		const vidPid = `${vidHex}:${pidHex}`;
		if (this._deviceDatabase.board_lookup[vidPid]) {
			return true;
		}

		return false;
	}

	/**
	 * Start periodic scanning for device changes
	 */
	private startPeriodicDeviceScanning(): void {
		// Scan every 3 seconds for device changes
		this._deviceScanInterval = setInterval(async () => {
			try {
				const currentPorts = await SerialPort.list();
				await this.detectPortChanges(currentPorts);
			} catch (error) {
				// Silently handle errors - device scanning shouldn't spam the console
			}
		}, 3000);

		// Store interval for cleanup
		this._disposables.push({
			dispose: () => {
				if (this._deviceScanInterval) {
					clearInterval(this._deviceScanInterval);
					this._deviceScanInterval = undefined;
				}
			}
		});
	}

	private _deviceScanInterval?: NodeJS.Timeout;
	private _lastKnownPorts: string[] = [];

	/**
	 * Detect changes in available serial ports
	 */
	private async detectPortChanges(currentPorts: any[]): Promise<void> {
		const currentPortPaths = currentPorts.map(port => port.path);

		// Find newly attached devices
		const newPorts = currentPortPaths.filter(path => !this._lastKnownPorts.includes(path));

		// Find removed devices
		const removedPorts = this._lastKnownPorts.filter(path => !currentPortPaths.includes(path));

		// Handle new devices
		for (const portPath of newPorts) {
			const portInfo = currentPorts.find(p => p.path === portPath);
			if (portInfo && this.isLikelyCircuitPythonDevice(portInfo)) {
				this._logger.info('DEVICE_DETECTOR', `📱 CircuitPython device detected: ${portPath}`);
				await this.handleDeviceChange('attached', portInfo);
			}
		}

		// Handle removed devices
		for (const portPath of removedPorts) {
			this._logger.info('DEVICE_DETECTOR', `📤 Device removed: ${portPath}`);
			await this.handleDeviceChange('detached', { path: portPath });
		}

		this._lastKnownPorts = currentPortPaths;
	}

	/**
	 * Check if a serial port likely represents a CircuitPython device
	 */
	private isLikelyCircuitPythonDevice(portInfo: any): boolean {
		if (!portInfo.vendorId || !portInfo.productId) {
			return false;
		}

		const vidHex = `0x${parseInt(portInfo.vendorId, 16).toString(16).toUpperCase().padStart(4, '0')}`;

		// Check against known CircuitPython vendors in database
		if (this._deviceDatabase.vendor_lookup[vidHex]) {
			return true;
		}

		return false;
	}

	/**
	 * Handle device attach/detach events and trigger CircuitPython device detection
	 */
	private async handleDeviceChange(eventType: 'attached' | 'detached', deviceInfo: any): Promise<void> {
		// Prevent multiple simultaneous detections
		if (this._detectionInProgress) {
			return;
		}

		try {
			this._detectionInProgress = true;

			// Give the OS time to initialize device/serial port after attach
			const delay = eventType === 'attached' ? 2500 : 800;
			await new Promise(resolve => setTimeout(resolve, delay));

			// Trigger comprehensive SerialPort-based detection
			const detectionResult = await this.detectDevices();
			const previousResult = this._lastDetectionResult;
			this._lastDetectionResult = detectionResult;

			// Compare results and emit appropriate events
			this.emitDeviceChangeEvents(previousResult, detectionResult);

		} catch (error) {
			this._logger.error('DEVICE_DETECTOR', `❌ Error handling USB device change: ${error}`);
		} finally {
			this._detectionInProgress = false;
		}
	}

	/**
	 * Quick heuristic filter to check if USB device might be CircuitPython-related
	 */

	/**
	 * Compare detection results and emit device change events
	 */
	private emitDeviceChangeEvents(
		previousResult: DetectionResult | null, 
		currentResult: DetectionResult
	): void {
		if (!previousResult) {
			// First detection run - emit 'added' for all current devices
			currentResult.devices.forEach(device => {
				this._logger.info('DEVICE_DETECTOR', `🔌 CircuitPython device discovered: ${device.displayName}`);
				this._usbEventEmitter.fire({
					type: 'added',
					device: device
				});
			});
			return;
		}

		// Find newly added devices (present now, but not before)
		const previousDevicePaths = new Set(previousResult.devices.map(d => d.path));
		const addedDevices = currentResult.devices.filter(d => !previousDevicePaths.has(d.path));
		
		// Find removed devices (present before, but not now)
		const currentDevicePaths = new Set(currentResult.devices.map(d => d.path));
		const removedDevices = previousResult.devices.filter(d => !currentDevicePaths.has(d.path));
		
		// Emit events for changes
		addedDevices.forEach(device => {
			this._logger.info('DEVICE_DETECTOR', `➕ CircuitPython device added: ${device.displayName} at ${device.path}`);
			this._usbEventEmitter.fire({
				type: 'added',
				device: device
			});
		});

		removedDevices.forEach(device => {
			this._logger.info('DEVICE_DETECTOR', `➖ CircuitPython device removed: ${device.displayName} from ${device.path}`);
			this._usbEventEmitter.fire({
				type: 'removed',
				device: device
			});
		});
	}

	/**
	 * Detect all available CircuitPython devices (Enhanced with USB event integration)
	 */
	public async detectDevices(): Promise<DetectionResult> {
		try {
			const serialPorts = await SerialPort.list();
			const result: DetectionResult = {
				devices: [],
				conflicts: [],
				totalDevices: serialPorts.length,
				supportedDevices: 0,
				circuitPythonDevices: []
			};

			for (const port of serialPorts) {
				const device = await this.analyzeSerialPort(port);
				if (device) {
					result.devices.push(device);
					if (device.confidence !== 'low') {
						result.circuitPythonDevices.push(device);
					}
				}
			}

			// Identify conflicts
			result.conflicts = this.identifyConflicts(result.devices);

			// Calculate supported devices count
			result.supportedDevices = result.circuitPythonDevices.length;

			this._logger.info('DEVICE_DETECTOR',
				`Detection complete: ${result.circuitPythonDevices.length} CircuitPython devices found out of ${result.totalDevices} total serial devices`
			);

			return result;
		} catch (error) {
			this._logger.error('DEVICE_DETECTOR', `Device detection error: ${error}`);
			throw error;
		}
	}

	/**
	 * Get the best CircuitPython device for auto-connection
	 */
	public async getBestDevice(): Promise<MuDevice | null> {
		const result = await this.detectDevices();
		
		if (result.devices.length === 0) {
			return null;
		}

		// Prefer high-confidence devices without conflicts
		const highConfidenceDevices = result.devices.filter(d => 
			d.confidence === 'high' && !d.hasConflict
		);

		if (highConfidenceDevices.length === 1) {
			return highConfidenceDevices[0];
		}

		// If multiple high-confidence devices, prefer Adafruit boards
		const adafruitDevices = highConfidenceDevices.filter(d => 
			d.vendorId === '0x239A' || d.manufacturer?.toLowerCase().includes('adafruit')
		);

		if (adafruitDevices.length === 1) {
			return adafruitDevices[0];
		}

		// Return the first available device or null if conflicts need resolution
		return result.devices[0] || null;
	}

	/**
	 * Show device selection dialog when multiple devices are available
	 */
	public async showDeviceSelectionDialog(devices: MuDevice[]): Promise<MuDevice | null> {
		const items = devices.map(device => ({
			label: device.displayName,
			description: `${device.path} (${device.confidence} confidence)`,
			detail: device.boardId ? `Board: ${device.boardId}` : device.manufacturer,
			device: device
		}));

		const selection = await vscode.window.showQuickPick(items, {
			placeHolder: 'Select a CircuitPython device to connect to',
			title: 'Multiple CircuitPython Devices Found'
		});

		return selection?.device || null;
	}

	/**
	 * Analyze a single serial port for CircuitPython device characteristics
	 */
	private async analyzeSerialPort(port: any): Promise<MuDevice | null> {
		const vendorId = port.vendorId ? `0x${port.vendorId.toUpperCase()}` : undefined;
		const productId = port.productId ? `0x${port.productId.toUpperCase()}` : undefined;
		
		// Try VID:PID lookup first (highest confidence)
		if (vendorId && productId) {
			const vidPid = `${vendorId}:${productId}`;
			const boardMatch = this.findBoardByVidPid(vidPid);
			
			if (boardMatch) {
				// Extract board information from the database structure
				const primaryBoard = boardMatch.boards && boardMatch.boards[0];
				const boardId = primaryBoard ? `${primaryBoard.port}/${primaryBoard.board}` : undefined;
				const productName = boardMatch.products && boardMatch.products[0];
				const manufacturerName = boardMatch.primary_manufacturer;
				const portType = primaryBoard?.port;

				return {
					path: port.path,
					vendorId,
					productId,
					manufacturer: port.manufacturer || manufacturerName,
					product: port.productName || productName,
					boardId: boardId,
					portType: portType,
					confidence: 'high',
					displayName: this.generateDisplayName(productName || port.productName, boardId),
					hasConflict: this.checkForConflicts(vidPid)
				};
			}
		}

		// Try VID-only lookup (medium confidence)
		if (vendorId) {
			const vendorInfo = this._deviceDatabase.vendor_lookup[vendorId];
			if (vendorInfo) {
				return {
					path: port.path,
					vendorId,
					productId,
					manufacturer: port.manufacturer || vendorInfo.primary_name,
					product: port.productName,
					confidence: 'medium',
					displayName: this.generateDisplayName(port.productName, undefined, vendorInfo.primary_name),
					hasConflict: false
				};
			}
		}

		// Fallback: string pattern matching (low confidence)
		const patternMatch = this.matchByStringPatterns(port);
		if (patternMatch) {
			return {
				path: port.path,
				vendorId,
				productId,
				manufacturer: port.manufacturer,
				product: port.productName,
				confidence: 'low',
				displayName: this.generateDisplayName(port.productName, undefined, port.manufacturer),
				hasConflict: false
			};
		}

		return null;
	}

	/**
	 * Find board information by VID:PID combination
	 */
	private findBoardByVidPid(vidPid: string): any {
		return this._deviceDatabase.device_lookup[vidPid] || null;
	}

	/**
	 * Check if a VID:PID combination has known conflicts
	 */
	private checkForConflicts(vidPid: string): boolean {
		const conflicts = this._detectionHelpers.common_conflicts;
		return conflicts.some((conflict: any) => conflict.vid_pid === vidPid);
	}

	/**
	 * Match device by string patterns in manufacturer/product names
	 */
	private matchByStringPatterns(port: any): boolean {
		const searchText = [
			port.manufacturer,
			port.productName,
			port.serialNumber
		].filter(Boolean).join(' ').toLowerCase();

		// Always include CircuitPython-specific patterns
		const circuitPythonPatterns = [
			/circuitpython/i,
			/micropython/i
		];

		// Check for CircuitPython-specific patterns first
		if (circuitPythonPatterns.some(pattern => pattern.test(searchText))) {
			return true;
		}

		// Generate patterns from known manufacturers in the database
		const knownManufacturers = Object.values(this._deviceDatabase.vendor_lookup)
			.map((vendor: any) => vendor.primary_name.toLowerCase())
			.filter(name => name.length > 3); // Avoid very short names

		// Generate patterns from known board families in the database
		const knownBoardPatterns: string[] = [];
		Object.values(this._deviceDatabase.device_lookup).forEach((device: any) => {
			if (device.boards) {
				device.boards.forEach((board: any) => {
					// Extract board family names (e.g., "feather", "metro", "qtpy")
					const boardName = board.board.toLowerCase();
					const parts = boardName.split('_');
					parts.forEach((part: string) => {
						if (part.length > 3 && !knownBoardPatterns.includes(part)) {
							knownBoardPatterns.push(part);
						}
					});
				});
			}
		});

		// Check against known manufacturers
		const manufacturerMatch = knownManufacturers.some(manufacturer => 
			searchText.includes(manufacturer)
		);

		// Check against known board patterns
		const boardMatch = knownBoardPatterns.some(pattern => 
			searchText.includes(pattern)
		);

		return manufacturerMatch || boardMatch;
	}

	/**
	 * Identify conflicts among detected devices
	 */
	private identifyConflicts(devices: MuDevice[]): VidPidConflict[] {
		const conflicts: VidPidConflict[] = [];
		const vidPidGroups = new Map<string, MuDevice[]>();

		// Group devices by VID:PID
		devices.forEach(device => {
			if (device.vendorId && device.productId) {
				const vidPid = `${device.vendorId}:${device.productId}`;
				if (!vidPidGroups.has(vidPid)) {
					vidPidGroups.set(vidPid, []);
				}
				vidPidGroups.get(vidPid)!.push(device);
			}
		});

		// Find conflicts
		vidPidGroups.forEach((deviceGroup, vidPid) => {
			const knownConflict = this._detectionHelpers.common_conflicts.find(
				(c: any) => c.vid_pid === vidPid
			);

			if (knownConflict && deviceGroup.length > 0) {
				conflicts.push({
					vidPid,
					conflictingBoards: knownConflict.boards,
					detectedDevice: deviceGroup[0]
				});
			}
		});

		return conflicts;
	}

	/**
	 * Generate a human-readable display name for a device
	 */
	private generateDisplayName(product?: string, boardId?: string, manufacturer?: string): string {
		if (boardId) {
			// Convert board ID to readable format (e.g., "feather_m4_express" -> "Feather M4 Express")
			const readable = boardId
				.split('/')
				.pop()!
				.replace(/_/g, ' ')
				.replace(/\b\w/g, l => l.toUpperCase());
			return readable;
		}

		if (product) {
			return product;
		}

		if (manufacturer) {
			return `${manufacturer} Device`;
		}

		return 'Unknown CircuitPython Device';
	}

	/**
	 * Get detailed device information for debugging
	 */
	public async getDeviceInfo(device: MuDevice): Promise<string> {
		const info = [
			`CircuitPython Device Information:`,
			`  Path: ${device.path}`,
			`  Display Name: ${device.displayName}`,
			`  Confidence: ${device.confidence}`,
			`  VID: ${device.vendorId || 'Unknown'}`,
			`  PID: ${device.productId || 'Unknown'}`,
			`  Manufacturer: ${device.manufacturer || 'Unknown'}`,
			`  Product: ${device.product || 'Unknown'}`,
		];

		if (device.boardId) {
			info.push(`  Board ID: ${device.boardId}`);
		}

		if (device.portType) {
			info.push(`  Port Type: ${device.portType}`);
		}

		if (device.hasConflict) {
			info.push(`  ⚠️  Has VID:PID conflicts with other boards`);
		}

		return info.join('\n');
	}

	/**
	 * Get database statistics
	 */
	public getDatabaseStats(): any {
		return {
			totalBoards: this._deviceDatabase.metadata.total_boards,
			boardsWithUsb: this._deviceDatabase.metadata.boards_with_usb,
			uniqueVendors: Object.keys(this._deviceDatabase.vendor_lookup).length,
			uniqueVidPids: Object.keys(this._deviceDatabase.device_lookup).length,
			knownConflicts: this._detectionHelpers.common_conflicts.length
		};
	}

	/**
	 * Mock device detection for development without native modules
	 */
	private async detectMockDevices(): Promise<MuDevice[]> {
		// Return a mock CircuitPython device for development
		return [{
			path: 'COM3',
			displayName: 'Mock CircuitPython Device',
			boardId: 'adafruit_feather_m4_express',
			confidence: 'high' as const,
			hasConflict: false,
			vendorId: '0x239A',
			productId: '0x8022',
			manufacturer: 'Adafruit Industries LLC',
			product: 'Feather M4 Express',
			supportedRuntimes: ['circuitpython'],
			primaryRuntime: 'circuitpython' as const,
			portType: 'atmel-samd'
		}];
	}

	/**
	 * Dispose resources and clean up monitoring
	 */
	public dispose(): void {
		// Dispose managed resources
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];

		// No longer using separate output channel - using unified logger
	}
}