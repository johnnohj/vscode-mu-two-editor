// src/core/activationManager.ts
// Handles extension activation and initialization phases

import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { ExtensionStateManager } from '../utils/extensionStateManager';
import { SimpleDeviceDetector } from '../devices/simpleDeviceDetector';
import { SimpleCommands } from '../commands/simpleCommands';
import { MuTwoTaskProvider, registerTaskInputs } from '../cli/muTwoTasks';
import { PythonEnvManager } from '../execution/pythonEnvManager';
import { DeviceManager } from '../devices/core/deviceManager';
import { MuTwoLanguageClient } from '../devices/core/client';
import { MuDeviceDetector } from '../devices/core/deviceDetector';
import { MuTwoFileSystemProvider } from '../workspace/filesystem/fileSystemProvider';
import { CtpyDeviceFileSystemProvider } from '../workspace/filesystem/ctpyDeviceFSProvider';
import { MuTwoWorkspace } from '../workspace/workspace';
import { ensureSimplePythonVenv, setPythonEnvironmentVariables } from '../utils/simpleVenv';
import { LanguageOverrideManager } from '../services/languageOverrideManager';
import { registerLibraryManager, registerWorkspaceProjectsProvider } from './componentManager';

const logger = getLogger();

// Global state references that will be set during activation
let stateManager: ExtensionStateManager;
let simpleDeviceDetector: SimpleDeviceDetector;
export let simpleCommands: SimpleCommands;
let taskProvider: MuTwoTaskProvider;
let deviceManager: DeviceManager;
let languageClient: MuTwoLanguageClient;
let deviceDetector: MuDeviceDetector;
let pythonEnvManager: PythonEnvManager | null = null;
let muTwoFileSystemProvider: MuTwoFileSystemProvider;
let ctpyDeviceFileSystemProvider: CtpyDeviceFileSystemProvider;
let languageOverrideManager: LanguageOverrideManager;

/**
 * Initialize core infrastructure
 * This always succeeds - no external dependencies
 */
export function initializeCore(context: vscode.ExtensionContext): ExtensionStateManager {
    logger.info('ACTIVATION', 'Initializing core infrastructure...');

    // Initialize state management
    stateManager = ExtensionStateManager.getInstance(context);

    // Initialize file system provider early for settings/config access
    initializeFileSystemProvider(context, stateManager);

    // Create required directories (non-blocking)
    createDirectories(context).catch(error => {
        logger.warn('ACTIVATION', 'Failed to create directories:', error);
    });

    logger.info('ACTIVATION', 'Core infrastructure initialized');
    return stateManager;
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
	stateManager: ExtensionStateManager,
	options: ActivationOptions = {}
): Promise<{
	pythonEnvManager: PythonEnvManager | null
	simpleDeviceDetector: SimpleDeviceDetector
	simpleCommands: SimpleCommands
	taskProvider: MuTwoTaskProvider | null
	deviceManager: DeviceManager | null
	languageClient: MuTwoLanguageClient | null
	deviceDetector: MuDeviceDetector | null
	muTwoFileSystemProvider: MuTwoFileSystemProvider
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

	// Initialize simple device detector
	simpleDeviceDetector = new SimpleDeviceDetector();
	await simpleDeviceDetector.detectDevices();

	// Initialize simple commands
	simpleCommands = new SimpleCommands(context, simpleDeviceDetector);
	simpleCommands.registerCommands();

	// Initialize language override manager for CircuitPython workspace detection
	languageOverrideManager = new LanguageOverrideManager(context);
	logger.info('ACTIVATION', '✅ Language override manager initialized');

	// Initialize Python environment manager (simplified - detects existing venv)
	pythonEnvManager = await initializePythonEnvironment(
		context,
		stateManager,
		options
	)

	// Initialize task provider (keep existing if needed for compatibility)
	taskProvider = initializeTaskProvider(context, stateManager)

	// Initialize core device services
	deviceManager = initializeDeviceManager(context, stateManager)
	languageClient = initializeLanguageClient(context, stateManager)
	deviceDetector = initializeDeviceDetector(stateManager)

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
		simpleDeviceDetector,
		simpleCommands,
		taskProvider,
		deviceManager,
		languageClient,
		deviceDetector,
		muTwoFileSystemProvider,
		ctpyDeviceFileSystemProvider,
		languageOverrideManager
	}
}

/**
 * Initialize file system providers early for settings/config access
 */
function initializeFileSystemProvider(context: vscode.ExtensionContext, stateManager: ExtensionStateManager): void {
    logger.info('ACTIVATION', 'Initializing file system providers for early settings access...');

    try {
        // Initialize Mu Two general file system provider (mutwo:// scheme)
        muTwoFileSystemProvider = new MuTwoFileSystemProvider(context);

        // Configure allowed directories immediately for settings access
        configureMuTwoFileSystemProviderScope(context, muTwoFileSystemProvider);

        // Register Mu Two file system provider with VS Code
        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider('mutwo', muTwoFileSystemProvider, {
                isCaseSensitive: true,
                isReadonly: false
            })
        );
		  // TODO: Can we register more than one file system provider with VS Code? Or should this be
		  // more an 'internal' provider?
        // Initialize CircuitPython device file system provider (ctpy:// scheme)
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

        stateManager.setComponent('muTwoFileSystemProvider', muTwoFileSystemProvider);
        stateManager.setComponent(
				'ctpyDeviceFileSystemProvider',
				ctpyDeviceFileSystemProvider
			)
        logger.info('ACTIVATION', 'File system providers initialized successfully');

    } catch (error) {
        logger.error('ACTIVATION', 'Failed to initialize file system providers:', error);
        throw error; // This is critical for settings access
    }
}

