// src/extension.ts
// Mu 2 Extension for Visual Studio Code
// Provides CircuitPython development tools and device management

/* 
	NOTICE: This extension has yet to be released, so 'legacy' compatibility need not be maintained 
	-jef, 22 Aug 2025
*/

'use strict';
/* 
	TODO: I have revised list of import signatures to reflect proper priorities. 
	The order here is largely driven by external realities, for example, by 
	the fact that the Python environment manager must be initialized before 
	any other Python-dependent services to prevent wreaking havoc on the user's 
	system, or that, by contributing a view to the panel area, it's possible that view
	will be visible as soon as the VS Code window opens, so the view provider should be
	created and registered as early as possible, even if it can't do much until a board 
	is connected. It's possible the WorkspaceManager should be moved up in priority, 
	because, like the ReplViewProvider, it may be needed immediately if the user has
	a workspace open when the extension activates. If we don't move it up, then we
	at least should ensure it, along with the file system provider, has a heightened 
	priority compared to the other Core services. -jef
*/
// Import necessary modules
import * as vscode from 'vscode';
import { CircuitPythonDeviceDetector, IDevice } from './devices/deviceDetector';
import { ExtensionStateManager } from './sys/extensionStateManager';
import { PythonEnvManager } from './sys/pythonEnvManager';
// TODO: Perhaps we can perform a quick 'isVisible' check on the replView panel to see if 
// we need to initialize the Provider right away, or if we can wait. -john
import { ReplViewProvider } from './providers/replViewProvider';

// Core services - always loaded
import { BoardManager, IBoard } from './sys/boardManager';
import { CtpyFileSystemProvider } from './sys/fileSystemProvider';
import { DeviceManager } from './devices/deviceManager';
import { MuTwoLanguageClient } from './interface/client';
import { MuTwoWorkspaceManager } from './workspace/workspaceManager';

// On-demand services - loaded when needed
import { EditorPanelProvider } from './providers/editorPanelProvider';
import { MuTwoWorkspace } from './workspace/workspace';
import { ProjectManager } from './workspace/core/projectManager';
import { FileSaveTwiceHandler } from './workspace/filesystem/saveTwiceHandler';

/* 
	TODO: These 'export let' statements were useful initially, but we must have a cleaner way of
	accomplishing the intended purpose by now, which was to prevent annoying eslint/TS typing/etc. 
	errors. -john 
*/
	
// Global state
let stateManager: ExtensionStateManager;
let boardManager: BoardManager;

// Core services (always available)
export let deviceManager: DeviceManager;
export let languageClient: MuTwoLanguageClient;
export let webviewViewProvider: ReplViewProvider;
export let editorPanelProvider: EditorPanelProvider;
export let deviceDetector: CircuitPythonDeviceDetector;

// On-demand services (loaded as needed)
export let pythonEnvManager: PythonEnvManager | null = null;
export let fileSystemProvider: CtpyFileSystemProvider | null = null;
export let workspaceManager: MuTwoWorkspaceManager | null = null;
export let projectManager: ProjectManager | null = null;
export let saveTwiceHandler: FileSaveTwiceHandler | null = null;

/**
 * Clean, predictable extension activation
 */
export async function activate(context: vscode.ExtensionContext) {
    console.log('Mu 2 Extension: Starting activation...');
    
    try {
        // Step 1: Initialize core infrastructure (always succeeds)
        initializeCore(context);
        
        // Step 2: Initialize essential services (always succeeds)
        await initializeEssentialServices(context);
        
        // Step 3: Register UI components (always succeeds)
        registerUIComponents(context);
        
        // Step 4: Register commands (always succeeds)
        registerCommands(context);
        
        // Step 5: Initialize BoardManager as primary device system
        await initializeBoardManager(context);
        
        // Step 6: Set up lazy loading for optional services
        setupLazyLoading(context);
        
        console.log('Mu 2 Extension: Activation completed successfully');
        
    } catch (error) {
        console.error('Mu 2 Extension: Activation failed:', error);
        vscode.window.showErrorMessage(`Mu 2 Extension failed to activate: ${error}`);
        throw error;
    }
}

