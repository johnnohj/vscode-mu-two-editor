import * as vscode from "vscode";
import { IDevice } from "../devices/core/deviceDetector";
import { MuTwoWorkspace, WorkspaceConfig, BoardAssociation, PendingDownload, WorkspaceRegistry, WorkspaceRegistryEntry, WorkspaceFiles } from "./workspace";
import { LearnGuideProvider } from "./integration/learnGuideProvider";
import { getLogger } from '../utils/unifiedLogger';

export interface WorkspaceCreationOptions {
    device?: IDevice;
    workspaceName?: string;
    workspaceLocation?: string;
    forceNew?: boolean;
}

export class MuTwoWorkspaceManager implements vscode.Disposable {
    private _workspaceUtil: MuTwoWorkspace;
    private _learnGuideProvider: LearnGuideProvider;
    private _logger = getLogger();

    constructor(context: vscode.ExtensionContext) {
        this._workspaceUtil = MuTwoWorkspace.getInstance(context);
        this._learnGuideProvider = new LearnGuideProvider();
        // Using unified logger instead of createOutputChannel('Mu 2 Workspace Manager')

        // Initialize development mode handling
        this.initializeDevelopmentMode();
    }

    /**
     * Main workspace creation flow based on board detection
     */
    public async createWorkspaceFlow(options: WorkspaceCreationOptions = {}): Promise<boolean> {
        try {
            // Handle board-specific workspace creation
            if (options.device) {
                return await this.handleBoardDetectedFlow(options.device, options.forceNew);
            }

            // Handle manual workspace creation (no board detected)
            return await this.handleManualWorkspaceCreation(options);
        } catch (error) {
            this._logger.error('WORKSPACE', `Workspace creation error: ${error}`);
            vscode.window.showErrorMessage(`Failed to create workspace: ${error}`);
            return false;
        }
    }

    /**
     * Handle workspace creation when a board is detected
     */
    private async handleBoardDetectedFlow(device: IDevice, forceNew: boolean = false): Promise<boolean> {
        const existingWorkspace = await this._workspaceUtil.findWorkspaceForBoard(device);

        if (existingWorkspace && !forceNew) {
            // Board already has workspace - prompt user
            const choice = await vscode.window.showInformationMessage(
                `A board named '${device.displayName}' is already associated with a Mu 2 workspace. Would you like to open that workspace now?`,
                'Open Existing',
                'Create New Anyway',
                'Cancel'
            );

            switch (choice) {
                case 'Open Existing':
                    return await this.openExistingWorkspace(existingWorkspace.workspace_path);
                case 'Create New Anyway':
                    break; // Continue with creation
                case 'Cancel':
                default:
                    return false;
            }
        }

        return await this.createNewWorkspace({
            device,
            workspaceName: device.displayName
        });
    }

    /**
     * Handle manual workspace creation (no board detected)
     */
    private async handleManualWorkspaceCreation(options: WorkspaceCreationOptions): Promise<boolean> {
        const choice = await vscode.window.showInformationMessage(
            'Mu 2 does not detect any boards connected currently. Would you still like to create a workspace?',
            'Create Virtual Workspace',
            'Wait for Board',
            'Cancel'
        );

        switch (choice) {
            case 'Create Virtual Workspace':
                return await this.createNewWorkspace(options);
            case 'Wait for Board':
                vscode.window.showInformationMessage('Please connect a CircuitPython board and try again.');
                return false;
            case 'Cancel':
            default:
                return false;
        }
    }

