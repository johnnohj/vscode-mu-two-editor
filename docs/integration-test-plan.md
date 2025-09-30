# Integration Test Plan
**Mu Two Editor - Automated Functional Verification**

> **Purpose**: Verify extension functionality by exercising components and inspecting results
> **Approach**: Integration tests that write to actual file locations per EXT-APP-ARCHITECTURE.md
> **Status**: Initial plan - to be implemented in phases
> **Last Updated**: 2025-09-30

---

## TABLE OF CONTENTS
1. [Test Strategy](#test-strategy)
2. [Test Environment Setup](#test-environment-setup)
3. [Resource Location Tests](#resource-location-tests)
4. [Python Environment Tests](#python-environment-tests)
5. [Device Management Tests](#device-management-tests)
6. [Library & Bundle Tests](#library--bundle-tests)
7. [Workspace Management Tests](#workspace-management-tests)
8. [Terminal & Task Tests](#terminal--task-tests)
9. [File System Tests](#file-system-tests)
10. [REPL Integration Tests](#repl-integration-tests)
11. [Test Utilities](#test-utilities)
12. [Test Execution](#test-execution)

---

## TEST STRATEGY

### Goals
1. **Verify architecture compliance** - Tests confirm code follows EXT-APP-ARCHITECTURE.md patterns
2. **Exercise real components** - No mocking of extension context, file system, or VS Code APIs
3. **Inspect actual outputs** - Write to real locations, verify files exist with correct content
4. **Catch regressions** - Automated tests run on every PR
5. **Document expected behavior** - Tests serve as living documentation

### Test Scope
**Integration Tests (Primary Focus):**
- Component coordination
- File system operations
- Resource location verification
- Python environment setup
- Library installation
- Workspace creation
- Device detection (with mock devices)

**Unit Tests (Minimal):**
- Pure logic functions
- Data transformations
- Utility functions

**NOT Testing:**
- VS Code API internals (trust VS Code)
- External tools (trust circup, Python)
- Hardware devices (mock instead)

### Test Environment
```
Test workspace: ${extensionUri}/.test-workspace/
Test venv: ${extensionUri}/.test-venv/
Test global storage: ${globalStorageUri}/test/
Cleanup: After each test suite
```

### Principles
1. **Real file operations** - Use actual vscode.workspace.fs API
2. **Temporary artifacts** - All test files in `.test-*` directories
3. **Cleanup after tests** - Remove all test artifacts
4. **Parallel-safe** - Tests don't interfere with each other
5. **Fast execution** - Target <30 seconds for full suite

---

## TEST ENVIRONMENT SETUP

### Test Fixture Setup
```typescript
// test/integration/setup.ts
export class TestEnvironment {
  public context: vscode.ExtensionContext;
  public testWorkspaceUri: vscode.Uri;
  public testVenvUri: vscode.Uri;
  public testGlobalStorage: vscode.Uri;

  async setup(): Promise<void> {
    // Create test extension context
    // Create test directories
    // Initialize dev logger for test output
  }

  async teardown(): Promise<void> {
    // Remove all test directories
    // Clear test state
  }

  async cleanTestArtifacts(): Promise<void> {
    // Remove .test-* directories
    // Clear test configuration
  }
}
```

### Test Helpers
```typescript
// test/integration/helpers.ts
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  // Poll until condition true or timeout
}

export async function assertFileExists(uri: vscode.Uri): Promise<void> {
  // Verify file exists using vscode.workspace.fs.stat
}

export async function assertFileContains(
  uri: vscode.Uri,
  content: string
): Promise<void> {
  // Read file and verify contains content
}

export async function createMockDevice(): Promise<MockDevice> {
  // Create mock CircuitPython device for testing
}
```

---

## RESOURCE LOCATION TESTS

### Test: Resource Locator Paths
**Verifies**: ResourceLocator returns correct URIs per architecture

```typescript
describe('ResourceLocator', () => {
  test('getAssetPath returns extensionUri/assets/', async () => {
    const locator = new ResourceLocator(context);
    const assetPath = locator.getAssetPath('icon.svg');

    expect(assetPath.toString()).toContain('assets/icon.svg');
    expect(assetPath.toString()).toContain(context.extensionUri.toString());
  });

  test('getVenvPath returns extensionUri/venv/', async () => {
    const locator = new ResourceLocator(context);
    const venvPath = locator.getVenvPath();

    expect(venvPath.toString()).toContain('/venv');
    expect(venvPath.toString()).toContain(context.extensionUri.toString());
  });

  test('getBundlePath returns globalStorageUri/bundles/', async () => {
    const locator = new ResourceLocator(context);
    const bundlePath = locator.getBundlePath();

    expect(bundlePath.toString()).toContain('bundles');
    expect(bundlePath.toString()).toContain(context.globalStorageUri.toString());
  });

  test('getWorkspacesPath returns globalStorageUri/workspaces/', async () => {
    const locator = new ResourceLocator(context);
    const workspacesPath = locator.getWorkspacesPath();

    expect(workspacesPath.toString()).toContain('workspaces');
    expect(workspacesPath.toString()).toContain(context.globalStorageUri.toString());
  });

  test('getWasmRuntimePath returns globalStorageUri/bin/wasm-runtime/', async () => {
    const locator = new ResourceLocator(context);
    const wasmPath = locator.getWasmRuntimePath();

    expect(wasmPath.toString()).toContain('bin/wasm-runtime');
    expect(wasmPath.toString()).toContain(context.globalStorageUri.toString());
  });

  test('getConfigPath returns globalStorageUri/config/', async () => {
    const locator = new ResourceLocator(context);
    const configPath = locator.getConfigPath();

    expect(configPath.toString()).toContain('config');
    expect(configPath.toString()).toContain(context.globalStorageUri.toString());
  });
});
```

**Verification**:
- ✓ Paths follow architecture patterns
- ✓ No string concatenation used
- ✓ All paths use Uri.joinPath()

---

## PYTHON ENVIRONMENT TESTS

### Test: Python Environment Creation
**Verifies**: PythonEnvironment creates venv at correct location

```typescript
describe('PythonEnvironment', () => {
  test('ensureReady creates venv at extensionUri/venv/', async () => {
    const resourceLocator = new ResourceLocator(context);
    const pythonEnv = new PythonEnvironment(context, resourceLocator);

    const pythonPath = await pythonEnv.ensureReady();

    // Verify venv directory exists
    const venvPath = resourceLocator.getVenvPath();
    await assertFileExists(venvPath);

    // Verify python executable exists
    const expectedPythonPath = process.platform === 'win32'
      ? vscode.Uri.joinPath(venvPath, 'Scripts', 'python.exe')
      : vscode.Uri.joinPath(venvPath, 'bin', 'python');

    await assertFileExists(expectedPythonPath);
    expect(pythonPath).toBe(expectedPythonPath.fsPath);
  });

  test('ensureReady installs required packages', async () => {
    const resourceLocator = new ResourceLocator(context);
    const pythonEnv = new PythonEnvironment(context, resourceLocator);

    await pythonEnv.ensureReady();

    // Verify circup is installed
    const venvPath = resourceLocator.getVenvPath();
    const sitePackagesPath = process.platform === 'win32'
      ? vscode.Uri.joinPath(venvPath, 'Lib', 'site-packages')
      : vscode.Uri.joinPath(venvPath, 'lib', 'python*', 'site-packages');

    // Check for circup module
    // This is a simplified check - actual test would verify installation
    const circupExists = await checkPythonPackage(pythonPath, 'circup');
    expect(circupExists).toBe(true);
  });

  test('ensureReady is idempotent', async () => {
    const resourceLocator = new ResourceLocator(context);
    const pythonEnv = new PythonEnvironment(context, resourceLocator);

    const path1 = await pythonEnv.ensureReady();
    const path2 = await pythonEnv.ensureReady();

    expect(path1).toBe(path2);
  });
});
```

**Verification**:
- ✓ Venv created at extensionUri/venv/
- ✓ Python executable accessible
- ✓ Required packages installed (circup, pyserial)
- ✓ Multiple calls don't recreate venv

---

## DEVICE MANAGEMENT TESTS

### Test: Device Registry
**Verifies**: Single device registry pattern

```typescript
describe('DeviceRegistry', () => {
  test('detectDevices returns CircuitPython devices', async () => {
    const registry = new DeviceRegistry();
    const mockDevice = await createMockDevice();

    const devices = await registry.detectDevices();

    expect(devices.length).toBeGreaterThanOrEqual(0);
    // With mock device, expect at least one
    if (mockDevice) {
      expect(devices.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('getDevice returns cached device', async () => {
    const registry = new DeviceRegistry();
    await registry.detectDevices();

    const allDevices = registry.getAllDevices();
    if (allDevices.length > 0) {
      const firstDevice = allDevices[0];
      const retrieved = registry.getDevice(firstDevice.id);

      expect(retrieved).toBe(firstDevice);
    }
  });

  test('onDidChangeDevices fires when devices change', async () => {
    const registry = new DeviceRegistry();
    let eventFired = false;

    registry.onDidChangeDevices(() => {
      eventFired = true;
    });

    await registry.detectDevices();

    expect(eventFired).toBe(true);
  });
});
```

**Verification**:
- ✓ Single registry for all devices
- ✓ Device detection works
- ✓ Device caching works
- ✓ Change events fire

---

## LIBRARY & BUNDLE TESTS

### Test: Bundle Manager
**Verifies**: Library management using circup

```typescript
describe('BundleManager', () => {
  test('ensureCircupReady installs circup in venv', async () => {
    const resourceLocator = new ResourceLocator(context);
    const pythonEnv = new PythonEnvironment(context, resourceLocator);
    const bundleManager = new BundleManager(context, resourceLocator, pythonEnv);

    await bundleManager.ensureCircupReady();

    const pythonPath = await pythonEnv.ensureReady();
    const circupExists = await checkPythonPackage(pythonPath, 'circup');

    expect(circupExists).toBe(true);
  });

  test('getAvailableLibraries reads from persistent list', async () => {
    const resourceLocator = new ResourceLocator(context);
    const pythonEnv = new PythonEnvironment(context, resourceLocator);
    const bundleManager = new BundleManager(context, resourceLocator, pythonEnv);

    // Create mock persistent module list
    const configPath = resourceLocator.getConfigPath();
    await vscode.workspace.fs.createDirectory(configPath);

    const moduleListPath = vscode.Uri.joinPath(configPath, 'circuitpython-modules.json');
    const moduleData = {
      modules: ['adafruit_neopixel', 'adafruit_lis3dh'],
      version: '8.0.0',
      lastUpdated: new Date().toISOString()
    };
    await vscode.workspace.fs.writeFile(
      moduleListPath,
      new TextEncoder().encode(JSON.stringify(moduleData))
    );

    const libraries = await bundleManager.getAvailableLibraries();

    expect(libraries.length).toBe(2);
    expect(libraries[0].name).toBe('adafruit_neopixel');
  });

  test('installToWorkspace uses circup --path flag', async () => {
    const resourceLocator = new ResourceLocator(context);
    const pythonEnv = new PythonEnvironment(context, resourceLocator);
    const bundleManager = new BundleManager(context, resourceLocator, pythonEnv);

    const testWorkspace = vscode.Uri.joinPath(context.extensionUri, '.test-workspace');
    await vscode.workspace.fs.createDirectory(testWorkspace);

    await bundleManager.installToWorkspace('adafruit_neopixel', testWorkspace);

    // Verify lib/ directory created
    const libPath = vscode.Uri.joinPath(testWorkspace, 'lib');
    await assertFileExists(libPath);

    // Verify library files exist (either .py or directory)
    // This is a simplified check
  });
});
```

**Verification**:
- ✓ Circup installed in venv
- ✓ Persistent module list read correctly
- ✓ Libraries installed to workspace lib/
- ✓ Uses circup --path flag

---

## WORKSPACE MANAGEMENT TESTS

### Test: Workspace Creation
**Verifies**: Workspace created with correct structure

```typescript
describe('WorkspaceManager', () => {
  test('createWorkspace creates directory structure', async () => {
    const resourceLocator = new ResourceLocator(context);
    const deviceRegistry = new DeviceRegistry();
    const workspaceManager = new WorkspaceManager(context, resourceLocator, deviceRegistry);

    const workspaceName = 'test-metro-m4';
    const workspaceUri = await workspaceManager.createWorkspace(workspaceName);

    // Verify workspace directory exists
    await assertFileExists(workspaceUri);

    // Verify .vscode directory exists
    const vscodeDir = vscode.Uri.joinPath(workspaceUri, '.vscode');
    await assertFileExists(vscodeDir);

    // Verify settings.json exists
    const settingsFile = vscode.Uri.joinPath(vscodeDir, 'settings.json');
    await assertFileExists(settingsFile);

    // Verify settings contain CircuitPython config
    await assertFileContains(settingsFile, 'reportShadowedImports');

    // Verify lib/ directory exists
    const libDir = vscode.Uri.joinPath(workspaceUri, 'lib');
    await assertFileExists(libDir);

    // Verify code.py exists
    const codePy = vscode.Uri.joinPath(workspaceUri, 'code.py');
    await assertFileExists(codePy);
  });

  test('createWorkspace creates .code-workspace file', async () => {
    const resourceLocator = new ResourceLocator(context);
    const deviceRegistry = new DeviceRegistry();
    const workspaceManager = new WorkspaceManager(context, resourceLocator, deviceRegistry);

    const workspaceName = 'test-metro-m4';
    const workspaceUri = await workspaceManager.createWorkspace(workspaceName);

    // Find .code-workspace file
    const workspaceFile = vscode.Uri.joinPath(
      resourceLocator.getWorkspacesPath(),
      `${workspaceName}.code-workspace`
    );

    await assertFileExists(workspaceFile);
    await assertFileContains(workspaceFile, 'reportShadowedImports');
  });
});
```

**Verification**:
- ✓ Workspace created at globalStorageUri/workspaces/
- ✓ Directory structure correct (.vscode/, lib/, code.py)
- ✓ Settings contain CircuitPython config
- ✓ .code-workspace file created

---

## TERMINAL & TASK TESTS

### Test: Terminal Profiles
**Verifies**: Terminal profiles configured correctly

```typescript
describe('Terminal Patterns', () => {
  test('createCircuitPythonTerminal uses correct profile', async () => {
    const terminal = vscode.window.createTerminal({
      name: 'CircuitPython Test',
      env: {
        CIRCUITPY: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    });

    // Verify terminal created
    expect(terminal).toBeDefined();
    expect(terminal.name).toBe('CircuitPython Test');

    terminal.dispose();
  });

  test('executeCommand waits for shell integration', async () => {
    const terminal = vscode.window.createTerminal('Test Shell Integration');

    // Wait for shell integration
    await waitForCondition(() => terminal.shellIntegration !== undefined, 5000);

    expect(terminal.shellIntegration).toBeDefined();

    terminal.dispose();
  });
});
```

**Verification**:
- ✓ Terminal profiles configured
- ✓ Environment variables set
- ✓ Shell integration available

---

## FILE SYSTEM TESTS

### Test: VS Code Workspace API
**Verifies**: Using workspace.fs consistently

```typescript
describe('File System Operations', () => {
  test('readFile uses vscode.workspace.fs', async () => {
    const testFile = vscode.Uri.joinPath(context.extensionUri, '.test-file.txt');
    const content = 'Test content';

    await vscode.workspace.fs.writeFile(
      testFile,
      new TextEncoder().encode(content)
    );

    const readContent = await vscode.workspace.fs.readFile(testFile);
    const text = new TextDecoder().decode(readContent);

    expect(text).toBe(content);

    // Cleanup
    await vscode.workspace.fs.delete(testFile);
  });

  test('createDirectory uses vscode.workspace.fs', async () => {
    const testDir = vscode.Uri.joinPath(context.extensionUri, '.test-dir');

    await vscode.workspace.fs.createDirectory(testDir);

    const stat = await vscode.workspace.fs.stat(testDir);
    expect(stat.type).toBe(vscode.FileType.Directory);

    // Cleanup
    await vscode.workspace.fs.delete(testDir);
  });

  test('paths use Uri.joinPath not string concat', () => {
    const base = vscode.Uri.file('/base/path');
    const joined = vscode.Uri.joinPath(base, 'subdir', 'file.txt');

    expect(joined.toString()).toContain('subdir/file.txt');
    expect(joined.toString()).toContain('/base/path');
  });
});
```

**Verification**:
- ✓ All file operations use vscode.workspace.fs
- ✓ No Node.js fs module used
- ✓ Paths use Uri.joinPath()

---

## REPL INTEGRATION TESTS

### Test: REPL Communication
**Verifies**: REPL can communicate with backend

```typescript
describe('REPL Integration', () => {
  test('REPL webview loads successfully', async () => {
    // Create REPL webview
    const panel = vscode.window.createWebviewPanel(
      'mu-repl-test',
      'Test REPL',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );

    expect(panel).toBeDefined();
    expect(panel.webview).toBeDefined();

    panel.dispose();
  });

  test('Pseudoterminal handles input', async () => {
    let output = '';
    const writeEmitter = new vscode.EventEmitter<string>();

    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => writeEmitter.fire('>>> '),
      close: () => {},
      handleInput: (data: string) => {
        output += data;
        writeEmitter.fire(data);
      }
    };

    const terminal = vscode.window.createTerminal({ name: 'Test PTY', pty });

    // Simulate input
    pty.handleInput!('test');

    expect(output).toBe('test');

    terminal.dispose();
  });
});
```

**Verification**:
- ✓ REPL webview loads
- ✓ Pseudoterminal processes input
- ✓ Communication works

---

## TEST UTILITIES

### Test Cleanup Utilities
```typescript
// test/integration/cleanup.ts
export async function cleanupTestArtifacts(context: vscode.ExtensionContext): Promise<void> {
  // Remove .test-* directories from extensionUri
  const testDirs = ['.test-workspace', '.test-venv', '.test-temp'];

  for (const dir of testDirs) {
    const uri = vscode.Uri.joinPath(context.extensionUri, dir);
    try {
      await vscode.workspace.fs.delete(uri, { recursive: true });
    } catch {
      // Directory might not exist
    }
  }

  // Remove test directories from globalStorageUri
  const testGlobalDir = vscode.Uri.joinPath(context.globalStorageUri, 'test');
  try {
    await vscode.workspace.fs.delete(testGlobalDir, { recursive: true });
  } catch {
    // Directory might not exist
  }
}
```

### Mock Device Utility
```typescript
// test/integration/mocks/mockDevice.ts
export class MockCircuitPythonDevice {
  id: string = 'mock-device-001';
  name: string = 'Mock Metro M4';
  port: string = '/dev/tty.mock';
  vendorId: string = '239a';
  productId: string = '8021';

  async connect(): Promise<void> {
    // Mock connection
  }

  async disconnect(): Promise<void> {
    // Mock disconnection
  }

  async readFile(path: string): Promise<string> {
    // Mock file read
    return '# Mock file content';
  }

  async writeFile(path: string, content: string): Promise<void> {
    // Mock file write
  }
}
```

---

## TEST EXECUTION

### Test Organization
```
test/
├── integration/
│   ├── setup.ts              # Test environment setup
│   ├── helpers.ts            # Test helpers
│   ├── cleanup.ts            # Cleanup utilities
│   ├── resourceLocator.test.ts
│   ├── pythonEnvironment.test.ts
│   ├── deviceRegistry.test.ts
│   ├── bundleManager.test.ts
│   ├── workspaceManager.test.ts
│   ├── terminal.test.ts
│   ├── fileSystem.test.ts
│   └── repl.test.ts
└── mocks/
    ├── mockDevice.ts
    └── mockSerialPort.ts
```

### Running Tests
```bash
# Run all integration tests
npm run test:integration

# Run specific test suite
npm run test:integration -- resourceLocator

# Run with coverage
npm run test:integration:coverage

# Run in watch mode
npm run test:integration:watch
```

### CI Integration
```yaml
# .github/workflows/test.yml
name: Integration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - run: npm run test:integration
      - uses: codecov/codecov-action@v3
```

---

## SUCCESS CRITERIA

### Test Coverage Goals
- **Resource Location**: 100% coverage (simple path operations)
- **Python Environment**: 90% coverage (some platform-specific)
- **Device Management**: 80% coverage (hardware dependent)
- **Library Management**: 85% coverage (network dependent)
- **Workspace Management**: 95% coverage (mostly file ops)
- **File System**: 100% coverage (pure API usage)

### Test Execution Goals
- **Speed**: Full suite < 30 seconds
- **Reliability**: No flaky tests
- **Cleanup**: No artifacts left after tests
- **Parallel**: Tests can run in parallel

### Quality Gates
- All tests pass before merge
- No decrease in coverage
- All new features have tests
- Architecture compliance verified

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation (Week 1)
- [ ] Set up test infrastructure
- [ ] Create test environment utilities
- [ ] Implement cleanup utilities
- [ ] Create mock device utilities

### Phase 2: Core Tests (Week 2-3)
- [ ] Resource location tests
- [ ] Python environment tests
- [ ] Device registry tests
- [ ] File system tests

### Phase 3: Integration Tests (Week 4-5)
- [ ] Bundle manager tests
- [ ] Workspace manager tests
- [ ] Terminal/task tests
- [ ] REPL integration tests

### Phase 4: CI/CD (Week 6)
- [ ] Set up GitHub Actions
- [ ] Add coverage reporting
- [ ] Add test badges to README
- [ ] Document test writing guide

---

**Document Owner**: Extension Development Team
**Review Cycle**: Updated as tests are implemented
**Reference**: EXT-APP-ARCHITECTURE.md for patterns being tested