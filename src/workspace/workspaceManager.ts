import * as vscode from "vscode";
import { IDevice } from "../devices/core/deviceDetector";
import { MuTwoWorkspace, WorkspaceConfig, BoardAssociation, PendingDownload, WorkspaceRegistry, WorkspaceRegistryEntry, WorkspaceFiles } from "./workspace";
import { LearnGuideProvider } from "./integration/learnGuideProvider";
import { getLogger } from '../utils/unifiedLogger';
import { BoardManager, IBoard } from "../devices/management/boardManager";

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
    private _boardManager: BoardManager;

    constructor(context: vscode.ExtensionContext, boardManager: BoardManager) {
        this._workspaceUtil = MuTwoWorkspace.getInstance(context);
        this._learnGuideProvider = new LearnGuideProvider();
        this._boardManager = boardManager;
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
        // Check if board manager is available
        if (!this._boardManager) {
            this._logger.error('WORKSPACE', 'Board manager not initialized');
            vscode.window.showErrorMessage('Board manager not initialized. Please try again later.');
            return false;
        }

        // Check if we have any boards in the board manager (connected or not)
        const availableBoards = this._boardManager.getAllBoards();

        if (availableBoards.length === 0) {
            // No boards in database - refresh detection first
            await this._boardManager.refreshDevices();
            const refreshedBoards = this._boardManager.getAllBoards();

            if (refreshedBoards.length === 0) {
                const choice = await vscode.window.showInformationMessage(
                    'No CircuitPython boards detected. Please connect a board or wait for detection to complete.',
                    'Refresh Detection',
                    'Cancel'
                );

                if (choice === 'Refresh Detection') {
                    return await this.handleManualWorkspaceCreation(options);
                }
                return false;
            }
        }

        // Show board selection UI
        const selectedBoard = await this.showBoardSelectionUI();
        if (!selectedBoard) {
            return false;
        }

        // Create workspace with selected board
        return await this.createNewWorkspace({
            ...options,
            device: {
                id: selectedBoard.id,
                path: selectedBoard.connectionState.deviceInfo?.path || '',
                vendorId: selectedBoard.connectionState.deviceInfo?.displayName?.split(':')[0],
                productId: selectedBoard.connectionState.deviceInfo?.displayName?.split(':')[1],
                displayName: selectedBoard.name,
                confidence: 'high' as const,
                hasConflict: false
            } as IDevice
        });
    }

    /**
     * Show board selection UI with connected devices and database boards
     */
    private async showBoardSelectionUI(): Promise<IBoard | null> {
        const connectedBoards = this._boardManager.getConnectedBoards();
        const allBoards = this._boardManager.getAllBoards();

        // Create quick pick items
        const items: Array<vscode.QuickPickItem & { board?: IBoard; isDatabase?: boolean; vidPid?: string }> = [];

        // Add connected boards section
        if (connectedBoards.length > 0) {
            items.push({
                label: '$(device-mobile) Connected Devices',
                kind: vscode.QuickPickItemKind.Separator
            });

            connectedBoards.forEach(board => {
                items.push({
                    label: `$(plug) ${board.name}`,
                    description: 'Connected',
                    detail: `${board.type.toUpperCase()} board - Ready to use`,
                    board
                });
            });
        }

        // Add other detected boards
        const disconnectedBoards = allBoards.filter(board => !board.isConnected());
        if (disconnectedBoards.length > 0) {
            items.push({
                label: '$(device-desktop) Detected Devices',
                kind: vscode.QuickPickItemKind.Separator
            });

            disconnectedBoards.forEach(board => {
                items.push({
                    label: `$(circle-outline) ${board.name}`,
                    description: 'Not connected',
                    detail: `${board.type.toUpperCase()} board - Will use board configuration`,
                    board
                });
            });
        }

        // Add database boards section
        items.push({
            label: '$(library) CircuitPython Board Database',
            kind: vscode.QuickPickItemKind.Separator
        });

        // Get popular boards from database
        const popularBoards = this.getPopularBoardsFromDatabase();
        popularBoards.forEach(boardInfo => {
            items.push({
                label: `$(chip) ${boardInfo.displayName}`,
                description: `${boardInfo.manufacturer}`,
                detail: `VID:PID ${boardInfo.vidPid} - Use for workspace setup`,
                isDatabase: true,
                vidPid: boardInfo.vidPid
            });
        });

        // Show quick pick
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a CircuitPython board for this workspace',
            ignoreFocusOut: true,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selected) {
            return null;
        }

        // Return connected/detected board
        if (selected.board) {
            return selected.board;
        }

        // Create virtual board from database selection
        if (selected.isDatabase && selected.vidPid) {
            return this.createVirtualBoardFromDatabase(selected.vidPid, selected.label);
        }

        return null;
    }

    /**
     * Get popular CircuitPython boards from database for selection
     */
    private getPopularBoardsFromDatabase(): Array<{displayName: string; manufacturer: string; vidPid: string}> {
        // Access the device database through the board manager's device detector
        const deviceDetector = this._boardManager.getDeviceDetector();
        const stats = deviceDetector.getDatabaseStats();

        // For now, return a curated list of popular boards
        // In the future, this could be data-driven from the database
        return [
            {
                displayName: 'Adafruit Feather ESP32-S3',
                manufacturer: 'Adafruit Industries',
                vidPid: '0x239A:0x80F4'
            },
            {
                displayName: 'Adafruit Metro M4',
                manufacturer: 'Adafruit Industries',
                vidPid: '0x239A:0x8014'
            },
            {
                displayName: 'Raspberry Pi Pico',
                manufacturer: 'Raspberry Pi',
                vidPid: '0x2E8A:0x0005'
            },
            {
                displayName: 'Adafruit QT Py ESP32-S3',
                manufacturer: 'Adafruit Industries',
                vidPid: '0x239A:0x80F4'
            },
            {
                displayName: 'ESP32-S3 DevKit',
                manufacturer: 'Espressif',
                vidPid: '0x303A:0x7003'
            }
        ];
    }

    /**
     * Create a virtual board representation from database info
     */
    private createVirtualBoardFromDatabase(vidPid: string, boardName: string): IBoard {
        const [vid, pid] = vidPid.split(':');

        // Create a minimal virtual board for workspace association
        return {
            id: `virtual-${vidPid}`,
            name: boardName.replace('$(chip) ', ''),
            type: 'virtual' as const,
            connectionState: {
                connected: false,
                connecting: false,
                deviceInfo: {
                    path: '',
                    displayName: boardName.replace('$(chip) ', ''),
                    boardId: vidPid
                }
            },
            capabilities: {
                hasFileSystem: true,
                hasRepl: true,
                supportsDebugging: true,
                supportsFileTransfer: true
            },
            connect: async () => { throw new Error('Virtual board cannot be connected'); },
            disconnect: async () => { throw new Error('Virtual board cannot be disconnected'); },
            isConnected: () => false,
            eval: async () => ({ success: false, error: 'Virtual board does not support code execution' }),
            executeFile: async () => ({ success: false, error: 'Virtual board does not support file execution' }),
            interrupt: async () => { throw new Error('Virtual board does not support interruption'); },
            restart: async () => { throw new Error('Virtual board does not support restart'); },
            readFile: async () => { throw new Error('Virtual board does not support file operations'); },
            writeFile: async () => { throw new Error('Virtual board does not support file operations'); },
            listFiles: async () => [],
            deleteFile: async () => { throw new Error('Virtual board does not support file operations'); },
            createReplSession: async () => { throw new Error('Virtual board does not support REPL'); },
            sendToRepl: async () => { throw new Error('Virtual board does not support REPL'); },
            closeReplSession: async () => { throw new Error('Virtual board does not support REPL'); },
            onConnectionStateChanged: new vscode.EventEmitter<any>().event,
            onFileSystemChanged: new vscode.EventEmitter<any>().event,
            onReplOutput: new vscode.EventEmitter<any>().event,
            dispose: () => {}
        } as IBoard;
    }

    /**
     * Open workspace command - shows workspace selection UI
     */
    public async openWorkspaceCommand(): Promise<boolean> {
        // Get list of existing workspaces
        const workspaces = await this.listWorkspaces();

        if (workspaces.length === 0) {
            const choice = await vscode.window.showInformationMessage(
                'No existing workspaces found. Would you like to create a new workspace?',
                'Create New Workspace',
                'Cancel'
            );

            if (choice === 'Create New Workspace') {
                return await this.createWorkspaceFlow();
            }
            return false;
        }

        // Show workspace selection
        const items = workspaces.map(workspace => ({
            label: workspace.name,
            description: workspace.deviceAssociation?.boardName || 'No board associated',
            detail: `Created: ${new Date(workspace.created).toLocaleDateString()}, Last accessed: ${new Date(workspace.lastAccessed).toLocaleDateString()}`,
            workspace
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a workspace to open',
            ignoreFocusOut: true
        });

        if (selected) {
            return await this.openWorkspaceWithFiles(selected.workspace.id);
        }

        return false;
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
     * Create the complete file structure for a new workspace (Refined Structure)
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

        // Create refined directory structure
        await this.createRefinedDirectoryStructure(workspaceUri);

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

            // Create .mu2 identification file on the CIRCUITPY drive
            await this.createDeviceIdentificationFile(device, workspaceId, workspaceName);
        }

        // Create temp/downloads directory (refined structure)
        const tempDir = vscode.Uri.joinPath(mu2Dir, 'temp');
        await vscode.workspace.fs.createDirectory(tempDir);
        const downloadsDir = vscode.Uri.joinPath(tempDir, 'downloads');
        await vscode.workspace.fs.createDirectory(downloadsDir);

        // Create board guide as markdown in .resources/ (refined approach)
        if (device) {
            await this.createBoardGuideMarkdown(device, workspaceUri);
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
     * Create refined directory structure according to MU-TODO.md specifications
     */
    private async createRefinedDirectoryStructure(workspaceUri: vscode.Uri): Promise<void> {
        // Create lib/ directory for current project libraries (moved from CIRCUITPY/current/)
        const libDir = vscode.Uri.joinPath(workspaceUri, 'lib');
        await vscode.workspace.fs.createDirectory(libDir);

        // Create .resources/ directory for board guides (as markdown)
        const resourcesDir = vscode.Uri.joinPath(workspaceUri, '.resources');
        await vscode.workspace.fs.createDirectory(resourcesDir);

        // Create .libraries/ directory for user-modified libraries
        const librariesDir = vscode.Uri.joinPath(workspaceUri, '.libraries');
        await vscode.workspace.fs.createDirectory(librariesDir);

        // Create .projects/ directory (hidden, moved from projects/)
        const projectsDir = vscode.Uri.joinPath(workspaceUri, '.projects');
        await vscode.workspace.fs.createDirectory(projectsDir);

        // Create .projects/.current backup directory
        const currentBackupDir = vscode.Uri.joinPath(projectsDir, '.current');
        await vscode.workspace.fs.createDirectory(currentBackupDir);

        this._logger.info('WORKSPACE', 'Created refined directory structure');
    }

    /**
     * Create board guide as markdown with webpage preview functionality
     */
    private async createBoardGuideMarkdown(device: IDevice, workspaceUri: vscode.Uri): Promise<void> {
        try {
            const resourcesDir = vscode.Uri.joinPath(workspaceUri, '.resources');
            const guideInfo = this._learnGuideProvider.getLearnGuideInfo(device as any);

            if (guideInfo?.guide_url) {
                // Fetch webpage content and convert to markdown
                const markdownContent = await this.fetchAndConvertWebpageToMarkdown(
                    guideInfo.guide_url,
                    device.displayName
                );

                // Save as guide.md in .resources/
                const guidePath = vscode.Uri.joinPath(resourcesDir, 'guide.md');
                await vscode.workspace.fs.writeFile(
                    guidePath,
                    new TextEncoder().encode(markdownContent)
                );

                this._logger.info('WORKSPACE', `Created board guide markdown: ${guidePath.fsPath}`);
            } else {
                // Create placeholder guide
                const placeholderContent = this.createPlaceholderGuide(device.displayName);
                const guidePath = vscode.Uri.joinPath(resourcesDir, 'guide.md');
                await vscode.workspace.fs.writeFile(
                    guidePath,
                    new TextEncoder().encode(placeholderContent)
                );
            }
        } catch (error) {
            this._logger.warn('WORKSPACE', `Failed to create board guide markdown: ${error}`);
        }
    }

    /**
     * Fetch webpage content and convert to markdown with "single page" view
     */
    private async fetchAndConvertWebpageToMarkdown(url: string, boardName: string): Promise<string> {
        try {
            // TODO: Implement webpage fetching and markdown conversion
            // This should fetch the webpage, extract main content, and convert to markdown
            // For now, return a placeholder that includes the URL
            return `# ${boardName} Board Guide

This guide is being fetched from: [${url}](${url})

## Quick Start
Connect your ${boardName} board and start coding!

## Resources
- [Full Board Guide](${url})
- [CircuitPython Documentation](https://docs.circuitpython.org/)

---
*This guide will be enhanced with full webpage content conversion in a future update.*
`;
        } catch (error) {
            this._logger.warn('WORKSPACE', `Failed to fetch webpage content: ${error}`);
            return this.createPlaceholderGuide(boardName);
        }
    }

    /**
     * Create placeholder guide content
     */
    private createPlaceholderGuide(boardName: string): string {
        return `# ${boardName} Board Guide

## Getting Started
Welcome to your ${boardName} CircuitPython project!

## Quick Setup
1. Connect your ${boardName} board
2. Copy your code to \`code.py\`
3. Add any needed libraries to the \`lib/\` folder
4. Your board will automatically run the code!

## Project Structure
- \`code.py\` - Main entry point for your CircuitPython program
- \`lib/\` - CircuitPython libraries for your project
- \`.libraries/\` - Custom or modified libraries
- \`.projects/\` - Saved project versions

## Resources
- [CircuitPython Documentation](https://docs.circuitpython.org/)
- [Adafruit Learning System](https://learn.adafruit.com/)

Happy coding!
`;
    }

    /**
     * Create refined device identification file structure
     */
    private async createDeviceIdentificationFile(
        device: IDevice,
        workspaceId: string,
        workspaceName: string
    ): Promise<void> {
        try {
            // Try to find the CIRCUITPY drive
            const circuitPyPath = await this.findCircuitPyDrive(device);
            if (!circuitPyPath) {
                this._logger.warn('WORKSPACE', `Could not find CIRCUITPY drive for device ${device.displayName}`);
                return;
            }

            this._logger.info('WORKSPACE', `Found CIRCUITPY drive at: ${circuitPyPath}`);

            // Create .vscode directory on CIRCUITPY drive (refined structure)
            const vscodeDir = vscode.Uri.file(`${circuitPyPath}/.vscode`);
            await vscode.workspace.fs.createDirectory(vscodeDir);

            // Create mu2-{id} identification file content
            const mu2FileContent = {
                version: "1.0.0",
                created: new Date().toISOString(),
                workspace_id: workspaceId,
                workspace_name: workspaceName,
                device_info: {
                    board_name: device.displayName,
                    vendor_id: device.vendorId,
                    product_id: device.productId,
                    serial_number: device.path
                },
                scheme: "mutwo", // Our custom scheme for identification
                mu_two_session: true
            };

            // Write mu2-{id} file to CIRCUITPY/.vscode/ (refined structure)
            const mu2FilePath = vscode.Uri.file(`${circuitPyPath}/.vscode/mu2-${workspaceId}`);
            await vscode.workspace.fs.writeFile(
                mu2FilePath,
                new TextEncoder().encode(JSON.stringify(mu2FileContent, null, 2))
            );

            this._logger.info('WORKSPACE', `Created mu2-${workspaceId} identification file on CIRCUITPY drive`);

            // Update the drive's scheme association (if supported by filesystem provider)
            await this.updateDriveSchemeAssociation(circuitPyPath, workspaceId);

        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to create device identification file: ${error}`);
            // Don't throw - this is optional functionality
        }
    }

    /**
     * Find the CircuitPython drive for the given device (using configurable drive name)
     */
    private async findCircuitPyDrive(device: IDevice): Promise<string | null> {
        try {
            // Get user-configured drive name (defaults to "CIRCUITPY")
            const config = vscode.workspace.getConfiguration('muTwo');
            const driveName = config.get<string>('circuitPythonDriveName', 'CIRCUITPY');

            // Build platform-specific search paths using configured drive name
            const commonPaths = [
                `D:/${driveName}`,   // Windows common drive letters
                `E:/${driveName}`,
                `F:/${driveName}`,
                `G:/${driveName}`,
                `/Volumes/${driveName}`,  // macOS
                `/media/${driveName}`,    // Linux
                `/mnt/${driveName}`       // Linux alternative
            ];

            this._logger.info('WORKSPACE', `Searching for CircuitPython drive named: ${driveName}`);

            // Check each potential path
            for (const path of commonPaths) {
                try {
                    const uri = vscode.Uri.file(path);
                    const stat = await vscode.workspace.fs.stat(uri);
                    if (stat.type === vscode.FileType.Directory) {
                        this._logger.info('WORKSPACE', `Found CircuitPython drive at: ${path}`);
                        return path;
                    }
                } catch {
                    // Path doesn't exist, continue checking
                }
            }

            // Try to use the device path if available and contains drive name
            if (device.path && device.path.includes(driveName)) {
                this._logger.info('WORKSPACE', `Using device path: ${device.path}`);
                return device.path;
            }

            this._logger.warn('WORKSPACE', `No CircuitPython drive found with name: ${driveName}`);
            return null;
        } catch (error) {
            this._logger.error('WORKSPACE', `Error finding CircuitPython drive: ${error}`);
            return null;
        }
    }

    /**
     * Update the drive's scheme association for easier re-identification
     */
    private async updateDriveSchemeAssociation(
        circuitPyPath: string,
        workspaceId: string
    ): Promise<void> {
        try {
            // Create a scheme-specific file that our extension can detect
            const schemeFilePath = vscode.Uri.file(`${circuitPyPath}/.vscode-mutwo-${workspaceId}`);
            const schemeContent = {
                scheme: "mutwo",
                workspace_id: workspaceId,
                timestamp: new Date().toISOString()
            };

            await vscode.workspace.fs.writeFile(
                schemeFilePath,
                new TextEncoder().encode(JSON.stringify(schemeContent, null, 2))
            );

            this._logger.info('WORKSPACE', `Created scheme association file for workspace ${workspaceId}`);
        } catch (error) {
            this._logger.warn('WORKSPACE', `Could not create scheme association: ${error}`);
        }
    }

    /**
     * Read device identification from .mu2 file on CIRCUITPY drive
     */
    public async readDeviceIdentification(device: IDevice): Promise<{
        workspaceId: string;
        workspaceName: string;
        scheme: string;
    } | null> {
        try {
            const circuitPyPath = await this.findCircuitPyDrive(device);
            if (!circuitPyPath) {
                return null;
            }

            const mu2FilePath = vscode.Uri.file(`${circuitPyPath}/.mu2`);
            const fileContent = await vscode.workspace.fs.readFile(mu2FilePath);
            const mu2Data = JSON.parse(new TextDecoder().decode(fileContent));

            this._logger.info('WORKSPACE', `Found .mu2 identification file for device ${device.displayName}`);
            this._logger.info('WORKSPACE', `Device linked to workspace: ${mu2Data.workspace_name} (${mu2Data.workspace_id})`);

            return {
                workspaceId: mu2Data.workspace_id,
                workspaceName: mu2Data.workspace_name,
                scheme: mu2Data.scheme || 'mutwo'
            };
        } catch (error) {
            this._logger.debug('WORKSPACE', `No .mu2 identification file found for device: ${error}`);
            return null;
        }
    }

    /**
     * Check if a device has our scheme association files
     */
    public async hasSchemeAssociation(device: IDevice): Promise<boolean> {
        try {
            const circuitPyPath = await this.findCircuitPyDrive(device);
            if (!circuitPyPath) {
                return false;
            }

            // Check for any .vscode-mutwo-* files
            const circuitPyUri = vscode.Uri.file(circuitPyPath);
            const files = await vscode.workspace.fs.readDirectory(circuitPyUri);

            return files.some(([name]) => name.startsWith('.vscode-mutwo-'));
        } catch (error) {
            this._logger.debug('WORKSPACE', `Error checking scheme association: ${error}`);
            return false;
        }
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
     * Change board association for current workspace
     */
    public async changeBoardAssociationCommand(): Promise<void> {
        const currentWorkspace = MuTwoWorkspace.rootPath;
        if (!currentWorkspace) {
            vscode.window.showErrorMessage('No workspace is currently open.');
            return;
        }

        const isMu2 = await this._workspaceUtil.isMuTwoWorkspace(currentWorkspace);
        if (!isMu2) {
            vscode.window.showErrorMessage('Current workspace is not a Mu 2 workspace.');
            return;
        }

        try {
            // Get current board association
            const currentAssociation = await this._workspaceUtil.getBoardAssociation(currentWorkspace);

            // Show board selection UI
            const selectedBoard = await this.showBoardSelectionUI();
            if (!selectedBoard) {
                return; // User cancelled
            }

            // Create device representation from selected board
            const device: IDevice = {
                id: selectedBoard.id,
                path: selectedBoard.connectionState.deviceInfo?.path || '',
                vendorId: selectedBoard.connectionState.deviceInfo?.displayName?.split(':')[0],
                productId: selectedBoard.connectionState.deviceInfo?.displayName?.split(':')[1],
                displayName: selectedBoard.name,
                confidence: 'high' as const,
                hasConflict: false
            };

            // Confirm the change if there's an existing association
            if (currentAssociation) {
                const choice = await vscode.window.showWarningMessage(
                    `This workspace is currently associated with "${currentAssociation.board_name}". Do you want to change it to "${device.displayName}"?`,
                    { modal: true },
                    'Change Association',
                    'Cancel'
                );

                if (choice !== 'Change Association') {
                    return;
                }
            }

            // Update the association
            await this.associateBoardWithWorkspace(device, currentWorkspace);

            vscode.window.showInformationMessage(
                `Workspace board association changed to "${device.displayName}".`
            );

            this._logger.info('WORKSPACE', `Board association changed to ${device.displayName}`);

        } catch (error) {
            this._logger.error('WORKSPACE', `Failed to change board association: ${error}`);
            vscode.window.showErrorMessage(`Failed to change board association: ${error}`);
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
                ],
                "python.analysis.diagnosticSeverityOverrides": {
                    "reportShadowedImports": "none"  // CircuitPython requires code.py/main.py as entry points
                }
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