    /**
     * Create a new workspace with proper file structure
     */
    private async createNewWorkspace(options: WorkspaceCreationOptions): Promise<boolean> {
        // Get workspace location with proper URI fallback configuration
        const workspaceLocation = options.workspaceLocation || await this.getWorkspaceLocation();
        if (!workspaceLocation) {
            return false;
        }

        // Generate workspace ID and name
        const workspaceId = await this._workspaceUtil.generateWorkspaceId();

        // In development mode, prefer 'mu2-test' as the workspace name for virtual workspaces
        let workspaceName: string;
        if (this._workspaceUtil.isDevelopmentMode() && !options.device && !options.workspaceName) {
            workspaceName = 'mu2-test';
            this._logger.info('WORKSPACE', 'Development mode: Using "mu2-test" as virtual workspace name');
        } else {
            workspaceName = options.workspaceName || options.device?.displayName || 'CircuitPython Project';
        }

        const safeName = this.sanitizeWorkspaceName(workspaceName);

        // Create workspace directory
        const workspaceUri = vscode.Uri.joinPath(vscode.Uri.file(workspaceLocation), safeName);

        try {
            await vscode.workspace.fs.createDirectory(workspaceUri);
            this._logger.info('WORKSPACE', `Created workspace directory: ${workspaceUri}`);

            // Create file structure
            await this.createWorkspaceFileStructure(workspaceUri, workspaceId, workspaceName, options.device);

            // Register workspace using URI object for improved cross-platform support
            const vidPid = options.device ? `${options.device.vendorId}:${options.device.productId}` : undefined;
            await this._workspaceUtil.registerWorkspace(workspaceId, workspaceUri, workspaceName, vidPid);

            // Open the new workspace
            // In development mode, reuse current window to avoid opening new VS Code instances
            const reuseWindow = this.shouldReuseWindow();
            await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, !reuseWindow);

            if (reuseWindow) {
                this._logger.info('WORKSPACE', 'Development mode: Reusing current window for workspace');
            }

            this._logger.info('WORKSPACE', `Workspace created and opened: ${workspaceUri}`);
            return true;

        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to create workspace structure: ${error}`);
            throw error;
        }
    }

    /**
     * Create the complete file structure for a new workspace
     */
    private async createWorkspaceFileStructure(
        workspaceUri: vscode.Uri,
        workspaceId: string,
        workspaceName: string,
        device?: IDevice
    ): Promise<void> {
        // Create .vscode/mu2 directory
        const mu2Dir = vscode.Uri.joinPath(workspaceUri, '.vscode', 'mu2');
        await vscode.workspace.fs.createDirectory(mu2Dir);

        // Create workspace-config.json
        const workspaceConfig: WorkspaceConfig = {
            workspace_id: workspaceId,
            created_date: new Date().toISOString(),
            workspace_name: workspaceName,
            pending_downloads: device ? this.createPendingDownloads(device) : []
        };

        const configPath = vscode.Uri.joinPath(mu2Dir, 'workspace-config.json');
        await vscode.workspace.fs.writeFile(
            configPath,
            new TextEncoder().encode(JSON.stringify(workspaceConfig, null, 2))
        );

        // Create board-association.json if device provided
        if (device) {
            const boardAssociation: BoardAssociation = {
                board_name: device.displayName,
                vid: device.vendorId || '',
                pid: device.productId || '',
                serial_number: device.path,
                last_connected: new Date().toISOString(),
                connection_count: 1,
                learn_guide_url: this.getLearnGuideUrl(device)
            };

            const associationPath = vscode.Uri.joinPath(mu2Dir, 'board-association.json');
            await vscode.workspace.fs.writeFile(
                associationPath,
                new TextEncoder().encode(JSON.stringify(boardAssociation, null, 2))
            );
        }

        // Create downloads directory
        const downloadsDir = vscode.Uri.joinPath(mu2Dir, 'downloads');
        await vscode.workspace.fs.createDirectory(downloadsDir);

        // Download learn guide if available
        if (device) {
            await this._learnGuideProvider.downloadLearnGuide(device, downloadsDir);
        }

        // Create main code.py file
        const codePyPath = vscode.Uri.joinPath(workspaceUri, 'code.py');
        const initialCode = this.getInitialCodeContent();
        await vscode.workspace.fs.writeFile(
            codePyPath,
            new TextEncoder().encode(initialCode)
        );

        // Create README.md
        const readmePath = vscode.Uri.joinPath(workspaceUri, 'README.md');
        const readmeContent = this.generateReadmeContent(workspaceName, device);
        await vscode.workspace.fs.writeFile(
            readmePath,
            new TextEncoder().encode(readmeContent)
        );

        this._logger.info('WORKSPACE', `Created workspace file structure in ${workspaceUri.fsPath}`);
    }

    /**
     * Generate README content for new workspace
     */
    private generateReadmeContent(workspaceName: string, device?: IDevice): string {
        const boardSection = device ? `
## Your Board
- **Name:** ${device.displayName}
- **Status:** ${device ? 'Connected' : 'Disconnected'}
- **Learn Guide:** ${this.getLearnGuideUrl(device) || 'Not available'}
` : `
## Your Board
- **Status:** No board currently associated
- Connect a CircuitPython board to associate it with this workspace
`;

        return `# Welcome to Your ${workspaceName} Workspace

Welcome to Mu 2! ${device ? 'Your board has been detected and this workspace is ready for development.' : 'This workspace is ready for project development.'}
${boardSection}
## Quick Start
1. Type \`.connect\` in the main REPL to connect to your board
2. Edit \`code.py\` above and save to automatically sync to your board
3. Use the editor terminal below for quick testing and variable inspection

## Resources
- CircuitPython documentation: https://docs.circuitpython.org/
- Mu 2 help: Type \`.help\` in the main REPL

Happy coding! 🐍⚡
`;
    }