/**
 * Step 1: Initialize core infrastructure
 * This always succeeds - no external dependencies
 */
function initializeCore(context: vscode.ExtensionContext): void {
    console.log('Initializing core infrastructure...');
    
    // Initialize state management
    stateManager = ExtensionStateManager.getInstance(context);
    
    // Create required directories (non-blocking)
    createDirectories(context).catch(error => {
        console.warn('Failed to create directories:', error);
    });
    
    console.log('Core infrastructure initialized');
}

/**
 * Step 2: Initialize essential services
 * These are required for basic functionality
 */
async function initializeEssentialServices(context: vscode.ExtensionContext): Promise<void> {
    console.log('Initializing essential services...');
    
    // Initialize Python environment manager first to ensure venv activation
    // This prevents interference with other Python-dependent services
    try {
        console.log('Initializing Python environment (venv activation)...');
        pythonEnvManager = new PythonEnvManager(context);
        await pythonEnvManager.initialize();
        
        // Mark venv as successfully activated in state manager
        const venvPath = pythonEnvManager.getCurrentPythonPath();
        if (venvPath) {
            stateManager.setPythonVenvActivated(venvPath);
            console.log('Python environment initialized successfully');
        } else {
            throw new Error('PythonEnvManager initialized but no valid Python path available');
        }
        
        stateManager.setComponent('pythonEnvManager', pythonEnvManager);
    } catch (error) {
        console.warn('Python environment initialization failed (extension will continue):', error);
        
        // Mark venv as failed in state manager
        stateManager.setPythonVenvFailed(error instanceof Error ? error.message : String(error));
        
        // Show user-friendly warning about Python environment
        vscode.window.showWarningMessage(
            'Mu 2 Python environment could not be activated. Some features may be limited to prevent interference with your system Python.',
            'Learn More',
            'Retry Setup'
        ).then(selection => {
            if (selection === 'Learn More') {
                // TODO: Open documentation about Python environment setup
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/mu-editor/mu-two-docs/python-setup'));
            } else if (selection === 'Retry Setup') {
                // TODO: Add command to retry Python environment setup
                vscode.commands.executeCommand('muTwo.setupPythonEnvironment');
            }
        });
        
        // Continue without Python env - not critical for core functionality
        pythonEnvManager = null;
    }
    
    // Initialize device manager (always succeeds)
    deviceManager = new DeviceManager(context);
    stateManager.setComponent('deviceManager', deviceManager);
    
    // Initialize LSP client (always succeeds, starts in background)
    languageClient = new MuTwoLanguageClient(context);
    stateManager.setComponent('languageClient', languageClient);
    
    // Initialize device detector
    deviceDetector = new CircuitPythonDeviceDetector();
    stateManager.setComponent('deviceDetector', deviceDetector);
    
    // Start LSP in background - don't wait or fail on errors
    languageClient.start().then(() => {
        console.log('Language server started successfully');
    }).catch(error => {
        console.log('Language server startup failed (continuing without LSP):', error);
    });
    
    console.log('Essential services initialized');
}

/**
 * Initialize BoardManager as the primary device management system
 */
async function initializeBoardManager(context: vscode.ExtensionContext): Promise<void> {
    console.log('Initializing BoardManager as primary device system...');
    
    try {
        // Get file system provider
        fileSystemProvider = await getFileSystemProvider(context);
        
        // Create BoardManager as the primary device management system
        boardManager = new BoardManager(
            context,
            deviceManager,
            languageClient,
            fileSystemProvider,
            deviceDetector
        );
        
        stateManager.setComponent('boardManager', boardManager);
        
        // Set up board event handlers
        setupBoardEventHandlers();
        
        // Connect board manager to view provider if it exists
        if (webviewViewProvider) {
            webviewViewProvider.setBoardManager(boardManager);
        }
        
        // Initialize board detection
        await boardManager.initialize();
        
        console.log('BoardManager initialized successfully');
        
    } catch (error) {
        console.error('BoardManager initialization failed:', error);
        throw error;
    }
}

