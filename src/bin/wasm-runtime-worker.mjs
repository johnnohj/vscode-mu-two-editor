#!/usr/bin/env node
/**
 * CircuitPython WASM Runtime Worker Process
 *
 * This worker process runs the CircuitPython WASM runtime and handles
 * IPC communication with the VS Code extension. It provides a stable
 * interface for code execution and hardware simulation.
 */

import _createCircuitPythonModule from './circuitpython.mjs';

class WasmRuntimeWorker {
    constructor() {
        this.circuitPython = null;
        this.isInitialized = false;
        this.hardwareState = {
            pins: new Map(),
            sensors: new Map(),
            timestamp: Date.now()
        };

        // Initialize hardware state
        this.initializeHardwareState();

        // Set up IPC communication
        this.setupIPC();

        console.log('WASM Runtime Worker started');
    }

    async initialize() {
        try {
            console.log('Initializing CircuitPython WASM...');

            // Create CircuitPython WASM module with I/O handlers
            this.circuitPython = await _createCircuitPythonModule({
                stdout: (charCode) => {
                    this.outputBuffer += String.fromCharCode(charCode);
                },
                stderr: (charCode) => {
                    this.errorBuffer += String.fromCharCode(charCode);
                }
            });

            // Initialize with heap size from environment variable
            const memorySize = parseInt(process.env.CIRCUITPYTHON_WASM_MEMORY || '512') * 1024;
            this.circuitPython._mp_js_init_with_heap(memorySize);

            // Initialize REPL
            this.circuitPython._mp_js_repl_init();

            this.isInitialized = true;
            console.log('✓ CircuitPython WASM initialized successfully');

            // Notify parent process that we're ready
            this.sendResponse({
                id: 'init',
                success: true,
                result: { status: 'ready' },
                executionTime: 0
            });

        } catch (error) {
            console.error('Failed to initialize CircuitPython WASM:', error);
            this.sendResponse({
                id: 'init',
                success: false,
                error: error.message,
                executionTime: 0
            });
        }
    }

    setupIPC() {
        // Handle messages from parent process
        process.on('message', (message) => {
            this.handleMessage(message);
        });

        // Handle process termination
        process.on('SIGTERM', () => {
            console.log('WASM Runtime Worker shutting down...');
            this.cleanup();
            process.exit(0);
        });

        process.on('SIGINT', () => {
            console.log('WASM Runtime Worker interrupted...');
            this.cleanup();
            process.exit(0);
        });
    }

    async handleMessage(message) {
        const { id, type, payload } = message;
        const startTime = Date.now();

        try {
            let result;

            switch (type) {
                case 'execute':
                    result = await this.executeCode(payload);
                    break;

                case 'query':
                    result = await this.handleQuery(payload);
                    break;

                case 'reset':
                    result = await this.reset();
                    break;

                case 'configure':
                    result = await this.configure(payload);
                    break;

                case 'hardware_query':
                    result = await this.getHardwareState(payload);
                    break;

                case 'hardware_set':
                    result = await this.setHardwareState(payload);
                    break;

                default:
                    throw new Error(`Unknown message type: ${type}`);
            }

            this.sendResponse({
                id,
                success: true,
                result,
                executionTime: Date.now() - startTime,
                hardwareState: this.getCurrentHardwareState()
            });

        } catch (error) {
            this.sendResponse({
                id,
                success: false,
                error: error.message,
                executionTime: Date.now() - startTime
            });
        }
    }

    async executeCode(payload) {
        if (!this.isInitialized) {
            throw new Error('WASM runtime not initialized');
        }

        const { code, mode = 'repl', enableHardwareMonitoring = true } = payload;

        this.outputBuffer = '';
        this.errorBuffer = '';

        try {
            if (mode === 'repl') {
                // Execute code through REPL character by character
                for (const char of code) {
                    this.circuitPython._mp_js_repl_process_char(char.charCodeAt(0));
                }
                // Send Enter to execute
                this.circuitPython._mp_js_repl_process_char(13);

            } else if (mode === 'file') {
                // Execute as a complete file (if supported)
                if (this.circuitPython._mp_js_exec_str) {
                    this.circuitPython._mp_js_exec_str(code);
                } else {
                    // Fallback to REPL mode
                    for (const char of code + '\n') {
                        this.circuitPython._mp_js_repl_process_char(char.charCodeAt(0));
                    }
                }
            }

            // Simulate hardware changes based on code execution
            if (enableHardwareMonitoring) {
                this.simulateHardwareChanges(code);
            }

            return {
                output: this.outputBuffer,
                error: this.errorBuffer || undefined,
                mode
            };

        } catch (error) {
            return {
                output: this.outputBuffer,
                error: error.message,
                mode
            };
        }
    }

    async handleQuery(payload) {
        const { queryType } = payload;

        switch (queryType) {
            case 'ready':
                return { status: this.isInitialized ? 'ready' : 'not_ready' };

            case 'health':
                return {
                    status: 'healthy',
                    initialized: this.isInitialized,
                    timestamp: Date.now()
                };

            default:
                throw new Error(`Unknown query type: ${queryType}`);
        }
    }

    async reset() {
        if (this.isInitialized && this.circuitPython._mp_js_repl_init) {
            // Reset REPL to clean state
            this.circuitPython._mp_js_repl_init();
        }

        // Reset hardware state
        this.initializeHardwareState();

        return { status: 'reset_complete' };
    }

