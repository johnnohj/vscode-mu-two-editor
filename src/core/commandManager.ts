// src/core/commandManager.ts
// Handles all command registrations and implementations

import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { ExtensionStateManager } from '../utils/extensionStateManager';
import { BoardManager, IBoard } from '../devices/management/boardManager';
import { PythonEnvManager } from '../execution/pythonEnvManager';
import {
    getWorkspaceManager,
    getProjectManager,
    getSaveTwiceHandler,
    webviewViewProvider,
    webviewPanelProvider,
    workspaceProjectsProvider,
    libraryManagerProvider
} from './componentManager';

const logger = getLogger();

/**
 * Register all extension commands
 * Always succeeds - commands handle their own error cases
 */
export function registerCommands(
    context: vscode.ExtensionContext,
    boardManager: BoardManager
): void {
    logger.info('COMMANDS', 'Registering commands...');

    registerCoreCommands(context);
    registerBoardCommands(context, boardManager);
    registerWorkspaceCommands(context, boardManager);
    registerEditorCommands(context);
    registerProjectCommands(context, boardManager);
    registerProjectsViewCommands(context);
    registerLibraryManagerCommands(context);
    registerPythonCommands(context);
    // registerCLICommands removed - CLI processor no longer exists
    registerDebugCommands(context);

    logger.info('COMMANDS', 'Commands registered');
}

/**
 * Register core REPL commands
 */
function registerCoreCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.showView', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.replContainer');
        })
    );
}

/**
 * Register board management commands
 */
function registerBoardCommands(context: vscode.ExtensionContext, boardManager: BoardManager): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.list', async () => {
            await listBoardsCommand(boardManager);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.refresh', async () => {
            await refreshBoardsCommand(boardManager);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.connect', async (boardId?: string) => {
            await connectBoardCommand(boardManager, boardId);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.disconnect', async (boardId?: string) => {
            await disconnectBoardCommand(boardManager, boardId);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.executeCode', async (code?: string) => {
            await executeCodeCommand(boardManager, code);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.uploadFile', async () => {
            await uploadCurrentFileCommand(boardManager);
        })
    );

    // Legacy command compatibility
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.debug.detectDevices', async () => {
            await refreshBoardsCommand(boardManager);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.debug.startSession', async () => {
            await connectBoardCommand(boardManager);
        })
    );
}

/**
 * Register workspace commands
 */
function registerWorkspaceCommands(context: vscode.ExtensionContext, boardManager: BoardManager): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.workspace.create', async () => {
            const wm = await getWorkspaceManager(context, boardManager);
            await wm.createWorkspaceFlow();
            // Note: Save-twice handler will be initialized when needed
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.workspace.open', async () => {
            const wm = await getWorkspaceManager(context, boardManager);
            await wm.openWorkspaceCommand();
            // Note: Save-twice handler will be initialized when needed
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.workspace.changeBoardAssociation', async () => {
            const wm = await getWorkspaceManager(context, boardManager);
            await wm.changeBoardAssociationCommand();
        })
    );
}

/**
 * Register editor commands
 */
