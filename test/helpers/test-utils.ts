import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';

export class TestUtils {
	public static createMockExtensionContext(): vscode.ExtensionContext {
		const extensionPath = path.join(__dirname, '..', '..');

		return {
			subscriptions: [],
			workspaceState: {
				get: sinon.stub(),
				update: sinon.stub().resolves(),
				keys: sinon.stub().returns([])
			},
			globalState: {
				get: sinon.stub(),
				update: sinon.stub().resolves(),
				keys: sinon.stub().returns([]),
				setKeysForSync: sinon.stub()
			},
			extensionPath,
			extensionUri: vscode.Uri.file(extensionPath),
			storagePath: path.join(extensionPath, 'test-storage'),
			globalStoragePath: path.join(extensionPath, 'test-global-storage'),
			logPath: path.join(extensionPath, 'test-logs'),
			asAbsolutePath: (relativePath: string) => path.join(extensionPath, relativePath),
			storageUri: vscode.Uri.file(path.join(extensionPath, 'test-storage')),
			globalStorageUri: vscode.Uri.file(path.join(extensionPath, 'test-global-storage')),
			logUri: vscode.Uri.file(path.join(extensionPath, 'test-logs')),
			extensionMode: vscode.ExtensionMode.Test,
			environmentVariableCollection: {
				persistent: true,
				replace: sinon.stub(),
				append: sinon.stub(),
				prepend: sinon.stub(),
				get: sinon.stub(),
				forEach: sinon.stub(),
				delete: sinon.stub(),
				clear: sinon.stub(),
				[Symbol.iterator]: sinon.stub()
			},
			secrets: {
				get: sinon.stub().resolves(),
				store: sinon.stub().resolves(),
				delete: sinon.stub().resolves(),
				onDidChange: sinon.stub()
			},
			extension: {
				id: 'mu-two.mu-two-editor',
				extensionUri: vscode.Uri.file(extensionPath),
				extensionPath,
				isActive: true,
				packageJSON: {},
				extensionKind: vscode.ExtensionKind.Workspace,
				exports: undefined,
				activate: sinon.stub().resolves()
			},
			languageModelAccessInformation: {
				canSendRequest: sinon.stub().resolves(),
				onDidChange: sinon.stub()
			}
		} as any;
	}

	public static createMockWorkspaceFolder(name: string = 'test-workspace'): vscode.WorkspaceFolder {
		const workspacePath = path.join(__dirname, '..', 'fixtures', name);
		return {
			uri: vscode.Uri.file(workspacePath),
			name,
			index: 0
		};
	}

	public static createMockTextDocument(content: string = '', fileName: string = 'test.py'): vscode.TextDocument {
		return {
			uri: vscode.Uri.file(path.join(__dirname, '..', 'fixtures', fileName)),
			fileName: path.join(__dirname, '..', 'fixtures', fileName),
			isUntitled: false,
			languageId: 'python',
			version: 1,
			isDirty: false,
			isClosed: false,
			save: sinon.stub().resolves(true),
			eol: vscode.EndOfLine.LF,
			lineCount: content.split('\n').length,
			getText: sinon.stub().returns(content),
			getWordRangeAtPosition: sinon.stub(),
			validateRange: sinon.stub(),
			validatePosition: sinon.stub(),
			offsetAt: sinon.stub(),
			positionAt: sinon.stub(),
			lineAt: sinon.stub()
		} as any;
	}

	public static sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	public static async waitForCondition(
		condition: () => boolean | Promise<boolean>,
		timeoutMs: number = 5000,
		intervalMs: number = 100
	): Promise<void> {
		const startTime = Date.now();
		while (Date.now() - startTime < timeoutMs) {
			const result = await condition();
			if (result) {
				return;
			}
			await this.sleep(intervalMs);
		}
		throw new Error(`Condition not met within ${timeoutMs}ms`);
	}

	public static createSerialPortMock(): any {
		return {
			path: 'COM3',
			manufacturer: 'Adafruit',
			serialNumber: 'test123',
			vendorId: '239a',
			productId: '80f4',
			isOpen: true,
			baudRate: 115200,
			open: sinon.stub().callsArg(0),
			close: sinon.stub().callsArg(0),
			write: sinon.stub().callsArg(1),
			read: sinon.stub(),
			on: sinon.stub(),
			removeListener: sinon.stub(),
			removeAllListeners: sinon.stub()
		};
	}

	public static createMockCircuitPythonDevice(): any {
		return {
			name: 'Test CircuitPython Device',
			port: 'COM3',
			vendorId: 0x239a,
			productId: 0x80f4,
			manufacturer: 'Adafruit Industries LLC',
			serialNumber: 'test123',
			boardName: 'Feather ESP32-S2',
			isConnected: true,
			capabilities: ['repl', 'files', 'serial']
		};
	}
}