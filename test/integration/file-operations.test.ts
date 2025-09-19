import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

describe('Integration Tests - Real File Operations', () => {
	let testWorkspaceUri: vscode.Uri;
	let testProjectsUri: vscode.Uri;
	let testDeviceUri: vscode.Uri;
	let tempDir: string;

	beforeEach(async () => {
		// Create temporary directory for test workspace
		tempDir = path.join(os.tmpdir(), 'mu-two-test-' + Date.now());
		testWorkspaceUri = vscode.Uri.file(tempDir);
		testProjectsUri = vscode.Uri.joinPath(testWorkspaceUri, 'projects');
		testDeviceUri = vscode.Uri.joinPath(testWorkspaceUri, 'ctpy-device');

		// Create test workspace structure
		await vscode.workspace.fs.createDirectory(testWorkspaceUri);
		await vscode.workspace.fs.createDirectory(testProjectsUri);
		await vscode.workspace.fs.createDirectory(testDeviceUri);
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(testDeviceUri, 'current'));
	});

	afterEach(async () => {
		// Clean up test files
		try {
			await vscode.workspace.fs.delete(testWorkspaceUri, { recursive: true });
		} catch (error) {
			console.warn('Failed to clean up test directory:', error);
		}
	});

	describe('Basic File Operations', () => {
		it('should create and write CircuitPython files to correct locations', async () => {
			// Test creating code.py in projects directory
			const projectName = 'test-led-project';
			const projectUri = vscode.Uri.joinPath(testProjectsUri, projectName);
			await vscode.workspace.fs.createDirectory(projectUri);

			const codeFileUri = vscode.Uri.joinPath(projectUri, 'code.py');
			const circuitPythonCode = `# CircuitPython LED Blink Test
import board
import digitalio
import time

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

while True:
    led.value = True
    time.sleep(1)
    led.value = False
    time.sleep(1)
`;

			// Write file using VS Code filesystem API
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(codeFileUri, encoder.encode(circuitPythonCode));

			// Verify file was created and has correct content
			const fileStats = await vscode.workspace.fs.stat(codeFileUri);
			assert.ok(fileStats.type === vscode.FileType.File, 'File should be created as a file type');
			assert.ok(fileStats.size > 0, 'File should have content');

			// Read and verify content
			const fileContent = await vscode.workspace.fs.readFile(codeFileUri);
			const decoder = new TextDecoder();
			const readContent = decoder.decode(fileContent);

			assert.ok(readContent.includes('import board'), 'Should contain CircuitPython imports');
			assert.ok(readContent.includes('digitalio.DigitalInOut'), 'Should contain CircuitPython API calls');
			assert.strictEqual(readContent, circuitPythonCode, 'Content should match exactly');
		});

		it('should create boot.py and settings.toml files', async () => {
			const projectName = 'test-config-project';
			const projectUri = vscode.Uri.joinPath(testProjectsUri, projectName);
			await vscode.workspace.fs.createDirectory(projectUri);

			// Create boot.py
			const bootFileUri = vscode.Uri.joinPath(projectUri, 'boot.py');
			const bootContent = `# Boot configuration for CircuitPython
# This file is executed when the board starts up
import storage
import usb_cdc

# Disable USB mass storage
storage.disable_usb_drive()

# Enable USB CDC (serial communication)
usb_cdc.enable(console=True, data=True)
`;

			// Create settings.toml
			const settingsFileUri = vscode.Uri.joinPath(projectUri, 'settings.toml');
			const settingsContent = `# CircuitPython device settings
CIRCUITPY_WEB_API_PASSWORD = "mu2-test-password"
CIRCUITPY_WEB_API_PORT = 80
CIRCUITPY_WIFI_SSID = "Test-Network"
CIRCUITPY_WIFI_PASSWORD = "test-password"
`;

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(bootFileUri, encoder.encode(bootContent));
			await vscode.workspace.fs.writeFile(settingsFileUri, encoder.encode(settingsContent));

			// Verify both files exist and have correct content
			const bootStats = await vscode.workspace.fs.stat(bootFileUri);
			const settingsStats = await vscode.workspace.fs.stat(settingsFileUri);

			assert.ok(bootStats.type === vscode.FileType.File, 'boot.py should be created');
			assert.ok(settingsStats.type === vscode.FileType.File, 'settings.toml should be created');

			// Verify content
			const decoder = new TextDecoder();
			const bootRead = decoder.decode(await vscode.workspace.fs.readFile(bootFileUri));
			const settingsRead = decoder.decode(await vscode.workspace.fs.readFile(settingsFileUri));

			assert.ok(bootRead.includes('storage.disable_usb_drive()'), 'boot.py should contain storage configuration');
			assert.ok(settingsRead.includes('CIRCUITPY_WEB_API_PASSWORD'), 'settings.toml should contain web API settings');
		});

		it('should create and manage lib directory with CircuitPython libraries', async () => {
			const projectName = 'test-library-project';
			const projectUri = vscode.Uri.joinPath(testProjectsUri, projectName);
			const libUri = vscode.Uri.joinPath(projectUri, 'lib');

			await vscode.workspace.fs.createDirectory(projectUri);
			await vscode.workspace.fs.createDirectory(libUri);

			// Create a mock Adafruit library file
			const adafruitLibUri = vscode.Uri.joinPath(libUri, 'adafruit_dht.py');
			const libraryContent = `# Mock Adafruit DHT library for testing
"""
CircuitPython driver for DHT temperature and humidity sensors
"""

import time
import digitalio
from micropython import const

class DHT22:
    def __init__(self, pin):
        self._pin = pin
        self._temperature = None
        self._humidity = None

    @property
    def temperature(self):
        return self._temperature

    @property
    def humidity(self):
        return self._humidity

    def measure(self):
        # Mock measurement
        self._temperature = 22.5
        self._humidity = 45.0
`;

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(adafruitLibUri, encoder.encode(libraryContent));

			// Verify library structure
			const libStats = await vscode.workspace.fs.stat(libUri);
			assert.ok(libStats.type === vscode.FileType.Directory, 'lib directory should exist');

			const libraryStats = await vscode.workspace.fs.stat(adafruitLibUri);
			assert.ok(libraryStats.type === vscode.FileType.File, 'Library file should be created');

			// List files in lib directory
			const libContents = await vscode.workspace.fs.readDirectory(libUri);
			const libraryFiles = libContents.filter(([name, type]) =>
				type === vscode.FileType.File && name.endsWith('.py')
			);

			assert.strictEqual(libraryFiles.length, 1, 'Should have one Python library file');
			assert.strictEqual(libraryFiles[0][0], 'adafruit_dht.py', 'Should have correct library name');
		});
	});

	describe('Device Synchronization Operations', () => {
		it('should copy files from project to device directory', async () => {
			// Create project structure
			const projectName = 'sync-test-project';
			const projectUri = vscode.Uri.joinPath(testProjectsUri, projectName);
			await vscode.workspace.fs.createDirectory(projectUri);

			// Create source file in project
			const sourceCodeUri = vscode.Uri.joinPath(projectUri, 'code.py');
			const sourceContent = `# Test sync code
import board
print("Hello from sync test!")
`;

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(sourceCodeUri, encoder.encode(sourceContent));

			// Copy to device directory (simulating device sync)
			const deviceCodeUri = vscode.Uri.joinPath(testDeviceUri, 'current', 'code.py');
			const sourceFileContent = await vscode.workspace.fs.readFile(sourceCodeUri);
			await vscode.workspace.fs.writeFile(deviceCodeUri, sourceFileContent);

			// Verify sync operation
			const deviceStats = await vscode.workspace.fs.stat(deviceCodeUri);
			assert.ok(deviceStats.type === vscode.FileType.File, 'File should be synced to device directory');

			// Verify content matches
			const decoder = new TextDecoder();
			const deviceContent = decoder.decode(await vscode.workspace.fs.readFile(deviceCodeUri));
			assert.strictEqual(deviceContent, sourceContent, 'Synced content should match source');
		});

		it('should handle save-twice functionality with backup creation', async () => {
			const projectName = 'save-twice-project';
			const projectUri = vscode.Uri.joinPath(testProjectsUri, projectName);
			const backupUri = vscode.Uri.joinPath(projectUri, '.backup');

			await vscode.workspace.fs.createDirectory(projectUri);
			await vscode.workspace.fs.createDirectory(backupUri);

			const codeContent = `# Save-twice test
import board
led = digitalio.DigitalInOut(board.LED)
print("Save twice functionality test")
`;

			const encoder = new TextEncoder();

			// Save to project location
			const projectCodeUri = vscode.Uri.joinPath(projectUri, 'code.py');
			await vscode.workspace.fs.writeFile(projectCodeUri, encoder.encode(codeContent));

			// Save to device location
			const deviceCodeUri = vscode.Uri.joinPath(testDeviceUri, 'current', 'code.py');
			await vscode.workspace.fs.writeFile(deviceCodeUri, encoder.encode(codeContent));

			// Create backup with timestamp
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const backupCodeUri = vscode.Uri.joinPath(backupUri, `code-${timestamp}.py`);
			await vscode.workspace.fs.writeFile(backupCodeUri, encoder.encode(codeContent));

			// Verify all three locations have the file
			const projectStats = await vscode.workspace.fs.stat(projectCodeUri);
			const deviceStats = await vscode.workspace.fs.stat(deviceCodeUri);
			const backupStats = await vscode.workspace.fs.stat(backupCodeUri);

			assert.ok(projectStats.type === vscode.FileType.File, 'Project file should exist');
			assert.ok(deviceStats.type === vscode.FileType.File, 'Device file should exist');
			assert.ok(backupStats.type === vscode.FileType.File, 'Backup file should exist');

			// Verify backup directory contains backup files
			const backupContents = await vscode.workspace.fs.readDirectory(backupUri);
			const backupFiles = backupContents.filter(([name, type]) =>
				type === vscode.FileType.File && name.startsWith('code-')
			);

			assert.ok(backupFiles.length > 0, 'Should have backup files');
		});
	});

	describe('Project Structure Validation', () => {
		it('should create complete Mu Two workspace structure', async () => {
			// Create full workspace structure
			const requiredDirs = [
				'projects',
				'ctpy-device',
				'ctpy-device/current',
				'.vscode'
			];

			for (const dir of requiredDirs) {
				const dirUri = vscode.Uri.joinPath(testWorkspaceUri, dir);
				await vscode.workspace.fs.createDirectory(dirUri);
			}

			// Create VS Code configuration
			const vscodeSettingsUri = vscode.Uri.joinPath(testWorkspaceUri, '.vscode', 'settings.json');
			const vscodeSettings = {
				"python.defaultInterpreterPath": "./venv/bin/python",
				"muTwo.autoSync": true,
				"muTwo.enableRepl": true,
				"muTwo.defaultBaudRate": 115200,
				"files.associations": {
					"*.py": "python"
				}
			};

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(
				vscodeSettingsUri,
				encoder.encode(JSON.stringify(vscodeSettings, null, 2))
			);

			// Verify complete structure
			for (const dir of requiredDirs) {
				const dirUri = vscode.Uri.joinPath(testWorkspaceUri, dir);
				const dirStats = await vscode.workspace.fs.stat(dirUri);
				assert.ok(dirStats.type === vscode.FileType.Directory, `Directory ${dir} should exist`);
			}

			// Verify VS Code settings
			const settingsStats = await vscode.workspace.fs.stat(vscodeSettingsUri);
			assert.ok(settingsStats.type === vscode.FileType.File, 'VS Code settings should exist');

			const decoder = new TextDecoder();
			const settingsContent = decoder.decode(await vscode.workspace.fs.readFile(vscodeSettingsUri));
			const parsedSettings = JSON.parse(settingsContent);

			assert.strictEqual(parsedSettings["muTwo.autoSync"], true, 'Auto sync should be enabled');
			assert.strictEqual(parsedSettings["muTwo.defaultBaudRate"], 115200, 'Baud rate should be set');
		});

		it('should validate project template structure', async () => {
			const projectName = 'template-validation-project';
			const projectUri = vscode.Uri.joinPath(testProjectsUri, projectName);

			// Create project from template structure
			await vscode.workspace.fs.createDirectory(projectUri);
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'lib'));
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'assets'));

			const templateFiles = [
				{ name: 'code.py', content: '# Main CircuitPython code\nimport board\nprint("Template project")' },
				{ name: 'boot.py', content: '# Boot configuration\nprint("Booting...")' },
				{ name: 'settings.toml', content: '# Device settings\nCIRCUITPY_WEB_API_PASSWORD = "template"' },
				{ name: 'project.json', content: JSON.stringify({
					name: projectName,
					version: '1.0.0',
					description: 'Template validation project',
					author: 'Mu Two Test',
					dependencies: ['adafruit-circuitpython-neopixel'],
					board: 'circuitplayground_express'
				}, null, 2) }
			];

			const encoder = new TextEncoder();
			for (const file of templateFiles) {
				const fileUri = vscode.Uri.joinPath(projectUri, file.name);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(file.content));
			}

			// Validate template structure
			const projectContents = await vscode.workspace.fs.readDirectory(projectUri);
			const requiredFiles = ['code.py', 'boot.py', 'settings.toml', 'project.json'];
			const requiredDirs = ['lib', 'assets'];

			for (const fileName of requiredFiles) {
				const file = projectContents.find(([name, type]) =>
					name === fileName && type === vscode.FileType.File
				);
				assert.ok(file, `Required file ${fileName} should exist`);
			}

			for (const dirName of requiredDirs) {
				const dir = projectContents.find(([name, type]) =>
					name === dirName && type === vscode.FileType.Directory
				);
				assert.ok(dir, `Required directory ${dirName} should exist`);
			}

			// Validate project metadata
			const projectJsonUri = vscode.Uri.joinPath(projectUri, 'project.json');
			const decoder = new TextDecoder();
			const projectMetadata = JSON.parse(
				decoder.decode(await vscode.workspace.fs.readFile(projectJsonUri))
			);

			assert.strictEqual(projectMetadata.name, projectName, 'Project name should match');
			assert.ok(Array.isArray(projectMetadata.dependencies), 'Dependencies should be array');
		});
	});

	describe('Error Handling and Recovery', () => {
		it('should handle file permission errors gracefully', async () => {
			// Test handling of permission denied scenarios
			const readOnlyProjectUri = vscode.Uri.joinPath(testProjectsUri, 'readonly-test');
			await vscode.workspace.fs.createDirectory(readOnlyProjectUri);

			try {
				// Attempt to write to a non-existent parent directory
				const invalidUri = vscode.Uri.joinPath(testWorkspaceUri, 'nonexistent', 'subdir', 'file.py');
				const encoder = new TextEncoder();
				await vscode.workspace.fs.writeFile(invalidUri, encoder.encode('test'));

				// If we get here, the operation unexpectedly succeeded
				assert.fail('Should have thrown an error for invalid path');
			} catch (error: any) {
				// Verify we get a proper error
				assert.ok(error instanceof Error, 'Should throw an error object');
				const errorText = error instanceof Error ? error.message : String(error);
				assert.ok(errorText.includes('ENOENT') || errorText.includes('FileNotFound'),
					'Should get file not found error');
			}
		});

		it('should handle corrupted file recovery', async () => {
			const projectName = 'recovery-test-project';
			const projectUri = vscode.Uri.joinPath(testProjectsUri, projectName);
			const backupUri = vscode.Uri.joinPath(projectUri, '.backup');

			await vscode.workspace.fs.createDirectory(projectUri);
			await vscode.workspace.fs.createDirectory(backupUri);

			// Create original file
			const originalContent = '# Original working code\nimport board\nprint("Working")';
			const codeUri = vscode.Uri.joinPath(projectUri, 'code.py');
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(codeUri, encoder.encode(originalContent));

			// Create backup
			const backupCodeUri = vscode.Uri.joinPath(backupUri, 'code-backup.py');
			await vscode.workspace.fs.writeFile(backupCodeUri, encoder.encode(originalContent));

			// Simulate file corruption by writing invalid content
			const corruptedContent = '# Corrupted file\nimport invalid_module_that_does_not_exist\nsyntax error here';
			await vscode.workspace.fs.writeFile(codeUri, encoder.encode(corruptedContent));

			// Verify corruption
			const decoder = new TextDecoder();
			const currentContent = decoder.decode(await vscode.workspace.fs.readFile(codeUri));
			assert.ok(currentContent.includes('syntax error'), 'File should be corrupted');

			// Simulate recovery from backup
			const backupContent = await vscode.workspace.fs.readFile(backupCodeUri);
			await vscode.workspace.fs.writeFile(codeUri, backupContent);

			// Verify recovery
			const recoveredContent = decoder.decode(await vscode.workspace.fs.readFile(codeUri));
			assert.strictEqual(recoveredContent, originalContent, 'File should be recovered from backup');
		});
	});
});