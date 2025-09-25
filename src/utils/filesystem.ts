import * as vscode from 'vscode';
import { CircuitPythonFileSystemProvider } from '../workspace/filesystem/fileSystemProvider';

/**
 * Utility functions for working with CircuitPython file system URIs
 */
export class FileSystemHelpers {
	
	/**
	 * Create a CircuitPython URI for Monaco editor
	 */
	static createCircuitPythonUri(boardId: string, filePath: string): vscode.Uri {
		return CircuitPythonFileSystemProvider.createUri(boardId, filePath);
	}

	/**
	 * Check if a URI is a CircuitPython URI
	 */
	static isCircuitPythonUri(uri: vscode.Uri): boolean {
		return CircuitPythonFileSystemProvider.isCircuitPythonUri(uri);
	}

	/**
	 * Open a CircuitPython file in Monaco editor
	 */
	static async openCircuitPythonFile(boardId: string, filePath: string): Promise<vscode.TextEditor | undefined> {
		const uri = this.createCircuitPythonUri(boardId, filePath);
		
		try {
			const document = await vscode.workspace.openTextDocument(uri);
			return await vscode.window.showTextDocument(document);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to open CircuitPython file: ${error}`);
			return undefined;
		}
	}

	/**
	 * Create a new CircuitPython file
	 */
	static async createCircuitPythonFile(boardId: string, filePath: string, content: string = ''): Promise<vscode.TextEditor | undefined> {
		const uri = this.createCircuitPythonUri(boardId, filePath);
		
		try {
			// Create the file with initial content
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
			
			// Open the newly created file
			const document = await vscode.workspace.openTextDocument(uri);
			return await vscode.window.showTextDocument(document);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to create CircuitPython file: ${error}`);
			return undefined;
		}
	}

	/**
	 * Save content to a CircuitPython file
	 */
	static async saveCircuitPythonFile(boardId: string, filePath: string, content: string): Promise<boolean> {
		const uri = this.createCircuitPythonUri(boardId, filePath);
		
		try {
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
			return true;
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to save CircuitPython file: ${error}`);
			return false;
		}
	}

	/**
	 * Read content from a CircuitPython file
	 */
	static async readCircuitPythonFile(boardId: string, filePath: string): Promise<string | null> {
		const uri = this.createCircuitPythonUri(boardId, filePath);
		
		try {
			const content = await vscode.workspace.fs.readFile(uri);
			return content.toString();
		} catch (error) {
			console.error(`Failed to read CircuitPython file: ${error}`);
			return null;
		}
	}

	/**
	 * Check if a CircuitPython file exists
	 */
	static async circuitPythonFileExists(boardId: string, filePath: string): Promise<boolean> {
		const uri = this.createCircuitPythonUri(boardId, filePath);
		
		try {
			await vscode.workspace.fs.stat(uri);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * List files in a CircuitPython directory
	 */
	static async listCircuitPythonDirectory(boardId: string, dirPath: string = '/'): Promise<{ name: string; type: vscode.FileType }[]> {
		const uri = this.createCircuitPythonUri(boardId, dirPath);
		
		try {
			const entries = await vscode.workspace.fs.readDirectory(uri);
			return entries.map(([name, type]) => ({ name, type }));
		} catch (error) {
			console.error(`Failed to list CircuitPython directory: ${error}`);
			return [];
		}
	}

	/**
	 * Delete a CircuitPython file
	 */
	static async deleteCircuitPythonFile(boardId: string, filePath: string): Promise<boolean> {
		const uri = this.createCircuitPythonUri(boardId, filePath);
		
		try {
			await vscode.workspace.fs.delete(uri);
			return true;
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to delete CircuitPython file: ${error}`);
			return false;
		}
	}

	/**
	 * Copy a file from local filesystem to CircuitPython
	 */
	static async copyToCircuitPython(localUri: vscode.Uri, boardId: string, targetPath: string): Promise<boolean> {
		const targetUri = this.createCircuitPythonUri(boardId, targetPath);
		
		try {
			const content = await vscode.workspace.fs.readFile(localUri);
			await vscode.workspace.fs.writeFile(targetUri, content);
			return true;
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to copy file to CircuitPython: ${error}`);
			return false;
		}
	}

	/**
	 * Copy a file from CircuitPython to local filesystem
	 */
	static async copyFromCircuitPython(boardId: string, sourcePath: string, localUri: vscode.Uri): Promise<boolean> {
		const sourceUri = this.createCircuitPythonUri(boardId, sourcePath);
		
		try {
			const content = await vscode.workspace.fs.readFile(sourceUri);
			await vscode.workspace.fs.writeFile(localUri, content);
			return true;
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to copy file from CircuitPython: ${error}`);
			return false;
		}
	}

	/**
	 * Get the file extension for a path
	 */
	static getFileExtension(filePath: string): string {
		const lastDot = filePath.lastIndexOf('.');
		return lastDot === -1 ? '' : filePath.substring(lastDot);
	}

	/**
	 * Get the file name without extension
	 */
	static getFileNameWithoutExtension(filePath: string): string {
		const fileName = filePath.split('/').pop() || filePath;
		const lastDot = fileName.lastIndexOf('.');
		return lastDot === -1 ? fileName : fileName.substring(0, lastDot);
	}

	/**
	 * Join path segments
	 */
	static joinPath(...segments: string[]): string {
		return segments
			.map(segment => segment.replace(/^\/+|\/+$/g, ''))
			.filter(segment => segment.length > 0)
			.join('/');
	}

	/**
	 * Normalize a path (ensure it starts with /)
	 */
	static normalizePath(path: string): string {
		if (!path.startsWith('/')) {
			path = '/' + path;
		}
		return path;
	}

	/**
	 * Get parent directory path
	 */
	static getParentPath(filePath: string): string {
		const normalizedPath = this.normalizePath(filePath);
		const segments = normalizedPath.split('/').filter(s => s.length > 0);
		
		if (segments.length <= 1) {
			return '/';
		}
		
		return '/' + segments.slice(0, -1).join('/');
	}

	/**
	 * Get file name from path
	 */
	static getFileName(filePath: string): string {
		return filePath.split('/').pop() || filePath;
	}

	/**
	 * Check if path is a Python file
	 */
	static isPythonFile(filePath: string): boolean {
		const ext = this.getFileExtension(filePath).toLowerCase();
		return ext === '.py' || ext === '.pyi';
	}

	/**
	 * Check if path is a CircuitPython main file
	 */
	static isMainFile(filePath: string): boolean {
		const fileName = this.getFileName(filePath).toLowerCase();
		return fileName === 'code.py' || fileName === 'main.py' || fileName === 'boot.py';
	}
}