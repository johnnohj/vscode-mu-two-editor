"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestUtils = void 0;
const vscode = __importStar(require("vscode"));
const sinon = __importStar(require("sinon"));
const path = __importStar(require("path"));
class TestUtils {
    static createMockExtensionContext() {
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
            asAbsolutePath: (relativePath) => path.join(extensionPath, relativePath),
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
        };
    }
    static createMockWorkspaceFolder(name = 'test-workspace') {
        const workspacePath = path.join(__dirname, '..', 'fixtures', name);
        return {
            uri: vscode.Uri.file(workspacePath),
            name,
            index: 0
        };
    }
    static createMockTextDocument(content = '', fileName = 'test.py') {
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
        };
    }
    static sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    static async waitForCondition(condition, timeoutMs = 5000, intervalMs = 100) {
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
    static createSerialPortMock() {
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
    static createMockCircuitPythonDevice() {
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
exports.TestUtils = TestUtils;
//# sourceMappingURL=test-utils.js.map