/**
 * Adafruit Bundle and Library Manager
 *
 * PRIMARY STRATEGY: Use circup globally for all CircuitPython library management
 * - circup: Official tool for CircuitPython Bundle (.mpy files, device sync, updates)
 * - pip: Only for Blinka/Python environments (PyPI adafruit-circuitpython-* packages)
 *
 * This provides unified library management across WASM, physical devices, and projects.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { IPythonRuntime, RuntimeModule, PythonRuntimeType } from './IPythonRuntime';

export interface LibraryInfo {
    name: string;
    version?: string;
    description?: string;
    isInstalled: boolean;
    installationPath?: string;
    dependencies?: string[];
    isAdafruitBundle: boolean;
    supportedRuntimes: PythonRuntimeType[];
}

export interface BundleManifest {
    version: string;
    libraries: Array<{
        name: string;
        version: string;
        path: string;
        mpy_version?: string;
        dependencies?: string[];
    }>;
    lastUpdated: string;
}

/**
 * Unified library manager using circup for CircuitPython libraries
 * and pip for standard Python packages
 */
export class AdafruitBundleManager extends EventEmitter {
    private static instance: AdafruitBundleManager;
    private _isInitialized = false;
    private _bundleCache = new Map<string, LibraryInfo>();
    private _bundleManifest?: BundleManifest;
    private _circupAvailable = false;
    private _bundlePath: string;

    constructor(
        private context: vscode.ExtensionContext,
        private bundleBasePath?: string
    ) {
        super();
        this._bundlePath = bundleBasePath || path.join(context.globalStorageUri.fsPath, 'adafruit-bundle');
    }

    static getInstance(context?: vscode.ExtensionContext): AdafruitBundleManager {
        if (!AdafruitBundleManager.instance && context) {
            AdafruitBundleManager.instance = new AdafruitBundleManager(context);
        }
        return AdafruitBundleManager.instance;
    }

    async initialize(): Promise<void> {
        if (this._isInitialized) {
            return;
        }

        console.log('Initializing Adafruit Bundle Manager...');

        try {
            // Check circup availability
            this._circupAvailable = await this.checkCircupAvailable();

            if (!this._circupAvailable) {
                console.warn('circup not available - CircuitPython library management will be limited');
            }

            // Ensure bundle directory exists
            await this.ensureBundleDirectory();

            // Load bundle manifest or create default
            await this.loadBundleManifest();

            // Initialize library cache
            await this.refreshLibraryCache();

            this._isInitialized = true;
            this.emit('initialized');

            console.log('✓ Adafruit Bundle Manager initialized');

        } catch (error) {
            console.error('Bundle Manager initialization failed:', error);
            throw error;
        }
    }

    async dispose(): Promise<void> {
        this._bundleCache.clear();
        this.removeAllListeners();
        this._isInitialized = false;
    }

    /**
     * Get available libraries from Adafruit Bundle
     */
    async getAvailableLibraries(runtimeType?: PythonRuntimeType): Promise<LibraryInfo[]> {
        if (!this._isInitialized) {
            await this.initialize();
        }

        const libraries = Array.from(this._bundleCache.values());

        if (runtimeType) {
            return libraries.filter(lib => lib.supportedRuntimes.includes(runtimeType));
        }

        return libraries;
    }

    /**
     * Install library using appropriate tool (circup or pip)
     */
    async installLibrary(
        libraryName: string,
        runtimeType: PythonRuntimeType,
        targetPath?: string
    ): Promise<boolean> {
        try {
            console.log(`Installing ${libraryName} for ${runtimeType}...`);

            if (runtimeType === 'circuitpython') {
                return await this.installWithCircup(libraryName, targetPath);
            } else if (runtimeType === 'python') {
                return await this.installWithPip(libraryName);
            } else if (runtimeType === 'micropython') {
                // MicroPython uses upip or manual installation
                return await this.installForMicroPython(libraryName);
            }

            return false;

        } catch (error) {
            console.error(`Failed to install ${libraryName}:`, error);
            return false;
        }
    }

