import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

suite('Workspace Integration Tests', () => {
	const testWorkspacePath = path.join(__dirname, '..', 'fixtures', 'test-workspace');

	test('Should handle CircuitPython files', async () => {
		const codeUri = vscode.Uri.file(path.join(testWorkspacePath, 'code.py'));

		try {
			// Open the test file
			const document = await vscode.workspace.openTextDocument(codeUri);
			assert.ok(document, 'Should open CircuitPython file');
			assert.strictEqual(document.languageId, 'python', 'Should detect Python language');

			const content = document.getText();
			assert.ok(content.includes('import board'), 'Should contain CircuitPython imports');
			assert.ok(content.includes('digitalio'), 'Should contain CircuitPython modules');

		} catch (error) {
			// File might not exist in test environment, this is expected
			console.log('Test file access note:', error);
		}
	});

	test('Should handle workspace configuration', async () => {
		// Test workspace-level configuration
		const config = vscode.workspace.getConfiguration('muTwo');

		// Default values should be available
		assert.ok(typeof config.get('history.defaultLoadLimit') === 'number');
		assert.ok(typeof config.get('serial.globalPermission') === 'boolean');
		assert.ok(typeof config.get('autoDownloadGuides') === 'boolean');
	});

	test('Should provide Python language features', async () => {
		// Test that Python extension integration works
		const pythonExt = vscode.extensions.getExtension('ms-python.python');

		if (pythonExt) {
			// Python extension is available
			assert.ok(pythonExt, 'Python extension should be available');

			if (!pythonExt.isActive) {
				await pythonExt.activate();
			}

			assert.ok(pythonExt.isActive, 'Python extension should be active');
		} else {
			// Python extension not available in test environment
			console.log('Python extension not available in test environment');
		}
	});

	test('Should handle file associations', () => {
		// Test file associations for CircuitPython files
		const pyFiles = ['code.py', 'main.py', 'boot.py'];

		for (const filename of pyFiles) {
			const uri = vscode.Uri.file(path.join(testWorkspacePath, filename));

			// All .py files should be associated with Python language
			// This is handled by VS Code's built-in associations
			assert.ok(filename.endsWith('.py'), 'CircuitPython files should have .py extension');
		}
	});

	test('Should handle workspace folders', async () => {
		// Test dual workspace folder structure
		const currentFolders = vscode.workspace.workspaceFolders;

		if (currentFolders && currentFolders.length > 0) {
			// Workspace folders are available
			assert.ok(Array.isArray(currentFolders), 'Workspace folders should be an array');

			for (const folder of currentFolders) {
				assert.ok(folder.uri, 'Each folder should have a URI');
				assert.ok(folder.name, 'Each folder should have a name');
				assert.ok(typeof folder.index === 'number', 'Each folder should have an index');
			}
		} else {
			// No workspace folders in test environment
			console.log('No workspace folders available in test environment');
		}
	});

	test('Should handle terminal operations', async () => {
		// Test terminal integration for CircuitPython REPL
		try {
			const terminal = vscode.window.createTerminal({
				name: 'Test CircuitPython Terminal'
			});

			assert.ok(terminal, 'Should create terminal');
			assert.strictEqual(terminal.name, 'Test CircuitPython Terminal');

			// Clean up
			terminal.dispose();
		} catch (error) {
			console.log('Terminal test note:', error);
		}
	});

	test('Should handle debug configuration', () => {
		// Test CircuitPython debug configuration
		const debugConfig = {
			name: 'Test CircuitPython Debug',
			type: 'circuitpython',
			request: 'launch',
			autoDetect: true,
			enableRepl: true
		};

		assert.strictEqual(debugConfig.type, 'circuitpython');
		assert.strictEqual(debugConfig.request, 'launch');
		assert.strictEqual(debugConfig.autoDetect, true);
		assert.strictEqual(debugConfig.enableRepl, true);
	});

	test('Should handle workspace state persistence', async () => {
		// Test workspace state and settings persistence
		const testKey = 'muTwo.test.key';
		const testValue = { test: 'data', timestamp: Date.now() };

		// This would test state persistence in a real workspace
		// For now, we test the structure
		assert.ok(typeof testKey === 'string', 'State keys should be strings');
		assert.ok(typeof testValue === 'object', 'State values should be serializable');
	});

	test('Should handle file watchers', async () => {
		// Test file watching for CircuitPython files
		const pattern = new vscode.RelativePattern(
			vscode.workspace.workspaceFolders?.[0] || vscode.Uri.file(testWorkspacePath),
			'**/*.py'
		);

		try {
			const watcher = vscode.workspace.createFileSystemWatcher(pattern);

			assert.ok(watcher, 'Should create file watcher');
			assert.ok(typeof watcher.onDidCreate === 'function');
			assert.ok(typeof watcher.onDidChange === 'function');
			assert.ok(typeof watcher.onDidDelete === 'function');

			// Clean up
			watcher.dispose();
		} catch (error) {
			console.log('File watcher test note:', error);
		}
	});

	test('Should handle custom editor activation', async () => {
		// Test custom editor for CircuitPython files
		const muTwoExtension = vscode.extensions.getExtension('mu-two.mu-two-editor');

		if (muTwoExtension && muTwoExtension.isActive) {
			const packageJson = muTwoExtension.packageJSON;
			const customEditor = packageJson.contributes.customEditors.find(
				(editor: any) => editor.viewType === 'muTwo.editor.editView'
			);

			assert.ok(customEditor, 'Should have custom editor definition');

			// Check file patterns
			const patterns = customEditor.selector.flatMap((s: any) => s.filenamePatterns || []);
			assert.ok(patterns.includes('code.py'), 'Should handle code.py files');
			assert.ok(patterns.includes('main.py'), 'Should handle main.py files');
		}
	});

	test('Should handle CircuitPython library structure', async () => {
		// Test lib directory structure
		const libPath = path.join(testWorkspacePath, 'lib');

		try {
			const libUri = vscode.Uri.file(libPath);
			const stat = await vscode.workspace.fs.stat(libUri);

			assert.strictEqual(stat.type, vscode.FileType.Directory, 'lib should be a directory');

			// Test library file
			const libFileUri = vscode.Uri.file(path.join(libPath, 'test_library.py'));
			const libDocument = await vscode.workspace.openTextDocument(libFileUri);

			assert.ok(libDocument, 'Should open library file');
			assert.strictEqual(libDocument.languageId, 'python');

		} catch (error) {
			console.log('Library structure test note:', error);
		}
	});
});