    /**
     * Get initial code.py content
     */
    private getInitialCodeContent(): string {
        return `# Welcome to CircuitPython!
# This is your main code file. Write your CircuitPython code here.

import time
import board
import digitalio

# Built-in LED setup (if available)
try:
    led = digitalio.DigitalInOut(board.LED)
    led.direction = digitalio.Direction.OUTPUT
    led_available = True
except AttributeError:
    led_available = False
    print("No built-in LED found on this board")

print("Hello, CircuitPython!")
print("Mu 2 workspace ready for development")

# Main loop
while True:
    if led_available:
        led.value = True
        time.sleep(0.5)
        led.value = False
        time.sleep(0.5)
    else:
        print("CircuitPython is running!")
        time.sleep(1)
`;
    }

    /**
     * Create pending downloads for a device
     */
    private createPendingDownloads(device: IDevice): PendingDownload[] {
        const downloads: PendingDownload[] = [];
        const guideInfo = this._learnGuideProvider.getLearnGuideInfo(device as any);

        if (guideInfo?.guide_pdf_url) {
            downloads.push({
                type: 'learn_guide',
                url: guideInfo.guide_pdf_url,
                filename: 'board-guide.pdf',
                priority: 'high'
            });
        }

        return downloads;
    }

    /**
     * Get learn guide URL for a device
     */
    private getLearnGuideUrl(device: IDevice): string | undefined {
        return this._learnGuideProvider.getLearnGuideUrl(device as any);
    }

    /**
     * Sanitize workspace name for filesystem
     * Preserves 'mu2-test' exactly when in development mode
     */
    private sanitizeWorkspaceName(name: string): string {
        // In development mode, preserve the exact 'mu2-test' name
        if (this._workspaceUtil.isDevelopmentMode() &&
            (name.toLowerCase() === 'mu2-test' || name.toLowerCase().replace(/\s+/g, '-') === 'mu2-test')) {
            return 'mu2-test';
        }

        return name
            .replace(/[^a-zA-Z0-9\s\-_]/g, '')
            .replace(/\s+/g, '-')
            .toLowerCase()
            .substring(0, 50);
    }

    /**
     * Get workspace location with proper configuration and fallback handling
     */
    private async getWorkspaceLocation(): Promise<string | undefined> {
        // Check if user has provided a workspace URI configuration
        const config = vscode.workspace.getConfiguration('muTwo');
        const userConfiguredLocation = config.get<string>('defaultWorkspaceLocation');

        if (userConfiguredLocation) {
            try {
                // Validate that the user-configured path exists and is accessible
                const configuredUri = vscode.Uri.file(userConfiguredLocation);
                await vscode.workspace.fs.stat(configuredUri);
                return userConfiguredLocation;
            } catch (error) {
                // User-configured path is invalid, show warning and continue to fallbacks
                vscode.window.showWarningMessage(
                    `Configured workspace location "${userConfiguredLocation}" is not accessible. Using default location.`
                );
            }
        }

        // Fallback to extension workspaceStorageUri
        const context = vscode.extensions.getExtension('mu-two.mu-two-editor')?.exports?.context;
        if (context?.workspaceStorageUri) {
            try {
                // Ensure the workspace storage directory exists
                await vscode.workspace.fs.createDirectory(context.workspaceStorageUri);
                const workspaceStoragePath = vscode.Uri.joinPath(context.workspaceStorageUri, 'workspaces');
                await vscode.workspace.fs.createDirectory(workspaceStoragePath);
                return workspaceStoragePath.fsPath;
            } catch (error) {
                console.warn('Failed to use workspaceStorageUri:', error);
            }
        }

        // Fallback to extension globalStorageUri (using activationManager-created directories)
        if (context?.globalStorageUri) {
            try {
                // Use workspaces directory created by activationManager - no creation needed
                const globalWorkspacePath = vscode.Uri.joinPath(context.globalStorageUri, 'workspaces');
                return globalWorkspacePath.fsPath;
            } catch (error) {
                console.warn('Failed to use globalStorageUri workspaces directory:', error);
            }
        }

        // Final fallback: Ask user to select location
        const choice = await vscode.window.showInformationMessage(
            'Unable to determine a default workspace location. Would you like to select a folder?',
            'Select Folder',
            'Cancel'
        );

        if (choice === 'Select Folder') {
            const folderUris = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                canSelectMany: false,
                title: 'Select location for new Mu 2 workspace',
                openLabel: 'Select Folder'
            });