function setupBoardEventHandlers(): void {
    boardManager.onBoardAdded((board) => {
        console.log(`Board added: ${board.name} (${board.type})`);
        updateStatusBar();
        notifyWebviewsOfBoardChange();
    });
    
    boardManager.onBoardRemoved((board) => {
        console.log(`Board removed: ${board.name}`);
        updateStatusBar();
        notifyWebviewsOfBoardChange();
    });
    
    boardManager.onBoardConnectionChanged(({ board, state }) => {
        console.log(`Board ${board.name} connection changed:`, state);
        updateStatusBar();
        notifyWebviewsOfBoardChange();
    });
}

function updateStatusBar(): void {
    const connectedBoards = boardManager.getConnectedBoards();
    const totalBoards = boardManager.getAllBoards();
    
    vscode.window.setStatusBarMessage(
        `CircuitPython: ${connectedBoards.length}/${totalBoards.length} boards connected`,
        5000
    );
}

function notifyWebviewsOfBoardChange(): void {
    const boardList = boardManager.getAllBoards().map(board => ({
        id: board.id,
        name: board.name,
        type: board.type,
        connected: board.isConnected(),
        connectionState: board.connectionState,
        capabilities: board.capabilities
    }));
    
    if (webviewViewProvider && typeof webviewViewProvider.sendMessage === 'function') {
        webviewViewProvider.sendMessage({
            type: 'boardsUpdated',
            data: boardList
        });
    }
    
    if (editorPanelProvider && typeof editorPanelProvider.sendMessage === 'function') {
        editorPanelProvider.sendMessage({
            type: 'boardsUpdated',
            data: boardList
        });
    }
}

/**
 * Step 3: Register UI components
 * Always succeeds - creates providers but doesn't connect to devices
 */
function registerUIComponents(context: vscode.ExtensionContext): void {
    console.log('Registering UI components...');
    
    // Create REPL webview provider
    webviewViewProvider = new ReplViewProvider(context.extensionUri, context);
    stateManager.setComponent('viewProvider', webviewViewProvider);
    
    // Register webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ReplViewProvider.viewType, 
            webviewViewProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );
    
    // Create editor panel provider
    editorPanelProvider = new EditorPanelProvider(context);
    stateManager.setComponent('editorPanelProvider', editorPanelProvider);
    
    console.log('UI components registered');
}

/**
 * Step 4: Register commands
 * Always succeeds - commands handle their own error cases
 */
function registerCommands(context: vscode.ExtensionContext): void {
    console.log('Registering commands...');
    
    // Core REPL commands
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.showView', async () => {
            await vscode.commands.executeCommand('workbench.view.extension.replContainer');
        })
    );
    
    // Board management commands (primary system)
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.list', async () => {
            await listBoardsCommand();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.refresh', async () => {
            await refreshBoardsCommand();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.connect', async (boardId?: string) => {
            await connectBoardCommand(boardId);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.disconnect', async (boardId?: string) => {
            await disconnectBoardCommand(boardId);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.executeCode', async (code?: string) => {
            await executeCodeCommand(code);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.boards.uploadFile', async () => {
            await uploadCurrentFileCommand();
        })
    );

    // Legacy command compatibility (delegates to board system)
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.debug.detectDevices', async () => {
            await refreshBoardsCommand();
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.debug.startSession', async () => {
            await connectBoardCommand();
        })
    );
    
    // Workspace commands (will lazy-load workspace manager)
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.workspace.create', async () => {
            const wm = await getWorkspaceManager(context);
            await wm.createWorkspaceFlow();
            // Initialize save-twice handler for new workspace
            getSaveTwiceHandler(context);
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.workspace.open', async () => {
            const wm = await getWorkspaceManager(context);
            await wm.openWorkspaceCommand();
            // Initialize save-twice handler for opened workspace
            getSaveTwiceHandler(context);
        })
    );
    
    // Editor commands
	 // 'showPanel' and 'hidePanel' are fired by VS Code when users click the contributed button icon in the editor
	 // title bar/navigation area. 
	 // Messages are sent directly to the webview component for handling.
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.showPanel', () => {
            editorPanelProvider.sendMessage({ type: 'showPanel' });
		  })
	 );
	 	 
	 context.subscriptions.push(
		  vscode.commands.registerCommand('muTwo.editor.hidePanel', () => {
				editorPanelProvider.sendMessage({ type: 'hidePanel' });
		  })
	 );

    // Project Management Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.project.load', async () => {
            await loadProjectCommand(context);
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

    // Python environment commands
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.setupPythonEnvironment', async () => {
            await setupPythonEnvironmentCommand(context);
        })
    );
    
    console.log('Commands registered');
}

