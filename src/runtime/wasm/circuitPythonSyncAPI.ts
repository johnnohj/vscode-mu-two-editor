// src/runtime/circuitPythonSyncAPI.ts
// Phase 4E: CircuitPython Sync API for WASM Child Process
// Provides synchronous hardware API for CircuitPython compatibility within WASM runtime

import { getLogger } from '../../utils/unifiedLogger';

const logger = getLogger();

export interface SyncAPICall {
    type: 'sync-call';
    id: number;
    service: string;
    args: any[];
}

export interface SyncAPIResponse {
    type: 'sync-response';
    id: number;
    response: {
        success: boolean;
        result?: any;
        error?: string;
    };
}

/**
 * Phase 4E: CircuitPython Sync API for WASM Runtime
 *
 * Provides synchronous hardware operations that can be used from within
 * the WASM CircuitPython runtime, bridging to the host extension via IPC.
 */
export class CircuitPythonSyncAPI {
    private messageId = 0;
    private pendingCalls = new Map<number, { resolve: Function; reject: Function }>();

    constructor() {
        this.setupMessageHandling();
        logger.info('WASM_SYNC_API', 'CircuitPython Sync API initialized');
    }

    /**
     * Set up message handling for IPC communication with host extension
     */
    private setupMessageHandling(): void {
        // Listen for messages from host extension
        process.stdin?.on('data', (data: Buffer) => {
            this.handleHostMessage(data);
        });

        // Handle process cleanup
        process.on('exit', () => {
            this.cleanup();
        });

        process.on('SIGINT', () => {
            this.cleanup();
            process.exit(0);
        });
    }

    /**
     * Handle incoming messages from host extension
     */
    private handleHostMessage(data: Buffer): void {
        try {
            const lines = data.toString().split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;

                let message: SyncAPIResponse;
                try {
                    message = JSON.parse(line);
                } catch (parseError) {
                    // Not a JSON message, might be regular stdio
                    continue;
                }

                if (message.type === 'sync-response') {
                    this.handleSyncResponse(message);
                }
            }

        } catch (error) {
            logger.error('WASM_SYNC_API', `Error processing host message: ${error}`);
        }
    }

    /**
     * Handle synchronous response from host extension
     */
    private handleSyncResponse(message: SyncAPIResponse): void {
        const { id, response } = message;
        const pendingCall = this.pendingCalls.get(id);

        if (pendingCall) {
            this.pendingCalls.delete(id);

            if (response.success) {
                pendingCall.resolve(response.result);
            } else {
                pendingCall.reject(new Error(response.error || 'Unknown error'));
            }
        }
    }

    /**
     * Make a synchronous call to the host extension
     */
    private async callHost(service: string, ...args: any[]): Promise<any> {
        const id = ++this.messageId;

        const promise = new Promise((resolve, reject) => {
            this.pendingCalls.set(id, { resolve, reject });

            // Set timeout for the call
            setTimeout(() => {
                if (this.pendingCalls.has(id)) {
                    this.pendingCalls.delete(id);
                    reject(new Error(`Host service call timeout: ${service}`));
                }
            }, 5000); // 5 second timeout
        });

        const message: SyncAPICall = {
            type: 'sync-call',
            id,
            service,
            args
        };

        process.stdout?.write(JSON.stringify(message) + '\n');

        return promise;
    }

    // ===== Hardware API Methods =====

    /**
     * Set digital pin value (HIGH/LOW)
     */
    public async digitalWrite(pin: number, value: boolean): Promise<boolean> {
        return await this.callHost('hardware.digitalWrite', pin, value);
    }

    /**
     * Read digital pin value
     */
    public async digitalRead(pin: number): Promise<boolean> {
        return await this.callHost('hardware.digitalRead', pin);
    }

    /**
     * Read analog pin value (0-65535)
     */
    public async analogRead(pin: number): Promise<number> {
        return await this.callHost('hardware.analogRead', pin);
    }

    /**
     * Set analog pin value (PWM output, 0-65535)
     */
    public async analogWrite(pin: number, value: number): Promise<boolean> {
        return await this.callHost('hardware.analogWrite', pin, value);
    }

    /**
     * Write data to I2C device
     */
    public async i2cWrite(address: number, data: Uint8Array): Promise<boolean> {
        return await this.callHost('hardware.i2cWrite', address, Array.from(data));
    }

    /**
     * Read data from I2C device
     */
    public async i2cRead(address: number, length: number): Promise<Uint8Array> {
        const result = await this.callHost('hardware.i2cRead', address, length);
        return new Uint8Array(result);
    }

    // ===== Extension API Methods =====

    /**
     * Get current device information
     */
    public async getDeviceInfo(): Promise<any> {
        return await this.callHost('extension.getDeviceInfo');
    }

    /**
     * Install a CircuitPython library
     */
    public async installLibrary(libraryName: string): Promise<boolean> {
        return await this.callHost('extension.installLibrary', libraryName);
    }

    /**
     * Get current workspace path
     */
    public async getCurrentWorkspace(): Promise<string | null> {
        return await this.callHost('extension.getCurrentWorkspace');
    }

    /**
     * Write file to filesystem
     */
    public async writeFile(path: string, content: string): Promise<boolean> {
        return await this.callHost('extension.writeFile', path, content);
    }

    /**
     * Read file from filesystem
     */
    public async readFile(path: string): Promise<string> {
        return await this.callHost('extension.readFile', path);
    }

    /**
     * Check if file exists
     */
    public async fileExists(path: string): Promise<boolean> {
        return await this.callHost('extension.fileExists', path);
    }

    // ===== Utility API Methods =====

    /**
     * Log message to host extension
     */
    public async log(level: 'info' | 'warn' | 'error', message: string): Promise<void> {
        await this.callHost('util.log', level, message);
    }

    /**
     * Get current timestamp
     */
    public async time(): Promise<number> {
        return await this.callHost('util.time');
    }

    /**
     * Sleep for specified milliseconds
     */
    public async sleep(ms: number): Promise<void> {
        await this.callHost('util.sleep', ms);
    }

    /**
     * Clean up pending calls and resources
     */
    private cleanup(): void {
        // Reject all pending calls
        for (const [id, { reject }] of this.pendingCalls) {
            reject(new Error('Sync API cleanup - process terminating'));
        }
        this.pendingCalls.clear();

        logger.info('WASM_SYNC_API', 'CircuitPython Sync API cleaned up');
    }
}