/**
 * Configure the allowed directories for the Mu Two file system provider
 */
function configureMuTwoFileSystemProviderScope(
    context: vscode.ExtensionContext,
    provider: MuTwoFileSystemProvider
): void {
    // Add extension storage directories immediately
    if (context.storageUri) {
        provider.addAllowedPath(context.storageUri.fsPath);
        logger.info('ACTIVATION', `Added workspace storage path: ${context.storageUri.fsPath}`);
    }

    if (context.globalStorageUri) {
        provider.addAllowedPath(context.globalStorageUri.fsPath);
        logger.info('ACTIVATION', `Added global storage path: ${context.globalStorageUri.fsPath}`);
    }

    // Add current MuTwoWorkspace directory if one is open
    const currentWorkspace = MuTwoWorkspace.rootPath;
    if (currentWorkspace) {
        provider.addAllowedPath(currentWorkspace.fsPath);
        logger.info('ACTIVATION', `Added MuTwo workspace path: ${currentWorkspace.fsPath}`);
    }

    logger.info('ACTIVATION', `Mu Two file system provider configured with ${provider.getAllowedPaths().length} allowed directories`);
}


/**
 * Initialize Python environment manager (simplified)
 */
async function initializePythonEnvironment(
    context: vscode.ExtensionContext,
    stateManager: ExtensionStateManager,
    options: ActivationOptions = {}
): Promise<PythonEnvManager | null> {
    try {
        logger.info('ACTIVATION', 'Initializing Python environment manager...');
        const pythonEnv = new PythonEnvManager(context);
        await pythonEnv.initialize();

        const venvPath = pythonEnv.getCurrentPythonPath();
        if (venvPath) {
            stateManager.setPythonVenvActivated(venvPath);
            logger.info('ACTIVATION', 'Python environment manager initialized successfully');
        } else {
            logger.warn('ACTIVATION', 'No Python environment found by PythonEnvManager');
        }

        stateManager.setComponent('pythonEnvManager', pythonEnv);

        // Register library manager and workspace projects provider now that Python environment is available
        try {
            registerLibraryManager(context, pythonEnv, stateManager);
            logger.info('ACTIVATION', 'Library manager registered successfully');
        } catch (error) {
            logger.warn('ACTIVATION', 'Failed to register library manager:', error);
        }

        try {
            registerWorkspaceProjectsProvider(context, pythonEnv, stateManager);
            logger.info('ACTIVATION', 'Workspace projects provider registered successfully');
        } catch (error) {
            logger.warn('ACTIVATION', 'Failed to register workspace projects provider:', error);
        }

        return pythonEnv;

    } catch (error) {
        logger.warn('ACTIVATION', 'Python environment manager initialization failed:', error);
        stateManager.setPythonVenvFailed(error instanceof Error ? error.message : String(error));
        return null;
    }
}







/**
 * Initialize task provider (simplified)
 */
function initializeTaskProvider(
    context: vscode.ExtensionContext,
    stateManager: ExtensionStateManager
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

        stateManager.setComponent('taskProvider', provider);
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
    stateManager: ExtensionStateManager
): DeviceManager | null {
    try {
        const manager = new DeviceManager(context);
        stateManager.setComponent('deviceManager', manager);
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
    stateManager: ExtensionStateManager
): MuTwoLanguageClient | null {
    try {
        const client = new MuTwoLanguageClient(context);
        stateManager.setComponent('languageClient', client);
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
function initializeDeviceDetector(stateManager: ExtensionStateManager): MuDeviceDetector | null {
    try {
        const detector = new MuDeviceDetector();
        stateManager.setComponent('deviceDetector', detector);
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
    const directories = [
		// Mu 2's terminal shell handles creating our extension's venv,
		// the files for which are included in globalStorage
			vscode.Uri.joinPath(context.globalStorageUri, '.mu2'),
			vscode.Uri.joinPath(context.globalStorageUri, '.mu2', 'data'),
			// Logger .txt files output/backup
			vscode.Uri.joinPath(context.globalStorageUri, '.mu2', 'logs'),
			// WASM files go here
			vscode.Uri.joinPath(context.globalStorageUri, 'bin'),
			vscode.Uri.joinPath(context.globalStorageUri, 'bin', 'wasm-runtime'),
			// Asset files like images and fonts
			vscode.Uri.joinPath(context.globalStorageUri, 'common'),
			// VS Code configurations (?)
			vscode.Uri.joinPath(context.globalStorageUri, 'config'),
			// Downloads and external files
			vscode.Uri.joinPath(context.globalStorageUri, 'resources'),
			// User workspaces and workspace registry
			vscode.Uri.joinPath(context.globalStorageUri, 'workspaces'),
			vscode.Uri.joinPath(context.globalStorageUri, 'workspaces', 'registry'),
			// Different from 'config'?
			vscode.Uri.joinPath(context.globalStorageUri, 'settings'),
		]

    await Promise.all(
        directories.map(dir =>
            vscode.workspace.fs.createDirectory(dir).then(
                () => {},
                () => {} // Ignore errors
            )
        )
    );
}


// Export service references for other modules
export {
	pythonEnvManager,
	taskProvider,
	deviceManager,
	languageClient,
	deviceDetector,
	muTwoFileSystemProvider,
	ctpyDeviceFileSystemProvider
}