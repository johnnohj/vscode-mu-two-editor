/**
 * Python Runtime Factory and Manager
 *
 * Handles detection, creation, and management of different Python runtime
 * implementations (CircuitPython, MicroPython, etc.)
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    IPythonRuntime,
    IRuntimeFactory,
    IRuntimeManager,
    PythonRuntimeType,
    RuntimeCapabilities,
    RuntimeVersion,
    RuntimeConfig
} from './IPythonRuntime';
import { CircuitPythonRuntime } from './CircuitPythonRuntime';
import { MicroPythonRuntime } from './MicroPythonRuntime';

/**
 * Runtime Factory Implementation
 *
 * Creates appropriate runtime instances based on type and configuration
 */
export class RuntimeFactory implements IRuntimeFactory {

    constructor(private context?: vscode.ExtensionContext) {}

    async createRuntime(type: PythonRuntimeType, config?: RuntimeConfig): Promise<IPythonRuntime> {
        console.log(`Creating ${type} runtime...`);

        const runtimeConfig = {
            ...this.getDefaultConfig(type),
            ...config
        };

        switch (type) {
            case 'circuitpython':
                return new CircuitPythonRuntime(runtimeConfig, this.context);

            case 'micropython':
                return new MicroPythonRuntime(runtimeConfig);

            case 'python':
                // Standard Python runtime would be implemented here
                throw new Error('Standard Python runtime not yet implemented');

            default:
                throw new Error(`Unsupported runtime type: ${type}`);
        }
    }

    async detectAvailableRuntimes(): Promise<Array<{
        type: PythonRuntimeType;
        version: RuntimeVersion;
        path: string;
        isAvailable: boolean;
    }>> {
        const runtimes = [];

        // Always available: CircuitPython (flagship with WASM support)
        runtimes.push({
            type: 'circuitpython' as const,
            version: { major: 8, minor: 2, patch: 6, full: '8.2.6' },
            path: 'wasm', // WASM-based, always available
            isAvailable: true
        });

        // Conditionally available: MicroPython (requires detection)
        const microPythonAvailable = await this.detectMicroPython();
        if (microPythonAvailable) {
            runtimes.push({
                type: 'micropython' as const,
                version: { major: 1, minor: 20, patch: 0, full: '1.20.0' },
                path: microPythonAvailable.path,
                isAvailable: true
            });
        }

        // Future: Standard Python detection
        const pythonAvailable = await this.detectStandardPython();
        if (pythonAvailable) {
            runtimes.push({
                type: 'python' as const,
                version: pythonAvailable.version,
                path: pythonAvailable.path,
                isAvailable: true
            });
        }

        return runtimes;
    }

    async validateRuntime(type: PythonRuntimeType, path: string): Promise<boolean> {
        try {
            switch (type) {
                case 'circuitpython':
                    // CircuitPython validation (WASM or device detection)
                    return this.validateCircuitPython(path);

                case 'micropython':
                    // MicroPython validation
                    return this.validateMicroPython(path);

                case 'python':
                    // Standard Python validation
                    return this.validateStandardPython(path);

                default:
                    return false;
            }
        } catch (error) {
            console.error(`Runtime validation failed for ${type} at ${path}:`, error);
            return false;
        }
    }

    getDefaultConfig(type: PythonRuntimeType): RuntimeConfig {
        const baseConfig = {
            enableExtensions: true,
            debugMode: false,
            executionTimeout: 30000
        };

        switch (type) {
            case 'circuitpython':
                return {
                    ...baseConfig,
                    type: 'circuitpython',
                    version: '8.2.6',
                    wasmPath: path.join(__dirname, '../public/bin/wasm-runtime-worker.mjs'),
                    memoryLimit: 512 * 1024 // 512KB for WASM
                };

            case 'micropython':
                return {
                    ...baseConfig,
                    type: 'micropython',
                    version: '1.20.0',
                    memoryLimit: 256 * 1024 // 256KB typical for MicroPython
                };

            case 'python':
                return {
                    ...baseConfig,
                    type: 'python',
                    version: '3.11.0',
                    interpreterPath: 'python3'
                };

            default:
                throw new Error(`No default config for runtime type: ${type}`);
        }
    }

