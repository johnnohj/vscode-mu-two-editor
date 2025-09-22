/**
 * Hardware Abstraction Registry
 *
 * Phase 2 - Separation of Concerns: Shared hardware state management
 *
 * Responsibilities:
 * - Centralized hardware state storage and management
 * - Hardware event coordination across components
 * - Virtual hardware simulation state
 * - Hardware resource sharing and conflict resolution
 * - Hardware state synchronization between runtime instances
 *
 * This component eliminates duplicate hardware state across multiple
 * WasmRuntimeManager and other hardware-aware components.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Hardware component types
 */
export type HardwareComponentType = 'pin' | 'sensor' | 'actuator' | 'communication' | 'power' | 'system';

/**
 * Pin modes
 */
export type PinMode = 'digital_in' | 'digital_out' | 'analog_in' | 'analog_out' | 'pwm' | 'servo' | 'i2c' | 'spi' | 'uart';

/**
 * Hardware component state
 */
export interface HardwareComponent {
    id: string;
    type: HardwareComponentType;
    name: string;
    description?: string;
    isVirtual: boolean;
    lastUpdated: number;
    properties: Record<string, any>;
}

/**
 * Pin state information
 */
export interface PinState {
    pinNumber: number;
    mode: PinMode;
    value: any;
    lastChanged: number;
    isReserved: boolean;
    reservedBy?: string; // Component ID that reserved this pin
}

/**
 * Sensor state information
 */
export interface SensorState {
    sensorId: string;
    sensorType: string;
    lastReading: any;
    lastReadTime: number;
    isActive: boolean;
    configuration: Record<string, any>;
}

/**
 * Hardware event information
 */
export interface HardwareEvent {
    id: string;
    timestamp: number;
    component: HardwareComponent;
    eventType: 'state_changed' | 'value_updated' | 'error' | 'connected' | 'disconnected';
    oldValue?: any;
    newValue?: any;
    metadata?: Record<string, any>;
}

/**
 * Hardware abstraction instance
 */
export interface HardwareAbstraction {
    id: string;
    deviceId: string;
    runtimeType: string;
    isVirtual: boolean;
    createdAt: number;
    lastActivity: number;
    pins: Map<number, PinState>;
    sensors: Map<string, SensorState>;
    components: Map<string, HardwareComponent>;
}

/**
 * Hardware registry events
 */
export interface HardwareRegistryEvents {
    'hardwareRegistered': [string, HardwareAbstraction]; // id, abstraction
    'hardwareUnregistered': [string]; // id
    'hardwareStateChanged': [string, HardwareEvent]; // abstractionId, event
    'pinStateChanged': [string, number, PinState]; // abstractionId, pinNumber, state
    'sensorDataUpdated': [string, string, any]; // abstractionId, sensorId, data
    'hardwareConflict': [string, string, string]; // resource, claimant1, claimant2
}

/**
 * Hardware conflict resolution strategies
 */
export type ConflictResolution = 'first_wins' | 'last_wins' | 'priority_based' | 'user_prompt' | 'error';

/**
 * Hardware Abstraction Registry Implementation
 *
 * Centralizes all hardware state management and provides shared access
 */
export class HardwareAbstractionRegistry extends EventEmitter {
    private static instance: HardwareAbstractionRegistry;

    // Registry of hardware abstractions
    private hardwareAbstractions = new Map<string, HardwareAbstraction>();

    // Global hardware state (shared across all abstractions)
    private globalPinState = new Map<number, PinState>();
    private globalSensorState = new Map<string, SensorState>();
    private globalComponents = new Map<string, HardwareComponent>();

    // Resource management
    private resourceOwnership = new Map<string, string>(); // resource -> ownerAbstractionId
    private resourcePriorities = new Map<string, number>(); // abstractionId -> priority

    // Event history for debugging and replay
    private eventHistory: HardwareEvent[] = [];
    private maxHistorySize = 1000;

    // Configuration
    private conflictResolution: ConflictResolution = 'first_wins';
    private enableEventHistory = true;

    constructor() {
        super();
        logger.info('EXECUTION', 'HardwareAbstractionRegistry created - centralized hardware state management');
    }

    /**
     * Singleton pattern for extension-wide hardware state management
     */
    static getInstance(): HardwareAbstractionRegistry {
        if (!HardwareAbstractionRegistry.instance) {
            HardwareAbstractionRegistry.instance = new HardwareAbstractionRegistry();
        }
        return HardwareAbstractionRegistry.instance;
    }

    // ========================= Hardware Abstraction Management =========================

