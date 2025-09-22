/**
 * Device Connection Manager
 *
 * Phase 2 - Separation of Concerns: Pure device discovery and connection management
 *
 * Responsibilities:
 * - Device detection and discovery
 * - Connection establishment and management
 * - Protocol handling (serial, USB, etc.)
 * - Connection health monitoring
 *
 * This component is completely runtime-agnostic and focuses solely on device connectivity.
 * Runtime binding is handled separately by the MuTwoRuntimeCoordinator.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { IDevice, MuDeviceDetector, DetectionResult } from '../devices/core/deviceDetector';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Connection status for a device
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'timeout';

/**
 * Connection protocol types
 */
export type ConnectionProtocol = 'serial' | 'usb' | 'wifi' | 'bluetooth' | 'virtual';

/**
 * Device connection information
 */
export interface DeviceConnection {
    deviceId: string;
    device: IDevice;
    protocol: ConnectionProtocol;
    status: ConnectionStatus;
    connectedAt?: number;
    lastActivity?: number;
    port?: string;
    baudRate?: number;
    error?: string;
}

/**
 * Connection configuration options
 */
export interface ConnectionConfig {
    protocol: ConnectionProtocol;
    port?: string;
    baudRate?: number;
    timeout?: number;
    retryAttempts?: number;
    autoReconnect?: boolean;
}

/**
 * Device connection events
 */
export interface DeviceConnectionEvents {
    'deviceDiscovered': [IDevice];
    'deviceLost': [string]; // deviceId
    'connectionEstablished': [DeviceConnection];
    'connectionLost': [string]; // deviceId
    'connectionError': [string, Error]; // deviceId, error
    'deviceActivity': [string]; // deviceId
}

/**
 * Device Connection Manager Implementation
 *
 * Handles pure device connectivity without runtime concerns
 */
export class DeviceConnectionManager extends EventEmitter {
    private static instance: DeviceConnectionManager;

    // Device detection
    private deviceDetector: MuDeviceDetector;
    private knownDevices = new Map<string, IDevice>();

    // Connection management
    private activeConnections = new Map<string, DeviceConnection>();
    private connectionConfigs = new Map<string, ConnectionConfig>();

    // Monitoring
    private detectionInterval: NodeJS.Timeout | null = null;
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private isInitialized = false;

    constructor(private context: vscode.ExtensionContext) {
        super();
        this.deviceDetector = new MuDeviceDetector();

        logger.info('DEVICE_DETECTOR', 'DeviceConnectionManager created - pure device connectivity');
    }

    /**
     * Singleton pattern for extension-wide device connection management
     */
    static getInstance(context: vscode.ExtensionContext): DeviceConnectionManager {
        if (!DeviceConnectionManager.instance) {
            DeviceConnectionManager.instance = new DeviceConnectionManager(context);
        }
        return DeviceConnectionManager.instance;
    }

    /**
     * Initialize the device connection manager
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            logger.debug('DEVICE_DETECTOR', 'DeviceConnectionManager already initialized');
            return;
        }

        logger.info('DEVICE_DETECTOR', 'Initializing DeviceConnectionManager...');

        try {
            // Start device detection
            await this.startDeviceDetection();

            // Start connection health monitoring
            this.startHealthMonitoring();

            this.isInitialized = true;
            logger.info('DEVICE_DETECTOR', '✓ DeviceConnectionManager initialized successfully');

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Failed to initialize DeviceConnectionManager: ${error}`);
            throw error;
        }
    }

    /**
     * Dispose the device connection manager
     */
    async dispose(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        logger.info('DEVICE_DETECTOR', 'Disposing DeviceConnectionManager...');

        // Stop monitoring
        if (this.detectionInterval) {
            clearInterval(this.detectionInterval);
            this.detectionInterval = null;
        }

        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        // Disconnect all active connections
        for (const [deviceId] of this.activeConnections) {
            try {
                await this.disconnectDevice(deviceId);
            } catch (error) {
                logger.warn('DEVICE_DETECTOR', `Error disconnecting device ${deviceId}: ${error}`);
            }
        }

        // Clear state
        this.activeConnections.clear();
        this.knownDevices.clear();
        this.connectionConfigs.clear();
        this.removeAllListeners();

        // Dispose device detector
        if (this.deviceDetector) {
            this.deviceDetector.dispose();
        }

        this.isInitialized = false;
        logger.info('DEVICE_DETECTOR', '✓ DeviceConnectionManager disposed');
    }

    // ========================= Device Discovery =========================

