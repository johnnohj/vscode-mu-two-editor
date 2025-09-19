import * as assert from 'assert';
import * as vscode from 'vscode';

describe('Basic Extension Activation Tests', () => {
	it('should have VS Code API available', () => {
		assert.ok(vscode, 'VS Code API should be available in test environment');
		assert.ok(vscode.window, 'VS Code window API should be available');
		assert.ok(vscode.workspace, 'VS Code workspace API should be available');
		assert.ok(vscode.commands, 'VS Code commands API should be available');
	});

	it('should be able to get extension list', async () => {
		const extensions = vscode.extensions.all;
		assert.ok(Array.isArray(extensions), 'Extensions should be an array');
		assert.ok(extensions.length > 0, 'Should have at least some extensions');
	});

	it('should be able to execute built-in commands', async () => {
		const commands = await vscode.commands.getCommands(false);
		assert.ok(Array.isArray(commands), 'Commands should be an array');
		assert.ok(commands.length > 0, 'Should have built-in commands available');
	});

	it('should be able to access workspace configuration', () => {
		const config = vscode.workspace.getConfiguration();
		assert.ok(config, 'Configuration should be available');
		assert.ok(typeof config.get === 'function', 'Config should have get method');
		assert.ok(typeof config.update === 'function', 'Config should have update method');
	});

	it('should be able to create output channel', () => {
		const channel = vscode.window.createOutputChannel('Test Channel');
		assert.ok(channel, 'Output channel should be created');
		assert.strictEqual(channel.name, 'Test Channel', 'Channel name should match');
		assert.ok(typeof channel.appendLine === 'function', 'Channel should have appendLine method');

		// Clean up
		channel.dispose();
	});
});