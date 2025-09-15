import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import * as usb from 'usb';
import * as deviceDatabase from '../data/circuitpython_devices.json';
import * as detectionHelpers from '../data/detection_helpers.json';

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
 * CircuitPython-specific device implementation
 */
export interface CircuitPythonDevice extends IDevice {
	/** CircuitPython-specific board identifier */
	boardId?: string;
	/** Hardware port type (e.g., 'atmel-samd', 'espressif') - CircuitPython specific */
	portType?: string;
}

export interface DetectionResult {
	devices: CircuitPythonDevice[];
	conflicts: VidPidConflict[];
	totalDevices: number;
	circuitPythonDevices: number;
}

export interface VidPidConflict {
	vidPid: string;
	conflictingBoards: string[];
	detectedDevice: CircuitPythonDevice;
}

export interface DeviceEvent {
	type: 'added' | 'removed' | 'changed';
	device: CircuitPythonDevice;
}

/**
 * Enhanced CircuitPython device detection using comprehensive board database
 */
export class CircuitPythonDeviceDetector implements vscode.Disposable {
	private _deviceDatabase: any;
	private _detectionHelpers: any;
	private _outputChannel: vscode.OutputChannel;
	private _usbEventEmitter = new vscode.EventEmitter<DeviceEvent>();
	private _disposables: vscode.Disposable[] = [];
	private _lastDetectionResult: DetectionResult | null = null;
	private _detectionInProgress = false;

	// USB event API - make this the primary interface for device changes
	public readonly onDeviceChanged = this._usbEventEmitter.event;

	constructor() {
		this._deviceDatabase = deviceDatabase;
		this._detectionHelpers = detectionHelpers;
		this._outputChannel = vscode.window.createOutputChannel('CircuitPython Device Detection');
		
		// Initialize USB event monitoring as first-line strategy
		this.initializeUSBMonitoring();
		
		this._disposables.push(this._usbEventEmitter);
	}

	/**
	 * Initialize USB event monitoring as primary detection strategy
	 */
	private initializeUSBMonitoring(): void {
		try {
			// Set up USB hotplug events using node-usb
			usb.on('attach', (device) => {
				const vid = device.deviceDescriptor.idVendor;
				const pid = device.deviceDescriptor.idProduct;
				this._outputChannel.appendLine(`USB device attached: VID=${vid.toString(16).padStart(4, '0')}, PID=${pid.toString(16).padStart(4, '0')}`);
				this.handleUSBDeviceChange('attached', device);
			});

			usb.on('detach', (device) => {
				const vid = device.deviceDescriptor.idVendor;
				const pid = device.deviceDescriptor.idProduct;
				this._outputChannel.appendLine(`USB device detached: VID=${vid.toString(16).padStart(4, '0')}, PID=${pid.toString(16).padStart(4, '0')}`);
				this.handleUSBDeviceChange('detached', device);
			});

			// Unreference hotplug events to allow process to exit cleanly
			usb.unrefHotplugEvents();

			this._outputChannel.appendLine('✅ USB event monitoring initialized - CircuitPython devices will be detected automatically');

		} catch (error) {
			this._outputChannel.appendLine(`❌ Failed to initialize USB monitoring: ${error}`);
			this._outputChannel.appendLine('📡 Falling back to polling-based detection only');
		}
	}

	/**
	 * Handle USB device attach/detach events and trigger CircuitPython device detection
	 */
	private async handleUSBDeviceChange(eventType: 'attached' | 'detached', usbDevice: usb.Device): Promise<void> {
		// Quick filter: Only process likely CircuitPython devices to reduce noise
		if (!this.isLikelyCircuitPythonDevice(usbDevice)) {
			return;
		}

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
			this._outputChannel.appendLine(`❌ Error handling USB device change: ${error}`);
		} finally {
			this._detectionInProgress = false;
		}
	}

	/**
	 * Quick heuristic filter to check if USB device might be CircuitPython-related
	 */
	private isLikelyCircuitPythonDevice(device: usb.Device): boolean {
		const vid = device.deviceDescriptor.idVendor;
		const pid = device.deviceDescriptor.idProduct;
		const vidHex = `0x${vid.toString(16).toUpperCase().padStart(4, '0')}`;
		const pidHex = `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`;
		
		// Check against known CircuitPython vendors in database
		if (this._deviceDatabase.vendor_lookup[vidHex]) {
			this._outputChannel.appendLine(`📱 Potential CircuitPython device detected: ${vidHex}:${pidHex} (known vendor)`);
			return true;
		}

		// Check against specific VID:PID combinations in database
		const vidPid = `${vidHex}:${pidHex}`;
		if (this._deviceDatabase.board_lookup[vidPid]) {
			this._outputChannel.appendLine(`📱 Known CircuitPython board detected: ${vidPid}`);
			return true;
		}

		// Conservative approach - only trigger detection for known devices
		// This reduces false positives and unnecessary SerialPort scanning
		return false;
	}

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
				this._outputChannel.appendLine(`🔌 CircuitPython device discovered: ${device.displayName}`);
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
			this._outputChannel.appendLine(`➕ CircuitPython device added: ${device.displayName} at ${device.path}`);
			this._usbEventEmitter.fire({
				type: 'added',
				device: device
			});
		});

		removedDevices.forEach(device => {
			this._outputChannel.appendLine(`➖ CircuitPython device removed: ${device.displayName} from ${device.path}`);
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
				circuitPythonDevices: 0
			};

			for (const port of serialPorts) {
				const device = await this.analyzeSerialPort(port);
				if (device) {
					result.devices.push(device);
					if (device.confidence !== 'low') {
						result.circuitPythonDevices++;
					}
				}
			}

			// Identify conflicts
			result.conflicts = this.identifyConflicts(result.devices);

			this._outputChannel.appendLine(
				`Detection complete: ${result.circuitPythonDevices} CircuitPython devices found out of ${result.totalDevices} total serial devices`
			);

			return result;
		} catch (error) {
			this._outputChannel.appendLine(`Device detection error: ${error}`);
			throw error;
		}
	}

	/**
	 * Get the best CircuitPython device for auto-connection
	 */
	public async getBestDevice(): Promise<CircuitPythonDevice | null> {
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
	public async showDeviceSelectionDialog(devices: CircuitPythonDevice[]): Promise<CircuitPythonDevice | null> {
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
	private async analyzeSerialPort(port: any): Promise<CircuitPythonDevice | null> {
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
					parts.forEach(part => {
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
	private identifyConflicts(devices: CircuitPythonDevice[]): VidPidConflict[] {
		const conflicts: VidPidConflict[] = [];
		const vidPidGroups = new Map<string, CircuitPythonDevice[]>();

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
	public async getDeviceInfo(device: CircuitPythonDevice): Promise<string> {
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
	 * Dispose resources and clean up USB monitoring
	 */
	public dispose(): void {
		// Clean up USB event listeners
		try {
			usb.removeAllListeners('attach');
			usb.removeAllListeners('detach');
		} catch (error) {
			// Silent cleanup
		}

		// Dispose managed resources
		this._disposables.forEach(d => d.dispose());
		this._disposables = [];
		
		this._outputChannel.dispose();
	}
}