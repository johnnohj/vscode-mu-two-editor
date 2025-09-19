/**
 * Blinka-Enabled Python Runtime Implementation
 *
 * Provides standard Python support with Adafruit Blinka for CircuitPython
 * API compatibility. This enables CircuitPython code to run on Raspberry Pi,
 * Linux SBCs, and other platforms supported by Blinka.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import {
    IPythonRuntime,
    PythonRuntimeType,
    RuntimeCapabilities,
    RuntimeVersion,
    RuntimeExecutionContext,
    RuntimeExecutionResult,
    RuntimeModule,
    RuntimeDevice,
    RuntimeConfig
} from './IPythonRuntime';
import { AdafruitBundleManager } from './AdafruitBundleManager';

/**
 * Blinka-Enabled Python Runtime
 *
 * Uses Adafruit Blinka to provide CircuitPython API compatibility
 * on standard Python installations. This enables the same code to run
 * on both CircuitPython microcontrollers and Blinka-supported SBCs.
 */
export class BlinkaEnabledPythonRuntime extends EventEmitter implements IPythonRuntime {
    readonly type: PythonRuntimeType = 'python';
    readonly version: RuntimeVersion;
    readonly capabilities: RuntimeCapabilities;

    private _isInitialized = false;
    private _config: RuntimeConfig;
    private _pythonProcess?: ChildProcess;
    private _blinkaInstalled = false;
    private _connectedDevices = new Map<string, any>();
    private _replSession?: any;
    private _bundleManager: AdafruitBundleManager;

    constructor(config?: RuntimeConfig, context?: vscode.ExtensionContext) {
        super();

        this._bundleManager = AdafruitBundleManager.getInstance(context);

        this._config = {
            type: 'python',
            version: '3.11.0',
            interpreterPath: 'python3',
            enableExtensions: true,
            debugMode: false,
            executionTimeout: 30000,
            ...config
        };

        this.version = this.parseVersion(this._config.version || '3.11.0');

        // Blinka-enabled Python capabilities
        // Similar to CircuitPython but running on more powerful hardware
        this.capabilities = {
            // Hardware access via Blinka
            hasGPIO: true,
            hasSPI: true,
            hasI2C: true,
            hasUART: true,
            hasPWM: true,
            hasADC: true,

            // Enhanced capabilities on SBC platforms
            hasBuiltinSensors: false, // Depends on connected hardware
            hasWiFi: true, // Most SBCs have WiFi
            hasBluetooth: true,
            hasUSB: true,
            hasFileSystem: true,

            // Full Python language features
            hasAsyncAwait: true,
            hasTypeHints: true, // Full Python type hint support
            hasF_strings: true,
            hasDataclasses: true, // Full Python feature set

            // Development features
            hasREPL: true,
            hasDebugging: true, // Full Python debugging support
            hasProfiler: true,
            hasMemoryIntrospection: true,

            // Simulation capabilities
            supportsVirtualHardware: false, // Use actual hardware via Blinka
            supportsWASMExecution: false
        };
    }

    get isInitialized(): boolean {
        return this._isInitialized;
    }

    async initialize(config?: RuntimeConfig): Promise<void> {
        if (this._isInitialized) {
            return;
        }

        try {
            console.log('Initializing Blinka-enabled Python runtime...');

            if (config) {
                this._config = { ...this._config, ...config };
            }

            // Step 1: Validate Python installation
            await this.validatePythonInstallation();

            // Step 2: Check/install Blinka
            await this.ensureBlinkaInstalled();

            // Step 3: Initialize Python process for REPL
            await this.initializePythonProcess();

            // Step 4: Test Blinka functionality
            await this.testBlinkaFunctionality();

            this._isInitialized = true;
            this.emit('initialized');

            console.log('✓ Blinka-enabled Python runtime initialization complete');

        } catch (error) {
            console.error('Blinka-enabled Python runtime initialization failed:', error);
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this._isInitialized) {
            return;
        }

        console.log('Disposing Blinka-enabled Python runtime...');

        // Disconnect from all devices
        for (const deviceId of this._connectedDevices.keys()) {
            await this.disconnectFromDevice(deviceId);
        }

        // Terminate Python process
        if (this._pythonProcess && !this._pythonProcess.killed) {
            this._pythonProcess.kill('SIGTERM');
            this._pythonProcess = undefined;
        }

        // Stop REPL
        if (this._replSession) {
            await this.stopREPL();
        }

        this._isInitialized = false;
        this.removeAllListeners();
        this.emit('disposed');

        console.log('✓ Blinka-enabled Python runtime disposed');
    }

