/**
 * WASM Runtime Manager for CircuitPython Virtual Execution
 *
 * Manages CircuitPython WASM runtime as a Node.js child process for
 * hardware-agnostic code execution and simulation. Provides the same
 * interface as physical devices but backed by virtual hardware.
 */

import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { EventEmitter } from 'events';
import { AdafruitBundleManager } from '../runtime/AdafruitBundleManager';

// Import existing interfaces from debugAdapter
import {
    ExecutionEnvironment,
    EnvironmentProfile,
    SimulatedSensor,
    SimulatedGPIO,
    HardwareStateTimeline,
    HardwareEvent
} from '../devices/protocols/debugAdapter';

export interface WasmRuntimeConfig {
    runtimePath?: string;
    memorySize?: number; // in KB
    timeout?: number; // in ms
    enableHardwareSimulation?: boolean;
    debugMode?: boolean;
}

export interface WasmExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    executionTime: number;
    hardwareChanges?: HardwareEvent[];
}

export interface WasmHardwareState {
    pins: Map<number, { value: any; mode: string; lastChanged: number }>;
    sensors: Map<string, { value: any; lastReading: number }>;
    timestamp: number;
}

export interface WasmMessage {
    id: string;
    type: 'execute' | 'query' | 'reset' | 'configure' | 'hardware_query' | 'hardware_set';
    payload: any;
    timestamp: number;
}

export interface WasmResponse {
    id: string;
    success: boolean;
    result?: any;
    error?: string;
    executionTime: number;
    hardwareState?: WasmHardwareState;
}

/**
 * WASM Runtime Manager - Unified virtual hardware backend
 *
 * This replaces multiple simulation approaches with a single WASM-backed
 * execution environment that provides consistent hardware virtualization.
 */
export class WasmRuntimeManager extends EventEmitter implements vscode.Disposable {
    private wasmProcess: ChildProcess | null = null;
    private isInitialized = false;
    private pendingRequests = new Map<string, {
        resolve: (value: WasmResponse) => void;
        reject: (error: Error) => void;
        timeout: NodeJS.Timeout;
    }>();

    private config: Required<WasmRuntimeConfig>;
    private currentEnvironment: ExecutionEnvironment | null = null;
    private hardwareTimeline: HardwareStateTimeline | null = null;
    private outputChannel: vscode.OutputChannel;
    private bundleManager: AdafruitBundleManager;

    // Hardware state cache for sub-250ms sync performance
    private hardwareStateCache = new Map<string, any>();
    private lastHardwareSync = 0;
    private readonly HARDWARE_SYNC_THROTTLE = 50; // 50ms for ultra-responsive sync

    constructor(config: WasmRuntimeConfig = {}, context?: vscode.ExtensionContext) {
        super();

        this.config = {
            runtimePath: config.runtimePath || path.join(__dirname, '../bin/circuitpython.mjs'),
            memorySize: config.memorySize || 512, // 512KB default
            timeout: config.timeout || 30000, // 30s default
            enableHardwareSimulation: config.enableHardwareSimulation ?? true,
            debugMode: config.debugMode ?? false
        };

        this.outputChannel = vscode.window.createOutputChannel('WASM Runtime');
        this.bundleManager = AdafruitBundleManager.getInstance(context);

        if (this.config.debugMode) {
            this.outputChannel.appendLine('WASM Runtime Manager initialized in debug mode');
        }
    }