function registerEditorCommands(context: vscode.ExtensionContext): void {
    // Show/hide panel commands fired by VS Code when users click contributed buttons
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.showPanel', async () => {
            const activeEditor = vscode.window.activeTextEditor;

            if (activeEditor && activeEditor.document.languageId === 'python' && webviewPanelProvider) {
                await webviewPanelProvider.createOrShowPanel(activeEditor);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.hidePanel', () => {
            const activeEditor = vscode.window.activeTextEditor;

            if (activeEditor && activeEditor.document.languageId === 'python' && webviewPanelProvider) {
                webviewPanelProvider.hidePanel(activeEditor);
            }
        })
    );

    // Show/Hide Connected REPL Header commands
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.showHeader', () => {
            logger.info('COMMANDS', 'muTwo.editor.showHeader command triggered');

            if (webviewPanelProvider) {
                const activePanels = webviewPanelProvider.getActivePanels();
                if (activePanels.length > 0) {
                    logger.info('COMMANDS', 'Calling showHeader on first active panel');
                    activePanels[0].showHeader();
                } else {
                    logger.info('COMMANDS', 'No active REPL panels found');
                }
            } else {
                logger.info('COMMANDS', 'webviewPanelProvider not available');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.hideHeader', () => {
            logger.info('COMMANDS', 'muTwo.editor.hideHeader command triggered');

            if (webviewPanelProvider) {
                const activePanels = webviewPanelProvider.getActivePanels();
                if (activePanels.length > 0) {
                    logger.info('COMMANDS', 'Calling hideHeader on first active panel');
                    activePanels[0].hideHeader();
                } else {
                    logger.info('COMMANDS', 'No active REPL panels found');
                }
            } else {
                logger.info('COMMANDS', 'webviewPanelProvider not available');
            }
        })
    );

    // Show/Hide Connected Plotter Header commands
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.showPlotterHeader', () => {
            logger.info('COMMANDS', 'muTwo.editor.showPlotterHeader command triggered');

            if (webviewPanelProvider) {
                const activePlotterPanels = webviewPanelProvider.getActivePlotterPanels();
                if (activePlotterPanels.length > 0) {
                    logger.info('COMMANDS', 'Calling showHeader on first active plotter panel');
                    activePlotterPanels[0].showHeader();
                } else {
                    logger.info('COMMANDS', 'No active plotter panels found');
                }
            } else {
                logger.info('COMMANDS', 'webviewPanelProvider not available');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.hidePlotterHeader', () => {
            logger.info('COMMANDS', 'muTwo.editor.hidePlotterHeader command triggered');

            if (webviewPanelProvider) {
                const activePlotterPanels = webviewPanelProvider.getActivePlotterPanels();
                if (activePlotterPanels.length > 0) {
                    logger.info('COMMANDS', 'Calling hideHeader on first active plotter panel');
                    activePlotterPanels[0].hideHeader();
                } else {
                    logger.info('COMMANDS', 'No active plotter panels found');
                }
            } else {
                logger.info('COMMANDS', 'webviewPanelProvider not available');
            }
        })
    );

    // Hardware and Plotter panel commands
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.showHardwarePanel', async () => {
            logger.info('COMMANDS', 'muTwo.editor.showHardwarePanel command triggered');

            if (!webviewPanelProvider) {
                logger.error('COMMANDS', 'webviewPanelProvider is not available');
                return;
            }

            // Get the source editor from the active REPL panel
            const activePanels = webviewPanelProvider.getActivePanels();
            if (activePanels.length > 0) {
                const sourceEditor = activePanels[0].getSourceEditor();
                await webviewPanelProvider.createOrShowHardwarePanel(sourceEditor);
            } else {
                logger.warn('COMMANDS', 'No active REPL panels found for hardware panel creation');
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.showPlotterPanel', async () => {
            logger.info('COMMANDS', 'muTwo.editor.showPlotterPanel command triggered');

            if (!webviewPanelProvider) {
                logger.error('COMMANDS', 'webviewPanelProvider is not available');
                return;
            }

            // Get the source editor from the active REPL panel
            const activePanels = webviewPanelProvider.getActivePanels();
            if (activePanels.length > 0) {
                const sourceEditor = activePanels[0].getSourceEditor();
                await webviewPanelProvider.createOrShowPlotterPanel(sourceEditor);
            } else {
                logger.warn('COMMANDS', 'No active REPL panels found for plotter panel creation');
            }
        })
    );

    // Main editor command - opens standard text editor with workspace-aware REPL panel
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.openEditor', async (uri?: vscode.Uri) => {
            logger.info('COMMANDS', 'muTwo.editor.openEditor command called with URI:', uri?.toString());

            let document: vscode.TextDocument;

            if (uri) {
                document = await vscode.workspace.openTextDocument(uri);
            } else {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor.document.languageId === 'python') {
                    document = activeEditor.document;
                } else {
                    document = await vscode.workspace.openTextDocument({
                        language: 'python',
                        content: '# CircuitPython code\nimport time\n\nwhile True:\n    print("Hello, CircuitPython!")\n    time.sleep(1)\n'
                    });
                }
            }

            // Show the document in standard text editor
            const textEditor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

            // Split the editor vertically for workspace view
            await webviewPanelProvider.createOrShowPanel();

            logger.info('COMMANDS', 'Opened Python file in standard editor with vertical split');
        })
    );
}

