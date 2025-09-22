/**
 * Unified Runtime Coordinator
 *
 * Centralizes runtime management, coordination, and resource sharing across
 * the Mu Two Editor extension. Addresses the Runtime Coordination issues
 * identified in architectural analysis (6/10 score).
 *
 * Key Benefits:
 * - Single source of truth for runtime state
 * - Shared WASM runtime instances
 * - Intelligent runtime selection policies
 * - Coordinated device-runtime binding
 * - Centralized resource management
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import {
    IPythonRuntime,
    PythonRuntimeType,
    RuntimeCapabilities,
    RuntimeConfig,
    RuntimeVersion
} from '../runtime/IPythonRuntime';
import { IDevice } from '../devices/core/deviceDetector';
import { WasmRuntimeManager } from './wasmRuntimeManager';
import { RuntimeFactory } from '../runtime/RuntimeFactory';
import { RuntimeSelectionPolicy, SelectionContext, RuntimeScore } from './runtimeSelectionPolicy';
import { HardwareAbstractionRegistry } from './hardwareAbstractionRegistry';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Runtime preferences for intelligent selection
 */
export interface RuntimePreferences {
    preferredType?: PythonRuntimeType;
    requiredCapabilities?: Partial<RuntimeCapabilities>;
    deviceCompatibility?: string[];
    performanceProfile?: 'speed' | 'memory' | 'compatibility';
    fallbackStrategy?: 'auto' | 'none' | 'prompt';
}

/**
 * Runtime coordination events
 */
export interface RuntimeCoordinatorEvents {
    'runtimeRegistered': [PythonRuntimeType, IPythonRuntime];
    'runtimeUnregistered': [PythonRuntimeType];
    'runtimeSwitched': [string, PythonRuntimeType, PythonRuntimeType]; // deviceId, from, to
    'deviceBound': [string, PythonRuntimeType]; // deviceId, runtimeType
    'deviceUnbound': [string]; // deviceId
    'healthWarning': [PythonRuntimeType, string]; // runtimeType, issue
    'resourceOptimized': [string]; // optimization performed
}

/**
 * Device-runtime binding information
 */
interface DeviceRuntimeBinding {
    deviceId: string;
    runtimeType: PythonRuntimeType;
    runtime: IPythonRuntime;
    bindingTime: number;
    preferences?: RuntimePreferences;
}

/**
 * Runtime health metrics
 */
interface RuntimeHealthMetrics {
    type: PythonRuntimeType;
    isResponsive: boolean;
    memoryUsage: number;
    executionLatency: number;
    errorCount: number;
    lastHealthCheck: number;
}

/**
 * Unified Runtime Coordinator Implementation
 *
 * Phase 1 implementation as specified in MU-TODO.md Runtime Coordination section
 */
export class MuTwoRuntimeCoordinator extends EventEmitter {
    private static instance: MuTwoRuntimeCoordinator;

    // Central runtime registry - single source of truth
    private runtimeRegistry = new Map<PythonRuntimeType, IPythonRuntime>();

    // Device-runtime bindings
    private deviceRuntimeBindings = new Map<string, DeviceRuntimeBinding>();

    // Shared WASM runtime instance - eliminates duplication
    private sharedWasmRuntime: WasmRuntimeManager | null = null;

    // Runtime selection policies
    private defaultRuntimeType: PythonRuntimeType = 'circuitpython';
    private globalPreferences: RuntimePreferences = {
        performanceProfile: 'compatibility',
        fallbackStrategy: 'auto'
    };

    // Health monitoring
    private healthMetrics = new Map<PythonRuntimeType, RuntimeHealthMetrics>();
    private healthCheckInterval: NodeJS.Timeout | null = null;

    // Dependencies
    private runtimeFactory: RuntimeFactory;
    private runtimeSelectionPolicy: RuntimeSelectionPolicy;
    private hardwareRegistry: HardwareAbstractionRegistry;
    private isInitialized = false;

    constructor(
        private context: vscode.ExtensionContext,
        factory?: RuntimeFactory
    ) {
        super();
        this.runtimeFactory = factory || new RuntimeFactory(context);
        this.runtimeSelectionPolicy = new RuntimeSelectionPolicy();
        this.hardwareRegistry = HardwareAbstractionRegistry.getInstance();

        logger.info('EXECUTION', 'MuTwoRuntimeCoordinator created - centralizing runtime management with Phase 2 components');
    }

