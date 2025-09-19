/**
 * Runtime-Aware Device Manager
 *
 * Updates the device management system to work with multiple Python runtimes
 * while maintaining compatibility with the existing hardware abstraction layer.
 */

import * as vscode from 'vscode';
import { DeviceManager, DeviceConfiguration } from '../devices/core/deviceManager';
import { MuDevice, IDevice } from '../devices/core/deviceDetector';
import {
    IRuntimeManager,
    IPythonRuntime,
    PythonRuntimeType,
    RuntimeDevice
} from './IPythonRuntime';
import {
    IHardwareAbstraction,
    HardwareAbstractionFactory
} from '../devices/hardware/HardwareAbstraction';

/**
 * Enhanced device configuration with runtime awareness
 */
export interface RuntimeAwareDeviceConfiguration extends DeviceConfiguration {
    preferredRuntime?: PythonRuntimeType;
    runtimeCapabilities?: string[];
    autoDetectRuntime?: boolean;
}

/**
 * Device information with runtime detection
 */
export interface RuntimeAwareDevice extends MuDevice {
    detectedRuntime?: PythonRuntimeType;
    runtimeVersion?: string;
    supportedRuntimes: PythonRuntimeType[];
    hardwareAbstraction?: IHardwareAbstraction;
}

/**
 * Runtime-Aware Device Manager
 *
 * Extends the existing DeviceManager to support multiple Python runtimes
 * while maintaining backward compatibility with CircuitPython-focused code.
 */
export class RuntimeAwareDeviceManager extends DeviceManager {
    private runtimeManager: IRuntimeManager;
    private deviceRuntimeMap = new Map<string, {
        device: RuntimeAwareDevice;
        runtime: IPythonRuntime;
        hardware: IHardwareAbstraction;
    }>();

    constructor(
        context: vscode.ExtensionContext,
        runtimeManager: IRuntimeManager
    ) {
        super(context);
        this.runtimeManager = runtimeManager;
        this.setupRuntimeEventHandlers();
    }

    /**
     * Enhanced device connection with runtime detection and selection
     */
    async connectToDevice(
        device: RuntimeAwareDevice,
        config?: RuntimeAwareDeviceConfiguration
    ): Promise<boolean> {
        try {
            console.log(`Connecting to device: ${device.displayName}`);

            // Step 1: Detect or select appropriate runtime
            const selectedRuntime = await this.selectRuntimeForDevice(device, config);
            if (!selectedRuntime) {
                throw new Error(`No compatible runtime found for device: ${device.displayName}`);
            }

            console.log(`Selected runtime: ${selectedRuntime.type} for device: ${device.displayName}`);

            // Step 2: Create hardware abstraction for the runtime
            const hardwareAbstraction = await this.createRuntimeAwareHardwareAbstraction(
                device,
                selectedRuntime
            );

            // Step 3: Connect runtime to device
            const runtimeConnected = await selectedRuntime.connectToDevice(device.path);
            if (!runtimeConnected) {
                throw new Error(`Failed to connect ${selectedRuntime.type} runtime to device`);
            }

            // Step 4: Connect hardware abstraction
            const hardwareConnected = await hardwareAbstraction.connect();
            if (!hardwareConnected) {
                throw new Error('Failed to connect hardware abstraction');
            }

            // Step 5: Store device-runtime-hardware mapping
            this.deviceRuntimeMap.set(device.path, {
                device,
                runtime: selectedRuntime,
                hardware: hardwareAbstraction
            });

            // Update device with runtime information
            device.detectedRuntime = selectedRuntime.type;
            device.runtimeVersion = selectedRuntime.version.full;
            device.hardwareAbstraction = hardwareAbstraction;

            console.log(`✓ Device connected: ${device.displayName} with ${selectedRuntime.type}`);
            return true;

        } catch (error) {
            console.error(`Failed to connect to device ${device.displayName}:`, error);
            return false;
        }
    }

    /**
     * Disconnect device and clean up runtime resources
     */
    async disconnectDevice(devicePath: string): Promise<boolean> {
        const mapping = this.deviceRuntimeMap.get(devicePath);
        if (!mapping) {
            return false;
        }

        try {
            // Disconnect hardware abstraction
            await mapping.hardware.disconnect();

            // Disconnect runtime from device
            await mapping.runtime.disconnectFromDevice(devicePath);

            // Clean up mapping
            this.deviceRuntimeMap.delete(devicePath);

            console.log(`✓ Device disconnected: ${mapping.device.displayName}`);
            return true;

        } catch (error) {
            console.error(`Failed to disconnect device ${devicePath}:`, error);
            return false;
        }
    }

