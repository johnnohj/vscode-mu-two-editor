/**
 * WASM Runtime Deployment Manager
 *
 * Handles deployment and management of WASM runtime files and dependencies
 * in VS Code's globalStorage for installed extensions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { AdafruitBundleManager } from '../runtime/AdafruitBundleManager';

export interface WasmDeploymentConfig {
    wasmRuntimePath?: string;
    libraryPath?: string;
    forceRedeploy?: boolean;
}

export interface DeployedWasmRuntime {
    runtimePath: string;
    libraryPath: string;
    version: string;
    deployedAt: number;
}

/**
 * Manages WASM runtime files in globalStorage for extension installations
 */
export class WasmDeploymentManager {
    private static instance: WasmDeploymentManager;
    private isInitialized = false;
    private deployment: DeployedWasmRuntime | null = null;
    private readonly DEPLOYMENT_VERSION = '1.0.0';

    constructor(
        private context: vscode.ExtensionContext,
        private bundleManager: AdafruitBundleManager
    ) {}

    static getInstance(
        context: vscode.ExtensionContext,
        bundleManager: AdafruitBundleManager
    ): WasmDeploymentManager {
        if (!WasmDeploymentManager.instance) {
            WasmDeploymentManager.instance = new WasmDeploymentManager(context, bundleManager);
        }
        return WasmDeploymentManager.instance;
    }

    /**
     * Deploy WASM runtime files to globalStorage
     */
    async deployWasmRuntime(config: WasmDeploymentConfig = {}): Promise<DeployedWasmRuntime> {
        console.log('Deploying WASM runtime to globalStorage...');

        try {
            // Create globalStorage directories
            const globalStoragePath = this.context.globalStorageUri.fsPath;
            const wasmRuntimeDir = path.join(globalStoragePath, 'wasm-runtime');
            const libraryDir = path.join(globalStoragePath, 'circuitpython-libs');

            // Ensure directories exist
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(wasmRuntimeDir));
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(libraryDir));

            // Check if we need to redeploy
            const existingDeployment = await this.getExistingDeployment();
            if (existingDeployment && !config.forceRedeploy) {
                console.log('✓ WASM runtime already deployed');
                this.deployment = existingDeployment;
                return existingDeployment;
            }

            // Copy WASM runtime files from extension bundle
            await this.copyWasmRuntimeFiles(wasmRuntimeDir);

            // Deploy Adafruit libraries
            await this.deployAdafruitLibraries(libraryDir);

            // Create deployment manifest
            const deployment: DeployedWasmRuntime = {
                runtimePath: path.join(wasmRuntimeDir, 'wasm-runtime-worker.mjs'),
                libraryPath: libraryDir,
                version: this.DEPLOYMENT_VERSION,
                deployedAt: Date.now()
            };

            // Save deployment info
            await this.saveDeploymentInfo(deployment);
            this.deployment = deployment;

            console.log('✓ WASM runtime deployed to globalStorage');
            console.log(`Runtime: ${deployment.runtimePath}`);
            console.log(`Libraries: ${deployment.libraryPath}`);

            return deployment;

        } catch (error) {
            console.error('Failed to deploy WASM runtime:', error);
            throw error;
        }
    }

    /**
     * Get the currently deployed WASM runtime info
     */
    async getDeployedRuntime(): Promise<DeployedWasmRuntime | null> {
        if (this.deployment) {
            return this.deployment;
        }

        return await this.getExistingDeployment();
    }

    /**
     * Update WASM runtime library configuration
     */
    async configureWasmLibraryPath(wasmRuntimePath: string, libraryPath: string): Promise<void> {
        console.log(`Configuring WASM runtime library path: ${libraryPath}`);

        // The configuration will be passed to the WASM worker through environment variables
        // and Module.locateFile API when the runtime is initialized
        process.env.CIRCUITPYTHON_LIB_PATH = libraryPath;

        console.log('✓ WASM library path configured');
    }

    /**
     * Clean up old deployments
     */
    async cleanupOldDeployments(): Promise<void> {
        try {
            const globalStoragePath = this.context.globalStorageUri.fsPath;
            const wasmRuntimeDir = path.join(globalStoragePath, 'wasm-runtime');

            // Check if directory exists
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(wasmRuntimeDir));
                // Directory exists, remove it
                await vscode.workspace.fs.delete(vscode.Uri.file(wasmRuntimeDir), { recursive: true });
                console.log('✓ Cleaned up old WASM deployment');
            } catch {
                // Directory doesn't exist, nothing to clean
            }

            // Clear deployment info
            await this.context.globalState.update('wasmDeployment', undefined);

        } catch (error) {
            console.warn('Failed to cleanup old deployments:', error);
        }
    }

    /**
     * Check if WASM runtime is properly deployed and accessible
     */
    async validateDeployment(): Promise<boolean> {
        const deployment = await this.getDeployedRuntime();
        if (!deployment) {
            return false;
        }

        try {
            // Check if runtime file exists and is accessible
            await vscode.workspace.fs.stat(vscode.Uri.file(deployment.runtimePath));

            // Check if library directory exists
            await vscode.workspace.fs.stat(vscode.Uri.file(deployment.libraryPath));

            return true;
        } catch {
            return false;
        }
    }

    // Private helper methods

    private async copyWasmRuntimeFiles(targetDir: string): Promise<void> {
        console.log('Copying WASM runtime files...');

        // Get extension path - the files should be in the packaged extension
        const extensionPath = this.context.extensionPath;
        const sourceBinDir = path.join(extensionPath, 'dist', 'bin');

        try {
            // Copy all .mjs files from dist/bin to globalStorage
            const sourceFiles = await vscode.workspace.fs.readDirectory(vscode.Uri.file(sourceBinDir));

            for (const [fileName, fileType] of sourceFiles) {
                if (fileType === vscode.FileType.File && fileName.endsWith('.mjs')) {
                    const sourcePath = path.join(sourceBinDir, fileName);
                    const targetPath = path.join(targetDir, fileName);

                    const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(sourcePath));
                    await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), fileContent);

                    console.log(`✓ Copied ${fileName}`);
                }
            }

        } catch (error) {
            console.error('Failed to copy WASM runtime files:', error);
            throw error;
        }
    }

    private async deployAdafruitLibraries(libraryDir: string): Promise<void> {
        console.log('Deploying Adafruit libraries...');

        try {
            // Use the bundle manager to sync libraries to the specified directory
            // This will handle downloading and organizing the CircuitPython Bundle
            await this.bundleManager.syncToWasmRuntime(libraryDir);

        } catch (error) {
            console.warn('Failed to deploy Adafruit libraries (continuing):', error);
            // Don't fail the entire deployment if library sync fails
        }
    }

    private async getExistingDeployment(): Promise<DeployedWasmRuntime | null> {
        try {
            const deploymentInfo = this.context.globalState.get<DeployedWasmRuntime>('wasmDeployment');

            if (deploymentInfo && deploymentInfo.version === this.DEPLOYMENT_VERSION) {
                // Validate that the files still exist
                const isValid = await this.validateDeployment();
                if (isValid) {
                    return deploymentInfo;
                }
            }

            return null;

        } catch {
            return null;
        }
    }

    private async saveDeploymentInfo(deployment: DeployedWasmRuntime): Promise<void> {
        await this.context.globalState.update('wasmDeployment', deployment);
    }
}