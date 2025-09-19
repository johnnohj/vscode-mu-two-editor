/**
 * MicroPython Runtime Implementation
 *
 * Provides MicroPython support for Mu Two Editor, complementing
 * CircuitPython with broader device compatibility and different
 * hardware ecosystem support.
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

/**
 * MicroPython Runtime Implementation
 *
 * Supports ESP32, ESP8266, Raspberry Pi Pico, and other MicroPython-compatible devices.
 * Focuses on broader hardware ecosystem support with different capabilities than CircuitPython.
 */
export class MicroPythonRuntime extends EventEmitter implements IPythonRuntime {
    readonly type: PythonRuntimeType = 'micropython';
    readonly version: RuntimeVersion;
    readonly capabilities: RuntimeCapabilities;

    private _isInitialized = false;
    private _config: RuntimeConfig;
    private _connectedDevices = new Map<string, any>();
    private _replSession?: any;

    constructor(config?: RuntimeConfig) {
        super();

        this._config = {
            type: 'micropython',
            version: '1.20.0', // Default MicroPython version
            enableExtensions: true,
            debugMode: false,
            executionTimeout: 30000,
            ...config
        };

        // MicroPython version information
        this.version = this.parseVersion(this._config.version || '1.20.0');

        // MicroPython capabilities (different focus than CircuitPython)
        this.capabilities = {
            // Hardware access - good but different from CircuitPython
            hasGPIO: true,
            hasSPI: true,
            hasI2C: true,
            hasUART: true,
            hasPWM: true,
            hasADC: true,

            // Built-in features - varies by board
            hasBuiltinSensors: false, // Less built-in sensor support
            hasWiFi: true, // Strong WiFi support especially on ESP32
            hasBluetooth: true, // Good Bluetooth support
            hasUSB: false, // Limited USB support compared to CircuitPython
            hasFileSystem: true,

            // Language features - closer to standard Python
            hasAsyncAwait: true,
            hasTypeHints: false, // Limited type hints
            hasF_strings: true,
            hasDataclasses: false, // Not supported

            // Development features
            hasREPL: true,
            hasDebugging: false, // Limited debugging
            hasProfiler: false,
            hasMemoryIntrospection: true,

            // Simulation capabilities - limited compared to CircuitPython
            supportsVirtualHardware: false, // No built-in simulation
            supportsWASMExecution: false // No WASM runtime yet
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
            console.log('Initializing MicroPython runtime...');

            if (config) {
                this._config = { ...this._config, ...config };
            }

            // Initialize device detection for MicroPython devices
            await this.initializeDeviceDetection();

            this._isInitialized = true;
            this.emit('initialized');

            console.log('✓ MicroPython runtime initialization complete');

        } catch (error) {
            console.error('MicroPython runtime initialization failed:', error);
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this._isInitialized) {
            return;
        }

        console.log('Disposing MicroPython runtime...');

        // Disconnect from all devices
        for (const deviceId of this._connectedDevices.keys()) {
            await this.disconnectFromDevice(deviceId);
        }

        // Stop REPL
        if (this._replSession) {
            await this.stopREPL();
        }

        this._isInitialized = false;
        this.removeAllListeners();
        this.emit('disposed');

        console.log('✓ MicroPython runtime disposed');
    }

    async reset(): Promise<void> {
        // Reset connected devices
        for (const device of this._connectedDevices.values()) {
            console.log(`Resetting MicroPython device: ${device.name}`);
            // Send reset command to device
        }
    }

    async isHealthy(): Promise<boolean> {
        return this._isInitialized;
    }

    async getStatus(): Promise<{
        initialized: boolean;
        connected: boolean;
        memoryUsage?: { used: number; free: number; total: number };
        uptime: number;
    }> {
        return {
            initialized: this._isInitialized,
            connected: this._connectedDevices.size > 0,
            uptime: process.uptime() * 1000
        };
    }

