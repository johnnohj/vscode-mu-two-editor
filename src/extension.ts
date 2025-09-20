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
import { MuDeviceDetector, IDevice } from './devices/core/deviceDetector';
import { ExtensionStateManager } from './sys/extensionStateManager';
import { registerService } from './sys/serviceRegistry';
import { PythonEnvManager } from './sys/pythonEnvManager';
// TODO: Perhaps we can perform a quick 'isVisible' check on the replView panel to see if 
// we need to initialize the Provider right away, or if we can wait. -john
import { ReplViewProvider } from './providers/replViewProvider';

// Core services - always loaded
import { BoardManager, IBoard } from './sys/boardManager';
import { CtpyFileSystemProvider } from './sys/fileSystemProvider';
import { DeviceManager } from './devices/core/deviceManager';
import { MuTwoLanguageClient } from './devices/core/client';
import { MuTwoWorkspaceManager } from './workspace/workspaceManager';

// On-demand services - loaded when needed
import { EditorPanelProvider } from './providers/editorPanelProvider';
import { EditorReplPanelProvider } from './providers/webviewPanelProvider';
import { MuTwoWorkspace } from './workspace/workspace';
import { ProjectManager } from './workspace/projectManager';
import { FileSaveTwiceHandler } from './workspace/filesystem/saveTwiceHandler';

/* 
	TODO: These 'export let' statements were useful initially, but we must have a cleaner way of
	accomplishing the intended purpose by now, which was to prevent annoying eslint/TS typing/etc. 
	errors. -john 
*/
	
// Global state
let stateManager: ExtensionStateManager;
let boardManager: BoardManager;
let statusBarItem: vscode.StatusBarItem;

// Core services (always available)
export let deviceManager: DeviceManager;
export let languageClient: MuTwoLanguageClient;
export let webviewViewProvider: ReplViewProvider;
export let editorPanelProvider: EditorPanelProvider;
export let webviewPanelProvider: EditorReplPanelProvider;
export let deviceDetector: MuDeviceDetector;

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
        // Step 1: Initialize core infrastructure
        initializeCore(context);
        
        // Step 2: Initialize essential services
        await initializeEssentialServices(context);
        
        // Step 3: Register UI components
        registerUIComponents(context);
        
        // Step 4: Register commands
        registerCommands(context);
        
        // Step 5: Initialize BoardManager as primary device system
        await initializeBoardManager(context);
        
        // Step 6: Set up lazy loading for optional services
        setupLazyLoading(context);

        // Step 7: Set context variables for custom editor activation
        await vscode.commands.executeCommand('setContext', 'extension.muTwo.isActive', true);
        await vscode.commands.executeCommand('setContext', 'muTwo.Workspace.isOpen', true);
        await vscode.commands.executeCommand('setContext', 'muTwo.fullyActivated', true);

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
    
    // Initialize device manager with error handling
    try {
        deviceManager = new DeviceManager(context);
        stateManager.setComponent('deviceManager', deviceManager);
        registerService('deviceManager', deviceManager);
        console.log('Device manager initialized successfully');
    } catch (error) {
        console.error('Failed to initialize device manager:', error);
        // Continue with null device manager - providers will handle gracefully
        deviceManager = null as any;
    }

    // Initialize LSP client with error handling
    try {
        languageClient = new MuTwoLanguageClient(context);
        stateManager.setComponent('languageClient', languageClient);
        registerService('languageClient', languageClient);
        console.log('Language client initialized successfully');
    } catch (error) {
        console.error('Failed to initialize language client:', error);
        // Continue with null language client - providers will handle gracefully
        languageClient = null as any;
    }

    // Initialize device detector with error handling
    try {
        deviceDetector = new MuDeviceDetector();
        stateManager.setComponent('deviceDetector', deviceDetector);
        console.log('Device detector initialized successfully');
    } catch (error) {
        console.error('Failed to initialize device detector:', error);
        // Continue with null device detector - board manager will handle gracefully
        deviceDetector = null as any;
    }
    
    // Start LSP in background - don't wait or fail on errors
    if (languageClient) {
        languageClient.start().then(() => {
            console.log('Language server started successfully');
        }).catch(error => {
            console.log('Language server startup failed (continuing without LSP):', error);
        });
    }
    
    console.log('Essential services initialized');
}