            return folderUris?.[0]?.fsPath;
        }

        return undefined;
    }

    /**
     * Open an existing workspace
     */
    private async openExistingWorkspace(workspacePath: string): Promise<boolean> {
        try {
            const workspaceUri = vscode.Uri.file(workspacePath);
            // In development mode, reuse current window to avoid opening new VS Code instances
            const reuseWindow = this.shouldReuseWindow();
            await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, !reuseWindow);

            if (reuseWindow) {
                this._logger.info('WORKSPACE', 'Development mode: Reusing current window for existing workspace');
            }
            return true;
        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to open workspace: ${error}`);
            vscode.window.showErrorMessage(`Failed to open workspace: ${error}`);
            return false;
        }
    }

    /**
     * Check for pending board association
     */
    public async checkPendingAssociation(device: IDevice): Promise<void> {
        const currentWorkspace = MuTwoWorkspace.rootPath;
        if (!currentWorkspace) {
            return;
        }

        const isMu2 = await this._workspaceUtil.isMuTwoWorkspace(currentWorkspace);
        if (!isMu2) {
            return;
        }

        const boardAssociation = await this._workspaceUtil.getBoardAssociation(currentWorkspace);
        if (boardAssociation) {
            return; // Already has association
        }

        // Current workspace lacks board association
        const choice = await vscode.window.showInformationMessage(
            `Mu 2 workspace currently lacks an associated board. Would you like to associate this ${device.displayName}?`,
            'Associate Board',
            'Create New Workspace',
            'Ignore'
        );

        switch (choice) {
            case 'Associate Board':
                await this.associateBoardWithWorkspace(device, currentWorkspace);
                break;
            case 'Create New Workspace':
                await this.createWorkspaceFlow({ device });
                break;
            case 'Ignore':
            default:
                break;
        }
    }

    /**
     * Associate a board with the current workspace
     */
    private async associateBoardWithWorkspace(device: IDevice, workspaceUri: vscode.Uri): Promise<void> {
        try {
            const boardAssociation: BoardAssociation = {
                board_name: device.displayName,
                vid: device.vendorId || '',
                pid: device.productId || '',
                serial_number: device.path,
                last_connected: new Date().toISOString(),
                connection_count: 1,
                learn_guide_url: this.getLearnGuideUrl(device)
            };

            const associationPath = vscode.Uri.joinPath(workspaceUri, '.vscode', 'mu2', 'board-association.json');
            await vscode.workspace.fs.writeFile(
                associationPath,
                new TextEncoder().encode(JSON.stringify(boardAssociation, null, 2))
            );

            // Update workspace registry
            const workspaceConfig = await this._workspaceUtil.getWorkspaceConfig(workspaceUri);
            if (workspaceConfig) {
                const registry = await this._workspaceUtil.getWorkspaceRegistry();
                const workspace = registry.workspaces.find(ws => ws.id === workspaceConfig.workspace_id);
                if (workspace) {
                    workspace.board_name = device.displayName;
                    workspace.board_vid_pid = `${device.vendorId}:${device.productId}`;
                    await this._workspaceUtil.saveWorkspaceRegistry(registry);
                }
            }

            vscode.window.showInformationMessage(`Board ${device.displayName} has been associated with this workspace.`);
            this._logger.info('WORKSPACE', `Associated board ${device.displayName} with workspace`);

        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to associate board: ${error}`);
            vscode.window.showErrorMessage(`Failed to associate board: ${error}`);
        }
    }

    /**
     * Get workspace utility instance for external access
     */
    public get workspaceUtil(): MuTwoWorkspace {
        return this._workspaceUtil;
    }

    // ========================================
    // Workspace Management with .files/ Directory Structure
    // ========================================

    private _registry: WorkspaceRegistry | null = null;
    private _globalStorageUri: vscode.Uri | null = null;

    /**
     * Initialize enhanced workspace management with global storage
     */
    private async initializeWorkspaceManagement(): Promise<void> {
        // Get extension context for global storage
        const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
        if (!extension?.exports?.context?.globalStorageUri) {
            throw new Error('Extension context or global storage not available');
        }

        this._globalStorageUri = extension.exports.context.globalStorageUri;

        // Use registry directory created by activationManager - no creation needed
        const registryDir = vscode.Uri.joinPath(this._globalStorageUri, 'workspaces', 'registry');

        // Load or create registry
        await this.loadRegistry();
    }

    /**
     * Load enhanced workspace registry from global storage
     */
    private async loadRegistry(): Promise<void> {
        if (!this._globalStorageUri) {
            await this.initializeWorkspaceManagement();
            return;
        }

        const registryPath = vscode.Uri.joinPath(this._globalStorageUri, 'workspaces', 'registry', 'registry.json');

        try {
            const registryData = await vscode.workspace.fs.readFile(registryPath);
            this._registry = JSON.parse(new TextDecoder().decode(registryData));
        } catch (error) {
            // Create new registry if it doesn't exist
            this._registry = {
                machine_hash: '',
                next_workspace_id: 1,
                version: '0.0.1',
                lastUpdated: new Date().toISOString(),
                workspaces: {}
            };
            await this.saveRegistry();
        }
    }

    /**
     * Save enhanced workspace registry to global storage
     */
    private async saveRegistry(): Promise<void> {
        if (!this._registry || !this._globalStorageUri) {
            return;
        }

        this._registry.lastUpdated = new Date().toISOString();
        const registryPath = vscode.Uri.joinPath(this._globalStorageUri, 'workspaces', 'registry', 'registry.json');

        await vscode.workspace.fs.writeFile(
            registryPath,
            new TextEncoder().encode(JSON.stringify(this._registry, null, 2))
        );
    }

    /**
     * Create enhanced workspace with .files/ directory structure
     */
    public async createWorkspaceWithFiles(options: {
        name: string;
        device?: IDevice;
        projectDirectory?: string;
    }): Promise<string> {
        await this.initializeWorkspaceManagement();

        const workspaceId = this.generateWorkspaceId();
        const workspaceName = this.sanitizeWorkspaceName(options.name);

        // Create workspace directory structure
        const workspaceDir = vscode.Uri.joinPath(this._globalStorageUri!, 'workspaces', workspaceId);
        await vscode.workspace.fs.createDirectory(workspaceDir);

        // Create .files/ directory
        const filesDir = vscode.Uri.joinPath(workspaceDir, '.files');
        await vscode.workspace.fs.createDirectory(filesDir);

        // Create workspace files structure
        const workspaceFiles: WorkspaceFiles = {
            directory: filesDir.fsPath,
            workspaceFile: vscode.Uri.joinPath(filesDir, `${workspaceName}.code-workspace`).fsPath,
            initialConfig: vscode.Uri.joinPath(filesDir, 'initial-config.json').fsPath
        };

        // Create .code-workspace file
        const codeWorkspaceContent = this.createCodeWorkspaceContent(options);
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(workspaceFiles.workspaceFile),
            new TextEncoder().encode(JSON.stringify(codeWorkspaceContent, null, 2))
        );

        // Create initial config snapshot
        const initialConfig = {
            workspaceId,
            name: options.name,
            created: new Date().toISOString(),
            device: options.device ? {
                name: options.device.displayName,
                vidPid: `${options.device.vendorId}:${options.device.productId}`,
                serialNumber: options.device.serialNumber
            } : undefined,
            projectDirectory: options.projectDirectory,
            initialSettings: codeWorkspaceContent.settings || {}
        };

        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(workspaceFiles.initialConfig),
            new TextEncoder().encode(JSON.stringify(initialConfig, null, 2))
        );

        // Create workspace metadata
        const configPath = vscode.Uri.joinPath(workspaceDir, 'config.json');
        const workspaceEntry: WorkspaceRegistryEntry = {
            id: workspaceId,
            name: options.name,
            created: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            deviceAssociation: options.device ? {
                boardName: options.device.displayName,
                vidPid: `${options.device.vendorId}:${options.device.productId}`,
                serialNumber: options.device.serialNumber
            } : undefined,
            files: workspaceFiles,
            metadata: {
                projectDirectory: options.projectDirectory,
                hasInitialBackup: true,
                version: '0.0.1'
            }
        };

        await vscode.workspace.fs.writeFile(
            configPath,
            new TextEncoder().encode(JSON.stringify(workspaceEntry, null, 2))
        );

        // Add to registry
        this._registry!.workspaces[workspaceId] = workspaceEntry;
        await this.saveRegistry();

        this._logger.info('WORKSPACE', `Created enhanced workspace: ${options.name} (ID: ${workspaceId})`);
        return workspaceId;
    }

    /**
     * Open enhanced workspace by ID
     */
    public async openWorkspaceWithFiles(workspaceId: string): Promise<boolean> {
        await this.loadRegistry();

        const workspace = this._registry?.workspaces[workspaceId];
        if (!workspace) {
            vscode.window.showErrorMessage(`Workspace not found: ${workspaceId}`);
            return false;
        }

        try {
            // Update last accessed time
            workspace.lastAccessed = new Date().toISOString();
            await this.saveRegistry();

            // Open the .code-workspace file
            const workspaceUri = vscode.Uri.file(workspace.files.workspaceFile);
            // In development mode, reuse current window to avoid opening new VS Code instances
            const reuseWindow = this.shouldReuseWindow();
            await vscode.commands.executeCommand('vscode.openFolder', workspaceUri, !reuseWindow);

            if (reuseWindow) {
                this._logger.info('WORKSPACE', 'Development mode: Reusing current window for enhanced workspace');
            }

            this._logger.info('WORKSPACE', `Opened enhanced workspace: ${workspace.name}`);
            return true;
        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to open workspace ${workspace.name}: ${error}`);
            vscode.window.showErrorMessage(`Failed to open workspace: ${error}`);
            return false;
        }
    }

    /**
     * List all enhanced workspaces
     */
    public async listWorkspaces(): Promise<WorkspaceRegistryEntry[]> {
        await this.loadRegistry();
        return Object.values(this._registry?.workspaces || {});
    }

    /**
     * Delete enhanced workspace
     */
    public async deleteWorkspaceWithFiles(workspaceId: string): Promise<boolean> {
        await this.loadRegistry();

        const workspace = this._registry?.workspaces[workspaceId];
        if (!workspace) {
            return false;
        }

        try {
            // Delete workspace directory
            const workspaceDir = vscode.Uri.joinPath(this._globalStorageUri!, 'workspaces', workspaceId);
            await vscode.workspace.fs.delete(workspaceDir, { recursive: true });

            // Remove from registry
            delete this._registry!.workspaces[workspaceId];
            await this.saveRegistry();

            this._logger.info('WORKSPACE', `Deleted enhanced workspace: ${workspace.name}`);
            return true;
        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to delete workspace: ${error}`);
            return false;
        }
    }

    /**
     * Restore workspace to initial configuration
     */
    public async restoreToInitialConfig(workspaceId: string): Promise<boolean> {
        await this.loadRegistry();

        const workspace = this._registry?.workspaces[workspaceId];
        if (!workspace) {
            return false;
        }

        try {
            // Read initial config
            const initialConfigData = await vscode.workspace.fs.readFile(
                vscode.Uri.file(workspace.files.initialConfig)
            );
            const initialConfig = JSON.parse(new TextDecoder().decode(initialConfigData));

            // Recreate .code-workspace file with initial settings
            const codeWorkspaceContent = {
                folders: [
                    { path: workspace.metadata.projectDirectory || "." }
                ],
                settings: initialConfig.initialSettings || {},
                extensions: {
                    recommendations: [
                        "mu-two.mu-two-editor",
                        "ms-python.python"
                    ]
                }
            };

            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(workspace.files.workspaceFile),
                new TextEncoder().encode(JSON.stringify(codeWorkspaceContent, null, 2))
            );

            this._logger.info('WORKSPACE', `Restored workspace to initial config: ${workspace.name}`);
            return true;
        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to restore workspace: ${error}`);
            return false;
        }
    }

    /**
     * Generate unique workspace ID
     */
    private generateWorkspaceId(): string {
        return `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Create VS Code workspace file content
     */
    private createCodeWorkspaceContent(options: { name: string; device?: IDevice; projectDirectory?: string }) {
        return {
            folders: [
                {
                    name: options.name,
                    path: options.projectDirectory || "."
                }
            ],
            settings: {
                "python.defaultInterpreterPath": "${workspaceFolder}/.venv/bin/python",
                "muTwo.workspace.boardAssociation": options.device ? {
                    boardName: options.device.displayName,
                    vidPid: `${options.device.vendorId}:${options.device.productId}`,
                    serialNumber: options.device.serialNumber
                } : undefined,
                "files.associations": {
                    "*.py": "python"
                },
                "python.analysis.extraPaths": [
                    "${workspaceFolder}/lib"
                ]
            },
            extensions: {
                recommendations: [
                    "mu-two.mu-two-editor",
                    "ms-python.python",
                    "ms-python.pylint"
                ]
            }
        };
    }

    /**
     * Determine if we should reuse the current window for workspace opening
     * In development mode (mu2-test workspace), always reuse the current window
     */
    private shouldReuseWindow(): boolean {
        return this._workspaceUtil.isDevelopmentMode();
    }

    /**
     * Initialize development mode specific handling
     */
    private async initializeDevelopmentMode(): Promise<void> {
        if (this._workspaceUtil.isDevelopmentMode()) {
            this._logger.info('WORKSPACE', 'Development mode detected for mu2-test workspace');

            // Clean test workspace files from previous sessions
            await this._workspaceUtil.cleanTestWorkspaceFiles();

            // Set up window close handler for log file cleanup
            this.setupWindowCloseHandler();

            this._logger.info('WORKSPACE', `Test workspace session: ${this._workspaceUtil.getSessionId()}`);
        }
    }

    /**
     * Set up handler to clean workspace log files when editor window closes
     */
    private setupWindowCloseHandler(): void {
        // Listen for when the VS Code window is about to close
        const disposable = vscode.workspace.onWillSaveTextDocument(async (event) => {
            // This is a workaround since VS Code doesn't have a direct window close event
            // We'll use context storage to track session state
        });

        // More robust approach: Clean up on extension deactivation
        process.on('beforeExit', async () => {
            await this.cleanupTestWorkspaceLogs();
        });

        process.on('exit', async () => {
            await this.cleanupTestWorkspaceLogs();
        });
    }

    /**
     * Clean up workspace log files for development test workspace
     */
    private async cleanupTestWorkspaceLogs(): Promise<void> {
        if (!this._workspaceUtil.isDevelopmentMode()) {
            return;
        }

        try {
            // Clean up log files and temporary data
            const testWorkspaceKey = 'mu2.testWorkspace.logs';
            const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
            if (extension?.exports?.context) {
                await extension.exports.context.globalState.update(testWorkspaceKey, undefined);
                this._logger.info('WORKSPACE', 'Cleaned up test workspace logs on session end');
            }
        } catch (error) {
            console.warn('Failed to clean up test workspace logs:', error);
        }
    }

    /**
     * Development-only command to clear all test workspace data
     */
    public async clearTestWorkspaceData(): Promise<void> {
        try {
            await this._workspaceUtil.clearTestWorkspaceData();
            vscode.window.showInformationMessage('Test workspace data cleared successfully');
            this._logger.info('WORKSPACE', 'Test workspace data cleared by user command');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to clear test workspace data: ${errorMessage}`);
            this._logger.error('WORKSPACE', `Failed to clear test workspace data: ${errorMessage}`);
        }
    }

    /**
     * Check if current workspace should be treated as non-Mu2 workspace (for development testing)
     */
    public async isWorkspaceTreatedAsNonMu2(): Promise<boolean> {
        if (this._workspaceUtil.isDevelopmentMode()) {
            // Always treat mu2-test workspace as non-Mu2 at start of new session
            const sessionKey = `mu2.testWorkspace.session.${this._workspaceUtil.getSessionId()}`;
            const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');

            if (extension?.exports?.context) {
                const sessionInitialized = extension.exports.context.globalState.get<boolean>(sessionKey);
                if (!sessionInitialized) {
                    // Mark session as initialized and treat as non-Mu2 workspace
                    await extension.exports.context.globalState.update(sessionKey, true);
                    this._logger.info('WORKSPACE', 'Treating mu2-test workspace as non-Mu2 for this session');
                    return true;
                }
            }
        }

        return false;
    }


    /**
     * Dispose resources
     */
    public dispose(): void {
        // Using unified logger instead of disposing output channel
        this._learnGuideProvider.dispose();
    }
}

// Export re-exports for backward compatibility
export { ProjectManager } from './projectManager';
export { FileSaveTwiceHandler } from '../workspace/filesystem/saveTwiceHandler';