    /**
     * Register a new hardware abstraction
     */
    registerHardwareAbstraction(
        id: string,
        deviceId: string,
        runtimeType: string,
        isVirtual: boolean = false
    ): HardwareAbstraction {
        logger.info('EXECUTION', `Registering hardware abstraction: ${id} (${runtimeType}, virtual: ${isVirtual})`);

        if (this.hardwareAbstractions.has(id)) {
            logger.warn('EXECUTION', `Hardware abstraction ${id} already exists, replacing`);
            this.unregisterHardwareAbstraction(id);
        }

        const abstraction: HardwareAbstraction = {
            id,
            deviceId,
            runtimeType,
            isVirtual,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            pins: new Map(),
            sensors: new Map(),
            components: new Map()
        };

        this.hardwareAbstractions.set(id, abstraction);

        // Set default priority (virtual abstractions have lower priority)
        this.resourcePriorities.set(id, isVirtual ? 1 : 10);

        this.emit('hardwareRegistered', id, abstraction);
        logger.info('EXECUTION', `✓ Hardware abstraction ${id} registered successfully`);

        return abstraction;
    }

    /**
     * Unregister a hardware abstraction
     */
    unregisterHardwareAbstraction(id: string): void {
        logger.info('EXECUTION', `Unregistering hardware abstraction: ${id}`);

        const abstraction = this.hardwareAbstractions.get(id);
        if (!abstraction) {
            logger.warn('EXECUTION', `Hardware abstraction ${id} not found for unregistration`);
            return;
        }

        // Release all resources owned by this abstraction
        for (const [resource, owner] of this.resourceOwnership) {
            if (owner === id) {
                this.resourceOwnership.delete(resource);
                logger.debug('EXECUTION', `Released resource ${resource} from abstraction ${id}`);
            }
        }

        // Remove from registry
        this.hardwareAbstractions.delete(id);
        this.resourcePriorities.delete(id);

        this.emit('hardwareUnregistered', id);
        logger.info('EXECUTION', `✓ Hardware abstraction ${id} unregistered successfully`);
    }

    /**
     * Get a hardware abstraction by ID
     */
    getHardwareAbstraction(id: string): HardwareAbstraction | null {
        return this.hardwareAbstractions.get(id) || null;
    }

    /**
     * Get all registered hardware abstractions
     */
    getAllHardwareAbstractions(): Map<string, HardwareAbstraction> {
        return new Map(this.hardwareAbstractions);
    }

    // ========================= Pin State Management =========================

    /**
     * Set pin state for a specific hardware abstraction
     */
    setPinState(
        abstractionId: string,
        pinNumber: number,
        mode: PinMode,
        value: any
    ): boolean {
        logger.debug('EXECUTION', `Setting pin ${pinNumber} state for abstraction ${abstractionId}: ${mode} = ${value}`);

        const abstraction = this.hardwareAbstractions.get(abstractionId);
        if (!abstraction) {
            logger.error('EXECUTION', `Hardware abstraction ${abstractionId} not found`);
            return false;
        }

        // Check for resource conflicts
        const resourceKey = `pin_${pinNumber}`;
        if (!this.claimResource(resourceKey, abstractionId)) {
            logger.warn('EXECUTION', `Pin ${pinNumber} is already in use by another abstraction`);
            return false;
        }

        // Update local pin state
        const oldState = abstraction.pins.get(pinNumber);
        const newState: PinState = {
            pinNumber,
            mode,
            value,
            lastChanged: Date.now(),
            isReserved: true,
            reservedBy: abstractionId
        };

        abstraction.pins.set(pinNumber, newState);
        abstraction.lastActivity = Date.now();

        // Update global pin state
        this.globalPinState.set(pinNumber, newState);

        // Emit events
        this.emit('pinStateChanged', abstractionId, pinNumber, newState);

        if (this.enableEventHistory) {
            this.recordHardwareEvent({
                id: `pin_${pinNumber}_${Date.now()}`,
                timestamp: Date.now(),
                component: {
                    id: `pin_${pinNumber}`,
                    type: 'pin',
                    name: `Pin ${pinNumber}`,
                    isVirtual: abstraction.isVirtual,
                    lastUpdated: Date.now(),
                    properties: { mode, value }
                },
                eventType: 'value_updated',
                oldValue: oldState?.value,
                newValue: value,
                metadata: { abstractionId, pinNumber, mode }
            });
        }

        logger.debug('EXECUTION', `✓ Pin ${pinNumber} state updated successfully`);
        return true;
    }

    /**
     * Get pin state for a specific pin
     */
    getPinState(pinNumber: number): PinState | null {
        return this.globalPinState.get(pinNumber) || null;
    }