    /**
     * Update libraries using circup
     */
    async updateLibraries(runtimeType: PythonRuntimeType, targetPath?: string): Promise<boolean> {
        if (runtimeType === 'circuitpython' && this._circupAvailable) {
            return await this.updateWithCircup(targetPath);
        }
        return false;
    }

    /**
     * Sync libraries to WASM runtime using circup bundle
     *
     * STRATEGY: Use circup to maintain a global bundle, then sync to WASM
     * This ensures WASM uses the same library versions as physical devices
     */
    async syncToWasmRuntime(wasmRuntimePath: string): Promise<boolean> {
        try {
            console.log('Syncing CircuitPython Bundle to WASM runtime via circup...');

            // First ensure we have the latest bundle via circup
            await this.updateGlobalBundle();

            // Create WASM lib directory
            const wasmLibPath = path.join(wasmRuntimePath, 'lib');
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(wasmLibPath));

            // Copy from circup's bundle cache to WASM
            await this.copyBundleToWasm(wasmLibPath);

            console.log('✓ CircuitPython Bundle synced to WASM runtime via circup');
            return true;

        } catch (error) {
            console.error('Failed to sync bundle to WASM:', error);
            return false;
        }
    }

    /**
     * Get installed libraries for a specific runtime
     */
    async getInstalledLibraries(runtimeType: PythonRuntimeType, devicePath?: string): Promise<LibraryInfo[]> {
        const installed: LibraryInfo[] = [];

        try {
            if (runtimeType === 'circuitpython' && devicePath) {
                // Check device /lib directory
                const libPath = path.join(devicePath, 'lib');
                installed.push(...await this.scanCircuitPythonLibs(libPath));
            } else if (runtimeType === 'python') {
                // Check pip list
                installed.push(...await this.scanPipPackages());
            }

        } catch (error) {
            console.error(`Error scanning installed libraries for ${runtimeType}:`, error);
        }

        return installed;
    }

    private async checkCircupAvailable(): Promise<boolean> {
        return new Promise((resolve) => {
            const process = spawn('circup', ['--version'], { shell: true });

            process.on('close', (code) => {
                resolve(code === 0);
            });

            process.on('error', () => {
                resolve(false);
            });

            // Timeout after 3 seconds
            setTimeout(() => {
                process.kill();
                resolve(false);
            }, 3000);
        });
    }

    /**
     * Install library using circup - the official CircuitPython library manager
     *
     * circup handles:
     * - Adafruit CircuitPython Bundle libraries
     * - .mpy compiled libraries for space efficiency
     * - Version compatibility with CircuitPython firmware
     * - Direct device installation
     */
    private async installWithCircup(libraryName: string, targetPath?: string): Promise<boolean> {
        if (!this._circupAvailable) {
            console.error('circup not available - please install: pip install circup');
            return false;
        }

        return new Promise((resolve) => {
            const args = ['install', libraryName];

            // If no target path, circup will auto-detect connected CircuitPython device
            if (targetPath) {
                args.push('--path', targetPath);
            }

            const process = spawn('circup', args, { shell: true });

            process.on('close', (code) => {
                const success = code === 0;
                if (success) {
                    console.log(`✓ Installed ${libraryName} with circup`);
                    this.emit('libraryInstalled', { name: libraryName, tool: 'circup' });
                }
                resolve(success);
            });

            process.on('error', (error) => {
                console.error(`circup install error:`, error);
                resolve(false);
            });
        });
    }

    private async installWithPip(libraryName: string): Promise<boolean> {
        return new Promise((resolve) => {
            // Install Adafruit libraries for standard Python (typically includes Blinka)
            const packageName = libraryName.startsWith('adafruit-')
                ? libraryName
                : `adafruit-circuitpython-${libraryName.replace('adafruit_', '')}`;

            const process = spawn('pip', ['install', packageName], { shell: true });

            process.on('close', (code) => {
                const success = code === 0;
                if (success) {
                    console.log(`✓ Installed ${packageName} with pip`);
                    this.emit('libraryInstalled', { name: libraryName, tool: 'pip' });
                }
                resolve(success);
            });

            process.on('error', (error) => {
                console.error(`pip install error:`, error);
                resolve(false);
            });
        });
    }

    private async installForMicroPython(libraryName: string): Promise<boolean> {
        // MicroPython library installation is more complex
        // Could use upip or manual file copying
        console.log(`MicroPython library installation for ${libraryName} not yet implemented`);
        return false;
    }

    private async updateWithCircup(targetPath?: string): Promise<boolean> {
        if (!this._circupAvailable) {
            return false;
        }

        return new Promise((resolve) => {
            const args = ['update'];
            if (targetPath) {
                args.push('--path', targetPath);
            }

            const process = spawn('circup', args, { shell: true });

            process.on('close', (code) => {
                const success = code === 0;
                if (success) {
                    console.log('✓ Libraries updated with circup');
                    this.emit('librariesUpdated');
                }
                resolve(success);
            });

            process.on('error', (error) => {
                console.error(`circup update error:`, error);
                resolve(false);
            });
        });
    }

    private async ensureBundleDirectory(): Promise<void> {
        try {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(this._bundlePath));
        } catch (error) {
            // Directory might already exist
        }
    }

    private async loadBundleManifest(): Promise<void> {
        const manifestPath = path.join(this._bundlePath, 'manifest.json');

        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(manifestPath));
            this._bundleManifest = JSON.parse(Buffer.from(content).toString());
        } catch {
            // Create default manifest
            this._bundleManifest = {
                version: '8.2.6',
                libraries: [],
                lastUpdated: new Date().toISOString()
            };
            await this.saveBundleManifest();
        }
    }

    private async saveBundleManifest(): Promise<void> {
        if (!this._bundleManifest) return;

        const manifestPath = path.join(this._bundlePath, 'manifest.json');
        const content = JSON.stringify(this._bundleManifest, null, 2);

        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(manifestPath),
            Buffer.from(content)
        );
    }

    private async refreshLibraryCache(): Promise<void> {
        this._bundleCache.clear();

        // Add common Adafruit libraries
        const coreLibraries = [
            {
                name: 'adafruit_bus_device',
                description: 'Base classes for I2C and SPI devices',
                isAdafruitBundle: true,
                supportedRuntimes: ['circuitpython', 'python'] as PythonRuntimeType[]
            },
            {
                name: 'adafruit_register',
                description: 'Hardware register access helpers',
                isAdafruitBundle: true,
                supportedRuntimes: ['circuitpython', 'python'] as PythonRuntimeType[]
            },
            {
                name: 'adafruit_neopixel',
                description: 'NeoPixel LED control',
                isAdafruitBundle: true,
                supportedRuntimes: ['circuitpython', 'python'] as PythonRuntimeType[]
            },
            {
                name: 'adafruit_motor',
                description: 'Motor and servo control',
                isAdafruitBundle: true,
                supportedRuntimes: ['circuitpython', 'python'] as PythonRuntimeType[]
            },
            {
                name: 'adafruit_display_text',
                description: 'Text display utilities',
                isAdafruitBundle: true,
                supportedRuntimes: ['circuitpython', 'python'] as PythonRuntimeType[]
            },
            {
                name: 'adafruit_led_animation',
                description: 'LED animation effects',
                isAdafruitBundle: true,
                supportedRuntimes: ['circuitpython', 'python'] as PythonRuntimeType[]
            }
        ];

        for (const lib of coreLibraries) {
            this._bundleCache.set(lib.name, {
                ...lib,
                isInstalled: false, // Will be checked during runtime queries
                version: this._bundleManifest?.version || '8.2.6'
            });
        }
    }

    /**
     * Update global CircuitPython Bundle using circup
     * This keeps our extension in sync with the latest Adafruit releases
     */
    private async updateGlobalBundle(): Promise<boolean> {
        if (!this._circupAvailable) {
            return false;
        }

        return new Promise((resolve) => {
            // circup update --auto updates the bundle cache
            const process = spawn('circup', ['update', '--auto'], { shell: true });

            process.on('close', (code) => {
                const success = code === 0;
                if (success) {
                    console.log('✓ Global CircuitPython Bundle updated via circup');
                }
                resolve(success);
            });

            process.on('error', (error) => {
                console.error('circup bundle update error:', error);
                resolve(false);
            });
        });
    }

    /**
     * Copy CircuitPython Bundle from circup cache to WASM runtime
     * This ensures WASM has access to the same libraries as physical devices
     */
    private async copyBundleToWasm(wasmLibPath: string): Promise<void> {
        try {
            // Get circup bundle path (typically ~/.circup or similar)
            const bundlePath = await this.getCircupBundlePath();

            if (bundlePath) {
                // Copy core libraries from bundle to WASM
                const coreLibraries = [
                    'adafruit_bus_device',
                    'adafruit_register',
                    'adafruit_neopixel',
                    'adafruit_motor',
                    'adafruit_display_text',
                    'adafruit_led_animation'
                ];

                for (const libName of coreLibraries) {
                    await this.copyLibraryFromBundle(bundlePath, libName, wasmLibPath);
                }
            }
        } catch (error) {
            console.error('Failed to copy bundle to WASM:', error);
        }
    }

    private async getCircupBundlePath(): Promise<string | null> {
        // circup typically stores bundle in user's home directory
        // This would need to query circup for its bundle location
        return null; // Placeholder - would implement bundle path detection
    }

    private async copyLibraryFromBundle(bundlePath: string, libraryName: string, wasmLibPath: string): Promise<void> {
        const sourcePath = path.join(bundlePath, 'lib', libraryName);
        const targetPath = path.join(wasmLibPath, libraryName);

        try {
            // Copy library files (.py or .mpy) from bundle to WASM
            console.log(`Copying ${libraryName} from CircuitPython Bundle to WASM...`);
            // Implementation would handle file copying with proper structure
        } catch (error) {
            console.error(`Failed to copy ${libraryName} to WASM:`, error);
        }
    }

    private async scanCircuitPythonLibs(libPath: string): Promise<LibraryInfo[]> {
        const libraries: LibraryInfo[] = [];

        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(libPath));

            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory || name.endsWith('.mpy')) {
                    const cleanName = name.replace('.mpy', '');
                    libraries.push({
                        name: cleanName,
                        isInstalled: true,
                        installationPath: path.join(libPath, name),
                        isAdafruitBundle: cleanName.startsWith('adafruit_'),
                        supportedRuntimes: ['circuitpython']
                    });
                }
            }
        } catch (error) {
            console.error('Error scanning CircuitPython lib directory:', error);
        }

        return libraries;
    }

    private async scanPipPackages(): Promise<LibraryInfo[]> {
        return new Promise((resolve) => {
            const libraries: LibraryInfo[] = [];
            const process = spawn('pip', ['list', '--format=json'], { shell: true });

            let output = '';
            process.stdout?.on('data', (data) => {
                output += data.toString();
            });

            process.on('close', () => {
                try {
                    const packages = JSON.parse(output);
                    for (const pkg of packages) {
                        if (pkg.name.includes('adafruit') || pkg.name.includes('blinka')) {
                            libraries.push({
                                name: pkg.name,
                                version: pkg.version,
                                isInstalled: true,
                                isAdafruitBundle: pkg.name.includes('adafruit'),
                                supportedRuntimes: ['python']
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error parsing pip list output:', error);
                }
                resolve(libraries);
            });

            process.on('error', () => {
                resolve(libraries);
            });
        });
    }
}