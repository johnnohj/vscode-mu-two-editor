/**
 * Device Registry - Single Source of Truth for Device Detection
 *
 * Consolidates SimpleDeviceDetector, MuDeviceDetector, and BoardManager detection logic
 * into one clean, testable system.
 *
 * Phase 2 Architecture Refactoring
 */

import * as vscode from 'vscode';
import { SerialPort } from 'serialport';
import { getDevLogger } from '../../utils/devLogger';
import { getResourceLocator } from '../../core/resourceLocator';

/**
 * Registered device in the system
 */
export interface RegisteredDevice {
	/** Unique device identifier (VID:PID:Serial or hash-based) */
	id: string;
	/** Serial port path */
	path: string;
	/** USB Vendor ID */
	vendorId: string;
	/** USB Product ID */
	productId: string;
	/** Device manufacturer */
	manufacturer?: string;
	/** Product name */
	product?: string;
	/** Serial number (if available) */
	serialNumber?: string;
	/** Board ID from database */
	boardId?: string;
	/** Human-readable display name */
	displayName: string;
	/** Is this a CircuitPython device? */
	isCircuitPython: boolean;
	/** Detection confidence */
	confidence: 'high' | 'medium' | 'low';
	/** Last detection timestamp */
	lastSeen: Date;
}

/**
 * Device change event
 */
export interface DeviceChangeEvent {
	type: 'added' | 'removed' | 'changed';
	device: RegisteredDevice;
}

/**
 * Device database entry (from circuitpython_devices.json)
 */
interface DeviceDatabaseEntry {
	vid: string;
	pid: string;
	board_id: string;
	board_name: string;
	manufacturer?: string;
}

/**
 * DeviceRegistry - Single source of truth for all device detection
 *
 * Replaces:
 * - SimpleDeviceDetector (simple VID/PID matching)
 * - MuDeviceDetector (complex database lookup)
 * - BoardManager device detection (duplicate logic)
 *
 * Design Principles:
 * - Single responsibility: detect and track devices
 * - Observable: emit events for device changes
 * - No business logic: just detection and registry
 */
export class DeviceRegistry implements vscode.Disposable {
	private devices = new Map<string, RegisteredDevice>();
	private deviceDatabase: DeviceDatabaseEntry[];
	private logger = getDevLogger();

	// Event emitters
	private deviceChangedEmitter = new vscode.EventEmitter<DeviceChangeEvent>();
	public readonly onDeviceChanged = this.deviceChangedEmitter.event;

	private allDevicesEmitter = new vscode.EventEmitter<RegisteredDevice[]>();
	public readonly onAllDevicesChanged = this.allDevicesEmitter.event;

	// Polling interval for device detection (5 seconds)
	private pollingInterval?: NodeJS.Timeout;
	private isDetecting = false;

	constructor() {
		// Load device database asynchronously
		this.loadDeviceDatabase().then(database => {
			this.deviceDatabase = database;
			this.logger.device(`Loaded ${this.deviceDatabase.length} board definitions from database`);

			// Start polling after database loaded
			this.startPolling();
		}).catch(error => {
			this.logger.error('DEVICE', 'Failed to initialize device database', error);
			this.deviceDatabase = [];
			this.startPolling();
		});
	}

