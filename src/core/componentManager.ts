// src/core/componentManager.ts
// Handles UI component registration and lazy loading

import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { ComponentRegistry } from './componentRegistry';
import { ReplViewProvider } from '../providers/views/replViewProvider';
import { EditorReplPanelProvider } from '../providers/views/webviewPanelProvider';
import { CtpyDeviceFileSystemProvider } from '../workspace/filesystem/ctpyDeviceFSProvider'
import { MuTwoWorkspaceManager } from '../workspace/workspaceManager';
import { ProjectManager } from '../workspace/projectManager';
import { FileSaveTwiceHandler } from '../workspace/filesystem/saveTwiceHandler';
import { PythonEnvManager } from '../execution/pythonEnvManager';
import { BoardManager, IBoard } from '../devices/management/boardManager';
import { WorkspaceProjectsProvider } from '../providers/views/workspaceProjectsProvider';
import { LibraryManagerProvider } from '../providers/views/libraryManagerProvider';
import { getResourceLocator } from './resourceLocator';

const logger = getLogger();

// Component references that will be set during registration
export let webviewViewProvider: ReplViewProvider;
export let webviewPanelProvider: EditorReplPanelProvider;
export let workspaceProjectsProvider: WorkspaceProjectsProvider;
export let libraryManagerProvider: LibraryManagerProvider;

// Lazy-loaded components (fileSystemProvider now initialized early in activationManager)
export let workspaceManager: MuTwoWorkspaceManager | null = null;
export let projectManager: ProjectManager | null = null;
export let saveTwiceHandler: FileSaveTwiceHandler | null = null;

/**
 * Register UI components
 * Always succeeds - creates providers but doesn't connect to devices
 */
export function registerUIComponents(
    context: vscode.ExtensionContext,
    componentRegistry: ComponentRegistry
): {
    webviewViewProvider: ReplViewProvider;
    webviewPanelProvider: EditorReplPanelProvider;
} {
    logger.info('COMPONENTS', 'Registering UI components...');

    // Create REPL webview provider
    const resourceLocator = getResourceLocator();
    webviewViewProvider = new ReplViewProvider(resourceLocator.getExtensionUri(), context);
    componentRegistry.register('viewProvider', webviewViewProvider);

    // Register webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ReplViewProvider.viewType,
            webviewViewProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    // Create webview panel provider for connected REPLs
    webviewPanelProvider = new EditorReplPanelProvider(context);
    componentRegistry.register('webviewPanelProvider', webviewPanelProvider);
    logger.info('COMPONENTS', 'Webview panel provider created for connected REPL functionality');

    // Set context variable to show the projects view in explorer
    vscode.commands.executeCommand('setContext', 'workspaceHasProjectsFolder', true);
    logger.info('COMPONENTS', 'UI components registered (projects view will be initialized with Python environment)');

    // Note: Library manager provider will be registered separately after Python environment initialization

    logger.info('COMPONENTS', 'UI components registered');

    return {
        webviewViewProvider,
        webviewPanelProvider
    };
}

/**
 * Register workspace projects provider after Python environment initialization
 */
export function registerWorkspaceProjectsProvider(
    context: vscode.ExtensionContext,
    pythonEnvManager: PythonEnvManager,
    componentRegistry: ComponentRegistry
): void {
    logger.info('COMPONENTS', 'Registering workspace projects provider...');

    // Create workspace projects tree view provider
    workspaceProjectsProvider = new WorkspaceProjectsProvider(context, pythonEnvManager.getBundleManager());
    context.subscriptions.push(
        vscode.window.createTreeView('muTwo.workspaceProjects', {
            treeDataProvider: workspaceProjectsProvider,
            showCollapseAll: false
        })
    );
    componentRegistry.register('workspaceProjectsProvider', workspaceProjectsProvider);

    logger.info('COMPONENTS', 'Workspace projects provider registered');
}

/**
 * Register library manager provider after Python environment initialization
 */