    /**
     * Initialize the WASM runtime process
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            this.outputChannel.appendLine('Starting CircuitPython WASM runtime...');

            // Launch Node.js process with circuitpython.mjs
            this.wasmProcess = spawn('node', [this.config.runtimePath], {
                stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
                env: {
                    ...process.env,
                    CIRCUITPYTHON_WASM_MEMORY: this.config.memorySize.toString(),
                    CIRCUITPYTHON_WASM_DEBUG: this.config.debugMode.toString()
                }
            });

            if (!this.wasmProcess) {
                throw new Error('Failed to spawn WASM process');
            }

            // Set up IPC communication
            this.setupCommunication();

            // Wait for runtime to be ready
            await this.waitForReady();

            // Initialize bundle manager and sync libraries to WASM
            await this.bundleManager.initialize();
            await this.syncAdafruitLibraries();

            this.isInitialized = true;
            this.outputChannel.appendLine('✓ CircuitPython WASM runtime ready with Adafruit Bundle');

            this.emit('ready');

        } catch (error) {
            this.outputChannel.appendLine(`❌ WASM runtime initialization failed: ${error}`);
            throw error;
        }
    }

    /**
     * Create an execution environment backed by WASM virtual hardware
     */
    async createExecutionEnvironment(
        deviceId: string,
        profile?: EnvironmentProfile
    ): Promise<ExecutionEnvironment> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Use provided profile or create a default one
        const environmentProfile = profile || this.createDefaultProfile(deviceId);

        // Configure WASM runtime with the hardware profile
        await this.configureHardware(environmentProfile);

        const environment: ExecutionEnvironment = {
            type: 'simulated',
            deviceId,
            profile: environmentProfile,
            capabilities: {
                hasFileSystem: true,
                hasRepl: true,
                canExecuteCode: true,
                supportsHardwareAccess: true // WASM provides full hardware simulation
            }
        };

        this.currentEnvironment = environment;
        this.emit('environmentCreated', environment);

