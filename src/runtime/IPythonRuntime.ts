/**
 * Python Runtime Abstraction Layer
 *
 * Provides a unified interface for different Python runtime implementations:
 * - CircuitPython (flagship runtime)
 * - MicroPython
 * - Standard Python (future)
 *
 * This enables Mu Two Editor to be truly runtime-agnostic while maintaining
 * CircuitPython as the primary, best-supported runtime.
 */

import { EventEmitter } from 'events';

// Core runtime types
export type PythonRuntimeType = 'circuitpython' | 'micropython' | 'python';
export type ExecutionMode = 'repl' | 'file' | 'raw';

// Runtime capabilities that vary between implementations
export interface RuntimeCapabilities {
    // Hardware access capabilities
    hasGPIO: boolean;
    hasSPI: boolean;
    hasI2C: boolean;
    hasUART: boolean;
    hasPWM: boolean;
    hasADC: boolean;

    // Built-in modules and features
    hasBuiltinSensors: boolean;
    hasWiFi: boolean;
    hasBluetooth: boolean;
    hasUSB: boolean;
    hasFileSystem: boolean;

    // Language features
    hasAsyncAwait: boolean;
    hasTypeHints: boolean;
    hasF_strings: boolean;
    hasDataclasses: boolean;

    // Development features
    hasREPL: boolean;
    hasDebugging: boolean;
    hasProfiler: boolean;
    hasMemoryIntrospection: boolean;

    // Hardware simulation
    supportsVirtualHardware: boolean;
    supportsWASMExecution: boolean;
}

// Runtime version information
export interface RuntimeVersion {
    major: number;
    minor: number;
    patch: number;
    prerelease?: string;
    build?: string;
    full: string; // e.g., "8.2.6", "1.20.0", "3.11.5"
}

// Execution context for runtime operations
export interface RuntimeExecutionContext {
    mode: ExecutionMode;
    timeout?: number;
    workingDirectory?: string;
    environment?: Record<string, string>;
    enableHardwareAccess?: boolean;
    enableDebugging?: boolean;
}

// Execution result from runtime
export interface RuntimeExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    executionTime: number;
    memoryUsage?: {
        used: number;
        free: number;
        total: number;
    };
    hardwareChanges?: Array<{
        type: 'pin' | 'sensor' | 'actuator';
        target: string | number;
        oldValue: any;
        newValue: any;
        timestamp: number;
    }>;
}

// Module/library information
export interface RuntimeModule {
    name: string;
    version?: string;
    description?: string;
    isBuiltin: boolean;
    isInstalled: boolean;
    dependencies?: string[];
    documentation?: string;
    examples?: Array<{
        title: string;
        code: string;
        description?: string;
    }>;
}

// Device/board information for runtime
export interface RuntimeDevice {
    id: string;
    name: string;
    runtime: PythonRuntimeType;
    version: RuntimeVersion;
    capabilities: RuntimeCapabilities;
    modules: RuntimeModule[];
    isPhysical: boolean;
    connectionInfo?: {
        port?: string;
        baudRate?: number;
        protocol?: 'serial' | 'usb' | 'wifi' | 'bluetooth';
    };
}

// Runtime configuration
export interface RuntimeConfig {
    type: PythonRuntimeType;
    version?: string;
    wasmPath?: string;
    interpreterPath?: string;
    libraryPaths?: string[];
    enableExtensions?: boolean;
    debugMode?: boolean;
    memoryLimit?: number;
    executionTimeout?: number;
}

/**
 * Core Python Runtime Interface
 *
 * All Python runtime implementations must implement this interface
 * to provide consistent behavior across CircuitPython, MicroPython, etc.
 */
export interface IPythonRuntime extends EventEmitter {
    // Runtime identification
    readonly type: PythonRuntimeType;
    readonly version: RuntimeVersion;
    readonly capabilities: RuntimeCapabilities;
    readonly isInitialized: boolean;

    // Lifecycle management
    initialize(config?: RuntimeConfig): Promise<void>;
    dispose(): Promise<void>;
    reset(): Promise<void>;

    // Health and status
    isHealthy(): Promise<boolean>;
    getStatus(): Promise<{
        initialized: boolean;
        connected: boolean;
        memoryUsage?: { used: number; free: number; total: number };
        uptime: number;
    }>;

