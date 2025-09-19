/**
 * Device Model Factory
 * 
 * Implements dynamic device model creation using composable interfaces.
 * Enables on-the-fly construction of device twins from board templates
 * and component definitions.
 */

import { 
    DeviceTemplate,
    DeviceTwinState,
    DeviceCreationOptions,
    ValidationResult,
    IDeviceModelFactory,
    PinCapability,
    SensorDefinition,
    ActuatorDefinition,
    SimulationSettings,
    BasePinState,
    DigitalPinState,
    AnalogPinState,
    PWMPinState,
    SensorState,
    ActuatorState,
    BoardFeatureState
} from './interfaces';

import { moduleRegistry } from '../../providers/language/core/ModuleRegistry';

/**
 * Factory for creating and managing device models dynamically
 */
export class DeviceModelFactory implements IDeviceModelFactory {
    private templates = new Map<string, DeviceTemplate>();
    private deviceTwins = new Map<string, DeviceTwinState>();
    private circuitPythonBoardDatabase: any[] = []; // Will be populated from existing database

    constructor() {
        this.initializeFromExistingData();
        this.createCommonTemplates();
    }

    // === Template Management ===

    registerTemplate(template: DeviceTemplate): void {
        const validationResult = this.validateDeviceConfiguration(template);
        if (!validationResult.isValid) {
            throw new Error(`Invalid device template: ${validationResult.errors.join(', ')}`);
        }
        
        this.templates.set(template.boardId, template);
    }

    getTemplate(boardId: string): DeviceTemplate | null {
        return this.templates.get(boardId) || null;
    }

    getAvailableTemplates(): DeviceTemplate[] {
        return Array.from(this.templates.values());
    }

    // === Device Twin Creation ===

    async createDeviceTwin(boardId: string, deviceId: string, options?: DeviceCreationOptions): Promise<DeviceTwinState> {
        const template = this.getTemplate(boardId);
        if (!template) {
            throw new Error(`No template found for board: ${boardId}`);
        }

        const defaultSimulationSettings: SimulationSettings = {
            isSimulated: options?.enableSimulation ?? false,
            realisticTiming: true,
            noiseLevel: 0.01,
            updateInterval: 100,
            sensorVariation: 0.05,
            enablePhysicalLaws: true,
            randomSeed: Math.floor(Math.random() * 1000000)
        };

        const deviceTwin: DeviceTwinState = {
            deviceId,
            boardId: template.boardId,
            displayName: template.displayName,
            isConnected: options?.autoConnect ?? false,
            lastSync: Date.now(),
            
            // Initialize pin states from template
            digitalPins: this.createDigitalPinStates(template.digitalPins),
            analogPins: this.createAnalogPinStates(template.analogPins),
            pwmPins: this.createPWMPinStates(template.pwmPins),
            
            // Initialize communication interfaces
            i2cBuses: this.createI2CBusStates(template.i2cBuses),
            spiBuses: this.createSPIBusStates(template.spiBuses),
            uartPorts: this.createUARTPortStates(template.uartPorts),
            
            // Initialize components
            sensors: this.createSensorStates(template.builtinSensors),
            actuators: this.createActuatorStates(template.builtinActuators),
            
            // Initialize board features
            boardFeatures: this.createBoardFeatureState(template.boardFeatures),
            
            // Apply simulation settings
            simulation: {
                ...defaultSimulationSettings,
                ...options?.simulationSettings
            }
        };

        // Apply initial state overrides
        if (options?.initialState) {
            Object.assign(deviceTwin, options.initialState);
        }

        this.deviceTwins.set(deviceId, deviceTwin);
        return deviceTwin;
    }

    async updateDeviceTwin(deviceId: string, updates: Partial<DeviceTemplate>): Promise<boolean> {
        const existingTwin = this.deviceTwins.get(deviceId);
        if (!existingTwin) {
            return false;
        }

        // Create a temporary template with updates to validate
        const currentTemplate = this.getTemplate(existingTwin.boardId);
        if (!currentTemplate) {
            return false;
        }

        const updatedTemplate: DeviceTemplate = {
            ...currentTemplate,
            ...updates
        };

        const validationResult = this.validateDeviceConfiguration(updatedTemplate);
        if (!validationResult.isValid) {
            console.warn('Device twin update validation failed:', validationResult.errors);
            return false;
        }

        // Apply updates to existing twin
        if (updates.builtinSensors) {
            existingTwin.sensors = this.createSensorStates(updates.builtinSensors);
        }
        if (updates.builtinActuators) {
            existingTwin.actuators = this.createActuatorStates(updates.builtinActuators);
        }

        existingTwin.lastSync = Date.now();
        return true;
    }

    // === Component Composition ===