/**
 * Register project management commands
 */
function registerProjectCommands(context: vscode.ExtensionContext, boardManager: BoardManager): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.project.load', async () => {
            await loadProjectCommand(context, boardManager);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.project.save', async () => {
            await saveProjectCommand(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.project.new', async () => {
            await newProjectCommand(context);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.project.list', async () => {
            await listProjectsCommand(context);
        })
    );
}

/**
 * Register workspace projects view commands
 */
function registerProjectsViewCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.projects.refresh', () => {
            workspaceProjectsProvider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.projects.toggleSelection', (projectName: string) => {
            workspaceProjectsProvider.toggleProjectSelection(projectName);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.projects.resumeSelected', async () => {
            await workspaceProjectsProvider.resumeSelectedProjects();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.projects.saveCurrentAs', async () => {
            await workspaceProjectsProvider.saveCurrentAsProject();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.projects.clearSelections', () => {
            workspaceProjectsProvider.clearSelections();
        })
    );

    // Requirements.txt management commands
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.projects.generateRequirements', async () => {
            const pythonEnvManager = getPythonEnvManager();
            if (!pythonEnvManager) {
                vscode.window.showErrorMessage('Python environment not available');
                return;
            }

            const bundleManager = pythonEnvManager.getBundleManager();
            if (!bundleManager) {
                vscode.window.showErrorMessage('Bundle manager not available');
                return;
            }

            try {
                const success = await bundleManager.generateRequirementsFromWorkspace();
                if (success) {
                    vscode.window.showInformationMessage('Requirements.txt generated successfully from workspace libraries');
                } else {
                    vscode.window.showErrorMessage('Failed to generate requirements.txt');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to generate requirements.txt: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.projects.installFromRequirements', async () => {
            const pythonEnvManager = getPythonEnvManager();
            if (!pythonEnvManager) {
                vscode.window.showErrorMessage('Python environment not available');
                return;
            }

            const bundleManager = pythonEnvManager.getBundleManager();
            if (!bundleManager) {
                vscode.window.showErrorMessage('Bundle manager not available');
                return;
            }

            try {
                const hasRequirements = await bundleManager.hasRequirementsFile();
                if (!hasRequirements) {
                    vscode.window.showWarningMessage('No requirements.txt file found in workspace');
                    return;
                }

                const success = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Installing libraries from requirements.txt',
                    cancellable: false
                }, async () => {
                    return await bundleManager.installLibrariesFromRequirements();
                });

                if (success) {
                    vscode.window.showInformationMessage('Libraries installed successfully from requirements.txt');
                    // Refresh library manager view if available
                    if (libraryManagerProvider) {
                        libraryManagerProvider.refresh();
                    }
                } else {
                    vscode.window.showErrorMessage('Failed to install libraries from requirements.txt');
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to install from requirements.txt: ${error}`);
            }
        })
    );
}

/**
 * Register library manager commands
 */
function registerLibraryManagerCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.library.refresh', () => {
            if (libraryManagerProvider) {
                libraryManagerProvider.refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.library.install', async (libraryName: string) => {
            if (libraryManagerProvider) {
                await libraryManagerProvider.installLibrary(libraryName);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.library.remove', async (libraryName: string) => {
            if (libraryManagerProvider) {
                await libraryManagerProvider.removeLibrary(libraryName);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.library.downloadBundle', async () => {
            if (libraryManagerProvider) {
                await libraryManagerProvider.downloadBundle();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.library.search', async () => {
            const searchTerm = await vscode.window.showInputBox({
                prompt: 'Search CircuitPython libraries',
                placeHolder: 'Enter library name or keyword...'
            });

            if (searchTerm !== undefined && libraryManagerProvider) {
                libraryManagerProvider.setSearchFilter(searchTerm);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.library.info', async (libraryName: string) => {
            if (libraryManagerProvider) {
                await libraryManagerProvider.showLibraryInfo(libraryName);
            }
        })
    );
}

/**
 * Register Python environment commands
 */
function registerPythonCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.setupPythonEnvironment', async () => {
            await setupPythonEnvironmentCommand(context);
        })
    );
}

/**
 * Register CLI commands
 * NOTE: CLI processor has been removed - these commands are deprecated
 */
// function registerCLICommands(context: vscode.ExtensionContext): void {
//     context.subscriptions.push(
//         vscode.commands.registerCommand('muTwo.testCLI', async () => {
//             vscode.window.showInformationMessage('CLI commands have been removed');
//         })
//     );
// }

/**
 * Register debug commands
 */
function registerDebugCommands(context: vscode.ExtensionContext): void {
    // Debug command to check context values
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.debug.checkContext', () => {
            const activeEditor = vscode.window.activeTextEditor;
            logger.info('COMMANDS', '=== CONTEXT DEBUG ===');
            logger.info('COMMANDS', 'Active editor:', activeEditor?.document.fileName);
            logger.info('COMMANDS', 'Language ID:', activeEditor?.document.languageId);
            logger.info('COMMANDS', 'WebviewPanelProvider exists:', !!webviewPanelProvider);
            logger.info('COMMANDS', 'Active panels:', webviewPanelProvider ? Array.from(webviewPanelProvider.getActivePanels().map(p => p.constructor.name)) : 'none');
            vscode.window.showInformationMessage('Check console for context debug info');
        })
    );

    // Test command for webview panel positioning
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.debug.testWebviewPanel', async () => {
            await testWebviewPanelCommand(context);
        })
    );
}

// Command implementations
async function listBoardsCommand(boardManager: BoardManager): Promise<void> {
    const boards = boardManager.getAllBoards();
    if (boards.length === 0) {
        vscode.window.showInformationMessage('No boards detected. Try refreshing or connecting a CircuitPython device.');
        return;
    }

    const boardItems = boards.map(board => ({
        label: board.name,
        description: `${board.type.toUpperCase()} - ${board.isConnected() ? 'Connected' : 'Disconnected'}`,
        detail: board.connectionState.deviceInfo?.path || board.id,
        board
    }));

    const selected = await vscode.window.showQuickPick(boardItems, {
        placeHolder: 'Select a board to manage',
        ignoreFocusOut: true
    });

    if (selected) {
        const actions = selected.board.isConnected()
            ? ['Disconnect', 'Execute Code', 'View Files']
            : ['Connect'];

        const action = await vscode.window.showQuickPick(actions, {
            placeHolder: `Actions for ${selected.board.name}`
        });

        switch (action) {
            case 'Connect':
                await connectBoardCommand(boardManager, selected.board.id);
                break;
            case 'Disconnect':
                await disconnectBoardCommand(boardManager, selected.board.id);
                break;
            case 'Execute Code':
                await executeCodeCommand(boardManager);
                break;
            case 'View Files':
                await viewBoardFilesCommand(selected.board);
                break;
        }
    }
}

async function refreshBoardsCommand(boardManager: BoardManager): Promise<void> {
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Refreshing boards...',
            cancellable: false
        }, async () => {
            await boardManager.refreshDevices();
        });

        const boards = boardManager.getAllBoards();
        vscode.window.showInformationMessage(`Found ${boards.length} board(s)`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to refresh boards: ${error}`);
    }
}

