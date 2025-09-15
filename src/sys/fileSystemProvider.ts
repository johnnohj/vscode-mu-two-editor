import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Mu Two File System Provider
 * 
 * Base file system provider for embedded development boards in Mu Two Editor.
 * Provides file system access to boards using the 'ctpy://' URI scheme.
 * This is the base class that can be extended for different board types.
 * 
 * URI Format: ctpy://boardId/path/to/file.py
 * Example: ctpy://adafruit-qtpy-rp2040-12345678/code.py
 */
export class MuTwoFileSystemProvider implements vscode.FileSystemProvider {
	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _bufferedEvents: vscode.FileChangeEvent[] = [];
	private _fireSoonHandle?: NodeJS.Timer;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	// Keep track of connected boards and their drive paths
	private boardConnections = new Map<string, string>(); // boardId -> drivePath

	constructor() {
		// Set up periodic cleanup of buffered events
		setInterval(() => this._fireSoon(), 100);
	}

	/**
	 * Register a board connection
	 */
	registerBoard(boardId: string, drivePath: string): void {
		this.boardConnections.set(boardId, drivePath);
	}

	/**
	 * Unregister a board connection
	 */
	unregisterBoard(boardId: string): void {
		this.boardConnections.delete(boardId);
	}

	/**
	 * Check if a board is connected
	 */
	isBoardConnected(boardId: string): boolean {
		return this.boardConnections.has(boardId);
	}

	/**
	 * Get the drive path for a board
	 */
	getBoardDrivePath(boardId: string): string | undefined {
		return this.boardConnections.get(boardId);
	}

	/**
	 * Get all connected board IDs
	 */
	getConnectedBoardIds(): string[] {
		return Array.from(this.boardConnections.keys());
	}

	/**
	 * Parse a board URI to extract board ID and file path
	 */
	private parseUri(uri: vscode.Uri): { boardId: string; filePath: string } {
		// URI format: ctpy://boardId/path/to/file.py
		const boardId = uri.authority;
		const filePath = uri.path;
		
		return { boardId, filePath };
	}

	/**
	 * Convert board URI to local file system path
	 */
	private toLocalPath(uri: vscode.Uri): string {
		const { boardId, filePath } = this.parseUri(uri);
		const drivePath = this.getBoardDrivePath(boardId);
		
		if (!drivePath) {
			throw vscode.FileSystemError.Unavailable(`Board ${boardId} is not connected`);
		}

		return path.join(drivePath, filePath);
	}

