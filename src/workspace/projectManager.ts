import * as vscode from 'vscode';
import { SyncCoordinator } from './syncCoordinator';
import { LibraryManager } from './integration/libraryManager';
import { getLogger } from '../utils/unifiedLogger';

// Project Management System - Simplified with SyncCoordinator
export class ProjectManager implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _libraryManager: LibraryManager;
    private logger = getLogger();

    constructor(
        private context: vscode.ExtensionContext,
        private syncCoordinator: SyncCoordinator
    ) {
        this._libraryManager = new LibraryManager();
    }

    /**
     * Get the current project name from SyncCoordinator
     */
    public getCurrentProjectName(): string | null {
        return this.syncCoordinator.getCurrentProjectName();
    }

    /**
     * Load a project using SyncCoordinator
     */
    public async loadProject(projectName: string): Promise<boolean> {
        return await this.syncCoordinator.loadProject(projectName);
    }

    /**
     * Save current project using SyncCoordinator
     */
    public async saveProjectAs(projectName?: string): Promise<boolean> {
        const result = await this.syncCoordinator.saveProjectAs(projectName);

        // Update library metadata if save was successful
        if (result && this.syncCoordinator.getCurrentProjectName()) {
            try {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const projectDir = vscode.Uri.joinPath(
                        workspaceFolders[0].uri,
                        '.projects',
                        this.syncCoordinator.getCurrentProjectName()!
                    );
                    await this._libraryManager.updateProjectLibraries(projectDir);
                }
            } catch (error) {
                this.logger.warn('WORKSPACE', `Failed to update library metadata: ${error}`);
            }
        }

        return result;
    }

    /**
     * Create a new project using SyncCoordinator
     */
    public async createNewProject(): Promise<boolean> {
        return await this.syncCoordinator.createNewProject();
    }

    /**
     * List available projects (updated for .projects/ directory)
     */
    public async listProjects(): Promise<string[]> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 1) {
                return [];
            }

            const mainRoot = workspaceFolders[0];
            const projectsDir = vscode.Uri.joinPath(mainRoot.uri, '.projects');

            try {
                const entries = await vscode.workspace.fs.readDirectory(projectsDir);
                return entries
                    .filter(([name, type]) => type === vscode.FileType.Directory && name !== '.current')
                    .map(([name]) => name)
                    .sort();
            } catch {
                return []; // .projects directory doesn't exist yet
            }
        } catch (error) {
            this.logger.error('WORKSPACE', `Failed to list projects: ${error}`);
            return [];
        }
    }

    /**
     * Backup current project to appropriate location
     */
    private async backupCurrentProject(): Promise<boolean> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 2) {
                return true; // No workspace to backup
            }

            const mainRoot = workspaceFolders[0];
            const ctpyRoot = workspaceFolders[1];
            const currentDir = vscode.Uri.joinPath(ctpyRoot.uri, 'current');

            // Check if current directory has any content
            try {
                const entries = await vscode.workspace.fs.readDirectory(currentDir);
                if (entries.length === 0) {
                    return true; // Nothing to backup
                }
            } catch {
                return true; // Current directory doesn't exist
            }

            const projectsDir = vscode.Uri.joinPath(mainRoot.uri, 'projects');
            await FileOperations.ensureDirectoryExists(projectsDir);

            if (this._currentProjectName) {
                // Save to named project directory
                const projectDir = vscode.Uri.joinPath(projectsDir, this._currentProjectName);
                await FileOperations.ensureDirectoryExists(projectDir);
                await FileOperations.clearDirectory(projectDir);
                await FileOperations.copyDirectoryContents(currentDir, projectDir);
                await this._libraryManager.updateProjectLibraries(projectDir);

                this.logger.info('WORKSPACE', `Backed up current project to: ${this._currentProjectName}`);
            } else {
                // Check if there's unsaved work that needs naming
                const hasSignificantContent = await FileOperations.hasSignificantContent(currentDir);
                if (hasSignificantContent) {
                    const autoName = await FileOperations.generateProjectName(ctpyRoot.uri);
                    const projectName = await vscode.window.showInputBox({
                        prompt: 'Current project needs a name before proceeding',
                        placeHolder: autoName,
                        value: autoName
                    });

                    if (!projectName) {
                        vscode.window.showInformationMessage('Mu 2 couldn\'t create/load a project while the current one is unnamed');
                        return false; // User cancelled
                    }

                    // Save with the provided name
                    const projectDir = vscode.Uri.joinPath(projectsDir, projectName);
                    await FileOperations.ensureDirectoryExists(projectDir);
                    await FileOperations.clearDirectory(projectDir);
                    await FileOperations.copyDirectoryContents(currentDir, projectDir);
                    await this._libraryManager.updateProjectLibraries(projectDir);

                    this._currentProjectName = projectName;
                    this.logger.info('WORKSPACE', `Named and backed up current project: ${projectName}`);
                } else {
                    // Save to .current directory
                    const currentBackupDir = vscode.Uri.joinPath(projectsDir, '.current');
                    await FileOperations.ensureDirectoryExists(currentBackupDir);
                    await FileOperations.clearDirectory(currentBackupDir);
                    await FileOperations.copyDirectoryContents(currentDir, currentBackupDir);

                    this.logger.info('WORKSPACE', 'Backed up current project to .current');
                }
            }

            return true;
        } catch (error) {
            this.logger.error('WORKSPACE', `Failed to backup current project: ${error}`);
            vscode.window.showErrorMessage(`Failed to backup current project: ${error}`);
            return false;
        }
    }

    // Note: Backup logic now handled by SyncCoordinator - above method is deprecated

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        this._libraryManager.dispose();
    }
}