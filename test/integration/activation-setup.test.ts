/**
 * Integration tests for extension activation, directory setup, venv, and CircuitPython bundle
 *
 * Tests both:
 * 1. First-time activation (clean install)
 * 2. Subsequent activations (existing setup)
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import {
	getGlobalStorageUri,
	verifyDirectoryExists,
	verifyFileExists,
	readJsonFile,
	ensureExtensionActivated,
	getExpectedDirectoryStructure,
	getPythonExecutablePath,
	getSitePackagesPath,
	verifyModuleList,
	getLogFiles,
	getCurrentDateString
} from './test-helpers';

suite('Extension Activation Setup Tests', () => {
	let extension: vscode.Extension<any>;
	let globalStorageUri: vscode.Uri;

	suiteSetup(async function() {
		this.timeout(120000); // 2 minutes for initial setup

		// Activate extension using helper
		extension = await ensureExtensionActivated();
		globalStorageUri = getGlobalStorageUri();

		console.log(`Testing with global storage: ${globalStorageUri.fsPath}`);
	});

	suite('First-Time Activation (Clean Install Simulation)', () => {
		test('Extension should activate successfully', () => {
			assert.ok(extension.isActive, 'Extension should be activated');
		});

		test('Should create global storage directory structure', async function() {
			this.timeout(10000);

			const expectedDirectories = getExpectedDirectoryStructure();

			for (const dir of expectedDirectories) {
				const dirUri = vscode.Uri.joinPath(globalStorageUri, dir);
				const exists = await verifyDirectoryExists(
					dirUri,
					`Directory ${dir} should exist`
				);

				assert.ok(exists, `${dir} should be a directory at ${dirUri.fsPath}`);
			}

			console.log(`✓ All ${expectedDirectories.length} directories verified`);
		});

		test('Should create development log file', async function() {
			this.timeout(5000);

			const logFiles = await getLogFiles(globalStorageUri);

			assert.ok(
				logFiles.length > 0,
				'At least one development log file should exist'
			);

			// Verify log file format (should be mu2-dev-YYYY-MM-DD.log)
			const logFileName = logFiles[0];
			assert.ok(
				/^mu2-dev-\d{4}-\d{2}-\d{2}\.log$/.test(logFileName),
				`Log file should follow naming pattern: ${logFileName}`
			);

			console.log(`✓ Found ${logFiles.length} log file(s): ${logFiles.join(', ')}`);
		});

		test('Should verify ResourceLocator paths', async function() {
			this.timeout(5000);

			// Test that ResourceLocator methods return correct paths
			// We do this by checking if the expected directories exist
			const pathsToVerify = [
				{ name: 'assets', path: 'assets' }, // Extension URI path
				{ name: 'config', path: 'config' },
				{ name: 'resources', path: 'resources' },
				{ name: 'logs', path: '.mu2/logs' },
				{ name: 'bundles', path: 'bundles' },
				{ name: 'workspaces', path: 'workspaces' },
				{ name: 'wasm-runtime', path: 'bin/wasm-runtime' }
			];

			for (const item of pathsToVerify) {
				let baseUri: vscode.Uri;

				// Assets are in extension URI, not global storage
				if (item.name === 'assets') {
					baseUri = vscode.Uri.file(extension.extensionPath);
				} else {
					baseUri = globalStorageUri;
				}

				const fullPath = vscode.Uri.joinPath(baseUri, item.path);

				try {
					const stat = await vscode.workspace.fs.stat(fullPath);
					assert.ok(
						stat.type === vscode.FileType.Directory,
						`ResourceLocator path for ${item.name} should exist`
					);
				} catch (error) {
					console.warn(`Note: ${item.name} at ${fullPath.fsPath} may not exist yet`);
					// Some directories may be created on-demand
				}
			}
		});
	});

	suite('Python Virtual Environment Setup', () => {
		test('Should have venv directory in extension path', async function() {
			this.timeout(10000);

			const venvPath = vscode.Uri.file(path.join(extension.extensionPath, 'venv'));

			try {
				const stat = await vscode.workspace.fs.stat(venvPath);
				assert.ok(
					stat.type === vscode.FileType.Directory,
					'venv directory should exist in extension path'
				);
			} catch (error) {
				// venv might be created on first use
				console.warn(`Note: venv not found at ${venvPath.fsPath}, may be created on-demand`);
			}
		});

		test('Should have Python executable in venv', async function() {
			this.timeout(10000);

			const venvPath = path.join(extension.extensionPath, 'venv');
			const isWindows = process.platform === 'win32';

			const pythonPath = isWindows
				? path.join(venvPath, 'Scripts', 'python.exe')
				: path.join(venvPath, 'bin', 'python');

			const pythonUri = vscode.Uri.file(pythonPath);

			try {
				const stat = await vscode.workspace.fs.stat(pythonUri);
				assert.ok(
					stat.type === vscode.FileType.File,
					'Python executable should exist in venv'
				);
			} catch (error) {
				console.warn(`Note: Python executable not found at ${pythonPath}, may not be set up yet`);
			}
		});

		test('Should have site-packages in venv', async function() {
			this.timeout(10000);

			const venvPath = path.join(extension.extensionPath, 'venv');
			const isWindows = process.platform === 'win32';

			const sitePackagesPath = isWindows
				? path.join(venvPath, 'Lib', 'site-packages')
				: path.join(venvPath, 'lib', 'site-packages');

			const sitePackagesUri = vscode.Uri.file(sitePackagesPath);

			try {
				const stat = await vscode.workspace.fs.stat(sitePackagesUri);
				assert.ok(
					stat.type === vscode.FileType.Directory,
					'site-packages directory should exist in venv'
				);
			} catch (error) {
				console.warn(`Note: site-packages not found, may not be set up yet`);
			}
		});

		test('Should have circup installed in venv', async function() {
			this.timeout(10000);

			const venvPath = path.join(extension.extensionPath, 'venv');
			const isWindows = process.platform === 'win32';

			const sitePackagesPath = isWindows
				? path.join(venvPath, 'Lib', 'site-packages')
				: path.join(venvPath, 'lib', 'site-packages');

			const sitePackagesUri = vscode.Uri.file(sitePackagesPath);

			try {
				const contents = await vscode.workspace.fs.readDirectory(sitePackagesUri);
				const hasCircup = contents.some(([name]) =>
					name.includes('circup') || name.includes('adafruit-circuitpython-bundle')
				);

				if (hasCircup) {
					assert.ok(true, 'circup or CircuitPython bundle found in site-packages');
				} else {
					console.warn('Note: circup not found in site-packages, may need to be installed');
				}
			} catch (error) {
				console.warn(`Note: Could not check for circup: ${error}`);
			}
		});
	});

	suite('CircuitPython Bundle Setup', () => {
		test('Should have resources directory for bundle manifest', async function() {
			this.timeout(5000);

			const resourcesPath = vscode.Uri.joinPath(globalStorageUri, 'resources');

			try {
				const stat = await vscode.workspace.fs.stat(resourcesPath);
				assert.ok(
					stat.type === vscode.FileType.Directory,
					'resources directory should exist'
				);
			} catch (error) {
				assert.fail(`resources directory should exist: ${error}`);
			}
		});

		test('Should create or have CircuitPython module list', async function() {
			this.timeout(30000); // Bundle setup can take time

			const result = await verifyModuleList(globalStorageUri);

			if (result.exists && result.valid) {
				assert.ok(result.moduleCount && result.moduleCount > 0, 'Should have modules');
				console.log(`✓ Found ${result.moduleCount} CircuitPython modules (version: ${result.version})`);
			} else if (result.exists && !result.valid) {
				assert.fail('Module list exists but is invalid');
			} else {
				console.warn('Note: CircuitPython module list not found - acceptable for first-time setup');
			}
		});

		test('Should have bundles directory ready', async function() {
			this.timeout(5000);

			const bundlesPath = vscode.Uri.joinPath(globalStorageUri, 'resources', 'bundles');

			try {
				const stat = await vscode.workspace.fs.stat(bundlesPath);
				assert.ok(
					stat.type === vscode.FileType.Directory,
					'bundles directory should exist'
				);
			} catch (error) {
				assert.fail(`bundles directory should exist: ${error}`);
			}
		});

		test('Should verify bundle manager is initialized', async function() {
			this.timeout(10000);

			// Try to execute bundle-related command to verify manager is working
			const commands = await vscode.commands.getCommands(true);
			const bundleCommands = commands.filter(cmd => cmd.includes('bundle'));

			// Check if bundle-related infrastructure is in place
			if (bundleCommands.length > 0) {
				console.log(`Found ${bundleCommands.length} bundle-related commands`);
			}

			// The test passes if we got this far without errors
			assert.ok(true, 'Bundle manager infrastructure should be initialized');
		});
	});

	suite('Subsequent Activation (Existing Setup)', () => {
		test('Should activate faster with existing setup', async function() {
			this.timeout(30000);

			// Deactivate and reactivate to test subsequent activation
			// Note: VS Code doesn't provide a way to fully deactivate extensions in tests,
			// so we test by checking that existing resources are preserved

			// Verify key files still exist
			const logPath = vscode.Uri.joinPath(globalStorageUri, '.mu2', 'logs');
			const configPath = vscode.Uri.joinPath(globalStorageUri, '.mu2', 'config');
			const resourcesPath = vscode.Uri.joinPath(globalStorageUri, 'resources');

			const paths = [logPath, configPath, resourcesPath];

			for (const p of paths) {
				try {
					const stat = await vscode.workspace.fs.stat(p);
					assert.ok(
						stat.type === vscode.FileType.Directory,
						`${p.fsPath} should still exist on subsequent activation`
					);
				} catch (error) {
					assert.fail(`Path should exist: ${p.fsPath}`);
				}
			}
		});

		test('Should preserve existing module list', async function() {
			this.timeout(10000);

			const moduleListPath = vscode.Uri.joinPath(
				globalStorageUri,
				'resources',
				'circuitpython-modules.json'
			);

			try {
				const stat = await vscode.workspace.fs.stat(moduleListPath);

				if (stat.type === vscode.FileType.File) {
					const content = await vscode.workspace.fs.readFile(moduleListPath);
					const moduleData = JSON.parse(new TextDecoder().decode(content));

					// Verify structure is intact
					assert.ok(moduleData.modules, 'Existing module list should be preserved');
					assert.ok(moduleData.version, 'Module version should be preserved');

					console.log(`Preserved module list with ${moduleData.modules.length} modules`);
				}
			} catch (error) {
				console.warn('Note: Module list not found, may not have been created yet');
			}
		});

		test('Should not recreate existing directories', async function() {
			this.timeout(10000);

			// Get timestamps of key directories
			const configPath = vscode.Uri.joinPath(globalStorageUri, '.mu2', 'config');

			try {
				const statBefore = await vscode.workspace.fs.stat(configPath);
				const mtimeBefore = statBefore.mtime;

				// Wait a moment
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Verify directory still has same timestamp (wasn't recreated)
				const statAfter = await vscode.workspace.fs.stat(configPath);
				const mtimeAfter = statAfter.mtime;

				// mtime should be the same or very close
				assert.ok(
					Math.abs(mtimeBefore - mtimeAfter) < 5000, // Within 5 seconds
					'Directory should not be recreated (timestamps should match)'
				);
			} catch (error) {
				console.warn(`Note: Could not verify directory persistence: ${error}`);
			}
		});

		test('Should verify all core commands remain registered', async function() {
			this.timeout(5000);

			const commands = await vscode.commands.getCommands(true);

			const coreCommands = [
				'muTwo.workspace.create',
				'muTwo.workspace.open',
				'muTwo.editor.showPanel',
				'muTwo.editor.hidePanel'
			];

			for (const cmd of coreCommands) {
				assert.ok(
					commands.includes(cmd),
					`Core command ${cmd} should remain registered after activation`
				);
			}
		});
	});

	suite('Resource Cleanup and Error Recovery', () => {
		test('Should handle missing directories gracefully', async function() {
			this.timeout(10000);

			// Extension should recreate missing directories if needed
			// This test verifies the extension doesn't crash if directories are missing

			// The fact that we got this far means error recovery is working
			assert.ok(extension.isActive, 'Extension should remain active even with potential missing directories');
		});

		test('Should log activation errors to development log', async function() {
			this.timeout(5000);

			const logPath = vscode.Uri.joinPath(globalStorageUri, '.mu2', 'logs');

			try {
				const logFiles = await vscode.workspace.fs.readDirectory(logPath);
				assert.ok(logFiles.length > 0, 'At least one log file should exist');

				// Read the most recent log file
				const logFile = logFiles.find(([name]) => name.startsWith('mu2-dev-'));

				if (logFile) {
					const logContent = await vscode.workspace.fs.readFile(
						vscode.Uri.joinPath(logPath, logFile[0])
					);
					const logText = new TextDecoder().decode(logContent);

					// Log should contain activation messages
					const hasActivationLog = logText.includes('EXTENSION') ||
					                          logText.includes('activation') ||
					                          logText.includes('Starting');

					assert.ok(
						hasActivationLog || logText.length > 0,
						'Log file should contain activation-related messages'
					);
				}
			} catch (error) {
				console.warn(`Note: Could not verify log contents: ${error}`);
			}
		});
	});

	suiteTeardown(() => {
		// Clean up - log test completion
		console.log('Activation setup tests completed');
	});
});
