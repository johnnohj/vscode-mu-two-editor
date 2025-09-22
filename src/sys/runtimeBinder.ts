/**
 * Runtime Binder Implementation
 *
 * Phase 3 - Runtime-Agnostic Device Management: Separate runtime binding concern
 *
 * This implementation handles runtime binding as a completely separate concern
 * from device management. It manages the association between devices and runtimes
 * without affecting device connection or discovery.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { IPythonRuntime, PythonRuntimeType } from '../runtime/IPythonRuntime';
import { IRuntimeBinder } from './deviceManagerInterface';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Runtime binding events
 */
export interface RuntimeBinderEvents {
    'runtimeBound': [string, IPythonRuntime]; // deviceId, runtime
    'runtimeUnbound': [string, IPythonRuntime]; // deviceId, runtime
    'runtimeSwitched': [string, IPythonRuntime, IPythonRuntime]; // deviceId, oldRuntime, newRuntime
    'bindingError': [string, Error]; // deviceId, error
}

/**
 * Runtime binding metadata
 */
export interface RuntimeBinding {
    deviceId: string;
    runtime: IPythonRuntime;
    runtimeType: PythonRuntimeType;
    boundAt: number;
    lastActivity: number;
    preferences?: {
        autoReconnect?: boolean;
        executionTimeout?: number;
        debugMode?: boolean;
        preferredMode?: 'repl' | 'file' | 'raw';
    };
    metadata?: Record<string, any>;
}

/**
 * Runtime Binder Implementation
 *
 * Handles runtime binding as a separate concern from device management
 */
export class RuntimeBinder extends EventEmitter implements IRuntimeBinder {
    private static instance: RuntimeBinder;

    // Runtime bindings
    private deviceRuntimeBindings = new Map<string, RuntimeBinding>();

    // Binding preferences
    private defaultPreferences = {
        autoReconnect: true,
        executionTimeout: 30000,
        debugMode: false,
        preferredMode: 'repl' as const
    };

    // State management
    private isInitialized = false;

    constructor() {
        super();
        logger.info('EXECUTION', 'RuntimeBinder created - handling runtime binding as separate concern');
    }

    /**
     * Singleton pattern for extension-wide runtime binding
     */
    static getInstance(): RuntimeBinder {
        if (!RuntimeBinder.instance) {
            RuntimeBinder.instance = new RuntimeBinder();
        }
        return RuntimeBinder.instance;
    }

    /**
     * Initialize the runtime binder
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            logger.debug('EXECUTION', 'RuntimeBinder already initialized');
            return;
        }

        logger.info('EXECUTION', 'Initializing RuntimeBinder...');

        try {
            // Load any persistent bindings from VS Code settings
            await this.loadPersistedBindings();

            this.isInitialized = true;
            logger.info('EXECUTION', '✓ RuntimeBinder initialized successfully');

        } catch (error) {
            logger.error('EXECUTION', `Failed to initialize RuntimeBinder: ${error}`);
            throw error;
        }
    }

    /**
     * Dispose the runtime binder
     */
    async dispose(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        logger.info('EXECUTION', 'Disposing RuntimeBinder...');

        try {
            // Persist current bindings
            await this.persistBindings();

            // Unbind all devices
            for (const deviceId of this.deviceRuntimeBindings.keys()) {
                await this.unbindDevice(deviceId);
            }

            // Clear state
            this.deviceRuntimeBindings.clear();
            this.removeAllListeners();

            this.isInitialized = false;
            logger.info('EXECUTION', '✓ RuntimeBinder disposed successfully');

        } catch (error) {
            logger.error('EXECUTION', `Error disposing RuntimeBinder: ${error}`);
            throw error;
        }
    }

    // ========================= Runtime Binding Operations =========================