    /**
     * Singleton pattern for extension-wide coordination
     */
    static getInstance(
        context: vscode.ExtensionContext,
        factory?: RuntimeFactory
    ): MuTwoRuntimeCoordinator {
        if (!MuTwoRuntimeCoordinator.instance) {
            MuTwoRuntimeCoordinator.instance = new MuTwoRuntimeCoordinator(context, factory);
        }
        return MuTwoRuntimeCoordinator.instance;
    }

    /**
     * Initialize the runtime coordinator
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            logger.debug('EXECUTION', 'Runtime coordinator already initialized');
            return;
        }

        logger.info('EXECUTION', 'Initializing Unified Runtime Coordinator...');

        try {
            // Initialize flagship CircuitPython runtime first
            await this.initializeCircuitPythonRuntime();

            // Detect and initialize other available runtimes
            await this.initializeAvailableRuntimes();

            // Initialize shared WASM runtime
            await this.initializeSharedWasmRuntime();

            // Start health monitoring
            this.startHealthMonitoring();

            this.isInitialized = true;
            logger.info('EXECUTION', `✓ Runtime coordinator initialized with ${this.runtimeRegistry.size} runtimes`);

        } catch (error) {
            logger.error('EXECUTION', `Failed to initialize runtime coordinator: ${error}`);
            throw error;
        }
    }

    /**
     * Dispose the coordinator and all managed resources
     */
    async dispose(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        logger.info('EXECUTION', 'Disposing Unified Runtime Coordinator...');

        // Stop health monitoring
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }

        // Dispose all registered runtimes
        for (const [type, runtime] of this.runtimeRegistry) {
            try {
                await runtime.dispose();
                logger.debug('EXECUTION', `✓ Disposed ${type} runtime`);
            } catch (error) {
                logger.warn('EXECUTION', `Error disposing ${type} runtime: ${error}`);
            }
        }

        // Dispose shared WASM runtime
        if (this.sharedWasmRuntime) {
            try {
                await this.sharedWasmRuntime.dispose();
                logger.debug('EXECUTION', '✓ Disposed shared WASM runtime');
            } catch (error) {
                logger.warn('EXECUTION', `Error disposing shared WASM runtime: ${error}`);
            }
        }

        // Clear all state
        this.runtimeRegistry.clear();
        this.deviceRuntimeBindings.clear();
        this.healthMetrics.clear();
        this.removeAllListeners();

