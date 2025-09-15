/**
 * Device Twinning Interface Definitions
 * 
 * Comprehensive TypeScript interfaces for creating dynamic device models
 * that can be composed on-the-fly to twin physical CircuitPython devices.
 * 
 * Inspired by Python Device Simulator's device twinning strategy,
 * adapted for CircuitPython boards with 602+ device support.
 */

// === Core Device State Interfaces ===

/**
 * Base interface for all device state updates
 */
export interface DeviceStateUpdate {
    timestamp: number;
    deviceId: string;
    source: 'physical' | 'virtual' | 'user_input';
}

/**
 * Core device twin state representation
 */
export interface DeviceTwinState {
    deviceId: string;
    boardId: string;
    displayName: string;
    isConnected: boolean;
    lastSync: number;
    
    // Component states
    digitalPins: Map<number, DigitalPinState>;
    analogPins: Map<number, AnalogPinState>;
    pwmPins: Map<number, PWMPinState>;
    i2cBuses: Map<number, I2CBusState>;
    spiBuses: Map<number, SPIBusState>;
    uartPorts: Map<number, UARTPortState>;
    sensors: Map<string, SensorState>;
    actuators: Map<string, ActuatorState>;
    
    // Board-specific features
    boardFeatures: BoardFeatureState;
    
    // Simulation settings
    simulation: SimulationSettings;
}

// === Pin Interface Definitions ===

/**
 * Base pin interface - all pins extend from this
 */
export interface BasePinState {
    pin: number;
    name: string;
    aliases: string[];
    capabilities: PinCapability[];
    isReserved: boolean;
    lastChanged: number;
    voltage: number; // Operating voltage (3.3V, 5V, etc.)
}

/**
 * Digital pin state and configuration
 */
export interface DigitalPinState extends BasePinState {
    type: 'digital';
    mode: 'input' | 'output' | 'input_pullup' | 'input_pulldown';
    value: boolean;
    pull: 'none' | 'up' | 'down';
    driveMode: 'push_pull' | 'open_drain';
}

/**
 * Analog pin state and configuration
 */
export interface AnalogPinState extends BasePinState {
    type: 'analog';
    mode: 'input' | 'output';
    value: number; // 0-65535 (16-bit resolution)
    referenceVoltage: number;
    resolution: number; // bits (usually 16)
    maxValue: number; // 2^resolution - 1
}

/**
 * PWM pin state and configuration
 */
export interface PWMPinState extends BasePinState {
    type: 'pwm';
    dutyCycle: number; // 0-65535
    frequency: number; // Hz
    isActive: boolean;
    resolution: number; // bits
}

/**
 * Pin capability enumeration
 */
export type PinCapability = 
    | 'digital_io'
    | 'analog_input'
    | 'analog_output'
    | 'pwm'
    | 'touch'
    | 'i2c_scl'
    | 'i2c_sda'
    | 'spi_sck'
    | 'spi_mosi'
    | 'spi_miso'
    | 'spi_cs'
    | 'uart_tx'
    | 'uart_rx'
    | 'uart_rts'
    | 'uart_cts';

// === Communication Interface Definitions ===

/**
 * I2C bus state and configuration
 */
export interface I2CBusState {
    busId: number;
    sclPin: number;
    sdaPin: number;
    frequency: number; // Hz
    isActive: boolean;
    devices: I2CDeviceState[];
    pullups: boolean;
}

/**
 * I2C device on the bus
 */
export interface I2CDeviceState {
    address: number; // 7-bit address
    name?: string;
    isResponding: boolean;
    lastActivity: number;
    registers: Map<number, number>; // register -> value mapping
}

/**
 * SPI bus state and configuration
 */
export interface SPIBusState {
    busId: number;
    sckPin: number;
    mosiPin: number;
    misoPin: number;
    csPin?: number;
    frequency: number; // Hz
    mode: 0 | 1 | 2 | 3; // SPI mode
    bitOrder: 'MSB' | 'LSB';
    isActive: boolean;
    devices: SPIDeviceState[];
}