    async addSensorToDevice(deviceId: string, sensor: SensorDefinition): Promise<boolean> {
        const deviceTwin = this.deviceTwins.get(deviceId);
        if (!deviceTwin) {
            return false;
        }

        // Validate sensor can be added
        if (sensor.pin && !this.validatePinAssignment(deviceId, sensor.pin, 'analog_input')) {
            return false;
        }

        const sensorState = this.createSensorStateFromDefinition(sensor);
        deviceTwin.sensors.set(sensor.id, sensorState);
        deviceTwin.lastSync = Date.now();
        
        return true;
    }

    async addActuatorToDevice(deviceId: string, actuator: ActuatorDefinition): Promise<boolean> {
        const deviceTwin = this.deviceTwins.get(deviceId);
        if (!deviceTwin) {
            return false;
        }

        // Validate actuator can be added
        if (actuator.pin) {
            const requiredCapability = this.getRequiredCapabilityForActuator(actuator.type);
            if (!this.validatePinAssignment(deviceId, actuator.pin, requiredCapability)) {
                return false;
            }
        }

        const actuatorState = this.createActuatorStateFromDefinition(actuator);
        deviceTwin.actuators.set(actuator.id, actuatorState);
        deviceTwin.lastSync = Date.now();
        
        return true;
    }

    async removeSensorFromDevice(deviceId: string, sensorId: string): Promise<boolean> {
        const deviceTwin = this.deviceTwins.get(deviceId);
        if (!deviceTwin) {
            return false;
        }

        const removed = deviceTwin.sensors.delete(sensorId);
        if (removed) {
            deviceTwin.lastSync = Date.now();
        }
        
        return removed;
    }

    async removeActuatorFromDevice(deviceId: string, actuatorId: string): Promise<boolean> {
        const deviceTwin = this.deviceTwins.get(deviceId);
        if (!deviceTwin) {
            return false;
        }

        const removed = deviceTwin.actuators.delete(actuatorId);
        if (removed) {
            deviceTwin.lastSync = Date.now();
        }
        
        return removed;
    }

    // === Validation ===

    validateDeviceConfiguration(template: DeviceTemplate): ValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate required fields
        if (!template.boardId) errors.push('Board ID is required');
        if (!template.displayName) errors.push('Display name is required');

        // Validate pin assignments
        const usedPins = new Set<number>();
        
        // Check digital pins
        template.digitalPins.forEach(pin => {
            if (usedPins.has(pin.pin)) {
                errors.push(`Pin ${pin.pin} is assigned multiple times`);
            }
            usedPins.add(pin.pin);
        });

        // Check analog pins
        template.analogPins.forEach(pin => {
            if (usedPins.has(pin.pin)) {
                warnings.push(`Pin ${pin.pin} is used as both digital and analog`);
            }
        });

        // Validate communication interfaces
        template.i2cBuses.forEach(bus => {
            if (bus.sclPin === bus.sdaPin) {
                errors.push(`I2C bus ${bus.busId}: SCL and SDA cannot be the same pin`);
            }
        });

        template.spiBuses.forEach(bus => {
            const spiPins = [bus.sckPin, bus.mosiPin, bus.misoPin];
            if (new Set(spiPins).size !== spiPins.length) {
                errors.push(`SPI bus ${bus.busId}: Pins must be unique`);
            }
        });

