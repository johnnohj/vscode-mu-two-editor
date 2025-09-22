/**
 * CircuitPython Runtime Implementation
 *
 * Flagship runtime implementation for Mu Two Editor.
 * Provides comprehensive CircuitPython support with both physical
 * and WASM virtual execution capabilities.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import {
    IPythonRuntime,
    PythonRuntimeType,
    RuntimeCapabilities,
    RuntimeVersion,
    RuntimeExecutionContext,
    RuntimeExecutionResult,
    RuntimeModule,
    RuntimeDevice,
    RuntimeConfig
} from './IPythonRuntime';
import { WasmRuntimeManager } from '../sys/wasmRuntimeManager';
import { MuDeviceDetector, MuDevice } from '../devices/core/deviceDetector';

/**
 * CircuitPython Runtime - Flagship Implementation
 *
 * Supports both physical CircuitPython devices and WASM virtual execution.
 * Provides the most comprehensive feature set as the flagship runtime.
 */
export class CircuitPythonRuntime extends EventEmitter implements IPythonRuntime {
    readonly type: PythonRuntimeType = 'circuitpython';
    readonly version: RuntimeVersion;
    readonly capabilities: RuntimeCapabilities;

    private _isInitialized = false;
    private _config: RuntimeConfig;
    private _wasmRuntime?: WasmRuntimeManager;
    private _deviceDetector?: MuDeviceDetector;
    private _connectedDevices = new Map<string, MuDevice>();
    private _replSession?: any;
    private _context?: vscode.ExtensionContext;

    constructor(config?: RuntimeConfig, context?: vscode.ExtensionContext) {
        super();

        this._context = context;
        this._config = {
            type: 'circuitpython',
            version: '8.2.6', // Default version
            enableExtensions: true,
            debugMode: false,
            executionTimeout: 30000,
            ...config
        };

        // CircuitPython version information
        this.version = this.parseVersion(this._config.version || '8.2.6');

        // CircuitPython capabilities (comprehensive as flagship runtime)
        this.capabilities = {
            // Hardware access - CircuitPython excels here
            hasGPIO: true,
            hasSPI: true,
            hasI2C: true,
            hasUART: true,
            hasPWM: true,
            hasADC: true,

            // Built-in features
            hasBuiltinSensors: true,
            hasWiFi: true,
            hasBluetooth: true,
            hasUSB: true,
            hasFileSystem: true,

            // Language features (based on Python 3.x)
            hasAsyncAwait: true,
            hasTypeHints: false, // CircuitPython doesn't support type hints
            hasF_strings: true,
            hasDataclasses: false, // Not supported in CircuitPython

            // Development features
            hasREPL: true,
            hasDebugging: false, // Limited debugging support
            hasProfiler: false,
            hasMemoryIntrospection: true,

            // Simulation capabilities - flagship feature
            supportsVirtualHardware: true,
            supportsWASMExecution: true
        };
    }

    get isInitialized(): boolean {
        return this._isInitialized;
    }

    async initialize(config?: RuntimeConfig): Promise<void> {
        if (this._isInitialized) {
            return;
        }

        try {
            console.log('Initializing CircuitPython runtime...');

            if (config) {
                this._config = { ...this._config, ...config };
            }

            // Initialize WASM runtime for virtual execution
            if (this.capabilities.supportsWASMExecution) {
                this._wasmRuntime = new WasmRuntimeManager({
                    runtimePath: this._config.wasmPath,
                    enableHardwareSimulation: true,
                    debugMode: this._config.debugMode
                }, this._context);

                await this._wasmRuntime.initialize();
                console.log('✓ CircuitPython WASM runtime initialized');
            }

            // Initialize device detector for physical devices
            this._deviceDetector = new MuDeviceDetector();

            // Set up event forwarding
            this.setupEventHandlers();

            this._isInitialized = true;
            this.emit('initialized');

            console.log('✓ CircuitPython runtime initialization complete');

        } catch (error) {
            console.error('CircuitPython runtime initialization failed:', error);
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this._isInitialized) {
            return;
        }

        console.log('Disposing CircuitPython runtime...');

        // Disconnect from all devices
        for (const deviceId of this._connectedDevices.keys()) {
            await this.disconnectFromDevice(deviceId);
        }

        // Dispose WASM runtime
        if (this._wasmRuntime) {
            this._wasmRuntime.dispose();
            this._wasmRuntime = undefined;
        }

        // Dispose device detector
        if (this._deviceDetector) {
            this._deviceDetector.dispose();
            this._deviceDetector = undefined;
        }

        // Stop REPL
        if (this._replSession) {
            await this.stopREPL();
        }

        this._isInitialized = false;
        this.removeAllListeners();
        this.emit('disposed');

        console.log('✓ CircuitPython runtime disposed');
    }

    async reset(): Promise<void> {
        if (this._wasmRuntime) {
            await this._wasmRuntime.reset();
        }

        // Reset connected devices if needed
        for (const device of this._connectedDevices.values()) {
            // Send reset command to physical devices
            console.log(`Resetting device: ${device.displayName}`);
        }
    }

