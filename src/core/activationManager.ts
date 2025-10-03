// src/core/activationManager.ts
// Handles extension activation and initialization phases

import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { ComponentRegistry } from './componentRegistry';
// Phase 2: SimpleDeviceDetector removed - using DeviceRegistry instead
import { SimpleCommands } from '../commands/simpleCommands';
import { MuTwoTaskProvider, registerTaskInputs } from '../cli/muTwoTasks';
import { PythonEnvManager } from '../execution/pythonEnvManager';
import { DeviceManager } from '../devices/core/deviceManager';
import { MuTwoLanguageClient } from '../devices/core/client';
import { MuDeviceDetector } from '../devices/core/deviceDetector';
import { CtpyDeviceFileSystemProvider } from '../workspace/filesystem/ctpyDeviceFSProvider';
import { MuTwoWorkspace } from '../workspace/workspace';
import { ensureSimplePythonVenv, setPythonEnvironmentVariables } from '../utils/simpleVenv';
import { LanguageOverrideManager } from '../services/languageOverrideManager';
import { registerLibraryManager, registerWorkspaceProjectsProvider } from './componentManager';
import { getResourceLocator } from './resourceLocator';

const logger = getLogger();

// Global component registry
let componentRegistry: ComponentRegistry;
// Phase 2: simpleDeviceDetector removed - using DeviceRegistry instead
export let simpleCommands: SimpleCommands;
let taskProvider: MuTwoTaskProvider;
let deviceManager: DeviceManager;
let languageClient: MuTwoLanguageClient;
let deviceDetector: MuDeviceDetector;
let pythonEnvManager: PythonEnvManager | null = null;
let ctpyDeviceFileSystemProvider: CtpyDeviceFileSystemProvider;
let languageOverrideManager: LanguageOverrideManager;

/**
 * Initialize core infrastructure
 * This always succeeds - no external dependencies
 */
export async function initializeCore(context: vscode.ExtensionContext): Promise<ComponentRegistry> {
    logger.info('ACTIVATION', 'Initializing core infrastructure...');

    // Initialize component registry
    componentRegistry = ComponentRegistry.getInstance(context);

    // Initialize file system provider early for settings/config access
    initializeFileSystemProvider(context, componentRegistry);

    // Create required directories (blocking for tests)
    try {
        await createDirectories(context);
        logger.info('ACTIVATION', 'Directories created successfully');
    } catch (error) {
        logger.error('ACTIVATION', 'CRITICAL: Failed to create directories:', error);
        throw error; // Re-throw to see the error in tests
    }

    logger.info('ACTIVATION', 'Core infrastructure initialized');
    return componentRegistry;
}

export interface ActivationOptions {
    skipPythonExtensionWait?: boolean;
    skipEnvironmentValidation?: boolean;
    skipPackageCheck?: boolean;
    cachedPythonPath?: string | null;
}

/**
 * Initialize essential services
 * These are required for basic functionality
 */
