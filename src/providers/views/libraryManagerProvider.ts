import * as vscode from 'vscode';
import { getLogger } from '../../utils/unifiedLogger';
import { CircuitPythonBundleManager, LibraryInfo } from '../../workspace/integration/bundleManager';
import { PythonEnvManager } from '../../execution/pythonEnvManager';

/**
 * Tree item types for the library manager
 */
export type LibraryTreeItemType = 'category' | 'library' | 'loading';

/**
 * Tree item for library manager
 */
export class LibraryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: LibraryTreeItemType,
        public readonly libraryInfo?: LibraryInfo,
        public readonly isInstalled?: boolean,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
    ) {
        super(label, collapsibleState);

        this.setupTreeItem();
    }

    private setupTreeItem(): void {
        switch (this.itemType) {
            case 'category':
                this.iconPath = new vscode.ThemeIcon('folder');
                this.contextValue = 'category';
                break;

            case 'library':
                if (this.isInstalled) {
                    this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
                    this.description = 'Installed';
                    this.contextValue = 'installedLibrary';
                } else {
                    this.iconPath = new vscode.ThemeIcon('cloud-download');
                    this.description = 'Available';
                    this.contextValue = 'availableLibrary';
                }

                if (this.libraryInfo) {
                    this.tooltip = `${this.libraryInfo.name}\n${this.libraryInfo.description || 'CircuitPython library'}`;

                    // Add install/remove command
                    this.command = {
                        command: this.isInstalled ? 'muTwo.library.remove' : 'muTwo.library.install',
                        title: this.isInstalled ? 'Remove Library' : 'Install Library',
                        arguments: [this.libraryInfo.name]
                    };
                }
                break;

            case 'loading':
                this.iconPath = new vscode.ThemeIcon('loading~spin');
                this.description = 'Loading...';
                break;
        }
    }
}

/**
 * Library Manager Tree Data Provider
 *
 * Provides a PyCharm-style library management interface with:
 * - Installed Libraries section (from workspace lib/)
 * - Available Libraries section (from CircuitPython bundle)
 * - Install/Remove functionality
 * - Search and filtering capabilities
 */
