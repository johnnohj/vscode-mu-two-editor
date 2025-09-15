/**
 * Device State Synchronizer
 * 
 * Coordinates between DAP (Debug Adapter Protocol) and LSP (Language Server Protocol)
 * to maintain synchronized device state for device twinning.
 * 
 * Architecture:
 * - DAP manages device connections, file operations, and execution environments
 * - LSP provides language services and board-aware code intelligence
 * - DeviceStateSynchronizer ensures both maintain consistent device state
 */

import { 
    DeviceTwinState,
    StateSyncEvent,
    IDeviceStateSynchronizer,
    BasePinState
} from './interfaces';

import { CircuitPythonDebugAdapter } from '../debugAdapter';
import { CircuitPythonLanguageService } from '../../providers/language/core/CircuitPythonLanguageService';
import { DeviceModelFactory } from './DeviceModelFactory';

/**
 * Manages synchronization between DAP and LSP for device state
 */
export class DeviceStateSynchronizer implements IDeviceStateSynchronizer {
    private debugAdapter: CircuitPythonDebugAdapter;
    private languageService: CircuitPythonLanguageService;
    private deviceModelFactory: DeviceModelFactory;
    private eventCallbacks: Array<(event: StateSyncEvent) => void> = [];
    
    // State caches for performance
    private deviceStates = new Map<string, DeviceTwinState>();
    private pendingSyncOperations = new Map<string, Promise<boolean>>();
    private lastSyncTimestamps = new Map<string, number>();
    
    // Sync configuration
    private readonly SYNC_THROTTLE_MS = 100; // Throttle rapid updates
    private readonly MAX_SYNC_RETRIES = 3;
    private readonly SYNC_TIMEOUT_MS = 5000;

    constructor(
        debugAdapter: CircuitPythonDebugAdapter,
        languageService: CircuitPythonLanguageService,
        deviceModelFactory: DeviceModelFactory
    ) {
        this.debugAdapter = debugAdapter;
        this.languageService = languageService;
        this.deviceModelFactory = deviceModelFactory;
        
        this.setupEventListeners();
    }

    // === Core Synchronization ===

    async syncDeviceState(deviceId: string, state: Partial<DeviceTwinState>): Promise<boolean> {
        // Throttle rapid updates to the same device
        const lastSync = this.lastSyncTimestamps.get(deviceId) || 0;
        const now = Date.now();
        if (now - lastSync < this.SYNC_THROTTLE_MS) {
            // Wait for throttle period to elapse, then sync
            await new Promise(resolve => setTimeout(resolve, this.SYNC_THROTTLE_MS - (now - lastSync)));
        }

        // Check for existing sync operation
        const existingSync = this.pendingSyncOperations.get(deviceId);
        if (existingSync) {
            await existingSync;
        }

        // Perform synchronization
        const syncPromise = this.performDeviceStateSync(deviceId, state);
        this.pendingSyncOperations.set(deviceId, syncPromise);

        try {
            const result = await syncPromise;
            this.lastSyncTimestamps.set(deviceId, Date.now());
            return result;
        } finally {
            this.pendingSyncOperations.delete(deviceId);
        }
    }

    async getDeviceState(deviceId: string): Promise<DeviceTwinState | null> {
        // Check cache first
        const cachedState = this.deviceStates.get(deviceId);
        if (cachedState) {
            return { ...cachedState }; // Return copy to prevent mutations
        }

        // Try to get from device model factory
        const deviceTwin = this.deviceModelFactory.getDeviceTwin(deviceId);
        if (deviceTwin) {
            this.deviceStates.set(deviceId, deviceTwin);
            return { ...deviceTwin };
        }

        return null;
    }

    // === Component-Specific Synchronization ===

    async syncPinState(deviceId: string, pin: number, state: BasePinState): Promise<boolean> {
        try {
            // Update local device state
            const deviceState = await this.getDeviceState(deviceId);
            if (!deviceState) {
                return false;
            }

            // Update appropriate pin collection based on type
            switch (state.type) {
                case 'digital':
                    deviceState.digitalPins.set(pin, state as any);
                    break;
                case 'analog':
                    deviceState.analogPins.set(pin, state as any);
                    break;
                case 'pwm':
                    deviceState.pwmPins.set(pin, state as any);
                    break;
            }

            // Sync to both DAP and LSP
            const dapSync = this.syncPinStateToDAP(deviceId, pin, state);
            const lspSync = this.syncPinStateToLSP(deviceId, pin, state);

            const results = await Promise.all([dapSync, lspSync]);
            const success = results.every(r => r);

            if (success) {
                // Update cache and emit event
                this.deviceStates.set(deviceId, deviceState);
                this.emitStateChange({
                    type: 'pin_changed',
                    deviceId,
                    timestamp: Date.now(),
                    data: { pin, state },
                    source: 'virtual'
                });
            }

            return success;
        } catch (error) {
            console.error('Pin state sync failed:', error);
            return false;
        }
    }

