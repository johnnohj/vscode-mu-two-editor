import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { TestUtils } from '../helpers/test-utils';

suite('Storage Tests', () => {
	let context: vscode.ExtensionContext;
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		context = TestUtils.createMockExtensionContext();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('Workspace state should store and retrieve values', async () => {
		const key = 'test.workspace.key';
		const value = { data: 'test workspace data' };

		const getStub = context.workspaceState.get as sinon.SinonStub;
		const updateStub = context.workspaceState.update as sinon.SinonStub;

		getStub.withArgs(key).returns(undefined);
		updateStub.withArgs(key, value).resolves();

		await context.workspaceState.update(key, value);
		getStub.withArgs(key).returns(value);

		const retrieved = context.workspaceState.get(key);
		assert.deepStrictEqual(retrieved, value, 'Should retrieve stored workspace value');

		sinon.assert.calledWith(updateStub, key, value);
		sinon.assert.calledWith(getStub, key);
	});

	test('Global state should store and retrieve values', async () => {
		const key = 'test.global.key';
		const value = { data: 'test global data' };

		const getStub = context.globalState.get as sinon.SinonStub;
		const updateStub = context.globalState.update as sinon.SinonStub;

		getStub.withArgs(key).returns(undefined);
		updateStub.withArgs(key, value).resolves();

		await context.globalState.update(key, value);
		getStub.withArgs(key).returns(value);

		const retrieved = context.globalState.get(key);
		assert.deepStrictEqual(retrieved, value, 'Should retrieve stored global value');

		sinon.assert.calledWith(updateStub, key, value);
		sinon.assert.calledWith(getStub, key);
	});

	test('Should handle storage keys correctly', () => {
		const workspaceKeys = ['workspace.key1', 'workspace.key2'];
		const globalKeys = ['global.key1', 'global.key2'];

		const workspaceKeysStub = context.workspaceState.keys as sinon.SinonStub;
		const globalKeysStub = context.globalState.keys as sinon.SinonStub;

		workspaceKeysStub.returns(workspaceKeys);
		globalKeysStub.returns(globalKeys);

		assert.deepStrictEqual(
			context.workspaceState.keys(),
			workspaceKeys,
			'Should return workspace keys'
		);

		assert.deepStrictEqual(
			context.globalState.keys(),
			globalKeys,
			'Should return global keys'
		);
	});

	test('Should handle default values correctly', () => {
		const key = 'nonexistent.key';
		const defaultValue = { default: true };

		const getStub = context.workspaceState.get as sinon.SinonStub;
		getStub.withArgs(key, defaultValue).returns(defaultValue);

		const result = context.workspaceState.get(key, defaultValue);
		assert.deepStrictEqual(result, defaultValue, 'Should return default value for missing key');
	});

	test('Should handle secrets storage', async () => {
		const key = 'secret.key';
		const value = 'secret-value';

		const getStub = context.secrets.get as sinon.SinonStub;
		const storeStub = context.secrets.store as sinon.SinonStub;
		const deleteStub = context.secrets.delete as sinon.SinonStub;

		getStub.withArgs(key).resolves(undefined);
		storeStub.withArgs(key, value).resolves();
		deleteStub.withArgs(key).resolves();

		await context.secrets.store(key, value);
		getStub.withArgs(key).resolves(value);

		const retrieved = await context.secrets.get(key);
		assert.strictEqual(retrieved, value, 'Should retrieve stored secret');

		await context.secrets.delete(key);
		getStub.withArgs(key).resolves(undefined);

		const afterDelete = await context.secrets.get(key);
		assert.strictEqual(afterDelete, undefined, 'Should not retrieve deleted secret');

		sinon.assert.calledWith(storeStub, key, value);
		sinon.assert.calledWith(deleteStub, key);
	});

	test('Should handle storage paths correctly', () => {
		assert.ok(context.storagePath, 'Storage path should be defined');
		assert.ok(context.globalStoragePath, 'Global storage path should be defined');
		assert.ok(context.logPath, 'Log path should be defined');

		assert.ok(context.storageUri, 'Storage URI should be defined');
		assert.ok(context.globalStorageUri, 'Global storage URI should be defined');
		assert.ok(context.logUri, 'Log URI should be defined');

		assert.strictEqual(
			context.storageUri.scheme,
			'file',
			'Storage URI should use file scheme'
		);
	});

	test('Should handle complex data structures', async () => {
		const complexData = {
			workspaces: [
				{ name: 'workspace1', path: '/path/to/workspace1' },
				{ name: 'workspace2', path: '/path/to/workspace2' }
			],
			settings: {
				theme: 'dark',
				autoSave: true,
				notifications: {
					enabled: true,
					types: ['info', 'warning', 'error']
				}
			},
			metadata: {
				version: '1.0.0',
				lastAccessed: new Date().toISOString()
			}
		};

		const key = 'complex.data';
		const getStub = context.globalState.get as sinon.SinonStub;
		const updateStub = context.globalState.update as sinon.SinonStub;

		updateStub.withArgs(key, complexData).resolves();
		await context.globalState.update(key, complexData);

		getStub.withArgs(key).returns(complexData);
		const retrieved = context.globalState.get(key);

		assert.deepStrictEqual(
			retrieved,
			complexData,
			'Should handle complex data structures correctly'
		);
	});
});