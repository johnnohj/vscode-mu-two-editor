// src/workspace/filesystem/circuitPythonDeviceProvider.ts
// Specialized file system provider for CircuitPython device files
// Handles ctpy:// scheme specifically for board-connected files

import * as vscode from 'vscode';

/**
 * CircuitPython Device File System Provider
 *
 * Specialized file system provider for CircuitPython device files using the 'ctpy://' URI scheme.
 * This provider is focused specifically on files residing on connected CircuitPython boards.
 *
 * URI Format: ctpy://boardId/path/to/file.py
 * Examples:
 * - ctpy://adafruit-qtpy-rp2040-12345678/code.py
 * - ctpy://raspberry-pi-pico-abcd1234/lib/adafruit_display_text.py
 * - ctpy://adafruit-feather-m4-5678/boot.py
 */
export class CtpyDeviceFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    private _bufferedEvents: vscode.FileChangeEvent[] = [];
    private _fireSoonHandle?: NodeJS.Timer;

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    // Keep track of connected boards and their drive paths
    private boardConnections = new Map<string, string>(); // boardId -> drivePath
    private boardMetadata = new Map<string, BoardMetadata>(); // boardId -> metadata

    constructor() {
        this.setupPeriodicCleanup();
    }

    // --- Board Management ---

    /**
     * Register a CircuitPython board connection
     */
    registerBoard(boardId: string, drivePath: string, metadata?: Partial<BoardMetadata>): void {
        this.boardConnections.set(boardId, drivePath);

        const boardMeta: BoardMetadata = {
            boardId,
            drivePath,
            connectedAt: new Date(),
            boardType: metadata?.boardType || 'unknown',
            version: metadata?.version || 'unknown',
            capabilities: metadata?.capabilities || []
        };

        this.boardMetadata.set(boardId, boardMeta);
    }

    /**
     * Unregister a CircuitPython board connection
     */
    unregisterBoard(boardId: string): void {
        this.boardConnections.delete(boardId);
        this.boardMetadata.delete(boardId);
    }

    /**
     * Check if a CircuitPython board is connected
     */
    isBoardConnected(boardId: string): boolean {
        return this.boardConnections.has(boardId);
    }

    /**
     * Get the drive path for a CircuitPython board
     */
    getBoardDrivePath(boardId: string): string | undefined {
        return this.boardConnections.get(boardId);
    }

    /**
     * Get board metadata
     */
    getBoardMetadata(boardId: string): BoardMetadata | undefined {
        return this.boardMetadata.get(boardId);
    }

    /**
     * Get all connected CircuitPython board IDs
     */
    getConnectedBoardIds(): string[] {
        return Array.from(this.boardConnections.keys());
    }

    /**
     * Get all connected boards with metadata
     */
    getConnectedBoards(): BoardMetadata[] {
        return Array.from(this.boardMetadata.values());
    }

    // --- URI Parsing and Path Handling ---

    /**
     * Parse a CircuitPython device URI to extract board ID and file path
     */
    private parseUri(uri: vscode.Uri): { boardId: string; filePath: string } {
        if (uri.scheme !== 'ctpy') {
            throw new Error(`Invalid scheme: expected 'ctpy', got '${uri.scheme}'`);
        }

        // URI format: ctpy://boardId/path/to/file.py
        const boardId = uri.authority;
        const filePath = uri.path;

        if (!boardId) {
            throw new Error(`Invalid ctpy URI: missing board ID in ${uri.toString()}`);
        }

        return { boardId, filePath };
    }

    /**
     * Convert CircuitPython device URI to local file system path
     */
    private toLocalPath(uri: vscode.Uri): string {
        const { boardId, filePath } = this.parseUri(uri);
        const drivePath = this.getBoardDrivePath(boardId);

        if (!drivePath) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${boardId} is not connected`);
        }

        // Use VS Code URI API for cross-platform path handling
        return vscode.Uri.joinPath(vscode.Uri.file(drivePath), filePath).fsPath;
    }

    /**
     * Create a local file URI from CircuitPython device URI
     */
    private toLocalUri(uri: vscode.Uri): vscode.Uri {
        const localPath = this.toLocalPath(uri);
        return vscode.Uri.file(localPath);
    }

    /**
     * Convert local file URI back to CircuitPython device URI
     */
    private fromLocalUri(localUri: vscode.Uri): vscode.Uri {
        const localPath = localUri.fsPath;

        // Find matching board by checking if local path starts with board's drive path
        for (const [boardId, drivePath] of this.boardConnections) {
            if (localPath.startsWith(drivePath)) {
                const driveUri = vscode.Uri.file(drivePath);
                const relativePath = vscode.workspace.asRelativePath(localUri, false).replace(/\\/g, '/');
                return vscode.Uri.parse(`ctpy://${boardId}/${relativePath}`);
            }
        }

        // Fallback - should not happen in normal operation
        throw new Error(`Could not map local path ${localPath} to CircuitPython device URI`);
    }

    // --- FileSystemProvider Implementation ---

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
        const { boardId } = this.parseUri(uri);

        if (!this.isBoardConnected(boardId)) {
            // Return dummy disposable for disconnected boards
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
        const { boardId } = this.parseUri(uri);

        if (!this.isBoardConnected(boardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${boardId} is not connected`);
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
        const { boardId } = this.parseUri(uri);

        if (!this.isBoardConnected(boardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${boardId} is not connected`);
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
        const { boardId } = this.parseUri(uri);

        if (!this.isBoardConnected(boardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${boardId} is not connected`);
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
            throw vscode.FileSystemError.NoPermissions(`Could not create directory on CircuitPython board: ${error}`);
        }
    }

    readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
        const { boardId } = this.parseUri(uri);

        if (!this.isBoardConnected(boardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${boardId} is not connected`);
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
        const { boardId } = this.parseUri(uri);

        if (!this.isBoardConnected(boardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${boardId} is not connected`);
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
            throw vscode.FileSystemError.NoPermissions(`Could not write file to CircuitPython board: ${error}`);
        }
    }

    delete(uri: vscode.Uri, options: { recursive: boolean }): void | Thenable<void> {
        const { boardId } = this.parseUri(uri);

        if (!this.isBoardConnected(boardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${boardId} is not connected`);
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
            throw vscode.FileSystemError.NoPermissions(`Could not delete from CircuitPython board: ${error}`);
        }
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
        const { boardId: oldBoardId } = this.parseUri(oldUri);
        const { boardId: newBoardId } = this.parseUri(newUri);

        if (oldBoardId !== newBoardId) {
            throw vscode.FileSystemError.NoPermissions('Cannot rename across different CircuitPython boards');
        }

        if (!this.isBoardConnected(oldBoardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${oldBoardId} is not connected`);
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
            throw vscode.FileSystemError.NoPermissions(`Could not rename on CircuitPython board: ${error}`);
        }
    }

    copy?(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
        const { boardId: srcBoardId } = this.parseUri(source);
        const { boardId: dstBoardId } = this.parseUri(destination);

        if (srcBoardId !== dstBoardId) {
            throw vscode.FileSystemError.NoPermissions('Cannot copy across different CircuitPython boards');
        }

        if (!this.isBoardConnected(srcBoardId)) {
            throw vscode.FileSystemError.Unavailable(`CircuitPython board ${srcBoardId} is not connected`);
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
            throw vscode.FileSystemError.NoPermissions(`Could not copy on CircuitPython board: ${error}`);
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
     * Create a CircuitPython device URI for a board file
     */
    static createUri(boardId: string, filePath: string): vscode.Uri {
        // Ensure path starts with /
        if (!filePath.startsWith('/')) {
            filePath = '/' + filePath;
        }

        return vscode.Uri.parse(`ctpy://${boardId}${filePath}`);
    }

    /**
     * Check if a URI uses the CircuitPython device scheme
     */
    static isCircuitPythonDeviceUri(uri: vscode.Uri): boolean {
        return uri.scheme === 'ctpy';
    }

    /**
     * Get board ID from a CircuitPython device URI
     */
    static getBoardId(uri: vscode.Uri): string {
        if (!this.isCircuitPythonDeviceUri(uri)) {
            throw new Error('URI is not a CircuitPython device URI');
        }
        return uri.authority;
    }

    /**
     * Get file path from a CircuitPython device URI
     */
    static getFilePath(uri: vscode.Uri): string {
        if (!this.isCircuitPythonDeviceUri(uri)) {
            throw new Error('URI is not a CircuitPython device URI');
        }
        return uri.path;
    }

    /**
     * Helper to create common CircuitPython file URIs
     */
    static createCodeUri(boardId: string): vscode.Uri {
        return this.createUri(boardId, '/code.py');
    }

    static createBootUri(boardId: string): vscode.Uri {
        return this.createUri(boardId, '/boot.py');
    }

    static createLibUri(boardId: string, libFile: string): vscode.Uri {
        return this.createUri(boardId, `/lib/${libFile}`);
    }

    dispose(): void {
        this._emitter.dispose();
        if (this._fireSoonHandle) {
            clearTimeout(this._fireSoonHandle);
        }
    }
}

// --- Supporting Types ---

export interface BoardMetadata {
    boardId: string;
    drivePath: string;
    connectedAt: Date;
    boardType: string;
    version: string;
    capabilities: string[];
}

// Backward compatibility export
