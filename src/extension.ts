// src/extension.ts
// Mu 2 Extension for Visual Studio Code
// Provides microcontroller development tools and device management,
// featuring CircuitPython

'use strict';

// Import necessary modules
import * as vscode from 'vscode';
import { getLogger } from './utils/unifiedLogger';
import { ComponentRegistry } from './core/componentRegistry';
import { BoardManager, IBoard } from './devices/management/boardManager';

// Import core managers
import {
    initializeCore,
    initializeEssentialServices
} from './core/activationManager';
import {
    registerUIComponents,
    setupLazyLoading
} from './core/componentManager';
import { registerCommands } from './core/commandManager';
import { registerCircuitPythonLanguageFeatures } from './core/languageFeatureManager';
import {
    initializeBoardManager,
    setupBoardEventHandlers,
    updateStatusBar,
    disposeStatusBar
} from './core/boardEventManager';

// Import development mode detection
import { detectDevelopmentMode, shouldEnableFastActivation, logDevelopmentModeInfo } from './utils/developmentModeDetector';

// Import Phase 1 infrastructure
import { initResourceLocator, getResourceLocator } from './core/resourceLocator';
import { initDevLogger, getDevLogger } from './utils/devLogger';
import { StatusBarManager } from './core/statusBarManager';
// Import Phase 2 infrastructure
import { initDeviceRegistry, getDeviceRegistry } from './devices/core/deviceRegistry';

// Global state
const logger = getLogger();
let componentRegistry: ComponentRegistry;
let boardManager: BoardManager;
let statusBarManager: StatusBarManager;

// Service references from managers
// TODO: null vs any?
let services: any = {};

/**
 * Optimized extension activation with fast and full paths
 */
export async function activate(context: vscode.ExtensionContext) {
    const startTime = Date.now();
    logger.info('EXTENSION', '🚀 Starting simplified Mu 2 Extension activation...');

    try {
        // Step 0: Initialize Phase 1 & 2 infrastructure
        initResourceLocator(context);
        initDevLogger(context);
        statusBarManager = new StatusBarManager(context);
        initDeviceRegistry(); // Phase 2: Single device detection system

        const devLogger = getDevLogger();
        const resourceLocator = getResourceLocator();
        const deviceRegistry = getDeviceRegistry();

        devLogger.extension('Phase 1 & 2 infrastructure initialized');
        resourceLocator.logAllPaths((msg) => devLogger.extension(msg));
        devLogger.device(`DeviceRegistry initialized with ${deviceRegistry.getDeviceCount()} devices`);

        // Step 1: Initialize core infrastructure
        componentRegistry = initializeCore(context);

        // Step 2: Initialize essential services (now simplified)
        services = await initializeEssentialServices(context, componentRegistry);

        // Step 3: Initialize board management and UI components
        statusBarManager.setPythonInitializing('Setting up Python environment');
        statusBarManager.setNoDevice();

        try {
            boardManager = await initializeBoardManager(
                context,
                services.deviceManager,
                services.languageClient,
                services.ctpyDeviceFileSystemProvider
            );
            if (boardManager) {
                setupBoardEventHandlers(boardManager);
                devLogger.board('BoardManager initialized successfully');

                // Update status bar if device is connected
                const connectedBoards = boardManager.getAllBoards();
                if (connectedBoards.length > 0) {
                    const firstBoard = connectedBoards[0];
                    statusBarManager.setDeviceConnected(firstBoard.name);
                }
            }
        } catch (error) {
            devLogger.error('BOARD', 'BoardManager initialization failed, continuing without board management', error);
            statusBarManager.setDeviceError('Board detection failed');
        }

        // Step 4: Register UI components and language features
        const uiComponents = await registerUIComponents(context, componentRegistry);

        // Connect SimpleCommands with ReplViewProvider immediately after UI creation
        if (services.simpleCommands && uiComponents.webviewViewProvider) {
            services.simpleCommands.setReplViewProvider(uiComponents.webviewViewProvider);
            devLogger.repl('SimpleCommands connected with ReplViewProvider');
        }

        registerCommands(context, boardManager);
        registerCircuitPythonLanguageFeatures(context);

        // Step 5: Set up DeviceRegistry event handlers
        context.subscriptions.push(
            deviceRegistry.onDeviceChanged((event) => {
                devLogger.device(`Device ${event.type}: ${event.device.displayName} (${event.device.path})`);

                if (event.type === 'added' || event.type === 'changed') {
                    const circuitPythonDevices = deviceRegistry.getCircuitPythonDevices();
                    if (circuitPythonDevices.length > 0) {
                        statusBarManager.setDeviceConnected(circuitPythonDevices[0].displayName);
                    }
                } else if (event.type === 'removed') {
                    const remaining = deviceRegistry.getCircuitPythonDevices();
                    if (remaining.length === 0) {
                        statusBarManager.setNoDevice();
                    } else {
                        statusBarManager.setDeviceConnected(remaining[0].displayName);
                    }
                }
            })
        );

        // Step 6: Update Python environment status
        if (services.pythonEnvManager) {
            const pythonPath = services.pythonEnvManager.getCurrentPythonPath();
            if (pythonPath) {
                statusBarManager.setPythonReady(pythonPath);
                devLogger.python('Python environment ready', { pythonPath });
            } else {
                statusBarManager.setPythonNotReady();
                devLogger.python('Python environment not configured');
            }
        }

        // Step 6: Set up lazy loading
        setupLazyLoading(context);

        const duration = Date.now() - startTime;
        devLogger.extension(`Simplified Mu 2 Extension activated successfully in ${duration}ms`);

    } catch (error) {
        const duration = Date.now() - startTime;
        devLogger.error('EXTENSION', `Activation failed after ${duration}ms`, error);

        // Update status bars to reflect error state
        if (statusBarManager) {
            statusBarManager.setPythonError('Activation failed');
            statusBarManager.setDeviceError('Activation failed');
        }

        vscode.window.showErrorMessage(`Mu 2 Extension failed to activate: ${error}`);
        throw error;
    }
}