    async configure(payload) {
        const { boardProfile, sensors, gpios, mockData } = payload;

        // Configure virtual hardware based on profile
        if (sensors) {
            for (const sensor of sensors) {
                this.hardwareState.sensors.set(sensor.id, {
                    type: sensor.type,
                    value: sensor.value,
                    range: sensor.range,
                    lastReading: Date.now(),
                    isActive: sensor.isActive
                });
            }
        }

        if (gpios) {
            for (const gpio of gpios) {
                this.hardwareState.pins.set(gpio.pin, {
                    mode: gpio.mode,
                    value: gpio.value,
                    pullup: gpio.pullup,
                    pulldown: gpio.pulldown,
                    lastChanged: Date.now()
                });
            }
        }

        return {
            status: 'configured',
            boardProfile: boardProfile?.boardId || 'default',
            sensorCount: sensors?.length || 0,
            gpioCount: gpios?.length || 0
        };
    }

    async getHardwareState(payload) {
        const { queryType = 'full_state' } = payload;

        this.hardwareState.timestamp = Date.now();

        return {
            queryType,
            state: this.getCurrentHardwareState()
        };
    }

    async setHardwareState(payload) {
        const { pins, sensors } = payload;
        let changesCount = 0;

        if (pins) {
            for (const pinUpdate of pins) {
                const existing = this.hardwareState.pins.get(pinUpdate.pin);
                if (existing) {
                    existing.value = pinUpdate.value;
                    if (pinUpdate.mode) existing.mode = pinUpdate.mode;
                    existing.lastChanged = Date.now();
                    changesCount++;
                }
            }
        }

        if (sensors) {
            for (const sensorUpdate of sensors) {
                const existing = this.hardwareState.sensors.get(sensorUpdate.id);
                if (existing) {
                    existing.value = sensorUpdate.value;
                    existing.lastReading = Date.now();
                    changesCount++;
                }
            }
        }

        this.hardwareState.timestamp = Date.now();

        return {
            status: 'updated',
            changesApplied: changesCount
        };
    }

    initializeHardwareState() {
        // Initialize with default pin states
        for (let i = 0; i < 20; i++) {
            this.hardwareState.pins.set(i, {
                mode: 'input',
                value: false,
                pullup: false,
                pulldown: false,
                lastChanged: Date.now()
            });
        }

        // Initialize with default sensors
        this.hardwareState.sensors.set('temp_sensor', {
            type: 'temperature',
            value: 22.5,
            range: { min: -40, max: 85 },
            lastReading: Date.now(),
            isActive: true
        });

        this.hardwareState.sensors.set('light_sensor', {
            type: 'light',
            value: 500,
            range: { min: 0, max: 10000 },
            lastReading: Date.now(),
            isActive: true
        });

        this.hardwareState.timestamp = Date.now();
    }

    simulateHardwareChanges(code) {
        // Simple hardware simulation based on code patterns

        // GPIO operations simulation
        if (code.includes('digitalio') || code.includes('DigitalInOut')) {
            // Simulate digital pin changes
            const pinMatch = code.match(/board\.(\w+)/g);
            if (pinMatch) {
                for (const match of pinMatch) {
                    const pinName = match.replace('board.', '');
                    // Map pin names to numbers (simplified)
                    const pinNumber = this.mapPinNameToNumber(pinName);
                    if (pinNumber !== -1) {
                        const pinState = this.hardwareState.pins.get(pinNumber);
                        if (pinState) {
                            // Toggle pin value for simulation
                            pinState.value = !pinState.value;
                            pinState.lastChanged = Date.now();
                        }
                    }
                }
            }
        }

        // Sensor reading simulation
        if (code.includes('temperature') || code.includes('temp')) {
            const tempSensor = this.hardwareState.sensors.get('temp_sensor');
            if (tempSensor) {
                // Add some variation to temperature
                tempSensor.value += (Math.random() - 0.5) * 2; // ±1°C variation
                tempSensor.lastReading = Date.now();
            }
        }

        if (code.includes('light')) {
            const lightSensor = this.hardwareState.sensors.get('light_sensor');
            if (lightSensor) {
                // Add some variation to light sensor
                lightSensor.value += (Math.random() - 0.5) * 100; // ±50 lux variation
                lightSensor.value = Math.max(0, Math.min(10000, lightSensor.value)); // Clamp to range
                lightSensor.lastReading = Date.now();
            }
        }
    }

    mapPinNameToNumber(pinName) {
        // Simple mapping for common pin names to numbers
        const pinMap = {
            'D0': 0, 'D1': 1, 'D2': 2, 'D3': 3, 'D4': 4, 'D5': 5,
            'D6': 6, 'D7': 7, 'D8': 8, 'D9': 9, 'D10': 10, 'D11': 11,
            'D12': 12, 'D13': 13, 'LED': 13, 'A0': 14, 'A1': 15, 'A2': 16
        };
        return pinMap[pinName] ?? -1;
    }

    getCurrentHardwareState() {
        return {
            pins: this.hardwareState.pins,
            sensors: this.hardwareState.sensors,
            timestamp: this.hardwareState.timestamp
        };
    }

    sendResponse(response) {
        if (process.send) {
            process.send(response);
        } else {
            console.log('Response:', JSON.stringify(response, null, 2));
        }
    }

    cleanup() {
        // Clean up WASM runtime resources
        if (this.circuitPython && this.circuitPython._mp_js_deinit) {
            try {
                this.circuitPython._mp_js_deinit();
            } catch (error) {
                console.error('Error during WASM cleanup:', error);
            }
        }

        this.isInitialized = false;
        console.log('WASM Runtime Worker cleaned up');
    }
}

// Initialize and start the worker
const worker = new WasmRuntimeWorker();
worker.initialize().catch(error => {
    console.error('Failed to start WASM Runtime Worker:', error);
    process.exit(1);
});