	/**
	 * Load device database from JSON file
	 */
	private async loadDeviceDatabase(): Promise<DeviceDatabaseEntry[]> {
		try {
			const resourceLocator = getResourceLocator();
			const resourcesPath = resourceLocator.getResourcesPath();
			const cachedDbPath = resourceLocator.getResourceFilePath('circuitpython_devices.json');

			let fileContent: Uint8Array;

			// Try to load from cached location first
			try {
				fileContent = await vscode.workspace.fs.readFile(cachedDbPath);
			} catch {
				// Not cached yet, copy from extension bundle

				// Ensure resources directory exists
				await vscode.workspace.fs.createDirectory(resourcesPath);

				// Find source database in extension bundle
				const extensionUri = resourceLocator['context'].extensionUri;
				const sourcePaths = [
					vscode.Uri.joinPath(extensionUri, 'dist', 'data', 'circuitpython_devices.json'),
					vscode.Uri.joinPath(extensionUri, 'src', 'data', 'circuitpython_devices.json')
				];

				let sourceContent: Uint8Array | undefined;
				for (const sourcePath of sourcePaths) {
					try {
						sourceContent = await vscode.workspace.fs.readFile(sourcePath);
						break;
					} catch {
						// Try next location
					}
				}

				if (!sourceContent) {
					throw new Error('Device database not found in extension bundle');
				}

				// Copy to resources
				await vscode.workspace.fs.writeFile(cachedDbPath, sourceContent);
				fileContent = sourceContent;
			}
			const dbObject = JSON.parse(Buffer.from(fileContent).toString('utf8'));
			const entries: DeviceDatabaseEntry[] = [];

			// The actual device entries are in the 'device_lookup' object
			const deviceLookup = dbObject.device_lookup || {};

			for (const [vidPidKey, data] of Object.entries(deviceLookup)) {

				const entry = data as any;
				if (entry.vid && entry.pid) {
					// Strip "0x" prefix and convert to uppercase
					const vid = entry.vid.replace(/0x/i, '').toUpperCase();
					const pid = entry.pid.replace(/0x/i, '').toUpperCase();

					// Get board name from products array or fallback
					const boardName = entry.products?.[0]
						|| entry.board_name
						|| entry.product
						|| vidPidKey;

					// Get manufacturer from primary_manufacturer or manufacturers array
					const manufacturer = entry.primary_manufacturer
						|| entry.manufacturers?.[0]
						|| entry.manufacturer;

					entries.push({
						vid,
						pid,
						board_id: vidPidKey,
						board_name: boardName,
						manufacturer
					});
				}
			}

			return entries;
		} catch (error) {
			this.logger.error('DEVICE', 'Failed to load device database', error);
			return [];
		}
	}

	/**
	 * Start polling for device changes
	 */
	private startPolling(): void {
		// Initial detection
		void this.detectDevices();

		// Poll every 5 seconds
		this.pollingInterval = setInterval(() => {
			void this.detectDevices();
		}, 5000);
	}

	/**
	 * Stop polling for device changes
	 */
	private stopPolling(): void {
		if (this.pollingInterval) {
			clearInterval(this.pollingInterval);
			this.pollingInterval = undefined;
		}
	}

	/**
	 * Detect all connected serial devices
	 */
	async detectDevices(): Promise<RegisteredDevice[]> {
		// Prevent concurrent detection
		if (this.isDetecting) {
			return Array.from(this.devices.values());
		}

		this.isDetecting = true;

		try {
			const ports = await SerialPort.list();
			const currentDeviceIds = new Set<string>();

			for (const port of ports) {
				if (!port.vendorId || !port.productId) {
					continue; // Skip ports without VID/PID
				}

				const device = this.createRegisteredDevice(port);
				currentDeviceIds.add(device.id);

				const existingDevice = this.devices.get(device.id);

				if (!existingDevice) {
					// New device added
					this.devices.set(device.id, device);
					this.logger.device(`Device added: ${device.displayName} (${device.path})`);
					this.deviceChangedEmitter.fire({ type: 'added', device });
				} else if (this.hasDeviceChanged(existingDevice, device)) {
					// Device changed (path or properties changed)
					this.devices.set(device.id, device);
					this.logger.device(`Device changed: ${device.displayName} (${device.path})`);
					this.deviceChangedEmitter.fire({ type: 'changed', device });
				} else {
					// Update last seen time
					existingDevice.lastSeen = device.lastSeen;
				}
			}

			// Check for removed devices
			for (const [id, device] of this.devices.entries()) {
				if (!currentDeviceIds.has(id)) {
					this.devices.delete(id);
					this.logger.device(`Device removed: ${device.displayName} (${device.path})`);
					this.deviceChangedEmitter.fire({ type: 'removed', device });
				}
			}

			// Emit all devices changed event
			this.allDevicesEmitter.fire(this.getAllDevices());

			return this.getAllDevices();

		} catch (error) {
			this.logger.error('DEVICE', 'Device detection failed', error);
			return [];
		} finally {
			this.isDetecting = false;
		}
	}

