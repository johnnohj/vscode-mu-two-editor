// src/workspace/filesystem/muTwoFileSystemProvider.ts
// General-purpose file system provider for Mu Two Editor
// Handles mutwo:// scheme for extension-managed files and directories

import * as vscode from 'vscode';

/**
 * Mu Two File System Provider
 *
 * General-purpose file system provider for Mu Two Editor using the 'mutwo://' URI scheme.
 * Handles extension configuration, temporary files, cache, and workspace management.
 *
 * URI Format: mutwo://category/path/to/file
 * Examples:
 * - mutwo://config/settings.json - Extension settings
 * - mutwo://temp/workspace-123/main.py - Temporary workspace files
 * - mutwo://cache/device-database.json - Cached device information
 * - mutwo://logs/activation.log - Extension logs
 */
export class MuTwoFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timer;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    // Base directory mappings for different categories
    private categoryMappings = new Map<string, vscode.Uri>();
    private allowedPaths = new Set<string>();

    constructor(private context: vscode.ExtensionContext) {
        this.setupCategoryMappings();
        this.setupPeriodicCleanup();
    }

    /**
     * Set up default category mappings to local directories
     */
    private setupCategoryMappings(): void {
        const globalStorage = this.context.globalStorageUri;
        const workspaceStorage = this.context.storageUri;

        // Map categories to actual directories
        this.categoryMappings.set('config', vscode.Uri.joinPath(globalStorage, 'config'));
        this.categoryMappings.set('cache', vscode.Uri.joinPath(globalStorage, 'cache'));
        this.categoryMappings.set('logs', vscode.Uri.joinPath(globalStorage, '.mu2', 'logs'));
        this.categoryMappings.set('data', vscode.Uri.joinPath(globalStorage, '.mu2', 'data'));
        this.categoryMappings.set('resources', vscode.Uri.joinPath(globalStorage, 'resources'));

        if (workspaceStorage) {
            this.categoryMappings.set('temp', vscode.Uri.joinPath(workspaceStorage, 'temp'));
            this.categoryMappings.set('workspace', workspaceStorage);
        }

        // Add all mapped directories as allowed paths
        for (const uri of this.categoryMappings.values()) {
            this.allowedPaths.add(uri.fsPath);
        }
    }

    /**
     * Add an allowed directory path for scoped access
     */
    addAllowedPath(path: string): void {
        if (path) {
            this.allowedPaths.add(path);
        }
    }

    /**
     * Remove an allowed directory path
     */
    removeAllowedPath(path: string): void {
        this.allowedPaths.delete(path);
    }

    /**
     * Get all allowed paths
     */
    getAllowedPaths(): string[] {
        return Array.from(this.allowedPaths);
    }

    /**
     * Parse a mutwo URI to extract category and file path
     */
    private parseUri(uri: vscode.Uri): { category: string; filePath: string } {
        // URI format: mutwo://category/path/to/file
        const category = uri.authority;
        const filePath = uri.path;

        if (!category) {
            throw new Error(`Invalid mutwo URI: missing category in ${uri.toString()}`);
        }

        return { category, filePath };
    }

    /**
     * Convert mutwo URI to local file system path
     */
    private toLocalPath(uri: vscode.Uri): string {
        const { category, filePath } = this.parseUri(uri);
        const categoryBase = this.categoryMappings.get(category);

        if (!categoryBase) {
            throw vscode.FileSystemError.FileNotFound(`Unknown category: ${category}`);
        }

        // Join category base with file path
        const localUri = vscode.Uri.joinPath(categoryBase, filePath);
        return localUri.fsPath;
    }

    /**
     * Convert mutwo URI to local file URI
     */
    private toLocalUri(uri: vscode.Uri): vscode.Uri {
        const localPath = this.toLocalPath(uri);
        return vscode.Uri.file(localPath);
    }

    /**
     * Check if access to a URI is allowed based on directory restrictions
     */
    private validateAccess(uri: vscode.Uri): boolean {
        try {
            const localPath = this.toLocalPath(uri);

            // Check if this URI maps to an allowed directory
            for (const allowedPath of this.allowedPaths) {
                if (localPath.startsWith(allowedPath)) {
                    return true;
                }
            }

            return false;
        } catch {
            // If we can't resolve the path, deny access
            return false;
        }
    }

    /**
     * Convert local file URI back to mutwo URI
     */
    private fromLocalUri(localUri: vscode.Uri): vscode.Uri {
        const localPath = localUri.fsPath;

        // Find matching category by checking if local path starts with category's base path
        for (const [category, baseUri] of this.categoryMappings) {
            const basePath = baseUri.fsPath;
            if (localPath.startsWith(basePath)) {
                // Calculate relative path from category base
                const relativePath = localPath.substring(basePath.length).replace(/\\/g, '/');
                return vscode.Uri.parse(`mutwo://${category}${relativePath}`);
            }
        }

        // Fallback - should not happen in normal operation
        throw new Error(`Could not map local path ${localPath} to mutwo URI`);
    }

    // --- FileSystemProvider Implementation ---

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        if (!this.validateAccess(uri)) {
            // Return dummy disposable for unauthorized paths
            return new vscode.Disposable(() => {});
        }

        try {
            const localUri = this.toLocalUri(uri);
            const watcher = vscode.workspace.fs.watch(localUri, options);

            // Forward events with original URI
            const subscription = vscode.workspace.fs.onDidChangeFile((events) => {
                const filteredEvents = events
                    .filter(event => event.uri.toString().startsWith(localUri.toString()))
                    .map(event => ({
                        type: event.type,
                        uri: this.fromLocalUri(event.uri)
                    }));

                if (filteredEvents.length > 0) {
                    this._fireSoon(...filteredEvents);
                }
            });

            return new vscode.Disposable(() => {
                watcher.dispose();
                subscription.dispose();
            });
        } catch (error) {
            // Return dummy disposable if watch setup fails
            return new vscode.Disposable(() => {});
        }
    }

    stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
        if (!this.validateAccess(uri)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const localUri = this.toLocalUri(uri);
            return vscode.workspace.fs.stat(localUri);
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
        if (!this.validateAccess(uri)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const localUri = this.toLocalUri(uri);
            return vscode.workspace.fs.readDirectory(localUri);
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    createDirectory(uri: vscode.Uri): void | Thenable<void> {
        if (!this.validateAccess(uri)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const localUri = this.toLocalUri(uri);
            return vscode.workspace.fs.createDirectory(localUri).then(() => {
                this._fireSoon({ type: vscode.FileChangeType.Created, uri });
            });
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.NoPermissions(`Could not create directory: ${error}`);
        }
    }

    readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        if (!this.validateAccess(uri)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const localUri = this.toLocalUri(uri);
            return vscode.workspace.fs.readFile(localUri);
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void | Thenable<void> {
        if (!this.validateAccess(uri)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const localUri = this.toLocalUri(uri);

            return vscode.workspace.fs.writeFile(localUri, content, options).then(() => {
                this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
            });
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.NoPermissions(`Could not write file: ${error}`);
        }
    }

    delete(uri: vscode.Uri, options: { recursive: boolean }): void | Thenable<void> {
        if (!this.validateAccess(uri)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const localUri = this.toLocalUri(uri);

            return vscode.workspace.fs.delete(localUri, options).then(() => {
                this._fireSoon({ type: vscode.FileChangeType.Deleted, uri });
            });
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.NoPermissions(`Could not delete: ${error}`);
        }
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
        if (!this.validateAccess(oldUri) || !this.validateAccess(newUri)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const oldLocalUri = this.toLocalUri(oldUri);
            const newLocalUri = this.toLocalUri(newUri);

            return vscode.workspace.fs.rename(oldLocalUri, newLocalUri, options).then(() => {
                this._fireSoon(
                    { type: vscode.FileChangeType.Deleted, uri: oldUri },
                    { type: vscode.FileChangeType.Created, uri: newUri }
                );
            });
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.NoPermissions(`Could not rename: ${error}`);
        }
    }

    copy?(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
        if (!this.validateAccess(source) || !this.validateAccess(destination)) {
            throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
        }

        try {
            const srcLocalUri = this.toLocalUri(source);
            const dstLocalUri = this.toLocalUri(destination);

            return vscode.workspace.fs.copy(srcLocalUri, dstLocalUri, options).then(() => {
                this._fireSoon({ type: vscode.FileChangeType.Created, uri: destination });
            });
        } catch (error) {
            if (error instanceof vscode.FileSystemError) {
                throw error;
            }
            throw vscode.FileSystemError.NoPermissions(`Could not copy: ${error}`);
        }
    }

    // --- Event Management ---

    private _fireSoon(...events: vscode.FileChangeEvent[]): void {
        this._bufferedEvents.push(...events);

        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }

        this._fireSoonHandle = setTimeout(() => {
            this._emitter.fire(this._bufferedEvents);
            this._bufferedEvents.length = 0;
        }, 5);
    }

    /**
     * Set up periodic cleanup of buffered events
     */
    private setupPeriodicCleanup(): void {
        setInterval(() => {
            if (this._bufferedEvents.length > 0) {
                this._fireSoon();
            }
        }, 100);
    }

    // --- Utility Methods ---

    /**
     * Create a mutwo URI for an extension-managed file
     */
    static createUri(category: string, filePath: string): vscode.Uri {
        // Ensure path starts with /
        if (!filePath.startsWith('/')) {
            filePath = '/' + filePath;
        }

        return vscode.Uri.parse(`mutwo://${category}${filePath}`);
    }

    /**
     * Check if a URI uses the mutwo scheme
     */
    static isMuTwoUri(uri: vscode.Uri): boolean {
        return uri.scheme === 'mutwo';
    }

    /**
     * Get category from a mutwo URI
     */
    static getCategory(uri: vscode.Uri): string {
        if (!this.isMuTwoUri(uri)) {
            throw new Error('URI is not a mutwo URI');
        }
        return uri.authority;
    }

    /**
     * Get file path from a mutwo URI
     */
    static getFilePath(uri: vscode.Uri): string {
        if (!this.isMuTwoUri(uri)) {
            throw new Error('URI is not a mutwo URI');
        }
        return uri.path;
    }

    /**
     * Helper to create common URI types
     */
    static createConfigUri(fileName: string): vscode.Uri {
        return this.createUri('config', fileName);
    }

    static createCacheUri(fileName: string): vscode.Uri {
        return this.createUri('cache', fileName);
    }

    static createLogUri(fileName: string): vscode.Uri {
        return this.createUri('logs', fileName);
    }

    static createTempUri(fileName: string): vscode.Uri {
        return this.createUri('temp', fileName);
    }

    dispose(): void {
        this._emitter.dispose();
        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }
    }
}