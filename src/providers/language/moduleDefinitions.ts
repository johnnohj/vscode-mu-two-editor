// Copyright (c) Mu Two Editor contributors.
// Licensed under the MIT License.

'use strict';

import { 
    CircuitPythonModule, 
    CircuitPythonClass, 
    CircuitPythonFunction, 
    CircuitPythonProperty, 
    CircuitPythonEnum,
    CircuitPythonConstant 
} from './types';

/**
 * Core CircuitPython module definitions for IntelliSense
 * Based on CircuitPython 9.x API
 */

export const DIGITALIO_MODULE: CircuitPythonModule = {
    name: 'digitalio',
    description: 'Digital input and output control',
    classes: [
        {
            name: 'DigitalInOut',
            description: 'Digital input/output pin control',
            constructor: {
                name: '__init__',
                description: 'Create a new DigitalInOut object associated with the pin',
                parameters: [
                    {
                        name: 'pin',
                        type: 'microcontroller.Pin',
                        description: 'The pin to control',
                        optional: false
                    }
                ],
                returnType: 'None',
                signature: 'DigitalInOut(pin: microcontroller.Pin)',
                examples: [
                    'import board\nimport digitalio\nled = digitalio.DigitalInOut(board.LED)'
                ]
            },
            methods: [
                {
                    name: 'deinit',
                    description: 'Turn off the DigitalInOut and release the pin for other use',
                    parameters: [],
                    returnType: 'None',
                    signature: 'deinit() -> None'
                },
                {
                    name: 'switch_to_output',
                    description: 'Switch the pin to output mode',
                    parameters: [
                        {
                            name: 'value',
                            type: 'bool',
                            description: 'Initial output value',
                            optional: true,
                            defaultValue: 'False'
                        },
                        {
                            name: 'drive_mode',
                            type: 'DriveMode',
                            description: 'Drive mode for the output',
                            optional: true,
                            defaultValue: 'DriveMode.PUSH_PULL'
                        }
                    ],
                    returnType: 'None',
                    signature: 'switch_to_output(value: bool = False, drive_mode: DriveMode = DriveMode.PUSH_PULL) -> None'
                },
                {
                    name: 'switch_to_input',
                    description: 'Switch the pin to input mode',
                    parameters: [
                        {
                            name: 'pull',
                            type: 'Pull | None',
                            description: 'Pull resistor configuration',
                            optional: true,
                            defaultValue: 'None'
                        }
                    ],
                    returnType: 'None',
                    signature: 'switch_to_input(pull: Pull | None = None) -> None'
                }
            ],
            properties: [
                {
                    name: 'direction',
                    type: 'Direction',
                    description: 'The direction of the pin - input or output',
                    readonly: false,
                    examples: ['pin.direction = digitalio.Direction.OUTPUT']
                },
                {
                    name: 'value',
                    type: 'bool',
                    description: 'The digital value of the pin - True for high, False for low',
                    readonly: false,
                    examples: ['led.value = True', 'button_pressed = button.value']
                },
                {
                    name: 'drive_mode',
                    type: 'DriveMode',
                    description: 'The drive mode of the pin when in output mode',
                    readonly: false
                },
                {
                    name: 'pull',
                    type: 'Pull | None',
                    description: 'The pull resistor configuration when in input mode',
                    readonly: false
                }
            ],
            staticMethods: [],
            classVars: []
        }
    ],
    functions: [],
    constants: [],
    enums: [
        {
            name: 'Direction',
            description: 'Pin direction enumeration',
            values: [
                { name: 'INPUT', value: 0, description: 'Pin configured as input' },
                { name: 'OUTPUT', value: 1, description: 'Pin configured as output' }
            ]
        },
        {
            name: 'DriveMode', 
            description: 'Output drive mode enumeration',
            values: [
                { name: 'PUSH_PULL', value: 0, description: 'Standard push-pull output' },
                { name: 'OPEN_DRAIN', value: 1, description: 'Open-drain output' }
            ]
        },
        {
            name: 'Pull',
            description: 'Input pull resistor enumeration',
            values: [
                { name: 'UP', value: 1, description: 'Enable pull-up resistor' },
                { name: 'DOWN', value: 2, description: 'Enable pull-down resistor' }
            ]
        }
    ]
};