export async function initializeEssentialServices(
	context: vscode.ExtensionContext,
	componentRegistry: ComponentRegistry,
	options: ActivationOptions = {}
): Promise<{
	pythonEnvManager: PythonEnvManager | null
	simpleCommands: SimpleCommands
	taskProvider: MuTwoTaskProvider | null
	deviceManager: DeviceManager | null
	languageClient: MuTwoLanguageClient | null
	deviceDetector: MuDeviceDetector | null
	ctpyDeviceFileSystemProvider: CtpyDeviceFileSystemProvider
	languageOverrideManager: LanguageOverrideManager
}> {
	logger.info('ACTIVATION', 'Initializing essential services...')

	// Dead simple Python venv setup using VS Code APIs - no over-engineering
	const venvPath = await ensureSimplePythonVenv(context);
	if (venvPath) {
		setPythonEnvironmentVariables(venvPath, context);
		logger.info('ACTIVATION', '✅ Python venv ready - extension can use Python tools');
	} else {
		logger.warn('ACTIVATION', '⚠️ Python venv creation failed - some features may be limited');
	}

	// Phase 2: SimpleDeviceDetector removed - DeviceRegistry initialized in extension.ts

	// Initialize simple commands (Phase 2: no device detector passed)
	simpleCommands = new SimpleCommands(context);
	simpleCommands.registerCommands();

	// Initialize language override manager for CircuitPython workspace detection
	languageOverrideManager = new LanguageOverrideManager(context);
	logger.info('ACTIVATION', '✅ Language override manager initialized');

	// Initialize Python environment manager (simplified - detects existing venv)
	pythonEnvManager = await initializePythonEnvironment(
		context,
		componentRegistry,
		options
	)

	// Initialize task provider (keep existing if needed for compatibility)
	taskProvider = initializeTaskProvider(context, componentRegistry)

	// Initialize core device services
	deviceManager = initializeDeviceManager(context, componentRegistry)
	languageClient = initializeLanguageClient(context, componentRegistry)
	// Phase 2: MuDeviceDetector replaced by DeviceRegistry
	deviceDetector = null

	// Start LSP in background
	if (languageClient) {
		languageClient
			.start()
			.then(() => {
				logger.info('ACTIVATION', 'Language server started successfully')
			})
			.catch((error) => {
				logger.info(
					'ACTIVATION',
					'Language server startup failed (continuing without LSP):',
					error
				)
			})
	}

	logger.info('ACTIVATION', 'Essential services initialized')

	return {
		pythonEnvManager,
		simpleCommands,
		taskProvider,
		deviceManager,
		languageClient,
		deviceDetector,
		ctpyDeviceFileSystemProvider,
		languageOverrideManager
	}
}

/**
 * Initialize file system providers early for settings/config access
 */
function initializeFileSystemProvider(context: vscode.ExtensionContext, componentRegistry: ComponentRegistry): void {
    logger.info('ACTIVATION', 'Initializing CircuitPython device file system provider...');

    try {
        // Initialize CircuitPython device file system provider (ctpy:// scheme)
        // Note: MuTwoFileSystemProvider removed - using VS Code workspace.fs API directly
        ctpyDeviceFileSystemProvider = new CtpyDeviceFileSystemProvider()

        // Register CircuitPython device file system provider with VS Code
        context.subscriptions.push(
				vscode.workspace.registerFileSystemProvider(
					'ctpy',
					ctpyDeviceFileSystemProvider,
					{
						isCaseSensitive: true,
						isReadonly: false,
					}
				)
			)

        componentRegistry.register(
				'ctpyDeviceFileSystemProvider',
				ctpyDeviceFileSystemProvider
			)
        logger.info('ACTIVATION', 'CircuitPython device file system provider initialized successfully');

    } catch (error) {
        logger.error('ACTIVATION', 'Failed to initialize file system provider:', error);
        throw error; // This is critical for device filesystem access
    }
}


/**
 * Initialize Python environment manager (simplified)
 */
async function initializePythonEnvironment(
    context: vscode.ExtensionContext,
    componentRegistry: ComponentRegistry,
    options: ActivationOptions = {}
): Promise<PythonEnvManager | null> {
    try {
        logger.info('ACTIVATION', 'Initializing Python environment manager...');
        const pythonEnv = new PythonEnvManager(context);
        await pythonEnv.initialize();

        const venvPath = pythonEnv.getCurrentPythonPath();
        if (venvPath) {
            componentRegistry.setPythonVenvActivated(venvPath);
            logger.info('ACTIVATION', 'Python environment manager initialized successfully');
        } else {
            logger.warn('ACTIVATION', 'No Python environment found by PythonEnvManager');
        }

        componentRegistry.register('pythonEnvManager', pythonEnv);

        // Register library manager and workspace projects provider now that Python environment is available
        try {
            registerLibraryManager(context, pythonEnv, componentRegistry);
            logger.info('ACTIVATION', 'Library manager registered successfully');
        } catch (error) {
            logger.warn('ACTIVATION', 'Failed to register library manager:', error);
        }

        try {
            registerWorkspaceProjectsProvider(context, pythonEnv, componentRegistry);
            logger.info('ACTIVATION', 'Workspace projects provider registered successfully');
        } catch (error) {
            logger.warn('ACTIVATION', 'Failed to register workspace projects provider:', error);
        }

        return pythonEnv;

    } catch (error) {
        logger.warn('ACTIVATION', 'Python environment manager initialization failed:', error);
        // Note: ComponentRegistry doesn't have setPythonVenvFailed - just log the error
        return null;
    }
}







