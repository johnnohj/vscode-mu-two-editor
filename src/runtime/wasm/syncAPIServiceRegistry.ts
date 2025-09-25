// src/runtime/syncAPIServiceRegistry.ts
// Phase 4E: Sync API Service Handler Registry
// Manages service handlers for WASM sync bridge operations

import * as vscode from 'vscode';
import { getLogger } from '../../utils/unifiedLogger';
// Removed over-engineered serviceRegistry and runtime coordinator

const logger = getLogger();

export type SyncAPIHandler = (serviceName: string, ...args: any[]) => Promise<any>;

/**
 * Registry for sync API service handlers
 */
export class SyncAPIServiceRegistry {
    private static instance: SyncAPIServiceRegistry;
    private handlers = new Map<string, SyncAPIHandler>();

    private constructor() {
        this.registerDefaultHandlers();
    }

    public static getInstance(): SyncAPIServiceRegistry {
        if (!SyncAPIServiceRegistry.instance) {
            SyncAPIServiceRegistry.instance = new SyncAPIServiceRegistry();
        }
        return SyncAPIServiceRegistry.instance;
    }

    /**
     * Register a service handler
     */
    public registerHandler(serviceName: string, handler: SyncAPIHandler): void {
        this.handlers.set(serviceName, handler);
        logger.info('SYNC_API_REGISTRY', `Registered handler for service: ${serviceName}`);
    }

    /**
     * Get a service handler
     */
    public getHandler(serviceName: string): SyncAPIHandler | undefined {
        return this.handlers.get(serviceName);
    }

    /**
     * Execute a service call
     */
    public async executeService(serviceName: string, ...args: any[]): Promise<any> {
        const handler = this.handlers.get(serviceName);
        if (!handler) {
            throw new Error(`Unknown service: ${serviceName}`);
        }

        try {
            return await handler(serviceName, ...args);
        } catch (error) {
            logger.error('SYNC_API_REGISTRY', `Service execution failed for ${serviceName}: ${error}`);
            throw error;
        }
    }

    /**
     * Register default handlers for hardware and extension operations
     */
    private registerDefaultHandlers(): void {
        // Hardware operation handlers
        this.registerHardwareHandlers();

        // Extension operation handlers
        this.registerExtensionHandlers();

        // Utility operation handlers
        this.registerUtilityHandlers();
    }