/**
 * Step 5: Set up lazy loading for optional services
 * These are loaded on first use
 */
function setupLazyLoading(context: vscode.ExtensionContext): void {
    console.log('Setting up lazy loading...');
    
    // Python environment manager - loaded when first accessed
    // (Used by editor features and Blinka)
    
    // File system provider - loaded when first device connects
    // (Used for device file operations)
    
    // Workspace manager - loaded when workspace commands are used
    // (Used for workspace management)
    
    console.log('Lazy loading configured');
}

/**
 * Get Python environment manager (initialized during activation)
 */
export function getPythonEnvManager(): PythonEnvManager | null {
    if (!pythonEnvManager) {
        console.warn('PythonEnvManager not available - initialization may have failed during activation');
    }
    return pythonEnvManager;
}

/**
 * Get file system provider (lazy-loaded)
 */
export async function getFileSystemProvider(context: vscode.ExtensionContext): Promise<CtpyFileSystemProvider> {
    if (!fileSystemProvider) {
        console.log('Lazy-loading scoped file system provider...');
        fileSystemProvider = new CtpyFileSystemProvider();
        stateManager.setComponent('fileSystemProvider', fileSystemProvider);
        
        // Configure allowed directories
        await configureFileSystemProviderScope(context, fileSystemProvider);
        
        // Register file system provider
        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider('ctpy', fileSystemProvider, {
                isCaseSensitive: true,
                isReadonly: false
            })
        );
        
        console.log('Scoped file system provider loaded successfully');
    }
    return fileSystemProvider;
}

/**
 * Configure the allowed directories for the scoped file system provider
 */
async function configureFileSystemProviderScope(context: vscode.ExtensionContext, provider: CtpyFileSystemProvider): Promise<void> {
    // Add extension storage directories
    if (context.storageUri) {
        provider.addAllowedPath(context.storageUri.fsPath);
        console.log(`Added workspace storage path: ${context.storageUri.fsPath}`);
    }
    
    if (context.globalStorageUri) {
        provider.addAllowedPath(context.globalStorageUri.fsPath);
        console.log(`Added global storage path: ${context.globalStorageUri.fsPath}`);
    }
    
    // Add current MuTwoWorkspace directory if one is open
    const currentWorkspace = MuTwoWorkspace.rootPath;
    let workspaceUtil: MuTwoWorkspaceManager | null = null;
    
    if (currentWorkspace) {
        workspaceUtil = await getWorkspaceManager(context);
        const isMuTwoWorkspace = await workspaceUtil.workspaceUtil.isMu2Workspace(currentWorkspace);
        if (isMuTwoWorkspace) {
            provider.addAllowedPath(currentWorkspace.fsPath);
            console.log(`Added MuTwo workspace path: ${currentWorkspace.fsPath}`);
        }
    }
    
    // Add registered workspaces from the workspace registry
    try {
        if (!workspaceUtil) {
            workspaceUtil = await getWorkspaceManager(context);
        }
        const registry = await workspaceUtil.workspaceUtil.getWorkspaceRegistry();
        for (const workspace of registry.workspaces) {
            if (workspace.workspace_path) {
                provider.addAllowedPath(workspace.workspace_path);
                console.log(`Added registered workspace path: ${workspace.workspace_path}`);
            }
            // Also check URI-based paths
            if (workspace.workspace_uri) {
                const uri = vscode.Uri.parse(workspace.workspace_uri);
                provider.addAllowedPath(uri.fsPath);
                console.log(`Added registered workspace URI path: ${uri.fsPath}`);
            }
        }
    } catch (error) {
        console.warn('Failed to load workspace registry for file system provider scope:', error);
    }
    
    console.log(`File system provider configured with ${provider.getAllowedPaths().length} allowed directories`);
}

