import * as vscode from 'vscode';
import { IDevice } from '../devices/core/deviceDetector';
import { FileOperations } from './filesystem/fileOperations';
import { getLogger } from '../utils/unifiedLogger';

// Sync state tracking
interface SyncState {
    currentProjectName: string | null;
    lastSyncTimestamp: string;
    workspaceChecksum: string;
    circuitpyChecksum: string | null;
    projectChecksum: string | null;
    boardConnected: boolean;
    customDriveName: string;
}

// Sync target locations
interface ProjectSyncTargets {
    workspace: vscode.Uri;          // workspaceFolders[0] - user editing
    circuitpy: vscode.Uri | null;   // workspaceFolders[1] - device (optional)
    project: vscode.Uri | null;     // .projects/ProjectName - persistent state
    current: vscode.Uri;            // .projects/.current - last device snapshot
}

// Drive detection configuration
interface DriveDetectionConfig {
    driveName: string;              // User setting: muTwo.circuitPythonDriveName
    commonPaths: string[];          // Platform-specific search paths
    boardIdentifier?: string;       // .vscode/mu2-{id} for validation
}

// Sync conflict resolution options
interface ConflictResolution {
    action: 'use-board' | 'use-local' | 'cancel';
    applyToAll?: boolean;
}

// File change detection
interface FileChangeInfo {
    path: string;
    timestamp: number;
    checksum: string;
    source: 'workspace' | 'circuitpy' | 'project';
}

/**
 * Central coordinator for all workspace synchronization operations
 * Implements the sync flows defined in WORKSPACE-SYNC-FLOWS.md
 */
