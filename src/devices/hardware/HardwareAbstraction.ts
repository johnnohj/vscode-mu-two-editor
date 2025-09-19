/**
 * Unified Hardware Abstraction Layer
 *
 * Provides a single interface for hardware interaction that works with:
 * - Physical CircuitPython devices (via serial)
 * - WASM virtual CircuitPython (via runtime manager)
 *
 * This replaces device twinning overlap by using WASM as the canonical
 * virtual hardware state source.
 */

import { EventEmitter } from 'events';
import { WasmRuntimeManager, WasmHardwareState } from '../../sys/wasmRuntimeManager';

// Simplified hardware state interfaces (replacing complex device twinning)
export interface HardwarePin {
    pin: number;
    name: string;
    mode: 'input' | 'output' | 'analog' | 'pwm';
    value: number | boolean;
    capabilities: string[];
    lastChanged: number;
}

export interface HardwareSensor {
    id: string;
    name: string;
    type: string;
    value: number;
    unit: string;
    range: { min: number; max: number };
    lastReading: number;
    isActive: boolean;
}

export interface HardwareState {
    deviceId: string;
    timestamp: number;
    pins: HardwarePin[];
    sensors: HardwareSensor[];
    isConnected: boolean;
    type: 'physical' | 'wasm-virtual';
}

export interface HardwareExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    executionTime: number;
    hardwareChanges: Array<{
        type: 'pin' | 'sensor';
        target: string | number;
        oldValue: any;
        newValue: any;
        timestamp: number;
    }>;
}

/**
 * Unified hardware abstraction interface
 */
export interface IHardwareAbstraction {
    readonly type: 'physical' | 'wasm-virtual';
    readonly deviceId: string;
    readonly isConnected: boolean;

    // Connection management
    connect(): Promise<boolean>;
    disconnect(): Promise<boolean>;
    ping(): Promise<boolean>;

    // Code execution
    executeCode(code: string, options?: { timeout?: number }): Promise<HardwareExecutionResult>;
    reset(): Promise<boolean>;

    // Hardware state
    getHardwareState(): Promise<HardwareState>;
    getPinState(pin: number): Promise<HardwarePin | null>;
    setPinState(pin: number, mode: string, value: number | boolean): Promise<boolean>;
    getSensorReading(sensorId: string): Promise<HardwareSensor | null>;

    // Events
    on(event: 'stateChanged' | 'connected' | 'disconnected' | 'error', listener: (...args: any[]) => void): this;
    off(event: 'stateChanged' | 'connected' | 'disconnected' | 'error', listener: (...args: any[]) => void): this;
}

/**
 * WASM-backed virtual hardware implementation
 *
 * This is now the canonical source for virtual hardware state,
 * eliminating the need for complex device twinning.
 */
export class WasmVirtualHardware extends EventEmitter implements IHardwareAbstraction {
    readonly type = 'wasm-virtual' as const;
    readonly deviceId: string;

    private wasmRuntime: WasmRuntimeManager;
    private _isConnected = false;
    private lastKnownState: HardwareState | null = null;

    constructor(deviceId: string, wasmRuntime: WasmRuntimeManager) {
        super();
        this.deviceId = deviceId;
        this.wasmRuntime = wasmRuntime;

        // Listen for WASM hardware state changes
        this.wasmRuntime.on('hardwareStateChanged', (state) => {
            this.handleWasmStateChange(state);
        });
    }

    get isConnected(): boolean {
        return this._isConnected;
    }

    async connect(): Promise<boolean> {
        try {
            if (!await this.wasmRuntime.isHealthy()) {
                await this.wasmRuntime.initialize();
            }

            // Create execution environment for this device
            await this.wasmRuntime.createExecutionEnvironment(this.deviceId);

            this._isConnected = true;
            this.emit('connected');
            return true;

        } catch (error) {
            this.emit('error', error);
            return false;
        }
    }

    async disconnect(): Promise<boolean> {
        this._isConnected = false;
        this.emit('disconnected');
        return true;
    }

    async ping(): Promise<boolean> {
        return this.wasmRuntime.isHealthy();
    }