    /**
     * Get all currently known devices (connected and discoverable)
     */
    async getAvailableDevices(): Promise<IDevice[]> {
        logger.debug('DEVICE_DETECTOR', 'Getting available devices...');

        try {
            const detectionResult = await this.deviceDetector.detectDevices();

            // Update known devices
            for (const device of detectionResult.connectedDevices) {
                this.knownDevices.set(device.id, device);
            }

            logger.debug('DEVICE_DETECTOR', `Found ${detectionResult.connectedDevices.length} available devices`);
            return detectionResult.connectedDevices;

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Failed to get available devices: ${error}`);
            throw error;
        }
    }

    /**
     * Get a specific device by ID
     */
    getDevice(deviceId: string): IDevice | null {
        return this.knownDevices.get(deviceId) || null;
    }

    /**
     * Check if a device is currently connected
     */
    isDeviceConnected(deviceId: string): boolean {
        const connection = this.activeConnections.get(deviceId);
        return connection?.status === 'connected';
    }

    // ========================= Connection Management =========================

    /**
     * Connect to a device with specified configuration
     */
    async connectToDevice(deviceId: string, config?: Partial<ConnectionConfig>): Promise<DeviceConnection> {
        logger.info('DEVICE_DETECTOR', `Connecting to device ${deviceId}...`);

        const device = this.knownDevices.get(deviceId);
        if (!device) {
            throw new Error(`Device ${deviceId} not found in known devices`);
        }

        // Check if already connected
        const existingConnection = this.activeConnections.get(deviceId);
        if (existingConnection?.status === 'connected') {
            logger.debug('DEVICE_DETECTOR', `Device ${deviceId} already connected`);
            return existingConnection;
        }

        // Prepare connection configuration
        const connectionConfig: ConnectionConfig = {
            protocol: 'serial', // Default protocol
            baudRate: 115200,   // Standard CircuitPython baud rate
            timeout: 5000,      // 5 second timeout
            retryAttempts: 3,
            autoReconnect: true,
            ...config
        };

        // Store configuration
        this.connectionConfigs.set(deviceId, connectionConfig);

        // Create connection entry
        const connection: DeviceConnection = {
            deviceId,
            device,
            protocol: connectionConfig.protocol,
            status: 'connecting',
            port: connectionConfig.port,
            baudRate: connectionConfig.baudRate
        };

        this.activeConnections.set(deviceId, connection);

        try {
            // Perform actual connection based on protocol
            await this.establishConnection(connection, connectionConfig);

            // Update connection status
            connection.status = 'connected';
            connection.connectedAt = Date.now();
            connection.lastActivity = Date.now();

            this.emit('connectionEstablished', connection);
            logger.info('DEVICE_DETECTOR', `✓ Connected to device ${deviceId} via ${connectionConfig.protocol}`);

            return connection;

        } catch (error) {
            // Update connection with error
            connection.status = 'error';
            connection.error = error instanceof Error ? error.message : String(error);

            this.emit('connectionError', deviceId, error instanceof Error ? error : new Error(String(error)));
            logger.error('DEVICE_DETECTOR', `Failed to connect to device ${deviceId}: ${error}`);

            throw error;
        }
    }

    /**
     * Disconnect from a device
     */
    async disconnectDevice(deviceId: string): Promise<void> {
        logger.info('DEVICE_DETECTOR', `Disconnecting from device ${deviceId}...`);

        const connection = this.activeConnections.get(deviceId);
        if (!connection) {
            logger.debug('DEVICE_DETECTOR', `Device ${deviceId} not connected`);
            return;
        }

        try {
            // Perform protocol-specific disconnection
            await this.terminateConnection(connection);

            // Remove connection
            this.activeConnections.delete(deviceId);
            this.connectionConfigs.delete(deviceId);

            this.emit('connectionLost', deviceId);
            logger.info('DEVICE_DETECTOR', `✓ Disconnected from device ${deviceId}`);

        } catch (error) {
            logger.error('DEVICE_DETECTOR', `Error disconnecting from device ${deviceId}: ${error}`);
            throw error;
        }
    }

    /**
     * Get all active connections
     */
    getActiveConnections(): Map<string, DeviceConnection> {
        return new Map(this.activeConnections);
    }

    /**
     * Get connection info for a specific device
     */
    getConnection(deviceId: string): DeviceConnection | null {
        return this.activeConnections.get(deviceId) || null;
    }

    // ========================= Connection Health =========================

    /**
     * Check the health of all active connections
     */
    async checkConnectionHealth(): Promise<void> {
        logger.debug('DEVICE_DETECTOR', 'Checking connection health...');

        for (const [deviceId, connection] of this.activeConnections) {
            try {
                if (connection.status === 'connected') {
                    const isHealthy = await this.pingConnection(connection);

                    if (!isHealthy) {
                        logger.warn('DEVICE_DETECTOR', `Connection to device ${deviceId} appears unhealthy`);
                        connection.status = 'error';
                        connection.error = 'Connection health check failed';
                        this.emit('connectionError', deviceId, new Error('Connection unhealthy'));
                    } else {
                        connection.lastActivity = Date.now();
                        this.emit('deviceActivity', deviceId);
                    }
                }
            } catch (error) {
                logger.warn('DEVICE_DETECTOR', `Health check failed for device ${deviceId}: ${error}`);
            }
        }
    }

    // ========================= Private Implementation =========================

    private async startDeviceDetection(): Promise<void> {
        logger.debug('DEVICE_DETECTOR', 'Starting device detection monitoring...');

        // Initial device detection
        await this.detectAndUpdateDevices();

        // Set up periodic detection (every 5 seconds)
        this.detectionInterval = setInterval(async () => {
            try {
                await this.detectAndUpdateDevices();
            } catch (error) {
                logger.warn('DEVICE_DETECTOR', `Device detection error: ${error}`);
            }
        }, 5000);
    }

    private async detectAndUpdateDevices(): Promise<void> {
        try {
            const detectionResult = await this.deviceDetector.detectDevices();

            // Track new and lost devices
            const currentDeviceIds = new Set(detectionResult.connectedDevices.map(d => d.id));
            const previousDeviceIds = new Set(this.knownDevices.keys());

            // Find newly discovered devices
            for (const device of detectionResult.connectedDevices) {
                if (!previousDeviceIds.has(device.id)) {
                    this.knownDevices.set(device.id, device);
                    this.emit('deviceDiscovered', device);
                    logger.info('DEVICE_DETECTOR', `Device discovered: ${device.name} (${device.id})`);
                } else {
                    // Update existing device info
                    this.knownDevices.set(device.id, device);
                }
            }

            // Find lost devices
            for (const deviceId of previousDeviceIds) {
                if (!currentDeviceIds.has(deviceId)) {
                    this.knownDevices.delete(deviceId);

                    // Disconnect if was connected
                    if (this.activeConnections.has(deviceId)) {
                        await this.disconnectDevice(deviceId);
                    }

                    this.emit('deviceLost', deviceId);
                    logger.info('DEVICE_DETECTOR', `Device lost: ${deviceId}`);
                }
            }

        } catch (error) {
            logger.warn('DEVICE_DETECTOR', `Device detection failed: ${error}`);
        }
    }

    private startHealthMonitoring(): void {
        logger.debug('DEVICE_DETECTOR', 'Starting connection health monitoring...');

        // Check connection health every 10 seconds
        this.healthCheckInterval = setInterval(() => {
            this.checkConnectionHealth().catch(error => {
                logger.warn('DEVICE_DETECTOR', `Health monitoring error: ${error}`);
            });
        }, 10000);
    }

    private async establishConnection(connection: DeviceConnection, config: ConnectionConfig): Promise<void> {
        logger.debug('DEVICE_DETECTOR', `Establishing ${config.protocol} connection to ${connection.deviceId}...`);

        switch (config.protocol) {
            case 'serial':
                await this.establishSerialConnection(connection, config);
                break;
            case 'usb':
                await this.establishUSBConnection(connection, config);
                break;
            case 'virtual':
                await this.establishVirtualConnection(connection, config);
                break;
            default:
                throw new Error(`Unsupported connection protocol: ${config.protocol}`);
        }
    }

    private async establishSerialConnection(connection: DeviceConnection, config: ConnectionConfig): Promise<void> {
        // In a real implementation, this would:
        // 1. Open serial port
        // 2. Configure baud rate and settings
        // 3. Test communication
        // 4. Set up data handlers

        logger.debug('DEVICE_DETECTOR', `Serial connection to ${connection.deviceId} established (simulated)`);

        // Simulate connection delay
        await new Promise(resolve => setTimeout(resolve, 1000));

        // For now, we simulate successful connection
        // Real implementation would use node-serialport or similar
    }

    private async establishUSBConnection(connection: DeviceConnection, config: ConnectionConfig): Promise<void> {
        // USB connection implementation
        logger.debug('DEVICE_DETECTOR', `USB connection to ${connection.deviceId} established (simulated)`);
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    private async establishVirtualConnection(connection: DeviceConnection, config: ConnectionConfig): Promise<void> {
        // Virtual connection for WASM/simulation
        logger.debug('DEVICE_DETECTOR', `Virtual connection to ${connection.deviceId} established`);
        // Virtual connections are instant
    }

    private async terminateConnection(connection: DeviceConnection): Promise<void> {
        logger.debug('DEVICE_DETECTOR', `Terminating connection to ${connection.deviceId}...`);

        switch (connection.protocol) {
            case 'serial':
                // Close serial port
                break;
            case 'usb':
                // Close USB connection
                break;
            case 'virtual':
                // Clean up virtual connection
                break;
        }

        // Simulate cleanup delay
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    private async pingConnection(connection: DeviceConnection): Promise<boolean> {
        // Implement connection health check based on protocol
        switch (connection.protocol) {
            case 'serial':
                // Send a simple command and check for response
                return true; // Simulated
            case 'usb':
                // Check USB device status
                return true; // Simulated
            case 'virtual':
                // Virtual connections are always healthy
                return true;
            default:
                return false;
        }
    }
}

// Type augmentation for EventEmitter events
declare interface DeviceConnectionManager {
    on<K extends keyof DeviceConnectionEvents>(
        event: K,
        listener: (...args: DeviceConnectionEvents[K]) => void
    ): this;

    emit<K extends keyof DeviceConnectionEvents>(
        event: K,
        ...args: DeviceConnectionEvents[K]
    ): boolean;
}