export class SyncCoordinator implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _logger = getLogger();
    private _syncState: SyncState;
    private _targets: ProjectSyncTargets | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this._syncState = this.initializeSyncState();
        this.setupEventListeners();
    }

    /**
     * Initialize sync state from workspace context
     */
    private initializeSyncState(): SyncState {
        const config = vscode.workspace.getConfiguration('muTwo');
        const customDriveName = config.get<string>('circuitPythonDriveName', 'CIRCUITPY');

        return {
            currentProjectName: this.context.workspaceState.get<string>('currentProjectName') || null,
            lastSyncTimestamp: this.context.workspaceState.get<string>('lastSyncTimestamp') || new Date().toISOString(),
            workspaceChecksum: '',
            circuitpyChecksum: null,
            projectChecksum: null,
            boardConnected: false,
            customDriveName
        };
    }

    /**
     * Setup event listeners for sync triggers
     */
    private setupEventListeners(): void {
        // Listen for workspace folder changes (board connect/disconnect)
        this._disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
                await this.handleWorkspaceFolderChange(event);
            })
        );

        // Listen for configuration changes
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration(async (event) => {
                if (event.affectsConfiguration('muTwo.circuitPythonDriveName')) {
                    await this.handleDriveNameConfigChange();
                }
            })
        );
    }

    /**
     * Get current sync targets based on workspace folders
     */
    private async getSyncTargets(): Promise<ProjectSyncTargets> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length < 1) {
            throw new Error('No workspace folders found');
        }

        const workspace = workspaceFolders[0].uri;
        const circuitpy = workspaceFolders.length >= 2 ? workspaceFolders[1].uri : null;
        const current = vscode.Uri.joinPath(workspace, '.projects', '.current');

        let project: vscode.Uri | null = null;
        if (this._syncState.currentProjectName) {
            project = vscode.Uri.joinPath(workspace, '.projects', this._syncState.currentProjectName);
        }

        return { workspace, circuitpy, project, current };
    }

    /**
     * Handle board connection detection (Flow 1 from flow charts)
     */
    public async handleBoardConnection(device: IDevice, circuitpyPath: string): Promise<boolean> {
        try {
            this._logger.info('SYNC', `Board connected: ${device.displayName} at ${circuitpyPath}`);

            // Update sync state
            this._syncState.boardConnected = true;
            const targets = await this.getSyncTargets();
            targets.circuitpy = vscode.Uri.file(circuitpyPath);

            // Add CIRCUITPY as workspaceFolders[1] if not already present
            await this.ensureCircuitPyWorkspaceFolder(circuitpyPath);

            // Compare CIRCUITPY vs .projects/.current/
            const conflictDetected = await this.detectSyncConflict(targets);

            if (conflictDetected) {
                const resolution = await this.resolveConflict('board-connect');
                if (resolution.action === 'cancel') {
                    return false;
                }
                return await this.applySyncResolution(targets, resolution);
            } else {
                this._logger.info('SYNC', 'Board and workspace are in sync');
                return true;
            }

        } catch (error) {
            this._logger.error('SYNC', `Board connection sync error: ${error}`);
            return false;
        }
    }

    /**
     * Handle board disconnection (Flow 2 from flow charts)
     */
    public async handleBoardDisconnection(): Promise<void> {
        try {
            this._logger.info('SYNC', 'Board disconnected - preserving .current state');

            // Update sync state
            this._syncState.boardConnected = false;
            this._syncState.circuitpyChecksum = null;

            // Remove workspaceFolders[1] reference
            await this.removeCircuitPyWorkspaceFolder();

            // .projects/.current/ becomes frozen snapshot
            // No action needed - it preserves last device state
            this._logger.info('SYNC', 'Board disconnection handled - .current/ preserved');

        } catch (error) {
            this._logger.error('SYNC', `Board disconnection error: ${error}`);
        }
    }

    /**
     * Handle file save with project awareness (Flow 3 from flow charts)
     */
    public async handleFileSave(savedFileUri: vscode.Uri): Promise<boolean> {
        try {
            const fileName = savedFileUri.path.split('/').pop();
            if (!fileName || (!fileName.includes('code.py') && !fileName.includes('main.py') && !savedFileUri.path.includes('/lib/'))) {
                return true; // Not a file we need to sync
            }

            this._logger.info('SYNC', `Handling save for: ${fileName}`);

            // Check if project exists in .projects/ProjectName
            if (!this._syncState.currentProjectName) {
                // Prompt Save Project As
                const projectName = await this.promptSaveProjectAs();
                if (!projectName) {
                    return false; // User cancelled
                }
                this._syncState.currentProjectName = projectName;
                await this.persistSyncState();
            }

            const targets = await this.getSyncTargets();

            // Sync to .projects/ProjectName
            if (targets.project) {
                await this.syncToProjectDirectory(savedFileUri, targets.project);
            }

            // Sync to CIRCUITPY if connected
            if (targets.circuitpy && this._syncState.boardConnected) {
                await this.syncToCircuitPy(savedFileUri, targets.circuitpy);
                await this.updateCurrentSnapshot(targets);
            }

            return true;

        } catch (error) {
            this._logger.error('SYNC', `File save sync error: ${error}`);
            return false;
        }
    }

    /**
     * Create new project (Flow 4 from flow charts)
     */
    public async createNewProject(): Promise<boolean> {
        try {
            // Check if current work has unsaved changes
            if (await this.hasUnsavedChanges()) {
                const hasProject = this._syncState.currentProjectName !== null;

                if (hasProject) {
                    // Save changes to existing project
                    await this.saveCurrentProject();
                } else {
                    // Prompt user to save or delete
                    const choice = await vscode.window.showWarningMessage(
                        'You have unsaved changes. What would you like to do?',
                        'Save Project As...', 'Delete Changes', 'Cancel'
                    );

                    if (choice === 'Cancel') {
                        return false;
                    } else if (choice === 'Save Project As...') {
                        const projectName = await this.promptSaveProjectAs();
                        if (!projectName) return false;
                        this._syncState.currentProjectName = projectName;
                        await this.saveCurrentProject();
                    }
                    // If 'Delete Changes', continue to clear
                }
            }

            // Clear workspace files
            const targets = await this.getSyncTargets();
            await this.clearWorkspaceFiles(targets.workspace);

            // Create basic project structure
            await this.createBasicProjectStructure(targets.workspace);

            // Clear and sync to CIRCUITPY if connected
            if (targets.circuitpy && this._syncState.boardConnected) {
                await this.clearWorkspaceFiles(targets.circuitpy);
                await this.syncWorkspaceToCircuitPy(targets);
                await this.updateCurrentSnapshot(targets);
            }

            // Reset project state
            this._syncState.currentProjectName = null;
            await this.persistSyncState();

            this._logger.info('SYNC', 'New project created successfully');
            return true;

        } catch (error) {
            this._logger.error('SYNC', `Create new project error: ${error}`);
            return false;
        }
    }

    /**
     * Load existing project (Flow 5 from flow charts)
     */
    public async loadProject(projectName: string): Promise<boolean> {
        try {
            const targets = await this.getSyncTargets();
            const projectDir = vscode.Uri.joinPath(targets.workspace, '.projects', projectName);

            // Check if project exists
            try {
                await vscode.workspace.fs.stat(projectDir);
            } catch {
                throw new Error(`Project '${projectName}' not found`);
            }

            // Backup current work if needed
            if (await this.hasUnsavedChanges()) {
                const backupSuccess = await this.backupCurrentWork();
                if (!backupSuccess) return false;
            }

            // Clear workspace
            await this.clearWorkspaceFiles(targets.workspace);

            // Copy project to workspace
            await FileOperations.copyDirectoryContents(projectDir, targets.workspace);

            // Copy project to .current
            await this.clearWorkspaceFiles(targets.current);
            await FileOperations.copyDirectoryContents(projectDir, targets.current);

            // Sync to CIRCUITPY if connected
            if (targets.circuitpy && this._syncState.boardConnected) {
                await this.syncWorkspaceToCircuitPy(targets);
            }

            // Update project state
            this._syncState.currentProjectName = projectName;
            await this.persistSyncState();

            this._logger.info('SYNC', `Project '${projectName}' loaded successfully`);
            vscode.window.showInformationMessage(`📁 Project '${projectName}' loaded`);
            return true;

        } catch (error) {
            this._logger.error('SYNC', `Load project error: ${error}`);
            vscode.window.showErrorMessage(`Failed to load project: ${error}`);
            return false;
        }
    }

    /**
     * Save current project (Flow 6 from flow charts)
     */
    public async saveProjectAs(projectName?: string): Promise<boolean> {
        try {
            if (!projectName) {
                projectName = await this.promptSaveProjectAs();
                if (!projectName) return false;
            }

            const targets = await this.getSyncTargets();
            const projectDir = vscode.Uri.joinPath(targets.workspace, '.projects', projectName);

            // Ensure .projects directory exists
            await FileOperations.ensureDirectoryExists(vscode.Uri.joinPath(targets.workspace, '.projects'));

            // Check if project already exists
            try {
                await vscode.workspace.fs.stat(projectDir);
                const choice = await vscode.window.showWarningMessage(
                    `Project '${projectName}' already exists. Overwrite?`,
                    'Overwrite', 'Cancel'
                );
                if (choice !== 'Overwrite') return false;
            } catch {
                // Project doesn't exist, that's fine
            }

            // Save workspace to project directory
            await FileOperations.ensureDirectoryExists(projectDir);
            await FileOperations.clearDirectory(projectDir);
            await this.copyProjectFiles(targets.workspace, projectDir);

            // Update .current with current state
            await this.updateCurrentSnapshot(targets);

            // Update project state
            this._syncState.currentProjectName = projectName;
            await this.persistSyncState();

            this._logger.info('SYNC', `Project '${projectName}' saved successfully`);
            vscode.window.showInformationMessage(`💾 Project '${projectName}' saved`);
            return true;

        } catch (error) {
            this._logger.error('SYNC', `Save project error: ${error}`);
            vscode.window.showErrorMessage(`Failed to save project: ${error}`);
            return false;
        }
    }

    // Helper methods for sync operations

    private async detectSyncConflict(targets: ProjectSyncTargets): Promise<boolean> {
        try {
            if (!targets.circuitpy) return false;

            // Compare key files between CIRCUITPY and .current
            const circuitpyChecksum = await this.calculateDirectoryChecksum(targets.circuitpy);
            const currentChecksum = await this.calculateDirectoryChecksum(targets.current);

            return circuitpyChecksum !== currentChecksum;
        } catch (error) {
            this._logger.warn('SYNC', `Could not detect sync conflict: ${error}`);
            return false;
        }
    }

    private async resolveConflict(context: string): Promise<ConflictResolution> {
        const message = context === 'board-connect'
            ? 'Board has different files than last sync. What would you like to do?'
            : 'Sync conflict detected. Choose resolution:';

        const choice = await vscode.window.showWarningMessage(
            message,
            'Use Board Files', 'Use Local Files', 'Cancel'
        );

        switch (choice) {
            case 'Use Board Files':
                return { action: 'use-board' };
            case 'Use Local Files':
                return { action: 'use-local' };
            default:
                return { action: 'cancel' };
        }
    }

    private async applySyncResolution(targets: ProjectSyncTargets, resolution: ConflictResolution): Promise<boolean> {
        try {
            if (resolution.action === 'use-board' && targets.circuitpy) {
                // Copy CIRCUITPY → workspace + .current
                await this.clearWorkspaceFiles(targets.workspace);
                await FileOperations.copyDirectoryContents(targets.circuitpy, targets.workspace);
                await this.updateCurrentSnapshot(targets);
                this._logger.info('SYNC', 'Applied board files to workspace');
            } else if (resolution.action === 'use-local' && targets.circuitpy) {
                // Copy .current → CIRCUITPY
                await this.clearWorkspaceFiles(targets.circuitpy);
                await FileOperations.copyDirectoryContents(targets.current, targets.circuitpy);
                this._logger.info('SYNC', 'Applied local files to board');
            }
            return true;
        } catch (error) {
            this._logger.error('SYNC', `Failed to apply sync resolution: ${error}`);
            return false;
        }
    }

    private async promptSaveProjectAs(): Promise<string | undefined> {
        return await vscode.window.showInputBox({
            prompt: 'Enter project name',
            placeHolder: 'my-circuitpython-project',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Project name cannot be empty';
                }
                if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                    return 'Project name can only contain letters, numbers, hyphens, and underscores';
                }
                return null;
            }
        });
    }

    private async hasUnsavedChanges(): Promise<boolean> {
        // Check if workspace has changes compared to current project or .current
        try {
            const targets = await this.getSyncTargets();
            const workspaceChecksum = await this.calculateDirectoryChecksum(targets.workspace);

            if (targets.project) {
                const projectChecksum = await this.calculateDirectoryChecksum(targets.project);
                return workspaceChecksum !== projectChecksum;
            } else {
                const currentChecksum = await this.calculateDirectoryChecksum(targets.current);
                return workspaceChecksum !== currentChecksum;
            }
        } catch {
            return true; // Assume changes if we can't determine
        }
    }

    private async saveCurrentProject(): Promise<void> {
        if (this._syncState.currentProjectName) {
            await this.saveProjectAs(this._syncState.currentProjectName);
        }
    }

    private async backupCurrentWork(): Promise<boolean> {
        if (this._syncState.currentProjectName) {
            return await this.saveCurrentProject() !== undefined;
        } else {
            const choice = await vscode.window.showWarningMessage(
                'You have unsaved changes. Save as project before continuing?',
                'Save As...', 'Discard Changes', 'Cancel'
            );

            if (choice === 'Cancel') return false;
            if (choice === 'Discard Changes') return true;

            const projectName = await this.promptSaveProjectAs();
            if (!projectName) return false;

            return await this.saveProjectAs(projectName);
        }
    }

    // File operation helpers

    private async syncToProjectDirectory(sourceFile: vscode.Uri, projectDir: vscode.Uri): Promise<void> {
        const fileName = sourceFile.path.split('/').pop()!;
        const targetFile = vscode.Uri.joinPath(projectDir, fileName);
        await vscode.workspace.fs.copy(sourceFile, targetFile, { overwrite: true });
    }

    private async syncToCircuitPy(sourceFile: vscode.Uri, circuitpyDir: vscode.Uri): Promise<void> {
        const fileName = sourceFile.path.split('/').pop()!;
        const targetFile = vscode.Uri.joinPath(circuitpyDir, fileName);
        await vscode.workspace.fs.copy(sourceFile, targetFile, { overwrite: true });
    }

    private async syncWorkspaceToCircuitPy(targets: ProjectSyncTargets): Promise<void> {
        if (!targets.circuitpy) return;
        await this.copyProjectFiles(targets.workspace, targets.circuitpy);
    }

    private async updateCurrentSnapshot(targets: ProjectSyncTargets): Promise<void> {
        if (targets.circuitpy) {
            await FileOperations.clearDirectory(targets.current);
            await FileOperations.copyDirectoryContents(targets.circuitpy, targets.current);
        }
    }

    private async copyProjectFiles(sourceDir: vscode.Uri, targetDir: vscode.Uri): Promise<void> {
        // Copy only project-relevant files (code.py, main.py, lib/)
        try {
            const entries = await vscode.workspace.fs.readDirectory(sourceDir);

            for (const [name, type] of entries) {
                if (name === 'code.py' || name === 'main.py' || name === 'lib') {
                    const sourceFile = vscode.Uri.joinPath(sourceDir, name);
                    const targetFile = vscode.Uri.joinPath(targetDir, name);

                    if (type === vscode.FileType.Directory) {
                        await FileOperations.copyDirectoryContents(sourceFile, targetFile);
                    } else {
                        await vscode.workspace.fs.copy(sourceFile, targetFile, { overwrite: true });
                    }
                }
            }
        } catch (error) {
            this._logger.error('SYNC', `Failed to copy project files: ${error}`);
            throw error;
        }
    }

    private async clearWorkspaceFiles(directory: vscode.Uri): Promise<void> {
        await FileOperations.clearDirectory(directory);
    }

    private async createBasicProjectStructure(workspaceDir: vscode.Uri): Promise<void> {
        // Create basic code.py
        const codePy = vscode.Uri.joinPath(workspaceDir, 'code.py');
        const initialCode = `# Welcome to CircuitPython!\nprint("Hello, World!")\n`;
        await vscode.workspace.fs.writeFile(codePy, new TextEncoder().encode(initialCode));

        // Create lib directory
        const libDir = vscode.Uri.joinPath(workspaceDir, 'lib');
        await vscode.workspace.fs.createDirectory(libDir);
    }

    private async calculateDirectoryChecksum(directory: vscode.Uri): Promise<string> {
        // Simple checksum based on file names and sizes
        try {
            const entries = await vscode.workspace.fs.readDirectory(directory);
            const items = entries.map(([name, type]) => `${name}:${type}`).sort();
            return items.join('|');
        } catch {
            return '';
        }
    }

    // Workspace folder management

    private async ensureCircuitPyWorkspaceFolder(circuitpyPath: string): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const circuitpyExists = workspaceFolders.some(folder =>
            folder.uri.fsPath === circuitpyPath || folder.name === this._syncState.customDriveName
        );

        if (!circuitpyExists) {
            const circuitpyUri = vscode.Uri.file(circuitpyPath);
            await vscode.workspace.updateWorkspaceFolders(
                workspaceFolders.length,
                0,
                { uri: circuitpyUri, name: this._syncState.customDriveName }
            );
        }
    }

    private async removeCircuitPyWorkspaceFolder(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders || [];
        const circuitpyIndex = workspaceFolders.findIndex(folder =>
            folder.name === this._syncState.customDriveName
        );

        if (circuitpyIndex >= 0) {
            await vscode.workspace.updateWorkspaceFolders(circuitpyIndex, 1);
        }
    }

    // Event handlers

    private async handleWorkspaceFolderChange(event: vscode.WorkspaceFoldersChangeEvent): Promise<void> {
        // Handle board connect/disconnect based on workspace folder changes
        for (const added of event.added) {
            if (added.name === this._syncState.customDriveName) {
                this._logger.info('SYNC', `CircuitPython drive workspace folder added: ${added.uri.fsPath}`);
                // Note: Actual board connection handling should be triggered by device detection
            }
        }

        for (const removed of event.removed) {
            if (removed.name === this._syncState.customDriveName) {
                this._logger.info('SYNC', `CircuitPython drive workspace folder removed: ${removed.uri.fsPath}`);
                await this.handleBoardDisconnection();
            }
        }
    }

    private async handleDriveNameConfigChange(): Promise<void> {
        const config = vscode.workspace.getConfiguration('muTwo');
        const newDriveName = config.get<string>('circuitPythonDriveName', 'CIRCUITPY');

        if (newDriveName !== this._syncState.customDriveName) {
            this._logger.info('SYNC', `Drive name changed from ${this._syncState.customDriveName} to ${newDriveName}`);
            this._syncState.customDriveName = newDriveName;
            await this.persistSyncState();
        }
    }

    // State persistence

    private async persistSyncState(): Promise<void> {
        await this.context.workspaceState.update('currentProjectName', this._syncState.currentProjectName);
        await this.context.workspaceState.update('lastSyncTimestamp', this._syncState.lastSyncTimestamp);
    }

    // Public getters

    public getCurrentProjectName(): string | null {
        return this._syncState.currentProjectName;
    }

    public isBoardConnected(): boolean {
        return this._syncState.boardConnected;
    }

    public getSyncState(): Readonly<SyncState> {
        return { ...this._syncState };
    }

    // Cleanup

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}