    async reset(): Promise<void> {
        // Reset Python environment
        if (this._pythonProcess) {
            await this.initializePythonProcess();
        }
    }

    async isHealthy(): Promise<boolean> {
        if (!this._isInitialized || !this._blinkaInstalled) {
            return false;
        }

        try {
            // Test basic Blinka import
            const result = await this.executeCode('import board; print("Blinka OK")', {
                mode: 'repl',
                timeout: 5000
            });
            return result.success && result.output.includes('Blinka OK');
        } catch {
            return false;
        }
    }

    async getStatus(): Promise<{
        initialized: boolean;
        connected: boolean;
        memoryUsage?: { used: number; free: number; total: number };
        uptime: number;
    }> {
        return {
            initialized: this._isInitialized,
            connected: this._connectedDevices.size > 0,
            uptime: process.uptime() * 1000
        };
    }

    async executeCode(
        code: string,
        context?: RuntimeExecutionContext
    ): Promise<RuntimeExecutionResult> {
        if (!this._isInitialized) {
            throw new Error('Blinka-enabled Python runtime not initialized');
        }

        const ctx = {
            mode: 'repl' as const,
            timeout: this._config.executionTimeout,
            enableHardwareAccess: true,
            ...context
        };

        const startTime = Date.now();

        try {
            // Execute Python code with Blinka support
            const result = await this.executePythonCode(code, ctx);

            return {
                success: result.success,
                output: result.output,
                error: result.error,
                executionTime: Date.now() - startTime,
                hardwareChanges: result.hardwareChanges || []
            };

        } catch (error) {
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - startTime,
                hardwareChanges: []
            };
        }
    }

    async executeFile(
        filePath: string,
        context?: RuntimeExecutionContext
    ): Promise<RuntimeExecutionResult> {
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            const code = Buffer.from(content).toString('utf8');

            return this.executeCode(code, {
                ...context,
                mode: 'file'
            });
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to read file: ${error}`,
                executionTime: 0,
                hardwareChanges: []
            };
        }
    }

    async startREPL(): Promise<boolean> {
        if (this._replSession) {
            return true;
        }

        try {
            this._replSession = {
                id: `blinka_python_repl_${Date.now()}`,
                started: Date.now()
            };

            console.log('Blinka Python REPL started');
            return true;

        } catch (error) {
            console.error('Failed to start Blinka Python REPL:', error);
            return false;
        }
    }

    async stopREPL(): Promise<boolean> {
        if (!this._replSession) {
            return true;
        }

        try {
            this._replSession = undefined;
            console.log('Blinka Python REPL stopped');
            return true;

        } catch (error) {
            console.error('Failed to stop Blinka Python REPL:', error);
            return false;
        }
    }

    async sendREPLCommand(command: string): Promise<string> {
        if (!this._replSession) {
            throw new Error('REPL not started');
        }

        const result = await this.executeCode(command, { mode: 'repl' });
        return result.output;
    }

    async getAvailableModules(): Promise<RuntimeModule[]> {
        // Blinka + CircuitPython API compatible modules
        const blinkaModules: RuntimeModule[] = [
            {
                name: 'board',
                description: 'Board-specific pin definitions (via Blinka)',
                isBuiltin: true,
                isInstalled: this._blinkaInstalled,
                documentation: 'Blinka board abstraction for CircuitPython compatibility',
                examples: [{
                    title: 'Raspberry Pi GPIO',
                    code: 'import board\nprint(dir(board))  # Shows available pins',
                    description: 'List available GPIO pins on Raspberry Pi'
                }]
            },
            {
                name: 'digitalio',
                description: 'Digital I/O (CircuitPython API via Blinka)',
                isBuiltin: true,
                isInstalled: this._blinkaInstalled,
                documentation: 'CircuitPython-compatible digital I/O on Linux'
            },
            {
                name: 'analogio',
                description: 'Analog I/O (CircuitPython API via Blinka)',
                isBuiltin: true,
                isInstalled: this._blinkaInstalled,
                documentation: 'CircuitPython-compatible analog I/O on Linux'
            },
            {
                name: 'busio',
                description: 'I2C, SPI, UART (CircuitPython API via Blinka)',
                isBuiltin: true,
                isInstalled: this._blinkaInstalled,
                documentation: 'CircuitPython-compatible bus protocols'
            },
            {
                name: 'pwmio',
                description: 'PWM output (CircuitPython API via Blinka)',
                isBuiltin: true,
                isInstalled: this._blinkaInstalled,
                documentation: 'CircuitPython-compatible PWM on Linux'
            },
            {
                name: 'adafruit_circuitpython_*',
                description: 'Adafruit CircuitPython libraries (full ecosystem)',
                isBuiltin: false,
                isInstalled: false, // Would need to check individually
                documentation: 'Complete Adafruit library ecosystem via pip'
            },
            // Standard Python modules also available
            {
                name: 'asyncio',
                description: 'Asynchronous I/O support',
                isBuiltin: true,
                isInstalled: true,
                documentation: 'Full Python asyncio support'
            },
            {
                name: 'requests',
                description: 'HTTP library',
                isBuiltin: false,
                isInstalled: false, // Would need to check
                documentation: 'Full-featured HTTP client'
            }
        ];

        return blinkaModules;
    }

    async getInstalledModules(): Promise<RuntimeModule[]> {
        // Check which modules are actually installed
        const availableModules = await this.getAvailableModules();
        const installedModules = [];

        for (const module of availableModules) {
            if (await this.isModuleInstalled(module.name)) {
                installedModules.push({ ...module, isInstalled: true });
            }
        }

        return installedModules;
    }

    async installModule(moduleName: string): Promise<boolean> {
        try {
            console.log(`Installing Python module: ${moduleName}`);

            // Use bundle manager for Adafruit libraries
            if (moduleName.startsWith('adafruit_') || moduleName.includes('adafruit')) {
                return await this._bundleManager.installLibrary(moduleName, 'python');
            }

            // Use pip for other modules
            const result = await this.runPipCommand(['install', moduleName]);
            return result.success;

        } catch (error) {
            console.error(`Failed to install module ${moduleName}:`, error);
            return false;
        }
    }

    async getModuleDocumentation(moduleName: string): Promise<string | null> {
        try {
            // Get module docstring via Python
            const result = await this.executeCode(
                `import ${moduleName}; print(getattr(${moduleName}, '__doc__', 'No documentation available'))`,
                { mode: 'repl', timeout: 5000 }
            );

            return result.success ? result.output : null;
        } catch {
            return null;
        }
    }

    async getConnectedDevices(): Promise<RuntimeDevice[]> {
        // Detect Blinka-compatible devices (Raspberry Pi, etc.)
        const devices: RuntimeDevice[] = [];

        // Check if running on supported platform
        if (await this.isBlinkaCompatiblePlatform()) {
            devices.push({
                id: 'blinka_device',
                name: 'Blinka-Compatible Device (Raspberry Pi/Linux SBC)',
                runtime: 'python',
                version: this.version,
                capabilities: this.capabilities,
                modules: await this.getAvailableModules(),
                isPhysical: true,
                connectionInfo: {
                    protocol: 'native' // Direct hardware access
                }
            });
        }

        return devices;
    }

    async connectToDevice(deviceId: string): Promise<boolean> {
        try {
            if (deviceId === 'blinka_device') {
                // Test Blinka functionality
                const healthy = await this.isHealthy();
                if (healthy) {
                    this._connectedDevices.set(deviceId, { connected: Date.now() });
                    this.emit('connected', deviceId);
                    return true;
                }
            }
            return false;

        } catch (error) {
            console.error(`Failed to connect to device ${deviceId}:`, error);
            return false;
        }
    }

    async disconnectFromDevice(deviceId: string): Promise<boolean> {
        try {
            this._connectedDevices.delete(deviceId);
            this.emit('disconnected', deviceId);
            return true;
        } catch (error) {
            console.error(`Failed to disconnect from device ${deviceId}:`, error);
            return false;
        }
    }

    getHardwareCapabilities(): RuntimeCapabilities {
        return this.capabilities;
    }

    async queryHardwareState(): Promise<Record<string, any>> {
        try {
            // Query GPIO state via Blinka
            const result = await this.executeCode(`
import board
import digitalio
# Get available pins and their states
pins = {}
for pin_name in dir(board):
    if not pin_name.startswith('_'):
        try:
            pin = getattr(board, pin_name)
            pins[pin_name] = str(pin)
        except:
            pass
print(pins)
            `, { mode: 'repl', timeout: 10000 });

            if (result.success) {
                // Parse Python output to extract pin information
                return { pins: result.output };
            }
        } catch (error) {
            console.error('Error querying hardware state:', error);
        }
        return {};
    }

    async setHardwareState(updates: Record<string, any>): Promise<boolean> {
        try {
            // Apply hardware state changes via Blinka
            // This would translate updates to appropriate Blinka commands
            console.log('Setting hardware state via Blinka:', updates);
            return true;
        } catch (error) {
            console.error('Error setting hardware state:', error);
            return false;
        }
    }

    // Private helper methods

    private parseVersion(versionString: string): RuntimeVersion {
        const parts = versionString.split('.');
        return {
            major: parseInt(parts[0] || '0'),
            minor: parseInt(parts[1] || '0'),
            patch: parseInt(parts[2] || '0'),
            full: versionString
        };
    }

    private async validatePythonInstallation(): Promise<void> {
        try {
            const result = await this.runPythonCommand(['--version']);
            if (!result.success) {
                throw new Error(`Python not found at: ${this._config.interpreterPath}`);
            }
            console.log(`✓ Python found: ${result.output}`);
        } catch (error) {
            throw new Error(`Python validation failed: ${error}`);
        }
    }

    private async ensureBlinkaInstalled(): Promise<void> {
        try {
            // Check if Blinka is installed
            const checkResult = await this.executeCode('import board', {
                mode: 'repl',
                timeout: 5000
            });

            if (checkResult.success) {
                this._blinkaInstalled = true;
                console.log('✓ Blinka already installed');
                return;
            }

            // Install Blinka if not available
            console.log('Installing Adafruit Blinka...');
            const installResult = await this.runPipCommand(['install', 'adafruit-blinka']);

            if (!installResult.success) {
                throw new Error('Failed to install Adafruit Blinka');
            }

            // Verify installation
            const verifyResult = await this.executeCode('import board', {
                mode: 'repl',
                timeout: 5000
            });

            if (!verifyResult.success) {
                throw new Error('Blinka installation verification failed');
            }

            this._blinkaInstalled = true;
            console.log('✓ Adafruit Blinka installed and verified');

        } catch (error) {
            throw new Error(`Blinka setup failed: ${error}`);
        }
    }

    private async initializePythonProcess(): Promise<void> {
        // This would set up a persistent Python process for REPL interaction
        // For now, we'll use individual process calls
        console.log('✓ Python process management ready');
    }

    private async testBlinkaFunctionality(): Promise<void> {
        try {
            const testResult = await this.executeCode(`
import board
print("Available pins:")
for pin_name in dir(board):
    if not pin_name.startswith('_'):
        print(f"  {pin_name}")
print("Blinka test successful!")
            `, { mode: 'repl', timeout: 10000 });

            if (!testResult.success) {
                throw new Error('Blinka functionality test failed');
            }

            console.log('✓ Blinka functionality verified');
        } catch (error) {
            throw new Error(`Blinka test failed: ${error}`);
        }
    }

    private async runPythonCommand(args: string[]): Promise<{ success: boolean; output: string; error?: string }> {
        return new Promise((resolve) => {
            const process = spawn(this._config.interpreterPath!, args);
            let output = '';
            let error = '';

            process.stdout?.on('data', (data) => {
                output += data.toString();
            });

            process.stderr?.on('data', (data) => {
                error += data.toString();
            });

            process.on('close', (code) => {
                resolve({
                    success: code === 0,
                    output: output.trim(),
                    error: error.trim() || undefined
                });
            });
        });
    }

    private async runPipCommand(args: string[]): Promise<{ success: boolean; output: string; error?: string }> {
        return this.runPythonCommand(['-m', 'pip', ...args]);
    }

    private async executePythonCode(
        code: string,
        context: RuntimeExecutionContext
    ): Promise<{ success: boolean; output: string; error?: string; hardwareChanges?: any[] }> {
        return this.runPythonCommand(['-c', code]);
    }

    private async isModuleInstalled(moduleName: string): Promise<boolean> {
        try {
            const result = await this.executeCode(`import ${moduleName}`, {
                mode: 'repl',
                timeout: 5000
            });
            return result.success;
        } catch {
            return false;
        }
    }

    private async isBlinkaCompatiblePlatform(): Promise<boolean> {
        try {
            // Check if running on a Blinka-compatible platform
            const result = await this.runPythonCommand(['-c', 'import platform; print(platform.system())']);
            const system = result.output.toLowerCase();
            return system.includes('linux') || system.includes('darwin'); // Linux or macOS
        } catch {
            return false;
        }
    }
}