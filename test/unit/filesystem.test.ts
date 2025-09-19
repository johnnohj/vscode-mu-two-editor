import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { TestUtils } from '../helpers/test-utils';

suite('Filesystem Tests', () => {
	let sandbox: sinon.SinonSandbox;
	let context: vscode.ExtensionContext;

	setup(() => {
		sandbox = sinon.createSandbox();
		context = TestUtils.createMockExtensionContext();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('Should use VS Code filesystem API', async () => {
		const testUri = vscode.Uri.file(path.join(__dirname, 'test-file.txt'));
		const testContent = new TextEncoder().encode('test content');

		// Mock filesystem operations
		const writeFileStub = sandbox.stub(vscode.workspace.fs, 'writeFile').resolves();
		const readFileStub = sandbox.stub(vscode.workspace.fs, 'readFile').resolves(testContent);
		const statStub = sandbox.stub(vscode.workspace.fs, 'stat').resolves({
			type: vscode.FileType.File,
			ctime: Date.now(),
			mtime: Date.now(),
			size: testContent.length
		});

		// Test write operation
		await vscode.workspace.fs.writeFile(testUri, testContent);
		sinon.assert.calledWith(writeFileStub, testUri, testContent);

		// Test read operation
		const readContent = await vscode.workspace.fs.readFile(testUri);
		sinon.assert.calledWith(readFileStub, testUri);
		assert.deepStrictEqual(readContent, testContent);

		// Test stat operation
		const stat = await vscode.workspace.fs.stat(testUri);
		sinon.assert.calledWith(statStub, testUri);
		assert.strictEqual(stat.type, vscode.FileType.File);
		assert.strictEqual(stat.size, testContent.length);
	});

	test('Should handle directory operations', async () => {
		const testDirUri = vscode.Uri.file(path.join(__dirname, 'test-directory'));

		// Mock directory operations
		const createDirectoryStub = sandbox.stub(vscode.workspace.fs, 'createDirectory').resolves();
		const readDirectoryStub = sandbox.stub(vscode.workspace.fs, 'readDirectory').resolves([
			['file1.py', vscode.FileType.File],
			['file2.txt', vscode.FileType.File],
			['subdir', vscode.FileType.Directory]
		]);
		const deleteStub = sandbox.stub(vscode.workspace.fs, 'delete').resolves();

		// Test create directory
		await vscode.workspace.fs.createDirectory(testDirUri);
		sinon.assert.calledWith(createDirectoryStub, testDirUri);

		// Test read directory
		const entries = await vscode.workspace.fs.readDirectory(testDirUri);
		sinon.assert.calledWith(readDirectoryStub, testDirUri);
		assert.strictEqual(entries.length, 3);
		assert.strictEqual(entries[0][0], 'file1.py');
		assert.strictEqual(entries[0][1], vscode.FileType.File);

		// Test delete directory
		await vscode.workspace.fs.delete(testDirUri, { recursive: true });
		sinon.assert.calledWith(deleteStub, testDirUri, { recursive: true });
	});

	test('Should handle file copy and rename operations', async () => {
		const sourceUri = vscode.Uri.file(path.join(__dirname, 'source.py'));
		const targetUri = vscode.Uri.file(path.join(__dirname, 'target.py'));
		const renamedUri = vscode.Uri.file(path.join(__dirname, 'renamed.py'));

		// Mock file operations
		const copyStub = sandbox.stub(vscode.workspace.fs, 'copy').resolves();
		const renameStub = sandbox.stub(vscode.workspace.fs, 'rename').resolves();

		// Test copy operation
		await vscode.workspace.fs.copy(sourceUri, targetUri);
		sinon.assert.calledWith(copyStub, sourceUri, targetUri);

		// Test rename operation
		await vscode.workspace.fs.rename(targetUri, renamedUri);
		sinon.assert.calledWith(renameStub, targetUri, renamedUri);
	});

	test('Should handle file watching', () => {
		const testUri = vscode.Uri.file(path.join(__dirname, 'watched-file.py'));
		const watchPattern = new vscode.RelativePattern(vscode.Uri.file(__dirname), '*.py');

		// Mock file watcher
		const mockWatcher = {
			onDidCreate: sandbox.stub(),
			onDidChange: sandbox.stub(),
			onDidDelete: sandbox.stub(),
			dispose: sandbox.stub()
		};

		const createFileSystemWatcherStub = sandbox.stub(vscode.workspace, 'createFileSystemWatcher')
			.returns(mockWatcher as any);

		// Create watcher
		const watcher = vscode.workspace.createFileSystemWatcher(watchPattern);

		sinon.assert.calledWith(createFileSystemWatcherStub, watchPattern);
		assert.ok(watcher.onDidCreate);
		assert.ok(watcher.onDidChange);
		assert.ok(watcher.onDidDelete);
		assert.ok(watcher.dispose);
	});

	test('Should handle workspace folder operations', () => {
		const mockWorkspaceFolder = TestUtils.createMockWorkspaceFolder('test-workspace');

		// Mock workspace folders
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([mockWorkspaceFolder]);

		const workspaceFolders = vscode.workspace.workspaceFolders;
		assert.ok(workspaceFolders);
		assert.strictEqual(workspaceFolders.length, 1);
		assert.strictEqual(workspaceFolders[0].name, 'test-workspace');
		assert.ok(workspaceFolders[0].uri);
		assert.strictEqual(workspaceFolders[0].index, 0);
	});

	test('Should handle workspace configuration', () => {
		const mockConfiguration = {
			get: sandbox.stub(),
			update: sandbox.stub().resolves(),
			has: sandbox.stub(),
			inspect: sandbox.stub()
		};

		sandbox.stub(vscode.workspace, 'getConfiguration').returns(mockConfiguration as any);

		// Test configuration access
		const config = vscode.workspace.getConfiguration('muTwo');
		assert.ok(config);

		// Test getting configuration value
		mockConfiguration.get.withArgs('defaultWorkspaceLocation').returns('/default/path');
		const defaultLocation = config.get('defaultWorkspaceLocation');
		assert.strictEqual(defaultLocation, '/default/path');

		// Test updating configuration
		config.update('defaultWorkspaceLocation', '/new/path', vscode.ConfigurationTarget.Global);
		sinon.assert.calledWith(
			mockConfiguration.update,
			'defaultWorkspaceLocation',
			'/new/path',
			vscode.ConfigurationTarget.Global
		);
	});

	test('Should handle relative path operations', () => {
		const workspaceFolder = TestUtils.createMockWorkspaceFolder();
		const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src', 'main.py');

		// Test URI path joining
		assert.ok(fileUri);
		assert.ok(fileUri.path.includes('main.py'));

		// Test relative path calculation
		const relativePath = vscode.workspace.asRelativePath(fileUri);
		assert.ok(typeof relativePath === 'string');
	});

	test('Should handle file errors gracefully', async () => {
		const nonExistentUri = vscode.Uri.file(path.join(__dirname, 'non-existent.txt'));

		// Mock file not found error
		const error = new Error('File not found');
		(error as any).code = 'FileNotFound';
		sandbox.stub(vscode.workspace.fs, 'readFile').rejects(error);

		try {
			await vscode.workspace.fs.readFile(nonExistentUri);
			assert.fail('Should throw error for non-existent file');
		} catch (err) {
			assert.ok(err instanceof Error);
			assert.strictEqual(err instanceof Error ? err.message : String(err), 'File not found');
		}
	});

	test('Should handle CircuitPython specific file operations', async () => {
		const codeUri = vscode.Uri.file(path.join(__dirname, 'code.py'));
		const mainUri = vscode.Uri.file(path.join(__dirname, 'main.py'));
		const libUri = vscode.Uri.file(path.join(__dirname, 'lib'));

		// Mock CircuitPython file structure
		const readDirectoryStub = sandbox.stub(vscode.workspace.fs, 'readDirectory').resolves([
			['code.py', vscode.FileType.File],
			['main.py', vscode.FileType.File],
			['lib', vscode.FileType.Directory],
			['boot.py', vscode.FileType.File]
		]);

		const statStub = sandbox.stub(vscode.workspace.fs, 'stat');
		statStub.withArgs(codeUri).resolves({
			type: vscode.FileType.File,
			ctime: Date.now(),
			mtime: Date.now(),
			size: 100
		});
		statStub.withArgs(libUri).resolves({
			type: vscode.FileType.Directory,
			ctime: Date.now(),
			mtime: Date.now(),
			size: 0
		});

		// Test checking for CircuitPython files
		const workspaceUri = vscode.Uri.file(__dirname);
		const entries = await vscode.workspace.fs.readDirectory(workspaceUri);

		const hasCodePy = entries.some(([name, type]) => name === 'code.py' && type === vscode.FileType.File);
		const hasMainPy = entries.some(([name, type]) => name === 'main.py' && type === vscode.FileType.File);
		const hasLibDir = entries.some(([name, type]) => name === 'lib' && type === vscode.FileType.Directory);

		assert.ok(hasCodePy, 'Should find code.py');
		assert.ok(hasMainPy, 'Should find main.py');
		assert.ok(hasLibDir, 'Should find lib directory');

		// Test file statistics
		const codeStat = await vscode.workspace.fs.stat(codeUri);
		assert.strictEqual(codeStat.type, vscode.FileType.File);
		assert.strictEqual(codeStat.size, 100);

		const libStat = await vscode.workspace.fs.stat(libUri);
		assert.strictEqual(libStat.type, vscode.FileType.Directory);
	});

	test('Should handle workspace file operations', async () => {
		const workspaceFile = vscode.Uri.file(path.join(__dirname, 'test.code-workspace'));
		const workspaceContent = {
			folders: [
				{ path: './project' },
				{ path: './libraries' }
			],
			settings: {
				'python.defaultInterpreterPath': '/path/to/python'
			}
		};

		const contentBuffer = new TextEncoder().encode(JSON.stringify(workspaceContent, null, 2));

		// Mock workspace file operations
		const writeFileStub = sandbox.stub(vscode.workspace.fs, 'writeFile').resolves();
		const readFileStub = sandbox.stub(vscode.workspace.fs, 'readFile').resolves(contentBuffer);

		// Test writing workspace file
		await vscode.workspace.fs.writeFile(workspaceFile, contentBuffer);
		sinon.assert.calledWith(writeFileStub, workspaceFile, contentBuffer);

		// Test reading workspace file
		const readContent = await vscode.workspace.fs.readFile(workspaceFile);
		const parsedContent = JSON.parse(new TextDecoder().decode(readContent));

		assert.deepStrictEqual(parsedContent, workspaceContent);
		assert.strictEqual(parsedContent.folders.length, 2);
		assert.ok(parsedContent.settings);
	});
});