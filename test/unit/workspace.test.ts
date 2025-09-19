import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { MuTwoWorkspace, WorkspaceConfig, BoardAssociation, WorkspaceRegistry, WorkspaceRegistryEntry } from '../../src/workspace/workspace';
import { MuTwoWorkspaceManager, WorkspaceCreationOptions } from '../../src/workspace/workspaceManager';
import { TestUtils } from '../helpers/test-utils';

suite('Workspace Tests', () => {
	let context: vscode.ExtensionContext;
	let workspaceManager: MuTwoWorkspaceManager;
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		context = TestUtils.createMockExtensionContext();
		workspaceManager = new MuTwoWorkspaceManager(context);
	});

	teardown(() => {
		sandbox.restore();
	});

	test('WorkspaceManager should initialize correctly', () => {
		assert.ok(workspaceManager, 'WorkspaceManager should be created');
		assert.ok(workspaceManager instanceof MuTwoWorkspaceManager);
	});

	test('Should handle workspace creation with device', async () => {
		const mockDevice = TestUtils.createMockCircuitPythonDevice();
		const options: WorkspaceCreationOptions = {
			device: mockDevice,
			workspaceName: 'Test Workspace'
		};

		// Mock the internal methods
		sandbox.stub(workspaceManager as any, 'handleBoardDetectedFlow').resolves(true);

		const result = await workspaceManager.createWorkspaceFlow(options);
		assert.strictEqual(result, true, 'Should successfully create workspace with device');
	});

	test('Should handle manual workspace creation', async () => {
		const options: WorkspaceCreationOptions = {
			workspaceName: 'Manual Test Workspace'
		};

		// Mock the internal methods
		sandbox.stub(workspaceManager as any, 'handleManualWorkspaceCreation').resolves(true);

		const result = await workspaceManager.createWorkspaceFlow(options);
		assert.strictEqual(result, true, 'Should successfully create manual workspace');
	});

	test('Should handle workspace creation errors gracefully', async () => {
		const options: WorkspaceCreationOptions = {
			workspaceName: 'Error Test Workspace'
		};

		// Mock to throw error
		sandbox.stub(workspaceManager as any, 'handleManualWorkspaceCreation')
			.rejects(new Error('Test error'));

		const showErrorStub = sandbox.stub(vscode.window, 'showErrorMessage');

		const result = await workspaceManager.createWorkspaceFlow(options);
		assert.strictEqual(result, false, 'Should return false on error');
		sinon.assert.calledOnce(showErrorStub);
	});

	test('WorkspaceConfig should have correct structure', () => {
		const config: WorkspaceConfig = {
			workspace_id: 'test-id',
			created_date: new Date().toISOString(),
			workspace_name: 'Test Workspace',
			pending_downloads: []
		};

		assert.strictEqual(config.workspace_id, 'test-id');
		assert.ok(config.created_date);
		assert.strictEqual(config.workspace_name, 'Test Workspace');
		assert.ok(Array.isArray(config.pending_downloads));
	});

	test('BoardAssociation should have correct structure', () => {
		const association: BoardAssociation = {
			board_name: 'Test Board',
			vid: '0x239a',
			pid: '0x80f4',
			serial_number: 'test123',
			last_connected: new Date().toISOString(),
			connection_count: 1,
			learn_guide_url: 'https://example.com/guide'
		};

		assert.strictEqual(association.board_name, 'Test Board');
		assert.strictEqual(association.vid, '0x239a');
		assert.strictEqual(association.pid, '0x80f4');
		assert.strictEqual(association.serial_number, 'test123');
		assert.ok(association.last_connected);
		assert.strictEqual(association.connection_count, 1);
		assert.strictEqual(association.learn_guide_url, 'https://example.com/guide');
	});

	test('WorkspaceRegistry should have correct structure', () => {
		const registry: WorkspaceRegistry = {
			machine_hash: 'test-hash',
			next_workspace_id: 1,
			version: '1.0.0',
			lastUpdated: new Date().toISOString(),
			workspaces: {}
		};

		assert.strictEqual(registry.machine_hash, 'test-hash');
		assert.strictEqual(registry.next_workspace_id, 1);
		assert.strictEqual(registry.version, '1.0.0');
		assert.ok(registry.lastUpdated);
		assert.ok(typeof registry.workspaces === 'object');
	});

	test('WorkspaceRegistryEntry should support URI and backward compatibility', () => {
		const entry: WorkspaceRegistryEntry = {
			id: 'workspace-1',
			name: 'Test Workspace',
			board_name: 'Test Board',
			workspace_path: '/path/to/workspace',
			workspace_uri: 'file:///path/to/workspace',
			created: new Date().toISOString(),
			last_accessed: new Date().toISOString(),
			lastAccessed: new Date().toISOString(),
			last_saved_project_uri: 'file:///path/to/project',
			last_saved_project_name: 'test_project',
			board_vid_pid: '0x239a:0x80f4',
			deviceAssociation: {
				boardName: 'Test Board',
				vidPid: '0x239a:0x80f4',
				serialNumber: 'test123'
			},
			files: {
				workspaceFile: '/path/to/workspace.code-workspace',
				initialConfig: '/path/to/initial-config.json',
				directory: '/path/to/.files'
			},
			metadata: {
				projectDirectory: '/path/to/project',
				hasInitialBackup: true,
				version: '1.0.0'
			},
			workspace_file: '/path/to/workspace.code-workspace',
			workspace_file_uri: 'file:///path/to/workspace.code-workspace',
			workspace_type: 'dual-root'
		};

		// Test basic properties
		assert.strictEqual(entry.id, 'workspace-1');
		assert.strictEqual(entry.name, 'Test Workspace');
		assert.strictEqual(entry.board_name, 'Test Board');

		// Test backward compatibility
		assert.strictEqual(entry.workspace_path, '/path/to/workspace');
		assert.strictEqual(entry.workspace_uri, 'file:///path/to/workspace');

		// Test device association
		assert.ok(entry.deviceAssociation);
		assert.strictEqual(entry.deviceAssociation.boardName, 'Test Board');
		assert.strictEqual(entry.deviceAssociation.vidPid, '0x239a:0x80f4');

		// Test files structure
		assert.ok(entry.files);
		assert.strictEqual(entry.files.workspaceFile, '/path/to/workspace.code-workspace');
		assert.strictEqual(entry.files.initialConfig, '/path/to/initial-config.json');
		assert.strictEqual(entry.files.directory, '/path/to/.files');

		// Test metadata
		assert.ok(entry.metadata);
		assert.strictEqual(entry.metadata.hasInitialBackup, true);
		assert.strictEqual(entry.metadata.version, '1.0.0');

		// Test dual workspace support
		assert.strictEqual(entry.workspace_type, 'dual-root');
		assert.strictEqual(entry.workspace_file_uri, 'file:///path/to/workspace.code-workspace');
	});

	test('Should handle existing workspace for board', async () => {
		const mockDevice = TestUtils.createMockCircuitPythonDevice();

		// Mock finding existing workspace
		const mockWorkspace: WorkspaceRegistryEntry = {
			id: 'existing-1',
			name: 'Existing Workspace',
			workspace_path: '/path/to/existing',
			created: new Date().toISOString(),
			last_accessed: new Date().toISOString(),
			lastAccessed: new Date().toISOString(),
			files: {
				workspaceFile: '/path/to/existing.code-workspace',
				initialConfig: '/path/to/initial-config.json',
				directory: '/path/to/.files'
			},
			metadata: {
				hasInitialBackup: true,
				version: '1.0.0'
			}
		};

		// Mock workspace utility
		const findWorkspaceStub = sandbox.stub().resolves(mockWorkspace);
		sandbox.stub(workspaceManager as any, '_workspaceUtil').value({
			findWorkspaceForBoard: findWorkspaceStub
		});

		// Mock user choice to open existing
		sandbox.stub(vscode.window, 'showInformationMessage').resolves('Open Existing');
		const openExistingStub = sandbox.stub(workspaceManager as any, 'openExistingWorkspace').resolves(true);

		const result = await (workspaceManager as any).handleBoardDetectedFlow(mockDevice, false);

		assert.strictEqual(result, true);
		sinon.assert.calledWith(findWorkspaceStub, mockDevice);
		sinon.assert.calledWith(openExistingStub, mockWorkspace.workspace_path);
	});

	test('Should handle force new workspace creation', async () => {
		const mockDevice = TestUtils.createMockCircuitPythonDevice();

		// Mock existing workspace but force new creation
		const mockWorkspace: WorkspaceRegistryEntry = {
			id: 'existing-1',
			name: 'Existing Workspace',
			workspace_path: '/path/to/existing',
			created: new Date().toISOString(),
			last_accessed: new Date().toISOString(),
			lastAccessed: new Date().toISOString(),
			files: {
				workspaceFile: '/path/to/existing.code-workspace',
				initialConfig: '/path/to/initial-config.json',
				directory: '/path/to/.files'
			},
			metadata: {
				hasInitialBackup: true,
				version: '1.0.0'
			}
		};

		sandbox.stub(workspaceManager as any, '_workspaceUtil').value({
			findWorkspaceForBoard: sandbox.stub().resolves(mockWorkspace)
		});

		const createNewStub = sandbox.stub(workspaceManager as any, 'createNewWorkspace').resolves(true);

		// Force new should skip the existing workspace check
		const result = await (workspaceManager as any).handleBoardDetectedFlow(mockDevice, true);

		assert.strictEqual(result, true);
		sinon.assert.calledOnce(createNewStub);
	});

	test('Should handle manual workspace creation choices', async () => {
		const options: WorkspaceCreationOptions = {
			workspaceName: 'Manual Workspace'
		};

		// Test "Create Virtual Workspace" choice
		sandbox.stub(vscode.window, 'showInformationMessage').resolves('Create Virtual Workspace');
		const createNewStub = sandbox.stub(workspaceManager as any, 'createNewWorkspace').resolves(true);

		let result = await (workspaceManager as any).handleManualWorkspaceCreation(options);
		assert.strictEqual(result, true);
		sinon.assert.calledWith(createNewStub, options);

		// Reset stubs
		sandbox.restore();
		sandbox = sinon.createSandbox();

		// Test "Wait for Board" choice
		sandbox.stub(vscode.window, 'showInformationMessage').resolves('Wait for Board');
		const showInfoStub = sandbox.stub(vscode.window, 'showInformationMessage');

		result = await (workspaceManager as any).handleManualWorkspaceCreation(options);
		assert.strictEqual(result, false);

		// Test "Cancel" choice
		sandbox.restore();
		sandbox = sinon.createSandbox();
		sandbox.stub(vscode.window, 'showInformationMessage').resolves('Cancel');

		result = await (workspaceManager as any).handleManualWorkspaceCreation(options);
		assert.strictEqual(result, false);
	});
});