/**
 * SPI device on the bus
 */
export interface SPIDeviceState {
    csPin: number;
    name?: string;
    isSelected: boolean;
    lastActivity: number;
}

/**
 * UART port state and configuration
 */
export interface UARTPortState {
    portId: number;
    txPin: number;
    rxPin: number;
    rtsPin?: number;
    ctsPin?: number;
    baudRate: number;
    dataBits: 5 | 6 | 7 | 8;
    parity: 'none' | 'even' | 'odd';
    stopBits: 1 | 2;
    flowControl: 'none' | 'rts_cts';
    isActive: boolean;
    rxBuffer: number[];
    txBuffer: number[];
}

// === Sensor Interface Definitions ===

/**
 * Base sensor interface
 */
export interface SensorState {
    id: string;
    name: string;
    type: SensorType;
    isActive: boolean;
    lastReading: number;
    unit: string;
    range: { min: number; max: number };
    accuracy?: number;
    updateInterval: number; // ms
}

/**
 * Temperature sensor state
 */
export interface TemperatureSensorState extends SensorState {
    type: 'temperature';
    value: number; // Celsius
    calibrationOffset: number;
}

/**
 * Humidity sensor state
 */
export interface HumiditySensorState extends SensorState {
    type: 'humidity';
    value: number; // Percentage
}

/**
 * Light sensor state
 */
export interface LightSensorState extends SensorState {
    type: 'light';
    value: number; // Lux
    spectralResponse?: 'visible' | 'ir' | 'uv' | 'full_spectrum';
}

/**
 * Motion sensor state (accelerometer/gyroscope)
 */
export interface MotionSensorState extends SensorState {
    type: 'accelerometer' | 'gyroscope' | 'magnetometer';
    x: number;
    y: number;
    z: number;
    scale: number; // g-force for accel, dps for gyro, gauss for mag
}

/**
 * Pressure sensor state
 */
export interface PressureSensorState extends SensorState {
    type: 'pressure';
    value: number; // hPa or other unit
    altitude?: number; // calculated altitude in meters
}

/**
 * Generic sensor types
 */
export type SensorType = 
    | 'temperature'
    | 'humidity'
    | 'light'
    | 'accelerometer'
    | 'gyroscope'
    | 'magnetometer'
    | 'pressure'
    | 'proximity'
    | 'color'
    | 'sound'
    | 'gas'
    | 'custom';

// === Actuator Interface Definitions ===

/**
 * Base actuator interface
 */
export interface ActuatorState {
    id: string;
    name: string;
    type: ActuatorType;
    isActive: boolean;
    lastUpdate: number;
    pin?: number; // Associated pin if applicable
}

/**
 * LED actuator state
 */
export interface LEDState extends ActuatorState {
    type: 'led';
    brightness: number; // 0-1
    color?: { r: number; g: number; b: number; w?: number }; // RGB(W) values 0-255
    isOn: boolean;
}

/**
 * NeoPixel/WS2812 LED strip state
 */
export interface NeoPixelState extends ActuatorState {
    type: 'neopixel';
    pixelCount: number;
    pixels: Array<{ r: number; g: number; b: number; w?: number }>;
    brightness: number; // 0-1 global brightness
}

/**
 * Servo motor state
 */
export interface ServoState extends ActuatorState {
    type: 'servo';
    angle: number; // degrees
    minPulse: number; // microseconds
    maxPulse: number; // microseconds
    frequency: number; // Hz (usually 50)
}

/**
 * Buzzer/Speaker state
 */
export interface BuzzerState extends ActuatorState {
    type: 'buzzer';
    frequency: number; // Hz
    volume: number; // 0-1
    isPlaying: boolean;
    waveform: 'sine' | 'square' | 'triangle' | 'sawtooth';
}

/**
 * Display state (OLED, LCD, etc.)
 */
