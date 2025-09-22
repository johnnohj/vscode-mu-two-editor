/**
 * Device Manager Interface
 *
 * Phase 3 - Runtime-Agnostic Device Management: Pure device operations
 *
 * This interface defines device management completely independent of runtime concerns.
 * Runtime binding is handled separately by IRuntimeBinder.
 *
 * Responsibilities:
 * - Device detection and discovery
 * - Device connection and disconnection
 * - Device lifecycle management
 * - Device capabilities and metadata
 *
 * Does NOT handle:
 * - Runtime selection or binding
 * - Code execution
 * - Runtime-specific operations
 */

import { EventEmitter } from 'events';
import { IDevice } from '../devices/core/deviceDetector';

/**
 * Device connection information without runtime dependencies
 */
export interface Connection {
    deviceId: string;
    device: IDevice;
    protocol: 'serial' | 'usb' | 'wifi' | 'bluetooth' | 'virtual';
    status: 'connected' | 'connecting' | 'disconnected' | 'error';
    connectedAt?: number;
    lastActivity?: number;
    connectionInfo: {
        port?: string;
        baudRate?: number;
        endpoint?: string;
        address?: string;
    };
    metadata?: Record<string, any>;
}

/**
 * Device capabilities independent of runtime
 */
export interface DeviceCapabilities {
    // Hardware capabilities
    hasGPIO: boolean;
    hasSPI: boolean;
    hasI2C: boolean;
    hasUART: boolean;
    hasPWM: boolean;
    hasADC: boolean;
    hasDAC: boolean;

    // Connectivity
    hasWiFi: boolean;
    hasBluetooth: boolean;
    hasUSB: boolean;
    hasEthernet: boolean;

    // Power and system
    hasBattery: boolean;
    hasRTC: boolean;
    hasWatchdog: boolean;
    hasDeepSleep: boolean;

    // Storage
    hasInternalFlash: boolean;
    hasExternalFlash: boolean;
    hasSDCard: boolean;
    hasEEPROM: boolean;

    // Communication protocols
    supportedProtocols: string[];
    maxBaudRate?: number;
    firmwareVersion?: string;
    hardwareRevision?: string;
}

/**
 * Device events (runtime-agnostic)
 */
export interface DeviceManagerEvents {
    'deviceDiscovered': [IDevice];
    'deviceLost': [string]; // deviceId
    'deviceConnected': [Connection];
    'deviceDisconnected': [string]; // deviceId
    'deviceError': [string, Error]; // deviceId, error
    'deviceCapabilitiesUpdated': [string, DeviceCapabilities]; // deviceId, capabilities
}

/**
 * Pure Device Manager Interface
 *
 * Handles device operations without any runtime dependencies
 */
export interface IDeviceManager extends EventEmitter {
    // ========================= Device Discovery =========================

    /**
     * Detect all available devices
     */
    detectDevices(): Promise<IDevice[]>;

    /**
     * Get a specific device by ID
     */
    getDevice(deviceId: string): IDevice | null;

    /**
     * Get all currently known devices
     */
    getAllDevices(): IDevice[];

    /**
     * Check if a device is currently available
     */
    isDeviceAvailable(deviceId: string): boolean;

    // ========================= Device Connection =========================

    /**
     * Connect to a device (runtime-agnostic)
     */
    connectToDevice(deviceId: string, options?: {
        protocol?: string;
        port?: string;
        baudRate?: number;
        timeout?: number;
    }): Promise<Connection>;

    /**
     * Disconnect from a device
     */
    disconnectDevice(deviceId: string): Promise<void>;

    /**
     * Get connection info for a device
     */
    getConnection(deviceId: string): Connection | null;

    /**
     * Get all active connections
     */
    getActiveConnections(): Connection[];

    /**
     * Check if a device is currently connected
     */
    isDeviceConnected(deviceId: string): boolean;

    // ========================= Device Capabilities =========================

    /**
     * Get device capabilities (hardware features)
     */
    getDeviceCapabilities(deviceId: string): Promise<DeviceCapabilities>;

    /**
     * Update device capabilities information
     */
    updateDeviceCapabilities(deviceId: string, capabilities: Partial<DeviceCapabilities>): void;

    // ========================= Device Communication =========================

    /**
     * Send raw data to a device (protocol-level communication)
     */
    sendRawData(deviceId: string, data: Buffer | string): Promise<void>;

