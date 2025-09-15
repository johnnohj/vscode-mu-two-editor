import {
    DebugSession,
    InitializedEvent,
    TerminatedEvent,
    OutputEvent,
    Event
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as vscode from 'vscode';
import { DeviceConfiguration } from './deviceManager';
import { CircuitPythonDeviceDetector, CircuitPythonDevice } from './deviceDetector';
import { DeviceTwinState, BasePinState, SensorState, ActuatorState } from './deviceTwinning/interfaces';
import { DeviceModelFactory } from './deviceTwinning/DeviceModelFactory';
import { BoardTemplateGenerator } from './deviceTwinning/BoardTemplateGenerator';
import { VirtualPin } from '../../views/webview-editor/src/blinka/VirtualPin';
import { Mu2Board } from '../../views/webview-editor/src/blinka/Mu2Board';

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
    mode: 'input' | 'output' | 'pwm' | 'analog';
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
    previousValue?: any;
    newValue: any;
    timestamp: number; // ms since execution started
    codeLocation?: {
        line: number;
        column: number;
    };
}

/**
 * CircuitPython Debug Adapter - Hardware-Aware Code Debugging
 * 
 * This is THE CircuitPython debugger. It provides:
 * - Code execution debugging with real-time hardware state monitoring
 * - Device twinning: virtual representation of physical hardware state
 * - Hardware interaction visualization as code executes
 * - Pin state changes, sensor readings, actuator responses during execution
 * - Physical-first state sync: hardware always wins over virtual state
 * - Board-aware completions and diagnostics via LSP integration
 * 
 * The "debug session" here is debugging how your CircuitPython code 
 * interacts with hardware, not debugging the CircuitPython firmware itself.
 */
export class CircuitPythonDebugAdapter extends DebugSession {
    private _deviceConnections = new Map<string, DeviceConnectionInfo>();
    private _activeDeviceId?: string;
    private _deviceDetector: CircuitPythonDeviceDetector;
    private _fileTransferRequests = new Map<string, FileTransferProgress>();
    
    // Device Twinning Integration
    private _deviceModelFactory: DeviceModelFactory;
    private _boardTemplateGenerator: BoardTemplateGenerator;
    private _deviceTwins = new Map<string, DeviceTwinState>();
    
    // Physical-First State Sync
    private _physicalStateCache = new Map<string, any>();
    private _virtualStateCache = new Map<string, any>();
    private _stateSyncQueue = new Map<string, Promise<boolean>>();
    private _lastSyncTimestamp = new Map<string, number>();
    
    // Performance optimization for sub-250ms sync
    private readonly SYNC_THROTTLE_MS = 50; // 50ms throttle for ultra-responsive sync
    private readonly MAX_QUEUE_SIZE = 100; // Skip to newest if queue gets too large
    private readonly COMPRESSION_THRESHOLD = 10; // Compress state updates after 10 rapid changes
    
    // Environment simulation properties (keeping for compatibility)
    private _environments = new Map<string, ExecutionEnvironment>();
    private _environmentProfiles = new Map<string, EnvironmentProfile>();
    private _simulationTimers = new Map<string, NodeJS.Timeout>();
    
    // Event emitters for device channel
    private _onDeviceConnected = new vscode.EventEmitter<DeviceConnectionInfo>();
    private _onDeviceDisconnected = new vscode.EventEmitter<string>();
    private _onDeviceStatusChanged = new vscode.EventEmitter<DeviceStatus>();
    private _onFileTransferProgress = new vscode.EventEmitter<FileTransferProgress>();
    
    // Enhanced event emitters for device twinning
    private _onEnvironmentCreated = new vscode.EventEmitter<ExecutionEnvironment>();
    private _onSensorDataChanged = new vscode.EventEmitter<{ environmentId: string; sensor: SimulatedSensor }>();
    private _onGPIOStateChanged = new vscode.EventEmitter<{ environmentId: string; gpio: SimulatedGPIO }>();
    private _onDeviceTwinStateChanged = new vscode.EventEmitter<{ deviceId: string; state: DeviceTwinState }>();
    private _onPhysicalDeviceSync = new vscode.EventEmitter<{ deviceId: string; syncType: string; success: boolean }>();

    public readonly onDeviceConnected = this._onDeviceConnected.event;
    public readonly onDeviceDisconnected = this._onDeviceDisconnected.event;
    public readonly onDeviceStatusChanged = this._onDeviceStatusChanged.event;
    public readonly onFileTransferProgress = this._onFileTransferProgress.event;
    public readonly onEnvironmentCreated = this._onEnvironmentCreated.event;
    public readonly onSensorDataChanged = this._onSensorDataChanged.event;
    public readonly onGPIOStateChanged = this._onGPIOStateChanged.event;
    public readonly onDeviceTwinStateChanged = this._onDeviceTwinStateChanged.event;
    public readonly onPhysicalDeviceSync = this._onPhysicalDeviceSync.event;

    constructor(context?: vscode.ExtensionContext) {
        super();
        this._deviceDetector = new CircuitPythonDeviceDetector();
        this._deviceModelFactory = new DeviceModelFactory();
        this._boardTemplateGenerator = new BoardTemplateGenerator(context!);
        
        this.setupPhysicalFirstSyncHandlers();
        this.setupDeviceChannelHandlers();
        this.initializeEnvironmentProfiles();
    }

    protected initializeRequest(
        response: DebugProtocol.InitializeResponse,
        args: DebugProtocol.InitializeRequestArguments
    ): void {
        // Call parent initialization
        super.initializeRequest(response, args);

        // Add device channel capabilities
        if (response.body) {
            response.body.supportsDeviceChannel = true;
            response.body.supportsFileOperations = true;
            response.body.supportsDeviceManagement = true;
            response.body.supportsLibrarySync = true;
        }
    }

