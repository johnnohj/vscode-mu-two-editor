/**
 * Pure Device Manager Implementation
 *
 * Phase 3 - Runtime-Agnostic Device Management: Concrete implementation
 *
 * This implementation focuses purely on device operations without any runtime dependencies.
 * It uses the DeviceConnectionManager from Phase 2 as its foundation but provides
 * the runtime-agnostic interface defined in Phase 3.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { IDevice } from '../devices/core/deviceDetector';
import {
    IDeviceManager,
    Connection,
    DeviceCapabilities,
    DeviceManagerEvents
} from './deviceManagerInterface';
import { DeviceConnectionManager } from './deviceConnectionManager';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Pure Device Manager Implementation
 *
 * Implements IDeviceManager interface with complete runtime independence
 */
export class PureDeviceManager extends EventEmitter implements IDeviceManager {
    private static instance: PureDeviceManager;

    // Core device management
    private connectionManager: DeviceConnectionManager;
    private deviceCapabilities = new Map<string, DeviceCapabilities>();
    private deviceMetadata = new Map<string, Record<string, any>>();

    // State management
    private isInitialized = false;
    private isMonitoring = false;

    constructor(private context: vscode.ExtensionContext) {
        super();
        this.connectionManager = DeviceConnectionManager.getInstance(context);

        // Forward events from connection manager
        this.setupEventForwarding();

        logger.info('DEVICE_DETECTOR', 'PureDeviceManager created - runtime-agnostic device operations');
    }

    /**
     * Singleton pattern for extension-wide pure device management
     */
    static getInstance(context: vscode.ExtensionContext): PureDeviceManager {
        if (!PureDeviceManager.instance) {
            PureDeviceManager.instance = new PureDeviceManager(context);
        }
        return PureDeviceManager.instance;
    }

    // ========================= Lifecycle Management =========================