	/**
	 * Create a RegisteredDevice from a SerialPort.PortInfo
	 */
	private createRegisteredDevice(port: any): RegisteredDevice {
		const vendorId = port.vendorId?.toUpperCase() || '';
		const productId = port.productId?.toUpperCase() || '';
		const vidPid = `${vendorId}:${productId}`;

		// Look up board in database
		const boardInfo = this.deviceDatabase.find(
			entry => entry.vid === vendorId && entry.pid === productId
		);

		// Generate stable device ID
		const id = port.serialNumber
			? `${vidPid}:${port.serialNumber}`
			: `${vidPid}:${port.path}`;

		// Determine if CircuitPython
		const isCircuitPython = this.isLikelyCircuitPython(vendorId, productId, boardInfo);

		// Generate display name
		const displayName = boardInfo?.board_name
			|| port.product
			|| `${port.manufacturer || 'Unknown'} Device (${vidPid})`;

		// Determine confidence
		const confidence = boardInfo ? 'high' : (isCircuitPython ? 'medium' : 'low');

		return {
			id,
			path: port.path,
			vendorId,
			productId,
			manufacturer: port.manufacturer || boardInfo?.manufacturer,
			product: port.product,
			serialNumber: port.serialNumber,
			boardId: boardInfo?.board_id,
			displayName,
			isCircuitPython,
			confidence,
			lastSeen: new Date()
		};
	}

	/**
	 * Check if a device is likely CircuitPython
	 */
	private isLikelyCircuitPython(
		vendorId: string,
		productId: string,
		boardInfo?: DeviceDatabaseEntry
	): boolean {
		// If in database, it's CircuitPython
		if (boardInfo) {
			return true;
		}

		// Common CircuitPython vendor IDs
		const circuitPythonVendors = [
			'239A', // Adafruit
			'2E8A', // Raspberry Pi
			'1209', // Generic
			'16C0'  // VOTI
		];

		return circuitPythonVendors.includes(vendorId);
	}

	/**
	 * Check if device properties have changed
	 */
	private hasDeviceChanged(
		existing: RegisteredDevice,
		updated: RegisteredDevice
	): boolean {
		return existing.path !== updated.path
			|| existing.manufacturer !== updated.manufacturer
			|| existing.product !== updated.product;
	}

	/**
	 * Get all registered devices
	 */
	getAllDevices(): RegisteredDevice[] {
		return Array.from(this.devices.values());
	}

	/**
	 * Get CircuitPython devices only
	 */
	getCircuitPythonDevices(): RegisteredDevice[] {
		return this.getAllDevices().filter(d => d.isCircuitPython);
	}

	/**
	 * Get device by ID
	 */
	getDevice(id: string): RegisteredDevice | undefined {
		return this.devices.get(id);
	}

	/**
	 * Get device by serial port path
	 */
	getDeviceByPath(path: string): RegisteredDevice | undefined {
		return this.getAllDevices().find(d => d.path === path);
	}

	/**
	 * Force immediate device detection
	 */
	async refresh(): Promise<RegisteredDevice[]> {
		this.logger.device('Manually refreshing device list');
		return await this.detectDevices();
	}

	/**
	 * Get device count
	 */
	getDeviceCount(): number {
		return this.devices.size;
	}

	/**
	 * Get CircuitPython device count
	 */
	getCircuitPythonDeviceCount(): number {
		return this.getCircuitPythonDevices().length;
	}

	/**
	 * Dispose registry and stop polling
	 */
	dispose(): void {
		this.stopPolling();
		this.deviceChangedEmitter.dispose();
		this.allDevicesEmitter.dispose();
		this.devices.clear();
		this.logger.device('DeviceRegistry disposed');
	}
}

/**
 * Global device registry instance
 */
let deviceRegistry: DeviceRegistry | undefined;

/**
 * Initialize the global device registry
 */
export function initDeviceRegistry(): DeviceRegistry {
	const logger = getDevLogger();

	if (deviceRegistry) {
		logger.device('Disposing existing DeviceRegistry instance');
		deviceRegistry.dispose();
		deviceRegistry = undefined;
	}

	logger.device('Creating new DeviceRegistry instance');
	deviceRegistry = new DeviceRegistry();
	return deviceRegistry;
}

/**
 * Get the global device registry instance
 */
export function getDeviceRegistry(): DeviceRegistry {
	if (!deviceRegistry) {
		throw new Error('DeviceRegistry not initialized. Call initDeviceRegistry first.');
	}
	return deviceRegistry;
}
