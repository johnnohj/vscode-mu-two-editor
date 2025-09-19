/**
 * Board Template Generator
 * 
 * Dynamically creates board templates by querying connected CircuitPython boards
 * via REPL commands. Stores templates in VS Code globalStorage for reuse.
 */

import * as vscode from 'vscode';
import { DeviceTemplate, PinDefinition, SensorDefinition, ActuatorDefinition } from './interfaces';

export interface REPLQueryResult {
    boardModule: string[];
    availablePins: string[];
    i2cInfo: any[];
    spiInfo: any[];
    uartInfo: any[];
    boardFeatures: string[];
    circuitPythonVersion: string;
    availableModules: string[];
}

export interface BoardIntrospectionData {
    boardId: string;
    displayName: string;
    pinMappings: Map<string, PinDefinition>;
    communicationBuses: {
        i2c: any[];
        spi: any[];
        uart: any[];
    };
    detectedSensors: SensorDefinition[];
    detectedActuators: ActuatorDefinition[];
    supportedModules: string[];
    circuitPythonVersion: string;
    introspectionTimestamp: number;
}

/**
 * Generates board templates by querying live CircuitPython boards
 */
export class BoardTemplateGenerator {
    private context: vscode.ExtensionContext;
    private templatesStorage: vscode.Memento;
    
