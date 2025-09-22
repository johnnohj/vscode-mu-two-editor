import {
    DebugSession,
    InitializedEvent,
    TerminatedEvent,
    OutputEvent,
    Event
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import * as path from 'path';
import { DeviceConfiguration } from '../core/deviceManager';
import { MuDeviceDetector, MuDevice } from '../core/deviceDetector';
import { DeviceTwinState, BasePinState, SensorState, ActuatorState } from '../deviceTwinning/interfaces';
import { DeviceModelFactory } from '../deviceTwinning/DeviceModelFactory';
import { BoardTemplateGenerator } from '../deviceTwinning/BoardTemplateGenerator';
import { WasmRuntimeManager } from '../../sys/wasmRuntimeManager';
import {
    IHardwareAbstraction,
    HardwareAbstractionFactory,
    HardwareState,
    HardwareExecutionResult
} from '../hardware/HardwareAbstraction';
import { MuTwoRuntimeCoordinator } from '../../sys/unifiedRuntimeCoordinator';
import { getService } from '../../sys/serviceRegistry';

// Mu Two debug adapter interfaces (runtime-agnostic)
export interface MuLaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    name?: string;
    type?: string;
    request?: string;
    port?: string;
    baudRate?: number;
    runtime?: 'circuitpython' | 'micropython' | 'blinka' | 'python';
    program?: string;
    autoDetect?: boolean;
    enableRepl?: boolean;
    boardType?: string;
}

// Extended capabilities for Mu debugging
declare module '@vscode/debugprotocol' {
	 // expect @typescript-eslint/no-namespace
    namespace DebugProtocol {
        interface Capabilities {
            supportsDeviceChannel?: boolean;
            supportsFileOperations?: boolean;
            supportsDeviceManagement?: boolean;
            supportsLibrarySync?: boolean;
        }
    }
}

// Hardware simulation interfaces
export interface SimulatedSensor {
    type: 'temperature' | 'humidity' | 'light' | 'accelerometer' | 'gyroscope' | 'magnetometer';
    id: string;
    name: string;
    unit: string;
    range: { min: number; max: number };
    value: number;
    lastUpdated: number;
    isActive: boolean;
}

export interface SimulatedGPIO {
    pin: number;
    mode: 'input' | 'output' | 'digital' | 'analog' | 'pwm';
    value: number | boolean;
    pullup: boolean;
    pulldown: boolean;
    lastChanged: number;
}

export interface EnvironmentProfile {
    id: string;
    name: string;
    description: string;
    sensors: SimulatedSensor[];
    gpios: SimulatedGPIO[];
    boardConfig: {
        boardId: string;
        displayName: string;
        pinCount: number;
        voltage: number;
        features: string[];
    };
    mockData: {
        enableRealisticData: boolean;
        updateInterval: number;
        variationRange: number;
    };
}

export interface ExecutionEnvironment {
    type: 'physical' | 'simulated';
    deviceId: string;
    profile?: EnvironmentProfile;
    capabilities: {
        hasFileSystem: boolean;
        hasRepl: boolean;
        canExecuteCode: boolean;
        supportsHardwareAccess: boolean;
    };
}

// Enhanced DAP request types for device channel operations
// expect @typescript-eslint/no-namespace
export namespace DeviceChannelRequests {
    export const ConnectDevice = 'deviceChannel/connectDevice';
    export const DisconnectDevice = 'deviceChannel/disconnectDevice';
    export const GetDeviceStatus = 'deviceChannel/getDeviceStatus';
    export const ListDevices = 'deviceChannel/listDevices';
    export const GetDeviceInfo = 'deviceChannel/getDeviceInfo';
    export const SoftReboot = 'deviceChannel/softReboot';
    export const HardReboot = 'deviceChannel/hardReboot';
    export const EnterBootloader = 'deviceChannel/enterBootloader';
    export const TransferFile = 'deviceChannel/transferFile';
    export const DeleteFile = 'deviceChannel/deleteFile';
    export const ListFiles = 'deviceChannel/listFiles';
    export const CreateDirectory = 'deviceChannel/createDirectory';
    export const GetDiskUsage = 'deviceChannel/getDiskUsage';
    export const SyncLibraries = 'deviceChannel/syncLibraries';
    export const GetBoardInfo = 'deviceChannel/getBoardInfo';
    export const SetBoardConfig = 'deviceChannel/setBoardConfig';
    // Hardware-aware code debugging requests
    export const CreateEnvironment = 'environment/create';
    export const LoadEnvironmentProfile = 'environment/loadProfile';
    export const UpdateSensor = 'environment/updateSensor';
    export const UpdateGPIO = 'environment/updateGPIO';
    export const GetEnvironmentStatus = 'environment/getStatus';
    export const ExecuteInEnvironment = 'environment/execute';
    