    async syncSensorReading(deviceId: string, sensorId: string, value: number): Promise<boolean> {
        try {
            const deviceState = await this.getDeviceState(deviceId);
            if (!deviceState) {
                return false;
            }

            const sensor = deviceState.sensors.get(sensorId);
            if (!sensor) {
                return false;
            }

            // Validate value is within sensor range
            if (value < sensor.range.min || value > sensor.range.max) {
                console.warn(`Sensor value ${value} outside range [${sensor.range.min}, ${sensor.range.max}]`);
                return false;
            }

            // Update sensor state
            (sensor as any).value = value;
            sensor.lastReading = Date.now();

            // Sync to DAP (for execution environment)
            const dapSync = this.syncSensorReadingToDAP(deviceId, sensorId, value);
            
            // LSP doesn't need raw sensor values, but may need board state
            const lspSync = this.updateLSPBoardContext(deviceId);

            const results = await Promise.all([dapSync, lspSync]);
            const success = results.every(r => r);

            if (success) {
                this.deviceStates.set(deviceId, deviceState);
                this.emitStateChange({
                    type: 'sensor_reading',
                    deviceId,
                    timestamp: Date.now(),
                    data: { sensorId, value },
                    source: 'physical'
                });
            }

            return success;
        } catch (error) {
            console.error('Sensor reading sync failed:', error);
            return false;
        }
    }

    async syncActuatorCommand(deviceId: string, actuatorId: string, command: any): Promise<boolean> {
        try {
            const deviceState = await this.getDeviceState(deviceId);
            if (!deviceState) {
                return false;
            }

            const actuator = deviceState.actuators.get(actuatorId);
            if (!actuator) {
                return false;
            }

            // Apply command to actuator state
            const success = this.applyActuatorCommand(actuator, command);
            if (!success) {
                return false;
            }

            actuator.lastUpdate = Date.now();

            // Sync command to DAP (for physical device execution)
            const dapSync = this.syncActuatorCommandToDAP(deviceId, actuatorId, command);
            
            // LSP doesn't execute commands but may need state for completions
            const lspSync = this.updateLSPBoardContext(deviceId);

            const results = await Promise.all([dapSync, lspSync]);
            const syncSuccess = results.every(r => r);

            if (syncSuccess) {
                this.deviceStates.set(deviceId, deviceState);
                this.emitStateChange({
                    type: 'actuator_command',
                    deviceId,
                    timestamp: Date.now(),
                    data: { actuatorId, command },
                    source: 'virtual'
                });
            }

            return syncSuccess;
        } catch (error) {
            console.error('Actuator command sync failed:', error);
            return false;
        }
    }

    // === Event Handling ===

    onStateChanged(callback: (event: StateSyncEvent) => void): void {
        this.eventCallbacks.push(callback);
    }