export function registerLibraryManager(
    context: vscode.ExtensionContext,
    pythonEnvManager: PythonEnvManager,
    componentRegistry: ComponentRegistry
): void {
    logger.info('COMPONENTS', 'Registering library manager provider...');

    // Create library manager provider
    libraryManagerProvider = new LibraryManagerProvider(context, pythonEnvManager);
    context.subscriptions.push(
        vscode.window.createTreeView('muTwo.libraryManager', {
            treeDataProvider: libraryManagerProvider,
            showCollapseAll: true
        })
    );
    componentRegistry.register('libraryManagerProvider', libraryManagerProvider);

    logger.info('COMPONENTS', 'Library manager provider registered');
}

/**
 * Set up lazy loading for optional services
 * These are loaded on first use
 */
export function setupLazyLoading(context: vscode.ExtensionContext): void {
    logger.info('COMPONENTS', 'Setting up lazy loading...');

    // Python environment manager - initialized during activation
    // File system provider - initialized early during activation (no longer lazy-loaded)
    // Workspace manager - loaded when workspace commands are used
    // Project manager - loaded when project commands are used
    // Save-twice handler - loaded when workspace operations are used

    logger.info('COMPONENTS', 'Lazy loading configured');
}

/**
 * Get Python environment manager (initialized during activation)
 */
export function getPythonEnvManager(): PythonEnvManager | null {
    // This is handled by activationManager, but we import the reference
    const { pythonEnvManager } = require('./activationManager');
    if (!pythonEnvManager) {
        logger.warn('COMPONENTS', 'PythonEnvManager not available - initialization may have failed during activation');
    }
    return pythonEnvManager;
}

/**
 * Get CircuitPython device file system provider (now initialized early during activation)
 * This function is kept for compatibility but the provider is no longer lazy-loaded
 */
export function getCircuitPythonDeviceProvider(): CtpyDeviceFileSystemProvider {
	// Import the CircuitPython device provider from activationManager
	const { ctpyDeviceFileSystemProvider } = require('./activationManager')
	if (!ctpyDeviceFileSystemProvider) {
		throw new Error(
			'CircuitPython device provider not initialized. This should be initialized during core activation.'
		)
	}
	return ctpyDeviceFileSystemProvider
}


/**
 * Get workspace manager (lazy-loaded)
 */
export async function getWorkspaceManager(context: vscode.ExtensionContext, boardManager: BoardManager): Promise<MuTwoWorkspaceManager> {
    if (!workspaceManager) {
        logger.info('COMPONENTS', 'Lazy-loading workspace manager...');
        workspaceManager = new MuTwoWorkspaceManager(context, boardManager);
        logger.info('COMPONENTS', 'Workspace manager loaded successfully');
    }
    return workspaceManager;
}

/**
 * Get or create project manager instance (lazy loading)
 */
export function getProjectManager(context: vscode.ExtensionContext): ProjectManager {
    if (!projectManager) {
        logger.info('COMPONENTS', 'Lazy-loading project manager...');
        projectManager = new ProjectManager(context);
        logger.info('COMPONENTS', 'Project manager loaded successfully');
    }
    return projectManager;
}

/**
 * Get or create save-twice handler instance (lazy loading)
 */
export function getSaveTwiceHandler(
    context: vscode.ExtensionContext,
    boardManager: BoardManager
): FileSaveTwiceHandler {
    if (!saveTwiceHandler) {
        logger.info('COMPONENTS', 'Lazy-loading save-twice handler...');
        const pm = getProjectManager(context);
        saveTwiceHandler = new FileSaveTwiceHandler(context, pm, boardManager);
        logger.info('COMPONENTS', 'Save-twice handler loaded successfully');
    }
    return saveTwiceHandler;
}

/**
 * Get existing EditorReplPanelProvider instance (created during UI component registration)
 */
export async function getEditorPanelProvider(): Promise<EditorReplPanelProvider> {
    if (!webviewPanelProvider) {
        throw new Error('EditorReplPanelProvider not initialized. This should be created during UI component registration.');
    }
    return webviewPanelProvider;
}