    /**
     * Get all pin states for a hardware abstraction
     */
    getAbstractionPinStates(abstractionId: string): Map<number, PinState> {
        const abstraction = this.hardwareAbstractions.get(abstractionId);
        return abstraction ? new Map(abstraction.pins) : new Map();
    }

    // ========================= Sensor State Management =========================

    /**
     * Update sensor data for a specific hardware abstraction
     */
    updateSensorData(
        abstractionId: string,
        sensorId: string,
        sensorType: string,
        data: any,
        configuration?: Record<string, any>
    ): boolean {
        logger.debug('EXECUTION', `Updating sensor data for ${sensorId} in abstraction ${abstractionId}`);

        const abstraction = this.hardwareAbstractions.get(abstractionId);
        if (!abstraction) {
            logger.error('EXECUTION', `Hardware abstraction ${abstractionId} not found`);
            return false;
        }

        // Check for resource conflicts
        const resourceKey = `sensor_${sensorId}`;
        if (!this.claimResource(resourceKey, abstractionId)) {
            logger.warn('EXECUTION', `Sensor ${sensorId} is already in use by another abstraction`);
            return false;
        }

        // Update local sensor state
        const oldState = abstraction.sensors.get(sensorId);
        const newState: SensorState = {
            sensorId,
            sensorType,
            lastReading: data,
            lastReadTime: Date.now(),
            isActive: true,
            configuration: configuration || oldState?.configuration || {}
        };

        abstraction.sensors.set(sensorId, newState);
        abstraction.lastActivity = Date.now();

        // Update global sensor state
        this.globalSensorState.set(sensorId, newState);

        // Emit events
        this.emit('sensorDataUpdated', abstractionId, sensorId, data);

        if (this.enableEventHistory) {
            this.recordHardwareEvent({
                id: `sensor_${sensorId}_${Date.now()}`,
                timestamp: Date.now(),
                component: {
                    id: sensorId,
                    type: 'sensor',
                    name: `${sensorType} Sensor`,
                    isVirtual: abstraction.isVirtual,
                    lastUpdated: Date.now(),
                    properties: { sensorType, data, configuration }
                },
                eventType: 'value_updated',
                oldValue: oldState?.lastReading,
                newValue: data,
                metadata: { abstractionId, sensorId, sensorType }
            });
        }

        logger.debug('EXECUTION', `✓ Sensor ${sensorId} data updated successfully`);
        return true;
    }

    /**
     * Get sensor state for a specific sensor
     */
    getSensorState(sensorId: string): SensorState | null {
        return this.globalSensorState.get(sensorId) || null;
    }

    /**
     * Get all sensor states for a hardware abstraction
     */
    getAbstractionSensorStates(abstractionId: string): Map<string, SensorState> {
        const abstraction = this.hardwareAbstractions.get(abstractionId);
        return abstraction ? new Map(abstraction.sensors) : new Map();
    }

    // ========================= Hardware Component Management =========================

    /**
     * Register a hardware component
     */
    registerComponent(
        abstractionId: string,
        component: HardwareComponent
    ): boolean {
        logger.debug('EXECUTION', `Registering component ${component.id} for abstraction ${abstractionId}`);

        const abstraction = this.hardwareAbstractions.get(abstractionId);
        if (!abstraction) {
            logger.error('EXECUTION', `Hardware abstraction ${abstractionId} not found`);
            return false;
        }

        // Check for resource conflicts
        const resourceKey = `component_${component.id}`;
        if (!this.claimResource(resourceKey, abstractionId)) {
            logger.warn('EXECUTION', `Component ${component.id} is already registered by another abstraction`);
            return false;
        }

        // Register component
        abstraction.components.set(component.id, component);
        this.globalComponents.set(component.id, component);

        logger.debug('EXECUTION', `✓ Component ${component.id} registered successfully`);
        return true;
    }

    /**
     * Get a hardware component by ID
     */
    getComponent(componentId: string): HardwareComponent | null {
        return this.globalComponents.get(componentId) || null;
    }

    // ========================= Resource Management =========================

    /**
     * Claim a hardware resource for an abstraction
     */
    private claimResource(resourceKey: string, abstractionId: string): boolean {
        const currentOwner = this.resourceOwnership.get(resourceKey);

        if (!currentOwner) {
            // Resource is free, claim it
            this.resourceOwnership.set(resourceKey, abstractionId);
            return true;
        }

        if (currentOwner === abstractionId) {
            // Resource is already owned by this abstraction
            return true;
        }

        // Resource conflict - resolve based on strategy
        return this.resolveResourceConflict(resourceKey, currentOwner, abstractionId);
    }