    // Code execution with hardware state monitoring
    export const ExecuteCode = 'debug/executeCode';
    export const ExecuteWithHardwareMonitoring = 'debug/executeWithHardware';
    export const ExecuteDualComparison = 'debug/executeDual';
    export const StepThroughHardwareChanges = 'debug/stepHardware';
    
    // Device twinning (hardware state as debugging information)
    export const GetHardwareState = 'debug/getHardwareState';
    export const WatchPinState = 'debug/watchPin';
    export const WatchSensorReading = 'debug/watchSensor';
    export const GetHardwareTimeline = 'debug/getTimeline';
}

// Enhanced DAP notification types for device channel
export namespace DeviceChannelNotifications {
    export const DeviceConnected = 'deviceChannel/deviceConnected';
    export const DeviceDisconnected = 'deviceChannel/deviceDisconnected';
    export const DeviceStatusChanged = 'deviceChannel/deviceStatusChanged';
    export const FileTransferProgress = 'deviceChannel/fileTransferProgress';
    export const DeviceError = 'deviceChannel/deviceError';
    export const LibrarySyncProgress = 'deviceChannel/librarySyncProgress';
    // Hardware debugging notifications (device twinning events)
    export const EnvironmentCreated = 'environment/created';
    export const SensorDataChanged = 'environment/sensorChanged';
    export const GPIOStateChanged = 'environment/gpioChanged';
    export const CodeExecutionResult = 'environment/executionResult';
    
    // Code execution with hardware monitoring
    export const CodeExecutionStarted = 'debug/executionStarted';
    export const CodeExecutionComplete = 'debug/executionComplete';
    export const HardwareStateChanged = 'debug/hardwareStateChanged';
    export const DualExecutionComparison = 'debug/dualComparison';
    
    // Hardware interaction debugging
    export const PinStateChanged = 'debug/pinStateChanged';
    export const SensorValueChanged = 'debug/sensorValueChanged';
    export const HardwareBreakpointHit = 'debug/hardwareBreakpoint';
}

export interface DeviceConnectionInfo {
    deviceId: string;
    path: string;
    baudRate: number;
    boardId?: string;
    displayName: string;
    confidence: 'high' | 'medium' | 'low';
    connected: boolean;
    lastConnected?: number;
}

export interface DeviceStatus {
    deviceId: string;
    connected: boolean;
    replMode: boolean;
    programRunning: boolean;
    memoryUsage?: {
        used: number;
        free: number;
        total: number;
    };
    storageUsage?: {
        used: number;
        free: number;
        total: number;
    };
    boardInfo?: {
        version: string;
        platform: string;
        modules: string[];
    };
}

export interface FileTransferRequest {
    operation: 'upload' | 'download';
    sourcePath: string;
    destinationPath: string;
    overwrite?: boolean;
}

export interface FileTransferProgress {
    requestId: string;
    operation: 'upload' | 'download';
    progress: number; // 0-100
    bytesTransferred: number;
    totalBytes: number;
    status: 'progress' | 'completed' | 'error';
    error?: string;
}

/**
 * Hardware State Timeline - Tracks hardware changes during code execution
 * This is the key debugging information showing how code affects hardware over time
 */

// TODO: I take it the extension is recording the timestamps, but are we also logging/reading
// ticks from physical hardware (and simulated counterparts) to help 'match up' the chronology?
export class HardwareStateTimeline {
    private events: HardwareEvent[] = [];
    private startTime: number = Date.now();

    addEvent(event: Omit<HardwareEvent, 'timestamp'>): void {
        this.events.push({
            ...event,
            timestamp: Date.now() - this.startTime
        });
    }

    getEvents(): HardwareEvent[] {
        return [...this.events];
    }

    getEventsForPin(pinNumber: number): HardwareEvent[] {
        return this.events.filter(e => e.type === 'pin_change' && e.target === pinNumber);
    }

    getEventsForSensor(sensorId: string): HardwareEvent[] {
        return this.events.filter(e => e.type === 'sensor_reading' && e.target === sensorId);
    }