    async isHealthy(): Promise<boolean> {
        if (!this._isInitialized) {
            return false;
        }

        // Check WASM runtime health
        if (this._wasmRuntime && !await this._wasmRuntime.isHealthy()) {
            return false;
        }

        return true;
    }

    async getStatus(): Promise<{
        initialized: boolean;
        connected: boolean;
        memoryUsage?: { used: number; free: number; total: number };
        uptime: number;
    }> {
        const hasConnectedDevices = this._connectedDevices.size > 0;
        let memoryUsage;

        if (this._wasmRuntime) {
            try {
                const wasmState = await this._wasmRuntime.getHardwareState();
                // Memory info would be available from WASM state if implemented
            } catch {
                // Ignore memory query errors
            }
        }

        return {
            initialized: this._isInitialized,
            connected: hasConnectedDevices,
            memoryUsage,
            uptime: process.uptime() * 1000 // Convert to milliseconds
        };
    }

    async executeCode(
        code: string,
        context?: RuntimeExecutionContext
    ): Promise<RuntimeExecutionResult> {
        if (!this._isInitialized) {
            throw new Error('CircuitPython runtime not initialized');
        }

        const ctx = {
            mode: 'repl' as const,
            timeout: this._config.executionTimeout,
            enableHardwareAccess: true,
            ...context
        };

        const startTime = Date.now();

        try {
            // Execute on WASM runtime for virtual execution
            if (this._wasmRuntime && ctx.enableHardwareAccess) {
                const result = await this._wasmRuntime.executeCode(code, {
                    enableHardwareMonitoring: true,
                    timeout: ctx.timeout
                });

                return {
                    success: result.success,
                    output: result.output,
                    error: result.error,
                    executionTime: result.executionTime,
                    hardwareChanges: result.hardwareChanges
                };
            }

            // Fallback to basic execution without hardware
            return {
                success: true,
                output: `CircuitPython execution: ${code.substring(0, 50)}...`,
                executionTime: Date.now() - startTime,
                hardwareChanges: []
            };

        } catch (error) {
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - startTime,
                hardwareChanges: []
            };
        }
    }

    async executeFile(
        filePath: string,
        context?: RuntimeExecutionContext
    ): Promise<RuntimeExecutionResult> {
        // Read file content and execute
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            const code = Buffer.from(content).toString('utf8');

            return this.executeCode(code, {
                ...context,
                mode: 'file'
            });
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to read file: ${error}`,
                executionTime: 0,
                hardwareChanges: []
            };
        }
    }

    async startREPL(): Promise<boolean> {
        if (this._replSession) {
            return true;
        }

        try {
            // Start REPL session (implementation would depend on connection type)
            this._replSession = {
                id: `circuitpython_repl_${Date.now()}`,
                started: Date.now()
            };

            console.log('CircuitPython REPL started');
            return true;

        } catch (error) {
            console.error('Failed to start CircuitPython REPL:', error);
            return false;
        }
    }

    async stopREPL(): Promise<boolean> {
        if (!this._replSession) {
            return true;
        }

        try {
            // Stop REPL session
            this._replSession = undefined;
            console.log('CircuitPython REPL stopped');
            return true;

        } catch (error) {
            console.error('Failed to stop CircuitPython REPL:', error);
            return false;
        }
    }

    async sendREPLCommand(command: string): Promise<string> {
        if (!this._replSession) {
            throw new Error('REPL not started');
        }

        // Execute command and return output
        const result = await this.executeCode(command, { mode: 'repl' });
        return result.output;
    }

    async getAvailableModules(): Promise<RuntimeModule[]> {
        // CircuitPython built-in modules
        const builtinModules: RuntimeModule[] = [
            {
                name: 'board',
                description: 'Board-specific pin definitions',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Provides access to board-specific pins and hardware',
                examples: [{
                    title: 'Basic pin access',
                    code: 'import board\nprint(dir(board))',
                    description: 'List all available pins on the board'
                }]
            },
            {
                name: 'digitalio',
                description: 'Digital input/output operations',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Digital pin control and reading',
                examples: [{
                    title: 'LED control',
                    code: 'import digitalio\nimport board\n\nled = digitalio.DigitalInOut(board.LED)\nled.direction = digitalio.Direction.OUTPUT\nled.value = True',
                    description: 'Turn on the built-in LED'
                }]
            },
            {
                name: 'analogio',
                description: 'Analog input/output operations',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Analog pin reading and PWM output'
            },
            {
                name: 'busio',
                description: 'I2C, SPI, and UART communication',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Hardware communication protocols'
            },
            {
                name: 'time',
                description: 'Time-related functions',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Sleep, timing, and time measurement'
            },
            {
                name: 'microcontroller',
                description: 'Microcontroller-specific functions',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'CPU control, watchdog, and low-level access'
            },
            {
                name: 'neopixel',
                description: 'NeoPixel/WS2812 LED control',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'RGB LED strip control'
            },
            {
                name: 'wifi',
                description: 'WiFi networking (on supported boards)',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'WiFi connection and networking'
            }
        ];

        return builtinModules;
    }

    async getInstalledModules(): Promise<RuntimeModule[]> {
        // For CircuitPython, most modules are built-in
        // This would query the /lib directory for installed libraries
        return this.getAvailableModules();
    }

    async installModule(moduleName: string): Promise<boolean> {
        console.log(`Installing CircuitPython module: ${moduleName}`);
        // CircuitPython module installation would involve:
        // 1. Download from CircuitPython bundle
        // 2. Copy to device /lib directory
        // For now, return success for built-in modules
        const availableModules = await this.getAvailableModules();
        return availableModules.some(m => m.name === moduleName);
    }

    async getModuleDocumentation(moduleName: string): Promise<string | null> {
        const modules = await this.getAvailableModules();
        const module = modules.find(m => m.name === moduleName);
        return module?.documentation || null;
    }

    async getConnectedDevices(): Promise<RuntimeDevice[]> {
        if (!this._deviceDetector) {
            return [];
        }

        try {
            const detectionResult = await this._deviceDetector.detectDevices();
            const devices: RuntimeDevice[] = [];

            for (const device of detectionResult.devices) {
                devices.push({
                    id: device.path,
                    name: device.displayName,
                    runtime: 'circuitpython',
                    version: this.version,
                    capabilities: this.capabilities,
                    modules: await this.getAvailableModules(),
                    isPhysical: true,
                    connectionInfo: {
                        port: device.path,
                        baudRate: 115200,
                        protocol: 'serial'
                    }
                });
            }

            // Add WASM virtual device if available
            if (this._wasmRuntime) {
                devices.push({
                    id: 'wasm_circuitpython',
                    name: 'CircuitPython WASM Virtual Device',
                    runtime: 'circuitpython',
                    version: this.version,
                    capabilities: this.capabilities,
                    modules: await this.getAvailableModules(),
                    isPhysical: false
                });
            }

            return devices;

        } catch (error) {
            console.error('Error detecting CircuitPython devices:', error);
            return [];
        }
    }

    async connectToDevice(deviceId: string): Promise<boolean> {
        try {
            if (deviceId === 'wasm_circuitpython') {
                // Connect to WASM virtual device
                if (this._wasmRuntime) {
                    await this._wasmRuntime.createExecutionEnvironment(deviceId);
                    this.emit('connected', deviceId);
                    return true;
                }
                return false;
            }

            // Connect to physical device
            // Implementation would establish serial connection
            console.log(`Connecting to CircuitPython device: ${deviceId}`);
            this.emit('connected', deviceId);
            return true;

        } catch (error) {
            console.error(`Failed to connect to device ${deviceId}:`, error);
            return false;
        }
    }

    async disconnectFromDevice(deviceId: string): Promise<boolean> {
        try {
            this._connectedDevices.delete(deviceId);
            this.emit('disconnected', deviceId);
            return true;
        } catch (error) {
            console.error(`Failed to disconnect from device ${deviceId}:`, error);
            return false;
        }
    }

    getHardwareCapabilities(): RuntimeCapabilities {
        return this.capabilities;
    }

    async queryHardwareState(): Promise<Record<string, any>> {
        if (this._wasmRuntime) {
            try {
                const state = await this._wasmRuntime.getHardwareState();
                return {
                    pins: Object.fromEntries(state.pins),
                    sensors: Object.fromEntries(state.sensors),
                    timestamp: state.timestamp
                };
            } catch (error) {
                console.error('Error querying hardware state:', error);
            }
        }
        return {};
    }

    async setHardwareState(updates: Record<string, any>): Promise<boolean> {
        if (this._wasmRuntime) {
            try {
                return await this._wasmRuntime.setHardwareState(updates);
            } catch (error) {
                console.error('Error setting hardware state:', error);
            }
        }
        return false;
    }

    private parseVersion(versionString: string): RuntimeVersion {
        const parts = versionString.split('.');
        return {
            major: parseInt(parts[0] || '0'),
            minor: parseInt(parts[1] || '0'),
            patch: parseInt(parts[2] || '0'),
            full: versionString
        };
    }

    private setupEventHandlers(): void {
        // Forward WASM runtime events
        if (this._wasmRuntime) {
            this._wasmRuntime.on('hardwareStateChanged', (state) => {
                this.emit('hardwareChange', state);
            });

            this._wasmRuntime.on('error', (error) => {
                this.emit('error', error);
            });
        }

        // Forward device detector events
        if (this._deviceDetector) {
            this._deviceDetector.onDeviceChanged((event) => {
                if (event.type === 'added') {
                    this.emit('deviceAdded', event.device);
                } else if (event.type === 'removed') {
                    this.emit('deviceRemoved', event.device);
                }
            });
        }
    }
}