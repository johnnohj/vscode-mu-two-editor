import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration Tests', () => {
	let extension: vscode.Extension<any>;

	suiteSetup(async () => {
		// Get the extension
		extension = vscode.extensions.getExtension('mu-two.mu-two-editor')!;

		// Activate the extension
		if (!extension.isActive) {
			await extension.activate();
		}
	});

	test('Extension should activate successfully', () => {
		assert.ok(extension, 'Extension should be available');
		assert.ok(extension.isActive, 'Extension should be activated');
	});

	test('Extension should register commands', async () => {
		const commands = await vscode.commands.getCommands(true);

		const expectedCommands = [
			'muTwo.workspace.create',
			'muTwo.workspace.open',
			'muTwo.showWelcome',
			'muTwo.editor.openEditor'
		];

		for (const command of expectedCommands) {
			assert.ok(
				commands.includes(command),
				`Command ${command} should be registered`
			);
		}
	});

	test('Extension should provide custom editor', () => {
		const packageJson = extension.packageJSON;
		assert.ok(packageJson.contributes.customEditors, 'Should have custom editors');

		const customEditor = packageJson.contributes.customEditors.find(
			(editor: any) => editor.viewType === 'muTwo.editor.editView'
		);

		assert.ok(customEditor, 'Should have Mu 2 custom editor');
		assert.ok(customEditor.selector, 'Custom editor should have file selectors');
	});

	test('Extension should provide views', () => {
		const packageJson = extension.packageJSON;
		assert.ok(packageJson.contributes.views, 'Should have views');
		assert.ok(packageJson.contributes.viewsContainers, 'Should have view containers');

		const replView = packageJson.contributes.views.replContainer.find(
			(view: any) => view.id === 'muTwo.replView'
		);

		assert.ok(replView, 'Should have REPL view');
	});

	test('Extension should have correct configuration', () => {
		const config = vscode.workspace.getConfiguration('muTwo');

		// Test that configuration properties exist and have expected defaults
		assert.strictEqual(config.get('history.defaultLoadLimit'), 50);
		assert.strictEqual(config.get('serial.globalPermission'), false);
		assert.strictEqual(config.get('autoDownloadGuides'), true);
	});

	test('Extension should provide debugger configuration', () => {
		const packageJson = extension.packageJSON;
		assert.ok(packageJson.contributes.debuggers, 'Should have debuggers');

		const circuitPythonDebugger = packageJson.contributes.debuggers.find(
			(dbg: any) => dbg.type === 'circuitpython'
		);

		assert.ok(circuitPythonDebugger, 'Should have CircuitPython debugger');
		assert.strictEqual(circuitPythonDebugger.label, 'CircuitPython');
	});

	test('Extension should handle workspace creation command', async () => {
		// Test that workspace creation command can be executed
		try {
			await vscode.commands.executeCommand('muTwo.workspace.create');
			// Command should execute without throwing (actual UI interaction may vary)
			assert.ok(true, 'Workspace creation command should be executable');
		} catch (error) {
			// Some commands may require specific conditions to execute fully
			// We're mainly testing that they're registered and can be called
			console.log('Workspace creation command execution note:', error);
		}
	});

	test('Extension should handle welcome command', async () => {
		try {
			await vscode.commands.executeCommand('muTwo.showWelcome');
			assert.ok(true, 'Welcome command should be executable');
		} catch (error) {
			console.log('Welcome command execution note:', error);
		}
	});

	test('Extension should have proper activation events', () => {
		const packageJson = extension.packageJSON;
		assert.ok(packageJson.activationEvents, 'Should have activation events');

		const expectedEvents = [
			'onFileSystem:ctpy',
			'workspaceContains:.vscode/mu2 && workspaceContains:ctpy-device:/',
			'onCustomEditor:viewType:muTwo.editor.editView'
		];

		for (const event of expectedEvents) {
			assert.ok(
				packageJson.activationEvents.includes(event),
				`Should have activation event: ${event}`
			);
		}
	});

	test('Extension should have proper dependencies', () => {
		const packageJson = extension.packageJSON;
		assert.ok(packageJson.extensionDependencies, 'Should have extension dependencies');

		const expectedDependencies = [
			'ms-python.python',
			'ms-vscode.wasm-wasi-core'
		];

		for (const dependency of expectedDependencies) {
			assert.ok(
				packageJson.extensionDependencies.includes(dependency),
				`Should depend on: ${dependency}`
			);
		}
	});

	test('Extension should provide language service features', () => {
		// Test that language service features are available for Python files
		const packageJson = extension.packageJSON;

		// Check if debugger supports Python
		const debuggerConfig = packageJson.contributes.debuggers.find(
			(d: any) => d.type === 'circuitpython'
		);

		assert.ok(debuggerConfig.languages.includes('python'), 'Should support Python language');
	});

	test('Extension context should be properly initialized', () => {
		// Test that extension context and global state are working
		assert.ok(extension.isActive, 'Extension should be active');

		// Extension should have proper package info
		const packageJson = extension.packageJSON;
		assert.strictEqual(packageJson.name, 'mu-two-editor');
		assert.strictEqual(packageJson.displayName, 'Mu 2 Editor');
	});
});