        return environment;
    }

    /**
     * Execute CircuitPython code in the WASM runtime with hardware monitoring
     */
    async executeCode(
        code: string,
        options: {
            enableHardwareMonitoring?: boolean;
            timeout?: number;
        } = {}
    ): Promise<WasmExecutionResult> {
        if (!this.isInitialized) {
            throw new Error('WASM runtime not initialized');
        }

        const startTime = Date.now();
        const enableMonitoring = options.enableHardwareMonitoring ?? this.config.enableHardwareSimulation;

        try {
            // Start hardware timeline if monitoring enabled
            if (enableMonitoring) {
                this.hardwareTimeline = new HardwareStateTimeline();
            }

            // Send execution request to WASM runtime
            const response = await this.sendRequest({
                type: 'execute',
                payload: {
                    code,
                    mode: 'repl',
                    enableHardwareMonitoring: enableMonitoring,
                    timeout: options.timeout || this.config.timeout
                }
            });

            const executionResult: WasmExecutionResult = {
                success: response.success,
                output: response.result?.output || '',
                error: response.error,
                executionTime: Date.now() - startTime,
                hardwareChanges: this.hardwareTimeline?.getEvents() || []
            };

            // Update hardware state cache if monitoring was enabled
            if (enableMonitoring && response.hardwareState) {
                this.updateHardwareStateCache(response.hardwareState);
            }

            this.emit('codeExecuted', executionResult);
            return executionResult;

        } catch (error) {
            this.outputChannel.appendLine(`Code execution error: ${error}`);
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - startTime,
                hardwareChanges: []
            };
        }
    }

    /**
     * Query current hardware state from WASM runtime
     */
    async getHardwareState(): Promise<WasmHardwareState> {
        if (!this.isInitialized) {
            throw new Error('WASM runtime not initialized');
        }

        // Check cache for recent state (sub-250ms optimization)
        const now = Date.now();
        if (now - this.lastHardwareSync < this.HARDWARE_SYNC_THROTTLE) {
            const cached = this.hardwareStateCache.get('current');
            if (cached) {
                return cached;
            }
        }

        const response = await this.sendRequest({
            type: 'hardware_query',
            payload: { queryType: 'full_state' }
        });

        if (response.success && response.hardwareState) {
            this.lastHardwareSync = now;
            this.hardwareStateCache.set('current', response.hardwareState);
            return response.hardwareState;
        }

        throw new Error('Failed to query hardware state');
    }

    /**
     * Set hardware state in WASM runtime (GPIO pins, sensor values)
     */
    async setHardwareState(updates: {
        pins?: Array<{ pin: number; value: any; mode?: string }>;
        sensors?: Array<{ id: string; value: any }>;
    }): Promise<boolean> {
        if (!this.isInitialized) {
            throw new Error('WASM runtime not initialized');
        }

        const response = await this.sendRequest({
            type: 'hardware_set',
            payload: updates
        });

        if (response.success && response.hardwareState) {
            this.updateHardwareStateCache(response.hardwareState);
            this.emit('hardwareStateChanged', response.hardwareState);
            return true;
        }

        return false;
    }

    /**
     * Reset the WASM runtime to clean state
     */
    async reset(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        await this.sendRequest({
            type: 'reset',
            payload: {}
        });

        // Clear caches
        this.hardwareStateCache.clear();
        this.lastHardwareSync = 0;
        this.hardwareTimeline?.clear();

        this.emit('reset');
    }

    /**
     * Check if WASM runtime is running and responsive
     */
    async isHealthy(): Promise<boolean> {
        if (!this.isInitialized || !this.wasmProcess) {
            return false;
        }

        try {
            const response = await this.sendRequest({
                type: 'query',
                payload: { queryType: 'health' }
            });
            return response.success;
        } catch {
            return false;
        }
    }

    /**
     * Dispose of WASM runtime process and clean up resources
     */
    dispose(): void {
        if (this.wasmProcess && !this.wasmProcess.killed) {
            this.wasmProcess.kill('SIGTERM');

            // Force kill after 5 seconds if still running
            setTimeout(() => {
                if (this.wasmProcess && !this.wasmProcess.killed) {
                    this.wasmProcess.kill('SIGKILL');
                }
            }, 5000);
        }

        // Clean up pending requests
        for (const [id, request] of this.pendingRequests) {
            clearTimeout(request.timeout);
            request.reject(new Error('WASM runtime disposed'));
        }
        this.pendingRequests.clear();

        // Clear caches
        this.hardwareStateCache.clear();

        this.isInitialized = false;
        this.outputChannel.dispose();

        this.emit('disposed');
        this.removeAllListeners();
    }

    // Private helper methods

    private setupCommunication(): void {
        if (!this.wasmProcess) return;

        // Handle IPC messages from WASM process
        this.wasmProcess.on('message', (message: WasmResponse) => {
            this.handleWasmResponse(message);
        });

        // Handle process events
        this.wasmProcess.on('error', (error) => {
            this.outputChannel.appendLine(`WASM process error: ${error}`);
            this.emit('error', error);
        });

        this.wasmProcess.on('exit', (code, signal) => {
            this.outputChannel.appendLine(`WASM process exited with code ${code}, signal ${signal}`);
            this.isInitialized = false;
            this.emit('exit', { code, signal });
        });

        // Handle stdout/stderr for debugging
        if (this.config.debugMode) {
            this.wasmProcess.stdout?.on('data', (data) => {
                this.outputChannel.appendLine(`WASM stdout: ${data}`);
            });

            this.wasmProcess.stderr?.on('data', (data) => {
                this.outputChannel.appendLine(`WASM stderr: ${data}`);
            });
        }
    }

    private async waitForReady(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('WASM runtime failed to start within timeout'));
            }, 10000); // 10s timeout for startup

            const checkReady = async () => {
                try {
                    await this.sendRequest({
                        type: 'query',
                        payload: { queryType: 'ready' }
                    });
                    clearTimeout(timeout);
                    resolve();
                } catch {
                    // Retry after short delay
                    setTimeout(checkReady, 500);
                }
            };

            // Start checking after initial delay
            setTimeout(checkReady, 1000);
        });
    }

    private async sendRequest(message: Omit<WasmMessage, 'id' | 'timestamp'>): Promise<WasmResponse> {
        if (!this.wasmProcess) {
            throw new Error('WASM process not available');
        }

        const id = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const fullMessage: WasmMessage = {
            id,
            timestamp: Date.now(),
            ...message
        };

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error('Request timeout'));
            }, this.config.timeout);

            this.pendingRequests.set(id, { resolve, reject, timeout });
            this.wasmProcess!.send(fullMessage);
        });
    }

    private handleWasmResponse(response: WasmResponse): void {
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
        }

        // Handle hardware state updates
        if (response.hardwareState) {
            this.updateHardwareStateCache(response.hardwareState);
            this.emit('hardwareStateChanged', response.hardwareState);
        }
    }

    private updateHardwareStateCache(hardwareState: WasmHardwareState): void {
        this.hardwareStateCache.set('current', hardwareState);
        this.lastHardwareSync = Date.now();

        // Add hardware events to timeline if tracking
        if (this.hardwareTimeline) {
            // Compare with previous state and generate events
            // This would be expanded based on your specific hardware event needs
            this.hardwareTimeline.addEvent({
                type: 'communication',
                target: 'wasm_runtime',
                newValue: 'state_updated'
            });
        }
    }

    private async configureHardware(profile: EnvironmentProfile): Promise<void> {
        await this.sendRequest({
            type: 'configure',
            payload: {
                boardProfile: profile.boardConfig,
                sensors: profile.sensors,
                gpios: profile.gpios,
                mockData: profile.mockData
            }
        });
    }

    private createDefaultProfile(deviceId: string): EnvironmentProfile {
        return {
            id: `wasm_${deviceId}`,
            name: 'WASM Virtual Board',
            description: 'CircuitPython WASM runtime with virtual hardware',
            sensors: [
                {
                    type: 'temperature',
                    id: 'temp_sensor',
                    name: 'Temperature Sensor',
                    unit: '°C',
                    range: { min: -40, max: 85 },
                    value: 22.5,
                    lastUpdated: Date.now(),
                    isActive: true
                },
                {
                    type: 'light',
                    id: 'light_sensor',
                    name: 'Light Sensor',
                    unit: 'lux',
                    range: { min: 0, max: 10000 },
                    value: 500,
                    lastUpdated: Date.now(),
                    isActive: true
                }
            ],
            gpios: Array.from({ length: 20 }, (_, i) => ({
                pin: i,
                mode: 'input',
                value: false,
                pullup: false,
                pulldown: false,
                lastChanged: Date.now()
            })),
            boardConfig: {
                boardId: 'wasm_circuitpython',
                displayName: 'WASM CircuitPython Virtual Board',
                pinCount: 20,
                voltage: 3.3,
                features: ['GPIO', 'PWM', 'I2C', 'SPI', 'UART', 'ADC', 'VIRTUAL_SENSORS']
            },
            mockData: {
                enableRealisticData: true,
                updateInterval: 1000,
                variationRange: 0.1
            }
        };
    }

    /**
     * Sync Adafruit Bundle libraries to WASM runtime using circup
     *
     * This ensures WASM has access to the same CircuitPython libraries
     * as physical devices, maintaining consistency across runtimes.
     */
    private async syncAdafruitLibraries(): Promise<void> {
        try {
            this.outputChannel.appendLine('Syncing CircuitPython Bundle to WASM via circup...');

            // Get WASM runtime directory
            const wasmDir = path.dirname(this.config.runtimePath);

            // Sync libraries using the bundle manager
            const success = await this.bundleManager.syncToWasmRuntime(wasmDir);

            if (success) {
                this.outputChannel.appendLine('✓ Adafruit Bundle synced to WASM runtime');
                this.emit('librariesSynced');
            } else {
                this.outputChannel.appendLine('⚠️ Library sync completed with warnings');
            }

        } catch (error) {
            this.outputChannel.appendLine(`❌ Failed to sync libraries: ${error}`);
            // Don't throw - WASM can still function without external libraries
        }
    }
}