/**
 * Initialize BoardManager as the primary device management system
 */
async function initializeBoardManager(context: vscode.ExtensionContext): Promise<void> {
    console.log('Initializing BoardManager as primary device system...');
    
    try {
        // Check if required dependencies are available
        if (!deviceManager || !languageClient || !deviceDetector) {
            console.warn('Some required services for BoardManager not available, skipping BoardManager initialization');
            return;
        }

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
        // Don't throw - continue with limited functionality
        boardManager = null as any;
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
    if (!statusBarItem) {
        // Create persistent status bar item for device connection status
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = 'muTwo.boards.list';
        statusBarItem.tooltip = 'Click to view CircuitPython boards';
        statusBarItem.show();
    }

    const connectedBoards = boardManager.getConnectedBoards();
    const totalBoards = boardManager.getAllBoards();

    if (totalBoards.length === 0) {
        statusBarItem.text = `$(plug) No CircuitPython boards`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (connectedBoards.length === 0) {
        statusBarItem.text = `$(circle-outline) ${totalBoards.length} board(s) available`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(check-all) ${connectedBoards.length}/${totalBoards.length} connected`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    }
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

    // EditorPanelProvider now handles simple split functionality
    console.log('Editor panel provider created for split view functionality');

    // Create webview panel provider for connected REPLs
    webviewPanelProvider = new EditorReplPanelProvider(context);
    stateManager.setComponent('webviewPanelProvider', webviewPanelProvider);
    console.log('Webview panel provider created for connected REPL functionality');

    // Register CircuitPython language features for standard Python editors
    registerCircuitPythonLanguageFeatures(context);
    
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
        vscode.commands.registerCommand('muTwo.editor.showPanel', async () => {
            const activeEditor = vscode.window.activeTextEditor;

            if (activeEditor && activeEditor.document.languageId === 'python' && webviewPanelProvider) {
                // Show existing panel or create new one for Python files
                await webviewPanelProvider.createOrShowPanel(activeEditor);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.hidePanel', () => {
            const activeEditor = vscode.window.activeTextEditor;

            if (activeEditor && activeEditor.document.languageId === 'python' && webviewPanelProvider) {
                // Hide panel for Python files
                webviewPanelProvider.hidePanel(activeEditor);
            }
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

    // Editor commands - now opens standard text editor with workspace-aware REPL panel
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.editor.openEditor', async (uri?: vscode.Uri) => {
            console.log('muTwo.editor.openEditor command called with URI:', uri?.toString());

            let document: vscode.TextDocument;

            if (uri) {
                // Open the specified file in standard text editor
                document = await vscode.workspace.openTextDocument(uri);
            } else {
                // Check if there's an active Python editor
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor && activeEditor.document.languageId === 'python') {
                    document = activeEditor.document;
                } else {
                    // Create a new Python file
                    document = await vscode.workspace.openTextDocument({
                        language: 'python',
                        content: '# CircuitPython code\nimport time\n\nwhile True:\n    print("Hello, CircuitPython!")\n    time.sleep(1)\n'
                    });
                }
            }

            // Show the document in standard text editor
            const textEditor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One);

            // Split the editor vertically for workspace view
            await editorPanelProvider.createOrShowPanel();

            console.log('Opened Python file in standard editor with vertical split');
        })
    );


    // Test command for webview panel positioning
    context.subscriptions.push(
        vscode.commands.registerCommand('muTwo.debug.testWebviewPanel', async () => {
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

            console.log(`=== Testing: ${selected} ===`);

            try {
                let panel: vscode.WebviewPanel;

                switch (selected) {
                    case 'Pure Split Editor Down (No Panel)':
                        await testPureSplitDown();
                        return; // No panel created
                    case 'Split + Create Webview in Split':
                        panel = await testSplitAndCreateInSplit(context);
                        break;
                    case 'Create Panel Only (No Split Commands)':
                        panel = await testCreatePanelOnly(context);
                        break;
                    case 'Create Panel + Split After':
                        panel = await testCreatePanelThenSplit(context);
                        break;
                    case 'Split After Panel Creation':
                        panel = await testSplitAfterPanelCreation(context);
                        break;
                    case 'Basic Below Split':
                        panel = await testBasicBelowSplit(context);
                        break;
                    case 'ViewColumn.Beside':
                        panel = await testViewColumnBeside(context);
                        break;
                    case 'Split Editor Down Command':
                        panel = await testSplitEditorDown(context);
                        break;
                    case 'Move to Below Group Command':
                        panel = await testMoveToBelow(context);
                        break;
                    case 'ViewColumn.Two':
                        panel = await testViewColumnTwo(context);
                        break;
                    default:
                        throw new Error('Unknown test option');
                }

                vscode.window.showInformationMessage(`${selected} test completed`);
            } catch (error) {
                console.error(`Test failed:`, error);
                vscode.window.showErrorMessage(`${selected} test failed: ${error}`);
            }
        })
    );

    console.log('Commands registered');
}

/**
 * Register CircuitPython language features for standard Python editors
 */
function registerCircuitPythonLanguageFeatures(context: vscode.ExtensionContext): void {
    console.log('Registering CircuitPython language features for Python files...');

    const pythonSelector: vscode.DocumentSelector = { language: 'python' };

    // Get existing services for integration
    const languageServiceBridge = editorPanelProvider.getLanguageServiceBridge();
    const moduleRegistry = getModuleRegistry();
    const boardDatabase = getBoardDatabase();

    // 1. Completion Provider - CircuitPython-specific autocomplete
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        pythonSelector,
        new CircuitPythonCompletionProvider(languageServiceBridge, moduleRegistry, boardDatabase),
        '.', // Trigger on dot
        ' '  // Trigger on space
    );
    context.subscriptions.push(completionProvider);

    // 2. Hover Provider - Show CircuitPython-specific documentation
    const hoverProvider = vscode.languages.registerHoverProvider(
        pythonSelector,
        new CircuitPythonHoverProvider(languageServiceBridge, moduleRegistry)
    );
    context.subscriptions.push(hoverProvider);

    // 3. Signature Help Provider - Function parameter hints
    const signatureProvider = vscode.languages.registerSignatureHelpProvider(
        pythonSelector,
        new CircuitPythonSignatureProvider(languageServiceBridge),
        '(', ','
    );
    context.subscriptions.push(signatureProvider);

    // 4. Definition Provider - Go to definition for CircuitPython modules
    const definitionProvider = vscode.languages.registerDefinitionProvider(
        pythonSelector,
        new CircuitPythonDefinitionProvider(moduleRegistry)
    );
    context.subscriptions.push(definitionProvider);

    // 5. Diagnostic Provider - CircuitPython-specific linting
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('circuitpython');
    context.subscriptions.push(diagnosticCollection);

    // Update diagnostics when documents change
    const diagnosticProvider = new CircuitPythonDiagnosticProvider(diagnosticCollection, moduleRegistry, boardDatabase);
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'python') {
                diagnosticProvider.updateDiagnostics(e.document);
            }
        })
    );

    // Update diagnostics when documents are opened
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === 'python') {
                diagnosticProvider.updateDiagnostics(document);
            }
        })
    );

    console.log('CircuitPython language features registered successfully');
}

/**
 * Get the ModuleRegistry instance
 */
function getModuleRegistry(): any {
    try {
        const { moduleRegistry } = require('./providers/language/core/ModuleRegistry');
        return moduleRegistry;
    } catch (error) {
        console.warn('ModuleRegistry not available:', error);
        return null;
    }
}

/**
 * Get the Board database
 */
function getBoardDatabase(): any {
    try {
        // Access board database through the ModuleRegistry adapter
        const { moduleRegistry } = require('./providers/language/core/ModuleRegistry');
        return moduleRegistry; // ModuleRegistry includes board data
    } catch (error) {
        console.warn('Board database not available:', error);
        return null;
    }
}

// Language Feature Provider Classes
class CircuitPythonCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private languageServiceBridge: any,
        private moduleRegistry: any,
        private boardDatabase: any
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        try {
            // Get dynamic modules from ModuleRegistry
            if (this.moduleRegistry) {
                const availableModules = this.moduleRegistry.getAvailableModules();
                availableModules.forEach((module: any) => {
                    const item = new vscode.CompletionItem(module.name, vscode.CompletionItemKind.Module);
                    item.detail = `CircuitPython module: ${module.name}`;
                    item.documentation = new vscode.MarkdownString(module.description || `Import the \`${module.name}\` CircuitPython module`);
                    if (module.version) {
                        item.detail += ` (v${module.version})`;
                    }
                    items.push(item);
                });
            }

            // Get board-specific completions from board database
            if (this.boardDatabase && document.getText().includes('import board')) {
                const currentBoard = this.getCurrentBoard();
                if (currentBoard) {
                    const boardPins = this.getBoardPins(currentBoard);
                    boardPins.forEach((pin: any) => {
                        const item = new vscode.CompletionItem(`board.${pin.name}`, vscode.CompletionItemKind.Property);
                        item.detail = `Board pin: ${pin.name}`;
                        item.documentation = new vscode.MarkdownString(
                            `Access pin \`${pin.name}\` on the ${currentBoard.name} board\n\n` +
                            `**Type:** ${pin.type}\n` +
                            `**Capabilities:** ${pin.capabilities?.join(', ') || 'Digital I/O'}`
                        );
                        items.push(item);
                    });
                }
            }

            // Use LanguageServiceBridge for context-aware completions
            if (this.languageServiceBridge) {
                const line = document.lineAt(position).text;
                const currentWord = document.getText(document.getWordRangeAtPosition(position));

                const bridgeCompletions = await this.languageServiceBridge.getLanguageService().getCompletions(
                    document.getText(),
                    { line: position.line, character: position.character }
                );

                if (bridgeCompletions) {
                    bridgeCompletions.forEach((completion: any) => {
                        const item = new vscode.CompletionItem(completion.label, this.mapCompletionKind(completion.kind));
                        item.detail = completion.detail;
                        item.documentation = completion.documentation;
                        item.insertText = completion.insertText;
                        items.push(item);
                    });
                }
            }

        } catch (error) {
            console.error('Error in CircuitPython completion provider:', error);
        }

        return items;
    }

    private getCurrentBoard(): any {
        if (this.boardDatabase && this.boardDatabase.getConnectedBoards) {
            const connected = this.boardDatabase.getConnectedBoards();
            return connected.length > 0 ? connected[0] : null;
        }
        return null;
    }

    private getBoardPins(board: any): any[] {
        // Extract pins from board definition
        if (board.pins) {
            return board.pins;
        }

        // Fallback to common pins if board doesn't have specific pin definitions
        return [
            { name: 'LED', type: 'digital', capabilities: ['output'] },
            { name: 'A0', type: 'analog', capabilities: ['input', 'output'] },
            { name: 'A1', type: 'analog', capabilities: ['input', 'output'] },
            { name: 'D0', type: 'digital', capabilities: ['input', 'output'] },
            { name: 'D1', type: 'digital', capabilities: ['input', 'output'] },
            { name: 'SDA', type: 'i2c', capabilities: ['i2c'] },
            { name: 'SCL', type: 'i2c', capabilities: ['i2c'] }
        ];
    }

    private mapCompletionKind(kind: string): vscode.CompletionItemKind {
        switch (kind) {
            case 'module': return vscode.CompletionItemKind.Module;
            case 'class': return vscode.CompletionItemKind.Class;
            case 'function': return vscode.CompletionItemKind.Function;
            case 'variable': return vscode.CompletionItemKind.Variable;
            case 'property': return vscode.CompletionItemKind.Property;
            default: return vscode.CompletionItemKind.Text;
        }
    }
}