    /**
     * Register hardware operation handlers
     */
    private registerHardwareHandlers(): void {
        // Digital I/O operations
        this.registerHandler('hardware.digitalWrite', async (serviceName: string, pin: number, value: boolean): Promise<boolean> => {
            logger.info('SYNC_API_HARDWARE', `digitalWrite: pin=${pin}, value=${value}`);

            try {
                const runtimeCoordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
                if (!runtimeCoordinator) {
                    throw new Error('Runtime coordinator not available');
                }

                const device = await runtimeCoordinator.getActiveDevice();
                if (device && typeof device.setDigitalPin === 'function') {
                    await device.setDigitalPin(pin, value);
                    return true;
                }

                // Fallback to simulated hardware for WASM runtime
                logger.info('SYNC_API_HARDWARE', `Simulated digitalWrite: pin D${pin} = ${value ? 'HIGH' : 'LOW'}`);
                return true;

            } catch (error) {
                logger.error('SYNC_API_HARDWARE', `digitalWrite failed: ${error}`);
                throw error;
            }
        });

        this.registerHandler('hardware.digitalRead', async (serviceName: string, pin: number): Promise<boolean> => {
            logger.info('SYNC_API_HARDWARE', `digitalRead: pin=${pin}`);

            try {
                const runtimeCoordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
                if (!runtimeCoordinator) {
                    throw new Error('Runtime coordinator not available');
                }

                const device = await runtimeCoordinator.getActiveDevice();
                if (device && typeof device.readDigitalPin === 'function') {
                    return await device.readDigitalPin(pin);
                }

                // Fallback to simulated reading for WASM runtime
                const simulatedValue = Math.random() > 0.5;
                logger.info('SYNC_API_HARDWARE', `Simulated digitalRead: pin D${pin} = ${simulatedValue ? 'HIGH' : 'LOW'}`);
                return simulatedValue;

            } catch (error) {
                logger.error('SYNC_API_HARDWARE', `digitalRead failed: ${error}`);
                throw error;
            }
        });

        this.registerHandler('hardware.analogRead', async (serviceName: string, pin: number): Promise<number> => {
            logger.info('SYNC_API_HARDWARE', `analogRead: pin=${pin}`);

            try {
                const runtimeCoordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
                if (!runtimeCoordinator) {
                    throw new Error('Runtime coordinator not available');
                }

                const device = await runtimeCoordinator.getActiveDevice();
                if (device && typeof device.readAnalogPin === 'function') {
                    return await device.readAnalogPin(pin);
                }

                // Fallback to simulated analog reading for WASM runtime
                const simulatedValue = Math.floor(Math.random() * 65535);
                logger.info('SYNC_API_HARDWARE', `Simulated analogRead: pin A${pin} = ${simulatedValue}`);
                return simulatedValue;

            } catch (error) {
                logger.error('SYNC_API_HARDWARE', `analogRead failed: ${error}`);
                throw error;
            }
        });

        this.registerHandler('hardware.analogWrite', async (serviceName: string, pin: number, value: number): Promise<boolean> => {
            logger.info('SYNC_API_HARDWARE', `analogWrite: pin=${pin}, value=${value}`);

            try {
                const runtimeCoordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
                if (!runtimeCoordinator) {
                    throw new Error('Runtime coordinator not available');
                }

                const device = await runtimeCoordinator.getActiveDevice();
                if (device && typeof device.setAnalogPin === 'function') {
                    await device.setAnalogPin(pin, value);
                    return true;
                }

                // Fallback to simulated PWM for WASM runtime
                logger.info('SYNC_API_HARDWARE', `Simulated analogWrite: pin A${pin} = ${value} (${Math.round(value / 65535 * 100)}%)`);
                return true;

            } catch (error) {
                logger.error('SYNC_API_HARDWARE', `analogWrite failed: ${error}`);
                throw error;
            }
        });

        // I2C operations
        this.registerHandler('hardware.i2cWrite', async (serviceName: string, address: number, data: number[]): Promise<boolean> => {
            const dataArray = new Uint8Array(data);
            logger.info('SYNC_API_HARDWARE', `i2cWrite: address=0x${address.toString(16)}, length=${dataArray.length}`);

            try {
                const runtimeCoordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
                if (!runtimeCoordinator) {
                    throw new Error('Runtime coordinator not available');
                }

                const device = await runtimeCoordinator.getActiveDevice();
                if (device && typeof device.i2cWrite === 'function') {
                    return await device.i2cWrite(address, dataArray);
                }

                // Fallback to simulated I2C for WASM runtime
                logger.info('SYNC_API_HARDWARE', `Simulated i2cWrite: 0x${address.toString(16)} <- [${Array.from(dataArray).map(b => '0x' + b.toString(16)).join(', ')}]`);
                return true;

            } catch (error) {
                logger.error('SYNC_API_HARDWARE', `i2cWrite failed: ${error}`);
                throw error;
            }
        });

        this.registerHandler('hardware.i2cRead', async (serviceName: string, address: number, length: number): Promise<number[]> => {
            logger.info('SYNC_API_HARDWARE', `i2cRead: address=0x${address.toString(16)}, length=${length}`);

            try {
                const runtimeCoordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
                if (!runtimeCoordinator) {
                    throw new Error('Runtime coordinator not available');
                }

                const device = await runtimeCoordinator.getActiveDevice();
                if (device && typeof device.i2cRead === 'function') {
                    const result = await device.i2cRead(address, length);
                    return Array.from(result);
                }

                // Fallback to simulated I2C reading for WASM runtime
                const simulatedData = new Uint8Array(length);
                for (let i = 0; i < length; i++) {
                    simulatedData[i] = Math.floor(Math.random() * 256);
                }
                logger.info('SYNC_API_HARDWARE', `Simulated i2cRead: 0x${address.toString(16)} -> [${Array.from(simulatedData).map(b => '0x' + b.toString(16)).join(', ')}]`);
                return Array.from(simulatedData);

            } catch (error) {
                logger.error('SYNC_API_HARDWARE', `i2cRead failed: ${error}`);
                throw error;
            }
        });
    }

