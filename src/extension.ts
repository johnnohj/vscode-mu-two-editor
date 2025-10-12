// src/extension.ts
// Mu 2 Extension for Visual Studio Code
// Provides microcontroller development tools and device management,
// featuring CircuitPython

'use strict';

// Import necessary modules
import * as vscode from 'vscode';
import { getLogger } from './utils/unifiedLogger';
import { ComponentRegistry } from './core/componentRegistry';
import { BoardManager } from './devices/management/boardManager';

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
    disposeStatusBar
} from './core/boardEventManager';

import { initResourceLocator, getResourceLocator } from './core/resourceLocator';
import { initDevLogger, getDevLogger } from './utils/devLogger';
import { StatusBarManager } from './core/statusBarManager';
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
    logger.info('EXTENSION', '🚀 Starting Mu 2 Extension activation...');

    // Initialize devLogger early so it's available in catch block
    let devLogger: any;

    try {
        // Step 0: Initialize Phase 1 & 2 infrastructure
        initResourceLocator(context);
        initDevLogger(context);
        statusBarManager = new StatusBarManager(context);
        initDeviceRegistry(); // Phase 2: Single device detection system

        devLogger = getDevLogger();
        const resourceLocator = getResourceLocator();
        const deviceRegistry = getDeviceRegistry();

        devLogger.extension('Phase 1 & 2 infrastructure initialized');
        resourceLocator.logAllPaths((msg) => devLogger.extension(msg));
        devLogger.device(`DeviceRegistry initialized with ${deviceRegistry.getDeviceCount()} devices`);

        // Step 1: Initialize core infrastructure
        componentRegistry = await initializeCore(context);

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
        devLogger.extension(`Mu 2 Extension activated successfully in ${duration}ms`);

    } catch (error) {
        const duration = Date.now() - startTime;

        // Use devLogger if available, otherwise fall back to logger
        if (devLogger) {
            devLogger.error('EXTENSION', `Activation failed after ${duration}ms`, error);
        } else {
            logger.error('EXTENSION', `Activation failed after ${duration}ms (devLogger not initialized)`, error);
        }

        // Update status bars to reflect error state
        if (statusBarManager) {
            statusBarManager.setPythonError('Activation failed');
            statusBarManager.setDeviceError('Activation failed');
        }

        vscode.window.showErrorMessage(`Mu 2 Extension failed to activate: ${error}`);
        throw error;
    }

    // Return API for tests
    return {
        getResourceLocator
    };
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

    devLogger.extension('Mu 2 Extension: Deactivated');
}