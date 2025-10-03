import * as vscode from 'vscode';
import * as path from 'path';
import { getLogger } from '../../utils/unifiedLogger';
import { getResourceLocator } from '../../core/resourceLocator';

/**
 * CircuitPython Bundle Manager
 *
 * Handles downloading and managing the Adafruit CircuitPython Bundle using
 * a combination of direct download (for initial setup) and circup integration
 * (for ongoing library management).
 *
 * STRATEGY:
 * 1. Download Python source bundle (.py) to venv site-packages for development
 * 2. Use circup for workspace library management (circup --path ./lib)
 * 3. Support requirements.txt generation and management
 * 4. Provide seamless device sync via standard circup commands
 *
 * This approach leverages official CircuitPython tooling while providing
 * local development capabilities.
 */
export interface BundleInfo {
    version: string;
    downloadUrl: string;
    size: number;
    publishedAt: string;
}

export interface LibraryInfo {
    name: string;
    path: string;
    version?: string;
    description?: string;
    isDirectory: boolean;
    size?: number;
}

export class CircuitPythonBundleManager {
    private logger = getLogger();
    private bundlePath: string | null = null;
    private pythonPath: string | null = null;
    private resourcesPath: string | null = null;

    constructor(private context: vscode.ExtensionContext) {}

    /**
     * Set the Python path for bundle operations
     */
    public setPythonPath(pythonPath: string): void {
        this.pythonPath = pythonPath;
        this.logger.info('BUNDLE', `Python path set to: ${pythonPath}`);
    }

    /**
     * Initialize the bundle manager with terminal-based approach
     */
    public async initialize(): Promise<void> {
        // Set up persistent resources path using ResourceLocator
        const resourceLocator = getResourceLocator();
        const resourcesPath = resourceLocator.getResourcesPath();
        this.resourcesPath = resourcesPath.fsPath;

        await vscode.workspace.fs.createDirectory(resourcesPath);
        this.logger.info('BUNDLE', `Resources path initialized: ${this.resourcesPath}`);

        // We'll determine the bundle path dynamically when needed
        // since the terminal profile handles Python environment setup
        this.logger.info('BUNDLE', 'Bundle manager initialized with terminal-based approach');
    }

    /**
     * Check if the CircuitPython bundle is set up (use persistent storage as indicator)
     */
    public async isBundleInstalled(): Promise<boolean> {
        // Use persistent module list as indicator of bundle setup
        const hasPersistentList = await this.hasPersistentModuleList();
        if (hasPersistentList) {
            this.logger.info('BUNDLE', 'Bundle setup detected (persistent module list exists)');
            return true;
        }

        this.logger.info('BUNDLE', 'Bundle setup not detected');
        return false;
    }

    /**
     * Check if we have a persistent module list in resources
     */
    public async hasPersistentModuleList(): Promise<boolean> {
        if (!this.resourcesPath) {
            return false;
        }

        try {
            const moduleListPath = vscode.Uri.file(path.join(this.resourcesPath, 'circuitpython-modules.json'));
            await vscode.workspace.fs.stat(moduleListPath);
            this.logger.info('BUNDLE', `Persistent module list found at: ${moduleListPath.fsPath}`);
            return true;
        } catch {
            this.logger.info('BUNDLE', `No persistent module list found at: ${this.resourcesPath}`);
            return false;
        }
    }

    /**
     * Load persistent module list from resources
     */
    public async loadPersistentModuleList(): Promise<{ modules: string[], version: string, lastUpdated: string } | null> {
        if (!this.resourcesPath) {
            return null;
        }

        try {
            const moduleListPath = vscode.Uri.file(path.join(this.resourcesPath, 'circuitpython-modules.json'));
            const data = await vscode.workspace.fs.readFile(moduleListPath);
            const moduleData = JSON.parse(new TextDecoder().decode(data));

            this.logger.info('BUNDLE', `Loaded ${moduleData.modules?.length || 0} modules from persistent list (version: ${moduleData.version || 'unknown'})`);
            return moduleData;
        } catch (error) {
            this.logger.warn('BUNDLE', `Failed to load persistent module list: ${error}`);
            return null;
        }
    }