    async executeCode(code: string, options: { timeout?: number } = {}): Promise<HardwareExecutionResult> {
        const startTime = Date.now();

        try {
            const result = await this.wasmRuntime.executeCode(code, {
                enableHardwareMonitoring: true,
                timeout: options.timeout
            });

            return {
                success: result.success,
                output: result.output,
                error: result.error,
                executionTime: Date.now() - startTime,
                hardwareChanges: result.hardwareChanges || []
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

    async reset(): Promise<boolean> {
        try {
            await this.wasmRuntime.reset();
            this.lastKnownState = null;
            return true;
        } catch (error) {
            this.emit('error', error);
            return false;
        }
    }

    async getHardwareState(): Promise<HardwareState> {
        try {
            const wasmState = await this.wasmRuntime.getHardwareState();
            const hardwareState = this.convertWasmStateToHardwareState(wasmState);
            this.lastKnownState = hardwareState;
            return hardwareState;

        } catch (error) {
            this.emit('error', error);

            // Return last known state or empty state
            return this.lastKnownState || {
                deviceId: this.deviceId,
                timestamp: Date.now(),
                pins: [],
                sensors: [],
                isConnected: this._isConnected,
                type: 'wasm-virtual'
            };
        }
    }

    async getPinState(pin: number): Promise<HardwarePin | null> {
        try {
            const state = await this.getHardwareState();
            return state.pins.find(p => p.pin === pin) || null;
        } catch {
            return null;
        }
    }

    async setPinState(pin: number, mode: string, value: number | boolean): Promise<boolean> {
        try {
            return await this.wasmRuntime.setHardwareState({
                pins: [{ pin, mode, value }]
            });
        } catch (error) {
            this.emit('error', error);
            return false;
        }
    }

    async getSensorReading(sensorId: string): Promise<HardwareSensor | null> {
        try {
            const state = await this.getHardwareState();
            return state.sensors.find(s => s.id === sensorId) || null;
        } catch {
            return null;
        }
    }

    private handleWasmStateChange(wasmState: WasmHardwareState): void {
        const hardwareState = this.convertWasmStateToHardwareState(wasmState);
        this.lastKnownState = hardwareState;
        this.emit('stateChanged', hardwareState);
    }

    private convertWasmStateToHardwareState(wasmState: WasmHardwareState): HardwareState {
        const pins: HardwarePin[] = [];
        const sensors: HardwareSensor[] = [];

        // Convert WASM pins to hardware pins
        for (const [pinId, pinData] of wasmState.pins) {
            pins.push({
                pin: typeof pinId === 'string' ? parseInt(pinId) : pinId,
                name: `D${pinId}`,
                mode: pinData.mode,
                value: pinData.value,
                capabilities: ['digital', 'analog'], // Default capabilities
                lastChanged: pinData.lastChanged
            });
        }

        // Convert WASM sensors to hardware sensors
        for (const [sensorId, sensorData] of wasmState.sensors) {
            sensors.push({
                id: sensorId,
                name: sensorData.type || sensorId,
                type: sensorData.type || 'unknown',
                value: sensorData.value,
                unit: this.getSensorUnit(sensorData.type),
                range: sensorData.range || { min: 0, max: 100 },
                lastReading: sensorData.lastReading,
                isActive: sensorData.isActive !== false
            });
        }

        return {
            deviceId: this.deviceId,
            timestamp: wasmState.timestamp,
            pins,
            sensors,
            isConnected: this._isConnected,
            type: 'wasm-virtual'
        };
    }

    private getSensorUnit(sensorType: string): string {
        const unitMap: Record<string, string> = {
            'temperature': '°C',
            'humidity': '%',
            'light': 'lux',
            'pressure': 'hPa',
            'accelerometer': 'm/s²',
            'gyroscope': 'dps',
            'magnetometer': 'µT'
        };
        return unitMap[sensorType] || 'units';
    }
}

/**
 * Physical hardware implementation (for comparison)
 *
 * This provides the same interface but communicates with real hardware
 * via serial connection.
 */
export class PhysicalHardware extends EventEmitter implements IHardwareAbstraction {
    readonly type = 'physical' as const;
    readonly deviceId: string;

    private serialConnection: any; // Would be actual serial connection
    private _isConnected = false;

    constructor(deviceId: string, connectionInfo: { port: string; baudRate: number }) {
        super();
        this.deviceId = deviceId;
        // Initialize serial connection here
    }

    get isConnected(): boolean {
        return this._isConnected;
    }

    async connect(): Promise<boolean> {
        try {
            // Establish serial connection
            // this.serialConnection = await SerialConnection.create(...)
            this._isConnected = true;
            this.emit('connected');
            return true;
        } catch (error) {
            this.emit('error', error);
            return false;
        }
    }

    async disconnect(): Promise<boolean> {
        try {
            // Close serial connection
            // await this.serialConnection.close();
            this._isConnected = false;
            this.emit('disconnected');
            return true;
        } catch {
            return false;
        }
    }

    async ping(): Promise<boolean> {
        // Send ping command to physical device
        return this._isConnected;
    }

    async executeCode(code: string, options: { timeout?: number } = {}): Promise<HardwareExecutionResult> {
        // Send code to physical device via serial REPL
        // Parse response and hardware state changes
        return {
            success: true,
            output: 'Physical device output',
            executionTime: 100,
            hardwareChanges: []
        };
    }

    async reset(): Promise<boolean> {
        // Send reset command to physical device
        return true;
    }

    async getHardwareState(): Promise<HardwareState> {
        // Query physical device for current state
        return {
            deviceId: this.deviceId,
            timestamp: Date.now(),
            pins: [],
            sensors: [],
            isConnected: this._isConnected,
            type: 'physical'
        };
    }

    async getPinState(pin: number): Promise<HardwarePin | null> {
        // Query specific pin state from physical device
        return null;
    }

    async setPinState(pin: number, mode: string, value: number | boolean): Promise<boolean> {
        // Send pin state command to physical device
        return true;
    }

    async getSensorReading(sensorId: string): Promise<HardwareSensor | null> {
        // Read sensor value from physical device
        return null;
    }
}

/**
 * Hardware abstraction factory
 *
 * Creates the appropriate hardware implementation based on device type
 */
export class HardwareAbstractionFactory {
    static create(
        type: 'physical' | 'wasm-virtual',
        deviceId: string,
        options: {
            wasmRuntime?: WasmRuntimeManager;
            connectionInfo?: { port: string; baudRate: number };
        }
    ): IHardwareAbstraction {

        if (type === 'wasm-virtual') {
            if (!options.wasmRuntime) {
                throw new Error('WASM runtime required for virtual hardware');
            }
            return new WasmVirtualHardware(deviceId, options.wasmRuntime);
        } else {
            if (!options.connectionInfo) {
                throw new Error('Connection info required for physical hardware');
            }
            return new PhysicalHardware(deviceId, options.connectionInfo);
        }
    }
}