/**
 * Get workspace manager (lazy-loaded)
 */
export async function getWorkspaceManager(context: vscode.ExtensionContext): Promise<MuTwoWorkspaceManager> {
    if (!workspaceManager) {
        console.log('Lazy-loading workspace manager...');
        workspaceManager = new MuTwoWorkspaceManager(context);
        stateManager.setComponent('workspaceManager', workspaceManager);
        console.log('Workspace manager loaded successfully');
    }
    return workspaceManager;
}

/**
 * Get or create project manager instance (lazy loading)
 */
export function getProjectManager(context: vscode.ExtensionContext): ProjectManager {
    if (!projectManager) {
        console.log('Lazy-loading project manager...');
        const outputChannel = vscode.window.createOutputChannel('Mu Two Projects');
        projectManager = new ProjectManager(context, outputChannel);
        stateManager.setComponent('projectManager', projectManager);
        console.log('Project manager loaded successfully');
    }
    return projectManager;
}

/**
 * Get or create save-twice handler instance (lazy loading)
 */
export function getSaveTwiceHandler(context: vscode.ExtensionContext): FileSaveTwiceHandler {
    if (!saveTwiceHandler) {
        console.log('Lazy-loading save-twice handler...');
        const pm = getProjectManager(context);
        saveTwiceHandler = new FileSaveTwiceHandler(context, pm, boardManager);
        stateManager.setComponent('saveTwiceHandler', saveTwiceHandler);
        console.log('Save-twice handler loaded successfully');
    }
    return saveTwiceHandler;
}

/**
 * Create required directories (non-blocking)
 */
async function createDirectories(context: vscode.ExtensionContext): Promise<void> {
    const directories = [
        vscode.Uri.joinPath(context.globalStorageUri, '.mu2'),
        vscode.Uri.joinPath(context.globalStorageUri, 'settings'),
        vscode.Uri.joinPath(context.globalStorageUri, 'config')
    ];
    
    await Promise.all(
        directories.map(dir => 
            vscode.workspace.fs.createDirectory(dir).then(
                () => {},
                () => {} // Ignore errors
            )
        )
    );
}

/**
 * Clean deactivation
 */
export function deactivate(): void {
    console.log('Mu 2 Extension: Deactivating...');
    
    // State manager handles all component disposal
    if (stateManager) {
        stateManager.dispose();
    }
    
    console.log('Mu 2 Extension: Deactivated');
}

// Command implementations using BoardManager as primary system
async function listBoardsCommand(): Promise<void> {
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
                await connectBoardCommand(selected.board.id);
                break;
            case 'Disconnect':
                await disconnectBoardCommand(selected.board.id);
                break;
            case 'Execute Code':
                await executeCodeCommand();
                break;
            case 'View Files':
                await viewBoardFilesCommand(selected.board);
                break;
        }
    }
}