// Global instance for WASM runtime use
let syncAPI: CircuitPythonSyncAPI | null = null;

/**
 * Get the global sync API instance
 */
export function getSyncAPI(): CircuitPythonSyncAPI {
    if (!syncAPI) {
        syncAPI = new CircuitPythonSyncAPI();
    }
    return syncAPI;
}

/**
 * Initialize sync API for WASM runtime
 */
export function initializeSyncAPI(): CircuitPythonSyncAPI {
    return getSyncAPI();
}

// ===== CircuitPython Module Compatibility Exports =====

/**
 * Digital I/O module compatibility
 */
export const digitalio = {
    DigitalInOut: class {
        private pin: number;
        private direction: 'input' | 'output' = 'input';

        constructor(pin: number) {
            this.pin = pin;
        }

        get value(): Promise<boolean> {
            if (this.direction === 'input') {
                return getSyncAPI().digitalRead(this.pin);
            }
            throw new Error('Cannot read from output pin');
        }

        set value(val: Promise<boolean>) {
            if (this.direction === 'output') {
                val.then(value => getSyncAPI().digitalWrite(this.pin, value));
            } else {
                throw new Error('Cannot write to input pin');
            }
        }

        switch_to_output(value: boolean = false): void {
            this.direction = 'output';
            getSyncAPI().digitalWrite(this.pin, value);
        }

        switch_to_input(): void {
            this.direction = 'input';
        }
    },

    Direction: {
        INPUT: 'input',
        OUTPUT: 'output'
    }
};

/**
 * Analog I/O module compatibility
 */
export const analogio = {
    AnalogIn: class {
        private pin: number;

        constructor(pin: number) {
            this.pin = pin;
        }

        get value(): Promise<number> {
            return getSyncAPI().analogRead(this.pin);
        }

        get reference_voltage(): number {
            return 3.3; // Standard CircuitPython reference voltage
        }
    },

    AnalogOut: class {
        private pin: number;

        constructor(pin: number) {
            this.pin = pin;
        }

        set value(val: Promise<number>) {
            val.then(value => getSyncAPI().analogWrite(this.pin, value));
        }
    }
};

/**
 * Bus I/O module compatibility
 */
export const busio = {
    I2C: class {
        constructor(scl: number, sda: number) {
            // I2C initialization would be handled by the host extension
        }

        writeto(address: number, buffer: Uint8Array): Promise<boolean> {
            return getSyncAPI().i2cWrite(address, buffer);
        }

        readfrom_into(address: number, buffer: Uint8Array): Promise<void> {
            return getSyncAPI().i2cRead(address, buffer.length)
                .then(data => {
                    buffer.set(data);
                });
        }
    }
};

/**
 * Time module compatibility
 */
export const time = {
    sleep: (seconds: number): Promise<void> => {
        return getSyncAPI().sleep(seconds * 1000);
    },

    monotonic: (): Promise<number> => {
        return getSyncAPI().time().then(ms => ms / 1000);
    }
};