export class LibraryManagerProvider implements vscode.TreeDataProvider<LibraryTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<LibraryTreeItem | undefined | null | void> = new vscode.EventEmitter<LibraryTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<LibraryTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private logger = getLogger();
    private bundleManager?: CircuitPythonBundleManager;
    private isLoading = false;
    private searchFilter = '';

    constructor(
        private context: vscode.ExtensionContext,
        private pythonEnvManager: PythonEnvManager
    ) {
        this.initializeBundleManager();
    }

    /**
     * Initialize the bundle manager
     */
    private async initializeBundleManager(): Promise<void> {
        this.bundleManager = this.pythonEnvManager.getBundleManager();
        if (this.bundleManager) {
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
     * Set search filter
     */
    setSearchFilter(filter: string): void {
        this.searchFilter = filter.toLowerCase();
        this.refresh();
    }

    /**
     * Get tree item
     */
    getTreeItem(element: LibraryTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children for tree view
     */
    async getChildren(element?: LibraryTreeItem): Promise<LibraryTreeItem[]> {
        if (!element) {
            // Root level - show main categories
            return this.getRootCategories();
        }

        if (element.itemType === 'category') {
            return this.getCategoryChildren(element.label);
        }

        return [];
    }

    /**
     * Get root categories
     */
    private getRootCategories(): LibraryTreeItem[] {
        const categories: LibraryTreeItem[] = [
            new LibraryTreeItem(
                'Installed Libraries',
                'category',
                undefined,
                undefined,
                vscode.TreeItemCollapsibleState.Expanded
            ),
            new LibraryTreeItem(
                'Available Libraries',
                'category',
                undefined,
                undefined,
                vscode.TreeItemCollapsibleState.Collapsed
            )
        ];

        return categories;
    }

    /**
     * Get children for a specific category
     */
    private async getCategoryChildren(categoryName: string): Promise<LibraryTreeItem[]> {
        if (!this.bundleManager) {
            return [new LibraryTreeItem('Bundle manager not available', 'loading')];
        }

        try {
            switch (categoryName) {
                case 'Installed Libraries':
                    return await this.getInstalledLibraries();
                case 'Available Libraries':
                    return await this.getAvailableLibraries();
                default:
                    return [];
            }
        } catch (error) {
            this.logger.error('LIBRARY_MANAGER', `Error getting category children: ${error}`);
            return [new LibraryTreeItem('Error loading libraries', 'loading')];
        }
    }

    /**
     * Get installed libraries in workspace
     */
    private async getInstalledLibraries(): Promise<LibraryTreeItem[]> {
        if (!this.bundleManager) {
            return [];
        }

        try {
            const installedLibs = await this.bundleManager.getWorkspaceLibraries();
            let filteredLibs = installedLibs;

            // Apply search filter
            if (this.searchFilter) {
                filteredLibs = installedLibs.filter(lib =>
                    lib.name.toLowerCase().includes(this.searchFilter)
                );
            }

            if (filteredLibs.length === 0) {
                const message = this.searchFilter
                    ? `No installed libraries match "${this.searchFilter}"`
                    : 'No libraries installed in workspace';
                return [new LibraryTreeItem(message, 'loading')];
            }

            return filteredLibs.map(lib =>
                new LibraryTreeItem(lib.name, 'library', lib, true)
            );

        } catch (error) {
            this.logger.error('LIBRARY_MANAGER', `Error getting installed libraries: ${error}`);
            return [new LibraryTreeItem('Error loading installed libraries', 'loading')];
        }
    }

    /**
     * Get available libraries from bundle
     */
    private async getAvailableLibraries(): Promise<LibraryTreeItem[]> {
        if (!this.bundleManager) {
            return [
                new LibraryTreeItem('📦 Bundle manager not initialized', 'loading'),
                new LibraryTreeItem('→ Run "Mu Two: Setup Python Environment" command', 'loading')
            ];
        }

        try {
            // Check if bundle is installed
            const isBundleInstalled = await this.bundleManager.isBundleInstalled();
            if (!isBundleInstalled) {
                // Create a clickable item to download bundle
                const downloadItem = new LibraryTreeItem(
                    '📥 Download CircuitPython Bundle',
                    'loading'
                );
                downloadItem.command = {
                    command: 'muTwo.library.downloadBundle',
                    title: 'Download Bundle'
                };
                downloadItem.tooltip = 'Click to download the CircuitPython library bundle';

                return [
                    new LibraryTreeItem('CircuitPython bundle not installed', 'loading'),
                    downloadItem
                ];
            }

            const [availableLibs, installedLibs] = await Promise.all([
                this.bundleManager.getAvailableLibraries(),
                this.bundleManager.getWorkspaceLibraries()
            ]);

            // Create a set of installed library names for quick lookup
            const installedNames = new Set(installedLibs.map(lib => lib.name));

            // Apply search filter to all available libraries (show both installed and not installed)
            let filteredLibs = availableLibs;

            if (this.searchFilter) {
                filteredLibs = availableLibs.filter(lib =>
                    lib.name.toLowerCase().includes(this.searchFilter)
                );
            }

            if (filteredLibs.length === 0) {
                const message = this.searchFilter
                    ? `No available libraries match "${this.searchFilter}"`
                    : 'No libraries available in bundle';
                return [new LibraryTreeItem(message, 'loading')];
            }

            // Group libraries by type (files vs packages) and installation status
            const packages = filteredLibs.filter(lib => lib.isDirectory);
            const modules = filteredLibs.filter(lib => !lib.isDirectory);

            const items: LibraryTreeItem[] = [];

            if (packages.length > 0) {
                const installedCount = packages.filter(lib => installedNames.has(lib.name)).length;
                items.push(new LibraryTreeItem(
                    `Library Packages (${packages.length} total, ${installedCount} installed)`,
                    'category',
                    undefined,
                    undefined,
                    vscode.TreeItemCollapsibleState.Expanded
                ));
                items.push(...packages.map(lib =>
                    new LibraryTreeItem(
                        `📦 ${lib.name}`,
                        'library',
                        lib,
                        installedNames.has(lib.name)
                    )
                ));
            }

            if (modules.length > 0) {
                const installedCount = modules.filter(lib => installedNames.has(lib.name)).length;
                items.push(new LibraryTreeItem(
                    `Library Modules (${modules.length} total, ${installedCount} installed)`,
                    'category',
                    undefined,
                    undefined,
                    vscode.TreeItemCollapsibleState.Expanded
                ));
                items.push(...modules.map(lib =>
                    new LibraryTreeItem(
                        `📄 ${lib.name}`,
                        'library',
                        lib,
                        installedNames.has(lib.name)
                    )
                ));
            }

            return items;

        } catch (error) {
            this.logger.error('LIBRARY_MANAGER', `Error getting available libraries: ${error}`);
            return [new LibraryTreeItem('Error loading available libraries', 'loading')];
        }
    }

    /**
     * Install a library to the workspace
     */
    public async installLibrary(libraryName: string): Promise<void> {
        if (!this.bundleManager) {
            vscode.window.showErrorMessage('Bundle manager not available');
            return;
        }

        try {
            const success = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Installing library: ${libraryName}`,
                cancellable: false
            }, async () => {
                return await this.bundleManager!.installLibraryToWorkspace(libraryName);
            });

            if (success) {
                vscode.window.showInformationMessage(`Library ${libraryName} installed successfully`);
                this.refresh();
            } else {
                vscode.window.showErrorMessage(`Failed to install library: ${libraryName}`);
            }

        } catch (error) {
            this.logger.error('LIBRARY_MANAGER', `Error installing library ${libraryName}: ${error}`);
            vscode.window.showErrorMessage(`Failed to install library: ${error}`);
        }
    }

    /**
     * Remove a library from the workspace
     */
    public async removeLibrary(libraryName: string): Promise<void> {
        if (!this.bundleManager) {
            vscode.window.showErrorMessage('Bundle manager not available');
            return;
        }

        // Confirm removal
        const choice = await vscode.window.showWarningMessage(
            `Are you sure you want to remove the library "${libraryName}" from your workspace?`,
            'Remove',
            'Cancel'
        );

        if (choice !== 'Remove') {
            return;
        }

        try {
            const success = await this.bundleManager.removeLibraryFromWorkspace(libraryName);

            if (success) {
                vscode.window.showInformationMessage(`Library ${libraryName} removed successfully`);
                this.refresh();
            } else {
                vscode.window.showErrorMessage(`Failed to remove library: ${libraryName}`);
            }

        } catch (error) {
            this.logger.error('LIBRARY_MANAGER', `Error removing library ${libraryName}: ${error}`);
            vscode.window.showErrorMessage(`Failed to remove library: ${error}`);
        }
    }

    /**
     * Download and install the CircuitPython bundle
     */
    public async downloadBundle(): Promise<void> {
        if (!this.bundleManager) {
            vscode.window.showErrorMessage('Bundle manager not available');
            return;
        }

        try {
            const success = await this.bundleManager.downloadAndInstallBundle();
            if (success) {
                vscode.window.showInformationMessage('CircuitPython bundle downloaded successfully!');
                this.refresh();
            }
        } catch (error) {
            this.logger.error('LIBRARY_MANAGER', `Error downloading bundle: ${error}`);
            vscode.window.showErrorMessage(`Failed to download bundle: ${error}`);
        }
    }

    /**
     * Show library information
     */
    public async showLibraryInfo(libraryName: string): Promise<void> {
        if (!this.bundleManager) {
            return;
        }

        try {
            const [available, installed] = await Promise.all([
                this.bundleManager.getAvailableLibraries(),
                this.bundleManager.getWorkspaceLibraries()
            ]);

            const library = [...available, ...installed].find(lib => lib.name === libraryName);

            if (library) {
                const isInstalled = installed.some(lib => lib.name === libraryName);
                const statusText = isInstalled ? 'Installed in workspace' : 'Available for installation';
                const typeText = library.isDirectory ? 'Package' : 'Module';

                const message = `**${library.name}**\n\n` +
                              `Type: ${typeText}\n` +
                              `Status: ${statusText}\n` +
                              `Description: ${library.description || 'CircuitPython library'}`;

                vscode.window.showInformationMessage(message, { modal: true });
            }
        } catch (error) {
            this.logger.error('LIBRARY_MANAGER', `Error showing library info: ${error}`);
        }
    }

    /**
     * Update workspace context when workspace changes
     */
    public updateWorkspace(): void {
        this.initializeBundleManager();
    }

    /**
     * Dispose resources
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }
}