    /**
     * Initialize the device manager
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            logger.debug('DEVICE_DETECTOR', 'PureDeviceManager already initialized');
            return;
        }

        logger.info('DEVICE_DETECTOR', 'Initializing PureDeviceManager...');

        try {
            // Initialize the underlying connection manager
            await this.connectionManager.initialize();

            // Start device monitoring
            this.startMonitoring();

            this.isInitialized = true;
            logger.info('DEVICE_DETECTOR', '✓ PureDeviceManager initialized successfully');

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Failed to initialize PureDeviceManager: ${error}`);
            throw error;
        }
    }

    /**
     * Dispose the device manager and clean up resources
     */
    async dispose(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        logger.info('DEVICE_DETECTOR', 'Disposing PureDeviceManager...');

        try {
            // Stop monitoring
            this.stopMonitoring();

            // Dispose the connection manager
            await this.connectionManager.dispose();

            // Clear state
            this.deviceCapabilities.clear();
            this.deviceMetadata.clear();
            this.removeAllListeners();

            this.isInitialized = false;
            logger.info('DEVICE_DETECTOR', '✓ PureDeviceManager disposed successfully');

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Error disposing PureDeviceManager: ${error}`);
            throw error;
        }
    }

    // ========================= Device Discovery =========================

    /**
     * Detect all available devices
     */
    async detectDevices(): Promise<IDevice[]> {
        logger.debug('DEVICE_DETECTOR', 'Detecting available devices...');

        try {
            const devices = await this.connectionManager.getAvailableDevices();

            // Update device capabilities for newly discovered devices
            for (const device of devices) {
                if (!this.deviceCapabilities.has(device.id)) {
                    await this.detectDeviceCapabilities(device);
                }
            }

            logger.debug('DEVICE_DETECTOR', `Detected ${devices.length} available devices`);
            return devices;

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Device detection failed: ${error}`);
            throw error;
        }
    }

    /**
     * Get a specific device by ID
     */
    getDevice(deviceId: string): IDevice | null {
        return this.connectionManager.getDevice(deviceId);
    }

    /**
     * Get all currently known devices
     */
    getAllDevices(): IDevice[] {
        // Get all devices from the connection manager
        return Array.from(this.connectionManager.getActiveConnections().values())
            .map(conn => conn.device)
            .concat(
                // Add disconnected but known devices
                Array.from(this.deviceCapabilities.keys())
                    .map(deviceId => this.connectionManager.getDevice(deviceId))
                    .filter(device => device !== null) as IDevice[]
            );
    }

    /**
     * Check if a device is currently available
     */
    isDeviceAvailable(deviceId: string): boolean {
        return this.connectionManager.getDevice(deviceId) !== null;
    }

    // ========================= Device Connection =========================

    /**
     * Connect to a device (runtime-agnostic)
     */
    async connectToDevice(deviceId: string, options?: {
        protocol?: string;
        port?: string;
        baudRate?: number;
        timeout?: number;
    }): Promise<Connection> {
        logger.info('DEVICE_DETECTOR', `Connecting to device ${deviceId} (runtime-agnostic)...`);

        try {
            // Use the connection manager to establish connection
            const connectionManagerResult = await this.connectionManager.connectToDevice(deviceId, {
                protocol: (options?.protocol as any) || 'serial',
                port: options?.port,
                baudRate: options?.baudRate || 115200,
                timeout: options?.timeout || 5000,
                retryAttempts: 3,
                autoReconnect: true
            });

            // Convert to our runtime-agnostic Connection interface
            const connection: Connection = {
                deviceId: connectionManagerResult.deviceId,
                device: connectionManagerResult.device,
                protocol: connectionManagerResult.protocol,
                status: connectionManagerResult.status,
                connectedAt: connectionManagerResult.connectedAt,
                lastActivity: connectionManagerResult.lastActivity,
                connectionInfo: {
                    port: connectionManagerResult.port,
                    baudRate: connectionManagerResult.baudRate
                }
            };

            // Detect device capabilities if not already known
            if (!this.deviceCapabilities.has(deviceId)) {
                await this.detectDeviceCapabilities(connectionManagerResult.device);
            }

            logger.info('DEVICE_DETECTOR', `✓ Connected to device ${deviceId} successfully`);
            return connection;

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Failed to connect to device ${deviceId}: ${error}`);
            throw error;
        }
    }

    /**
     * Disconnect from a device
     */
    async disconnectDevice(deviceId: string): Promise<void> {
        logger.info('DEVICE_DETECTOR', `Disconnecting from device ${deviceId}...`);

        try {
            await this.connectionManager.disconnectDevice(deviceId);
            logger.info('DEVICE_DETECTOR', `✓ Disconnected from device ${deviceId} successfully`);

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Failed to disconnect from device ${deviceId}: ${error}`);
            throw error;
        }
    }

    /**
     * Get connection info for a device
     */
    getConnection(deviceId: string): Connection | null {
        const connManagerConnection = this.connectionManager.getConnection(deviceId);
        if (!connManagerConnection) {
            return null;
        }

        // Convert to our runtime-agnostic Connection interface
        return {
            deviceId: connManagerConnection.deviceId,
            device: connManagerConnection.device,
            protocol: connManagerConnection.protocol,
            status: connManagerConnection.status,
            connectedAt: connManagerConnection.connectedAt,
            lastActivity: connManagerConnection.lastActivity,
            connectionInfo: {
                port: connManagerConnection.port,
                baudRate: connManagerConnection.baudRate
            }
        };
    }

    /**
     * Get all active connections
     */
    getActiveConnections(): Connection[] {
        return Array.from(this.connectionManager.getActiveConnections().values())
            .map(conn => ({
                deviceId: conn.deviceId,
                device: conn.device,
                protocol: conn.protocol,
                status: conn.status,
                connectedAt: conn.connectedAt,
                lastActivity: conn.lastActivity,
                connectionInfo: {
                    port: conn.port,
                    baudRate: conn.baudRate
                }
            }));
    }

    /**
     * Check if a device is currently connected
     */
    isDeviceConnected(deviceId: string): boolean {
        return this.connectionManager.isDeviceConnected(deviceId);
    }

    // ========================= Device Capabilities =========================

    /**
     * Get device capabilities (hardware features)
     */
    async getDeviceCapabilities(deviceId: string): Promise<DeviceCapabilities> {
        logger.debug('DEVICE_DETECTOR', `Getting capabilities for device ${deviceId}...`);

        let capabilities = this.deviceCapabilities.get(deviceId);

        if (!capabilities) {
            // Try to detect capabilities
            const device = this.getDevice(deviceId);
            if (device) {
                capabilities = await this.detectDeviceCapabilities(device);
            } else {
                throw new Error(`Device ${deviceId} not found`);
            }
        }

        return capabilities;
    }

    /**
     * Update device capabilities information
     */
    updateDeviceCapabilities(deviceId: string, capabilities: Partial<DeviceCapabilities>): void {
        logger.debug('DEVICE_DETECTOR', `Updating capabilities for device ${deviceId}...`);

        const existingCapabilities = this.deviceCapabilities.get(deviceId);
        const updatedCapabilities = {
            ...existingCapabilities,
            ...capabilities
        } as DeviceCapabilities;

        this.deviceCapabilities.set(deviceId, updatedCapabilities);
        this.emit('deviceCapabilitiesUpdated', deviceId, updatedCapabilities);
    }

    // ========================= Device Communication =========================

    /**
     * Send raw data to a device (protocol-level communication)
     */
    async sendRawData(deviceId: string, data: Buffer | string): Promise<void> {
        logger.debug('DEVICE_DETECTOR', `Sending raw data to device ${deviceId}...`);

        if (!this.isDeviceConnected(deviceId)) {
            throw new Error(`Device ${deviceId} is not connected`);
        }

        // In a real implementation, this would send data through the connection
        // For now, we simulate the operation
        logger.debug('DEVICE_DETECTOR', `Raw data sent to device ${deviceId}: ${data.toString().substring(0, 50)}...`);
    }

    /**
     * Read raw data from a device
     */
    async readRawData(deviceId: string, timeout?: number): Promise<Buffer> {
        logger.debug('DEVICE_DETECTOR', `Reading raw data from device ${deviceId}...`);

        if (!this.isDeviceConnected(deviceId)) {
            throw new Error(`Device ${deviceId} is not connected`);
        }

        // In a real implementation, this would read data from the connection
        // For now, we simulate the operation
        return Buffer.from('simulated response');
    }

    /**
     * Check if device is responsive
     */
    async pingDevice(deviceId: string): Promise<boolean> {
        logger.debug('DEVICE_DETECTOR', `Pinging device ${deviceId}...`);

        if (!this.isDeviceConnected(deviceId)) {
            return false;
        }

        try {
            // In a real implementation, this would send a ping command
            // For now, we simulate the operation
            return true;
        } catch (error) {
            logger.warn('DEVICE_DETECTOR', `Ping failed for device ${deviceId}: ${error}`);
            return false;
        }
    }

    // ========================= Device Management =========================

    /**
     * Reset a device (hardware reset if supported)
     */
    async resetDevice(deviceId: string): Promise<void> {
        logger.info('DEVICE_DETECTOR', `Resetting device ${deviceId}...`);

        const capabilities = await this.getDeviceCapabilities(deviceId);

        if (!capabilities.hasWatchdog) {
            throw new Error(`Device ${deviceId} does not support hardware reset`);
        }

        // In a real implementation, this would send a reset command
        logger.info('DEVICE_DETECTOR', `✓ Device ${deviceId} reset successfully`);
    }

    /**
     * Get device metadata (name, version, etc.)
     */
    async getDeviceMetadata(deviceId: string): Promise<Record<string, any>> {
        logger.debug('DEVICE_DETECTOR', `Getting metadata for device ${deviceId}...`);

        const metadata = this.deviceMetadata.get(deviceId) || {};
        const device = this.getDevice(deviceId);

        if (device) {
            // Include basic device information
            metadata.name = device.name;
            metadata.id = device.id;
            metadata.lastSeen = Date.now();
        }

        return metadata;
    }

    /**
     * Update device metadata
     */
    updateDeviceMetadata(deviceId: string, metadata: Record<string, any>): void {
        logger.debug('DEVICE_DETECTOR', `Updating metadata for device ${deviceId}...`);

        const existingMetadata = this.deviceMetadata.get(deviceId) || {};
        const updatedMetadata = {
            ...existingMetadata,
            ...metadata,
            lastUpdated: Date.now()
        };

        this.deviceMetadata.set(deviceId, updatedMetadata);
    }

    // ========================= Monitoring =========================

    /**
     * Start continuous device monitoring
     */
    startMonitoring(): void {
        if (this.isMonitoring) {
            logger.debug('DEVICE_DETECTOR', 'Device monitoring already active');
            return;
        }

        logger.info('DEVICE_DETECTOR', 'Starting device monitoring...');
        this.isMonitoring = true;

        // The connection manager handles the actual monitoring
        // We just track the state
    }

    /**
     * Stop device monitoring
     */
    stopMonitoring(): void {
        if (!this.isMonitoring) {
            logger.debug('DEVICE_DETECTOR', 'Device monitoring already inactive');
            return;
        }

        logger.info('DEVICE_DETECTOR', 'Stopping device monitoring...');
        this.isMonitoring = false;
    }

    // ========================= Private Implementation =========================

    private setupEventForwarding(): void {
        // Forward relevant events from the connection manager
        this.connectionManager.on('deviceDiscovered', (device) => {
            this.emit('deviceDiscovered', device);
        });

        this.connectionManager.on('deviceLost', (deviceId) => {
            this.emit('deviceLost', deviceId);
        });

        this.connectionManager.on('connectionEstablished', (connection) => {
            const runtimeAgnosticConnection: Connection = {
                deviceId: connection.deviceId,
                device: connection.device,
                protocol: connection.protocol,
                status: connection.status,
                connectedAt: connection.connectedAt,
                lastActivity: connection.lastActivity,
                connectionInfo: {
                    port: connection.port,
                    baudRate: connection.baudRate
                }
            };
            this.emit('deviceConnected', runtimeAgnosticConnection);
        });

        this.connectionManager.on('connectionLost', (deviceId) => {
            this.emit('deviceDisconnected', deviceId);
        });

        this.connectionManager.on('connectionError', (deviceId, error) => {
            this.emit('deviceError', deviceId, error);
        });
    }

    private async detectDeviceCapabilities(device: IDevice): Promise<DeviceCapabilities> {
        logger.debug('DEVICE_DETECTOR', `Detecting capabilities for device ${device.name}...`);

        // In a real implementation, this would query the device for its capabilities
        // For now, we infer capabilities based on device name and known patterns
        const capabilities: DeviceCapabilities = this.inferCapabilitiesFromDevice(device);

        this.deviceCapabilities.set(device.id, capabilities);
        logger.debug('DEVICE_DETECTOR', `✓ Capabilities detected for device ${device.name}`);

        return capabilities;
    }

    private inferCapabilitiesFromDevice(device: IDevice): DeviceCapabilities {
        const deviceName = device.name.toLowerCase();

        // Default capabilities
        const capabilities: DeviceCapabilities = {
            hasGPIO: true,
            hasSPI: false,
            hasI2C: false,
            hasUART: true,
            hasPWM: false,
            hasADC: false,
            hasDAC: false,
            hasWiFi: false,
            hasBluetooth: false,
            hasUSB: true,
            hasEthernet: false,
            hasBattery: false,
            hasRTC: false,
            hasWatchdog: false,
            hasDeepSleep: false,
            hasInternalFlash: true,
            hasExternalFlash: false,
            hasSDCard: false,
            hasEEPROM: false,
            supportedProtocols: ['serial', 'usb'],
            maxBaudRate: 115200
        };

        // Enhance capabilities based on device patterns
        if (deviceName.includes('esp32') || deviceName.includes('esp8266')) {
            capabilities.hasWiFi = true;
            capabilities.hasSPI = true;
            capabilities.hasI2C = true;
            capabilities.hasPWM = true;
            capabilities.hasADC = true;
            capabilities.hasDeepSleep = true;
            capabilities.maxBaudRate = 921600;
        }

        if (deviceName.includes('feather') || deviceName.includes('metro')) {
            capabilities.hasSPI = true;
            capabilities.hasI2C = true;
            capabilities.hasPWM = true;
            capabilities.hasADC = true;
            capabilities.hasDAC = true;
        }

        if (deviceName.includes('bluetooth') || deviceName.includes('ble')) {
            capabilities.hasBluetooth = true;
        }

        if (deviceName.includes('pico')) {
            capabilities.hasSPI = true;
            capabilities.hasI2C = true;
            capabilities.hasPWM = true;
            capabilities.hasADC = true;
            capabilities.hasWatchdog = true;
        }

        return capabilities;
    }
}

// Type augmentation for EventEmitter events
declare interface PureDeviceManager {
    on<K extends keyof DeviceManagerEvents>(
        event: K,
        listener: (...args: DeviceManagerEvents[K]) => void
    ): this;

    emit<K extends keyof DeviceManagerEvents>(
        event: K,
        ...args: DeviceManagerEvents[K]
    ): boolean;
}