    // Code execution
    executeCode(
        code: string,
        context?: RuntimeExecutionContext
    ): Promise<RuntimeExecutionResult>;

    executeFile(
        filePath: string,
        context?: RuntimeExecutionContext
    ): Promise<RuntimeExecutionResult>;

    // REPL interaction
    startREPL(): Promise<boolean>;
    stopREPL(): Promise<boolean>;
    sendREPLCommand(command: string): Promise<string>;

    // Module management
    getAvailableModules(): Promise<RuntimeModule[]>;
    getInstalledModules(): Promise<RuntimeModule[]>;
    installModule(moduleName: string): Promise<boolean>;
    getModuleDocumentation(moduleName: string): Promise<string | null>;

    // Device management (for hardware-capable runtimes)
    getConnectedDevices(): Promise<RuntimeDevice[]>;
    connectToDevice(deviceId: string): Promise<boolean>;
    disconnectFromDevice(deviceId: string): Promise<boolean>;

    // Hardware abstraction (for embedded runtimes)
    getHardwareCapabilities(): RuntimeCapabilities;
    queryHardwareState?(): Promise<Record<string, any>>;
    setHardwareState?(updates: Record<string, any>): Promise<boolean>;

    // Events (extends EventEmitter)
    // 'initialized' | 'disposed' | 'connected' | 'disconnected' | 'error' | 'output' | 'hardwareChange'
}

/**
 * Runtime Factory for creating appropriate runtime instances
 */
export interface IRuntimeFactory {
    // Runtime creation
    createRuntime(type: PythonRuntimeType, config?: RuntimeConfig): Promise<IPythonRuntime>;

    // Runtime detection
    detectAvailableRuntimes(): Promise<Array<{
        type: PythonRuntimeType;
        version: RuntimeVersion;
        path: string;
        isAvailable: boolean;
    }>>;

    // Runtime validation
    validateRuntime(type: PythonRuntimeType, path: string): Promise<boolean>;
    getDefaultConfig(type: PythonRuntimeType): RuntimeConfig;
}

/**
 * Runtime Manager for coordinating multiple runtime instances
 */
export interface IRuntimeManager extends EventEmitter {
    // Runtime lifecycle
    initialize(): Promise<void>;
    dispose(): Promise<void>;

    // Runtime management
    registerRuntime(runtime: IPythonRuntime): void;
    unregisterRuntime(type: PythonRuntimeType): void;
    getRuntime(type: PythonRuntimeType): IPythonRuntime | null;
    getAvailableRuntimes(): PythonRuntimeType[];

    // Default runtime
    setDefaultRuntime(type: PythonRuntimeType): void;
    getDefaultRuntime(): IPythonRuntime | null;

    // Runtime selection and switching
    selectBestRuntime(requirements?: {
        capabilities?: Partial<RuntimeCapabilities>;
        version?: string;
        deviceType?: string;
    }): IPythonRuntime | null;

    switchRuntime(fromType: PythonRuntimeType, toType: PythonRuntimeType): Promise<boolean>;

    // Device-runtime pairing
    pairDeviceWithRuntime(deviceId: string, runtimeType: PythonRuntimeType): Promise<boolean>;
    getDeviceRuntime(deviceId: string): IPythonRuntime | null;

    // Events: 'runtimeAdded' | 'runtimeRemoved' | 'defaultChanged' | 'switched'
}

/**
 * Runtime-specific device detection interface
 */
export interface IRuntimeDeviceDetector {
    readonly runtimeType: PythonRuntimeType;

    // Device detection
    detectDevices(): Promise<RuntimeDevice[]>;
    isDeviceCompatible(device: any): boolean;

    // Device information
    getDeviceCapabilities(deviceId: string): Promise<RuntimeCapabilities>;
    getDeviceModules(deviceId: string): Promise<RuntimeModule[]>;

    // Events
    on(event: 'deviceAdded' | 'deviceRemoved' | 'deviceChanged', listener: (device: RuntimeDevice) => void): this;
}

// Export all interfaces and types
export {
    PythonRuntimeType,
    ExecutionMode,
    RuntimeCapabilities,
    RuntimeVersion,
    RuntimeExecutionContext,
    RuntimeExecutionResult,
    RuntimeModule,
    RuntimeDevice,
    RuntimeConfig
};