class CircuitPythonHoverProvider implements vscode.HoverProvider {
    constructor(
        private languageServiceBridge: any,
        private moduleRegistry: any
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return undefined;

        const word = document.getText(range);

        try {
            // First try to get hover info from LanguageServiceBridge
            if (this.languageServiceBridge) {
                const hoverInfo = await this.languageServiceBridge.getLanguageService().getHover(
                    document.getText(),
                    { line: position.line, character: position.character }
                );

                if (hoverInfo) {
                    const markdownString = new vscode.MarkdownString();
                    if (hoverInfo.signature) {
                        markdownString.appendCodeblock(hoverInfo.signature, 'python');
                    }
                    if (hoverInfo.documentation) {
                        markdownString.appendMarkdown(hoverInfo.documentation);
                    }
                    return new vscode.Hover(markdownString, range);
                }
            }

            // Fallback to ModuleRegistry for module information
            if (this.moduleRegistry) {
                const moduleInfo = this.moduleRegistry.getModuleInfo(word);
                if (moduleInfo) {
                    const markdownString = new vscode.MarkdownString();
                    markdownString.appendCodeblock(`# ${word}`, 'python');
                    markdownString.appendMarkdown(moduleInfo.description || `CircuitPython module: ${word}`);

                    if (moduleInfo.version) {
                        markdownString.appendMarkdown(`\n\n**Version:** ${moduleInfo.version}`);
                    }

                    if (moduleInfo.url) {
                        markdownString.appendMarkdown(`\n\n[Documentation](${moduleInfo.url})`);
                    }

                    return new vscode.Hover(markdownString, range);
                }
            }

            // Final fallback to static CircuitPython info
            const circuitPythonInfo: { [key: string]: string } = {
                'board': 'CircuitPython board module - provides access to board pins and hardware',
                'digitalio': 'CircuitPython digital I/O module - control digital pins',
                'analogio': 'CircuitPython analog I/O module - read analog sensors and control analog outputs',
                'LED': 'Built-in LED pin on the CircuitPython board',
                'neopixel': 'CircuitPython NeoPixel module - control addressable RGB LEDs',
                'busio': 'CircuitPython bus I/O module - I2C, SPI, and UART communication',
                'microcontroller': 'CircuitPython microcontroller module - low-level hardware access'
            };

            if (circuitPythonInfo[word]) {
                const markdownString = new vscode.MarkdownString();
                markdownString.appendCodeblock(`# ${word}`, 'python');
                markdownString.appendMarkdown(circuitPythonInfo[word]);
                return new vscode.Hover(markdownString, range);
            }

        } catch (error) {
            console.error('Error in CircuitPython hover provider:', error);
        }

        return undefined;
    }
}