    /**
     * Read raw data from a device
     */
    readRawData(deviceId: string, timeout?: number): Promise<Buffer>;

    /**
     * Check if device is responsive
     */
    pingDevice(deviceId: string): Promise<boolean>;

    // ========================= Device Management =========================

    /**
     * Reset a device (hardware reset if supported)
     */
    resetDevice(deviceId: string): Promise<void>;

    /**
     * Get device metadata (name, version, etc.)
     */
    getDeviceMetadata(deviceId: string): Promise<Record<string, any>>;

    /**
     * Update device metadata
     */
    updateDeviceMetadata(deviceId: string, metadata: Record<string, any>): void;

    // ========================= Lifecycle Management =========================

    /**
     * Initialize the device manager
     */
    initialize(): Promise<void>;

    /**
     * Dispose the device manager and clean up resources
     */
    dispose(): Promise<void>;

    /**
     * Start continuous device monitoring
     */
    startMonitoring(): void;

    /**
     * Stop device monitoring
     */
    stopMonitoring(): void;
}

/**
 * Runtime Binder Interface
 *
 * Handles runtime binding as a completely separate concern from device management
 */
export interface IRuntimeBinder extends EventEmitter {
    /**
     * Bind a device to a specific runtime
     */
    bindDeviceToRuntime(deviceId: string, runtime: any): Promise<void>; // Using 'any' to avoid circular dependency

    /**
     * Unbind a device from its current runtime
     */
    unbindDevice(deviceId: string): Promise<void>;

    /**
     * Get the runtime bound to a device
     */
    getDeviceRuntime(deviceId: string): any | null; // Using 'any' to avoid circular dependency

    /**
     * Get all device-runtime bindings
     */
    getAllBindings(): Map<string, any>; // deviceId -> runtime

    /**
     * Check if a device has a runtime binding
     */
    hasRuntimeBinding(deviceId: string): boolean;

    /**
     * Switch a device to a different runtime
     */
    switchDeviceRuntime(deviceId: string, newRuntime: any): Promise<boolean>;

    /**
     * Get binding metadata for a device
     */
    getBindingMetadata(deviceId: string): {
        runtimeType: string;
        boundAt: number;
        lastActivity: number;
        preferences?: Record<string, any>;
    } | null;
}

/**
 * Runtime-Agnostic Execution Manager Interface
 *
 * Provides unified code execution across all runtime types
 */
export interface IExecutionManager extends EventEmitter {
    /**
     * Execute code on a device regardless of runtime
     */
    executeCode(deviceId: string, code: string, options?: {
        mode?: 'repl' | 'file' | 'raw';
        timeout?: number;
        workingDirectory?: string;
        environment?: Record<string, string>;
    }): Promise<{
        success: boolean;
        output: string;
        error?: string;
        executionTime: number;
        runtimeUsed: string;
    }>;

    /**
     * Execute code on multiple devices simultaneously
     */
    executeBatch(executions: Array<{
        deviceId: string;
        code: string;
        options?: any;
    }>): Promise<Array<{
        deviceId: string;
        result: any;
        error?: Error;
    }>>;

    /**
     * Interrupt execution on a device
     */
    interruptExecution(deviceId: string): Promise<void>;

    /**
     * Get execution status for a device
     */
    getExecutionStatus(deviceId: string): {
        isExecuting: boolean;
        currentRuntime?: string;
        startedAt?: number;
        progress?: number;
    };

    /**
     * Stream code execution (for real-time output)
     */
    streamExecution(deviceId: string, code: string): AsyncIterable<{
        type: 'output' | 'error' | 'progress' | 'complete';
        data: any;
        timestamp: number;
    }>;
}

/**
 * Device Manager Factory
 *
 * Creates appropriate device manager implementations
 */
export interface IDeviceManagerFactory {
    /**
     * Create a device manager for the current platform
     */
    createDeviceManager(): Promise<IDeviceManager>;

    /**
     * Create a runtime binder
     */
    createRuntimeBinder(): Promise<IRuntimeBinder>;

    /**
     * Create an execution manager
     */
    createExecutionManager(): Promise<IExecutionManager>;

    /**
     * Get supported device protocols
     */
    getSupportedProtocols(): string[];

    /**
     * Check if a protocol is supported
     */
    isProtocolSupported(protocol: string): boolean;
}