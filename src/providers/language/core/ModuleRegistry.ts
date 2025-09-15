/**
 * Module Registry Adapter
 * 
 * Bridges existing module definitions with the new language service interface.
 * Designed for future extraction as standalone CircuitPython language server.
 */

import { 
    MODULE_REGISTRY, 
    BOARD_DEFINITIONS,
    COMMON_IMPORTS 
} from '../moduleDefinitions';
import { 
    CircuitPythonModule,
    CircuitPythonBoard,
    ModuleMember,
    BoardPin,
    PinCapability
} from '../types';

export interface ModuleRegistryInterface {
    modules: CircuitPythonModule[];
    boards: CircuitPythonBoard[];
    getModule(name: string): CircuitPythonModule | null;
    getBoard(id: string): CircuitPythonBoard | null;
    getModuleMembers(moduleName: string): ModuleMember[];
    getCommonImports(): string[];
}

class ModuleRegistryAdapter implements ModuleRegistryInterface {
    
    get modules(): CircuitPythonModule[] {
        return Array.from(MODULE_REGISTRY.values());
    }

    get boards(): CircuitPythonBoard[] {
        return Object.entries(BOARD_DEFINITIONS).map(([id, boardDef]) => 
            this.convertBoardDefinition(id, boardDef)
        );
    }

    getModule(name: string): CircuitPythonModule | null {
        return MODULE_REGISTRY.get(name) || null;
    }

    getBoard(id: string): CircuitPythonBoard | null {
        const boardDef = BOARD_DEFINITIONS[id as keyof typeof BOARD_DEFINITIONS];
        if (!boardDef) return null;
        
        return this.convertBoardDefinition(id, boardDef);
    }

    getModuleMembers(moduleName: string): ModuleMember[] {
        const module = this.getModule(moduleName);
        if (!module) return [];

        const members: ModuleMember[] = [];

        // Add functions
        for (const func of module.functions) {
            members.push({
                name: func.name,
                type: 'function',
                description: func.description,
                parameters: func.parameters,
                example: func.examples?.[0]
            });
        }

        // Add classes (as constructors)
        for (const cls of module.classes) {
            members.push({
                name: cls.name,
                type: 'class',
                description: cls.description,
                parameters: cls.constructor.parameters,
                example: cls.constructor.examples?.[0]
            });

            // Add class methods as members
            for (const method of cls.methods) {
                members.push({
                    name: method.name,
                    type: 'function',
                    description: method.description,
                    parameters: method.parameters,
                    example: method.examples?.[0]
                });
            }

            // Add class properties
            for (const prop of cls.properties) {
                members.push({
                    name: prop.name,
                    type: 'property',
                    description: prop.description,
                    example: prop.examples?.[0]
                });
            }
        }

        // Add constants
        for (const constant of module.constants) {
            members.push({
                name: constant.name,
                type: 'constant',
                description: constant.description
            });
        }

        // Add enums (as constants)
        for (const enumDef of module.enums) {
            members.push({
                name: enumDef.name,
                type: 'constant',
                description: enumDef.description
            });
        }

        return members;
    }

    getCommonImports(): string[] {
        return [...COMMON_IMPORTS];
    }

    private convertBoardDefinition(id: string, boardDef: any): CircuitPythonBoard {
        const pins: BoardPin[] = boardDef.pins.map((pinName: string, index: number) => ({
            name: pinName,
            number: index,
            description: `Pin ${pinName}`,
            aliases: this.getPinAliases(pinName, boardDef.aliases),
            capabilities: this.inferPinCapabilities(pinName),
            protocols: this.inferPinProtocols(pinName)
        }));

        return {
            id,
            name: id,
            displayName: this.formatBoardDisplayName(id),
            description: `CircuitPython board: ${id}`,
            pins,
            aliases: boardDef.aliases || {},
            builtinModules: ['board', 'microcontroller', 'digitalio', 'analogio', 'busio', 'time', 'gc'],
            supportedProtocols: ['UART', 'I2C', 'SPI', 'PWM'],
            firmwareInfo: {
                minVersion: '8.0.0',
                features: ['USB', 'WiFi', 'Bluetooth'] // Default features
            }
        };
    }

    private getPinAliases(pinName: string, aliases: Record<string, string>): string[] {
        const pinAliases: string[] = [];
        
        // Find aliases that point to this pin
        for (const [alias, target] of Object.entries(aliases)) {
            if (target === pinName) {
                pinAliases.push(alias);
            }
        }
        
        // Also check if this pin is an alias itself
        if (aliases[pinName]) {
            pinAliases.push(aliases[pinName]);
        }
        
        return pinAliases;
    }

    private inferPinCapabilities(pinName: string): PinCapability[] {
        const capabilities: PinCapability[] = [];
        
        // All pins support digital I/O
        capabilities.push({
            type: 'digital',
            properties: { direction: 'input_output' }
        });

        // Analog pins (starting with A or containing analog indicators)
        if (pinName.startsWith('A') || pinName.includes('ANALOG')) {
            capabilities.push({
                type: 'analog',
                properties: { resolution: 16, voltage_range: [0, 3.3] }
            });
        }

        // PWM capability (most digital pins)
        if (pinName.startsWith('D') || pinName.startsWith('GP') || pinName === 'LED') {
            capabilities.push({
                type: 'pwm',
                properties: { frequency_range: [1, 100000] }
            });
        }

        // I2C pins
        if (pinName === 'SDA' || pinName === 'SCL') {
            capabilities.push({
                type: 'i2c',
                properties: { speed: 400000 }
            });
        }

        // SPI pins
        if (['MOSI', 'MISO', 'SCK', 'CS'].some(spi => pinName.includes(spi))) {
            capabilities.push({
                type: 'spi',
                properties: { speed: 1000000 }
            });
        }

        // UART pins  
        if (['TX', 'RX'].some(uart => pinName.includes(uart))) {
            capabilities.push({
                type: 'uart',
                properties: { baud_rate: 115200 }
            });
        }

        return capabilities;
    }

    private inferPinProtocols(pinName: string): string[] {
        const protocols: string[] = ['GPIO']; // All pins support GPIO
        
        if (pinName.startsWith('A') || pinName.includes('ANALOG')) {
            protocols.push('ADC');
        }
        
        if (pinName.startsWith('D') || pinName.startsWith('GP') || pinName === 'LED') {
            protocols.push('PWM');
        }
        
        if (pinName === 'SDA' || pinName === 'SCL') {
            protocols.push('I2C');
        }
        
        if (['MOSI', 'MISO', 'SCK', 'CS'].some(spi => pinName.includes(spi))) {
            protocols.push('SPI');
        }
        
        if (['TX', 'RX'].some(uart => pinName.includes(uart))) {
            protocols.push('UART');
        }
        
        return protocols;
    }

    private formatBoardDisplayName(id: string): string {
        return id
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }
}

// Export singleton instance
export const moduleRegistry = new ModuleRegistryAdapter();