/**
 * Fast activation path for subsequent startups
 */
async function fastActivation(context: vscode.ExtensionContext, activationState: any) {
    logger.info('EXTENSION', 'Fast activation: Initializing core with cached state...');

    // Step 1: Core infrastructure (always fast)
    componentRegistry = initializeCore(context);

    // Step 2: Initialize services with optimizations
    services = await initializeEssentialServices(context, componentRegistry, {
        skipPythonExtensionWait: activationState.flags.skipPythonExtensionWait,
        skipEnvironmentValidation: activationState.flags.skipEnvironmentValidation,
        skipPackageCheck: activationState.flags.skipPackageCheck,
        cachedPythonPath: activationState.pythonEnvironment.venvPath
    });

    // Step 3: Register UI components
    const uiComponents = registerUIComponents(context, componentRegistry);

    // Connect SimpleCommands with ReplViewProvider
    if (services.simpleCommands && uiComponents.webviewViewProvider) {
        services.simpleCommands.setReplViewProvider(uiComponents.webviewViewProvider);
        logger.info('EXTENSION', '✅ SimpleCommands connected with ReplViewProvider (fast path)');
    }

    // Step 4: Register CircuitPython language features
    registerCircuitPythonLanguageFeatures(context);

    // Step 5: Initialize BoardManager (may use cached device data)
    boardManager = await initializeBoardManager(
        context,
        services.deviceManager,
        services.languageClient,
        services.deviceDetector,
        services.ctpyDeviceFileSystemProvider
    );

    logger.info('EXTENSION', 'Fast activation completed');
}

/**
 * Full activation path for first run, development mode, or when validation fails
 */
async function fullActivation(context: vscode.ExtensionContext, activationState: any, isDevelopment: boolean) {
    logger.info('EXTENSION', 'Full activation: Performing complete initialization...');

    // Step 1: Initialize core infrastructure
    componentRegistry = initializeCore(context);

    // Step 2: Initialize essential services (full validation)
    services = await initializeEssentialServices(context, componentRegistry);

    // Update activation state with successful initialization
    if (services.pythonEnvManager) {
        const pythonPath = services.pythonEnvManager.getCurrentPythonPath();
        if (pythonPath) {
            activationStateManager.updatePythonEnvironment(pythonPath);
        }
    }

    // Step 3: Register UI components
    registerUIComponents(context, componentRegistry);

    // Step 4: Register CircuitPython language features
    registerCircuitPythonLanguageFeatures(context);

    // Step 5: Initialize BoardManager as primary device system
    boardManager = await initializeBoardManager(
        context,
        services.deviceManager,
        services.languageClient,
        services.deviceDetector,
        services.ctpyDeviceFileSystemProvider
    );

    // Mark services as initialized in state
    activationStateManager.markFileSystemProviderInitialized(
        services.muTwoFileSystemProvider?.getAllowedPaths?.() || []
    );
    activationStateManager.markDeviceDetectorInitialized();

    logger.info('EXTENSION', 'Full activation completed');
}

/**
 * Finalize activation (common steps for both paths)
 */
async function finalizeActivation(context: vscode.ExtensionContext) {
    // Step 1: Register commands
    registerCommands(context, boardManager);

    // Step 2: Set up lazy loading for optional services
    setupLazyLoading(context);

    // Step 3: Set context variables for custom editor activation
    // TODO: Refactor this context logic
    await vscode.commands.executeCommand('setContext', 'extension.muTwo.isActive', true);
    await vscode.commands.executeCommand('setContext', 'muTwo.Workspace.isOpen', true);
}

/**
 * Clean deactivation
 */
export function deactivate(): void {
    const devLogger = getDevLogger();
    devLogger.extension('Mu 2 Extension: Deactivating');

    // Dispose of Phase 1 infrastructure
    if (statusBarManager) {
        statusBarManager.dispose();
    }

    // Dispose of status bar item
    disposeStatusBar();

    // State manager handles all component disposal
    if (componentRegistry) {
        componentRegistry.dispose();
    }

    devLogger.extension('Mu 2 Extension: Deactivated');
}