    /**
     * Register extension operation handlers
     */
    private registerExtensionHandlers(): void {
        this.registerHandler('extension.getDeviceInfo', async (): Promise<any> => {
            try {
                const runtimeCoordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
                if (!runtimeCoordinator) {
                    return null;
                }

                const device = await runtimeCoordinator.getActiveDevice();
                return device ? device.getInfo() : null;

            } catch (error) {
                logger.error('SYNC_API_EXTENSION', `getDeviceInfo failed: ${error}`);
                return null;
            }
        });

        this.registerHandler('extension.installLibrary', async (serviceName: string, libraryName: string): Promise<boolean> => {
            logger.info('SYNC_API_EXTENSION', `installLibrary: ${libraryName}`);

            try {
                const cliProcessor = getService('cliProcessor');
                if (!cliProcessor) {
                    throw new Error('CLI processor not available');
                }

                const result = await cliProcessor.processCommand('install', [libraryName]);
                return result.type === 'success' || result.type === 'progress';

            } catch (error) {
                logger.error('SYNC_API_EXTENSION', `installLibrary failed: ${error}`);
                throw error;
            }
        });

        this.registerHandler('extension.getCurrentWorkspace', async (): Promise<string | null> => {
            return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || null;
        });

        this.registerHandler('extension.writeFile', async (serviceName: string, path: string, content: string): Promise<boolean> => {
            try {
                const uri = vscode.Uri.file(path);
                await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
                logger.info('SYNC_API_EXTENSION', `File written: ${path}`);
                return true;

            } catch (error) {
                logger.error('SYNC_API_EXTENSION', `writeFile failed: ${error}`);
                throw error;
            }
        });

        this.registerHandler('extension.readFile', async (serviceName: string, path: string): Promise<string> => {
            try {
                const uri = vscode.Uri.file(path);
                const data = await vscode.workspace.fs.readFile(uri);
                return data.toString('utf8');

            } catch (error) {
                logger.error('SYNC_API_EXTENSION', `readFile failed: ${error}`);
                throw error;
            }
        });

        this.registerHandler('extension.fileExists', async (serviceName: string, path: string): Promise<boolean> => {
            try {
                const uri = vscode.Uri.file(path);
                await vscode.workspace.fs.stat(uri);
                return true;

            } catch (error) {
                return false;
            }
        });
    }

    /**
     * Register utility operation handlers
     */
    private registerUtilityHandlers(): void {
        this.registerHandler('util.log', async (serviceName: string, level: string, message: string): Promise<void> => {
            switch (level.toLowerCase()) {
                case 'error':
                    logger.error('WASM_USER', message);
                    break;
                case 'warn':
                    logger.warn('WASM_USER', message);
                    break;
                case 'info':
                default:
                    logger.info('WASM_USER', message);
                    break;
            }
        });

        this.registerHandler('util.time', async (): Promise<number> => {
            return Date.now();
        });

        this.registerHandler('util.sleep', async (serviceName: string, ms: number): Promise<void> => {
            return new Promise(resolve => setTimeout(resolve, ms));
        });
    }

    /**
     * Clear all handlers
     */
    public clear(): void {
        this.handlers.clear();
        logger.info('SYNC_API_REGISTRY', 'All handlers cleared');
    }
}

// Convenience functions
export function registerSyncAPIHandler(serviceName: string, handler: SyncAPIHandler): void {
    SyncAPIServiceRegistry.getInstance().registerHandler(serviceName, handler);
}

export function getSyncAPIHandler(serviceName: string): SyncAPIHandler | undefined {
    return SyncAPIServiceRegistry.getInstance().getHandler(serviceName);
}

export function executeSyncAPIService(serviceName: string, ...args: any[]): Promise<any> {
    return SyncAPIServiceRegistry.getInstance().executeService(serviceName, ...args);
}