    // REPL query commands for board introspection
    private readonly INTROSPECTION_COMMANDS = {
        // Get board module contents
        BOARD_DIR: `
import board
import json
try:
    board_attrs = [attr for attr in dir(board) if not attr.startswith('_')]
    print("BOARD_ATTRS:" + json.dumps(board_attrs))
except Exception as e:
    print("BOARD_ATTRS_ERROR:" + str(e))
`,
        
        // Get CircuitPython version and available modules
        VERSION_INFO: `
import sys
import json
try:
    version = sys.version
    modules = list(sys.modules.keys())
    print("VERSION_INFO:" + json.dumps({"version": version, "modules": modules}))
except Exception as e:
    print("VERSION_INFO_ERROR:" + str(e))
`,
        
        // Inspect pin capabilities
        PIN_CAPABILITIES: `
import board
import digitalio
import analogio
import json
try:
    pin_info = {}
    board_attrs = [attr for attr in dir(board) if not attr.startswith('_')]
    
    for attr_name in board_attrs:
        attr = getattr(board, attr_name)
        capabilities = []
        
        # Test digital I/O capability
        try:
            pin = digitalio.DigitalInOut(attr)
            capabilities.append("digital_io")
            pin.deinit()
        except:
            pass
        
        # Test analog input capability
        try:
            pin = analogio.AnalogIn(attr)
            capabilities.append("analog_input")
            pin.deinit()
        except:
            pass
        
        # Test PWM capability (basic check)
        try:
            import pwmio
            pwm = pwmio.PWMOut(attr)
            capabilities.append("pwm")
            pwm.deinit()
        except:
            pass
        
        if capabilities:
            pin_info[attr_name] = {
                "capabilities": capabilities,
                "pin_number": getattr(attr, 'number', None) if hasattr(attr, 'number') else None
            }
    
    print("PIN_CAPABILITIES:" + json.dumps(pin_info))
except Exception as e:
    print("PIN_CAPABILITIES_ERROR:" + str(e))
`,
        
        // Detect communication buses
        BUS_DETECTION: `
import board
import json
try:
    bus_info = {"i2c": [], "spi": [], "uart": []}
    
    # Check for I2C
    try:
        import busio
        if hasattr(board, 'I2C'):
            i2c = board.I2C()
            bus_info["i2c"].append({
                "default": True,
                "scl": str(board.SCL) if hasattr(board, 'SCL') else None,
                "sda": str(board.SDA) if hasattr(board, 'SDA') else None
            })
            i2c.deinit()
    except:
        pass
    
    # Check for SPI
    try:
        import busio
        if hasattr(board, 'SPI'):
            spi = board.SPI()
            bus_info["spi"].append({
                "default": True,
                "sck": str(board.SCK) if hasattr(board, 'SCK') else None,
                "mosi": str(board.MOSI) if hasattr(board, 'MOSI') else None,
                "miso": str(board.MISO) if hasattr(board, 'MISO') else None
            })
            spi.deinit()
    except:
        pass
    
    # Check for UART
    try:
        import busio
        if hasattr(board, 'UART'):
            bus_info["uart"].append({
                "default": True,
                "tx": str(board.TX) if hasattr(board, 'TX') else None,
                "rx": str(board.RX) if hasattr(board, 'RX') else None
            })
    except:
        pass
    
    print("BUS_DETECTION:" + json.dumps(bus_info))
except Exception as e:
    print("BUS_DETECTION_ERROR:" + str(e))
`,
        
        // Detect onboard sensors and actuators
        COMPONENT_DETECTION: `
import board
import json
try:
    components = {"sensors": [], "actuators": []}
    board_attrs = [attr for attr in dir(board) if not attr.startswith('_')]
    
    # Look for common sensor/actuator naming patterns
    sensor_patterns = ['TEMPERATURE', 'TEMP', 'HUMIDITY', 'LIGHT', 'ACCELEROMETER', 'GYRO', 'MAGNETOMETER']
    actuator_patterns = ['LED', 'NEOPIXEL', 'SPEAKER', 'BUZZER', 'MOTOR']
    
    for attr_name in board_attrs:
        attr_upper = attr_name.upper()
        
        # Check for sensors
        for pattern in sensor_patterns:
            if pattern in attr_upper:
                components["sensors"].append({
                    "name": attr_name,
                    "type": pattern.lower(),
                    "pin": attr_name
                })
                break
        
        # Check for actuators
        for pattern in actuator_patterns:
            if pattern in attr_upper:
                components["actuators"].append({
                    "name": attr_name,
                    "type": pattern.lower(),
                    "pin": attr_name
                })
                break
    
    print("COMPONENT_DETECTION:" + json.dumps(components))
except Exception as e:
    print("COMPONENT_DETECTION_ERROR:" + str(e))
`
    };

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.templatesStorage = context.globalState;
    }

    /**
     * Generate board template by querying a connected CircuitPython board
     */
    async generateBoardTemplate(
        boardId: string,
        devicePath: string,
        replInterface: any // Interface to send REPL commands
    ): Promise<DeviceTemplate | null> {
        try {
            // Check if template already exists in storage
            const existingTemplate = await this.getStoredTemplate(boardId);
            if (existingTemplate && this.isTemplateRecent(existingTemplate)) {
                return existingTemplate;
            }

            vscode.window.showInformationMessage(`Generating board template for ${boardId}...`);
            
            // Perform REPL introspection
            const introspectionData = await this.performREPLIntrospection(replInterface);
            if (!introspectionData) {
                throw new Error('Failed to introspect board via REPL');
            }

            // Create device template from introspection data
            const template = await this.createTemplateFromIntrospection(boardId, introspectionData);
            
            // Store template for future use
            await this.storeTemplate(boardId, template);
            
            vscode.window.showInformationMessage(`Board template generated for ${boardId}`);
            return template;
            
        } catch (error) {
            console.error('Board template generation failed:', error);
            vscode.window.showErrorMessage(`Failed to generate board template: ${error}`);
            return null;
        }
    }

    /**
     * Perform comprehensive REPL introspection
     */
    private async performREPLIntrospection(replInterface: any): Promise<BoardIntrospectionData | null> {
        try {
            const results: Partial<REPLQueryResult> = {};
            
            // Execute each introspection command
            for (const [commandName, command] of Object.entries(this.INTROSPECTION_COMMANDS)) {
                try {
                    console.log(`Executing REPL command: ${commandName}`);
                    const output = await this.executeREPLCommand(replInterface, command);
                    this.parseREPLOutput(output, results);
                    
                    // Small delay between commands to avoid overwhelming the board
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.warn(`REPL command ${commandName} failed:`, error);
                }
            }

            return this.processIntrospectionResults(results);
            
        } catch (error) {
            console.error('REPL introspection failed:', error);
            return null;
        }
    }

    /**
     * Execute a REPL command and return the output
     */
    private async executeREPLCommand(replInterface: any, command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            let output = '';
            let timeoutId: NodeJS.Timeout;
            
            // Set up timeout
            timeoutId = setTimeout(() => {
                reject(new Error('REPL command timeout'));
            }, 10000); // 10 second timeout
            
            // Set up output capture
            const onOutput = (data: string) => {
                output += data;
                
                // Check if command execution is complete
                if (output.includes('>>> ') || output.includes('... ')) {
                    clearTimeout(timeoutId);
                    replInterface.removeListener('output', onOutput);
                    resolve(output);
                }
            };
            
            replInterface.on('output', onOutput);
            
            // Send command
            replInterface.send(command);
        });
    }

    /**
     * Parse REPL output and extract structured data
     */
    private parseREPLOutput(output: string, results: Partial<REPLQueryResult>): void {
        const lines = output.split('\n');
        
        for (const line of lines) {
            try {
                if (line.startsWith('BOARD_ATTRS:')) {
                    results.boardModule = JSON.parse(line.substring(12));
                }
                else if (line.startsWith('VERSION_INFO:')) {
                    const versionInfo = JSON.parse(line.substring(13));
                    results.circuitPythonVersion = versionInfo.version;
                    results.availableModules = versionInfo.modules;
                }
                else if (line.startsWith('PIN_CAPABILITIES:')) {
                    const pinInfo = JSON.parse(line.substring(17));
                    results.availablePins = Object.keys(pinInfo);
                    // Store detailed pin info for later processing
                    (results as any).pinDetails = pinInfo;
                }
                else if (line.startsWith('BUS_DETECTION:')) {
                    const busInfo = JSON.parse(line.substring(14));
                    results.i2cInfo = busInfo.i2c || [];
                    results.spiInfo = busInfo.spi || [];
                    results.uartInfo = busInfo.uart || [];
                }
                else if (line.startsWith('COMPONENT_DETECTION:')) {
                    const componentInfo = JSON.parse(line.substring(20));
                    (results as any).detectedSensors = componentInfo.sensors || [];
                    (results as any).detectedActuators = componentInfo.actuators || [];
                }
            } catch (parseError) {
                console.warn('Failed to parse REPL output line:', line, parseError);
            }
        }
    }

    /**
     * Process introspection results into structured board data
     */
    private processIntrospectionResults(results: Partial<REPLQueryResult>): BoardIntrospectionData | null {
        if (!results.boardModule || !results.availablePins) {
            console.error('Missing essential board introspection data');
            return null;
        }

        const pinMappings = new Map<string, PinDefinition>();
        const pinDetails = (results as any).pinDetails || {};
        
        // Process pin information
        results.availablePins.forEach((pinName, index) => {
            const pinDetail = pinDetails[pinName] || {};
            const pinDef: PinDefinition = {
                pin: pinDetail.pin_number || index,
                name: pinName,
                aliases: [],
                capabilities: pinDetail.capabilities || ['digital_io'],
                isReserved: false,
                voltage: 3.3 // Default, could be detected in future
            };
            pinMappings.set(pinName, pinDef);
        });

        return {
            boardId: 'unknown', // Will be set by caller
            displayName: 'Generated Board Template',
            pinMappings,
            communicationBuses: {
                i2c: results.i2cInfo || [],
                spi: results.spiInfo || [],
                uart: results.uartInfo || []
            },
            detectedSensors: this.convertToSensorDefinitions((results as any).detectedSensors || []),
            detectedActuators: this.convertToActuatorDefinitions((results as any).detectedActuators || []),
            supportedModules: results.availableModules || [],
            circuitPythonVersion: results.circuitPythonVersion || 'unknown',
            introspectionTimestamp: Date.now()
        };
    }

    /**
     * Create DeviceTemplate from introspection data
     */
    private async createTemplateFromIntrospection(
        boardId: string,
        introspectionData: BoardIntrospectionData
    ): Promise<DeviceTemplate> {
        
        const template: DeviceTemplate = {
            boardId,
            displayName: introspectionData.displayName || `${boardId} (Generated)`,
            description: `Auto-generated template from board introspection on ${new Date().toISOString()}`,
            manufacturer: 'Unknown',
            
            // Convert pin mappings to arrays
            digitalPins: Array.from(introspectionData.pinMappings.values()).filter(p => 
                p.capabilities.includes('digital_io')),
            analogPins: Array.from(introspectionData.pinMappings.values()).filter(p => 
                p.capabilities.includes('analog_input')),
            pwmPins: Array.from(introspectionData.pinMappings.values()).filter(p => 
                p.capabilities.includes('pwm')),
            
            // Convert communication bus information
            i2cBuses: introspectionData.communicationBuses.i2c.map((bus, index) => ({
                busId: index,
                sclPin: this.findPinNumber(bus.scl, introspectionData.pinMappings) || 5,
                sdaPin: this.findPinNumber(bus.sda, introspectionData.pinMappings) || 4,
                defaultFrequency: 100000,
                maxFrequency: 400000,
                hasPullups: true
            })),
            
            spiBuses: introspectionData.communicationBuses.spi.map((bus, index) => ({
                busId: index,
                sckPin: this.findPinNumber(bus.sck, introspectionData.pinMappings) || 18,
                mosiPin: this.findPinNumber(bus.mosi, introspectionData.pinMappings) || 19,
                misoPin: this.findPinNumber(bus.miso, introspectionData.pinMappings) || 16,
                maxFrequency: 40000000,
                supportedModes: [0, 1, 2, 3]
            })),
            
            uartPorts: introspectionData.communicationBuses.uart.map((uart, index) => ({
                portId: index,
                txPin: this.findPinNumber(uart.tx, introspectionData.pinMappings) || 1,
                rxPin: this.findPinNumber(uart.rx, introspectionData.pinMappings) || 3,
                maxBaudRate: 2000000
            })),
            
            // Include detected sensors and actuators
            builtinSensors: introspectionData.detectedSensors,
            builtinActuators: introspectionData.detectedActuators,
            boardFeatures: [], // Could be expanded in future
            
            // Board specifications (estimated)
            operatingVoltage: 3.3,
            maxCurrent: 500,
            flashSize: 2 * 1024 * 1024, // Default 2MB
            ramSize: 320 * 1024, // Default 320KB
            
            circuitPythonVersion: introspectionData.circuitPythonVersion,
            supportedModules: introspectionData.supportedModules
        };

        return template;
    }

    /**
     * Helper method to find pin number by pin name
     */
    private findPinNumber(pinName: string | undefined, pinMappings: Map<string, PinDefinition>): number | undefined {
        if (!pinName) return undefined;
        
        const pin = pinMappings.get(pinName);
        return pin?.pin;
    }

    /**
     * Convert detected sensor info to SensorDefinition
     */
    private convertToSensorDefinitions(detectedSensors: any[]): SensorDefinition[] {
        return detectedSensors.map(sensor => ({
            id: sensor.name.toLowerCase(),
            name: sensor.name,
            type: sensor.type as any,
            pin: sensor.pin,
            interface: 'builtin',
            range: this.getDefaultSensorRange(sensor.type),
            accuracy: 1.0,
            unit: this.getDefaultSensorUnit(sensor.type)
        }));
    }

    /**
     * Convert detected actuator info to ActuatorDefinition
     */
    private convertToActuatorDefinitions(detectedActuators: any[]): ActuatorDefinition[] {
        return detectedActuators.map(actuator => ({
            id: actuator.name.toLowerCase(),
            name: actuator.name,
            type: actuator.type as any,
            pin: actuator.pin,
            interface: 'builtin',
            specifications: {}
        }));
    }

    /**
     * Get default sensor range based on type
     */
    private getDefaultSensorRange(sensorType: string): { min: number; max: number } {
        const ranges: { [key: string]: { min: number; max: number } } = {
            temperature: { min: -40, max: 85 },
            humidity: { min: 0, max: 100 },
            light: { min: 0, max: 10000 },
            accelerometer: { min: -16, max: 16 },
            gyroscope: { min: -2000, max: 2000 },
            magnetometer: { min: -4912, max: 4912 }
        };
        
        return ranges[sensorType] || { min: 0, max: 100 };
    }

    /**
     * Get default sensor unit based on type
     */
    private getDefaultSensorUnit(sensorType: string): string {
        const units: { [key: string]: string } = {
            temperature: '°C',
            humidity: '%',
            light: 'lux',
            accelerometer: 'g',
            gyroscope: 'dps',
            magnetometer: 'gauss'
        };
        
        return units[sensorType] || '';
    }

    // === Template Storage Management ===

    /**
     * Store generated template in VS Code global storage
     */
    private async storeTemplate(boardId: string, template: DeviceTemplate): Promise<void> {
        const storageKey = `boardTemplate_${boardId}`;
        const templateWithMetadata = {
            template,
            generatedAt: Date.now(),
            version: '1.0.0'
        };
        
        await this.templatesStorage.update(storageKey, templateWithMetadata);
    }

    /**
     * Retrieve stored template from VS Code global storage
     */
    private async getStoredTemplate(boardId: string): Promise<DeviceTemplate | null> {
        const storageKey = `boardTemplate_${boardId}`;
        const stored = this.templatesStorage.get<any>(storageKey);
        
        if (stored && stored.template) {
            return stored.template;
        }
        
        return null;
    }

    /**
     * Check if stored template is recent enough to use
     */
    private isTemplateRecent(template: any): boolean {
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
        return template.generatedAt && (Date.now() - template.generatedAt) < maxAge;
    }

    /**
     * Get all stored board templates
     */
    async getAllStoredTemplates(): Promise<Map<string, DeviceTemplate>> {
        const templates = new Map<string, DeviceTemplate>();
        
        // VS Code doesn't provide a direct way to enumerate storage keys
        // For now, we'll track known board IDs separately
        const knownBoardIds = this.templatesStorage.get<string[]>('knownBoardIds') || [];
        
        for (const boardId of knownBoardIds) {
            const template = await this.getStoredTemplate(boardId);
            if (template) {
                templates.set(boardId, template);
            }
        }
        
        return templates;
    }

    /**
     * Clear all stored templates (for testing/cleanup)
     */
    async clearAllTemplates(): Promise<void> {
        const knownBoardIds = this.templatesStorage.get<string[]>('knownBoardIds') || [];
        
        for (const boardId of knownBoardIds) {
            const storageKey = `boardTemplate_${boardId}`;
            await this.templatesStorage.update(storageKey, undefined);
        }
        
        await this.templatesStorage.update('knownBoardIds', []);
    }

    /**
     * Track a new board ID in known boards list
     */
    private async trackBoardId(boardId: string): Promise<void> {
        const knownBoardIds = this.templatesStorage.get<string[]>('knownBoardIds') || [];
        
        if (!knownBoardIds.includes(boardId)) {
            knownBoardIds.push(boardId);
            await this.templatesStorage.update('knownBoardIds', knownBoardIds);
        }
    }
}