async function refreshBoardsCommand(): Promise<void> {
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

async function connectBoardCommand(boardId?: string): Promise<void> {
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

async function disconnectBoardCommand(boardId?: string): Promise<void> {
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

async function executeCodeCommand(code?: string): Promise<void> {
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

async function uploadCurrentFileCommand(): Promise<void> {
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
            // Implementation would depend on board.uploadFile method
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
    
    // Implementation would depend on file system integration
    vscode.window.showInformationMessage('Board file browser feature coming soon');
}

// Project Management Commands
async function loadProjectCommand(context: vscode.ExtensionContext): Promise<void> {
    try {
        const wm = await getWorkspaceManager(context);
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

/**
 * Command to setup or retry Python environment setup
 */
async function setupPythonEnvironmentCommand(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Check if already in progress
        if (stateManager.tryGetComponent('pythonEnvManager')) {
            vscode.window.showInformationMessage('Python environment setup is already in progress or completed.');
            return;
        }

        vscode.window.showInformationMessage('Setting up Mu 2 Python environment...');
        
        // TODO: Implement proper Python environment retry logic
        // For now, just try to re-initialize the Python environment manager
        const newPythonEnvManager = new PythonEnvManager(context);
        await newPythonEnvManager.initialize();
        
        // Mark venv as successfully activated
        const venvPath = newPythonEnvManager.getCurrentPythonPath();
        if (venvPath) {
            stateManager.setPythonVenvActivated(venvPath);
            stateManager.setComponent('pythonEnvManager', newPythonEnvManager);
            pythonEnvManager = newPythonEnvManager; // Update global reference
            
            vscode.window.showInformationMessage('Mu 2 Python environment setup completed successfully!');
        } else {
            throw new Error('Python environment manager initialized but no valid Python path available');
        }
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        stateManager.setPythonVenvFailed(errorMessage);
        
        vscode.window.showErrorMessage(
            `Failed to setup Python environment: ${errorMessage}`,
            'Show Logs'
        ).then(selection => {
            if (selection === 'Show Logs') {
                // TODO: Show detailed logs or output channel
                vscode.commands.executeCommand('workbench.action.toggleDevTools');
            }
        });
    }
}


/* 
	TODO: This file is still nearly 1000 lines long, which seems excessive (but I'm no 
	expert). I've been thinking about including under the '/src/sys/' directory a few 
	different files to help break this up into smaller, more manageable pieces.
	In particular, there are three filenames in mind which may not turn out to be distinct
	in the end, but which I think would help break this up:
	- componentManager.ts
	- operationsManager.ts
	- contextManager.ts
	
	Other potential candidates for future consideration:
	- commandManager.ts
	- serviceManager.ts
	- taskManager.ts
	- activationManager.ts (if too complex to include in extension.ts as a whole,
			or to spread between the initial three suggested files above)
	
	These would help break up the code into smaller, more manageable pieces, and would
	provide a clearer separation of concerns. For example, componentManager.ts could handle
	all component registration and management, while operationsManager.ts could handle
	operations related to extension-wide setup and maintenance. For example, the operations
	manager could oversee the running of (potential) post-/installation scripts such as 
	those needed to set up the Python venv, those to install essential CircuitPython packages,
	stubs, our board database, retrieving learning guides, etc., and those to update these 
	items as needed.
	
	However, I think we should wait until the extension is more stable before making these
	changes, as they may introduce additional complexity at this stage.
 */
// === BENEFITS OF THIS APPROACH ===

/*
1. **Predictable Activation**: Same steps every time, no conditional logic
2. **Fast Startup**: Only essential services loaded immediately  
3. **Error Resilient**: Individual service failures don't break activation
4. **Lazy Loading**: Heavy services loaded only when needed
5. **Simple Dependencies**: No complex dependency injection
6. **Easy Testing**: Each step can be tested independently
7. **Clear Separation**: Core vs optional services clearly defined

Activation Flow:
├── Core Infrastructure (always succeeds)
├── Essential Services (debug + LSP, always succeeds)  
├── UI Components (always succeeds)
├── Commands (always succeeds)
└── Lazy Loading Setup (always succeeds)

On-Demand Loading:
├── Python Environment (when editor features used)
├── File System Provider (when device file ops needed)
└── Workspace Manager (when workspace commands used)

This eliminates the 300+ line performFullActivation() function and makes
the extension much more reliable and maintainable.
*/