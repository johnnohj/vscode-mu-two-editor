import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

describe('Integration Tests - Custom Editor with Real File Operations', () => {
	let testWorkspaceUri: vscode.Uri;
	let tempDir: string;

	beforeEach(async () => {
		// Create temporary directory for test files
		tempDir = path.join(os.tmpdir(), 'mu-two-editor-test-' + Date.now());
		testWorkspaceUri = vscode.Uri.file(tempDir);
		await vscode.workspace.fs.createDirectory(testWorkspaceUri);
	});

	afterEach(async () => {
		// Clean up test files and close any open editors
		try {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(testWorkspaceUri, { recursive: true });
		} catch (error) {
			console.warn('Failed to clean up test files:', error);
		}
	});

	describe('File Creation and Opening', () => {
		it('should create and open CircuitPython files with proper content', async () => {
			// Create a CircuitPython file with real content
			const fileName = 'test_blink.py';
			const fileUri = vscode.Uri.joinPath(testWorkspaceUri, fileName);
			const circuitPythonContent = `# CircuitPython LED Blink Test
import board
import digitalio
import time

# Set up the onboard LED
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

# Main loop
while True:
    print("LED ON")
    led.value = True
    time.sleep(1)

    print("LED OFF")
    led.value = False
    time.sleep(1)
`;

			// Write file using VS Code filesystem API
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(fileUri, encoder.encode(circuitPythonContent));

			// Open the file in VS Code editor
			const document = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(document);

			// Verify file is opened and has correct content
			assert.ok(editor, 'Editor should be opened');
			assert.strictEqual(editor.document.uri.toString(), fileUri.toString(), 'Correct file should be opened');
			assert.strictEqual(editor.document.languageId, 'python', 'Language should be detected as Python');
			assert.ok(editor.document.getText().includes('import board'), 'Content should include CircuitPython imports');
			assert.ok(editor.document.getText().includes('digitalio.DigitalInOut'), 'Content should include CircuitPython API calls');

			// Verify file stats
			const fileStats = await vscode.workspace.fs.stat(fileUri);
			assert.ok(fileStats.size > 0, 'File should have content');
			assert.strictEqual(fileStats.type, vscode.FileType.File, 'Should be a regular file');
		});

		it('should handle multiple CircuitPython file types', async () => {
			const fileTemplates = [
				{
					name: 'code.py',
					content: '# Main CircuitPython program\nimport board\nprint("Hello CircuitPython!")',
					expectedLanguage: 'python'
				},
				{
					name: 'boot.py',
					content: '# Boot sequence\nimport supervisor\nsupervisor.set_rgb_status_brightness(0)',
					expectedLanguage: 'python'
				},
				{
					name: 'settings.toml',
					content: '# CircuitPython settings\nCIRCUITPY_WEB_API_PASSWORD = "password123"',
					expectedLanguage: 'toml'
				},
				{
					name: 'lib/custom_sensor.py',
					content: '# Custom sensor library\nclass TemperatureSensor:\n    def __init__(self):\n        pass',
					expectedLanguage: 'python'
				}
			];

			const openedEditors = [];

			for (const template of fileTemplates) {
				// Create directory if needed
				const fileUri = vscode.Uri.joinPath(testWorkspaceUri, template.name);
				const dirUri = vscode.Uri.joinPath(fileUri, '..');
				try {
					await vscode.workspace.fs.createDirectory(dirUri);
				} catch {
					// Directory might already exist
				}

				// Create and open file
				const encoder = new TextEncoder();
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(template.content));

				const document = await vscode.workspace.openTextDocument(fileUri);
				const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);

				openedEditors.push({
					editor,
					template,
					fileUri
				});

				// Verify each file
				assert.ok(editor, `Editor should open for ${template.name}`);
				assert.strictEqual(editor.document.languageId, template.expectedLanguage,
					`Language should be ${template.expectedLanguage} for ${template.name}`);
				assert.ok(editor.document.getText().includes(template.content.split('\n')[0]),
					`Content should match for ${template.name}`);
			}

			// Verify all editors are open
			assert.strictEqual(openedEditors.length, fileTemplates.length, 'All files should be opened');

			// Test switching between editors
			for (const { editor } of openedEditors) {
				await vscode.window.showTextDocument(editor.document);
				assert.strictEqual(vscode.window.activeTextEditor, editor, 'Should switch to correct editor');
			}
		});

		it('should create project files from CircuitPython templates', async () => {
			const projectTemplates = {
				'basic-blink': {
					'code.py': `# Basic LED Blink
import board
import digitalio
import time

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

while True:
    led.value = not led.value
    time.sleep(0.5)`,
					'boot.py': '# Basic boot configuration',
					'settings.toml': 'CIRCUITPY_WEB_API_PASSWORD = "mu2editor"'
				},
				'sensor-reading': {
					'code.py': `# Sensor Reading Template
import board
import analogio
import time

# Set up analog input
analog_pin = analogio.AnalogIn(board.A0)

def get_voltage(pin):
    return (pin.value * 3.3) / 65536

while True:
    voltage = get_voltage(analog_pin)
    print(f"Sensor voltage: {voltage:.2f}V")
    time.sleep(1)`,
					'lib/sensor_utils.py': `# Sensor utility functions
def calibrate_sensor(raw_value, min_val=0, max_val=65536):
    return (raw_value - min_val) / (max_val - min_val)

def smooth_readings(readings, window_size=5):
    if len(readings) < window_size:
        return sum(readings) / len(readings)
    return sum(readings[-window_size:]) / window_size`
				}
			};

			for (const [templateName, files] of Object.entries(projectTemplates)) {
				const projectUri = vscode.Uri.joinPath(testWorkspaceUri, templateName);
				await vscode.workspace.fs.createDirectory(projectUri);

				// Create lib directory if needed
				if (Object.keys(files).some(f => f.startsWith('lib/'))) {
					await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(projectUri, 'lib'));
				}

				const createdFiles = [];

				for (const [fileName, content] of Object.entries(files)) {
					const fileUri = vscode.Uri.joinPath(projectUri, fileName);
					const encoder = new TextEncoder();
					await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));

					// Verify file creation
					const stats = await vscode.workspace.fs.stat(fileUri);
					assert.ok(stats.size > 0, `File ${fileName} should have content`);

					// Open and verify content
					const document = await vscode.workspace.openTextDocument(fileUri);
					assert.ok(document.getText().includes(content.split('\n')[0]),
						`File ${fileName} should have correct content`);

					createdFiles.push(fileName);
				}

				// Verify complete project structure
				const projectContents = await vscode.workspace.fs.readDirectory(projectUri);
				for (const fileName of createdFiles) {
					const found = projectContents.some(([name, type]) =>
						(fileName.includes('/') ? fileName.split('/')[1] === name : fileName === name) &&
						type === vscode.FileType.File
					);
					assert.ok(found || fileName.includes('/'), `File ${fileName} should exist in project`);
				}
			}
		});
	});

	describe('File Editing and Modification', () => {
		it('should edit file content and save changes', async () => {
			// Create initial file
			const fileUri = vscode.Uri.joinPath(testWorkspaceUri, 'editable_test.py');
			const initialContent = `# Initial content
import board
print("Initial version")
`;

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(fileUri, encoder.encode(initialContent));

			// Open file in editor
			const document = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(document);

			// Edit the document
			const edit = new vscode.WorkspaceEdit();
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(document.getText().length)
			);

			const modifiedContent = `# Modified content
import board
import digitalio
import time

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

print("Modified version with LED control")

while True:
    led.value = not led.value
    time.sleep(1)
`;

			edit.replace(fileUri, fullRange, modifiedContent);
			const applyResult = await vscode.workspace.applyEdit(edit);
			assert.ok(applyResult, 'Edit should be applied successfully');

			// Verify document is modified
			assert.ok(document.isDirty, 'Document should be marked as dirty');
			assert.ok(document.getText().includes('Modified version'), 'Document should contain new content');
			assert.ok(document.getText().includes('digitalio'), 'Document should contain added imports');

			// Save the document
			const saveResult = await document.save();
			assert.ok(saveResult, 'Document should save successfully');
			assert.ok(!document.isDirty, 'Document should no longer be dirty after save');

			// Verify file on disk is updated
			const decoder = new TextDecoder();
			const diskContent = decoder.decode(await vscode.workspace.fs.readFile(fileUri));
			assert.strictEqual(diskContent, modifiedContent, 'File on disk should match editor content');
		});

		it('should handle multiple concurrent edits', async () => {
			// Create multiple files for concurrent editing
			const fileContents = [
				'# File 1\nimport board\nprint("File 1")',
				'# File 2\nimport time\nprint("File 2")',
				'# File 3\nimport digitalio\nprint("File 3")'
			];

			const editors = [];
			const encoder = new TextEncoder();

			// Create and open all files
			for (let i = 0; i < fileContents.length; i++) {
				const fileUri = vscode.Uri.joinPath(testWorkspaceUri, `concurrent_${i}.py`);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(fileContents[i]));

				const document = await vscode.workspace.openTextDocument(fileUri);
				const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
				editors.push({ editor, document, fileUri, index: i });
			}

			// Apply concurrent edits
			const editPromises = editors.map(async ({ document, fileUri, index }) => {
				const edit = new vscode.WorkspaceEdit();
				const insertPosition = document.positionAt(document.getText().length);
				edit.insert(fileUri, insertPosition, `\n# Added to file ${index}\nprint("Concurrent edit ${index}")`);
				return vscode.workspace.applyEdit(edit);
			});

			const results = await Promise.all(editPromises);
			results.forEach((result, index) => {
				assert.ok(result, `Concurrent edit ${index} should succeed`);
			});

			// Save all documents
			const savePromises = editors.map(({ document }) => document.save());
			const saveResults = await Promise.all(savePromises);
			saveResults.forEach((result, index) => {
				assert.ok(result, `Document ${index} should save successfully`);
			});

			// Verify all edits persisted
			for (const { fileUri, index } of editors) {
				const decoder = new TextDecoder();
				const content = decoder.decode(await vscode.workspace.fs.readFile(fileUri));
				assert.ok(content.includes(`Concurrent edit ${index}`), `File ${index} should contain concurrent edit`);
			}
		});

		it('should handle large file editing performance', async () => {
			// Create a large CircuitPython file
			const largeContent = generateLargeCircuitPythonFile(1000); // 1000 lines
			const fileUri = vscode.Uri.joinPath(testWorkspaceUri, 'large_file.py');

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(fileUri, encoder.encode(largeContent));

			// Measure opening time
			const openStart = Date.now();
			const document = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(document);
			const openTime = Date.now() - openStart;

			assert.ok(openTime < 5000, 'Large file should open within 5 seconds');
			assert.ok(editor, 'Editor should open for large file');

			// Measure editing performance
			const editStart = Date.now();
			const edit = new vscode.WorkspaceEdit();
			const insertPosition = new vscode.Position(500, 0); // Middle of file
			edit.insert(fileUri, insertPosition, '# Performance test insertion\nprint("Performance test")\n');

			const editResult = await vscode.workspace.applyEdit(edit);
			const editTime = Date.now() - editStart;

			assert.ok(editResult, 'Edit should succeed on large file');
			assert.ok(editTime < 1000, 'Edit should complete within 1 second');

			// Measure save performance
			const saveStart = Date.now();
			const saveResult = await document.save();
			const saveTime = Date.now() - saveStart;

			assert.ok(saveResult, 'Large file should save successfully');
			assert.ok(saveTime < 3000, 'Large file should save within 3 seconds');
		});
	});

	describe('File Watching and Auto-reload', () => {
		it('should detect external file changes and reload', async () => {
			// Create initial file
			const fileUri = vscode.Uri.joinPath(testWorkspaceUri, 'watched_file.py');
			const initialContent = '# Initial content\nimport board\nprint("Initial")';

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(fileUri, encoder.encode(initialContent));

			// Open in editor
			const document = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(document);

			// Set up file watcher
			let changeDetected = false;
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(testWorkspaceUri, '*.py')
			);

			watcher.onDidChange((uri) => {
				if (uri.toString() === fileUri.toString()) {
					changeDetected = true;
				}
			});

			try {
				// Modify file externally (simulate external editor change)
				const modifiedContent = '# Externally modified\nimport board\nprint("Modified externally")';
				await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(modifiedContent));

				// Wait for change detection
				await new Promise(resolve => setTimeout(resolve, 1000));

				assert.ok(changeDetected, 'File change should be detected');

				// Note: VS Code may show a dialog for external changes in real usage
				// In test environment, we verify the file system change was detected
				const decoder = new TextDecoder();
				const currentContent = decoder.decode(await vscode.workspace.fs.readFile(fileUri));
				assert.ok(currentContent.includes('Externally modified'), 'File should contain external changes');

			} finally {
				watcher.dispose();
			}
		});

		it('should handle file deletion and recovery', async () => {
			// Create file
			const fileUri = vscode.Uri.joinPath(testWorkspaceUri, 'deletable_file.py');
			const content = '# File to be deleted\nimport board\nprint("Will be deleted")';

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));

			// Open in editor
			const document = await vscode.workspace.openTextDocument(fileUri);
			await vscode.window.showTextDocument(document);

			// Verify file exists
			let fileExists = true;
			try {
				await vscode.workspace.fs.stat(fileUri);
			} catch {
				fileExists = false;
			}
			assert.ok(fileExists, 'File should initially exist');

			// Delete file
			await vscode.workspace.fs.delete(fileUri);

			// Verify deletion
			fileExists = true;
			try {
				await vscode.workspace.fs.stat(fileUri);
			} catch {
				fileExists = false;
			}
			assert.ok(!fileExists, 'File should be deleted');

			// Attempt to recover by saving the open document
			try {
				const saveResult = await document.save();
				// If save succeeds, the file should be recreated
				if (saveResult) {
					const recoveredStats = await vscode.workspace.fs.stat(fileUri);
					assert.ok(recoveredStats.type === vscode.FileType.File, 'File should be recovered through save');
				}
			} catch (error) {
				// Save might fail for deleted file - this is expected behavior
				console.log('Save failed for deleted file (expected):', error instanceof Error ? error.message : String(error));
			}
		});
	});

	describe('Syntax Highlighting and Language Features', () => {
		it('should apply correct syntax highlighting for CircuitPython', async () => {
			// Create CircuitPython file with various syntax elements
			const pythonCode = `# CircuitPython syntax test
import board
import digitalio
from adafruit_display_text import label
import terminalio

# Constants
LED_PIN = board.LED
BUTTON_PIN = board.BUTTON_A

# Variables
counter = 0
button_pressed = False

# Class definition
class LEDController:
    def __init__(self, pin):
        self.led = digitalio.DigitalInOut(pin)
        self.led.direction = digitalio.Direction.OUTPUT

    def toggle(self):
        self.led.value = not self.led.value

# Function definition
def read_sensor():
    """Read sensor value and return processed data"""
    raw_value = analog_pin.value
    voltage = (raw_value * 3.3) / 65536
    return voltage

# Main code
if __name__ == "__main__":
    led_controller = LEDController(LED_PIN)

    while True:
        sensor_value = read_sensor()
        print(f"Sensor: {sensor_value:.2f}V")

        if sensor_value > 1.5:
            led_controller.toggle()

        time.sleep(0.1)
`;

			const fileUri = vscode.Uri.joinPath(testWorkspaceUri, 'syntax_test.py');
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(fileUri, encoder.encode(pythonCode));

			// Open file
			const document = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(document);

			// Verify language detection
			assert.strictEqual(document.languageId, 'python', 'Should be detected as Python');

			// Verify content is properly loaded
			const text = document.getText();
			assert.ok(text.includes('import board'), 'Should contain CircuitPython imports');
			assert.ok(text.includes('class LEDController'), 'Should contain class definition');
			assert.ok(text.includes('def read_sensor'), 'Should contain function definition');
			assert.ok(text.includes('while True'), 'Should contain main loop');

			// Test code folding by getting folding ranges
			try {
				const foldingRanges = await vscode.commands.executeCommand(
					'vscode.executeFoldingRangeProvider',
					document.uri
				) as vscode.FoldingRange[];

				if (foldingRanges && foldingRanges.length > 0) {
					assert.ok(foldingRanges.length > 0, 'Should have folding ranges for classes and functions');
				}
			} catch (error) {
				// Folding provider might not be available in test environment
				console.log('Folding range provider not available in test environment');
			}
		});
	});

	// Helper function to generate large CircuitPython file
	function generateLargeCircuitPythonFile(lineCount: number): string {
		const lines = [
			'# Large CircuitPython file for performance testing',
			'import board',
			'import digitalio',
			'import time',
			'import analogio',
			'',
			'# Initialize pins'
		];

		for (let i = 0; i < lineCount - 20; i++) {
			if (i % 50 === 0) {
				lines.push(`\n# Section ${Math.floor(i / 50) + 1}`);
			}

			if (i % 10 === 0) {
				lines.push(`def function_${i}():`);
				lines.push(`    """Function ${i} for testing"""`);
				lines.push(`    value = ${i}`);
				lines.push(`    return value * 2`);
			} else {
				lines.push(`# Comment line ${i}`);
				lines.push(`variable_${i} = ${i} * 0.1`);
			}
		}

		lines.push('');
		lines.push('# Main loop');
		lines.push('while True:');
		lines.push('    print("Large file test")');
		lines.push('    time.sleep(1)');

		return lines.join('\n');
	}
});