    /**
     * Resolve resource conflicts between abstractions
     */
    private resolveResourceConflict(
        resourceKey: string,
        currentOwner: string,
        claimant: string
    ): boolean {
        logger.warn('EXECUTION', `Resource conflict for ${resourceKey}: ${currentOwner} vs ${claimant}`);

        this.emit('hardwareConflict', resourceKey, currentOwner, claimant);

        switch (this.conflictResolution) {
            case 'first_wins':
                return false; // Keep current owner

            case 'last_wins':
                this.resourceOwnership.set(resourceKey, claimant);
                return true;

            case 'priority_based':
                const currentPriority = this.resourcePriorities.get(currentOwner) || 0;
                const claimantPriority = this.resourcePriorities.get(claimant) || 0;

                if (claimantPriority > currentPriority) {
                    this.resourceOwnership.set(resourceKey, claimant);
                    return true;
                }
                return false;

            case 'user_prompt':
                // In a real implementation, this would show a user prompt
                // For now, fall back to priority-based
                return this.resolveResourceConflict(resourceKey, currentOwner, claimant);

            case 'error':
                throw new Error(`Resource conflict: ${resourceKey} is already in use by ${currentOwner}`);

            default:
                return false;
        }
    }

    // ========================= Event Management =========================

    /**
     * Record a hardware event in the history
     */
    private recordHardwareEvent(event: HardwareEvent): void {
        if (!this.enableEventHistory) {
            return;
        }

        this.eventHistory.push(event);

        // Maintain history size limit
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory.splice(0, this.eventHistory.length - this.maxHistorySize);
        }

        this.emit('hardwareStateChanged', event.component.id, event);
    }

    /**
     * Get hardware event history
     */
    getEventHistory(filter?: {
        componentId?: string;
        eventType?: string;
        since?: number;
    }): HardwareEvent[] {
        let events = this.eventHistory;

        if (filter) {
            events = events.filter(event => {
                if (filter.componentId && event.component.id !== filter.componentId) {
                    return false;
                }
                if (filter.eventType && event.eventType !== filter.eventType) {
                    return false;
                }
                if (filter.since && event.timestamp < filter.since) {
                    return false;
                }
                return true;
            });
        }

        return [...events]; // Return copy
    }

    // ========================= Configuration =========================

    /**
     * Set conflict resolution strategy
     */
    setConflictResolution(strategy: ConflictResolution): void {
        this.conflictResolution = strategy;
        logger.info('EXECUTION', `Hardware conflict resolution set to: ${strategy}`);
    }

    /**
     * Set abstraction priority
     */
    setAbstractionPriority(abstractionId: string, priority: number): void {
        this.resourcePriorities.set(abstractionId, priority);
        logger.debug('EXECUTION', `Set priority for abstraction ${abstractionId}: ${priority}`);
    }

    /**
     * Enable or disable event history
     */
    setEventHistoryEnabled(enabled: boolean): void {
        this.enableEventHistory = enabled;
        if (!enabled) {
            this.eventHistory = [];
        }
        logger.info('EXECUTION', `Hardware event history ${enabled ? 'enabled' : 'disabled'}`);
    }

    // ========================= Utility Methods =========================

    /**
     * Get overall hardware state summary
     */
    getHardwareStateSummary(): {
        abstractions: number;
        activePins: number;
        activeSensors: number;
        components: number;
        conflicts: number;
    } {
        return {
            abstractions: this.hardwareAbstractions.size,
            activePins: this.globalPinState.size,
            activeSensors: this.globalSensorState.size,
            components: this.globalComponents.size,
            conflicts: 0 // Could implement conflict counting
        };
    }

    /**
     * Reset all hardware state (useful for testing)
     */
    resetAllState(): void {
        logger.warn('EXECUTION', 'Resetting all hardware state...');

        this.hardwareAbstractions.clear();
        this.globalPinState.clear();
        this.globalSensorState.clear();
        this.globalComponents.clear();
        this.resourceOwnership.clear();
        this.resourcePriorities.clear();
        this.eventHistory = [];

        logger.info('EXECUTION', '✓ All hardware state reset');
    }
}

// Type augmentation for EventEmitter events
declare interface HardwareAbstractionRegistry {
    on<K extends keyof HardwareRegistryEvents>(
        event: K,
        listener: (...args: HardwareRegistryEvents[K]) => void
    ): this;

    emit<K extends keyof HardwareRegistryEvents>(
        event: K,
        ...args: HardwareRegistryEvents[K]
    ): boolean;
}