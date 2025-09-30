# MU TWO EDITOR - EXTENSION ARCHITECTURE
**Source of Truth for Development Patterns and Conventions**

> **Status**: PRE-BETA - No legacy code or backwards compatibility maintained
> **Focus**: CircuitPython functionality to establish best-practice patterns
> **Last Updated**: 2025-09-30

---

## TABLE OF CONTENTS
1. [Design Philosophy](#design-philosophy)
2. [Resource Location Patterns](#resource-location-patterns)
3. [Python Environment Management](#python-environment-management)
4. [VS Code API Patterns](#vs-code-api-patterns)
5. [Component Architecture](#component-architecture)
6. [Terminal & Task Patterns](#terminal--task-patterns)
7. [Library & Bundle Management](#library--bundle-management)
8. [Device Management](#device-management)
9. [File System Patterns](#file-system-patterns)
10. [State Management](#state-management)
11. [Development Guidelines](#development-guidelines)

---

## DESIGN PHILOSOPHY

### Core Principles
1. **Local-disk-first, board-centric development** - Projects developed on host machine, synced to connected boards
2. **REPL-centric workflow** - Interactive development has pride of place
3. **Simplicity over enterprise patterns** - Lean on VS Code functionality, avoid over-engineering
4. **Single source of truth** - One system per concern, no duplicate abstractions
5. **VS Code native first** - Use VS Code APIs over Node.js when available
6. **Predictable resource locations** - Components know where to find resources via `extensionUri` patterns

### Extension Structure
```
Mu Two Editor
├─ Main REPL (extension/workspace level)
├─ Editor REPLs (project level, per-file)
├─ Workspace Manager (board-centric organization)
├─ Project Manager (multiple projects per workspace)
├─ Device Registry (single source for device state)
└─ Python Environment (shared venv at extensionUri)
```

### Workspace Model
- **Workspaces** are organized by board (one workspace per board type)
- **Projects** are organized within workspaces (multiple projects per workspace)
- **Files** are backed up on local disk until board reconnects
- **REPL** operates at workspace level; editor REPLs at project level
- **Sync strategy**: User configurable - auto sync or ask first upon board reconnect

---

## RESOURCE LOCATION PATTERNS

### Resource Hierarchy (AUTHORITATIVE)
**All resource paths MUST follow this pattern. No exceptions.**

```typescript
// Core pattern implementation - src/core/resourceLocator.ts
export class ResourceLocator {
  constructor(private context: vscode.ExtensionContext) {}

  // Extension-bundled resources (READ-ONLY)
  // Use for: assets, icons, board database, bundled files
  getAssetPath(asset: string): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, 'assets', asset);
  }

  // Python virtual environment (CREATED ONCE, SHARED)
  // Use for: extension's Python environment, pip packages, circup
  getVenvPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, 'venv');
  }

  // Downloaded bundles (PERSISTENT CACHE)
  // Use for: CircuitPython bundle modules, downloaded libraries
  getBundlePath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'bundles');
  }

  // User workspaces (PERSISTENT USER DATA)
  // Use for: user-created workspaces, project backups
  getWorkspacesPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'workspaces');
  }

  // WASM runtime binaries (PERSISTENT CACHE)
  // Use for: CircuitPython WASM runtime files
  getWasmRuntimePath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'bin', 'wasm-runtime');
  }

  // Extension configuration (PERSISTENT SETTINGS)
  // Use for: persistent module lists, user preferences
  getConfigPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'config');
  }
}
```

### Path Construction Rules
**NEVER use Node.js `path` module or string concatenation for paths.**

```typescript
// ✅ CORRECT - Use VS Code Uri.joinPath()
const fullPath = vscode.Uri.joinPath(baseUri, 'subdir', 'file.txt');

// ❌ WRONG - Don't use Node.js path module
import * as path from 'path';
const fullPath = path.join(baseDir, 'subdir', 'file.txt');

// ❌ WRONG - Don't use string concatenation
const fullPath = `${baseDir}/subdir/file.txt`;
```

### Resource Ownership
| Resource Type | Location | Lifetime | Owner |
|--------------|----------|----------|-------|
| Extension assets | `extensionUri/assets/` | Permanent | Extension bundle |
| Python venv | `extensionUri/venv/` | Permanent | PythonEnvironment |
| CircuitPython bundle | `globalStorageUri/bundles/` | Cached | BundleManager |
| User workspaces | `globalStorageUri/workspaces/` | Permanent | WorkspaceManager |
| WASM runtime | `globalStorageUri/bin/wasm-runtime/` | Cached | WasmRuntimeManager |
| Persistent configs | `globalStorageUri/config/` | Permanent | Extension state |

---

## PYTHON ENVIRONMENT MANAGEMENT

### Single Responsibility Pattern
**ONE class manages Python environment. Period.**

```typescript
// src/execution/pythonEnvironment.ts
export class PythonEnvironment {
  private venvPath?: vscode.Uri;
  private pythonPath?: string;

  constructor(
    private context: vscode.ExtensionContext,
    private resourceLocator: ResourceLocator
  ) {}

  /**
   * Ensure Python environment is ready
   * Creates venv if needed, validates structure, returns path
   */
  async ensureReady(): Promise<string> {
    // 1. Get venv path from ResourceLocator
    this.venvPath = this.resourceLocator.getVenvPath();

    // 2. Check if venv exists
    if (await this.exists()) {
      // Validate and return
      return this.getPythonExecutable();
    }

    // 3. Create venv using VS Code Tasks (user-visible)
    await this.createVenv();

    // 4. Install required packages (circup, adafruit-blinka)
    await this.installPackages();

    // 5. Validate and return
    return this.getPythonExecutable();
  }

  private getPythonExecutable(): string {
    const platform = process.platform;
    if (platform === 'win32') {
      return vscode.Uri.joinPath(this.venvPath!, 'Scripts', 'python.exe').fsPath;
    } else {
      return vscode.Uri.joinPath(this.venvPath!, 'bin', 'python').fsPath;
    }
  }

  private async createVenv(): Promise<void> {
    // Use VS Code Task API for user visibility
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Global,
      'Create Python Environment',
      'Mu Two',
      new vscode.ShellExecution(`python -m venv ${this.venvPath!.fsPath}`)
    );
    await vscode.tasks.executeTask(task);
  }
}
```

### Environment Configuration
**Use VS Code's EnvironmentVariableCollection API**

```typescript
// Set environment variables for terminals and tasks
const envCollection = context.environmentVariableCollection;
envCollection.replace('PYTHONPATH', venvPath);
envCollection.replace('PYTHONIOENCODING', 'utf-8');
envCollection.replace('CIRCUITPY', '1');
```

### Python Command Execution Pattern
**Use VS Code Tasks for user-visible operations, child_process only for IPC**

```typescript
// ✅ CORRECT - Use Tasks for pip, circup, user commands
const task = new vscode.Task(
  { type: 'shell' },
  vscode.TaskScope.Global,
  'Install Library',
  'Mu Two',
  new vscode.ShellExecution(pythonPath, ['-m', 'circup', 'install', libraryName])
);
await vscode.tasks.executeTask(task);

// ✅ CORRECT - Use child_process ONLY for WASM IPC (real-time bidirectional)
const wasmProcess = spawn(wasmBinary, args, {
  stdio: ['pipe', 'pipe', 'pipe', 'pipe'] // Custom IPC channel
});

// ❌ WRONG - Don't use spawn for simple commands
const result = spawn('python', ['-m', 'pip', 'install', 'circup']);
```

---

## VS CODE API PATTERNS

### File Operations
**Always use VS Code Workspace FileSystem API**

```typescript
// ✅ CORRECT - Use VS Code filesystem API
import * as vscode from 'vscode';

// Read file
const content = await vscode.workspace.fs.readFile(uri);
const text = new TextDecoder().decode(content);

// Write file
const data = new TextEncoder().encode(text);
await vscode.workspace.fs.writeFile(uri, data);

// Create directory
await vscode.workspace.fs.createDirectory(uri);

// Check if exists
try {
  await vscode.workspace.fs.stat(uri);
  // exists
} catch {
  // doesn't exist
}

// ❌ WRONG - Don't use Node.js fs module
import * as fs from 'fs';
fs.readFileSync(path); // DON'T DO THIS
```

### Status Bar Integration
**Show extension state to users**

```typescript
// Create status bar items for important state
const deviceStatus = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Left,
  100
);
deviceStatus.text = '$(circuit-board) No Device';
deviceStatus.command = 'muTwo.selectDevice';
deviceStatus.show();

// Update when state changes
deviceStatus.text = '$(check) Metro M4 Express';
deviceStatus.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
```

### Progress Indicators
**Show progress for long operations**

```typescript
await vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Notification,
    title: 'Downloading CircuitPython Bundle',
    cancellable: true
  },
  async (progress, token) => {
    progress.report({ increment: 0, message: 'Starting download...' });
    // ... perform operation
    progress.report({ increment: 50, message: 'Extracting...' });
    // ... continue
    progress.report({ increment: 100, message: 'Complete!' });
  }
);
```

### Output Channels
**Use output channels for diagnostic information**

```typescript
// Create once, reuse throughout extension
const outputChannel = vscode.window.createOutputChannel('Mu Two', 'log');

// Use for diagnostic information
outputChannel.appendLine('[INFO] Python environment ready');
outputChannel.appendLine('[WARN] Bundle not found, will download');
outputChannel.show(); // Show to user when needed
```

---

## COMPONENT ARCHITECTURE

### Single Responsibility Components
**Each component has ONE clear purpose. No overlap.**

```typescript
// Device Registry - SINGLE source for device state
export class DeviceRegistry {
  private devices = new Map<string, CircuitPythonDevice>();

  async detectDevices(): Promise<CircuitPythonDevice[]> {
    // Detection logic here - ONE PLACE
  }

  getDevice(id: string): CircuitPythonDevice | undefined {
    return this.devices.get(id);
  }
}

// Board Manager - Board operations ONLY (not detection)
export class BoardManager {
  constructor(private deviceRegistry: DeviceRegistry) {}

  async connectToBoard(deviceId: string): Promise<void> {
    const device = this.deviceRegistry.getDevice(deviceId);
    // Connection logic
  }
}
```

### Dependency Injection Pattern
**Pass dependencies explicitly, avoid global singletons**

```typescript
// ✅ CORRECT - Explicit dependencies
export class WorkspaceManager {
  constructor(
    private context: vscode.ExtensionContext,
    private resourceLocator: ResourceLocator,
    private deviceRegistry: DeviceRegistry
  ) {}
}

// ❌ WRONG - Global singletons
export class WorkspaceManager {
  constructor() {
    this.resourceLocator = ResourceLocator.getInstance(); // DON'T
  }
}
```

### Component Lifecycle
**Trust VS Code lifecycle, don't over-manage**

```typescript
// Register in activate(), dispose in deactivate()
export function activate(context: vscode.ExtensionContext) {
  const resourceLocator = new ResourceLocator(context);
  const pythonEnv = new PythonEnvironment(context, resourceLocator);
  const deviceRegistry = new DeviceRegistry();

  // Register disposables
  context.subscriptions.push(deviceRegistry);

  // Let VS Code handle cleanup
}
```

---

## TERMINAL & TASK PATTERNS

### Terminal Profile Pattern
**Define reusable terminal profiles for consistent environments**

```typescript
// Define terminal profile
const circuitPythonProfile: vscode.TerminalOptions = {
  name: 'CircuitPython',
  shellPath: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
  env: {
    CIRCUITPY: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1'
  },
  iconPath: new vscode.ThemeIcon('circuit-board')
};

// Create terminal
const terminal = vscode.window.createTerminal(circuitPythonProfile);
```

### Shell Integration Pattern
**Use shell integration for reliable command execution**

```typescript
// Wait for shell integration before executing commands
async function executeCommand(terminal: vscode.Terminal, command: string): Promise<string> {
  // Wait for shell integration
  await new Promise(resolve => {
    const interval = setInterval(() => {
      if (terminal.shellIntegration) {
        clearInterval(interval);
        resolve(undefined);
      }
    }, 100);
  });

  // Execute command using shell integration
  const execution = terminal.shellIntegration!.executeCommand(command);

  // Read output
  const stream = execution.read();
  let output = '';
  for await (const data of stream) {
    output += data;
  }

  return output;
}
```

### Task API Pattern
**Use Tasks for user-visible operations**

```typescript
// Create task for library installation
const task = new vscode.Task(
  { type: 'circup', library: libraryName }, // Task definition
  vscode.TaskScope.Workspace,
  `Install ${libraryName}`,
  'Mu Two',
  new vscode.ShellExecution(`circup install ${libraryName}`)
);

// Add problem matcher for better UX
task.problemMatchers = ['$python'];

// Execute and wait
const execution = await vscode.tasks.executeTask(task);
await new Promise<void>(resolve => {
  const disposable = vscode.tasks.onDidEndTask(e => {
    if (e.execution === execution) {
      disposable.dispose();
      resolve();
    }
  });
});
```

### Pseudoterminal for Custom REPL
**Use Pseudoterminal for custom interactive experiences**

```typescript
const writeEmitter = new vscode.EventEmitter<string>();
const pty: vscode.Pseudoterminal = {
  onDidWrite: writeEmitter.event,

  open: () => {
    writeEmitter.fire('CircuitPython 8.0.0\r\n>>> ');
  },

  close: () => {},

  handleInput: (data: string) => {
    if (data === '\r') {
      // Execute command
      const result = executeCommand(currentCommand);
      writeEmitter.fire(`\r\n${result}\r\n>>> `);
      currentCommand = '';
    } else if (data === '\x03') { // Ctrl+C
      writeEmitter.fire('^C\r\n>>> ');
      currentCommand = '';
    } else {
      writeEmitter.fire(data);
      currentCommand += data;
    }
  }
};

const terminal = vscode.window.createTerminal({ name: 'REPL', pty });
```

---

## LIBRARY & BUNDLE MANAGEMENT

### Single Bundle Manager Pattern
**ONE manager for CircuitPython libraries. Use circup CLI.**

```typescript
// src/libraries/bundleManager.ts
export class BundleManager {
  constructor(
    private context: vscode.ExtensionContext,
    private resourceLocator: ResourceLocator,
    private pythonEnv: PythonEnvironment
  ) {}

  /**
   * Ensure circup is installed in extension venv
   */
  async ensureCircupReady(): Promise<void> {
    const pythonPath = await this.pythonEnv.ensureReady();

    // Check if circup is installed
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.TaskScope.Global,
      'Check Circup',
      'Mu Two',
      new vscode.ShellExecution(`${pythonPath} -m circup --version`)
    );

    try {
      await vscode.tasks.executeTask(task);
    } catch {
      // Install circup
      await this.installCircup(pythonPath);
    }
  }

  /**
   * Get available libraries from persistent list
   * Circup installs to site-packages, not a bundle directory
   */
  async getAvailableLibraries(): Promise<LibraryInfo[]> {
    const moduleList = await this.loadPersistentModuleList();
    return moduleList.modules.map(name => ({
      name,
      installed: false // Check workspace lib/ to determine
    }));
  }

  /**
   * Install library to workspace lib/ directory
   */
  async installToWorkspace(libraryName: string, workspaceUri: vscode.Uri): Promise<void> {
    const pythonPath = await this.pythonEnv.ensureReady();
    const libPath = vscode.Uri.joinPath(workspaceUri, 'lib').fsPath;

    // Use circup with --path flag
    const task = new vscode.Task(
      { type: 'circup', action: 'install' },
      vscode.TaskScope.Workspace,
      `Install ${libraryName}`,
      'Mu Two',
      new vscode.ShellExecution(
        `${pythonPath} -m circup install --path "${libPath}" ${libraryName}`
      )
    );

    await vscode.tasks.executeTask(task);
  }
}
```

### Library Installation Pattern
**Always use circup CLI with --path flag**

```bash
# Install to workspace lib/ directory
python -m circup install --path /path/to/workspace/lib adafruit_neopixel

# Update libraries in workspace
python -m circup update --path /path/to/workspace/lib

# List installed libraries
python -m circup freeze --path /path/to/workspace/lib
```

### Persistent Module List
**Use persistent JSON for available libraries list**

```typescript
// Store module list in globalStorageUri
const moduleListPath = vscode.Uri.joinPath(
  this.resourceLocator.getConfigPath(),
  'circuitpython-modules.json'
);

// Update from circup
const pythonPath = await this.pythonEnv.ensureReady();
const output = await executeCommand(
  `${pythonPath} -m circup bundle-show --modules`
);
const modules = output.split('\n').filter(line => line.trim());

// Save persistently
const data = {
  modules,
  version: '8.0.0',
  lastUpdated: new Date().toISOString()
};
await vscode.workspace.fs.writeFile(
  moduleListPath,
  new TextEncoder().encode(JSON.stringify(data, null, 2))
);
```

---

## DEVICE MANAGEMENT

### Single Device Registry Pattern
**ONE source of truth for device state**

```typescript
// src/devices/deviceRegistry.ts
export class DeviceRegistry implements vscode.Disposable {
  private devices = new Map<string, CircuitPythonDevice>();
  private _onDidChangeDevices = new vscode.EventEmitter<void>();
  readonly onDidChangeDevices = this._onDidChangeDevices.event;

  /**
   * Detect connected CircuitPython devices
   * Uses serialport for detection
   */
  async detectDevices(): Promise<CircuitPythonDevice[]> {
    const { SerialPort } = await import('serialport');
    const ports = await SerialPort.list();

    const devices: CircuitPythonDevice[] = [];
    for (const port of ports) {
      if (this.isCircuitPythonDevice(port)) {
        const device = this.createDevice(port);
        devices.push(device);
        this.devices.set(device.id, device);
      }
    }

    this._onDidChangeDevices.fire();
    return devices;
  }

  getDevice(id: string): CircuitPythonDevice | undefined {
    return this.devices.get(id);
  }

  getAllDevices(): CircuitPythonDevice[] {
    return Array.from(this.devices.values());
  }
}
```

### Device Detection Pattern
**Use serialport library, match against board database**

```typescript
private isCircuitPythonDevice(port: PortInfo): boolean {
  // Check VID/PID against board database
  const vid = port.vendorId?.toLowerCase();
  const pid = port.productId?.toLowerCase();

  if (!vid || !pid) return false;

  const vidPid = `${vid}:${pid}`;
  return this.boardDatabase.hasBoard(vidPid);
}
```

### Board Operations Pattern
**Separate operations from detection**

```typescript
// Board manager handles operations, not detection
export class BoardManager {
  constructor(private deviceRegistry: DeviceRegistry) {}

  async connectToBoard(deviceId: string): Promise<SerialConnection> {
    const device = this.deviceRegistry.getDevice(deviceId);
    if (!device) throw new Error('Device not found');

    // Connection logic
    const connection = await this.createConnection(device);
    return connection;
  }
}
```

---

## FILE SYSTEM PATTERNS

### Standard VS Code Workspace API
**Use workspace.fs API for all file operations. No custom file system provider for local files.**

```typescript
// ✅ CORRECT - Standard workspace operations
const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri;
const libUri = vscode.Uri.joinPath(workspaceUri, 'lib');
const files = await vscode.workspace.fs.readDirectory(libUri);

// ❌ WRONG - Don't create custom file system provider for local files
vscode.workspace.registerFileSystemProvider('mutwo', provider); // DON'T
```

### Device File System Provider
**ONE file system provider for device access ONLY**

```typescript
// Only register custom provider for CircuitPython device access
export class DeviceFileSystemProvider implements vscode.FileSystemProvider {
  // Handles ctpy:// URIs for CircuitPython devices
  // Example: ctpy://CIRCUITPY/code.py

  readFile(uri: vscode.Uri): Promise<Uint8Array> {
    // Read from connected device over serial
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    // Write to connected device over serial
  }
}

// Register in activate()
context.subscriptions.push(
  vscode.workspace.registerFileSystemProvider('ctpy', deviceFsProvider)
);
```

### File Sync Pattern
**Sync workspace files to device when connected**

```typescript
async function syncToDevice(device: CircuitPythonDevice): Promise<void> {
  const workspaceUri = vscode.workspace.workspaceFolders?.[0].uri;
  const deviceUri = vscode.Uri.parse(`ctpy://${device.id}/`);

  // Get files to sync
  const files = await findPythonFiles(workspaceUri);

  // Copy each file
  for (const file of files) {
    const relativePath = vscode.workspace.asRelativePath(file);
    const targetUri = vscode.Uri.joinPath(deviceUri, relativePath);

    const content = await vscode.workspace.fs.readFile(file);
    await vscode.workspace.fs.writeFile(targetUri, content);
  }
}
```

---

## STATE MANAGEMENT

### Simple Context State Pattern
**Use context.globalState for persistence. No complex state managers.**

```typescript
// ✅ CORRECT - Simple state management
class ExtensionState {
  constructor(private context: vscode.ExtensionContext) {}

  async getLastDevice(): Promise<string | undefined> {
    return this.context.globalState.get('lastDevice');
  }

  async setLastDevice(deviceId: string): Promise<void> {
    await this.context.globalState.update('lastDevice', deviceId);
  }
}

// ❌ WRONG - Over-engineered state manager with complex lifecycle
class ExtensionStateManager {
  private state = new Map();
  private listeners = new Set();
  private middleware = [];
  // ... 500 lines of state management
}
```

### Memory State Pattern
**Trust VS Code disposal, don't over-manage memory**

```typescript
// Store components in context.subscriptions
// VS Code handles cleanup automatically
export function activate(context: vscode.ExtensionContext) {
  const deviceRegistry = new DeviceRegistry();
  const boardManager = new BoardManager(deviceRegistry);

  context.subscriptions.push(deviceRegistry, boardManager);
  // VS Code calls dispose() automatically on deactivation
}
```

---

## DEVELOPMENT GUIDELINES

### Architecture Review Checklist
Before adding a new component, answer these questions:

1. **Does this already exist?**
   - Check for overlapping functionality
   - Look for similar patterns in other components
   - Review architecture audit recommendations

2. **Does this belong in VS Code?**
   - Could VS Code APIs handle this?
   - Is this a common pattern VS Code already provides?
   - Check VS Code API documentation first

3. **Is this the simplest solution?**
   - Can we use fewer lines of code?
   - Can we use fewer dependencies?
   - Can we reuse existing patterns?

4. **Does this follow our patterns?**
   - Uses ResourceLocator for paths?
   - Uses VS Code APIs over Node.js?
   - Single responsibility?
   - Explicit dependencies?

5. **Is this testable?**
   - Can we test without complex mocking?
   - Are dependencies injected?
   - Is state management simple?

### Code Review Standards

**Required for all PRs:**
- [ ] No duplicate functionality (check existing code first)
- [ ] Uses VS Code APIs where available
- [ ] Follows resource location patterns
- [ ] Single clear responsibility
- [ ] Explicit dependencies (no singletons)
- [ ] Simple state management
- [ ] Uses Uri.joinPath() for paths
- [ ] Includes logging for debugging
- [ ] Updated this document if introducing new patterns

### Anti-Patterns to Avoid

❌ **Multiple systems for same concern**
```typescript
// DON'T have SimpleDeviceDetector + MuDeviceDetector + BoardManager
// Use DeviceRegistry (single source)
```

❌ **Complex state managers**
```typescript
// DON'T create elaborate state management
// Use context.globalState directly
```

❌ **Custom file system providers for local files**
```typescript
// DON'T register mutwo:// scheme
// Use standard file:// with workspace.fs API
```

❌ **String-based path construction**
```typescript
// DON'T use string concatenation or Node.js path
const badPath = `${baseDir}/subdir/${file}`;
// DO use VS Code Uri.joinPath()
const goodPath = vscode.Uri.joinPath(baseUri, 'subdir', file);
```

❌ **Global singletons**
```typescript
// DON'T use getInstance() pattern
ResourceLocator.getInstance()
// DO inject dependencies explicitly
constructor(private resourceLocator: ResourceLocator)
```

❌ **Spawn for simple commands**
```typescript
// DON'T use child_process for user-facing commands
spawn('python', ['-m', 'pip', 'install', 'circup'])
// DO use VS Code Tasks
new vscode.Task(..., new vscode.ShellExecution('python -m pip install circup'))
```

### When to Refactor

**Immediate refactor required when:**
- Duplicate functionality discovered
- Component exceeds 500 lines
- More than 5 dependencies injected
- State management becomes complex
- Tests require extensive mocking

**Schedule refactor when:**
- Component grows beyond single responsibility
- Performance issues detected
- Maintenance burden increases
- Similar patterns exist elsewhere

---

## REFERENCES

### Internal Documentation
- [Architecture Audit Recommendations](./docs/architecture-audit-recommendations.md) - Detailed analysis and consolidation opportunities
- [MU-TODO.md](./MU-TODO.md) - Current development priorities

### VS Code API Documentation
- [Extension API](https://code.visualstudio.com/api/references/vscode-api)
- [File System Provider](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider)
- [Terminal API](https://code.visualstudio.com/api/references/vscode-api#Terminal)
- [Task Provider](https://code.visualstudio.com/api/extension-guides/task-provider)

### External Research
- CircuitPython Terminal Research: `C:\Users\jef\dev\circuitpython-terminal-research\`
- Terminal patterns: `terminalPatterns.ts`
- Circup patterns: `circupPatterns.ts`
- Shell integration: `shellPatterns.ts`

---

**Document Owner**: Extension Development Team
**Review Cycle**: Updated with each architectural change
**Enforcement**: All PRs must comply with patterns herein

_Updated: 2025-09-30 - Expanded with resource patterns, VS Code API guidelines, and audit recommendations_