    /**
     * Bind a device to a specific runtime
     */
    async bindDeviceToRuntime(deviceId: string, runtime: IPythonRuntime): Promise<void> {
        logger.info('EXECUTION', `Binding device ${deviceId} to ${runtime.type} runtime...`);

        try {
            // Check if device already has a binding
            const existingBinding = this.deviceRuntimeBindings.get(deviceId);
            if (existingBinding) {
                logger.warn('EXECUTION', `Device ${deviceId} already bound to ${existingBinding.runtimeType}, switching...`);
                await this.switchDeviceRuntime(deviceId, runtime);
                return;
            }

            // Create new binding
            const binding: RuntimeBinding = {
                deviceId,
                runtime,
                runtimeType: runtime.type,
                boundAt: Date.now(),
                lastActivity: Date.now(),
                preferences: { ...this.defaultPreferences },
                metadata: {
                    bindingVersion: '1.0',
                    bindingSource: 'manual'
                }
            };

            // Store the binding
            this.deviceRuntimeBindings.set(deviceId, binding);

            // Initialize runtime connection if the runtime supports it
            if (typeof runtime.connectToDevice === 'function') {
                try {
                    await runtime.connectToDevice(deviceId);
                    logger.debug('EXECUTION', `Runtime ${runtime.type} connected to device ${deviceId}`);
                } catch (error) {
                    logger.warn('EXECUTION', `Runtime connection failed but binding maintained: ${error}`);
                }
            }

            this.emit('runtimeBound', deviceId, runtime);
            logger.info('EXECUTION', `✓ Device ${deviceId} bound to ${runtime.type} runtime successfully`);

        } catch (error) {
            logger.error('EXECUTION', `Failed to bind device ${deviceId} to runtime: ${error}`);
            this.emit('bindingError', deviceId, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    /**
     * Unbind a device from its current runtime
     */
    async unbindDevice(deviceId: string): Promise<void> {
        logger.info('EXECUTION', `Unbinding device ${deviceId} from runtime...`);

        const binding = this.deviceRuntimeBindings.get(deviceId);
        if (!binding) {
            logger.debug('EXECUTION', `Device ${deviceId} is not bound to any runtime`);
            return;
        }

        try {
            // Disconnect runtime from device if supported
            if (typeof binding.runtime.disconnectFromDevice === 'function') {
                try {
                    await binding.runtime.disconnectFromDevice(deviceId);
                    logger.debug('EXECUTION', `Runtime ${binding.runtimeType} disconnected from device ${deviceId}`);
                } catch (error) {
                    logger.warn('EXECUTION', `Runtime disconnection failed: ${error}`);
                }
            }

            // Remove the binding
            this.deviceRuntimeBindings.delete(deviceId);

            this.emit('runtimeUnbound', deviceId, binding.runtime);
            logger.info('EXECUTION', `✓ Device ${deviceId} unbound from ${binding.runtimeType} runtime successfully`);

        } catch (error) {
            logger.error('EXECUTION', `Failed to unbind device ${deviceId}: ${error}`);
            this.emit('bindingError', deviceId, error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    /**
     * Get the runtime bound to a device
     */
    getDeviceRuntime(deviceId: string): IPythonRuntime | null {
        const binding = this.deviceRuntimeBindings.get(deviceId);
        return binding ? binding.runtime : null;
    }

    /**
     * Get all device-runtime bindings
     */
    getAllBindings(): Map<string, IPythonRuntime> {
        const bindings = new Map<string, IPythonRuntime>();
        for (const [deviceId, binding] of this.deviceRuntimeBindings) {
            bindings.set(deviceId, binding.runtime);
        }
        return bindings;
    }

    /**
     * Check if a device has a runtime binding
     */
    hasRuntimeBinding(deviceId: string): boolean {
        return this.deviceRuntimeBindings.has(deviceId);
    }

    /**
     * Switch a device to a different runtime
     */
    async switchDeviceRuntime(deviceId: string, newRuntime: IPythonRuntime): Promise<boolean> {
        logger.info('EXECUTION', `Switching device ${deviceId} to ${newRuntime.type} runtime...`);

        const existingBinding = this.deviceRuntimeBindings.get(deviceId);
        if (!existingBinding) {
            // No existing binding, just bind to new runtime
            await this.bindDeviceToRuntime(deviceId, newRuntime);
            return true;
        }

        if (existingBinding.runtimeType === newRuntime.type) {
            logger.debug('EXECUTION', `Device ${deviceId} already using ${newRuntime.type} runtime`);
            return true;
        }

        try {
            const oldRuntime = existingBinding.runtime;

            // Disconnect from old runtime
            if (typeof oldRuntime.disconnectFromDevice === 'function') {
                try {
                    await oldRuntime.disconnectFromDevice(deviceId);
                    logger.debug('EXECUTION', `Disconnected from old runtime ${oldRuntime.type}`);
                } catch (error) {
                    logger.warn('EXECUTION', `Failed to disconnect from old runtime: ${error}`);
                }
            }

            // Update binding to new runtime
            const updatedBinding: RuntimeBinding = {
                ...existingBinding,
                runtime: newRuntime,
                runtimeType: newRuntime.type,
                lastActivity: Date.now(),
                metadata: {
                    ...existingBinding.metadata,
                    previousRuntime: oldRuntime.type,
                    switchedAt: Date.now()
                }
            };

            this.deviceRuntimeBindings.set(deviceId, updatedBinding);

            // Connect to new runtime
            if (typeof newRuntime.connectToDevice === 'function') {
                try {
                    await newRuntime.connectToDevice(deviceId);
                    logger.debug('EXECUTION', `Connected to new runtime ${newRuntime.type}`);
                } catch (error) {
                    logger.warn('EXECUTION', `Failed to connect to new runtime: ${error}`);
                }
            }

            this.emit('runtimeSwitched', deviceId, oldRuntime, newRuntime);
            logger.info('EXECUTION', `✓ Device ${deviceId} switched from ${oldRuntime.type} to ${newRuntime.type} runtime`);

            return true;

        } catch (error) {
            logger.error('EXECUTION', `Failed to switch device ${deviceId} runtime: ${error}`);
            this.emit('bindingError', deviceId, error instanceof Error ? error : new Error(String(error)));
            return false;
        }
    }

    /**
     * Get binding metadata for a device
     */
    getBindingMetadata(deviceId: string): {
        runtimeType: string;
        boundAt: number;
        lastActivity: number;
        preferences?: Record<string, any>;
    } | null {
        const binding = this.deviceRuntimeBindings.get(deviceId);
        if (!binding) {
            return null;
        }

        return {
            runtimeType: binding.runtimeType,
            boundAt: binding.boundAt,
            lastActivity: binding.lastActivity,
            preferences: binding.preferences
        };
    }

    // ========================= Binding Management =========================

    /**
     * Update binding preferences for a device
     */
    updateBindingPreferences(deviceId: string, preferences: Partial<RuntimeBinding['preferences']>): boolean {
        const binding = this.deviceRuntimeBindings.get(deviceId);
        if (!binding) {
            logger.warn('EXECUTION', `Cannot update preferences for unbound device ${deviceId}`);
            return false;
        }

        binding.preferences = {
            ...binding.preferences,
            ...preferences
        };

        binding.lastActivity = Date.now();
        logger.debug('EXECUTION', `Updated binding preferences for device ${deviceId}`);

        return true;
    }

    /**
     * Get binding preferences for a device
     */
    getBindingPreferences(deviceId: string): RuntimeBinding['preferences'] | null {
        const binding = this.deviceRuntimeBindings.get(deviceId);
        return binding ? binding.preferences : null;
    }

    /**
     * Update last activity time for a device binding
     */
    updateBindingActivity(deviceId: string): void {
        const binding = this.deviceRuntimeBindings.get(deviceId);
        if (binding) {
            binding.lastActivity = Date.now();
        }
    }

    /**
     * Get all bindings with their metadata
     */
    getAllBindingsWithMetadata(): Map<string, RuntimeBinding> {
        return new Map(this.deviceRuntimeBindings);
    }

    // ========================= Persistence =========================

    /**
     * Load persisted bindings from VS Code settings
     */
    private async loadPersistedBindings(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('muTwo.runtime.bindings');
            const persistedBindings = config.get<Record<string, any>>('deviceBindings', {});

            logger.debug('EXECUTION', `Loading ${Object.keys(persistedBindings).length} persisted bindings...`);

            // Note: We only persist binding metadata, not actual runtime instances
            // Runtime instances need to be reestablished on startup

        } catch (error) {
            logger.warn('EXECUTION', `Failed to load persisted bindings: ${error}`);
        }
    }

    /**
     * Persist current bindings to VS Code settings
     */
    private async persistBindings(): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('muTwo.runtime.bindings');

            // Create persistable binding data (without runtime instances)
            const persistableBindings: Record<string, any> = {};

            for (const [deviceId, binding] of this.deviceRuntimeBindings) {
                persistableBindings[deviceId] = {
                    runtimeType: binding.runtimeType,
                    boundAt: binding.boundAt,
                    preferences: binding.preferences,
                    metadata: binding.metadata
                };
            }

            await config.update('deviceBindings', persistableBindings, vscode.ConfigurationTarget.Global);

            logger.debug('EXECUTION', `Persisted ${Object.keys(persistableBindings).length} bindings to settings`);

        } catch (error) {
            logger.warn('EXECUTION', `Failed to persist bindings: ${error}`);
        }
    }

    // ========================= Utility Methods =========================

    /**
     * Get binding statistics
     */
    getBindingStatistics(): {
        totalBindings: number;
        runtimeTypeDistribution: Record<string, number>;
        activeBindings: number;
        oldestBinding?: { deviceId: string; age: number };
    } {
        const stats = {
            totalBindings: this.deviceRuntimeBindings.size,
            runtimeTypeDistribution: {} as Record<string, number>,
            activeBindings: 0,
            oldestBinding: undefined as { deviceId: string; age: number } | undefined
        };

        let oldestTime = Date.now();

        for (const [deviceId, binding] of this.deviceRuntimeBindings) {
            // Count by runtime type
            stats.runtimeTypeDistribution[binding.runtimeType] =
                (stats.runtimeTypeDistribution[binding.runtimeType] || 0) + 1;

            // Count active bindings (activity within last hour)
            if (Date.now() - binding.lastActivity < 3600000) {
                stats.activeBindings++;
            }

            // Track oldest binding
            if (binding.boundAt < oldestTime) {
                oldestTime = binding.boundAt;
                stats.oldestBinding = {
                    deviceId,
                    age: Date.now() - binding.boundAt
                };
            }
        }

        return stats;
    }

    /**
     * Clean up stale bindings
     */
    async cleanupStaleBindings(maxAge: number = 86400000): Promise<number> { // Default: 24 hours
        logger.info('EXECUTION', 'Cleaning up stale runtime bindings...');

        const now = Date.now();
        const staleDevices: string[] = [];

        for (const [deviceId, binding] of this.deviceRuntimeBindings) {
            if (now - binding.lastActivity > maxAge) {
                staleDevices.push(deviceId);
            }
        }

        for (const deviceId of staleDevices) {
            try {
                await this.unbindDevice(deviceId);
                logger.debug('EXECUTION', `Cleaned up stale binding for device ${deviceId}`);
            } catch (error) {
                logger.warn('EXECUTION', `Failed to cleanup stale binding for device ${deviceId}: ${error}`);
            }
        }

        logger.info('EXECUTION', `✓ Cleaned up ${staleDevices.length} stale bindings`);
        return staleDevices.length;
    }
}

// Type augmentation for EventEmitter events
declare interface RuntimeBinder {
    on<K extends keyof RuntimeBinderEvents>(
        event: K,
        listener: (...args: RuntimeBinderEvents[K]) => void
    ): this;

    emit<K extends keyof RuntimeBinderEvents>(
        event: K,
        ...args: RuntimeBinderEvents[K]
    ): boolean;
}