class CircuitPythonSignatureProvider implements vscode.SignatureHelpProvider {
    constructor(private languageServiceBridge: any) {}

    async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): Promise<vscode.SignatureHelp | undefined> {
        try {
            if (this.languageServiceBridge) {
                const signatureInfo = await this.languageServiceBridge.getLanguageService().getSignatureHelp(
                    document.getText(),
                    { line: position.line, character: position.character }
                );

                if (signatureInfo && signatureInfo.signatures) {
                    const signatureHelp = new vscode.SignatureHelp();

                    signatureHelp.signatures = signatureInfo.signatures.map((sig: any) => {
                        const signature = new vscode.SignatureInformation(sig.label, sig.documentation);

                        if (sig.parameters) {
                            signature.parameters = sig.parameters.map((param: any) =>
                                new vscode.ParameterInformation(param.label, param.documentation)
                            );
                        }

                        return signature;
                    });

                    signatureHelp.activeSignature = signatureInfo.activeSignature || 0;
                    signatureHelp.activeParameter = signatureInfo.activeParameter || 0;

                    return signatureHelp;
                }
            }
        } catch (error) {
            console.error('Error in CircuitPython signature provider:', error);
        }

        return undefined;
    }
}

class CircuitPythonDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private moduleRegistry: any) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return undefined;

        const word = document.getText(range);

        try {
            if (this.moduleRegistry) {
                const moduleInfo = this.moduleRegistry.getModuleInfo(word);

                if (moduleInfo) {
                    // If module has a local stub file, go to it
                    if (moduleInfo.stubPath) {
                        const stubUri = vscode.Uri.file(moduleInfo.stubPath);
                        return new vscode.Location(stubUri, new vscode.Position(0, 0));
                    }

                    // If module has online documentation, could open that
                    if (moduleInfo.documentationUrl) {
                        // For now, log the URL - could implement opening in browser
                        console.log(`Documentation for ${word}: ${moduleInfo.documentationUrl}`);
                    }
                }
            }
        } catch (error) {
            console.warn('Error in CircuitPython definition provider:', error);
        }

        return undefined;
    }
}