export const ANALOGIO_MODULE: CircuitPythonModule = {
    name: 'analogio',
    description: 'Analog input and output control',
    classes: [
        {
            name: 'AnalogIn',
            description: 'Analog input pin control',
            constructor: {
                name: '__init__',
                description: 'Create an analog input pin object',
                parameters: [
                    {
                        name: 'pin',
                        type: 'microcontroller.Pin',
                        description: 'The analog input pin to use',
                        optional: false
                    }
                ],
                returnType: 'None',
                signature: 'AnalogIn(pin: microcontroller.Pin)',
                examples: [
                    'import board\nimport analogio\nadc = analogio.AnalogIn(board.A0)'
                ]
            },
            methods: [
                {
                    name: 'deinit',
                    description: 'Turn off the AnalogIn and release the pin',
                    parameters: [],
                    returnType: 'None',
                    signature: 'deinit() -> None'
                }
            ],
            properties: [
                {
                    name: 'value',
                    type: 'int',
                    description: 'The 16-bit analog value (0-65535)',
                    readonly: true,
                    examples: ['reading = adc.value', 'voltage = adc.value / 65535 * 3.3']
                },
                {
                    name: 'reference_voltage',
                    type: 'float',
                    description: 'The reference voltage used for analog readings',
                    readonly: true
                }
            ],
            staticMethods: [],
            classVars: []
        },
        {
            name: 'AnalogOut',
            description: 'Analog output (DAC) pin control',
            constructor: {
                name: '__init__',
                description: 'Create an analog output pin object',
                parameters: [
                    {
                        name: 'pin',
                        type: 'microcontroller.Pin',
                        description: 'The analog output pin to use',
                        optional: false
                    }
                ],
                returnType: 'None',
                signature: 'AnalogOut(pin: microcontroller.Pin)',
                examples: [
                    'import board\nimport analogio\ndac = analogio.AnalogOut(board.A0)'
                ]
            },
            methods: [
                {
                    name: 'deinit',
                    description: 'Turn off the AnalogOut and release the pin',
                    parameters: [],
                    returnType: 'None',
                    signature: 'deinit() -> None'
                }
            ],
            properties: [
                {
                    name: 'value',
                    type: 'int',
                    description: 'The 16-bit analog output value (0-65535)',
                    readonly: false,
                    examples: ['dac.value = 32768  # Set to half voltage']
                }
            ],
            staticMethods: [],
            classVars: []
        }
    ],
    functions: [],
    constants: [],
    enums: []
};

