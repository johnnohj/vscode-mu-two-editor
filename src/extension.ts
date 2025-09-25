// src/extension.ts
// Mu 2 Extension for Visual Studio Code
// Provides microcontroller development tools and device management,
// featuring CircuitPython

'use strict';

// Import necessary modules
import * as vscode from 'vscode';
import { getLogger } from './utils/unifiedLogger';
import { ExtensionStateManager } from './utils/extensionStateManager';
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

// Global state
const logger = getLogger();
let stateManager: ExtensionStateManager;
let boardManager: BoardManager;

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
        // Step 1: Initialize core infrastructure
        stateManager = initializeCore(context);

        // Step 2: Initialize essential services (now simplified)
        services = await initializeEssentialServices(context, stateManager);

        // Step 3: Initialize board management and UI components
        try {
            boardManager = await initializeBoardManager(
                context,
                services.deviceManager,
                services.languageClient,
                services.deviceDetector,
                services.ctpyDeviceFileSystemProvider
            );
            if (boardManager) {
                setupBoardEventHandlers(boardManager);
                logger.info('EXTENSION', '✅ BoardManager initialized successfully');
            }
        } catch (error) {
            logger.warn('EXTENSION', '⚠️ BoardManager initialization failed, continuing without board management:', error);
            // Continue activation without BoardManager - some features will be limited
        }

        // Step 4: Register UI components and language features
        const uiComponents = await registerUIComponents(context, stateManager);

        // Connect SimpleCommands with ReplViewProvider immediately after UI creation
        if (services.simpleCommands && uiComponents.webviewViewProvider) {
            services.simpleCommands.setReplViewProvider(uiComponents.webviewViewProvider);
            logger.info('EXTENSION', '✅ SimpleCommands connected with ReplViewProvider');
        }

        registerCommands(context);
        registerCircuitPythonLanguageFeatures(context);

        // Step 5: Set up lazy loading
        setupLazyLoading(context);

        const duration = Date.now() - startTime;
        logger.info('EXTENSION', `✅ Simplified Mu 2 Extension activated successfully in ${duration}ms`);

    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('EXTENSION', `❌ Activation failed after ${duration}ms:`, error);
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
    stateManager = initializeCore(context);

    // Step 2: Initialize services with optimizations
    services = await initializeEssentialServices(context, stateManager, {
        skipPythonExtensionWait: activationState.flags.skipPythonExtensionWait,
        skipEnvironmentValidation: activationState.flags.skipEnvironmentValidation,
        skipPackageCheck: activationState.flags.skipPackageCheck,
        cachedPythonPath: activationState.pythonEnvironment.venvPath
    });

    // Step 3: Register UI components
    const uiComponents = registerUIComponents(context, stateManager);

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
    stateManager = initializeCore(context);

    // Step 2: Initialize essential services (full validation)
    services = await initializeEssentialServices(context, stateManager);

    // Update activation state with successful initialization
    if (services.pythonEnvManager) {
        const pythonPath = services.pythonEnvManager.getCurrentPythonPath();
        if (pythonPath) {
            activationStateManager.updatePythonEnvironment(pythonPath);
        }
    }

    // Step 3: Register UI components
    registerUIComponents(context, stateManager);

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
    registerCommands(context, boardManager, services.cliProcessor);

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
    logger.info('EXTENSION', 'Mu 2 Extension: Deactivating...');

    // Dispose of status bar item
    disposeStatusBar();

    // Dispose of background task scheduler
    if (backgroundTaskScheduler) {
        backgroundTaskScheduler.dispose();
    }

    // Save final activation state
    if (activationStateManager) {
        activationStateManager.saveState().catch(error => {
            logger.warn('EXTENSION', 'Failed to save activation state during deactivation:', error);
        });
    }

    // State manager handles all component disposal
    if (stateManager) {
        stateManager.dispose();
    }

    logger.info('EXTENSION', 'Mu 2 Extension: Deactivated');
}