class CircuitPythonDiagnosticProvider {
    constructor(
        private diagnosticCollection: vscode.DiagnosticCollection,
        private moduleRegistry: any,
        private boardDatabase: any
    ) {}

    updateDiagnostics(document: vscode.TextDocument): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Check for common CircuitPython mistakes
        this.checkCommonMistakes(lines, diagnostics);

        // Check for unavailable modules
        this.checkUnavailableModules(lines, diagnostics);

        // Check for board-specific issues
        this.checkBoardSpecificIssues(lines, diagnostics);

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private checkCommonMistakes(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        const commonMistakes = [
            {
                pattern: /import RPi\.GPIO/,
                message: 'RPi.GPIO is not available in CircuitPython. Use digitalio instead.',
                suggestion: 'import digitalio'
            },
            {
                pattern: /import wiringpi/,
                message: 'wiringpi is not available in CircuitPython. Use digitalio instead.',
                suggestion: 'import digitalio'
            },
            {
                pattern: /import pygame/,
                message: 'pygame is not available on microcontrollers. Consider using displayio for graphics.',
                suggestion: 'import displayio'
            }
        ];

        lines.forEach((line, lineIndex) => {
            commonMistakes.forEach(mistake => {
                if (mistake.pattern.test(line)) {
                    const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        mistake.message,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'CircuitPython';
                    diagnostic.code = 'incompatible-import';
                    diagnostics.push(diagnostic);
                }
            });
        });
    }

