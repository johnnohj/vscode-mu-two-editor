import * as vscode from 'vscode';
import * as path from 'path';
import { getLogger } from '../../utils/unifiedLogger';
import { CircuitPythonBundleManager } from '../../workspace/integration/bundleManager';

/**
 * Tree item representing a saved project in the .projects directory
 */
export class ProjectTreeItem extends vscode.TreeItem {
    constructor(
        public readonly projectName: string,
        public readonly projectPath: string,
        public readonly isSelected: boolean = false,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(projectName, collapsibleState);

        this.tooltip = `Project: ${projectName}\nPath: ${projectPath}`;
        this.description = isSelected ? '✓ Selected' : '';
        this.contextValue = 'project';

        // Set icon based on selection state
        this.iconPath = new vscode.ThemeIcon(
            isSelected ? 'check' : 'file-directory',
            isSelected ? new vscode.ThemeColor('testing.iconPassed') : undefined
        );

        // Add command to toggle selection
        this.command = {
            command: 'muTwo.projects.toggleSelection',
            title: 'Toggle Project Selection',
            arguments: [projectName]
        };
    }
}

/**
 * Workspace Projects Tree View Provider
 *
 * Displays projects saved in the '.projects/' directory with:
 * - Checkbox-style selection (using checkmark icons)
 * - Resume Project button at the top
 * - Save/swap functionality for project management
 */