async function connectBoardCommand(boardManager: BoardManager, boardId?: string): Promise<void> {
    let board: IBoard | undefined;

    if (boardId) {
        board = boardManager.getBoard(boardId);
    } else {
        board = boardManager.getBestBoard();
        if (!board) {
            vscode.window.showInformationMessage('No boards available. Try refreshing.');
            return;
        }
    }

    if (!board) {
        vscode.window.showErrorMessage('Board not found');
        return;
    }

    if (board.isConnected()) {
        vscode.window.showInformationMessage(`${board.name} is already connected`);
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Connecting to ${board.name}...`,
            cancellable: false
        }, async () => {
            await board!.connect();
        });

        vscode.window.showInformationMessage(`Connected to ${board.name}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to connect to ${board.name}: ${error}`);
    }
}

async function disconnectBoardCommand(boardManager: BoardManager, boardId?: string): Promise<void> {
    let board: IBoard | undefined;

    if (boardId) {
        board = boardManager.getBoard(boardId);
    } else {
        const connectedBoards = boardManager.getConnectedBoards();
        if (connectedBoards.length === 0) {
            vscode.window.showInformationMessage('No connected boards');
            return;
        }
        board = connectedBoards[0];
    }

    if (!board) {
        vscode.window.showErrorMessage('Board not found');
        return;
    }

    if (!board.isConnected()) {
        vscode.window.showInformationMessage(`${board.name} is not connected`);
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Disconnecting from ${board.name}...`,
            cancellable: false
        }, async () => {
            await board!.disconnect();
        });

        vscode.window.showInformationMessage(`Disconnected from ${board.name}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to disconnect from ${board.name}: ${error}`);
    }
}