        // Validate CircuitPython compatibility
        if (template.supportedModules.length === 0) {
            warnings.push('No supported CircuitPython modules specified');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    validatePinAssignment(deviceId: string, pin: number, capability: PinCapability): boolean {
        const deviceTwin = this.deviceTwins.get(deviceId);
        if (!deviceTwin) {
            return false;
        }

        const template = this.getTemplate(deviceTwin.boardId);
        if (!template) {
            return false;
        }

        // Find pin definition
        const pinDefinition = [
            ...template.digitalPins,
            ...template.analogPins,
            ...template.pwmPins
        ].find(p => p.pin === pin);

        if (!pinDefinition) {
            return false;
        }

        // Check if pin supports the required capability
        return pinDefinition.capabilities.includes(capability);
    }

    // === Private Helper Methods ===

    private async initializeFromExistingData(): Promise<void> {
        try {
            // Load CircuitPython board database if available
            // This would integrate with existing device detection data
            const boardDatabasePath = '../data/circuitPythonBoards.json';
            // Implementation would load actual data
        } catch (error) {
            console.warn('Could not load board database:', error);
        }
    }

    private createCommonTemplates(): void {
        // Create common board templates for popular CircuitPython boards
        
        // Generic CircuitPython board template
        const genericTemplate: DeviceTemplate = {
            boardId: 'generic_circuitpython',
            displayName: 'Generic CircuitPython Board',
            description: 'A generic CircuitPython microcontroller with standard peripherals',
            manufacturer: 'Generic',
            
            digitalPins: Array.from({ length: 20 }, (_, i) => ({
                pin: i,
                name: `D${i}`,
                aliases: [`GPIO${i}`],
                capabilities: ['digital_io'],
                isReserved: false,
                voltage: 3.3
            })),
            
            analogPins: Array.from({ length: 6 }, (_, i) => ({
                pin: i,
                name: `A${i}`,
                aliases: [],
                capabilities: ['analog_input'],
                isReserved: false,
                voltage: 3.3
            })),
            
            pwmPins: Array.from({ length: 8 }, (_, i) => ({
                pin: i,
                name: `PWM${i}`,
                aliases: [],
                capabilities: ['pwm', 'digital_io'],
                isReserved: false,
                voltage: 3.3
            })),
            
            i2cBuses: [{
                busId: 0,
                sclPin: 5,
                sdaPin: 4,
                defaultFrequency: 100000,
                maxFrequency: 400000,
                hasPullups: true
            }],
            
            spiBuses: [{
                busId: 0,
                sckPin: 18,
                mosiPin: 19,
                misoPin: 16,
                maxFrequency: 40000000,
                supportedModes: [0, 1, 2, 3]
            }],
            
            uartPorts: [{
                portId: 0,
                txPin: 1,
                rxPin: 3,
                maxBaudRate: 2000000
            }],
            
            builtinSensors: [
                {
                    id: 'onboard_temp',
                    name: 'Onboard Temperature Sensor',
                    type: 'temperature',
                    interface: 'builtin',
                    range: { min: -40, max: 85 },
                    accuracy: 1.0,
                    unit: '°C'
                }
            ],
            
            builtinActuators: [
                {
                    id: 'status_led',
                    name: 'Status LED',
                    type: 'led',
                    pin: 13,
                    interface: 'digital',
                    specifications: { color: 'red' }
                }
            ],
            
            boardFeatures: [
                {
                    type: 'button',
                    id: 'boot_button',
                    name: 'Boot Button',
                    pin: 0,
                    specifications: { pullup: true }
                }
            ],
            
            operatingVoltage: 3.3,
            maxCurrent: 500,
            flashSize: 2 * 1024 * 1024, // 2MB
            ramSize: 320 * 1024, // 320KB
            
            circuitPythonVersion: '8.0.0',
            supportedModules: [
                'board', 'digitalio', 'analogio', 'pwmio', 'busio',
                'time', 'gc', 'os', 'random', 'math'
            ]
        };
        
        this.registerTemplate(genericTemplate);
    }

    private createDigitalPinStates(pinDefinitions: any[]): Map<number, DigitalPinState> {
        const pinStates = new Map<number, DigitalPinState>();
        
        pinDefinitions.forEach(def => {
            const pinState: DigitalPinState = {
                type: 'digital',
                pin: def.pin,
                name: def.name,
                aliases: def.aliases || [],
                capabilities: def.capabilities,
                isReserved: def.isReserved || false,
                lastChanged: Date.now(),
                voltage: def.voltage,
                mode: 'input',
                value: false,
                pull: 'none',
                driveMode: 'push_pull'
            };
            pinStates.set(def.pin, pinState);
        });
        
        return pinStates;
    }

    private createAnalogPinStates(pinDefinitions: any[]): Map<number, AnalogPinState> {
        const pinStates = new Map<number, AnalogPinState>();
        
        pinDefinitions.forEach(def => {
            const pinState: AnalogPinState = {
                type: 'analog',
                pin: def.pin,
                name: def.name,
                aliases: def.aliases || [],
                capabilities: def.capabilities,
                isReserved: def.isReserved || false,
                lastChanged: Date.now(),
                voltage: def.voltage,
                mode: 'input',
                value: 0,
                referenceVoltage: def.voltage,
                resolution: 16,
                maxValue: 65535
            };
            pinStates.set(def.pin, pinState);
        });
        
        return pinStates;
    }

    private createPWMPinStates(pinDefinitions: any[]): Map<number, PWMPinState> {
        const pinStates = new Map<number, PWMPinState>();
        
        pinDefinitions.forEach(def => {
            const pinState: PWMPinState = {
                type: 'pwm',
                pin: def.pin,
                name: def.name,
                aliases: def.aliases || [],
                capabilities: def.capabilities,
                isReserved: def.isReserved || false,
                lastChanged: Date.now(),
                voltage: def.voltage,
                dutyCycle: 0,
                frequency: 1000,
                isActive: false,
                resolution: 16
            };
            pinStates.set(def.pin, pinState);
        });
        
        return pinStates;
    }

    private createI2CBusStates(busDefinitions: any[]): Map<number, any> {
        const busStates = new Map();
        
        busDefinitions.forEach(def => {
            busStates.set(def.busId, {
                busId: def.busId,
                sclPin: def.sclPin,
                sdaPin: def.sdaPin,
                frequency: def.defaultFrequency,
                isActive: false,
                devices: [],
                pullups: def.hasPullups
            });
        });
        
        return busStates;
    }

    private createSPIBusStates(busDefinitions: any[]): Map<number, any> {
        const busStates = new Map();
        
        busDefinitions.forEach(def => {
            busStates.set(def.busId, {
                busId: def.busId,
                sckPin: def.sckPin,
                mosiPin: def.mosiPin,
                misoPin: def.misoPin,
                frequency: 1000000, // 1 MHz default
                mode: 0,
                bitOrder: 'MSB',
                isActive: false,
                devices: []
            });
        });
        
        return busStates;
    }

    private createUARTPortStates(portDefinitions: any[]): Map<number, any> {
        const portStates = new Map();
        
        portDefinitions.forEach(def => {
            portStates.set(def.portId, {
                portId: def.portId,
                txPin: def.txPin,
                rxPin: def.rxPin,
                rtsPin: def.rtsPin,
                ctsPin: def.ctsPin,
                baudRate: 115200, // Default baud rate
                dataBits: 8,
                parity: 'none',
                stopBits: 1,
                flowControl: 'none',
                isActive: false,
                rxBuffer: [],
                txBuffer: []
            });
        });
        
        return portStates;
    }

    private createSensorStates(sensorDefinitions: SensorDefinition[]): Map<string, SensorState> {
        const sensorStates = new Map<string, SensorState>();
        
        sensorDefinitions.forEach(def => {
            const sensorState = this.createSensorStateFromDefinition(def);
            sensorStates.set(def.id, sensorState);
        });
        
        return sensorStates;
    }

    private createSensorStateFromDefinition(def: SensorDefinition): SensorState {
        const baseState: SensorState = {
            id: def.id,
            name: def.name,
            type: def.type,
            isActive: true,
            lastReading: Date.now(),
            unit: def.unit,
            range: def.range,
            accuracy: def.accuracy,
            updateInterval: 1000 // 1 second default
        };

        // Type-specific initialization
        if (def.type === 'temperature') {
            return {
                ...baseState,
                type: 'temperature',
                value: 22.0, // Room temperature default
                calibrationOffset: 0
            } as any;
        }

        return baseState;
    }

    private createActuatorStates(actuatorDefinitions: ActuatorDefinition[]): Map<string, ActuatorState> {
        const actuatorStates = new Map<string, ActuatorState>();
        
        actuatorDefinitions.forEach(def => {
            const actuatorState = this.createActuatorStateFromDefinition(def);
            actuatorStates.set(def.id, actuatorState);
        });
        
        return actuatorStates;
    }

    private createActuatorStateFromDefinition(def: ActuatorDefinition): ActuatorState {
        const baseState: ActuatorState = {
            id: def.id,
            name: def.name,
            type: def.type,
            isActive: false,
            lastUpdate: Date.now(),
            pin: def.pin
        };

        // Type-specific initialization
        if (def.type === 'led') {
            return {
                ...baseState,
                type: 'led',
                brightness: 0,
                isOn: false
            } as any;
        }

        return baseState;
    }

    private createBoardFeatureState(featureDefinitions: any[]): BoardFeatureState {
        return {
            buttons: new Map(),
            switches: new Map(),
            onboardLeds: new Map(),
            resetButton: {
                id: 'reset',
                isPressed: false,
                lastPressed: 0,
                pressCount: 0,
                debounceTime: 50
            },
            powerManagement: {
                voltage: 3.3,
                current: 50, // mA
                powerMode: 'active',
                batteryLevel: 100,
                isCharging: false
            },
            filesystem: {
                totalSpace: 2 * 1024 * 1024, // 2MB
                usedSpace: 512 * 1024, // 512KB
                freeSpace: 1.5 * 1024 * 1024, // 1.5MB
                files: new Map()
            },
            memory: {
                totalRam: 320 * 1024, // 320KB
                usedRam: 64 * 1024, // 64KB
                freeRam: 256 * 1024, // 256KB
                gcCollections: 0
            }
        };
    }

    private getRequiredCapabilityForActuator(type: string): PinCapability {
        switch (type) {
            case 'led':
                return 'digital_io';
            case 'servo':
                return 'pwm';
            case 'buzzer':
                return 'pwm';
            default:
                return 'digital_io';
        }
    }

    // === Public Accessors ===

    public getDeviceTwin(deviceId: string): DeviceTwinState | null {
        return this.deviceTwins.get(deviceId) || null;
    }

    public getAllDeviceTwins(): DeviceTwinState[] {
        return Array.from(this.deviceTwins.values());
    }

    public removeDeviceTwin(deviceId: string): boolean {
        return this.deviceTwins.delete(deviceId);
    }
}