export const BUSIO_MODULE: CircuitPythonModule = {
    name: 'busio',
    description: 'Hardware communication buses',
    classes: [
        {
            name: 'I2C',
            description: 'Two-wire serial protocol for communication with sensors and peripherals',
            constructor: {
                name: '__init__',
                description: 'Create an I2C bus object',
                parameters: [
                    {
                        name: 'scl',
                        type: 'microcontroller.Pin',
                        description: 'The clock pin',
                        optional: false
                    },
                    {
                        name: 'sda',
                        type: 'microcontroller.Pin', 
                        description: 'The data pin',
                        optional: false
                    },
                    {
                        name: 'frequency',
                        type: 'int',
                        description: 'Clock frequency in Hz',
                        optional: true,
                        defaultValue: '400000'
                    }
                ],
                returnType: 'None',
                signature: 'I2C(scl: microcontroller.Pin, sda: microcontroller.Pin, *, frequency: int = 400000)',
                examples: [
                    'import board\nimport busio\ni2c = busio.I2C(board.SCL, board.SDA)'
                ]
            },
            methods: [
                {
                    name: 'deinit',
                    description: 'Release the I2C bus',
                    parameters: [],
                    returnType: 'None',
                    signature: 'deinit() -> None'
                },
                {
                    name: 'scan',
                    description: 'Scan for devices on the I2C bus',
                    parameters: [],
                    returnType: 'list[int]',
                    signature: 'scan() -> list[int]',
                    examples: ['devices = i2c.scan()']
                },
                {
                    name: 'try_lock',
                    description: 'Attempt to grab the lock for exclusive use',
                    parameters: [],
                    returnType: 'bool',
                    signature: 'try_lock() -> bool'
                },
                {
                    name: 'unlock',
                    description: 'Release the lock',
                    parameters: [],
                    returnType: 'None',
                    signature: 'unlock() -> None'
                },
                {
                    name: 'readfrom_into',
                    description: 'Read from a device into a buffer',
                    parameters: [
                        {
                            name: 'address',
                            type: 'int',
                            description: '7-bit device address',
                            optional: false
                        },
                        {
                            name: 'buffer',
                            type: 'WriteableBuffer',
                            description: 'Buffer to read data into',
                            optional: false
                        }
                    ],
                    returnType: 'None',
                    signature: 'readfrom_into(address: int, buffer: WriteableBuffer) -> None'
                },
                {
                    name: 'writeto',
                    description: 'Write data to a device',
                    parameters: [
                        {
                            name: 'address',
                            type: 'int',
                            description: '7-bit device address',
                            optional: false
                        },
                        {
                            name: 'buffer',
                            type: 'ReadableBuffer',
                            description: 'Data to write',
                            optional: false
                        }
                    ],
                    returnType: 'None',
                    signature: 'writeto(address: int, buffer: ReadableBuffer) -> None'
                }
            ],
            properties: [],
            staticMethods: [],
            classVars: []
        },
        {
            name: 'SPI',
            description: 'Serial Peripheral Interface for high-speed serial communication',
            constructor: {
                name: '__init__',
                description: 'Create an SPI bus object',
                parameters: [
                    {
                        name: 'clock',
                        type: 'microcontroller.Pin',
                        description: 'The clock pin',
                        optional: false
                    },
                    {
                        name: 'MOSI',
                        type: 'microcontroller.Pin | None',
                        description: 'The Master Out Slave In pin',
                        optional: true,
                        defaultValue: 'None'
                    },
                    {
                        name: 'MISO',
                        type: 'microcontroller.Pin | None',
                        description: 'The Master In Slave Out pin',
                        optional: true,
                        defaultValue: 'None'
                    }
                ],
                returnType: 'None',
                signature: 'SPI(clock: microcontroller.Pin, *, MOSI: microcontroller.Pin | None = None, MISO: microcontroller.Pin | None = None)',
                examples: [
                    'import board\nimport busio\nspi = busio.SPI(board.SCK, MOSI=board.MOSI, MISO=board.MISO)'
                ]
            },
            methods: [
                {
                    name: 'deinit',
                    description: 'Release the SPI bus',
                    parameters: [],
                    returnType: 'None',
                    signature: 'deinit() -> None'
                },
                {
                    name: 'configure',
                    description: 'Configure the SPI bus parameters',
                    parameters: [
                        {
                            name: 'baudrate',
                            type: 'int',
                            description: 'Clock frequency in Hz',
                            optional: true,
                            defaultValue: '100000'
                        },
                        {
                            name: 'polarity',
                            type: 'int',
                            description: 'Clock polarity (0 or 1)',
                            optional: true,
                            defaultValue: '0'
                        },
                        {
                            name: 'phase',
                            type: 'int',
                            description: 'Clock phase (0 or 1)',
                            optional: true,
                            defaultValue: '0'
                        }
                    ],
                    returnType: 'None',
                    signature: 'configure(*, baudrate: int = 100000, polarity: int = 0, phase: int = 0) -> None'
                }
            ],
            properties: [],
            staticMethods: [],
            classVars: []
        },
        {
            name: 'UART',
            description: 'Universal asynchronous receiver-transmitter for serial communication',
            constructor: {
                name: '__init__',
                description: 'Create a UART object',
                parameters: [
                    {
                        name: 'tx',
                        type: 'microcontroller.Pin | None',
                        description: 'The transmit pin',
                        optional: true,
                        defaultValue: 'None'
                    },
                    {
                        name: 'rx',
                        type: 'microcontroller.Pin | None',
                        description: 'The receive pin',
                        optional: true,
                        defaultValue: 'None'
                    },
                    {
                        name: 'baudrate',
                        type: 'int',
                        description: 'Communication speed in bits per second',
                        optional: true,
                        defaultValue: '9600'
                    },
                    {
                        name: 'bits',
                        type: 'int',
                        description: 'Number of data bits (7, 8, or 9)',
                        optional: true,
                        defaultValue: '8'
                    }
                ],
                returnType: 'None',
                signature: 'UART(tx: microcontroller.Pin | None = None, rx: microcontroller.Pin | None = None, *, baudrate: int = 9600, bits: int = 8)',
                examples: [
                    'import board\nimport busio\nuart = busio.UART(board.TX, board.RX, baudrate=9600)'
                ]
            },
            methods: [
                {
                    name: 'deinit',
                    description: 'Release the UART',
                    parameters: [],
                    returnType: 'None',
                    signature: 'deinit() -> None'
                },
                {
                    name: 'read',
                    description: 'Read data from UART',
                    parameters: [
                        {
                            name: 'nbytes',
                            type: 'int',
                            description: 'Number of bytes to read',
                            optional: true,
                            defaultValue: 'None'
                        }
                    ],
                    returnType: 'bytes | None',
                    signature: 'read(nbytes: int = None) -> bytes | None'
                },
                {
                    name: 'write',
                    description: 'Write data to UART',
                    parameters: [
                        {
                            name: 'buffer',
                            type: 'ReadableBuffer',
                            description: 'Data to write',
                            optional: false
                        }
                    ],
                    returnType: 'int | None',
                    signature: 'write(buffer: ReadableBuffer) -> int | None'
                }
            ],
            properties: [
                {
                    name: 'baudrate',
                    type: 'int',
                    description: 'Current baud rate',
                    readonly: false
                },
                {
                    name: 'in_waiting',
                    type: 'int',
                    description: 'Number of bytes available to read',
                    readonly: true
                }
            ],
            staticMethods: [],
            classVars: []
        }
    ],
    functions: [],
    constants: [],
    enums: []
};