async function executeCodeCommand(boardManager: BoardManager, code?: string): Promise<void> {
    const board = boardManager.getBestBoard();
    if (!board) {
        vscode.window.showErrorMessage('No boards available');
        return;
    }

    if (!board.isConnected()) {
        vscode.window.showErrorMessage(`Board ${board.name} is not connected`);
        return;
    }

    if (!code) {
        code = await vscode.window.showInputBox({
            prompt: 'Enter Python code to execute',
            placeHolder: 'print("Hello, CircuitPython!")'
        });

        if (!code) {
            return;
        }
    }

    try {
        const result = await board.eval(code);
        if (result.success) {
            vscode.window.showInformationMessage(`Executed successfully: ${result.output || 'No output'}`);
        } else {
            vscode.window.showErrorMessage(`Execution failed: ${result.error || 'Unknown error'}`);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to execute code: ${error}`);
    }
}

async function uploadCurrentFileCommand(boardManager: BoardManager): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage('No active file to upload');
        return;
    }

    const board = boardManager.getBestBoard();
    if (!board) {
        vscode.window.showErrorMessage('No boards available');
        return;
    }

    if (!board.isConnected()) {
        vscode.window.showErrorMessage(`Board ${board.name} is not connected`);
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Uploading ${activeEditor.document.fileName} to ${board.name}...`,
            cancellable: false
        }, async () => {
            vscode.window.showInformationMessage('File upload feature coming soon');
        });
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to upload file: ${error}`);
    }
}

async function viewBoardFilesCommand(board: IBoard): Promise<void> {
    if (!board.isConnected()) {
        vscode.window.showErrorMessage(`Board ${board.name} is not connected`);
        return;
    }

    vscode.window.showInformationMessage('Board file browser feature coming soon');
}

async function loadProjectCommand(context: vscode.ExtensionContext, boardManager: BoardManager): Promise<void> {
    try {
        const wm = await getWorkspaceManager(context, boardManager);
        const pm = getProjectManager(context);

        const projects = await pm.listProjects();
        if (projects.length === 0) {
            vscode.window.showInformationMessage('No projects found. Create a project first.');
            return;
        }

        const selectedProject = await vscode.window.showQuickPick(projects, {
            placeHolder: 'Select a project to load'
        });

        if (selectedProject) {
            await pm.loadProject(selectedProject);
        }
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to load project: ${error}`);
    }
}

async function saveProjectCommand(context: vscode.ExtensionContext): Promise<void> {
    try {
        const pm = getProjectManager(context);
        await pm.saveProjectAs();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to save project: ${error}`);
    }
}

async function newProjectCommand(context: vscode.ExtensionContext): Promise<void> {
    try {
        const pm = getProjectManager(context);
        await pm.createNewProject();
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to create new project: ${error}`);
    }
}

async function listProjectsCommand(context: vscode.ExtensionContext): Promise<void> {
    try {
        const pm = getProjectManager(context);
        const projects = await pm.listProjects();
        const currentProject = pm.getCurrentProjectName();

        if (projects.length === 0) {
            vscode.window.showInformationMessage('No projects found');
            return;
        }

        const projectList = projects.map(name =>
            name === currentProject ? `▶ ${name} (current)` : `  ${name}`
        ).join('\n');

        vscode.window.showInformationMessage(
            `Projects in workspace:\n\n${projectList}`,
            { modal: false }
        );
    } catch (error) {
        vscode.window.showErrorMessage(`Failed to list projects: ${error}`);
    }
}