    getDuration(): number {
        return Date.now() - this.startTime;
    }

    clear(): void {
        this.events = [];
        this.startTime = Date.now();
    }
}

export interface HardwareEvent {
    type: 'pin_change' | 'sensor_reading' | 'actuator_command' | 'communication' | 'breakpoint';
    target: string | number; // pin number, sensor ID, etc.
    previousValue?: null | any;
    newValue: any;
    timestamp: number; // ms since execution started
    codeLocation?: {
        line: number;
        column: number;
    };
}

/**
 * Mu Two Debug Adapter - Runtime-agnostic Debug Adapter Protocol implementation
 *
 * Supports CircuitPython (flagship), MicroPython, and Python runtimes while
 * maintaining consistent debugging interface across all Python variants.
 * It provides:
* - Code execution debugging with real-time hardware state monitoring
* - Device twinning: virtual representation of physical hardware state
* - Hardware interaction visualization as code executes
* - Pin state changes, sensor readings, actuator responses during execution
* - Physical-first state sync: hardware always wins over virtual state
* - Board-aware completions and diagnostics via LSP integration
* 
* The "debug session" here is debugging how your runtime code
* interacts with hardware, not debugging any firmware itself.
 */
export class MuDebugAdapter extends DebugSession {
    private _deviceConnections = new Map<string, DeviceConnectionInfo>();
    private _activeDeviceId?: string;
    private _deviceDetector: MuDeviceDetector;
    private _fileTransferRequests = new Map<string, FileTransferProgress>();

    // Device Twinning Integration
    private _deviceModelFactory: DeviceModelFactory;
    private _boardTemplateGenerator: BoardTemplateGenerator;
    private _deviceTwins = new Map<string, DeviceTwinState>();

    // Hardware Abstraction Layer (replaces device twinning overlap)
    private _wasmRuntimeManager: WasmRuntimeManager;
    private _hardwareAbstractions = new Map<string, IHardwareAbstraction>();
    private _wasmEnvironments = new Map<string, ExecutionEnvironment>();

    // Physical-First State Sync
    private _physicalStateCache = new Map<string, any>();
    private _virtualStateCache = new Map<string, any>();
    private _lastPhysicalSync = 0;

    // Runtime configuration
    private _activeRuntime: 'circuitpython' | 'micropython' | 'python' = 'circuitpython';

    public constructor() {
        super();

        this._deviceDetector = new MuDeviceDetector();
        this._deviceModelFactory = new DeviceModelFactory();
        this._boardTemplateGenerator = new BoardTemplateGenerator();

        // Initialize WASM runtime manager - will be set up properly in initialize method
        this._wasmRuntimeManager = null as any; // Temporary null, will be set in initializeWasmRuntime

        console.log('Mu Debug Adapter initialized with multi-runtime support');
    }

    /**
     * Initialize WASM runtime manager using unified coordinator
     */
    private async initializeWasmRuntime(): Promise<void> {
        if (this._wasmRuntimeManager) {
            return; // Already initialized
        }

        try {
            // Use shared WASM runtime from unified coordinator
            const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
            if (coordinator) {
                this._wasmRuntimeManager = await coordinator.getSharedWasmRuntime();
                console.log('✓ MuDebugAdapter: Using shared WASM runtime from coordinator');
            } else {
                // Fallback: create runtime directly if coordinator not available
                console.warn('MuDebugAdapter: Coordinator not available, creating WASM runtime directly');
                this._wasmRuntimeManager = new WasmRuntimeManager({
                    enableHardwareSimulation: true,
                    debugMode: true
                });
                await this._wasmRuntimeManager.initialize();
                console.log('✓ MuDebugAdapter: WASM runtime initialized directly');
            }
        } catch (error) {
            console.error('MuDebugAdapter: Failed to initialize WASM runtime', error);
            throw error;
        }
    }

    /**
     * Set the active runtime for this debug session
     */
    public async setRuntime(runtime: 'circuitpython' | 'micropython' | 'python'): Promise<void> {
        this._activeRuntime = runtime;

        // Initialize WASM runtime if not already done
        if (!this._wasmRuntimeManager) {
            await this.initializeWasmRuntime();
        }

        console.log(`Debug adapter runtime set to: ${runtime}`);
    }

    /**
     * Get the currently active runtime
     */
    public getRuntime(): 'circuitpython' | 'micropython' | 'python' {
        return this._activeRuntime;
    }
}