export interface DisplayState extends ActuatorState {
    type: 'display';
    width: number;
    height: number;
    pixelData: number[][]; // 2D array of pixel values
    brightness: number;
    isOn: boolean;
    colorDepth: number; // bits per pixel
}

/**
 * Generic actuator types
 */
export type ActuatorType = 
    | 'led'
    | 'neopixel'
    | 'servo'
    | 'motor'
    | 'buzzer'
    | 'relay'
    | 'display'
    | 'custom';

// === Board Feature Interface Definitions ===

/**
 * Board-specific features that don't fit into pin categories
 */
export interface BoardFeatureState {
    buttons: Map<string, ButtonState>;
    switches: Map<string, SwitchState>;
    onboardLeds: Map<string, LEDState>;
    resetButton: ButtonState;
    bootButton?: ButtonState;
    powerManagement: PowerManagementState;
    filesystem: FilesystemState;
    memory: MemoryState;
}

/**
 * Button state
 */
export interface ButtonState {
    id: string;
    pin?: number;
    isPressed: boolean;
    lastPressed: number;
    pressCount: number;
    debounceTime: number;
}

/**
 * Switch state
 */
export interface SwitchState {
    id: string;
    pin?: number;
    position: boolean; // true = on/high, false = off/low
    lastChanged: number;
}

/**
 * Power management state
 */
export interface PowerManagementState {
    voltage: number;
    current: number;
    powerMode: 'active' | 'sleep' | 'deep_sleep';
    batteryLevel?: number; // percentage if battery-powered
    isCharging?: boolean;
}

/**
 * Filesystem state
 */
export interface FilesystemState {
    totalSpace: number; // bytes
    usedSpace: number; // bytes
    freeSpace: number; // bytes
    files: Map<string, FileInfo>;
}

export interface FileInfo {
    name: string;
    path: string;
    size: number;
    lastModified: number;
    isDirectory: boolean;
    content?: string; // for text files only
}

/**
 * Memory state
 */
export interface MemoryState {
    totalRam: number; // bytes
    usedRam: number; // bytes
    freeRam: number; // bytes
    gcCollections: number;
}

// === Simulation Interface Definitions ===

/**
 * Simulation settings for virtual device behavior
 */
export interface SimulationSettings {
    isSimulated: boolean;
    realisticTiming: boolean;
    noiseLevel: number; // 0-1, amount of random noise to add to sensor readings
    updateInterval: number; // ms, how often to update simulated values
    sensorVariation: number; // 0-1, amount of realistic variation in sensor readings
    enablePhysicalLaws: boolean; // simulate realistic physical constraints
    randomSeed?: number; // for reproducible simulation
}

// === Dynamic Device Model Creation ===

/**
 * Device template for creating device twins
 */
export interface DeviceTemplate {
    boardId: string;
    displayName: string;
    description: string;
    manufacturer: string;
    
    // Pin definitions
    digitalPins: PinDefinition[];
    analogPins: PinDefinition[];
    pwmPins: PinDefinition[];
    
    // Communication interfaces
    i2cBuses: I2CBusDefinition[];
    spiBuses: SPIBusDefinition[];
    uartPorts: UARTPortDefinition[];
    
    // Built-in components
    builtinSensors: SensorDefinition[];
    builtinActuators: ActuatorDefinition[];
    boardFeatures: BoardFeatureDefinition[];
    
    // Physical specifications
    operatingVoltage: number;
    maxCurrent: number;
    flashSize: number;
    ramSize: number;
    
    // CircuitPython support
    circuitPythonVersion: string;
    supportedModules: string[];
}

/**
 * Pin definition for device templates
 */
export interface PinDefinition {
    pin: number;
    name: string;
    aliases: string[];
    capabilities: PinCapability[];
    isReserved: boolean;
    defaultMode?: string;
    voltage: number;
    maxCurrent?: number;
}

/**
 * Communication bus definitions
 */
export interface I2CBusDefinition {
    busId: number;
    sclPin: number;
    sdaPin: number;
    defaultFrequency: number;
    maxFrequency: number;
    hasPullups: boolean;
}