        this.isInitialized = false;
        logger.info('EXECUTION', '✓ Runtime coordinator disposed');
    }

    // ========================= Core Registry Methods =========================

    /**
     * Register a runtime instance in the central registry
     */
    async registerRuntime(runtime: IPythonRuntime): Promise<void> {
        logger.info('EXECUTION', `Registering ${runtime.type} runtime in coordinator`);

        if (this.runtimeRegistry.has(runtime.type)) {
            logger.warn('EXECUTION', `Runtime ${runtime.type} already registered, replacing`);
            const existingRuntime = this.runtimeRegistry.get(runtime.type);
            if (existingRuntime) {
                await existingRuntime.dispose();
            }
        }

        this.runtimeRegistry.set(runtime.type, runtime);

        // Initialize health metrics
        this.healthMetrics.set(runtime.type, {
            type: runtime.type,
            isResponsive: true,
            memoryUsage: 0,
            executionLatency: 0,
            errorCount: 0,
            lastHealthCheck: Date.now()
        });

        this.emit('runtimeRegistered', runtime.type, runtime);
        logger.info('EXECUTION', `✓ ${runtime.type} runtime registered successfully`);
    }

    /**
     * Unregister a runtime from the central registry
     */
    async unregisterRuntime(type: PythonRuntimeType): Promise<void> {
        logger.info('EXECUTION', `Unregistering ${type} runtime from coordinator`);

        const runtime = this.runtimeRegistry.get(type);
        if (!runtime) {
            logger.warn('EXECUTION', `Runtime ${type} not found for unregistration`);
            return;
        }

        // Unbind all devices using this runtime
        const boundDevices = Array.from(this.deviceRuntimeBindings.entries())
            .filter(([_, binding]) => binding.runtimeType === type)
            .map(([deviceId]) => deviceId);

        for (const deviceId of boundDevices) {
            await this.unbindDeviceFromRuntime(deviceId);
        }

        // Dispose the runtime
        try {
            await runtime.dispose();
        } catch (error) {
            logger.warn('EXECUTION', `Error disposing ${type} runtime: ${error}`);
        }

        // Remove from registry and metrics
        this.runtimeRegistry.delete(type);
        this.healthMetrics.delete(type);

        this.emit('runtimeUnregistered', type);
        logger.info('EXECUTION', `✓ ${type} runtime unregistered successfully`);
    }

    /**
     * Get all active runtimes in the registry
     */
    getActiveRuntimes(): Map<PythonRuntimeType, IPythonRuntime> {
        return new Map(this.runtimeRegistry);
    }

    /**
     * Get a specific runtime by type
     */
    getRuntime(type: PythonRuntimeType): IPythonRuntime | null {
        return this.runtimeRegistry.get(type) || null;
    }

    // ========================= Intelligent Runtime Selection =========================

    /**
     * Select the best runtime for a device based on preferences and capabilities
     */
    async selectBestRuntime(
        device: IDevice,
        preferences?: RuntimePreferences
    ): Promise<IPythonRuntime> {
        logger.debug('EXECUTION', `Selecting best runtime for device ${device.id || 'unknown'}`);

        // Create selection context for the policy
        const selectionContext: SelectionContext = {
            device,
            userPreferences: preferences ? {
                primaryStrategy: 'auto',
                fallbackStrategy: 'flagship',
                preferredRuntimeType: preferences.preferredType,
                requiredCapabilities: preferences.requiredCapabilities,
                deviceCompatibilityWeight: 1.0,
                performanceWeight: preferences.performanceProfile === 'speed' ? 1.2 : 0.8,
                memoryWeight: preferences.performanceProfile === 'memory' ? 1.2 : 0.6,
                flagshipBonus: 5
            } : undefined,
            availableRuntimes: this.runtimeRegistry
        };

        try {
            // Use the runtime selection policy for intelligent selection
            const runtimeScore = await this.runtimeSelectionPolicy.selectBestRuntime(selectionContext);

            if (runtimeScore.totalScore === 0) {
                throw new Error('No suitable runtime found by selection policy');
            }

            logger.info('EXECUTION', `Selected runtime: ${runtimeScore.runtime.type} (score: ${runtimeScore.totalScore.toFixed(2)})`);
            logger.debug('EXECUTION', `Selection reasoning: ${runtimeScore.reasoning.join(', ')}`);

            return runtimeScore.runtime;

        } catch (error) {
            logger.error('EXECUTION', `Runtime selection failed: ${error}`);

            // Fallback to default runtime (CircuitPython)
            const fallbackRuntime = this.runtimeRegistry.get(this.defaultRuntimeType) ||
                                  Array.from(this.runtimeRegistry.values())[0] || null;

            if (!fallbackRuntime) {
                throw new Error('No suitable runtime available for device and no fallback available');
            }

            logger.warn('EXECUTION', `Using fallback runtime: ${fallbackRuntime.type}`);
            return fallbackRuntime;
        }
    }

    // ========================= Device-Runtime Binding =========================

    /**
     * Bind a device to a specific runtime
     */
    async bindDeviceToRuntime(
        deviceId: string,
        runtime: IPythonRuntime,
        preferences?: RuntimePreferences
    ): Promise<void> {
        logger.info('EXECUTION', `Binding device ${deviceId} to ${runtime.type} runtime`);

        // Unbind any existing binding
        if (this.deviceRuntimeBindings.has(deviceId)) {
            await this.unbindDeviceFromRuntime(deviceId);
        }

        // Create new binding
        const binding: DeviceRuntimeBinding = {
            deviceId,
            runtimeType: runtime.type,
            runtime,
            bindingTime: Date.now(),
            preferences
        };

        this.deviceRuntimeBindings.set(deviceId, binding);

        this.emit('deviceBound', deviceId, runtime.type);
        logger.info('EXECUTION', `✓ Device ${deviceId} bound to ${runtime.type} runtime`);
    }

    /**
     * Switch a device to a different runtime
     */
    async switchDeviceRuntime(deviceId: string, newType: PythonRuntimeType): Promise<boolean> {
        logger.info('EXECUTION', `Switching device ${deviceId} to ${newType} runtime`);

        const currentBinding = this.deviceRuntimeBindings.get(deviceId);
        if (currentBinding?.runtimeType === newType) {
            logger.debug('EXECUTION', `Device ${deviceId} already using ${newType} runtime`);
            return true;
        }

        const newRuntime = this.runtimeRegistry.get(newType);
        if (!newRuntime) {
            logger.error('EXECUTION', `Runtime ${newType} not available for device switch`);
            return false;
        }

        try {
            const oldType = currentBinding?.runtimeType;

            // Perform the switch
            await this.bindDeviceToRuntime(deviceId, newRuntime, currentBinding?.preferences);

            this.emit('runtimeSwitched', deviceId, oldType || 'none', newType);
            logger.info('EXECUTION', `✓ Device ${deviceId} switched from ${oldType} to ${newType}`);
            return true;

        } catch (error) {
            logger.error('EXECUTION', `Failed to switch device ${deviceId} to ${newType}: ${error}`);
            return false;
        }
    }

    /**
     * Get the runtime bound to a specific device
     */
    getDeviceRuntime(deviceId: string): IPythonRuntime | null {
        const binding = this.deviceRuntimeBindings.get(deviceId);
        return binding?.runtime || null;
    }

    /**
     * Unbind a device from its current runtime
     */
    private async unbindDeviceFromRuntime(deviceId: string): Promise<void> {
        const binding = this.deviceRuntimeBindings.get(deviceId);
        if (!binding) {
            return;
        }

        this.deviceRuntimeBindings.delete(deviceId);
        this.emit('deviceUnbound', deviceId);
        logger.debug('EXECUTION', `Device ${deviceId} unbound from ${binding.runtimeType} runtime`);
    }

    // ========================= Shared WASM Runtime Management =========================

    /**
     * Get the shared WASM runtime instance - eliminates duplication
     */
    async getSharedWasmRuntime(): Promise<WasmRuntimeManager> {
        if (!this.sharedWasmRuntime) {
            await this.initializeSharedWasmRuntime();
        }

        if (!this.sharedWasmRuntime) {
            throw new Error('Failed to initialize shared WASM runtime');
        }

        return this.sharedWasmRuntime;
    }

    /**
     * Get the hardware abstraction registry for shared hardware state
     */
    getHardwareRegistry(): HardwareAbstractionRegistry {
        return this.hardwareRegistry;
    }

    /**
     * Get the runtime selection policy for configuration
     */
    getRuntimeSelectionPolicy(): RuntimeSelectionPolicy {
        return this.runtimeSelectionPolicy;
    }

    // ========================= Health Monitoring =========================

    /**
     * Monitor runtime health and performance
     */
    monitorRuntimeHealth(): void {
        logger.debug('EXECUTION', 'Performing runtime health check...');

        for (const [type, runtime] of this.runtimeRegistry) {
            this.checkRuntimeHealth(type, runtime);
        }
    }

    // ========================= Private Implementation Methods =========================

    private async initializeCircuitPythonRuntime(): Promise<void> {
        logger.info('EXECUTION', 'Initializing flagship CircuitPython runtime...');

        try {
            const circuitPythonRuntime = await this.runtimeFactory.createRuntime('circuitpython');
            await circuitPythonRuntime.initialize();
            await this.registerRuntime(circuitPythonRuntime);

            logger.info('EXECUTION', '✓ CircuitPython flagship runtime initialized');
        } catch (error) {
            logger.error('EXECUTION', `Failed to initialize CircuitPython runtime: ${error}`);
            throw error;
        }
    }

    private async initializeAvailableRuntimes(): Promise<void> {
        logger.info('EXECUTION', 'Detecting and initializing available runtimes...');

        try {
            const availableRuntimes = await this.runtimeFactory.detectAvailableRuntimes();

            for (const runtimeInfo of availableRuntimes) {
                if (runtimeInfo.type !== 'circuitpython' && runtimeInfo.isAvailable) {
                    try {
                        const runtime = await this.runtimeFactory.createRuntime(runtimeInfo.type);
                        await runtime.initialize();
                        await this.registerRuntime(runtime);

                        logger.info('EXECUTION', `✓ ${runtimeInfo.type} runtime initialized`);
                    } catch (error) {
                        logger.warn('EXECUTION', `Failed to initialize ${runtimeInfo.type} runtime: ${error}`);
                    }
                }
            }
        } catch (error) {
            logger.warn('EXECUTION', `Error during runtime detection: ${error}`);
        }
    }

    private async initializeSharedWasmRuntime(): Promise<void> {
        logger.info('EXECUTION', 'Initializing shared WASM runtime instance...');

        try {
            this.sharedWasmRuntime = new WasmRuntimeManager({}, this.context);
            await this.sharedWasmRuntime.initialize();

            logger.info('EXECUTION', '✓ Shared WASM runtime initialized - eliminating duplication');
        } catch (error) {
            logger.warn('EXECUTION', `Failed to initialize shared WASM runtime: ${error}`);
        }
    }

    private startHealthMonitoring(): void {
        logger.debug('EXECUTION', 'Starting runtime health monitoring...');

        // Perform health checks every 30 seconds
        this.healthCheckInterval = setInterval(() => {
            this.monitorRuntimeHealth();
        }, 30000);
    }

    private isRuntimeCompatible(
        runtime: IPythonRuntime,
        device: IDevice,
        preferences: RuntimePreferences
    ): boolean {
        // Check required capabilities
        if (preferences.requiredCapabilities) {
            for (const [capability, required] of Object.entries(preferences.requiredCapabilities)) {
                if (required && !runtime.capabilities[capability as keyof RuntimeCapabilities]) {
                    return false;
                }
            }
        }

        // Check device compatibility
        if (preferences.deviceCompatibility) {
            const deviceType = device.name.toLowerCase();
            const isCompatible = preferences.deviceCompatibility.some(compat =>
                deviceType.includes(compat.toLowerCase())
            );
            if (!isCompatible) {
                return false;
            }
        }

        return true;
    }

    private scoreRuntimeForDevice(
        runtime: IPythonRuntime,
        device: IDevice,
        preferences: RuntimePreferences
    ): number {
        let score = 0;

        // Base compatibility score
        if (this.isRuntimeCompatible(runtime, device, preferences)) {
            score += 10;
        }

        // Flagship runtime bonus (CircuitPython)
        if (runtime.type === 'circuitpython') {
            score += 5;
        }

        // Performance profile scoring
        switch (preferences.performanceProfile) {
            case 'speed':
                if (runtime.capabilities.supportsWASMExecution) score += 3;
                break;
            case 'memory':
                if (runtime.type === 'micropython') score += 3;
                break;
            case 'compatibility':
                if (runtime.type === 'circuitpython') score += 3;
                break;
        }

        // Health and responsiveness
        const health = this.healthMetrics.get(runtime.type);
        if (health?.isResponsive) {
            score += 2;
        }

        return score;
    }

    private checkRuntimeHealth(type: PythonRuntimeType, runtime: IPythonRuntime): void {
        const metrics = this.healthMetrics.get(type);
        if (!metrics) {
            return;
        }

        // Update last health check time
        metrics.lastHealthCheck = Date.now();

        // Check if runtime is responsive
        const wasResponsive = metrics.isResponsive;
        metrics.isResponsive = runtime.isInitialized;

        // Emit warning if runtime becomes unresponsive
        if (wasResponsive && !metrics.isResponsive) {
            this.emit('healthWarning', type, 'Runtime became unresponsive');
            logger.warn('EXECUTION', `Runtime ${type} health warning: became unresponsive`);
        }
    }
}

// Type augmentation for EventEmitter events
declare interface MuTwoRuntimeCoordinator {
    on<K extends keyof RuntimeCoordinatorEvents>(
        event: K,
        listener: (...args: RuntimeCoordinatorEvents[K]) => void
    ): this;

    emit<K extends keyof RuntimeCoordinatorEvents>(
        event: K,
        ...args: RuntimeCoordinatorEvents[K]
    ): boolean;
}