    private async detectMicroPython(): Promise<{ path: string } | null> {
        // Detect MicroPython installations
        // This would check for MicroPython interpreters or connected devices
        try {
            // Check common MicroPython paths
            const commonPaths = [
                '/usr/bin/micropython',
                '/usr/local/bin/micropython',
                'micropython' // In PATH
            ];

            for (const pyPath of commonPaths) {
                if (await this.validateMicroPython(pyPath)) {
                    return { path: pyPath };
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    private async detectStandardPython(): Promise<{ path: string; version: RuntimeVersion } | null> {
        // Detect standard Python installations
        try {
            const commonPaths = ['python3', 'python', 'py'];

            for (const pyPath of commonPaths) {
                if (await this.validateStandardPython(pyPath)) {
                    // Get Python version
                    const version = await this.getPythonVersion(pyPath);
                    if (version) {
                        return { path: pyPath, version };
                    }
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    private async validateCircuitPython(path: string): Promise<boolean> {
        // CircuitPython is always available via WASM
        if (path === 'wasm') {
            return true;
        }

        // For physical devices, check if CircuitPython is running
        // This would involve device detection and REPL communication
        return false;
    }

    private async validateMicroPython(path: string): Promise<boolean> {
        // Validate MicroPython interpreter or device
        try {
            // This would execute a simple command to verify MicroPython
            return false; // Placeholder
        } catch {
            return false;
        }
    }

    private async validateStandardPython(path: string): Promise<boolean> {
        // Validate standard Python interpreter
        try {
            // This would execute `python --version` and check output
            return false; // Placeholder
        } catch {
            return false;
        }
    }

    private async getPythonVersion(pythonPath: string): Promise<RuntimeVersion | null> {
        // Get Python version information
        try {
            // Execute `python --version` and parse output
            return null; // Placeholder
        } catch {
            return null;
        }
    }
}

/**
 * Runtime Manager Implementation
 *
 * Manages multiple runtime instances and provides runtime selection logic
 */
export class RuntimeManager extends EventEmitter implements IRuntimeManager {
    private runtimes = new Map<PythonRuntimeType, IPythonRuntime>();
    private factory: IRuntimeFactory;
    private defaultRuntimeType: PythonRuntimeType = 'circuitpython'; // CircuitPython as flagship
    private deviceRuntimeMap = new Map<string, PythonRuntimeType>();
    private _isInitialized = false;

    constructor(factory?: IRuntimeFactory, context?: vscode.ExtensionContext) {
        super();
        this.factory = factory || new RuntimeFactory(context);
    }

    async initialize(): Promise<void> {
        if (this._isInitialized) {
            return;
        }

        console.log('Initializing Runtime Manager...');

        try {
            // Detect available runtimes
            const availableRuntimes = await this.factory.detectAvailableRuntimes();
            console.log('Available runtimes:', availableRuntimes.map(r => `${r.type} v${r.version.full}`));

            // Initialize CircuitPython as flagship runtime (always available)
            await this.initializeCircuitPython();

            // Initialize other available runtimes
            for (const runtime of availableRuntimes) {
                if (runtime.type !== 'circuitpython' && runtime.isAvailable) {
                    await this.initializeRuntime(runtime.type);
                }
            }

            this._isInitialized = true;
            console.log('✓ Runtime Manager initialized');

        } catch (error) {
            console.error('Runtime Manager initialization failed:', error);
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this._isInitialized) {
            return;
        }

        console.log('Disposing Runtime Manager...');

        // Dispose all runtimes
        for (const [type, runtime] of this.runtimes) {
            try {
                await runtime.dispose();
                console.log(`✓ ${type} runtime disposed`);
            } catch (error) {
                console.error(`Error disposing ${type} runtime:`, error);
            }
        }

        this.runtimes.clear();
        this.deviceRuntimeMap.clear();
        this.removeAllListeners();
        this._isInitialized = false;

        console.log('✓ Runtime Manager disposed');
    }

    registerRuntime(runtime: IPythonRuntime): void {
        this.runtimes.set(runtime.type, runtime);
        this.emit('runtimeAdded', runtime.type);
        console.log(`Runtime registered: ${runtime.type}`);
    }

    unregisterRuntime(type: PythonRuntimeType): void {
        const runtime = this.runtimes.get(type);
        if (runtime) {
            runtime.dispose();
            this.runtimes.delete(type);
            this.emit('runtimeRemoved', type);
            console.log(`Runtime unregistered: ${type}`);
        }
    }

    getRuntime(type: PythonRuntimeType): IPythonRuntime | null {
        return this.runtimes.get(type) || null;
    }

    getAvailableRuntimes(): PythonRuntimeType[] {
        return Array.from(this.runtimes.keys());
    }

    setDefaultRuntime(type: PythonRuntimeType): void {
        if (this.runtimes.has(type)) {
            const oldDefault = this.defaultRuntimeType;
            this.defaultRuntimeType = type;
            this.emit('defaultChanged', { old: oldDefault, new: type });
            console.log(`Default runtime changed to: ${type}`);
        } else {
            throw new Error(`Runtime not available: ${type}`);
        }
    }

    getDefaultRuntime(): IPythonRuntime | null {
        return this.getRuntime(this.defaultRuntimeType);
    }

    selectBestRuntime(requirements?: {
        capabilities?: Partial<RuntimeCapabilities>;
        version?: string;
        deviceType?: string;
    }): IPythonRuntime | null {

        if (!requirements) {
            // Return default runtime (CircuitPython)
            return this.getDefaultRuntime();
        }

        // Score runtimes based on requirements
        let bestRuntime: IPythonRuntime | null = null;
        let bestScore = 0;

        for (const runtime of this.runtimes.values()) {
            let score = 0;

            // Score based on capabilities
            if (requirements.capabilities) {
                score += this.scoreCapabilities(runtime.capabilities, requirements.capabilities);
            }

            // Score based on device type compatibility
            if (requirements.deviceType) {
                score += this.scoreDeviceCompatibility(runtime.type, requirements.deviceType);
            }

            // Bias towards CircuitPython as flagship runtime
            if (runtime.type === 'circuitpython') {
                score += 10; // Flagship bonus
            }

            if (score > bestScore) {
                bestScore = score;
                bestRuntime = runtime;
            }
        }

        return bestRuntime || this.getDefaultRuntime();
    }

    async switchRuntime(fromType: PythonRuntimeType, toType: PythonRuntimeType): Promise<boolean> {
        try {
            const fromRuntime = this.getRuntime(fromType);
            const toRuntime = this.getRuntime(toType);

            if (!fromRuntime || !toRuntime) {
                return false;
            }

            // Perform runtime switch logic here
            console.log(`Switching runtime from ${fromType} to ${toType}`);

            this.emit('switched', { from: fromType, to: toType });
            return true;

        } catch (error) {
            console.error(`Failed to switch runtime from ${fromType} to ${toType}:`, error);
            return false;
        }
    }

    async pairDeviceWithRuntime(deviceId: string, runtimeType: PythonRuntimeType): Promise<boolean> {
        const runtime = this.getRuntime(runtimeType);
        if (!runtime) {
            return false;
        }

        try {
            await runtime.connectToDevice(deviceId);
            this.deviceRuntimeMap.set(deviceId, runtimeType);
            console.log(`Device ${deviceId} paired with ${runtimeType} runtime`);
            return true;

        } catch (error) {
            console.error(`Failed to pair device ${deviceId} with ${runtimeType}:`, error);
            return false;
        }
    }

    getDeviceRuntime(deviceId: string): IPythonRuntime | null {
        const runtimeType = this.deviceRuntimeMap.get(deviceId);
        return runtimeType ? this.getRuntime(runtimeType) : null;
    }

    private async initializeCircuitPython(): Promise<void> {
        try {
            const runtime = await this.factory.createRuntime('circuitpython');
            await runtime.initialize();
            this.registerRuntime(runtime);
            console.log('✓ CircuitPython runtime (flagship) initialized');
        } catch (error) {
            console.error('Failed to initialize CircuitPython runtime:', error);
            throw error;
        }
    }

    private async initializeRuntime(type: PythonRuntimeType): Promise<void> {
        try {
            const runtime = await this.factory.createRuntime(type);
            await runtime.initialize();
            this.registerRuntime(runtime);
            console.log(`✓ ${type} runtime initialized`);
        } catch (error) {
            console.error(`Failed to initialize ${type} runtime:`, error);
            // Don't throw - continue with other runtimes
        }
    }

    private scoreCapabilities(
        runtimeCaps: RuntimeCapabilities,
        requiredCaps: Partial<RuntimeCapabilities>
    ): number {
        let score = 0;

        for (const [key, required] of Object.entries(requiredCaps)) {
            if (required && runtimeCaps[key as keyof RuntimeCapabilities]) {
                score += 1;
            }
        }

        return score;
    }

    private scoreDeviceCompatibility(runtimeType: PythonRuntimeType, deviceType: string): number {
        // Score runtime compatibility with device types
        const compatibilityMap: Record<PythonRuntimeType, string[]> = {
            'circuitpython': ['adafruit', 'circuitpython', 'feather', 'metro', 'trinket', 'gemma'],
            'micropython': ['esp32', 'esp8266', 'pico', 'pyboard', 'wipy'],
            'python': ['pc', 'raspberry_pi', 'linux', 'windows', 'macos']
        };

        const compatibleDevices = compatibilityMap[runtimeType] || [];
        const deviceTypeLower = deviceType.toLowerCase();

        return compatibleDevices.some(compat => deviceTypeLower.includes(compat)) ? 5 : 0;
    }
}