import * as vscode from 'vscode';
import { FileOperations } from './filesystem/fileOperations';
import { LibraryManager } from './integration/libraryManager';

// Project Management System - Jukebox/CD Changer Pattern
export class ProjectManager implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _currentProjectName: string | null = null;
    private _libraryManager: LibraryManager;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this._libraryManager = new LibraryManager();
    }

    /**
     * Get the current project name, or null if using .current
     */
    public getCurrentProjectName(): string | null {
        return this._currentProjectName;
    }

    /**
     * Load a project from projects directory to current
     */
    public async loadProject(projectName: string): Promise<boolean> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 2) {
                vscode.window.showErrorMessage('Mu Two workspace structure not found');
                return false;
            }

            const mainRoot = workspaceFolders[0];
            const ctpyRoot = workspaceFolders[1];
            
            const projectsDir = vscode.Uri.joinPath(mainRoot.uri, 'projects');
            const projectDir = vscode.Uri.joinPath(projectsDir, projectName);
            const currentDir = vscode.Uri.joinPath(ctpyRoot.uri, 'current');

            // Check if project exists
            try {
                await vscode.workspace.fs.stat(projectDir);
            } catch {
                vscode.window.showErrorMessage(`Project '${projectName}' not found`);
                return false;
            }

            // Handle current project backup
            const backupSuccess = await this.backupCurrentProject();
            if (!backupSuccess) {
                return false; // User cancelled or error occurred
            }

            // Clear current directory
            await FileOperations.clearDirectory(currentDir);

            // Copy project to current
            await FileOperations.copyDirectoryContents(projectDir, currentDir);

            this._currentProjectName = projectName;
            this.outputChannel.appendLine(`Loaded project: ${projectName}`);
            vscode.window.showInformationMessage(`📁 Project '${projectName}' loaded`);

            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to load project: ${error}`);
            vscode.window.showErrorMessage(`Failed to load project: ${error}`);
            return false;
        }
    }

    /**
     * Save current project with a name
     */
    public async saveProjectAs(projectName?: string): Promise<boolean> {
        try {
            if (!projectName) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                const ctpyRoot = workspaceFolders && workspaceFolders.length >= 2 ? workspaceFolders[1] : undefined;
                const autoName = await FileOperations.generateProjectName(ctpyRoot?.uri);
                projectName = await vscode.window.showInputBox({
                    prompt: 'Enter project name',
                    placeHolder: autoName,
                    value: autoName
                });

                if (!projectName) {
                    return false; // User cancelled
                }
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 2) {
                vscode.window.showErrorMessage('Mu Two workspace structure not found');
                return false;
            }

            const mainRoot = workspaceFolders[0];
            const ctpyRoot = workspaceFolders[1];
            
            const projectsDir = vscode.Uri.joinPath(mainRoot.uri, 'projects');
            const projectDir = vscode.Uri.joinPath(projectsDir, projectName);
            const currentDir = vscode.Uri.joinPath(ctpyRoot.uri, 'current');

            // Ensure projects directory exists
            await FileOperations.ensureDirectoryExists(projectsDir);

            // Check if project already exists
            try {
                await vscode.workspace.fs.stat(projectDir);
                const choice = await vscode.window.showWarningMessage(
                    `Project '${projectName}' already exists. Overwrite?`,
                    'Overwrite', 'Cancel'
                );
                if (choice !== 'Overwrite') {
                    return false;
                }
            } catch {
                // Project doesn't exist, that's fine
            }

            // Create/overwrite project directory
            await FileOperations.ensureDirectoryExists(projectDir);
            await FileOperations.clearDirectory(projectDir);
            await FileOperations.copyDirectoryContents(currentDir, projectDir);

            // Generate lib.json
            await this._libraryManager.updateProjectLibraries(projectDir);

            this._currentProjectName = projectName;
            this.outputChannel.appendLine(`Saved project: ${projectName}`);
            vscode.window.showInformationMessage(`💾 Project '${projectName}' saved`);

            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to save project: ${error}`);
            vscode.window.showErrorMessage(`Failed to save project: ${error}`);
            return false;
        }
    }

    /**
     * Create a new project (backup current, clear current)
     */
    public async createNewProject(): Promise<boolean> {
        try {
            // Handle current project backup
            const backupSuccess = await this.backupCurrentProject();
            if (!backupSuccess) {
                return false; // User cancelled or error occurred
            }

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 2) {
                vscode.window.showErrorMessage('Mu Two workspace structure not found');
                return false;
            }

            const ctpyRoot = workspaceFolders[1];
            const currentDir = vscode.Uri.joinPath(ctpyRoot.uri, 'current');

            // Clear current directory
            await FileOperations.clearDirectory(currentDir);

            // Create basic project structure
            await FileOperations.createBasicProjectStructure(currentDir);

            this._currentProjectName = null;
            this.outputChannel.appendLine('Created new project');
            vscode.window.showInformationMessage('✨ New project created');

            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to create new project: ${error}`);
            vscode.window.showErrorMessage(`Failed to create new project: ${error}`);
            return false;
        }
    }

    /**
     * List available projects
     */
    public async listProjects(): Promise<string[]> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 1) {
                return [];
            }

            const mainRoot = workspaceFolders[0];
            const projectsDir = vscode.Uri.joinPath(mainRoot.uri, 'projects');

            try {
                const entries = await vscode.workspace.fs.readDirectory(projectsDir);
                return entries
                    .filter(([name, type]) => type === vscode.FileType.Directory && name !== '.current')
                    .map(([name]) => name)
                    .sort();
            } catch {
                return []; // Projects directory doesn't exist yet
            }
        } catch (error) {
            this.outputChannel.appendLine(`Failed to list projects: ${error}`);
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
                
                this.outputChannel.appendLine(`Backed up current project to: ${this._currentProjectName}`);
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
                    this.outputChannel.appendLine(`Named and backed up current project: ${projectName}`);
                } else {
                    // Save to .current directory
                    const currentBackupDir = vscode.Uri.joinPath(projectsDir, '.current');
                    await FileOperations.ensureDirectoryExists(currentBackupDir);
                    await FileOperations.clearDirectory(currentBackupDir);
                    await FileOperations.copyDirectoryContents(currentDir, currentBackupDir);
                    
                    this.outputChannel.appendLine('Backed up current project to .current');
                }
            }

            return true;
        } catch (error) {
            this.outputChannel.appendLine(`Failed to backup current project: ${error}`);
            vscode.window.showErrorMessage(`Failed to backup current project: ${error}`);
            return false;
        }
    }


    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        this._libraryManager.dispose();
    }
}