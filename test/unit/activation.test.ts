import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { TestUtils } from '../helpers/test-utils';

suite('Extension Activation Tests', () => {
	let context: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		context = TestUtils.createMockExtensionContext();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('Extension should activate successfully', async () => {
		const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
		assert.ok(extension, 'Extension should be found');

		if (!extension.isActive) {
			await extension.activate();
		}

		assert.strictEqual(extension.isActive, true, 'Extension should be activated');
	});

	test('Extension should register all commands', async () => {
		const expectedCommands = [
			'muTwo.workspace.create',
			'muTwo.workspace.open',
			'muTwo.workspace.list',
			'muTwo.workspace.delete',
			'muTwo.workspace.refresh',
			'muTwo.workspace.manage',
			'muTwo.workspace.restoreToInitial',
			'muTwo.showWelcome',
			'muTwo.editor.showPanel',
			'muTwo.editor.hidePanel',
			'muTwo.editor.openEditor',
			'muTwo.debug.startSession',
			'muTwo.debug.stopSession',
			'muTwo.debug.restartDevice',
			'muTwo.debug.detectDevices',
			'muTwo.debug.showDeviceInfo',
			'muTwo.debug.selectDevice'
		];

		const commands = await vscode.commands.getCommands(true);

		for (const expectedCommand of expectedCommands) {
			assert.ok(
				commands.includes(expectedCommand),
				`Command ${expectedCommand} should be registered`
			);
		}
	});

	test('Extension should set context variables on activation', async () => {
		const setContextStub = sandbox.stub(vscode.commands, 'executeCommand');

		const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
		assert.ok(extension);

		if (!extension.isActive) {
			await extension.activate();
		}

		assert.ok(
			setContextStub.calledWith('setContext', 'muTwo.fullyActivated', true),
			'Should set muTwo.fullyActivated context'
		);
	});

	test('Extension should initialize storage correctly', () => {
		assert.ok(context.workspaceState, 'Workspace state should be available');
		assert.ok(context.globalState, 'Global state should be available');
		assert.ok(context.storageUri, 'Storage URI should be available');
		assert.ok(context.globalStorageUri, 'Global storage URI should be available');
	});

	test('Extension should have correct package.json properties', () => {
		const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
		assert.ok(extension);

		const packageJson = extension.packageJSON;
		assert.strictEqual(packageJson.name, 'mu-two-editor');
		assert.strictEqual(packageJson.displayName, 'Mu 2 Editor');
		assert.ok(packageJson.version);
		assert.ok(packageJson.engines.vscode);
	});
});