    private setupDeviceChannelHandlers(): void {
        // Device connection management
        this.setupDeviceConnectionHandlers();
        
        // File system operations
        this.setupFileSystemHandlers();
        
        // Device information and status
        this.setupDeviceStatusHandlers();
        
        // Library management
        this.setupLibraryHandlers();
    }

    private setupDeviceConnectionHandlers(): void {
        // Connect device handler
        this.onRequest(DeviceChannelRequests.ConnectDevice, async (args: {
            path?: string;
            baudRate?: number;
            autoDetect?: boolean;
        }) => {
            try {
                let device: CircuitPythonDevice | null = null;

                if (args.autoDetect || !args.path) {
                    device = await this._deviceDetector.getBestDevice();
                    if (!device) {
                        throw new Error('No CircuitPython devices found');
                    }
                } else {
                    const detectionResult = await this._deviceDetector.detectDevices();
                    device = detectionResult.devices.find(d => d.path === args.path) || null;
                    if (!device) {
                        throw new Error(`Device not found at path: ${args.path}`);
                    }
                }

                const deviceId = this.generateDeviceId(device);
                const connectionInfo: DeviceConnectionInfo = {
                    deviceId,
                    path: device.path,
                    baudRate: args.baudRate || 115200,
                    boardId: device.boardId,
                    displayName: device.displayName,
                    confidence: device.confidence,
                    connected: false,
                    lastConnected: Date.now()
                };

                // Perform the actual connection (reuse parent logic)
                const config: CircuitPythonLaunchRequestArguments = {
                    name: `Device Channel: ${device.displayName}`,
                    type: 'circuitpython',
                    request: 'attach',
                    port: device.path,
                    baudRate: connectionInfo.baudRate,
                    enableRepl: false // Device channel doesn't handle REPL text
                };

                // Use parent's connection logic but track separately
                await this.connectToDevice(config);
                
                connectionInfo.connected = true;
                this._deviceConnections.set(deviceId, connectionInfo);
                this._activeDeviceId = deviceId;

                // Notify about connection
                this.sendNotification(DeviceChannelNotifications.DeviceConnected, connectionInfo);
                this._onDeviceConnected.fire(connectionInfo);

                return { success: true, deviceId, connectionInfo };
            } catch (error) {
                this.sendNotification(DeviceChannelNotifications.DeviceError, {
                    error: error instanceof Error ? error.message : String(error),
                    operation: 'connect'
                });
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });

        // Disconnect device handler
        this.onRequest(DeviceChannelRequests.DisconnectDevice, async (args: { deviceId: string }) => {
            try {
                const connection = this._deviceConnections.get(args.deviceId);
                if (!connection) {
                    throw new Error(`Device not found: ${args.deviceId}`);
                }

                // Perform disconnection
                await this.disconnectFromDevice();
                
                connection.connected = false;
                this._deviceConnections.set(args.deviceId, connection);
                
                if (this._activeDeviceId === args.deviceId) {
                    this._activeDeviceId = undefined;
                }

                // Notify about disconnection
                this.sendNotification(DeviceChannelNotifications.DeviceDisconnected, { deviceId: args.deviceId });
                this._onDeviceDisconnected.fire(args.deviceId);

                return { success: true };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });

        // List devices handler
        this.onRequest(DeviceChannelRequests.ListDevices, async () => {
            try {
                const detectionResult = await this._deviceDetector.detectDevices();
                return {
                    success: true,
                    devices: detectionResult.devices.map(device => ({
                        path: device.path,
                        displayName: device.displayName,
                        boardId: device.boardId,
                        confidence: device.confidence,
                        hasConflict: device.hasConflict
                    })),
                    totalDevices: detectionResult.totalDevices,
                    circuitPythonDevices: detectionResult.circuitPythonDevices
                };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
    }

    private setupFileSystemHandlers(): void {
        // Transfer file handler
        this.onRequest(DeviceChannelRequests.TransferFile, async (args: FileTransferRequest) => {
            const requestId = this.generateRequestId();
            
            try {
                if (!this._activeDeviceId) {
                    throw new Error('No active device connection');
                }

                const progress: FileTransferProgress = {
                    requestId,
                    operation: args.operation,
                    progress: 0,
                    bytesTransferred: 0,
                    totalBytes: 0,
                    status: 'progress'
                };

                this._fileTransferRequests.set(requestId, progress);

                if (args.operation === 'upload') {
                    await this.uploadFile(args.sourcePath, args.destinationPath, requestId);
                } else {
                    await this.downloadFile(args.sourcePath, args.destinationPath, requestId);
                }

                progress.status = 'completed';
                progress.progress = 100;
                this.updateFileTransferProgress(progress);

                return { success: true, requestId };
            } catch (error) {
                const progress = this._fileTransferRequests.get(requestId);
                if (progress) {
                    progress.status = 'error';
                    progress.error = error instanceof Error ? error.message : String(error);
                    this.updateFileTransferProgress(progress);
                }
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });

        // List files handler
        this.onRequest(DeviceChannelRequests.ListFiles, async (args: { path?: string }) => {
            try {
                if (!this._activeDeviceId) {
                    throw new Error('No active device connection');
                }

                // For now, return mock data - in real implementation, this would
                // communicate with the device to list files
                const files = await this.listDeviceFiles(args.path || '/');
                return { success: true, files };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });

        // Create directory handler
        this.onRequest(DeviceChannelRequests.CreateDirectory, async (args: { path: string }) => {
            try {
                if (!this._activeDeviceId) {
                    throw new Error('No active device connection');
                }

                await this.createDeviceDirectory(args.path);
                return { success: true };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });

        // Delete file handler
        this.onRequest(DeviceChannelRequests.DeleteFile, async (args: { path: string }) => {
            try {
                if (!this._activeDeviceId) {
                    throw new Error('No active device connection');
                }

                await this.deleteDeviceFile(args.path);
                return { success: true };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
    }

    private setupDeviceStatusHandlers(): void {
        // Get device status handler
        this.onRequest(DeviceChannelRequests.GetDeviceStatus, async (args: { deviceId: string }) => {
            try {
                const connection = this._deviceConnections.get(args.deviceId);
                if (!connection) {
                    throw new Error(`Device not found: ${args.deviceId}`);
                }

                const status = await this.getDeviceStatus(args.deviceId);
                return { success: true, status };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });

        // Soft reboot handler
        this.onRequest(DeviceChannelRequests.SoftReboot, async (args: { deviceId: string }) => {
            try {
                if (!this._activeDeviceId || this._activeDeviceId !== args.deviceId) {
                    throw new Error('Device not connected or not active');
                }

                await this.performSoftReboot();
                return { success: true };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });

        // Get board info handler
        this.onRequest(DeviceChannelRequests.GetBoardInfo, async (args: { deviceId: string }) => {
            try {
                const connection = this._deviceConnections.get(args.deviceId);
                if (!connection) {
                    throw new Error(`Device not found: ${args.deviceId}`);
                }

                const boardInfo = await this.getBoardInfo(args.deviceId);
                return { success: true, boardInfo };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
    }

    private setupLibraryHandlers(): void {
        // Sync libraries handler
        this.onRequest(DeviceChannelRequests.SyncLibraries, async (args: {
            deviceId: string;
            libraries: string[];
            removeUnused?: boolean;
        }) => {
            try {
                if (!this._activeDeviceId || this._activeDeviceId !== args.deviceId) {
                    throw new Error('Device not connected or not active');
                }

                await this.syncLibraries(args.libraries, args.removeUnused);
                return { success: true };
            } catch (error) {
                return { success: false, error: error instanceof Error ? error.message : String(error) };
            }
        });
    }

    // Device operation implementations
    private async connectToDevice(config: CircuitPythonLaunchRequestArguments): Promise<void> {
        // Use parent's attach logic but don't start debug session
        // This is a simplified connection for device channel only
        return new Promise((resolve, reject) => {
            // Implementation would establish serial connection
            // without full debug session overhead
            setTimeout(() => resolve(), 100); // Mock implementation
        });
    }

    private async disconnectFromDevice(): Promise<void> {
        // Implementation would close serial connection
        return Promise.resolve();
    }

    private async uploadFile(sourcePath: string, destinationPath: string, requestId: string): Promise<void> {
        // Mock implementation - real version would transfer file via serial
        const progress = this._fileTransferRequests.get(requestId);
        if (!progress) return;

        // Simulate file transfer progress
        for (let i = 0; i <= 100; i += 10) {
            progress.progress = i;
            progress.bytesTransferred = (i / 100) * 1000; // Mock 1KB file
            progress.totalBytes = 1000;
            this.updateFileTransferProgress(progress);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    private async downloadFile(sourcePath: string, destinationPath: string, requestId: string): Promise<void> {
        // Similar to uploadFile but in reverse
        const progress = this._fileTransferRequests.get(requestId);
        if (!progress) return;

        for (let i = 0; i <= 100; i += 10) {
            progress.progress = i;
            progress.bytesTransferred = (i / 100) * 1000;
            progress.totalBytes = 1000;
            this.updateFileTransferProgress(progress);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    private async listDeviceFiles(path: string): Promise<any[]> {
        // Mock implementation - real version would query device
        return [
            { name: 'boot.py', type: 'file', size: 512, modified: Date.now() },
            { name: 'code.py', type: 'file', size: 1024, modified: Date.now() },
            { name: 'lib', type: 'directory', size: 0, modified: Date.now() }
        ];
    }

    private async createDeviceDirectory(path: string): Promise<void> {
        // Implementation would create directory on device
        return Promise.resolve();
    }

    private async deleteDeviceFile(path: string): Promise<void> {
        // Implementation would delete file on device
        return Promise.resolve();
    }

    private async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
        const connection = this._deviceConnections.get(deviceId);
        if (!connection) {
            throw new Error(`Device not found: ${deviceId}`);
        }

        // Mock implementation - real version would query device
        return {
            deviceId,
            connected: connection.connected,
            replMode: false, // Device channel doesn't manage REPL
            programRunning: false,
            memoryUsage: {
                used: 15000,
                free: 50000,
                total: 65000
            },
            storageUsage: {
                used: 1024000,
                free: 512000,
                total: 1536000
            }
        };
    }

    private async performSoftReboot(): Promise<void> {
        // Implementation would send Ctrl+D to device
        return Promise.resolve();
    }

    private async getBoardInfo(deviceId: string): Promise<any> {
        // Mock implementation - real version would query device
        return {
            version: '8.0.0',
            platform: 'CircuitPython',
            modules: ['board', 'digitalio', 'analogio', 'time', 'gc']
        };
    }

    private async syncLibraries(libraries: string[], removeUnused?: boolean): Promise<void> {
        // Implementation would sync libraries to device
        for (const library of libraries) {
            this.sendNotification(DeviceChannelNotifications.LibrarySyncProgress, {
                library,
                status: 'downloading'
            });
            
            await new Promise(resolve => setTimeout(resolve, 100));
            
            this.sendNotification(DeviceChannelNotifications.LibrarySyncProgress, {
                library,
                status: 'completed'
            });
        }
    }

    private updateFileTransferProgress(progress: FileTransferProgress): void {
        this.sendNotification(DeviceChannelNotifications.FileTransferProgress, progress);
        this._onFileTransferProgress.fire(progress);
    }

    private generateDeviceId(device: CircuitPythonDevice): string {
        return `device_${device.path.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`;
    }

    private generateRequestId(): string {
        return `request_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private onRequest(type: string, handler: (args: any) => Promise<any>): void {
        // This would be implemented by the debug adapter framework
        // For now, it's a placeholder for the enhanced request handling
    }

    private sendNotification(type: string, data: any): void {
        // This would send notifications via the debug adapter protocol
        this.sendEvent(new OutputEvent(`${type}: ${JSON.stringify(data)}\n`, 'console'));
    }

    public getActiveDeviceId(): string | undefined {
        return this._activeDeviceId;
    }

    public getDeviceConnections(): DeviceConnectionInfo[] {
        return Array.from(this._deviceConnections.values());
    }

    // === Environment Simulation Methods ===

    /**
     * Initialize default environment profiles
     */
    private initializeEnvironmentProfiles(): void {
        // Default CircuitPython board profile
        const defaultProfile: EnvironmentProfile = {
            id: 'circuitpython_default',
            name: 'CircuitPython Default Board',
            description: 'Standard CircuitPython microcontroller with common sensors',
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
                boardId: 'simulated_board',
                displayName: 'Simulated CircuitPython Board',
                pinCount: 20,
                voltage: 3.3,
                features: ['GPIO', 'PWM', 'I2C', 'SPI', 'UART']
            },
            mockData: {
                enableRealisticData: true,
                updateInterval: 1000,
                variationRange: 0.1
            }
        };

        this._environmentProfiles.set(defaultProfile.id, defaultProfile);
    }

    /**
     * Create a new execution environment
     */
    public async createEnvironment(type: 'physical' | 'simulated', deviceId: string, profileId?: string): Promise<ExecutionEnvironment> {
        const environment: ExecutionEnvironment = {
            type,
            deviceId,
            capabilities: {
                hasFileSystem: true,
                hasRepl: true,
                canExecuteCode: true,
                supportsHardwareAccess: type === 'physical'
            }
        };

        if (type === 'simulated' && profileId) {
            environment.profile = this._environmentProfiles.get(profileId);
            if (environment.profile) {
                this.startEnvironmentSimulation(deviceId, environment.profile);
            }
        }

        this._environments.set(deviceId, environment);
        this._onEnvironmentCreated.fire(environment);
        this.sendNotification(DeviceChannelNotifications.EnvironmentCreated, environment);

        return environment;
    }

    /**
     * Start environment simulation with realistic data
     */
    private startEnvironmentSimulation(environmentId: string, profile: EnvironmentProfile): void {
        if (!profile.mockData.enableRealisticData) {
            return;
        }

        const timer = setInterval(() => {
            profile.sensors.forEach(sensor => {
                if (sensor.isActive) {
                    // Generate realistic sensor data with variation
                    const variation = (Math.random() - 0.5) * 2 * profile.mockData.variationRange;
                    const baseValue = (sensor.range.min + sensor.range.max) / 2;
                    sensor.value = Math.max(sensor.range.min, Math.min(sensor.range.max, baseValue + variation * baseValue));
                    sensor.lastUpdated = Date.now();

                    this._onSensorDataChanged.fire({ environmentId, sensor });
                    this.sendNotification(DeviceChannelNotifications.SensorDataChanged, { environmentId, sensor });
                }
            });
        }, profile.mockData.updateInterval);

        this._simulationTimers.set(environmentId, timer);
    }

    /**
     * Update sensor value in simulated environment
     */
    public updateSensorValue(environmentId: string, sensorId: string, value: number): boolean {
        const environment = this._environments.get(environmentId);
        if (!environment?.profile) {
            return false;
        }

        const sensor = environment.profile.sensors.find(s => s.id === sensorId);
        if (sensor && value >= sensor.range.min && value <= sensor.range.max) {
            sensor.value = value;
            sensor.lastUpdated = Date.now();
            
            this._onSensorDataChanged.fire({ environmentId, sensor });
            this.sendNotification(DeviceChannelNotifications.SensorDataChanged, { environmentId, sensor });
            return true;
        }

        return false;
    }

    /**
     * Update GPIO state in simulated environment
     */
    public updateGPIOState(environmentId: string, pin: number, value: number | boolean, mode?: 'input' | 'output' | 'pwm' | 'analog'): boolean {
        const environment = this._environments.get(environmentId);
        if (!environment?.profile) {
            return false;
        }

        const gpio = environment.profile.gpios.find(g => g.pin === pin);
        if (gpio) {
            gpio.value = value;
            if (mode) {
                gpio.mode = mode;
            }
            gpio.lastChanged = Date.now();
            
            this._onGPIOStateChanged.fire({ environmentId, gpio });
            this.sendNotification(DeviceChannelNotifications.GPIOStateChanged, { environmentId, gpio });
            return true;
        }

        return false;
    }

    /**
     * Execute code in environment (with mocking if simulated)
     */
    public async executeCodeInEnvironment(environmentId: string, code: string): Promise<{ success: boolean; output?: string; error?: string }> {
        const environment = this._environments.get(environmentId);
        if (!environment) {
            return { success: false, error: 'Environment not found' };
        }

        try {
            let result: any;

            if (environment.type === 'simulated') {
                // Mock execution with simulated hardware responses
                result = await this.executeInSimulatedEnvironment(environment, code);
            } else {
                // Execute on physical device
                result = await this.executeOnPhysicalDevice(environmentId, code);
            }

            this.sendNotification(DeviceChannelNotifications.CodeExecutionResult, {
                environmentId,
                success: result.success,
                output: result.output,
                error: result.error
            });

            return result;
        } catch (error) {
            const errorResult = { success: false, error: error instanceof Error ? error.message : String(error) };
            this.sendNotification(DeviceChannelNotifications.CodeExecutionResult, {
                environmentId,
                ...errorResult
            });
            return errorResult;
        }
    }

    /**
     * Execute code in simulated environment with hardware mocking
     */
    private async executeInSimulatedEnvironment(environment: ExecutionEnvironment, code: string): Promise<any> {
        // This would implement a Python interpreter with mocked hardware
        // For now, return mock responses for common CircuitPython patterns

        if (code.includes('import board')) {
            return { success: true, output: 'Imported simulated board module' };
        }

        if (code.includes('temperature')) {
            const tempSensor = environment.profile?.sensors.find(s => s.type === 'temperature');
            return { 
                success: true, 
                output: `Temperature: ${tempSensor?.value || 22.5}°C` 
            };
        }

        if (code.includes('digitalio') || code.includes('GPIO')) {
            return { success: true, output: 'GPIO operation simulated' };
        }

        // Default mock execution
        return { 
            success: true, 
            output: `Mock execution completed: ${code.substring(0, 50)}${code.length > 50 ? '...' : ''}` 
        };
    }

    /**
     * Execute code on physical device
     */
    private async executeOnPhysicalDevice(environmentId: string, code: string): Promise<any> {
        // This would send code to the actual device via serial connection
        // For now, return a placeholder
        return { success: true, output: 'Executed on physical device' };
    }

    /**
     * Get environment by device ID
     */
    public getEnvironment(deviceId: string): ExecutionEnvironment | undefined {
        return this._environments.get(deviceId);
    }

    /**
     * Get all available environment profiles
     */
    public getEnvironmentProfiles(): EnvironmentProfile[] {
        return Array.from(this._environmentProfiles.values());
    }

    /**
     * Stop environment simulation
     */
    private stopEnvironmentSimulation(environmentId: string): void {
        const timer = this._simulationTimers.get(environmentId);
        if (timer) {
            clearInterval(timer);
            this._simulationTimers.delete(environmentId);
        }
    }

    // === Hardware-Aware Code Execution (The Core Debug Experience) ===

    /**
     * Execute CircuitPython code with real-time hardware state monitoring
     * This is the primary debug interface - watch how your code affects hardware
     */
    async executeCodeWithHardwareMonitoring(request: {
        code: string;
        fileName?: string;
        deviceId?: string;
        enableStepThroughMode?: boolean;
        watchPins?: number[];
        watchSensors?: string[];
        timeout?: number;
    }): Promise<{
        success: boolean;
        executionTime: number;
        output: string;
        error?: string;
        hardwareTimeline: HardwareStateTimeline;
        finalHardwareState: any;
    }> {
        try {
            const deviceId = request.deviceId || this._activeDeviceId;
            if (!deviceId) {
                throw new Error('No active device for code execution');
            }

            // Start hardware state monitoring
            const timeline = new HardwareStateTimeline();
            this.startHardwareStateCapture(deviceId, timeline, request.watchPins, request.watchSensors);

            // Notify debug clients that execution started
            this.sendNotification(DeviceChannelNotifications.CodeExecutionStarted, {
                deviceId,
                code: request.code,
                timestamp: Date.now()
            });

            const startTime = Date.now();
            
            // Execute code on physical device with monitoring
            const replInterface = this.getReplInterface(deviceId);
            let output = '';
            let error = undefined;
            
            try {
                if (request.enableStepThroughMode) {
                    // Execute line-by-line, capturing hardware state at each step
                    output = await this.executeCodeStepByStep(replInterface, request.code, timeline);
                } else {
                    // Execute normally, but capture hardware state changes
                    output = await this.executeCodeWithMonitoring(replInterface, request.code, timeline);
                }
            } catch (executionError) {
                error = executionError instanceof Error ? executionError.message : String(executionError);
            }

            const executionTime = Date.now() - startTime;
            
            // Stop monitoring and get final state
            const finalHardwareState = await this.stopHardwareStateCapture(deviceId);
            
            const result = {
                success: !error,
                executionTime,
                output,
                error,
                hardwareTimeline: timeline,
                finalHardwareState
            };

            // Notify debug clients of completion
            this.sendNotification(DeviceChannelNotifications.CodeExecutionComplete, {
                deviceId,
                result,
                timestamp: Date.now()
            });

            // Update device twin with final state (physical-first)
            await this.updateDeviceTwinFromHardwareState(deviceId, finalHardwareState);

            return result;

        } catch (error) {
            console.error('Hardware-monitored code execution failed:', error);
            return {
                success: false,
                executionTime: 0,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                hardwareTimeline: new HardwareStateTimeline(),
                finalHardwareState: {}
            };
        }
    }

    /**
     * Execute code on both physical and simulated hardware, compare results
     * Educational debugging: understand differences between real and simulated hardware
     */
    async executeDualHardwareComparison(request: {
        code: string;
        deviceId?: string;
        boardTemplate?: any;
        timeout?: number;
    }): Promise<{
        physicalExecution: any;
        simulatedExecution: any;
        comparison: {
            outputMatch: boolean;
            timingDifference: number;
            hardwareStateDifferences: string[];
            recommendations: string[];
        };
    }> {
        try {
            const deviceId = request.deviceId || this._activeDeviceId;
            if (!deviceId) {
                throw new Error('No active device for dual execution');
            }

            // Execute on physical hardware with monitoring
            const physicalPromise = this.executeCodeWithHardwareMonitoring({
                code: request.code,
                deviceId,
                timeout: request.timeout
            });

            // Execute on simulated hardware (using existing environment simulation)
            const simulatedPromise = this.executeInSimulatedEnvironment({
                type: 'simulated',
                deviceId,
                profile: this.getEnvironmentProfileForDevice(deviceId)
            }, request.code);

            // Run both in parallel
            const [physicalResult, simulatedResult] = await Promise.all([
                physicalPromise,
                simulatedPromise
            ]);

            // Compare results
            const comparison = this.compareHardwareExecutions(physicalResult, simulatedResult);

            const dualResult = {
                physicalExecution: physicalResult,
                simulatedExecution: simulatedResult,
                comparison
            };

            // Emit comparison event for educational insights
            this.sendNotification(DeviceChannelNotifications.DualExecutionComparison, dualResult);

            return dualResult;

        } catch (error) {
            console.error('Dual execution comparison failed:', error);
            throw error;
        }
    }

    /**
     * Set hardware breakpoints - pause execution when specific hardware conditions are met
     * E.g., "break when pin D13 goes HIGH", "break when temperature > 30°C"
     */
    async setHardwareBreakpoint(request: {
        deviceId?: string;
        type: 'pin_state' | 'sensor_threshold' | 'pin_change' | 'time_delay';
        target: string | number; // pin number or sensor ID
        condition: any; // condition to break on
        enabled: boolean;
    }): Promise<{ success: boolean; breakpointId?: string }> {
        try {
            const deviceId = request.deviceId || this._activeDeviceId;
            if (!deviceId) {
                throw new Error('No active device for hardware breakpoint');
            }

            // Create hardware breakpoint
            const breakpointId = `hw_bp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            
            // Store breakpoint for monitoring during execution
            this.addHardwareBreakpoint(deviceId, breakpointId, request);
            
            return { success: true, breakpointId };

        } catch (error) {
            console.error('Failed to set hardware breakpoint:', error);
            return { success: false };
        }
    }

    // === Device Twinning Integration Methods (Hardware State as Debug Info) ===

    /**
     * Associate a board with workspace and generate template on-demand
     */
    async associateBoardWithWorkspace(deviceId: string, boardId: string): Promise<boolean> {
        try {
            const connection = this._deviceConnections.get(deviceId);
            if (!connection?.connected) {
                throw new Error('Device not connected');
            }

            // Generate board template using REPL introspection
            vscode.window.showInformationMessage('Analyzing board capabilities via REPL...');
            
            const template = await this._boardTemplateGenerator.generateBoardTemplate(
                boardId, 
                connection.path, 
                this.getReplInterface(deviceId)
            );

            if (!template) {
                throw new Error('Failed to generate board template');
            }

            // Register template with device model factory
            this._deviceModelFactory.registerTemplate(template);

            // Create device twin
            const deviceTwin = await this._deviceModelFactory.createDeviceTwin(
                boardId, 
                deviceId, 
                {
                    enableSimulation: false, // Physical device takes priority
                    autoConnect: true
                }
            );

            this._deviceTwins.set(deviceId, deviceTwin);

            // Initialize physical-first sync
            await this.startPhysicalDeviceSync(deviceId);

            vscode.window.showInformationMessage(`Board ${boardId} associated with workspace`);
            return true;

        } catch (error) {
            console.error('Board association failed:', error);
            vscode.window.showErrorMessage(`Failed to associate board: ${error}`);
            return false;
        }
    }

    /**
     * Setup physical-first synchronization handlers
     */
    private setupPhysicalFirstSyncHandlers(): void {
        // Monitor physical device state changes and propagate to virtual twin
        this.startPhysicalStateMonitoring();
        
        // Handle virtual state change requests (validate against physical first)
        this.setupVirtualStateValidation();
    }

    /**
     * Start monitoring physical device state changes
     */
    private startPhysicalStateMonitoring(): void {
        setInterval(async () => {
            for (const [deviceId, twin] of this._deviceTwins) {
                if (twin.isConnected) {
                    try {
                        // Query physical device state
                        const physicalState = await this.queryPhysicalDeviceState(deviceId);
                        if (physicalState) {
                            await this.syncPhysicalToVirtual(deviceId, physicalState);
                        }
                    } catch (error) {
                        console.warn(`Physical state monitoring failed for ${deviceId}:`, error);
                    }
                }
            }
        }, this.SYNC_THROTTLE_MS); // Ultra-responsive 50ms polling
    }

    /**
     * Query current state from physical device
     */
    private async queryPhysicalDeviceState(deviceId: string): Promise<any | null> {
        try {
            const replInterface = this.getReplInterface(deviceId);
            if (!replInterface) {
                return null;
            }

            // Quick state query commands - optimized for speed
            const stateQuery = `
import board
import json
try:
    # Quick digital pin state check (only changed pins)
    changed_pins = {}
    
    # Quick sensor readings (if available)
    sensors = {}
    
    # Minimal state response
    state = {"pins": changed_pins, "sensors": sensors, "timestamp": ${Date.now()}}
    print("DEVICE_STATE:" + json.dumps(state))
except:
    pass
`;

            const output = await this.executeReplCommandFast(replInterface, stateQuery);
            return this.parseDeviceStateResponse(output);

        } catch (error) {
            console.warn('Physical state query failed:', error);
            return null;
        }
    }

    /**
     * Fast REPL command execution (sub-100ms target)
     */
    private async executeReplCommandFast(replInterface: any, command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Fast REPL timeout'));
            }, 200); // 200ms max for ultra-responsive sync

            let output = '';
            const onOutput = (data: string) => {
                output += data;
                if (output.includes('DEVICE_STATE:')) {
                    clearTimeout(timeout);
                    replInterface.removeListener('output', onOutput);
                    resolve(output);
                }
            };

            replInterface.on('output', onOutput);
            replInterface.send(command);
        });
    }

    /**
     * Parse device state response from REPL
     */
    private parseDeviceStateResponse(output: string): any | null {
        try {
            const match = output.match(/DEVICE_STATE:(.+)/);
            if (match) {
                return JSON.parse(match[1]);
            }
        } catch (error) {
            console.warn('Failed to parse device state response:', error);
        }
        return null;
    }

    /**
     * Sync physical device state to virtual twin (Physical-First principle)
     */
    private async syncPhysicalToVirtual(deviceId: string, physicalState: any): Promise<boolean> {
        try {
            const deviceTwin = this._deviceTwins.get(deviceId);
            if (!deviceTwin) {
                return false;
            }

            // Check for throttling - allow rapid updates but compress when needed
            const lastSync = this._lastSyncTimestamp.get(deviceId) || 0;
            const now = Date.now();
            
            // Skip sync if too rapid and queue isn't full
            const existingQueue = this._stateSyncQueue.get(deviceId);
            if (existingQueue && (now - lastSync) < this.SYNC_THROTTLE_MS) {
                return await existingQueue; // Return existing sync promise
            }

            // Create sync promise
            const syncPromise = this.performPhysicalToVirtualSync(deviceId, physicalState, deviceTwin);
            this._stateSyncQueue.set(deviceId, syncPromise);

            const success = await syncPromise;
            
            if (success) {
                this._lastSyncTimestamp.set(deviceId, now);
                this._physicalStateCache.set(deviceId, physicalState);
                
                // Emit state change event
                this._onDeviceTwinStateChanged.fire({ deviceId, state: deviceTwin });
                this._onPhysicalDeviceSync.fire({ deviceId, syncType: 'physical_to_virtual', success: true });
            }

            this._stateSyncQueue.delete(deviceId);
            return success;

        } catch (error) {
            console.error('Physical to virtual sync failed:', error);
            this._onPhysicalDeviceSync.fire({ deviceId, syncType: 'physical_to_virtual', success: false });
            return false;
        }
    }

    /**
     * Perform the actual physical-to-virtual synchronization
     */
    private async performPhysicalToVirtualSync(
        deviceId: string, 
        physicalState: any, 
        deviceTwin: DeviceTwinState
    ): Promise<boolean> {
        let hasChanges = false;

        try {
            // Sync pin states
            if (physicalState.pins) {
                for (const [pinId, pinState] of Object.entries(physicalState.pins)) {
                    const pinNumber = parseInt(pinId);
                    
                    // Update digital pin state
                    const digitalPin = deviceTwin.digitalPins.get(pinNumber);
                    if (digitalPin && this.hasDigitalPinChanged(digitalPin, pinState)) {
                        digitalPin.value = (pinState as any).value;
                        digitalPin.mode = (pinState as any).mode;
                        digitalPin.lastChanged = Date.now();
                        hasChanges = true;
                    }
                    
                    // Update analog pin state
                    const analogPin = deviceTwin.analogPins.get(pinNumber);
                    if (analogPin && this.hasAnalogPinChanged(analogPin, pinState)) {
                        analogPin.value = (pinState as any).value;
                        analogPin.lastChanged = Date.now();
                        hasChanges = true;
                    }
                }
            }

            // Sync sensor readings
            if (physicalState.sensors) {
                for (const [sensorId, sensorData] of Object.entries(physicalState.sensors)) {
                    const sensor = deviceTwin.sensors.get(sensorId);
                    if (sensor && this.hasSensorChanged(sensor, sensorData)) {
                        (sensor as any).value = (sensorData as any).value;
                        sensor.lastReading = Date.now();
                        hasChanges = true;
                    }
                }
            }

            if (hasChanges) {
                deviceTwin.lastSync = Date.now();
            }

            return true;

        } catch (error) {
            console.error('Physical sync operation failed:', error);
            return false;
        }
    }

    /**
     * Setup virtual state validation (virtual changes must be confirmed by physical)
     */
    private setupVirtualStateValidation(): void {
        // When virtual state changes are requested, validate with physical device first
        this._onGPIOStateChanged.event((event) => {
            this.validateVirtualStateChange(event.environmentId, 'gpio', event.gpio);
        });

        this._onSensorDataChanged.event((event) => {
            this.validateVirtualStateChange(event.environmentId, 'sensor', event.sensor);
        });
    }

    /**
     * Validate virtual state changes against physical device
     */
    private async validateVirtualStateChange(deviceId: string, type: string, change: any): Promise<boolean> {
        try {
            // Don't validate if device is in simulation mode
            const deviceTwin = this._deviceTwins.get(deviceId);
            if (!deviceTwin || deviceTwin.simulation.isSimulated) {
                return true; // Allow virtual changes in simulation mode
            }

            if (type === 'gpio') {
                return await this.validateGPIOChange(deviceId, change);
            } else if (type === 'sensor') {
                return await this.validateSensorChange(deviceId, change);
            }

            return false;

        } catch (error) {
            console.error('Virtual state validation failed:', error);
            return false;
        }
    }

    /**
     * Validate GPIO changes against physical device
     */
    private async validateGPIOChange(deviceId: string, gpioChange: any): Promise<boolean> {
        try {
            const replInterface = this.getReplInterface(deviceId);
            if (!replInterface) {
                return false;
            }

            // Send GPIO command to physical device and wait for confirmation
            const gpioCommand = `
import digitalio
import board
try:
    pin = getattr(board, 'GPIO${gpioChange.pin}', getattr(board, 'D${gpioChange.pin}', None))
    if pin:
        gpio = digitalio.DigitalInOut(pin)
        gpio.direction = digitalio.Direction.${gpioChange.mode.toUpperCase()}
        if gpio.direction == digitalio.Direction.OUTPUT:
            gpio.value = ${gpioChange.value}
        print("GPIO_CONFIRM:" + str(gpio.value))
        gpio.deinit()
    else:
        print("GPIO_ERROR:Pin not found")
except Exception as e:
    print("GPIO_ERROR:" + str(e))
`;

            const output = await this.executeReplCommandFast(replInterface, gpioCommand);
            return output.includes('GPIO_CONFIRM:' + gpioChange.value);

        } catch (error) {
            console.error('GPIO validation failed:', error);
            return false;
        }
    }

    /**
     * Validate sensor changes (mostly read-only, but validate sensor exists)
     */
    private async validateSensorChange(deviceId: string, sensorChange: any): Promise<boolean> {
        // For sensors, we mainly validate that the sensor exists and is readable
        // Physical device is the authoritative source for sensor readings
        return true; // Physical readings always take priority
    }

    /**
     * Helper methods for detecting state changes
     */
    private hasDigitalPinChanged(currentPin: any, newState: any): boolean {
        return currentPin.value !== newState.value || currentPin.mode !== newState.mode;
    }

    private hasAnalogPinChanged(currentPin: any, newState: any): boolean {
        return Math.abs(currentPin.value - newState.value) > 1; // Ignore tiny fluctuations
    }

    private hasSensorChanged(currentSensor: any, newData: any): boolean {
        return Math.abs(currentSensor.value - newData.value) > (currentSensor.accuracy || 0.1);
    }

    /**
     * Start physical device sync for a specific device
     */
    private async startPhysicalDeviceSync(deviceId: string): Promise<void> {
        // Initialize sync state
        this._physicalStateCache.set(deviceId, {});
        this._virtualStateCache.set(deviceId, {});
        this._lastSyncTimestamp.set(deviceId, Date.now());
        
        console.log(`Physical-first sync started for device: ${deviceId}`);
    }

    /**
     * Get REPL interface for device (mock for now - would integrate with actual REPL)
     */
    private getReplInterface(deviceId: string): any {
        // This would return the actual REPL interface for the device
        // For now, return a mock object
        return {
            send: (command: string) => console.log('REPL send:', command),
            on: (event: string, callback: Function) => {},
            removeListener: (event: string, callback: Function) => {}
        };
    }

    // === Enhanced Device Twin Management ===

    /**
     * Get device twin state
     */
    getDeviceTwin(deviceId: string): DeviceTwinState | null {
        return this._deviceTwins.get(deviceId) || null;
    }

    /**
     * Update device twin with physical-first validation
     */
    async updateDeviceTwin(deviceId: string, updates: Partial<DeviceTwinState>): Promise<boolean> {
        const deviceTwin = this._deviceTwins.get(deviceId);
        if (!deviceTwin) {
            return false;
        }

        // For physical devices, validate changes against hardware
        if (!deviceTwin.simulation.isSimulated) {
            const validationResults = await Promise.all([
                this.validatePhysicalCapabilities(deviceId, updates),
                this.confirmPhysicalState(deviceId, updates)
            ]);

            if (!validationResults.every(result => result)) {
                console.warn('Device twin update failed physical validation');
                return false;
            }
        }

        // Apply updates
        Object.assign(deviceTwin, updates);
        deviceTwin.lastSync = Date.now();

        this._onDeviceTwinStateChanged.fire({ deviceId, state: deviceTwin });
        return true;
    }

    /**
     * Validate that updates are within physical device capabilities
     */
    private async validatePhysicalCapabilities(deviceId: string, updates: Partial<DeviceTwinState>): Promise<boolean> {
        // Check pin assignments, sensor ranges, etc.
        return true; // Simplified for now
    }

    /**
     * Confirm physical state matches requested updates
     */
    private async confirmPhysicalState(deviceId: string, updates: Partial<DeviceTwinState>): Promise<boolean> {
        // Query physical device to confirm state changes took effect
        return true; // Simplified for now
    }

    public dispose(): void {
        // Stop all environment simulations
        this._simulationTimers.forEach((timer, environmentId) => {
            this.stopEnvironmentSimulation(environmentId);
        });
        
        // Clean up sync resources
        this._stateSyncQueue.clear();
        this._physicalStateCache.clear();
        this._virtualStateCache.clear();
        this._lastSyncTimestamp.clear();
        
        // Dispose event emitters
        this._onDeviceConnected.dispose();
        this._onDeviceDisconnected.dispose();
        this._onDeviceStatusChanged.dispose();
        this._onFileTransferProgress.dispose();
        this._onEnvironmentCreated.dispose();
        this._onSensorDataChanged.dispose();
        this._onGPIOStateChanged.dispose();
        this._onDeviceTwinStateChanged.dispose();
        this._onPhysicalDeviceSync.dispose();
        
        // Clean up resources
        this._deviceDetector.dispose();
        super.dispose?.();
    }
}