/**
 * Initialize task provider (simplified)
 */
function initializeTaskProvider(
    context: vscode.ExtensionContext,
    componentRegistry: ComponentRegistry
): MuTwoTaskProvider | null {
    try {
        logger.info('ACTIVATION', 'Initializing task provider...');
        const provider = new MuTwoTaskProvider(context);

        // Register with VS Code
        const taskProviderDisposable = vscode.tasks.registerTaskProvider(
            MuTwoTaskProvider.type,
            provider
        );
        context.subscriptions.push(taskProviderDisposable);

        // Register task inputs
        registerTaskInputs(context);

        componentRegistry.register('taskProvider', provider);
        logger.info('ACTIVATION', 'Task provider initialized successfully');
        return provider;

    } catch (error) {
        logger.error('ACTIVATION', 'Failed to initialize task provider:', error);
        return null;
    }
}

/**
 * Initialize device manager
 */
function initializeDeviceManager(
    context: vscode.ExtensionContext,
    componentRegistry: ComponentRegistry
): DeviceManager | null {
    try {
        const manager = new DeviceManager(context);
        componentRegistry.register('deviceManager', manager);
        logger.info('ACTIVATION', 'Device manager initialized successfully');
        return manager;

    } catch (error) {
        logger.error('ACTIVATION', 'Failed to initialize device manager:', error);
        return null;
    }
}

/**
 * Initialize language client
 */
function initializeLanguageClient(
    context: vscode.ExtensionContext,
    componentRegistry: ComponentRegistry
): MuTwoLanguageClient | null {
    try {
        const client = new MuTwoLanguageClient(context);
        componentRegistry.register('languageClient', client);
        logger.info('ACTIVATION', 'Language client initialized successfully');
        return client;

    } catch (error) {
        logger.error('ACTIVATION', 'Failed to initialize language client:', error);
        return null;
    }
}

/**
 * Initialize device detector
 */
function initializeDeviceDetector(componentRegistry: ComponentRegistry): MuDeviceDetector | null {
    try {
        const detector = new MuDeviceDetector();
        componentRegistry.register('deviceDetector', detector);
        logger.info('ACTIVATION', 'Device detector initialized successfully');
        return detector;

    } catch (error) {
        logger.error('ACTIVATION', 'Failed to initialize device detector:', error);
        return null;
    }
}

/**
 * Create required directories (non-blocking)
 */
async function createDirectories(context: vscode.ExtensionContext): Promise<void> {
	const resourceLocator = getResourceLocator();
    const directories = [
			// Mu 2 core directories
			vscode.Uri.joinPath(context.globalStorageUri, '.mu2'),
			vscode.Uri.joinPath(context.globalStorageUri, '.mu2', 'data'),
			resourceLocator.getLogsPath(), // .mu2/logs via ResourceLocator
			// WASM runtime
			resourceLocator.getWasmRuntimePath(),
			// Configuration
			resourceLocator.getConfigPath(),
			// Resources (device database, etc.)
			resourceLocator.getResourcesPath(),
			// User workspaces and workspace registry
			resourceLocator.getWorkspacesRoot(),
			vscode.Uri.joinPath(resourceLocator.getWorkspacesRoot(), 'registry'),
			// Bundles
			resourceLocator.getBundlesRoot(),
		]

    // Create directories, logging any errors but don't fail activation
    for (const dir of directories) {
        try {
            await vscode.workspace.fs.createDirectory(dir);
            logger.debug('ACTIVATION', `Created directory: ${dir.fsPath}`);
        } catch (error) {
            // FileSystemError with code 'FileExists' is expected and OK
            if (error instanceof vscode.FileSystemError && error.code === 'FileExists') {
                logger.debug('ACTIVATION', `Directory already exists: ${dir.fsPath}`);
            } else {
                logger.error('ACTIVATION', `Failed to create directory ${dir.fsPath}:`, error);
                // Don't throw - allow activation to continue
            }
        }
    }
}


// Export service references for other modules
export {
	pythonEnvManager,
	taskProvider,
	deviceManager,
	languageClient,
	deviceDetector,
	ctpyDeviceFileSystemProvider
}