    /**
     * Get runtime for a connected device
     */
    getDeviceRuntime(devicePath: string): IPythonRuntime | null {
        const mapping = this.deviceRuntimeMap.get(devicePath);
        return mapping?.runtime || null;
    }

    /**
     * Get hardware abstraction for a connected device
     */
    getDeviceHardwareAbstraction(devicePath: string): IHardwareAbstraction | null {
        const mapping = this.deviceRuntimeMap.get(devicePath);
        return mapping?.hardware || null;
    }

    /**
     * Execute code on device using appropriate runtime
     */
    async executeCodeOnDevice(
        devicePath: string,
        code: string,
        options?: { timeout?: number }
    ): Promise<{
        success: boolean;
        output: string;
        error?: string;
        runtime: PythonRuntimeType;
    }> {
        const mapping = this.deviceRuntimeMap.get(devicePath);
        if (!mapping) {
            return {
                success: false,
                output: '',
                error: 'Device not connected',
                runtime: 'circuitpython' // Default
            };
        }

        try {
            const result = await mapping.runtime.executeCode(code, {
                mode: 'repl',
                timeout: options?.timeout
            });

            return {
                success: result.success,
                output: result.output,
                error: result.error,
                runtime: mapping.runtime.type
            };

        } catch (error) {
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                runtime: mapping.runtime.type
            };
        }
    }

    /**
     * Get all connected devices with runtime information
     */
    getConnectedDevicesWithRuntimes(): Array<{
        device: RuntimeAwareDevice;
        runtime: IPythonRuntime;
        hardware: IHardwareAbstraction;
    }> {
        return Array.from(this.deviceRuntimeMap.values());
    }

    /**
     * Switch runtime for a connected device
     */
    async switchDeviceRuntime(
        devicePath: string,
        newRuntimeType: PythonRuntimeType
    ): Promise<boolean> {
        const mapping = this.deviceRuntimeMap.get(devicePath);
        if (!mapping) {
            return false;
        }

        try {
            console.log(`Switching device ${mapping.device.displayName} from ${mapping.runtime.type} to ${newRuntimeType}`);

            // Get new runtime
            const newRuntime = this.runtimeManager.getRuntime(newRuntimeType);
            if (!newRuntime) {
                throw new Error(`Runtime not available: ${newRuntimeType}`);
            }

            // Disconnect old runtime
            await mapping.runtime.disconnectFromDevice(devicePath);
            await mapping.hardware.disconnect();

            // Create new hardware abstraction
            const newHardware = await this.createRuntimeAwareHardwareAbstraction(
                mapping.device,
                newRuntime
            );

            // Connect new runtime
            await newRuntime.connectToDevice(devicePath);
            await newHardware.connect();

            // Update mapping
            this.deviceRuntimeMap.set(devicePath, {
                device: mapping.device,
                runtime: newRuntime,
                hardware: newHardware
            });

            // Update device info
            mapping.device.detectedRuntime = newRuntimeType;
            mapping.device.runtimeVersion = newRuntime.version.full;
            mapping.device.hardwareAbstraction = newHardware;

            console.log(`✓ Runtime switched to ${newRuntimeType} for device: ${mapping.device.displayName}`);
            return true;

        } catch (error) {
            console.error(`Failed to switch runtime for device ${devicePath}:`, error);
            return false;
        }
    }

    /**
     * Detect devices compatible with all available runtimes
     */
    async detectRuntimeCompatibleDevices(): Promise<RuntimeAwareDevice[]> {
        const devices: RuntimeAwareDevice[] = [];

        // Get devices from all available runtimes
        const availableRuntimes = this.runtimeManager.getAvailableRuntimes();

        for (const runtimeType of availableRuntimes) {
            const runtime = this.runtimeManager.getRuntime(runtimeType);
            if (!runtime) continue;

            try {
                const runtimeDevices = await runtime.getConnectedDevices();

                for (const runtimeDevice of runtimeDevices) {
                    // Convert runtime device to runtime-aware device
                    const device: RuntimeAwareDevice = {
                        path: runtimeDevice.id,
                        displayName: runtimeDevice.name,
                        boardId: runtimeDevice.id,
                        confidence: 'high',
                        hasConflict: false,
                        detectedRuntime: runtimeDevice.runtime,
                        runtimeVersion: runtimeDevice.version.full,
                        supportedRuntimes: [runtimeDevice.runtime],
                        // Additional properties
                        vendorId: undefined,
                        productId: undefined,
                        manufacturer: undefined,
                        product: undefined
                    };

                    // Check if device already exists (supports multiple runtimes)
                    const existingDevice = devices.find(d => d.path === device.path);
                    if (existingDevice) {
                        // Add runtime to supported runtimes
                        if (!existingDevice.supportedRuntimes.includes(runtimeDevice.runtime)) {
                            existingDevice.supportedRuntimes.push(runtimeDevice.runtime);
                        }
                    } else {
                        devices.push(device);
                    }
                }

            } catch (error) {
                console.error(`Error detecting devices for ${runtimeType}:`, error);
            }
        }

        return devices;
    }

    private async selectRuntimeForDevice(
        device: RuntimeAwareDevice,
        config?: RuntimeAwareDeviceConfiguration
    ): Promise<IPythonRuntime | null> {

        // Priority 1: User-specified preferred runtime
        if (config?.preferredRuntime) {
            const preferredRuntime = this.runtimeManager.getRuntime(config.preferredRuntime);
            if (preferredRuntime) {
                console.log(`Using preferred runtime: ${config.preferredRuntime}`);
                return preferredRuntime;
            }
        }

        // Priority 2: Auto-detected runtime
        if (device.detectedRuntime) {
            const detectedRuntime = this.runtimeManager.getRuntime(device.detectedRuntime);
            if (detectedRuntime) {
                console.log(`Using detected runtime: ${device.detectedRuntime}`);
                return detectedRuntime;
            }
        }

        // Priority 3: Best compatible runtime based on device characteristics
        const bestRuntime = this.runtimeManager.selectBestRuntime({
            deviceType: device.boardId || device.displayName
        });

        if (bestRuntime) {
            console.log(`Selected best compatible runtime: ${bestRuntime.type}`);
            return bestRuntime;
        }

        // Priority 4: Default runtime (CircuitPython as flagship)
        const defaultRuntime = this.runtimeManager.getDefaultRuntime();
        if (defaultRuntime) {
            console.log(`Using default runtime: ${defaultRuntime.type}`);
            return defaultRuntime;
        }

        return null;
    }

    private async createRuntimeAwareHardwareAbstraction(
        device: RuntimeAwareDevice,
        runtime: IPythonRuntime
    ): Promise<IHardwareAbstraction> {

        if (runtime.type === 'circuitpython' && runtime.capabilities.supportsWASMExecution) {
            // Use WASM virtual hardware for CircuitPython
            return HardwareAbstractionFactory.create('wasm-virtual', device.path, {
                wasmRuntime: (runtime as any)._wasmRuntime // Access internal WASM runtime
            });
        } else {
            // Use physical hardware abstraction for other runtimes
            return HardwareAbstractionFactory.create('physical', device.path, {
                connectionInfo: {
                    port: device.path,
                    baudRate: 115200
                }
            });
        }
    }

    private setupRuntimeEventHandlers(): void {
        // Handle runtime additions/removals
        this.runtimeManager.on('runtimeAdded', (runtimeType: PythonRuntimeType) => {
            console.log(`Runtime added: ${runtimeType}`);
            // Re-scan for devices compatible with new runtime
            this.detectRuntimeCompatibleDevices();
        });

        this.runtimeManager.on('runtimeRemoved', (runtimeType: PythonRuntimeType) => {
            console.log(`Runtime removed: ${runtimeType}`);
            // Disconnect devices using this runtime
            this.handleRuntimeRemoval(runtimeType);
        });

        this.runtimeManager.on('defaultChanged', (event: { old: PythonRuntimeType; new: PythonRuntimeType }) => {
            console.log(`Default runtime changed from ${event.old} to ${event.new}`);
        });
    }

    private async handleRuntimeRemoval(runtimeType: PythonRuntimeType): Promise<void> {
        // Find devices using the removed runtime
        const devicesToUpdate = Array.from(this.deviceRuntimeMap.entries())
            .filter(([_, mapping]) => mapping.runtime.type === runtimeType);

        for (const [devicePath, mapping] of devicesToUpdate) {
            try {
                console.log(`Switching device ${mapping.device.displayName} to default runtime due to ${runtimeType} removal`);

                // Switch to default runtime
                const defaultRuntime = this.runtimeManager.getDefaultRuntime();
                if (defaultRuntime && defaultRuntime.type !== runtimeType) {
                    await this.switchDeviceRuntime(devicePath, defaultRuntime.type);
                } else {
                    // No alternative runtime available, disconnect device
                    await this.disconnectDevice(devicePath);
                }

            } catch (error) {
                console.error(`Failed to handle runtime removal for device ${devicePath}:`, error);
            }
        }
    }

    public override dispose(): void {
        // Disconnect all devices
        for (const devicePath of this.deviceRuntimeMap.keys()) {
            this.disconnectDevice(devicePath).catch(error => {
                console.error(`Error disconnecting device during disposal:`, error);
            });
        }

        this.deviceRuntimeMap.clear();
        super.dispose();
    }
}