    emitStateChange(event: StateSyncEvent): void {
        this.eventCallbacks.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('Error in state change callback:', error);
            }
        });
    }

    // === Batch Operations ===

    async syncMultipleStates(updates: Array<{ deviceId: string; state: Partial<DeviceTwinState> }>): Promise<boolean[]> {
        // Group updates by device to optimize sync operations
        const updatesByDevice = new Map<string, Partial<DeviceTwinState>[]>();
        
        updates.forEach(update => {
            if (!updatesByDevice.has(update.deviceId)) {
                updatesByDevice.set(update.deviceId, []);
            }
            updatesByDevice.get(update.deviceId)!.push(update.state);
        });

        // Sync each device's updates
        const syncPromises: Promise<boolean>[] = [];
        
        updatesByDevice.forEach((deviceUpdates, deviceId) => {
            // Merge all updates for this device
            const mergedUpdate = deviceUpdates.reduce((merged, update) => {
                return { ...merged, ...update };
            }, {});
            
            syncPromises.push(this.syncDeviceState(deviceId, mergedUpdate));
        });

        return Promise.all(syncPromises);
    }

    // === Private Implementation ===

    private setupEventListeners(): void {
        // Listen to DAP events
        this.debugAdapter.onEnvironmentCreated(environment => {
            this.handleDAPEnvironmentCreated(environment);
        });

        this.debugAdapter.onSensorDataChanged(event => {
            this.handleDAPSensorDataChanged(event);
        });

        this.debugAdapter.onGPIOStateChanged(event => {
            this.handleDAPGPIOStateChanged(event);
        });

        // Set up periodic state sync from physical devices
        this.startPeriodicSync();
    }

    private async performDeviceStateSync(deviceId: string, state: Partial<DeviceTwinState>): Promise<boolean> {
        try {
            // Get current device state
            const currentState = await this.getDeviceState(deviceId);
            if (!currentState) {
                return false;
            }

            // Merge updates
            const updatedState: DeviceTwinState = {
                ...currentState,
                ...state,
                lastSync: Date.now()
            };

            // Sync to DAP
            const dapSuccess = await this.syncStateToDAP(deviceId, updatedState);
            
            // Sync to LSP
            const lspSuccess = await this.syncStateToLSP(deviceId, updatedState);

            if (dapSuccess && lspSuccess) {
                // Update local cache
                this.deviceStates.set(deviceId, updatedState);
                
                // Emit state change event
                this.emitStateChange({
                    type: 'config_changed',
                    deviceId,
                    timestamp: Date.now(),
                    data: state,
                    source: 'virtual'
                });

                return true;
            }

            return false;
        } catch (error) {
            console.error('Device state sync failed:', error);
            return false;
        }
    }

    private async syncStateToDAP(deviceId: string, state: DeviceTwinState): Promise<boolean> {
        try {
            // Update DAP's execution environment
            const environment = this.debugAdapter.getEnvironment(deviceId);
            if (!environment) {
                return false;
            }

            // Sync pin states to DAP GPIO simulation
            for (const [pin, pinState] of state.digitalPins) {
                if (pinState.type === 'digital') {
                    await this.debugAdapter.updateGPIOState(deviceId, pin, pinState.value, pinState.mode as any);
                }
            }

            // Sync sensor states to DAP environment
            for (const [sensorId, sensorState] of state.sensors) {
                if ((sensorState as any).value !== undefined) {
                    await this.debugAdapter.updateSensorValue(deviceId, sensorId, (sensorState as any).value);
                }
            }

            return true;
        } catch (error) {
            console.error('DAP state sync failed:', error);
            return false;
        }
    }

    private async syncStateToLSP(deviceId: string, state: DeviceTwinState): Promise<boolean> {
        try {
            // Update LSP's board context for completions and diagnostics
            const boardInfo = {
                id: state.boardId,
                name: state.displayName,
                displayName: state.displayName,
                pins: this.convertPinStatesForLSP(state)
            };

            this.languageService.setBoard(boardInfo as any);
            return true;
        } catch (error) {
            console.error('LSP state sync failed:', error);
            return false;
        }
    }

    private async syncPinStateToDAP(deviceId: string, pin: number, state: BasePinState): Promise<boolean> {
        try {
            if (state.type === 'digital') {
                return await this.debugAdapter.updateGPIOState(
                    deviceId, 
                    pin, 
                    (state as any).value, 
                    (state as any).mode
                );
            }
            return true;
        } catch (error) {
            console.error('DAP pin sync failed:', error);
            return false;
        }
    }

    private async syncPinStateToLSP(deviceId: string, pin: number, state: BasePinState): Promise<boolean> {
        try {
            // LSP needs updated board context for pin validation
            return await this.updateLSPBoardContext(deviceId);
        } catch (error) {
            console.error('LSP pin sync failed:', error);
            return false;
        }
    }

    private async syncSensorReadingToDAP(deviceId: string, sensorId: string, value: number): Promise<boolean> {
        try {
            return await this.debugAdapter.updateSensorValue(deviceId, sensorId, value);
        } catch (error) {
            console.error('DAP sensor sync failed:', error);
            return false;
        }
    }

    private async syncActuatorCommandToDAP(deviceId: string, actuatorId: string, command: any): Promise<boolean> {
        try {
            // DAP would execute the actuator command on the physical device
            // For now, we'll simulate the execution
            console.log(`DAP executing actuator command: ${actuatorId}`, command);
            return true;
        } catch (error) {
            console.error('DAP actuator sync failed:', error);
            return false;
        }
    }

    private async updateLSPBoardContext(deviceId: string): Promise<boolean> {
        try {
            const deviceState = await this.getDeviceState(deviceId);
            if (!deviceState) {
                return false;
            }

            const boardInfo = {
                id: deviceState.boardId,
                name: deviceState.displayName,
                displayName: deviceState.displayName,
                pins: this.convertPinStatesForLSP(deviceState)
            };

            this.languageService.setBoard(boardInfo as any);
            return true;
        } catch (error) {
            console.error('LSP board context update failed:', error);
            return false;
        }
    }

    private convertPinStatesForLSP(state: DeviceTwinState): any[] {
        const pins: any[] = [];

        // Convert digital pins
        state.digitalPins.forEach(pin => {
            pins.push({
                name: pin.name,
                capabilities: pin.capabilities
            });
        });

        // Convert analog pins
        state.analogPins.forEach(pin => {
            pins.push({
                name: pin.name,
                capabilities: pin.capabilities
            });
        });

        // Convert PWM pins
        state.pwmPins.forEach(pin => {
            pins.push({
                name: pin.name,
                capabilities: pin.capabilities
            });
        });

        return pins;
    }

    private applyActuatorCommand(actuator: any, command: any): boolean {
        try {
            switch (actuator.type) {
                case 'led':
                    if (command.brightness !== undefined) {
                        actuator.brightness = Math.max(0, Math.min(1, command.brightness));
                    }
                    if (command.isOn !== undefined) {
                        actuator.isOn = command.isOn;
                    }
                    break;
                
                case 'servo':
                    if (command.angle !== undefined) {
                        actuator.angle = Math.max(0, Math.min(180, command.angle));
                    }
                    break;
                
                case 'buzzer':
                    if (command.frequency !== undefined) {
                        actuator.frequency = command.frequency;
                    }
                    if (command.volume !== undefined) {
                        actuator.volume = Math.max(0, Math.min(1, command.volume));
                    }
                    if (command.isPlaying !== undefined) {
                        actuator.isPlaying = command.isPlaying;
                    }
                    break;
                
                default:
                    console.warn(`Unknown actuator type: ${actuator.type}`);
                    return false;
            }
            
            return true;
        } catch (error) {
            console.error('Error applying actuator command:', error);
            return false;
        }
    }

    private handleDAPEnvironmentCreated(environment: any): void {
        // When DAP creates a new environment, ensure LSP is updated
        this.updateLSPBoardContext(environment.deviceId).catch(error => {
            console.error('Failed to sync new environment to LSP:', error);
        });
    }

    private handleDAPSensorDataChanged(event: any): void {
        // Propagate sensor changes from DAP to local state
        this.syncSensorReading(event.environmentId, event.sensor.id, event.sensor.value).catch(error => {
            console.error('Failed to sync sensor data from DAP:', error);
        });
    }

    private handleDAPGPIOStateChanged(event: any): void {
        // Propagate GPIO changes from DAP to local state
        const pinState: BasePinState = {
            type: 'digital',
            pin: event.gpio.pin,
            name: `GPIO${event.gpio.pin}`,
            aliases: [],
            capabilities: ['digital_io'],
            isReserved: false,
            lastChanged: Date.now(),
            voltage: 3.3,
            ...event.gpio
        };

        this.syncPinState(event.environmentId, event.gpio.pin, pinState).catch(error => {
            console.error('Failed to sync GPIO state from DAP:', error);
        });
    }

    private startPeriodicSync(): void {
        // Periodic sync to ensure state consistency
        setInterval(async () => {
            try {
                // Get all active device connections from DAP
                const activeDevices = this.debugAdapter.getDeviceConnections();
                
                for (const connection of activeDevices) {
                    if (connection.connected) {
                        // Sync device state periodically
                        const deviceState = await this.getDeviceState(connection.deviceId);
                        if (deviceState) {
                            await this.syncDeviceState(connection.deviceId, { lastSync: Date.now() });
                        }
                    }
                }
            } catch (error) {
                console.error('Periodic sync failed:', error);
            }
        }, 30000); // Every 30 seconds
    }

    // === Public Management Methods ===

    public async registerDevice(deviceId: string, boardId: string): Promise<boolean> {
        try {
            // Create device twin if it doesn't exist
            let deviceState = await this.getDeviceState(deviceId);
            if (!deviceState) {
                deviceState = await this.deviceModelFactory.createDeviceTwin(boardId, deviceId, {
                    enableSimulation: true,
                    autoConnect: false
                });
            }

            // Initial sync to both DAP and LSP
            const success = await this.syncDeviceState(deviceId, deviceState);
            if (success) {
                console.log(`Device registered and synced: ${deviceId}`);
            }

            return success;
        } catch (error) {
            console.error('Device registration failed:', error);
            return false;
        }
    }

    public async unregisterDevice(deviceId: string): Promise<boolean> {
        try {
            // Clean up device state
            this.deviceStates.delete(deviceId);
            this.lastSyncTimestamps.delete(deviceId);
            this.pendingSyncOperations.delete(deviceId);

            // Remove from device model factory
            this.deviceModelFactory.removeDeviceTwin(deviceId);

            return true;
        } catch (error) {
            console.error('Device unregistration failed:', error);
            return false;
        }
    }

    public getRegisteredDevices(): string[] {
        return Array.from(this.deviceStates.keys());
    }

    public async forceSync(deviceId: string): Promise<boolean> {
        // Clear throttle timestamp to force immediate sync
        this.lastSyncTimestamps.delete(deviceId);
        
        const deviceState = await this.getDeviceState(deviceId);
        if (!deviceState) {
            return false;
        }

        return await this.syncDeviceState(deviceId, deviceState);
    }
}