	/**
	 * Create a local file URI from board URI
	 */
	private toLocalUri(uri: vscode.Uri): vscode.Uri {
		const localPath = this.toLocalPath(uri);
		return vscode.Uri.file(localPath);
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

	/**
	 * Convert local file URI back to board URI
	 */
	private fromLocalUri(localUri: vscode.Uri): vscode.Uri {
		const localPath = localUri.fsPath;
		
		// Find matching board by checking if local path starts with board's drive path
		for (const [boardId, drivePath] of this.boardConnections) {
			if (localPath.startsWith(drivePath)) {
				const relativePath = path.relative(drivePath, localPath).replace(/\\/g, '/');
				return vscode.Uri.parse(`ctpy://${boardId}/${relativePath}`);
			}
		}
		
		// Fallback - should not happen in normal operation
		throw new Error(`Could not map local path ${localPath} to board URI`);
	}

	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
		const { boardId } = this.parseUri(uri);
		
		if (!this.isBoardConnected(boardId)) {
			throw vscode.FileSystemError.Unavailable(`Board ${boardId} is not connected`);
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
			throw vscode.FileSystemError.Unavailable(`Board ${boardId} is not connected`);
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
			throw vscode.FileSystemError.Unavailable(`Board ${boardId} is not connected`);
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
		const { boardId } = this.parseUri(uri);
		
		if (!this.isBoardConnected(boardId)) {
			throw vscode.FileSystemError.Unavailable(`Board ${boardId} is not connected`);
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
			throw vscode.FileSystemError.Unavailable(`Board ${boardId} is not connected`);
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
		const { boardId } = this.parseUri(uri);
		
		if (!this.isBoardConnected(boardId)) {
			throw vscode.FileSystemError.Unavailable(`Board ${boardId} is not connected`);
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
		const { boardId: oldBoardId } = this.parseUri(oldUri);
		const { boardId: newBoardId } = this.parseUri(newUri);
		
		if (oldBoardId !== newBoardId) {
			throw vscode.FileSystemError.NoPermissions('Cannot rename across different boards');
		}
		
		if (!this.isBoardConnected(oldBoardId)) {
			throw vscode.FileSystemError.Unavailable(`Board ${oldBoardId} is not connected`);
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
		const { boardId: srcBoardId } = this.parseUri(source);
		const { boardId: dstBoardId } = this.parseUri(destination);
		
		if (srcBoardId !== dstBoardId) {
			throw vscode.FileSystemError.NoPermissions('Cannot copy across different boards');
		}
		
		if (!this.isBoardConnected(srcBoardId)) {
			throw vscode.FileSystemError.Unavailable(`Board ${srcBoardId} is not connected`);
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

	// --- Utility Methods ---

	/**
	 * Create a board URI for a board file
	 */
	static createUri(boardId: string, filePath: string): vscode.Uri {
		// Ensure path starts with /
		if (!filePath.startsWith('/')) {
			filePath = '/' + filePath;
		}
		
		return vscode.Uri.parse(`ctpy://${boardId}${filePath}`);
	}

	/**
	 * Check if a URI uses the board scheme
	 */
	static isBoardUri(uri: vscode.Uri): boolean {
		return uri.scheme === 'ctpy';
	}

	/**
	 * Get board ID from a board URI
	 */
	static getBoardId(uri: vscode.Uri): string {
		if (!this.isBoardUri(uri)) {
			throw new Error('URI is not a board URI');
		}
		return uri.authority;
	}

	/**
	 * Get file path from a board URI
	 */
	static getFilePath(uri: vscode.Uri): string {
		if (!this.isBoardUri(uri)) {
			throw new Error('URI is not a board URI');
		}
		return uri.path;
	}

	dispose(): void {
		this._emitter.dispose();
		if (this._fireSoonHandle) {
			clearTimeout(this._fireSoonHandle);
		}
	}
}

// Compatibility export for existing code
export const CircuitPythonFileSystemProvider = MuTwoFileSystemProvider;

/**
 * Scoped CircuitPython File System Provider
 * 
 * Production file system provider that restricts access to specific directories.
 * Only allows access to MuTwoWorkspaces, workspaceStorage, and globalStorage directories.
 * This ensures efficient file detection by keeping the ctpy:// scheme "in its lane".
 */
export class CtpyFileSystemProvider extends MuTwoFileSystemProvider {
	private allowedPaths: Set<string> = new Set();
	
	constructor() {
		super();
	}
	
	/**
	 * Add an allowed directory path
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
	
	// Override all FileSystemProvider operations to validate scope
	
	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat> {
		if (!this.validateAccess(uri)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.stat(uri);
	}
	
	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]> {
		if (!this.validateAccess(uri)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.readDirectory(uri);
	}
	
	createDirectory(uri: vscode.Uri): void | Thenable<void> {
		if (!this.validateAccess(uri)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.createDirectory(uri);
	}
	
	readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array> {
		if (!this.validateAccess(uri)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.readFile(uri);
	}
	
	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void | Thenable<void> {
		if (!this.validateAccess(uri)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.writeFile(uri, content, options);
	}
	
	delete(uri: vscode.Uri, options: { recursive: boolean }): void | Thenable<void> {
		if (!this.validateAccess(uri)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.delete(uri, options);
	}
	
	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
		if (!this.validateAccess(oldUri) || !this.validateAccess(newUri)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.rename(oldUri, newUri, options);
	}
	
	copy?(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): void | Thenable<void> {
		if (!this.validateAccess(source) || !this.validateAccess(destination)) {
			throw vscode.FileSystemError.NoPermissions('Access denied: URI outside allowed directories');
		}
		return super.copy?.(source, destination, options);
	}
	
	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[] }): vscode.Disposable {
		if (!this.validateAccess(uri)) {
			// Return dummy disposable for unauthorized paths
			return new vscode.Disposable(() => {});
		}
		return super.watch(uri, options);
	}
}