export const TIME_MODULE: CircuitPythonModule = {
    name: 'time',
    description: 'Time-related functions',
    classes: [],
    functions: [
        {
            name: 'sleep',
            description: 'Suspend execution for the given number of seconds',
            parameters: [
                {
                    name: 'seconds',
                    type: 'float',
                    description: 'Number of seconds to sleep',
                    optional: false
                }
            ],
            returnType: 'None',
            signature: 'sleep(seconds: float) -> None',
            examples: [
                'import time\ntime.sleep(1)  # Sleep for 1 second'
            ]
        },
        {
            name: 'monotonic',
            description: 'Return the value of a monotonic clock in seconds',
            parameters: [],
            returnType: 'float',
            signature: 'monotonic() -> float',
            examples: [
                'import time\nstart = time.monotonic()\n# ... do something ...\nelapsed = time.monotonic() - start'
            ]
        },
        {
            name: 'time',
            description: 'Return the current time in seconds since the Epoch',
            parameters: [],
            returnType: 'int',
            signature: 'time() -> int'
        }
    ],
    constants: [],
    enums: []
};

export const GC_MODULE: CircuitPythonModule = {
    name: 'gc',
    description: 'Garbage collection control',
    classes: [],
    functions: [
        {
            name: 'collect',
            description: 'Run a garbage collection',
            parameters: [],
            returnType: 'None',
            signature: 'collect() -> None',
            examples: [
                'import gc\ngc.collect()  # Free up memory'
            ]
        },
        {
            name: 'mem_free',
            description: 'Return the amount of free memory in bytes',
            parameters: [],
            returnType: 'int',
            signature: 'mem_free() -> int'
        },
        {
            name: 'mem_alloc',
            description: 'Return the amount of allocated memory in bytes',
            parameters: [],
            returnType: 'int',
            signature: 'mem_alloc() -> int'
        }
    ],
    constants: [],
    enums: []
};

// Board-specific pin definitions (example for common boards)
export const BOARD_DEFINITIONS = {
    'circuitplayground_express': {
        pins: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D12', 'D13', 'LED', 'NEOPIXEL', 'BUTTON_A', 'BUTTON_B'],
        aliases: {
            'LED': 'D13',
            'BUTTON_A': 'D4',
            'BUTTON_B': 'D5'
        }
    },
    'pico': {
        pins: ['GP0', 'GP1', 'GP2', 'GP3', 'GP4', 'GP5', 'GP6', 'GP7', 'GP8', 'GP9', 'GP10', 'GP11', 'GP12', 'GP13', 'GP14', 'GP15', 'GP16', 'GP17', 'GP18', 'GP19', 'GP20', 'GP21', 'GP22', 'GP26', 'GP27', 'GP28', 'LED'],
        aliases: {
            'LED': 'GP25',
            'A0': 'GP26',
            'A1': 'GP27', 
            'A2': 'GP28'
        }
    },
    'feather_m4_express': {
        pins: ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'D0', 'D1', 'D4', 'D5', 'D6', 'D9', 'D10', 'D11', 'D12', 'D13', 'SDA', 'SCL', 'LED', 'NEOPIXEL'],
        aliases: {
            'LED': 'D13',
            'SDA': 'D20',
            'SCL': 'D21'
        }
    }
};

// Module registry for easy access
export const MODULE_REGISTRY = new Map<string, CircuitPythonModule>([
    ['digitalio', DIGITALIO_MODULE],
    ['analogio', ANALOGIO_MODULE],
    ['busio', BUSIO_MODULE],
    ['time', TIME_MODULE],
    ['gc', GC_MODULE]
]);

// Common import patterns for auto-completion
export const COMMON_IMPORTS = [
    'import board',
    'import digitalio',
    'import analogio',
    'import busio',
    'import time',
    'import neopixel',
    'import adafruit_motor.servo',
    'import adafruit_motor.stepper',
    'from adafruit_motor import servo',
    'from adafruit_motor import stepper'
];