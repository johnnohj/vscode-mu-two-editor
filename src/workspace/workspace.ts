import * as vscode from "vscode";
import { IDevice } from "../devices/core/deviceDetector";

// Configuration interfaces as per spec
export interface WorkspaceConfig {
    workspace_id: string;
    created_date: string;
    workspace_name: string;
    pending_downloads: PendingDownload[];
}

export interface BoardAssociation {
    board_name: string;
    vid: string;
    pid: string;
    serial_number?: string;
    last_connected: string;
    connection_count: number;
    learn_guide_url?: string;
}

export interface WorkspaceRegistry {
    machine_hash: string;
    next_workspace_id: number;
    version: string;
    lastUpdated: string;
    workspaces: {
        [workspaceId: string]: WorkspaceRegistryEntry;
    };
}
/**
 * Workspace registry entry with URI support for better cross-platform handling
 * Maintains backward compatibility with string paths
 */
export interface WorkspaceRegistryEntry {
    id: string;
    name: string;
    board_name?: string;
    workspace_path: string; // Kept for backward compatibility
    workspace_uri?: string; // New URI-based path storage
    created: string;
    last_accessed: string;
    lastAccessed: string; // Consistent naming
    last_saved_project_uri?: string;
    last_saved_project_name?: string;
    board_vid_pid?: string;
    deviceAssociation?: {
        boardName: string;
        vidPid: string;
        serialNumber?: string;
    };
    files: WorkspaceFiles;
    metadata: {
        projectDirectory?: string;
        hasInitialBackup: boolean;
        version: string;
    };
    // New fields for dual workspace support
    workspace_file?: string; // Path to .code-workspace file in global storage
    workspace_file_uri?: string; // URI to .code-workspace file
    workspace_type?: 'single' | 'dual-root'; // Type of workspace structure
}

export interface PendingDownload {
    type: 'learn_guide';
    url: string;
    filename: string;
    priority: 'high' | 'medium' | 'low';
}

/**
 * Workspace file structure with .files/ directory
 */
export interface WorkspaceFiles {
    workspaceFile: string;      // Path to .code-workspace file
    initialConfig: string;      // Path to initial-config.json
    directory: string;          // Path to .files/ directory
}

export class MuTwoWorkspace {
    private static _instance: MuTwoWorkspace;
    private _context: vscode.ExtensionContext;
    private _machineHash: string | null = null;
    private _sessionId: string;

    private constructor(context: vscode.ExtensionContext) {
        this._context = context;
        // Generate unique session ID for test workspace management
        this._sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    }

    public static getInstance(context: vscode.ExtensionContext): MuTwoWorkspace {
        if (!MuTwoWorkspace._instance) {
            MuTwoWorkspace._instance = new MuTwoWorkspace(context);
        }
        return MuTwoWorkspace._instance;
    }

