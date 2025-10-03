/**
 * Common test helper functions for integration tests
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Get the global storage URI for the extension
 * Gets it from the activated extension's exports
 */
export function getGlobalStorageUri(): vscode.Uri {
	const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
	if (!extension || !extension.isActive) {
		throw new Error('Extension not activated');
	}

	// Get ResourceLocator from extension exports
	const { getResourceLocator } = extension.exports;
	if (!getResourceLocator) {
		throw new Error('getResourceLocator not exported from extension');
	}

	const resourceLocator = getResourceLocator();
	return resourceLocator.getGlobalStorageUri();
}

/**
 * Verify a directory exists
 */
export async function verifyDirectoryExists(
	uri: vscode.Uri,
	errorMessage?: string
): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type === vscode.FileType.Directory;
	} catch {
		if (errorMessage) {
			throw new Error(`${errorMessage}: ${uri.fsPath}`);
		}
		return false;
	}
}

/**
 * Verify a file exists
 */
export async function verifyFileExists(
	uri: vscode.Uri,
	errorMessage?: string
): Promise<boolean> {
	try {
		const stat = await vscode.workspace.fs.stat(uri);
		return stat.type === vscode.FileType.File;
	} catch {
		if (errorMessage) {
			throw new Error(`${errorMessage}: ${uri.fsPath}`);
		}
		return false;
	}
}

/**
 * Read and parse a JSON file
 */
export async function readJsonFile<T = any>(uri: vscode.Uri): Promise<T> {
	const content = await vscode.workspace.fs.readFile(uri);
	return JSON.parse(new TextDecoder().decode(content));
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeoutMs: number = 10000,
	intervalMs: number = 100
): Promise<void> {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		if (await condition()) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, intervalMs));
	}

	throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Get the extension instance
 */
export function getExtension(): vscode.Extension<any> {
	const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
	if (!extension) {
		throw new Error('Extension not found');
	}
	return extension;
}

/**
 * Ensure extension is activated
 */
export async function ensureExtensionActivated(): Promise<vscode.Extension<any>> {
	const extension = getExtension();

	if (!extension.isActive) {
		await extension.activate();
		// Wait for activation to complete
		await new Promise(resolve => setTimeout(resolve, 3000));
	}

	return extension;
}

/**
 * Get expected directory structure for the extension
 */
export function getExpectedDirectoryStructure(): string[] {
	return [
		'.mu2',
		'.mu2/data',
		'.mu2/logs',
		'.mu2/config',
		'bin',
		'resources',
		'resources/bundles',
		'workspaces',
		'workspaces/registry'
	];
}

/**
 * Get platform-specific Python executable path
 */
export function getPythonExecutablePath(venvPath: string): string {
	const isWindows = process.platform === 'win32';
	return isWindows
		? path.join(venvPath, 'Scripts', 'python.exe')
		: path.join(venvPath, 'bin', 'python');
}

/**
 * Get platform-specific site-packages path
 */
export function getSitePackagesPath(venvPath: string): string {
	const isWindows = process.platform === 'win32';
	return isWindows
		? path.join(venvPath, 'Lib', 'site-packages')
		: path.join(venvPath, 'lib', 'site-packages');
}

/**
 * Verify all expected commands are registered
 */
export async function verifyCommandsRegistered(expectedCommands: string[]): Promise<string[]> {
	const allCommands = await vscode.commands.getCommands(true);
	const missing: string[] = [];

	for (const cmd of expectedCommands) {
		if (!allCommands.includes(cmd)) {
			missing.push(cmd);
		}
	}

	return missing;
}

/**
 * Get current date in YYYY-MM-DD format (for log file names)
 */
export function getCurrentDateString(): string {
	return new Date().toISOString().split('T')[0];
}

/**
 * Check if CircuitPython module list exists and is valid
 */
export async function verifyModuleList(globalStorageUri: vscode.Uri): Promise<{
	exists: boolean;
	valid: boolean;
	moduleCount?: number;
	version?: string;
}> {
	const moduleListPath = vscode.Uri.joinPath(
		globalStorageUri,
		'resources',
		'circuitpython-modules.json'
	);

	try {
		const exists = await verifyFileExists(moduleListPath);
		if (!exists) {
			return { exists: false, valid: false };
		}

		const data = await readJsonFile(moduleListPath);

		const valid = !!(
			data.modules &&
			Array.isArray(data.modules) &&
			data.version &&
			data.lastUpdated
		);

		return {
			exists: true,
			valid,
			moduleCount: data.modules?.length,
			version: data.version
		};
	} catch {
		return { exists: false, valid: false };
	}
}

/**
 * Get all log files in the logs directory
 */
export async function getLogFiles(globalStorageUri: vscode.Uri): Promise<string[]> {
	const logsPath = vscode.Uri.joinPath(globalStorageUri, '.mu2', 'logs');

	try {
		const files = await vscode.workspace.fs.readDirectory(logsPath);
		return files
			.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.log'))
			.map(([name]) => name);
	} catch {
		return [];
	}
}

/**
 * Read the most recent log file content
 */
export async function getRecentLogContent(globalStorageUri: vscode.Uri): Promise<string | null> {
	const logFiles = await getLogFiles(globalStorageUri);

	if (logFiles.length === 0) {
		return null;
	}

	// Sort by name (which includes date) to get most recent
	const mostRecent = logFiles.sort().reverse()[0];
	const logPath = vscode.Uri.joinPath(globalStorageUri, '.mu2', 'logs', mostRecent);

	try {
		const content = await vscode.workspace.fs.readFile(logPath);
		return new TextDecoder().decode(content);
	} catch {
		return null;
	}
}