    /**
     * Save module list to persistent resources storage
     */
    public async savePersistentModuleList(modules: string[], version?: string): Promise<void> {
        if (!this.resourcesPath) {
            this.logger.warn('BUNDLE', 'Cannot save persistent module list: resources path not available');
            return;
        }

        try {
            const moduleData = {
                modules: modules.sort(),
                version: version || 'unknown',
                lastUpdated: new Date().toISOString(),
                totalCount: modules.length
            };

            const moduleListPath = vscode.Uri.file(path.join(this.resourcesPath, 'circuitpython-modules.json'));
            await vscode.workspace.fs.writeFile(
                moduleListPath,
                new TextEncoder().encode(JSON.stringify(moduleData, null, 2))
            );

            this.logger.info('BUNDLE', `Saved ${modules.length} modules to persistent list at: ${moduleListPath.fsPath}`);
        } catch (error) {
            this.logger.error('BUNDLE', `Failed to save persistent module list: ${error}`);
            throw error;
        }
    }

    /**
     * Get the latest bundle release information from GitHub
     */
    public async getLatestBundleInfo(): Promise<BundleInfo | null> {
        try {
            this.logger.info('BUNDLE', 'Fetching latest bundle release info from GitHub...');

            // Use VS Code's built-in fetch (if available) or fall back to manual implementation
            const response = await this.makeHttpRequest('https://api.github.com/repos/adafruit/Adafruit_CircuitPython_Bundle/releases/latest');
            const release = JSON.parse(response);

            // Find the .py source code bundle (not .mpy compiled bytecode)
            const zipAsset = release.assets?.find((asset: any) =>
                asset.name.includes('adafruit-circuitpython-bundle-py') && asset.name.endsWith('.zip')
            );

            if (!zipAsset) {
                throw new Error('Could not find Python source bundle (adafruit-circuitpython-bundle-py) in latest release');
            }

            const bundleInfo: BundleInfo = {
                version: release.tag_name,
                downloadUrl: zipAsset.browser_download_url,
                size: zipAsset.size,
                publishedAt: release.published_at
            };

            this.logger.info('BUNDLE', `Latest Python source bundle: ${bundleInfo.version} (${(bundleInfo.size / 1024 / 1024).toFixed(1)}MB)`);
            this.logger.info('BUNDLE', `Bundle asset: ${zipAsset.name}`);
            return bundleInfo;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to fetch bundle info: ${error}`);
            return null;
        }
    }


    /**
     * Get list of available libraries from persistent module list (circup bundle)
     * Libraries are installed directly in site-packages, not in a subdirectory
     */
    public async getAvailableLibraries(): Promise<LibraryInfo[]> {
        // Check if bundle is set up using persistent module list
        if (!await this.isBundleInstalled()) {
            this.logger.warn('BUNDLE', 'Cannot get available libraries: bundle not installed');
            return [];
        }

        try {
            // Load persistent module list created by circup
            const moduleData = await this.loadPersistentModuleList();
            if (!moduleData || !moduleData.modules) {
                this.logger.warn('BUNDLE', 'No persistent module list available');
                return [];
            }

            // Get site-packages path to check if libraries exist
            const venvRoot = this.pythonPath || '';
            const isWindows = process.platform === 'win32';
            const sitePackagesPath = isWindows
                ? path.join(venvRoot, 'Lib', 'site-packages')
                : path.join(venvRoot, 'lib', 'python*', 'site-packages');

            const libraries: LibraryInfo[] = [];

            // Convert module names to library info objects
            for (const moduleName of moduleData.modules) {
                if (!moduleName || moduleName.startsWith('.')) continue;

                // Check if it's a package (directory) or module (file)
                const packagePath = path.join(sitePackagesPath, moduleName);
                const modulePath = path.join(sitePackagesPath, `${moduleName}.py`);

                let isDirectory = false;
                let itemPath = modulePath;

                // Check which one exists
                try {
                    const packageStat = await vscode.workspace.fs.stat(vscode.Uri.file(packagePath));
                    if (packageStat.type === vscode.FileType.Directory) {
                        isDirectory = true;
                        itemPath = packagePath;
                    }
                } catch {
                    // Not a package, assume it's a module file
                }

                libraries.push({
                    name: moduleName,
                    path: itemPath,
                    isDirectory,
                    description: `CircuitPython library: ${moduleName}`
                });
            }

            // Sort libraries alphabetically
            libraries.sort((a, b) => a.name.localeCompare(b.name));

            this.logger.info('BUNDLE', `Found ${libraries.length} libraries in persistent module list`);
            return libraries;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to get available libraries: ${error}`);
            return [];
        }
    }

    /**
     * Copy a library from the bundle to the workspace lib directory
     */
    public async installLibraryToWorkspace(libraryName: string): Promise<boolean> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            if (!this.bundlePath) {
                throw new Error('Bundle not available');
            }

            const sourcePath = path.join(this.bundlePath, 'lib', libraryName);
            const sourceUri = vscode.Uri.file(sourcePath);

            // Ensure workspace lib directory exists
            const workspaceLibUri = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');
            try {
                await vscode.workspace.fs.createDirectory(workspaceLibUri);
            } catch {
                // Directory might already exist
            }

            const destUri = vscode.Uri.joinPath(workspaceLibUri, libraryName);

            // Check if library is a file or directory
            const sourceStat = await vscode.workspace.fs.stat(sourceUri);

            if (sourceStat.type === vscode.FileType.Directory) {
                await this.copyDirectory(sourceUri, destUri);
            } else {
                const content = await vscode.workspace.fs.readFile(sourceUri);
                await vscode.workspace.fs.writeFile(destUri, content);
            }

            this.logger.info('BUNDLE', `Installed library: ${libraryName} to workspace`);
            return true;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to install library ${libraryName}: ${error}`);
            return false;
        }
    }

    /**
     * Get installed libraries in the current workspace
     */
    public async getWorkspaceLibraries(): Promise<LibraryInfo[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            const libUri = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');
            const entries = await vscode.workspace.fs.readDirectory(libUri);

            const libraries: LibraryInfo[] = [];

            for (const [name, type] of entries) {
                if (name.startsWith('.')) continue;

                const itemPath = vscode.Uri.joinPath(libUri, name).fsPath;
                const isDirectory = type === vscode.FileType.Directory;

                libraries.push({
                    name,
                    path: itemPath,
                    isDirectory,
                    description: await this.getLibraryDescription(itemPath, isDirectory)
                });
            }

            return libraries.sort((a, b) => a.name.localeCompare(b.name));

        } catch (error) {
            // lib directory doesn't exist yet
            return [];
        }
    }

    /**
     * Remove a library from the workspace
     */
    public async removeLibraryFromWorkspace(libraryName: string): Promise<boolean> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder open');
            }

            const libUri = vscode.Uri.joinPath(workspaceFolder.uri, 'lib', libraryName);
            await vscode.workspace.fs.delete(libUri, { recursive: true });

            this.logger.info('BUNDLE', `Removed library: ${libraryName} from workspace`);
            return true;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to remove library ${libraryName}: ${error}`);
            return false;
        }
    }

    /**
     * Get the bundle installation path in the venv site-packages
     */
    private async getBundleInstallPath(): Promise<string | null> {
        if (!this.pythonPath) {
            return null;
        }

        // Determine if pythonPath is a directory (venv root) or python.exe path
        let venvRoot: string;

        // Check if it ends with python.exe or python (executable)
        const basename = path.basename(this.pythonPath);
        if (basename === 'python.exe' || basename === 'python' || basename === 'python3') {
            // It's a path to python executable - go up from Scripts/bin to venv root
            const pythonDir = path.dirname(this.pythonPath);
            venvRoot = path.dirname(pythonDir);
            this.logger.info('BUNDLE', `Python executable detected, venv root: ${venvRoot}`);
        } else {
            // It's already the venv directory path
            venvRoot = this.pythonPath;
            this.logger.info('BUNDLE', `Venv directory path provided: ${venvRoot}`);
        }

        // Different paths for Windows vs Unix
        const isWindows = process.platform === 'win32';
        const sitePackagesPath = isWindows
            ? path.join(venvRoot, 'Lib', 'site-packages')
            : path.join(venvRoot, 'lib', 'python*', 'site-packages');

        const bundlePath = path.join(sitePackagesPath, 'adafruit-circuitpython-bundle');

        this.logger.info('BUNDLE', `Bundle path calculated as: ${bundlePath}`);
        return bundlePath;
    }


    /**
     * Generate modules list using circup bundle-show --modules
     */
    private async generateModulesList(): Promise<string[]> {
        try {
            this.logger.info('BUNDLE', 'Discovering CircuitPython modules using circup...');
            const result = await this.runCircupCommand(['bundle-show', '--modules']);

            // Parse the output - filter out empty lines and comments
            const modules = result
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'))
                .sort();

            this.logger.info('BUNDLE', `Discovered ${modules.length} CircuitPython modules`);
            return modules;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to generate modules list: ${error}`);
            throw new Error(`Failed to discover CircuitPython modules: ${error}`);
        }
    }

    /**
     * Save internal modules list as JSON
     */
    private async saveInternalModulesList(modules: string[]): Promise<void> {
        if (!this.bundlePath) {
            throw new Error('Bundle path not available');
        }

        try {
            // Create bundle directory if it doesn't exist
            const bundleUri = vscode.Uri.file(this.bundlePath);
            await vscode.workspace.fs.createDirectory(bundleUri);

            // Save as JSON for internal use
            const modulesData = {
                generated: new Date().toISOString(),
                totalModules: modules.length,
                modules: modules
            };

            const jsonPath = vscode.Uri.joinPath(bundleUri, 'ctpyBundleModules.json');
            const jsonContent = JSON.stringify(modulesData, null, 2);
            await vscode.workspace.fs.writeFile(jsonPath, new TextEncoder().encode(jsonContent));

            this.logger.info('BUNDLE', `Saved ${modules.length} modules to ctpyBundleModules.json`);

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to save modules list: ${error}`);
            throw error;
        }
    }

    /**
     * Populate bundle using circup install
     */
    private async populateBundleWithCircup(): Promise<void> {
        if (!this.bundlePath) {
            throw new Error('Bundle path not available');
        }

        try {
            const modulesJsonPath = vscode.Uri.joinPath(vscode.Uri.file(this.bundlePath), 'ctpyBundleModules.json');

            // Use circup to install all modules to the bundle directory
            await this.runCircupCommand([
                'install',
                '-r', modulesJsonPath.fsPath,
                '--path', this.bundlePath
            ]);

            this.logger.info('BUNDLE', `Bundle populated successfully at: ${this.bundlePath}`);

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to populate bundle with circup: ${error}`);
            throw new Error(`Failed to install CircuitPython libraries: ${error}`);
        }
    }

    /**
     * Run Python command
     */
    private async runPythonCommand(args: string[]): Promise<string> {
        if (!this.pythonPath) {
            throw new Error('Python path not available');
        }

        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const childProcess = spawn(this.pythonPath, args, {
                stdio: 'pipe',
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            childProcess.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            childProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            childProcess.on('close', (code: number) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Python command failed (${code}): ${stderr}`));
                }
            });

            childProcess.on('error', (error: Error) => {
                reject(error);
            });
        });
    }

    /**
     * Run Python script
     */
    private async runPythonScript(script: string): Promise<string> {
        return this.runPythonCommand(['-c', script]);
    }

    /**
     * Run circup command using circup.exe executable
     * Circup must be called as an executable, not as a Python module (-m circup doesn't work)
     */
    private async runCircupCommand(args: string[]): Promise<string> {
        if (!this.pythonPath) {
            throw new Error('Python path not available');
        }

        // Get circup executable path from venv Scripts directory
        const venvScriptsPath = this.pythonPath.replace(/python\.exe$/, '');
        const circupPath = venvScriptsPath + 'circup.exe';

        return new Promise((resolve, reject) => {
            const { spawn } = require('child_process');
            const childProcess = spawn(circupPath, args, {
                stdio: 'pipe',
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            childProcess.stdout?.on('data', (data: Buffer) => {
                stdout += data.toString();
            });

            childProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            childProcess.on('close', (code: number) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Circup command failed (${code}): ${stderr}`));
                }
            });

            childProcess.on('error', (error: Error) => {
                reject(error);
            });
        });
    }

    /**
     * Check if bundle needs refresh (daily check)
     */
    public async shouldRefreshBundle(): Promise<boolean> {
        // First check if we have a persistent module list
        const persistentExists = await this.hasPersistentModuleList();
        if (!persistentExists) {
            this.logger.info('BUNDLE', 'No persistent module list found, bundle setup needed');
            return true; // No persistent list, needs initial setup
        }

        // Check the age of the persistent module list
        const persistentData = await this.loadPersistentModuleList();
        if (persistentData) {
            const lastUpdated = new Date(persistentData.lastUpdated);
            const daysSinceUpdate = (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24);

            if (daysSinceUpdate > 7) { // Weekly refresh for persistent list
                this.logger.info('BUNDLE', `Persistent module list is ${daysSinceUpdate.toFixed(1)} days old, refresh needed`);
                return true;
            } else {
                this.logger.info('BUNDLE', `Persistent module list is up to date (${daysSinceUpdate.toFixed(1)} days old)`);
                return false;
            }
        }

        // Fallback to bundle path check for backward compatibility
        if (!this.bundlePath) {
            return true; // No bundle path, needs setup
        }

        try {
            const modulesJsonPath = vscode.Uri.joinPath(vscode.Uri.file(this.bundlePath), 'ctpyBundleModules.json');
            const content = await vscode.workspace.fs.readFile(modulesJsonPath);
            const data = JSON.parse(new TextDecoder().decode(content));

            const generated = new Date(data.generated);
            const daysSinceGenerated = (Date.now() - generated.getTime()) / (1000 * 60 * 60 * 24);

            // Refresh if older than 1 day
            return daysSinceGenerated > 1;

        } catch {
            return true; // Error reading, needs refresh
        }
    }

    /**
     * Quick module refresh without full bundle download
     */
    public async refreshModulesList(): Promise<boolean> {
        try {
            await this.ensureCircupInstalled();

            // Ensure bundlePath is set for saving internal modules list
            if (!this.bundlePath) {
                this.bundlePath = await this.getBundleInstallPath();
                if (!this.bundlePath) {
                    throw new Error('Failed to determine bundle installation path');
                }
            }

            // Get current modules from circup
            const newModules = await this.generateModulesList();

            // Load existing persistent list for comparison
            const existingData = await this.loadPersistentModuleList();
            const existingModules = existingData?.modules || [];

            // Compare and log differences
            const added = newModules.filter(m => !existingModules.includes(m));
            const removed = existingModules.filter(m => !newModules.includes(m));

            if (added.length > 0 || removed.length > 0) {
                this.logger.info('BUNDLE', `Module changes detected: +${added.length} new, -${removed.length} removed`);
                if (added.length > 0) {
                    this.logger.info('BUNDLE', `New modules: ${added.slice(0, 5).join(', ')}${added.length > 5 ? ` (and ${added.length - 5} more)` : ''}`);
                }
                if (removed.length > 0) {
                    this.logger.info('BUNDLE', `Removed modules: ${removed.slice(0, 5).join(', ')}${removed.length > 5 ? ` (and ${removed.length - 5} more)` : ''}`);
                }
            } else {
                this.logger.info('BUNDLE', 'No module changes detected');
            }

            // Save to both persistent storage and internal location
            await this.savePersistentModuleList(newModules);
            await this.saveInternalModulesList(newModules);

            this.logger.info('BUNDLE', 'Modules list refreshed successfully');
            return true;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to refresh modules list: ${error}`);
            return false;
        }
    }

    /**
     * Download bundle with progress tracking
     */
    private async downloadBundle(url: string, progressCallback?: (downloaded: number, total: number) => void): Promise<Buffer> {
        this.logger.info('BUNDLE', `Downloading bundle from: ${url}`);

        return new Promise<Buffer>((resolve, reject) => {
            const https = require('https');
            const http = require('http');

            // Choose protocol based on URL
            const client = url.startsWith('https:') ? https : http;

            const request = client.get(url, {
                headers: {
                    'User-Agent': 'Mu2-CircuitPython-Extension/1.0'
                }
            }, (response: any) => {
                // Handle redirects
                if (response.statusCode === 301 || response.statusCode === 302) {
                    this.logger.info('BUNDLE', `Redirecting to: ${response.headers.location}`);
                    return this.downloadBundle(response.headers.location, progressCallback)
                        .then(resolve)
                        .catch(reject);
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                const totalSize = parseInt(response.headers['content-length'] || '0', 10);
                let downloadedSize = 0;
                const chunks: Buffer[] = [];

                response.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    downloadedSize += chunk.length;

                    if (progressCallback && totalSize > 0) {
                        progressCallback(downloadedSize, totalSize);
                    }
                });

                response.on('end', () => {
                    const buffer = Buffer.concat(chunks);
                    this.logger.info('BUNDLE', `Download completed: ${downloadedSize} bytes`);
                    resolve(buffer);
                });

                response.on('error', (error: Error) => {
                    reject(error);
                });
            });

            request.on('error', (error: Error) => {
                reject(error);
            });

            request.setTimeout(300000, () => { // 5 minute timeout
                request.destroy();
                reject(new Error('Download timeout'));
            });
        });
    }

    /**
     * Add circup-based library management methods
     */
    public async installLibraryWithCircup(libraryName: string, targetPath: string): Promise<boolean> {
        try {
            await this.runCircupCommand(['--path', targetPath, 'install', libraryName]);
            this.logger.info('BUNDLE', `Installed library ${libraryName} to ${targetPath} using circup`);
            return true;
        } catch (error) {
            this.logger.error('BUNDLE', `Failed to install library ${libraryName} with circup: ${error}`);
            return false;
        }
    }

    public async updateLibrariesWithCircup(targetPath: string): Promise<boolean> {
        try {
            await this.runCircupCommand(['--path', targetPath, 'update', '--all']);
            this.logger.info('BUNDLE', `Updated all libraries in ${targetPath} using circup`);
            return true;
        } catch (error) {
            this.logger.error('BUNDLE', `Failed to update libraries with circup: ${error}`);
            return false;
        }
    }

    /**
     * Get available modules list from saved JSON
     */
    public async getAvailableModulesList(): Promise<string[]> {
        if (!this.bundlePath) {
            return [];
        }

        try {
            const modulesJsonPath = vscode.Uri.joinPath(vscode.Uri.file(this.bundlePath), 'ctpyBundleModules.json');
            const content = await vscode.workspace.fs.readFile(modulesJsonPath);
            const data = JSON.parse(new TextDecoder().decode(content));

            return data.modules || [];

        } catch (error) {
            this.logger.warn('BUNDLE', `Could not read modules list, generating fresh list: ${error}`);
            // Fallback: generate fresh modules list
            try {
                return await this.generateModulesList();
            } catch (fallbackError) {
                this.logger.error('BUNDLE', `Failed to generate fallback modules list: ${fallbackError}`);
                return [];
            }
        }
    }

    /**
     * Generate workspace requirements.txt from selected modules
     */
    public async generateWorkspaceRequirements(selectedModules: string[]): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        try {
            const requirementsPath = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
            const content = selectedModules.join('\n') + '\n';
            await vscode.workspace.fs.writeFile(requirementsPath, new TextEncoder().encode(content));

            this.logger.info('BUNDLE', `Generated requirements.txt with ${selectedModules.length} modules`);
            return true;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to generate requirements.txt: ${error}`);
            return false;
        }
    }

    /**
     * Generate requirements.txt from currently installed workspace libraries
     */
    public async generateRequirementsFromWorkspace(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        try {
            const installedLibraries = await this.getWorkspaceLibraries();
            const libraryNames = installedLibraries.map(lib => lib.name);

            if (libraryNames.length === 0) {
                this.logger.info('BUNDLE', 'No libraries installed in workspace, creating empty requirements.txt');
            }

            return await this.generateWorkspaceRequirements(libraryNames);

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to generate requirements.txt from workspace: ${error}`);
            return false;
        }
    }

    /**
     * Check if workspace has a requirements.txt file
     */
    public async hasRequirementsFile(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        try {
            const requirementsPath = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
            await vscode.workspace.fs.stat(requirementsPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Read and parse requirements.txt file
     */
    public async readRequirementsFile(): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            const requirementsPath = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
            const content = await vscode.workspace.fs.readFile(requirementsPath);
            const text = new TextDecoder().decode(content);

            // Parse requirements, filtering out empty lines and comments
            const requirements = text
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.startsWith('#'))
                .sort();

            this.logger.info('BUNDLE', `Read ${requirements.length} requirements from requirements.txt`);
            return requirements;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to read requirements.txt: ${error}`);
            return [];
        }
    }

    /**
     * Install libraries from requirements.txt to workspace lib/ directory
     */
    public async installLibrariesFromRequirements(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        try {
            const hasRequirements = await this.hasRequirementsFile();
            if (!hasRequirements) {
                this.logger.warn('BUNDLE', 'No requirements.txt file found in workspace');
                return false;
            }

            const requirements = await this.readRequirementsFile();
            if (requirements.length === 0) {
                this.logger.info('BUNDLE', 'No requirements to install');
                return true;
            }

            const libPath = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');

            // Ensure lib directory exists
            await vscode.workspace.fs.createDirectory(libPath);

            // Use circup to install from requirements
            const command = `circup install -r requirements.txt --path lib`;
            await this.executeCircupCommand(command, 'Installing Libraries from Requirements');

            this.logger.info('BUNDLE', `Installed ${requirements.length} libraries from requirements.txt to workspace lib/`);
            return true;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to install from requirements: ${error}`);
            return false;
        }
    }

    /**
     * Install from workspace requirements.txt to project lib/
     */
    public async installFromRequirements(): Promise<boolean> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return false;
        }

        try {
            const requirementsPath = vscode.Uri.joinPath(workspaceFolder.uri, 'requirements.txt');
            const libPath = vscode.Uri.joinPath(workspaceFolder.uri, 'lib');

            // Ensure lib directory exists
            await vscode.workspace.fs.createDirectory(libPath);

            // Use circup to install from requirements
            await this.runCircupCommand([
                'install',
                '-r', requirementsPath.fsPath,
                '--path', libPath.fsPath
            ]);

            this.logger.info('BUNDLE', 'Installed libraries from requirements.txt to workspace lib/');
            return true;

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to install from requirements: ${error}`);
            return false;
        }
    }

    /**
     * Get library description from its metadata
     */
    private async getLibraryDescription(libraryPath: string, isDirectory: boolean): Promise<string> {
        try {
            if (isDirectory) {
                // Look for __init__.py or setup.py for description
                const initPath = path.join(libraryPath, '__init__.py');
                try {
                    const initUri = vscode.Uri.file(initPath);
                    const content = await vscode.workspace.fs.readFile(initUri);
                    const text = new TextDecoder().decode(content);

                    // Extract docstring or description
                    const docMatch = text.match(/"""([^"]+)"""/);
                    if (docMatch) {
                        return docMatch[1].trim().split('\n')[0];
                    }
                } catch {
                    // No __init__.py file
                }
                return 'CircuitPython library package';
            } else {
                // Single file library
                const name = path.basename(libraryPath, '.py');
                return `CircuitPython library: ${name}`;
            }
        } catch {
            return 'CircuitPython library';
        }
    }

    /**
     * Copy directory recursively
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
     * Download and install CircuitPython bundle using terminal approach
     */
    public async downloadAndInstallBundle(): Promise<boolean> {
        try {
            return await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Setting up CircuitPython Bundle',
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 10, message: 'Checking circup installation...' });

                // Ensure circup is installed
                await this.ensureCircupInstalled();

                progress.report({ increment: 30, message: 'Discovering available modules...' });

                // Generate modules list using circup
                const modules = await this.generateModulesList();

                progress.report({ increment: 60, message: 'Saving module definitions...' });

                // Save to both persistent storage and internal location
                await this.savePersistentModuleList(modules);
                await this.saveInternalModulesList(modules);

                progress.report({ increment: 80, message: 'Setting up CircuitPython environment...' });

                // Setup CircuitPython environment
                await this.setupCircupEnvironment();

                progress.report({ increment: 100, message: 'Bundle setup complete!' });
                return true;
            });

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to setup CircuitPython bundle: ${error}`);
            vscode.window.showErrorMessage(`Failed to setup CircuitPython bundle: ${error}`);
            return false;
        }
    }

    /**
     * Setup CircuitPython environment using circup via terminal
     */
    private async setupCircupEnvironment(): Promise<void> {
        try {
            // Simply ensure circup is available and updated
            // The terminal profile will handle the Python environment setup
            await this.executeCircupCommand('circup --version', 'Verifying CircuitPython Library Manager');

            this.logger.info('BUNDLE', 'CircuitPython environment setup completed via terminal');

        } catch (error) {
            this.logger.error('BUNDLE', `Failed to setup CircuitPython environment: ${error}`);
            throw error;
        }
    }

    /**
     * Execute circup commands using VS Code TerminalShellExecution API (with output capture)
     */
    private async executeCircupCommand(command: string, description: string): Promise<string> {
        return new Promise(async (resolve, reject) => {
            this.logger.info('BUNDLE', `Executing command: ${command}`);

            try {
                // Create terminal with Mu Two profile for proper Python environment
                const terminal = vscode.window.createTerminal({
                    name: `${description}`,
                    iconPath: new vscode.ThemeIcon('circuit-board'),
                    shellPath: undefined, // Use default shell
                    shellArgs: undefined,
                    env: {
                        ...process.env
                    }
                });

                // Wait for shell integration to be available
                if (!terminal.shellIntegration) {
                    this.logger.warn('BUNDLE', 'Shell integration not available, falling back to sendText approach');
                    terminal.sendText(command);

                    setTimeout(() => {
                        terminal.dispose();
                        resolve('Command executed without shell integration');
                    }, 3000);
                    return;
                }

                // Execute command using shell integration
                const execution = terminal.shellIntegration.executeCommand({ commandLine: command });
                const stream = execution.read();

                let output = '';

                try {
                    // Read all output from the command
                    for await (const data of stream) {
                        output += data;
                    }

                    this.logger.info('BUNDLE', `Command completed successfully`);
                    this.logger.debug('BUNDLE', `Command output: ${output.substring(0, 200)}${output.length > 200 ? '...' : ''}`);

                    terminal.dispose();
                    resolve(output);

                } catch (streamError) {
                    this.logger.error('BUNDLE', `Failed to read command output: ${streamError}`);
                    terminal.dispose();
                    reject(new Error(`Command output reading failed: ${streamError}`));
                }

            } catch (error) {
                this.logger.error('BUNDLE', `Failed to execute command: ${command} - Error: ${error}`);
                reject(new Error(`Terminal command execution failed: ${error}`));
            }
        });
    }

    /**
     * Ensure circup is installed using terminal
     */
    private async ensureCircupInstalled(): Promise<void> {
        this.logger.info('BUNDLE', 'Ensuring circup is installed via terminal...');

        // Use a simple approach: try to install circup
        // The terminal will handle Python environment activation
        await this.executeCircupCommand('pip install circup', 'Installing CircuitPython Library Manager');

        this.logger.info('BUNDLE', 'CircuitPython library manager (circup) installation requested');
    }

    /**
     * Dispose resources
     */
    public dispose(): void {
        // Clean up any resources
    }
}