    async executeCode(
        code: string,
        context?: RuntimeExecutionContext
    ): Promise<RuntimeExecutionResult> {
        if (!this._isInitialized) {
            throw new Error('MicroPython runtime not initialized');
        }

        const ctx = {
            mode: 'repl' as const,
            timeout: this._config.executionTimeout,
            enableHardwareAccess: true,
            ...context
        };

        const startTime = Date.now();

        try {
            // Execute code on connected MicroPython device
            // This would involve sending code via serial REPL

            // For now, simulate execution
            const output = this.simulateMicroPythonExecution(code);

            return {
                success: true,
                output,
                executionTime: Date.now() - startTime,
                hardwareChanges: this.detectHardwareChanges(code)
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
            this._replSession = {
                id: `micropython_repl_${Date.now()}`,
                started: Date.now()
            };

            console.log('MicroPython REPL started');
            return true;

        } catch (error) {
            console.error('Failed to start MicroPython REPL:', error);
            return false;
        }
    }

    async stopREPL(): Promise<boolean> {
        if (!this._replSession) {
            return true;
        }

        try {
            this._replSession = undefined;
            console.log('MicroPython REPL stopped');
            return true;

        } catch (error) {
            console.error('Failed to stop MicroPython REPL:', error);
            return false;
        }
    }

    async sendREPLCommand(command: string): Promise<string> {
        if (!this._replSession) {
            throw new Error('REPL not started');
        }

        const result = await this.executeCode(command, { mode: 'repl' });
        return result.output;
    }

    async getAvailableModules(): Promise<RuntimeModule[]> {
        // MicroPython built-in modules
        const builtinModules: RuntimeModule[] = [
            {
                name: 'machine',
                description: 'Hardware abstraction layer',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Low-level hardware control (pins, timers, etc.)',
                examples: [{
                    title: 'GPIO control',
                    code: 'from machine import Pin\nled = Pin(2, Pin.OUT)\nled.on()',
                    description: 'Control GPIO pin'
                }]
            },
            {
                name: 'network',
                description: 'Network configuration',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'WiFi and network management'
            },
            {
                name: 'time',
                description: 'Time functions',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Sleep and timing functions'
            },
            {
                name: 'ubluetooth',
                description: 'Bluetooth Low Energy',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'BLE functionality'
            },
            {
                name: 'ujson',
                description: 'JSON encoding/decoding',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Lightweight JSON support'
            },
            {
                name: 'urequests',
                description: 'HTTP client',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'HTTP requests library'
            },
            {
                name: 'socket',
                description: 'Network sockets',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'TCP/UDP socket communication'
            },
            {
                name: 'gc',
                description: 'Garbage collection',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Memory management'
            }
        ];

        return builtinModules;
    }

    async getInstalledModules(): Promise<RuntimeModule[]> {
        // MicroPython modules can be installed via upip or manually
        return this.getAvailableModules();
    }

    async installModule(moduleName: string): Promise<boolean> {
        console.log(`Installing MicroPython module: ${moduleName}`);
        // MicroPython module installation via upip
        const availableModules = await this.getAvailableModules();
        return availableModules.some(m => m.name === moduleName);
    }

    async getModuleDocumentation(moduleName: string): Promise<string | null> {
        const modules = await this.getAvailableModules();
        const module = modules.find(m => m.name === moduleName);
        return module?.documentation || null;
    }

    async getConnectedDevices(): Promise<RuntimeDevice[]> {
        // Detect MicroPython devices (ESP32, ESP8266, Pico, etc.)
        const devices: RuntimeDevice[] = [];

        // This would scan for devices with MicroPython firmware
        // Different from CircuitPython device detection
        const detectedDevices = await this.detectMicroPythonDevices();

        for (const device of detectedDevices) {
            devices.push({
                id: device.id,
                name: device.name,
                runtime: 'micropython',
                version: this.version,
                capabilities: this.capabilities,
                modules: await this.getAvailableModules(),
                isPhysical: true,
                connectionInfo: device.connectionInfo
            });
        }

        return devices;
    }

    async connectToDevice(deviceId: string): Promise<boolean> {
        try {
            console.log(`Connecting to MicroPython device: ${deviceId}`);
            // Establish serial connection and detect MicroPython
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

    // MicroPython doesn't have built-in hardware simulation like CircuitPython WASM
    async queryHardwareState(): Promise<Record<string, any>> {
        // Would query actual device state via REPL commands
        return {};
    }

    async setHardwareState(updates: Record<string, any>): Promise<boolean> {
        // Would send hardware control commands to device
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

    private async initializeDeviceDetection(): Promise<void> {
        // Initialize MicroPython-specific device detection
        // Different from CircuitPython detection patterns
        console.log('Initializing MicroPython device detection...');
    }

    private async detectMicroPythonDevices(): Promise<Array<{
        id: string;
        name: string;
        connectionInfo: any;
    }>> {
        // Detect devices running MicroPython firmware
        // ESP32, ESP8266, Raspberry Pi Pico, etc.
        return [
            {
                id: 'esp32_micropython',
                name: 'ESP32 MicroPython Device',
                connectionInfo: {
                    port: '/dev/ttyUSB0',
                    baudRate: 115200,
                    protocol: 'serial'
                }
            }
        ];
    }

    private simulateMicroPythonExecution(code: string): string {
        // Simulate MicroPython execution for development
        if (code.includes('machine.Pin')) {
            return 'Pin configured successfully';
        }
        if (code.includes('network.WLAN')) {
            return 'WiFi interface created';
        }
        if (code.includes('time.sleep')) {
            return 'Sleep completed';
        }
        return `MicroPython executed: ${code.substring(0, 30)}...`;
    }

    private detectHardwareChanges(code: string): Array<{
        type: 'pin' | 'sensor' | 'actuator';
        target: string | number;
        oldValue: any;
        newValue: any;
        timestamp: number;
    }> {
        const changes = [];
        const timestamp = Date.now();

        // Simple pattern detection for hardware changes
        if (code.includes('Pin(') && code.includes('.on()')) {
            changes.push({
                type: 'pin' as const,
                target: 'GPIO',
                oldValue: false,
                newValue: true,
                timestamp
            });
        }

        return changes;
    }
}