export class WorkspaceProjectsProvider implements vscode.TreeDataProvider<ProjectTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectTreeItem | undefined | null | void> = new vscode.EventEmitter<ProjectTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private selectedProjects: Set<string> = new Set();
    private projectsDirectory: vscode.Uri | null = null;
    private logger = getLogger();

    constructor(
        private context: vscode.ExtensionContext,
        private bundleManager?: CircuitPythonBundleManager
    ) {
        this.initializeProjectsDirectory();
    }

    /**
     * Initialize the projects directory based on current workspace
     */
    private async initializeProjectsDirectory(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            this.projectsDirectory = vscode.Uri.joinPath(workspaceFolder.uri, '.projects');
            this.refresh();
        }
    }

    /**
     * Refresh the tree view
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get tree item representation
     */
    getTreeItem(element: ProjectTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children (projects) for the tree view
     */
    async getChildren(element?: ProjectTreeItem): Promise<ProjectTreeItem[]> {
        if (!this.projectsDirectory) {
            return [];
        }

        try {
            // Ensure .projects directory exists
            try {
                await vscode.workspace.fs.stat(this.projectsDirectory);
            } catch {
                // Directory doesn't exist, create it
                await vscode.workspace.fs.createDirectory(this.projectsDirectory);
                return [];
            }

            // Read projects directory
            const entries = await vscode.workspace.fs.readDirectory(this.projectsDirectory);
            const projects: ProjectTreeItem[] = [];

            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory && !name.startsWith('.')) {
                    const projectPath = vscode.Uri.joinPath(this.projectsDirectory, name).fsPath;
                    const isSelected = this.selectedProjects.has(name);

                    projects.push(new ProjectTreeItem(
                        name,
                        projectPath,
                        isSelected
                    ));
                }
            }

            // Sort projects alphabetically
            projects.sort((a, b) => a.projectName.localeCompare(b.projectName));

            this.logger.info('PROJECTS_VIEW', `Found ${projects.length} projects in .projects directory`);
            return projects;

        } catch (error) {
            this.logger.error('PROJECTS_VIEW', `Error reading projects directory: ${error}`);
            vscode.window.showErrorMessage(`Failed to read projects: ${error}`);
            return [];
        }
    }

    /**
     * Toggle project selection state
     */
    toggleProjectSelection(projectName: string): void {
        if (this.selectedProjects.has(projectName)) {
            this.selectedProjects.delete(projectName);
        } else {
            this.selectedProjects.add(projectName);
        }
        this.refresh();
        this.logger.info('PROJECTS_VIEW', `Toggled selection for project: ${projectName}`);
    }

    /**
     * Get list of currently selected projects
     */
    getSelectedProjects(): string[] {
        return Array.from(this.selectedProjects);
    }

    /**
     * Clear all selections
     */
    clearSelections(): void {
        this.selectedProjects.clear();
        this.refresh();
        this.logger.info('PROJECTS_VIEW', 'Cleared all project selections');
    }

    /**
     * Resume selected project(s)
     * This saves current workspace state and loads the selected project
     */
    async resumeSelectedProjects(): Promise<void> {
        const selectedProjects = this.getSelectedProjects();

        if (selectedProjects.length === 0) {
            vscode.window.showWarningMessage('Please select a project to resume first.');
            return;
        }

        if (selectedProjects.length > 1) {
            vscode.window.showWarningMessage('Please select only one project to resume.');
            return;
        }

        const projectName = selectedProjects[0];

        try {
            await this.performProjectSwap(projectName);
            this.clearSelections();
            vscode.window.showInformationMessage(`Successfully resumed project: ${projectName}`);
        } catch (error) {
            this.logger.error('PROJECTS_VIEW', `Failed to resume project ${projectName}: ${error}`);
            vscode.window.showErrorMessage(`Failed to resume project: ${error}`);
        }
    }

    /**
     * Save current workspace as a new project
     */
    async saveCurrentAsProject(): Promise<void> {
        const projectName = await vscode.window.showInputBox({
            prompt: 'Enter a name for the current project',
            placeHolder: 'my-project',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Project name cannot be empty';
                }
                if (!/^[a-zA-Z0-9\-_]+$/.test(value.trim())) {
                    return 'Project name can only contain letters, numbers, hyphens, and underscores';
                }
                return null;
            }
        });

        if (!projectName) {
            return;
        }

        try {
            await this.saveWorkspaceAsProject(projectName.trim());
            this.refresh();
            vscode.window.showInformationMessage(`Project saved as: ${projectName}`);
        } catch (error) {
            this.logger.error('PROJECTS_VIEW', `Failed to save project ${projectName}: ${error}`);
            vscode.window.showErrorMessage(`Failed to save project: ${error}`);
        }
    }

    /**
     * Save current workspace state (requirements.txt + code.py) as a named project
     */
    private async saveWorkspaceAsProject(projectName: string): Promise<void> {
        if (!this.projectsDirectory) {
            throw new Error('Projects directory not initialized');
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }

        // Create project directory
        const projectDir = vscode.Uri.joinPath(this.projectsDirectory, projectName);
        await vscode.workspace.fs.createDirectory(projectDir);

        // Generate requirements.txt from current workspace libraries
        if (this.bundleManager) {
            try {
                const success = await this.bundleManager.generateRequirementsFromWorkspace();
                if (success) {
                    // Copy the generated requirements.txt to the project directory
                    const workspaceRequirementsFile = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
                    const projectRequirementsFile = vscode.Uri.joinPath(projectDir, 'requirements.txt');

                    try {
                        const requirementsContent = await vscode.workspace.fs.readFile(workspaceRequirementsFile);
                        await vscode.workspace.fs.writeFile(projectRequirementsFile, requirementsContent);
                        this.logger.info('PROJECTS_VIEW', `Saved requirements.txt for project: ${projectName}`);
                    } catch (error) {
                        this.logger.warn('PROJECTS_VIEW', `Failed to copy requirements.txt: ${error}`);
                        // Create empty requirements.txt
                        await vscode.workspace.fs.writeFile(projectRequirementsFile, new TextEncoder().encode('# No libraries installed\n'));
                    }
                } else {
                    // Create empty requirements.txt
                    const projectRequirementsFile = vscode.Uri.joinPath(projectDir, 'requirements.txt');
                    await vscode.workspace.fs.writeFile(projectRequirementsFile, new TextEncoder().encode('# No libraries installed\n'));
                }
            } catch (error) {
                this.logger.warn('PROJECTS_VIEW', `Failed to generate requirements.txt for project: ${error}`);
                // Create empty requirements.txt as fallback
                const projectRequirementsFile = vscode.Uri.joinPath(projectDir, 'requirements.txt');
                await vscode.workspace.fs.writeFile(projectRequirementsFile, new TextEncoder().encode('# No libraries installed\n'));
            }
        } else {
            // Fallback: Copy lib/ directory if bundle manager not available
            const libDir = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');
            try {
                await vscode.workspace.fs.stat(libDir);
                const projectLibDir = vscode.Uri.joinPath(projectDir, 'lib');
                await this.copyDirectory(libDir, projectLibDir);
                this.logger.info('PROJECTS_VIEW', `Copied lib/ directory for project: ${projectName} (fallback mode)`);
            } catch {
                // lib directory doesn't exist, create empty requirements.txt
                const projectRequirementsFile = vscode.Uri.joinPath(projectDir, 'requirements.txt');
                await vscode.workspace.fs.writeFile(projectRequirementsFile, new TextEncoder().encode('# No libraries installed\n'));
            }
        }

        // Copy code.py if it exists
        const codePyFile = vscode.Uri.joinPath(workspaceFolder.uri, 'code.py');
        try {
            const codeContent = await vscode.workspace.fs.readFile(codePyFile);
            const projectCodePy = vscode.Uri.joinPath(projectDir, 'code.py');
            await vscode.workspace.fs.writeFile(projectCodePy, codeContent);
        } catch {
            // code.py doesn't exist, create a basic one
            const basicCode = '# CircuitPython Project\nimport time\n\nprint("Hello from saved project!")\n';
            const projectCodePy = vscode.Uri.joinPath(projectDir, 'code.py');
            await vscode.workspace.fs.writeFile(projectCodePy, new TextEncoder().encode(basicCode));
        }

        // Create project metadata
        const metadata = {
            name: projectName,
            created: new Date().toISOString(),
            description: `Saved project from workspace`,
            version: '1.0.0',
            usesRequirementsTxt: this.bundleManager ? true : false
        };

        const metadataFile = vscode.Uri.joinPath(projectDir, '.project.json');
        await vscode.workspace.fs.writeFile(
            metadataFile,
            new TextEncoder().encode(JSON.stringify(metadata, null, 2))
        );

        this.logger.info('PROJECTS_VIEW', `Saved project: ${projectName} using ${this.bundleManager ? 'requirements.txt' : 'lib/ directory'}`);
    }

    /**
     * Perform project swap: save current state, load selected project
     */
    private async performProjectSwap(projectName: string): Promise<void> {
        if (!this.projectsDirectory) {
            throw new Error('Projects directory not initialized');
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder open');
        }

        // First, save current state to .current backup if it exists
        await this.saveCurrentStateBackup();

        // Load the selected project
        const projectDir = vscode.Uri.joinPath(this.projectsDirectory, projectName);

        // Check project metadata to determine how to restore libraries
        const metadataFile = vscode.Uri.joinPath(projectDir, '.project.json');
        let usesRequirementsTxt = false;

        try {
            const metadataContent = await vscode.workspace.fs.readFile(metadataFile);
            const metadata = JSON.parse(new TextDecoder().decode(metadataContent));
            usesRequirementsTxt = metadata.usesRequirementsTxt || false;
        } catch {
            // No metadata or error reading, assume old format
            usesRequirementsTxt = false;
        }

        // Restore libraries using requirements.txt if available and bundle manager exists
        if (usesRequirementsTxt && this.bundleManager) {
            try {
                const projectRequirementsFile = vscode.Uri.joinPath(projectDir, 'requirements.txt');
                const workspaceRequirementsFile = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');

                // Copy project's requirements.txt to workspace
                try {
                    const requirementsContent = await vscode.workspace.fs.readFile(projectRequirementsFile);
                    await vscode.workspace.fs.writeFile(workspaceRequirementsFile, requirementsContent);

                    // Clear existing lib directory
                    const workspaceLibDir = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');
                    try {
                        await vscode.workspace.fs.delete(workspaceLibDir, { recursive: true });
                    } catch {
                        // Directory doesn't exist, that's fine
                    }

                    // Install libraries from requirements.txt
                    const success = await this.bundleManager.installLibrariesFromRequirements();
                    if (success) {
                        this.logger.info('PROJECTS_VIEW', `Restored libraries from requirements.txt for project: ${projectName}`);
                    } else {
                        this.logger.warn('PROJECTS_VIEW', `Failed to install libraries from requirements.txt for project: ${projectName}`);
                        vscode.window.showWarningMessage(`Failed to install some libraries for project: ${projectName}`);
                    }
                } catch (error) {
                    this.logger.warn('PROJECTS_VIEW', `No requirements.txt found in project ${projectName}: ${error}`);
                    // Create empty lib directory
                    const workspaceLibDir = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');
                    await vscode.workspace.fs.createDirectory(workspaceLibDir);
                }
            } catch (error) {
                this.logger.error('PROJECTS_VIEW', `Error restoring libraries from requirements.txt: ${error}`);
                vscode.window.showErrorMessage(`Failed to restore libraries for project: ${projectName}`);
            }
        } else {
            // Fallback: Copy lib/ directory (for old projects or when bundle manager not available)
            const projectLibDir = vscode.Uri.joinPath(projectDir, 'lib');
            const workspaceLibDir = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');

            try {
                // Remove existing lib directory
                await vscode.workspace.fs.delete(workspaceLibDir, { recursive: true });
            } catch {
                // Directory doesn't exist, that's fine
            }

            try {
                await this.copyDirectory(projectLibDir, workspaceLibDir);
                this.logger.info('PROJECTS_VIEW', `Restored libraries from lib/ directory for project: ${projectName} (fallback mode)`);
            } catch (error) {
                this.logger.warn('PROJECTS_VIEW', `No lib/ directory found in project ${projectName}: ${error}`);
                // Create empty lib directory
                await vscode.workspace.fs.createDirectory(workspaceLibDir);
            }
        }

        // Copy project's code.py to workspace
        const projectCodePy = vscode.Uri.joinPath(projectDir, 'code.py');
        const workspaceCodePy = vscode.Uri.joinPath(workspaceFolder.uri, 'code.py');

        try {
            const codeContent = await vscode.workspace.fs.readFile(projectCodePy);
            await vscode.workspace.fs.writeFile(workspaceCodePy, codeContent);
        } catch (error) {
            this.logger.warn('PROJECTS_VIEW', `No code.py found in project ${projectName}, skipping`);
        }

        this.logger.info('PROJECTS_VIEW', `Resumed project: ${projectName} using ${usesRequirementsTxt ? 'requirements.txt' : 'lib/ directory'}`);
    }

    /**
     * Save current workspace state to .current backup directory
     */
    private async saveCurrentStateBackup(): Promise<void> {
        if (!this.projectsDirectory) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Use .projects/.current as backup location
        const currentBackupDir = vscode.Uri.joinPath(this.projectsDirectory, '.current');

        try {
            // Remove existing backup
            await vscode.workspace.fs.delete(currentBackupDir, { recursive: true });
        } catch {
            // Backup doesn't exist, that's fine
        }

        await vscode.workspace.fs.createDirectory(currentBackupDir);

        // Generate and backup requirements.txt if bundle manager is available
        if (this.bundleManager) {
            try {
                const success = await this.bundleManager.generateRequirementsFromWorkspace();
                if (success) {
                    // Copy requirements.txt to backup
                    const workspaceRequirementsFile = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
                    const backupRequirementsFile = vscode.Uri.joinPath(currentBackupDir, 'requirements.txt');

                    try {
                        const requirementsContent = await vscode.workspace.fs.readFile(workspaceRequirementsFile);
                        await vscode.workspace.fs.writeFile(backupRequirementsFile, requirementsContent);
                        this.logger.info('PROJECTS_VIEW', 'Backed up requirements.txt');
                    } catch (error) {
                        this.logger.warn('PROJECTS_VIEW', `Failed to backup requirements.txt: ${error}`);
                        // Create empty requirements.txt
                        await vscode.workspace.fs.writeFile(backupRequirementsFile, new TextEncoder().encode('# No libraries installed\n'));
                    }
                }
            } catch (error) {
                this.logger.warn('PROJECTS_VIEW', `Failed to generate requirements.txt for backup: ${error}`);
                // Fallback to lib/ directory backup
                const libDir = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');
                try {
                    await vscode.workspace.fs.stat(libDir);
                    const backupLibDir = vscode.Uri.joinPath(currentBackupDir, 'lib');
                    await this.copyDirectory(libDir, backupLibDir);
                    this.logger.info('PROJECTS_VIEW', 'Backed up lib/ directory as fallback');
                } catch {
                    // No lib directory to backup
                }
            }
        } else {
            // Fallback: Backup lib/ directory if bundle manager not available
            const libDir = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');
            try {
                await vscode.workspace.fs.stat(libDir);
                const backupLibDir = vscode.Uri.joinPath(currentBackupDir, 'lib');
                await this.copyDirectory(libDir, backupLibDir);
                this.logger.info('PROJECTS_VIEW', 'Backed up lib/ directory (fallback mode)');
            } catch {
                // No lib directory to backup
            }
        }

        // Backup code.py
        const codePyFile = vscode.Uri.joinPath(workspaceFolder.uri, 'code.py');
        try {
            const codeContent = await vscode.workspace.fs.readFile(codePyFile);
            const backupCodePy = vscode.Uri.joinPath(currentBackupDir, 'code.py');
            await vscode.workspace.fs.writeFile(backupCodePy, codeContent);
        } catch {
            // No code.py to backup
        }

        // Create backup metadata
        const metadata = {
            name: '.current',
            created: new Date().toISOString(),
            description: 'Automatic backup before project swap',
            isBackup: true,
            usesRequirementsTxt: this.bundleManager ? true : false
        };

        const metadataFile = vscode.Uri.joinPath(currentBackupDir, '.project.json');
        await vscode.workspace.fs.writeFile(
            metadataFile,
            new TextEncoder().encode(JSON.stringify(metadata, null, 2))
        );

        this.logger.info('PROJECTS_VIEW', `Backed up current workspace state using ${this.bundleManager ? 'requirements.txt' : 'lib/ directory'}`);
    }

    /**
     * Copy directory recursively using VS Code file system API
     */
    private async copyDirectory(source: vscode.Uri, destination: vscode.Uri): Promise<void> {
        await vscode.workspace.fs.createDirectory(destination);

        const entries = await vscode.workspace.fs.readDirectory(source);

        for (const [name, type] of entries) {
            const sourcePath = vscode.Uri.joinPath(source, name);
            const destPath = vscode.Uri.joinPath(destination, name);

            if (type === vscode.FileType.Directory) {
                await this.copyDirectory(sourcePath, destPath);
            } else {
                const content = await vscode.workspace.fs.readFile(sourcePath);
                await vscode.workspace.fs.writeFile(destPath, content);
            }
        }
    }

    /**
     * Update projects directory when workspace changes
     */
    public updateWorkspace(): void {
        this.initializeProjectsDirectory();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}