    private checkUnavailableModules(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        if (!this.moduleRegistry) return;

        const importPattern = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/;

        lines.forEach((line, lineIndex) => {
            const match = line.match(importPattern);
            if (match) {
                const moduleName = match[1] || match[2];

                if (moduleName && !this.moduleRegistry.isModuleAvailable(moduleName)) {
                    // Check if it's a known CircuitPython module that might need installation
                    const suggestions = this.moduleRegistry.getSimilarModules(moduleName);

                    const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                    let message = `Module '${moduleName}' is not available in the current CircuitPython environment.`;

                    if (suggestions.length > 0) {
                        message += ` Did you mean: ${suggestions.join(', ')}?`;
                    }

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        message,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'CircuitPython';
                    diagnostic.code = 'module-not-found';
                    diagnostics.push(diagnostic);
                }
            }
        });
    }

    private checkBoardSpecificIssues(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        if (!this.boardDatabase) return;

        const currentBoard = this.getCurrentBoard();
        if (!currentBoard) return;

        // Check for board pin usage
        const boardPinPattern = /board\.(\w+)/g;

        lines.forEach((line, lineIndex) => {
            let match;
            while ((match = boardPinPattern.exec(line)) !== null) {
                const pinName = match[1];

                if (!this.isPinAvailableOnBoard(pinName, currentBoard)) {
                    const startPos = match.index;
                    const endPos = startPos + match[0].length;
                    const range = new vscode.Range(lineIndex, startPos, lineIndex, endPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Pin '${pinName}' is not available on ${currentBoard.name}. Available pins: ${this.getAvailablePins(currentBoard).join(', ')}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'CircuitPython';
                    diagnostic.code = 'invalid-pin';
                    diagnostics.push(diagnostic);
                }
            }
        });
    }

    private getCurrentBoard(): any {
        if (this.boardDatabase && this.boardDatabase.getConnectedBoards) {
            const connected = this.boardDatabase.getConnectedBoards();
            return connected.length > 0 ? connected[0] : null;
        }
        return null;
    }

    private isPinAvailableOnBoard(pinName: string, board: any): boolean {
        if (board.pins) {
            return board.pins.some((pin: any) => pin.name === pinName);
        }
        // Fallback - assume common pins are available
        const commonPins = ['LED', 'A0', 'A1', 'A2', 'D0', 'D1', 'D2', 'SDA', 'SCL'];
        return commonPins.includes(pinName);
    }

    private getAvailablePins(board: any): string[] {
        if (board.pins) {
            return board.pins.map((pin: any) => pin.name);
        }
        return ['LED', 'A0', 'A1', 'A2', 'D0', 'D1', 'D2', 'SDA', 'SCL'];
    }
}

// Test functions for webview panel positioning

async function testPureSplitDown(): Promise<void> {
    console.log('Testing pure split editor down (no panels)');

    // Just split the editor to see what happens
    await vscode.commands.executeCommand('workbench.action.splitEditorDown');

    // Let's also try some other split-related commands to see what's available
    console.log('Available after split:');

    // Wait a bit then try to get info about the split
    setTimeout(async () => {
        const activeEditor = vscode.window.activeTextEditor;
        console.log('Active editor after split:', {
            viewColumn: activeEditor?.viewColumn,
            document: activeEditor?.document.fileName,
            visibleRanges: activeEditor?.visibleRanges
        });

        // Try to see if there are multiple visible editors now
        const visibleEditors = vscode.window.visibleTextEditors;
        console.log('Visible editors count:', visibleEditors.length);
        visibleEditors.forEach((editor, i) => {
            console.log(`Editor ${i}:`, {
                column: editor.viewColumn,
                fileName: editor.document.fileName
            });
        });

        // Try some other split-related commands to see what's available
        const splitCommands = [
            'workbench.action.splitEditorRight',
            'workbench.action.splitEditorLeft',
            'workbench.action.splitEditorUp',
            'workbench.action.joinTwoGroups',
            'workbench.action.toggleEditorGroupLayout',
            'workbench.action.editorLayoutTwoColumns',
            'workbench.action.editorLayoutTwoRows',
            'workbench.action.editorLayoutThreeColumns'
        ];

        console.log('Available split commands to test:');
        splitCommands.forEach(cmd => console.log(` - ${cmd}`));
    }, 500);
}

async function testSplitAndCreateInSplit(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    console.log('Testing split then create webview in the split area');

    // First split the editor
    await vscode.commands.executeCommand('workbench.action.splitEditorDown');

    // Wait a moment for the split to take effect
    await new Promise(resolve => setTimeout(resolve, 200));

    // Now create a webview panel - it should go in the active (split) area
    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.splittarget',
        'Test: Split Target',
        vscode.ViewColumn.Active, // Should target the active split
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>Split Target Test</h1><p>Created after splitting - should appear in split area</p>`;

    console.log('Panel created in split area');
    return panel;
}

async function testCreatePanelOnly(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    console.log('Testing: Create panel only, no split commands at all');

    const activeColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.panelonly',
        'Test: Panel Only',
        activeColumn,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>Panel Only Test</h1><p>No split commands executed - should just create panel</p>`;

    console.log('Panel created without any split commands');
    return panel;
}

async function testCreatePanelThenSplit(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    console.log('Testing: Create panel first, then split after panel exists');

    const activeColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    // Create panel first
    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.panelfirst',
        'Test: Panel Then Split',
        activeColumn,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>Panel Then Split Test</h1><p>Panel created first, split command will run after</p>`;

    // Wait a moment, then split
    setTimeout(async () => {
        console.log('Running split command after panel creation...');
        try {
            await vscode.commands.executeCommand('workbench.action.splitEditorDown');
            console.log('Split command executed after panel creation');
        } catch (e) {
            console.log('Split after panel creation failed:', e);
        }
    }, 300);

    return panel;
}

async function testSplitAfterPanelCreation(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    console.log('Testing: Create panel, wait, then split specifically');

    const activeColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.splitafter',
        'Test: Split After Creation',
        activeColumn,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>Split After Creation Test</h1><p>Panel created, about to split...</p>`;

    // Wait longer, then split
    setTimeout(async () => {
        console.log('About to split after panel is fully created...');
        try {
            await vscode.commands.executeCommand('workbench.action.splitEditorDown');
            console.log('Split executed successfully after panel creation');
        } catch (e) {
            console.log('Split after panel failed:', e);
        }
    }, 1000);

    return panel;
}

async function testBasicBelowSplit(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    const activeColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.basic',
        'Test: Basic Below',
        activeColumn,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>Basic Below Split Test</h1><p>Created in same column as active editor</p>`;

    // Try to split down after creation
    setTimeout(async () => {
        try {
            await vscode.commands.executeCommand('workbench.action.splitEditorDown');
        } catch (e) {
            console.log('splitEditorDown failed:', e);
        }
    }, 100);

    return panel;
}

async function testViewColumnBeside(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.beside',
        'Test: ViewColumn.Beside',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>ViewColumn.Beside Test</h1><p>Should open beside active editor</p>`;
    return panel;
}

async function testSplitEditorDown(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    // First split the editor down
    await vscode.commands.executeCommand('workbench.action.splitEditorDown');

    // Then create panel in the new split
    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.splitdown',
        'Test: Split Down First',
        vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>Split Editor Down Test</h1><p>Split first, then create panel</p>`;
    return panel;
}

async function testMoveToBelow(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    const activeColumn = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.movebelow',
        'Test: Move to Below',
        activeColumn,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>Move to Below Test</h1><p>Create then move below</p>`;

    // Try to move to below group
    setTimeout(async () => {
        try {
            await vscode.commands.executeCommand('workbench.action.moveEditorToBelowGroup');
        } catch (e) {
            console.log('moveEditorToBelowGroup failed:', e);
        }
    }, 100);

    return panel;
}

async function testViewColumnTwo(context: vscode.ExtensionContext): Promise<vscode.WebviewPanel> {
    const panel = vscode.window.createWebviewPanel(
        'muTwo.test.columntwo',
        'Test: ViewColumn.Two',
        vscode.ViewColumn.Two,
        { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = `<h1>ViewColumn.Two Test</h1><p>Should open in second column</p>`;
    return panel;
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
        for (const workspace of Object.values(registry.workspaces)) {
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
 * Get existing EditorPanelProvider instance (created during UI component registration)
 */
export async function getEditorPanelProvider(context: vscode.ExtensionContext): Promise<EditorPanelProvider> {
    if (!editorPanelProvider) {
        throw new Error('EditorPanelProvider not initialized. This should be created during UI component registration.');
    }
    return editorPanelProvider;
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

    // Dispose of status bar item
    if (statusBarItem) {
        statusBarItem.dispose();
    }

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