    /**
     * Get the root path of the current workspace
     */
    static get rootPath(): vscode.Uri | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }

        for (const workspaceFolder of workspaceFolders) {
            const workspaceFolderUri = workspaceFolder.uri;
            // TODO: Check for workspace config file
            return workspaceFolderUri;
        }

        return workspaceFolders[0].uri;
    }

    /**
     * Generate or retrieve machine hash
     */
    public async getMachineHash(): Promise<string> {
        if (this._machineHash) {
            return this._machineHash;
        }

        // Try to get stored hash first
        const storedHash = this._context.globalState.get<string>('muTwo.machineHash');
        if (storedHash) {
            this._machineHash = storedHash;
            return storedHash;
        }

        // Generate new hash using simple string hashing
        const machineId = vscode.env.machineId;
        const hash = this.simpleStringHash(machineId).toString(16).substring(0, 6);
        
        // Store it
        await this._context.globalState.update('muTwo.machineHash', hash);
        this._machineHash = hash;
        
        return hash;
    }

    /**
     * Generate unique workspace ID with special handling for development test mode
     */
    public async generateWorkspaceId(): Promise<string> {
        // Reserve workspace ID '0' for development test mode
        if (this.isDevelopmentMode()) {
            return '0';
        }
        
        const machineHash = await this.getMachineHash();
        const registry = await this.getWorkspaceRegistry();
        
        const workspaceId = `mu-two-workspace-${machineHash}-${registry.next_workspace_id.toString().padStart(3, '0')}`;
        
        // Update registry
        registry.next_workspace_id++;
        registry.lastUpdated = new Date().toISOString();
        await this.saveWorkspaceRegistry(registry);
        
        return workspaceId;
    }

    /**
     * Get workspace registry from global storage
     */
    public async getWorkspaceRegistry(): Promise<WorkspaceRegistry> {
        const storedRegistry = this._context.globalState.get<WorkspaceRegistry>('muTwo.workspaceRegistry');
        
        if (storedRegistry) {
            return storedRegistry;
        }

        // Create new registry
        const machineHash = await this.getMachineHash();
        const newRegistry: WorkspaceRegistry = {
            machine_hash: machineHash,
            next_workspace_id: 1,
            version: '0.0.1',
            lastUpdated: new Date().toISOString(),
            workspaces: {}
        };

        await this.saveWorkspaceRegistry(newRegistry);
        return newRegistry;
    }

    /**
     * Save workspace registry to global storage
     */
    public async saveWorkspaceRegistry(registry: WorkspaceRegistry): Promise<void> {
        await this._context.globalState.update('muTwo.workspaceRegistry', registry);
    }

    /**
     * Find existing workspace for a board
     */
    public async findWorkspaceForBoard(device: IDevice): Promise<WorkspaceRegistryEntry | null> {
        const registry = await this.getWorkspaceRegistry();
        const vidPid = `${device.vendorId}:${device.productId}`;
        
        return Object.values(registry.workspaces).find(ws => ws.board_vid_pid === vidPid) || null;
    }

    /**
     * Check if current workspace is a MuTwo workspace
     */
    public async isMu2Workspace(workspaceUri?: vscode.Uri): Promise<boolean> {
        const targetUri = workspaceUri || MuTwoWorkspace.rootPath;
        if (!targetUri) {
            return false;
        }

        try {
            const mu2ConfigPath = vscode.Uri.joinPath(targetUri, '.vscode', 'mu2', 'workspace-config.json');
            await vscode.workspace.fs.stat(mu2ConfigPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get workspace configuration
     */
    public async getWorkspaceConfig(workspaceUri?: vscode.Uri): Promise<WorkspaceConfig | null> {
        const targetUri = workspaceUri || MuTwoWorkspace.rootPath;
        if (!targetUri) {
            return null;
        }

        try {
            const configPath = vscode.Uri.joinPath(targetUri, '.vscode', 'mu2', 'workspace-config.json');
            const configData = await vscode.workspace.fs.readFile(configPath);
            return JSON.parse(new TextDecoder().decode(configData));
        } catch {
            return null;
        }
    }

    /**
     * Get board association for workspace
     */
    public async getBoardAssociation(workspaceUri?: vscode.Uri): Promise<BoardAssociation | null> {
        const targetUri = workspaceUri || MuTwoWorkspace.rootPath;
        if (!targetUri) {
            return null;
        }

        try {
            const associationPath = vscode.Uri.joinPath(targetUri, '.vscode', 'mu2', 'board-association.json');
            const associationData = await vscode.workspace.fs.readFile(associationPath);
            return JSON.parse(new TextDecoder().decode(associationData));
        } catch {
            return null;
        }
    }
	 // TODO: standardize this method to use workspaceUri; can include string path if needed
    /**
     * Register a new workspace in the global registry with URI support
     * @param workspaceId Unique workspace identifier
     * @param workspacePathOrUri Workspace path (string) or URI object
     * @param boardName Optional board name
     * @param vidPid Optional vendor:product ID
     */
    public async registerWorkspace(
        workspaceId: string, 
        workspacePathOrUri: string | vscode.Uri, 
        boardName?: string, 
        vidPid?: string
    ): Promise<void> {
        const registry = await this.getWorkspaceRegistry();
        
        // Handle both string paths and URI objects
        let workspacePath: string;
        let workspaceUri: string;
        
        if (typeof workspacePathOrUri === 'string') {
            // Legacy string path
            workspacePath = workspacePathOrUri;
            workspaceUri = vscode.Uri.file(workspacePathOrUri).toString();
        } else {
            // Modern URI object
            workspacePath = workspacePathOrUri.fsPath; // For backward compatibility
            workspaceUri = workspacePathOrUri.toString();
        }
        
        const entry: WorkspaceRegistryEntry = {
            id: workspaceId,
            name: boardName || `Workspace ${workspaceId}`,
            board_name: boardName,
            workspace_path: workspacePath, // Maintained for backward compatibility
            workspace_uri: workspaceUri,   // New URI-based storage
            created: new Date().toISOString(),
            last_accessed: new Date().toISOString(),
            lastAccessed: new Date().toISOString(),
            board_vid_pid: vidPid,
            files: {
                workspaceFile: '',
                initialConfig: '',
                directory: ''
            },
            metadata: {
                hasInitialBackup: false,
                version: '1.0.0'
            }
        };

        registry.workspaces[workspaceId] = entry;
        registry.lastUpdated = new Date().toISOString();
        await this.saveWorkspaceRegistry(registry);
    }

    /**
     * Update last accessed time for a workspace
     */
    public async updateWorkspaceAccess(workspaceId: string): Promise<void> {
        const registry = await this.getWorkspaceRegistry();
        const workspace = registry.workspaces[workspaceId];
        
        if (workspace) {
            workspace.last_accessed = new Date().toISOString();
            workspace.lastAccessed = new Date().toISOString();
            
            // Migrate to URI format if needed
            if (!workspace.workspace_uri && workspace.workspace_path) {
                workspace.workspace_uri = vscode.Uri.file(workspace.workspace_path).toString();
            }
            
            registry.lastUpdated = new Date().toISOString();
            await this.saveWorkspaceRegistry(registry);
        }
    }

    /**
     * Migrate existing workspace entries to use URI format
     * This ensures backward compatibility while moving to the new URI-based approach
     */
    public async migrateWorkspacePathsToUris(): Promise<void> {
        const registry = await this.getWorkspaceRegistry();
        let migrationNeeded = false;

        for (const workspace of Object.values(registry.workspaces)) {
            if (!workspace.workspace_uri && workspace.workspace_path) {
                try {
                    workspace.workspace_uri = vscode.Uri.file(workspace.workspace_path).toString();
                    migrationNeeded = true;
                } catch (error) {
                    console.warn(`Failed to migrate workspace path to URI: ${workspace.workspace_path}`, error);
                }
            }
        }

        if (migrationNeeded) {
            registry.lastUpdated = new Date().toISOString();
            await this.saveWorkspaceRegistry(registry);
            console.log('Successfully migrated workspace paths to URI format');
        }
    }

    /**
     * Check if we're in development mode with mu2-test workspace
     */
    public isDevelopmentMode(): boolean {
        const workspaceName = vscode.workspace.name;
        return workspaceName === 'mu2-test' && vscode.env.appName.includes('Visual Studio Code') && 
               (process.env.NODE_ENV === 'development' || vscode.env.machineId === vscode.env.sessionId);
    }

    /**
     * Get session ID for current session (used for test workspace isolation)
     */
    public getSessionId(): string {
        return this._sessionId;
    }


    /**
     * Clean development test workspace files that don't belong to current session
     */
    public async cleanTestWorkspaceFiles(): Promise<void> {
        if (!this.isDevelopmentMode()) {
            return;
        }

        try {
            const testWorkspaceKey = 'mu2.testWorkspace.0';
            const storedData = this._context.globalState.get<any>(testWorkspaceKey);
            
            if (storedData && storedData.sessionId !== this._sessionId) {
                // Clear files from previous session but keep the structure
                const filteredFiles = storedData.files?.filter((file: any) => 
                    file.sessionId === this._sessionId
                ) || [];
                
                await this._context.globalState.update(testWorkspaceKey, {
                    ...storedData,
                    files: filteredFiles,
                    sessionId: this._sessionId,
                    lastCleaned: new Date().toISOString()
                });

                console.log('Cleaned test workspace files from previous session');
            }
        } catch (error) {
            console.warn('Failed to clean test workspace files:', error);
        }
    }

    /**
     * Clear all test workspace data (development-only command)
     */
    public async clearTestWorkspaceData(): Promise<void> {
        if (!this.isDevelopmentMode()) {
            throw new Error('clearTestWorkspaceData can only be called in development mode');
        }

        const testWorkspaceKeys = [
            'mu2.testWorkspace.0',
            'mu2.testWorkspace.files',
            'mu2.testWorkspace.logs'
        ];

        for (const key of testWorkspaceKeys) {
            await this._context.globalState.update(key, undefined);
        }

        console.log('Cleared all test workspace data');
    }

    /**
     * Simple string hashing function for machine ID
     */
    private simpleStringHash(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }
}