export interface SPIBusDefinition {
    busId: number;
    sckPin: number;
    mosiPin: number;
    misoPin: number;
    maxFrequency: number;
    supportedModes: number[];
}

export interface UARTPortDefinition {
    portId: number;
    txPin: number;
    rxPin: number;
    rtsPin?: number;
    ctsPin?: number;
    maxBaudRate: number;
}

/**
 * Component definitions for templates
 */
export interface SensorDefinition {
    id: string;
    name: string;
    type: SensorType;
    pin?: number;
    i2cAddress?: number;
    interface: 'analog' | 'digital' | 'i2c' | 'spi' | 'builtin';
    range: { min: number; max: number };
    accuracy: number;
    unit: string;
}

export interface ActuatorDefinition {
    id: string;
    name: string;
    type: ActuatorType;
    pin?: number;
    interface: 'digital' | 'pwm' | 'i2c' | 'spi' | 'builtin';
    specifications: Record<string, any>; // Type-specific specs
}

export interface BoardFeatureDefinition {
    type: 'button' | 'switch' | 'led' | 'display' | 'speaker';
    id: string;
    name: string;
    pin?: number;
    specifications: Record<string, any>;
}

// === Device State Synchronization ===

/**
 * State synchronization events
 */
export interface StateSyncEvent {
    type: 'pin_changed' | 'sensor_reading' | 'actuator_command' | 'config_changed';
    deviceId: string;
    timestamp: number;
    data: any;
    source: 'physical' | 'virtual' | 'user';
}

/**
 * State synchronization manager interface
 */
export interface IDeviceStateSynchronizer {
    // Core synchronization
    syncDeviceState(deviceId: string, state: Partial<DeviceTwinState>): Promise<boolean>;
    getDeviceState(deviceId: string): Promise<DeviceTwinState | null>;
    
    // Component-specific sync
    syncPinState(deviceId: string, pin: number, state: BasePinState): Promise<boolean>;
    syncSensorReading(deviceId: string, sensorId: string, value: number): Promise<boolean>;
    syncActuatorCommand(deviceId: string, actuatorId: string, command: any): Promise<boolean>;
    
    // Event handling
    onStateChanged(callback: (event: StateSyncEvent) => void): void;
    emitStateChange(event: StateSyncEvent): void;
    
    // Batch operations
    syncMultipleStates(updates: Array<{ deviceId: string; state: Partial<DeviceTwinState> }>): Promise<boolean[]>;
}

// === Device Model Factory ===

/**
 * Factory for creating device models dynamically
 */
export interface IDeviceModelFactory {
    // Template management
    registerTemplate(template: DeviceTemplate): void;
    getTemplate(boardId: string): DeviceTemplate | null;
    getAvailableTemplates(): DeviceTemplate[];
    
    // Device twin creation
    createDeviceTwin(boardId: string, deviceId: string, options?: DeviceCreationOptions): Promise<DeviceTwinState>;
    updateDeviceTwin(deviceId: string, updates: Partial<DeviceTemplate>): Promise<boolean>;
    
    // Component composition
    addSensorToDevice(deviceId: string, sensor: SensorDefinition): Promise<boolean>;
    addActuatorToDevice(deviceId: string, actuator: ActuatorDefinition): Promise<boolean>;
    removeSensorFromDevice(deviceId: string, sensorId: string): Promise<boolean>;
    removeActuatorFromDevice(deviceId: string, actuatorId: string): Promise<boolean>;
    
    // Validation
    validateDeviceConfiguration(template: DeviceTemplate): ValidationResult;
    validatePinAssignment(deviceId: string, pin: number, capability: PinCapability): boolean;
}

export interface DeviceCreationOptions {
    enableSimulation?: boolean;
    simulationSettings?: Partial<SimulationSettings>;
    initialState?: Partial<DeviceTwinState>;
    autoConnect?: boolean;
}

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

// === Export all interfaces ===
export * from './interfaces';