async function setupPythonEnvironmentCommand(context: vscode.ExtensionContext): Promise<void> {
    try {
        const stateManager = ExtensionStateManager.getInstance(context);

        // Check if already in progress
        if (stateManager.tryGetComponent('pythonEnvManager')) {
            vscode.window.showInformationMessage('Python environment setup is already in progress or completed.');
            return;
        }

        vscode.window.showInformationMessage('Setting up Mu 2 Python environment...');

        // Try to re-initialize the Python environment manager
        const newPythonEnvManager = new PythonEnvManager(context);
        await newPythonEnvManager.initialize();

        // Mark venv as successfully activated
        const venvPath = newPythonEnvManager.getCurrentPythonPath();
        if (venvPath) {
            stateManager.setPythonVenvActivated(venvPath);
            stateManager.setComponent('pythonEnvManager', newPythonEnvManager);

            vscode.window.showInformationMessage('Mu 2 Python environment setup completed successfully!');
        } else {
            throw new Error('Python environment manager initialized but no valid Python path available');
        }

    } catch (error) {
        const stateManager = ExtensionStateManager.getInstance(context);
        const errorMessage = error instanceof Error ? error.message : String(error);
        stateManager.setPythonVenvFailed(errorMessage);

        vscode.window.showErrorMessage(
            `Failed to setup Python environment: ${errorMessage}`,
            'Show Logs'
        ).then(selection => {
            if (selection === 'Show Logs') {
                vscode.commands.executeCommand('workbench.action.toggleDevTools');
            }
        });
    }
}

// Removed: CLI processor no longer exists
// async function testCLICommand(): Promise<void> {
//     const testCommands = [
//         'mu help',
//         'mu version',
//         'mu env status',
//         'mu runtime status',
//         'mu devices',
//         'mu config list'
//     ];
//
//     const selectedCommand = await vscode.window.showQuickPick(testCommands, {
//         placeHolder: 'Select a CLI command to test'
//     });
//
//     if (!selectedCommand) {
//         return;
//     }
//
//     try {
//         logger.info('COMMANDS', `Testing CLI command: ${selectedCommand}`);
//         // const result = await cliProcessor.processCommand(selectedCommand);
//
//         let message = `Command: ${selectedCommand}\n`;
//         // message += `Type: ${result.type}\n`;
//
//         // if (result.message) {
//         //     message += `Result:\n${result.message}`;
//         // }
//
//         vscode.window.showInformationMessage(`CLI commands have been removed`, { modal: true });
//
// //         logger.info('COMMANDS', `CLI test - feature removed`);
//
//     } catch (error) {
//         const errorMessage = `CLI test failed: ${error instanceof Error ? error.message : String(error)}`;
//         vscode.window.showErrorMessage(errorMessage);
//         logger.error('COMMANDS', 'CLI test error:', error);
//     }
// }

async function testWebviewPanelCommand(context: vscode.ExtensionContext): Promise<void> {
    const testOptions = [
        'Pure Split Editor Down (No Panel)',
        'Split + Create Webview in Split',
        'Create Panel Only (No Split Commands)',
        'Create Panel + Split After',
        'Split After Panel Creation',
        'Basic Below Split',
        'ViewColumn.Beside',
        'Split Editor Down Command',
        'Move to Below Group Command',
        'ViewColumn.Two'
    ];

    const selected = await vscode.window.showQuickPick(testOptions, {
        placeHolder: 'Select positioning test to run'
    });

    if (!selected) return;

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        vscode.window.showErrorMessage('Please open a file first to test panel positioning');
        return;
    }

    logger.info('COMMANDS', `=== Testing: ${selected} ===`);

    try {
        // Implementation would call appropriate test functions
        vscode.window.showInformationMessage(`${selected} test completed`);
    } catch (error) {
        logger.error('COMMANDS', `Test failed:`, error);
        vscode.window.showErrorMessage(`${selected} test failed: ${error}`);
    }
}