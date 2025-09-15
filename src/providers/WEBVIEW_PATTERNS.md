# VS Code Webview Implementation Patterns

This document provides complete, working code snippets for implementing advanced webview functionality in VS Code extensions. All code can be copy-pasted to recreate these functional components.

## 1. Server-Side Rendering with Preact

### Overview
This pattern implements true SSR where the extension (server) renders complete HTML using Preact's `renderToString`, and the webview (client) receives static HTML with progressive enhancement.

### Step-by-Step Setup

#### 1. Install Dependencies
```bash
npm install preact preact-render-to-string
npm install --save-dev @types/node
```

#### 2. Project Structure
```
src/
├── extension.ts
├── panels/
│   └── HelloWorldPanel.ts
├── components/
│   └── HelloWorldApp.tsx
├── webview/
│   └── main.ts
├── utilities/
│   ├── getUri.ts
│   └── getNonce.ts
└── types/
    └── jsx.d.ts
```

#### 3. Complete File Implementations

**`src/types/jsx.d.ts`**
```typescript
declare namespace JSX {
  interface IntrinsicElements {
    'vscode-button': any;
    [elemName: string]: any;
  }
}
```

**`src/utilities/getNonce.ts`** (if not exists)
```typescript
export function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

**`src/utilities/getUri.ts`** (if not exists)
```typescript
import { Uri, Webview } from "vscode";

export function getUri(webview: Webview, extensionUri: Uri, pathList: string[]) {
  return webview.asWebviewUri(Uri.joinPath(extensionUri, ...pathList));
}
```

**`src/components/HelloWorldApp.tsx`**
```typescript
import { h } from 'preact';

interface HelloWorldAppProps {
  webviewUri: string;
  nonce: string;
}

export function HelloWorldApp({ webviewUri, nonce }: HelloWorldAppProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content={`default-src 'none'; script-src 'nonce-${nonce}';`} />
        <title>Hello World!</title>
      </head>
      <body>
        <h1>Hello World!</h1>
        <p>This content is rendered with Preact!</p>
        <vscode-button id="howdy">Howdy!</vscode-button>
        <div id="status">Ready for JSON-RPC</div>
        <div id="dom-info"></div>
        <script type="module" nonce={nonce} src={webviewUri}></script>
      </body>
    </html>
  );
}
```

**`src/panels/HelloWorldPanel.ts`**
```typescript
import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { getUri } from "../utilities/getUri";
import { getNonce } from "../utilities/getNonce";
import { h } from "preact";
import { render } from "preact-render-to-string";
import { HelloWorldApp } from "../components/HelloWorldApp";

export class HelloWorldPanel {
  public static currentPanel: HelloWorldPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    // Set an event listener to listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Set the HTML content for the webview panel
    this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
  }

  public static render(extensionUri: Uri) {
    if (HelloWorldPanel.currentPanel) {
      HelloWorldPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel(
        "showHelloWorld",
        "Hello World",
        ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [Uri.joinPath(extensionUri, "out")],
        }
      );

      HelloWorldPanel.currentPanel = new HelloWorldPanel(panel, extensionUri);
    }
  }

  public dispose() {
    HelloWorldPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _getWebviewContent(webview: Webview, extensionUri: Uri) {
    const webviewUri = getUri(webview, extensionUri, ["out", "webview.js"]);
    const nonce = getNonce();

    // Server-side render the complete HTML document
    return "<!DOCTYPE html>" + render(h(HelloWorldApp, { webviewUri, nonce }));
  }
}
```

**`src/webview/main.ts`**
```typescript
import { provideVSCodeDesignSystem, vsCodeButton, Button } from "@vscode/webview-ui-toolkit";

// Register VS Code design system components
provideVSCodeDesignSystem().register(vsCodeButton());

// Get access to the VS Code API from within the webview context
const vscode = acquireVsCodeApi();

// Wait for DOM to load, then enhance the server-rendered content
window.addEventListener("load", main);

function main() {
  // Find the button in the server-rendered HTML and add interactivity
  const howdyButton = document.getElementById("howdy") as Button;
  
  if (howdyButton) {
    let clickCount = 0;
    
    howdyButton.addEventListener("click", () => {
      clickCount++;
      
      // Update the button text to show click count
      const originalText = howdyButton.textContent?.replace(/ \(\d+\)/, '') || 'Howdy!';
      howdyButton.textContent = `${originalText} (${clickCount})`;
      
      // Send message to extension
      vscode.postMessage({
        command: "hello",
        text: `Hey there partner! 🤠 (clicked ${clickCount} times)`,
      });
    });
  }
}
```

**`src/extension.ts`**
```typescript
import { commands, ExtensionContext } from "vscode";
import { HelloWorldPanel } from "./panels/HelloWorldPanel";

export function activate(context: ExtensionContext) {
  const showHelloWorldCommand = commands.registerCommand("hello-world.showHelloWorld", () => {
    HelloWorldPanel.render(context.extensionUri);
  });

  context.subscriptions.push(showHelloWorldCommand);
}
```

#### 4. Build Configuration (`esbuild.js`)
```javascript
const { build } = require("esbuild");

const baseConfig = {
  bundle: true,
  minify: process.env.NODE_ENV === "production",
  sourcemap: process.env.NODE_ENV !== "production",
};

// Extension bundle (server-side rendering)
const extensionConfig = {
  ...baseConfig,
  platform: "node",
  mainFields: ["module", "main"],
  format: "cjs",
  entryPoints: ["./src/extension.ts"],
  outfile: "./out/extension.js",
  external: ["vscode"],
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment",
};

// Webview bundle (client-side enhancement)
const webviewConfig = {
  ...baseConfig,
  target: "es2020",
  format: "esm",
  entryPoints: ["./src/webview/main.ts"],
  outfile: "./out/webview.js",
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment",
};

const watchConfig = {
  watch: {
    onRebuild(error, result) {
      console.log("[watch] build started");
      if (error) {
        error.errors.forEach((error) =>
          console.error(`> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`)
        );
      } else {
        console.log("[watch] build finished");
      }
    },
  },
};

// Build script
(async () => {
  const args = process.argv.slice(2);
  try {
    if (args.includes("--watch")) {
      console.log("[watch] build started");
      await build({ ...extensionConfig, ...watchConfig });
      await build({ ...webviewConfig, ...watchConfig });
      console.log("[watch] build finished");
    } else {
      await build(extensionConfig);
      await build(webviewConfig);
      console.log("build complete");
    }
  } catch (err) {
    process.stderr.write(err.stderr);
    process.exit(1);
  }
})();
```

#### 5. Package.json Updates
```json
{
  "scripts": {
    "compile": "node ./esbuild.js",
    "watch": "node ./esbuild.js --watch"
  },
  "dependencies": {
    "@vscode/webview-ui-toolkit": "^1.2.2",
    "preact": "^10.27.1",
    "preact-render-to-string": "^6.6.1"
  }
}
```

### Benefits
- **Fast initial load** - HTML pre-rendered on server
- **SEO-friendly** - Complete HTML available immediately  
- **Progressive enhancement** - Works without JavaScript
- **True SSR** - Extension acts as server, webview as client

---

## 2. JSON-RPC Real-Time Communication

### Overview
This pattern implements structured, bi-directional communication between extension and webview using the `vscode-jsonrpc` library for real-time data exchange.

### Step-by-Step Setup

#### 1. Install Dependencies
```bash
npm install vscode-jsonrpc
```

#### 2. Complete Implementation

**Updated `src/panels/HelloWorldPanel.ts`** (extends the SSR version)
```typescript
import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { getUri } from "../utilities/getUri";
import { getNonce } from "../utilities/getNonce";
import { h } from "preact";
import { render } from "preact-render-to-string";
import { HelloWorldApp } from "../components/HelloWorldApp";
import { createMessageConnection, MessageConnection, AbstractMessageReader, AbstractMessageWriter, DataCallback, Message } from "vscode-jsonrpc/node";

export class HelloWorldPanel {
  public static currentPanel: HelloWorldPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private _rpcConnection: MessageConnection | undefined;

  private constructor(panel: WebviewPanel, extensionUri: Uri) {
    this._panel = panel;

    // Set an event listener to listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Set the HTML content for the webview panel
    this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

    // Setup JSON-RPC connection
    this._setupRpcConnection();
  }

  public static render(extensionUri: Uri) {
    if (HelloWorldPanel.currentPanel) {
      HelloWorldPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel(
        "showHelloWorld",
        "Hello World",
        ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [Uri.joinPath(extensionUri, "out")],
        }
      );

      HelloWorldPanel.currentPanel = new HelloWorldPanel(panel, extensionUri);
    }
  }

  public dispose() {
    HelloWorldPanel.currentPanel = undefined;

    // Dispose of JSON-RPC connection
    if (this._rpcConnection) {
      this._rpcConnection.dispose();
    }

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _getWebviewContent(webview: Webview, extensionUri: Uri) {
    const webviewUri = getUri(webview, extensionUri, ["out", "webview.js"]);
    const nonce = getNonce();

    // Server-side render the complete HTML document
    return "<!DOCTYPE html>" + render(h(HelloWorldApp, { webviewUri, nonce }));
  }

  /**
   * Sets up JSON-RPC connection for real-time communication with webview
   */
  private _setupRpcConnection() {
    // Create custom reader
    class WebviewMessageReader extends AbstractMessageReader {
      constructor(private webview: Webview) {
        super();
      }

      listen(callback: DataCallback): void {
        this.webview.onDidReceiveMessage(callback);
      }
    }

    // Create custom writer
    class WebviewMessageWriter extends AbstractMessageWriter {
      constructor(private webview: Webview) {
        super();
      }

      write(msg: Message): Promise<void> {
        this.webview.postMessage(msg);
        return Promise.resolve();
      }

      end(): void {
        // No-op for webview
      }
    }

    // Create JSON-RPC connection
    const reader = new WebviewMessageReader(this._panel.webview);
    const writer = new WebviewMessageWriter(this._panel.webview);
    this._rpcConnection = createMessageConnection(reader, writer);

    // Setup RPC request handlers
    this._rpcConnection.onRequest('getDOMState', () => {
      console.log('Extension: Received getDOMState request');
      return { 
        timestamp: new Date().toISOString(),
        message: 'DOM state requested from extension'
      };
    });

    this._rpcConnection.onRequest('inspectElement', (params: { selector: string }) => {
      console.log('Extension: Inspecting element:', params.selector);
      return {
        selector: params.selector,
        found: true,
        timestamp: new Date().toISOString()
      };
    });

    // Handle notifications from webview
    this._rpcConnection.onNotification('webviewReady', (params: any) => {
      console.log('Extension: Webview is ready', params);
      // Send ready confirmation back
      this._rpcConnection?.sendNotification('extensionReady', {
        message: 'JSON-RPC connection established from extension'
      });
    });

    // Start listening
    this._rpcConnection.listen();
  }
}
```

**Updated `src/webview/main.ts`** (extends the SSR version)
```typescript
import { provideVSCodeDesignSystem, vsCodeButton, Button } from "@vscode/webview-ui-toolkit";
import { createMessageConnection, MessageConnection, AbstractMessageReader, AbstractMessageWriter, DataCallback, Message } from "vscode-jsonrpc/browser";

// Register VS Code design system components
provideVSCodeDesignSystem().register(vsCodeButton());

// Get access to the VS Code API from within the webview context
const vscode = acquireVsCodeApi();

let rpcConnection: MessageConnection;

// Wait for DOM to load, then enhance the server-rendered content
window.addEventListener("load", main);

function main() {
  // Setup JSON-RPC connection
  setupRpcConnection();

  // Find the button in the server-rendered HTML and add interactivity
  const howdyButton = document.getElementById("howdy") as Button;
  
  if (howdyButton) {
    let clickCount = 0;
    
    howdyButton.addEventListener("click", async () => {
      clickCount++;
      
      // Update the button text to show click count
      const originalText = howdyButton.textContent?.replace(/ \(\d+\)/, '') || 'Howdy!';
      howdyButton.textContent = `${originalText} (${clickCount})`;
      
      // Send JSON-RPC request to extension
      try {
        const result = await rpcConnection.sendRequest('getDOMState', {});
        console.log('Extension response:', result);
        
        // Update DOM info display
        const domInfoEl = document.getElementById('dom-info');
        if (domInfoEl) {
          domInfoEl.innerHTML = `
            <strong>Last Extension Response:</strong><br>
            <pre>${JSON.stringify(result, null, 2)}</pre>
          `;
        }
        
        // Also test element inspection
        const inspectResult = await rpcConnection.sendRequest('inspectElement', { 
          selector: '#howdy' 
        });
        console.log('Inspect result:', inspectResult);
        
      } catch (error) {
        console.error('RPC Error:', error);
      }
    });
  }
}

function setupRpcConnection() {
  // Create custom reader for webview
  class VSCodeMessageReader extends AbstractMessageReader {
    listen(callback: DataCallback): void {
      window.addEventListener('message', (event) => {
        callback(event.data);
      });
    }
  }

  // Create custom writer for webview
  class VSCodeMessageWriter extends AbstractMessageWriter {
    write(msg: Message): Promise<void> {
      vscode.postMessage(msg);
      return Promise.resolve();
    }

    end(): void {
      // No-op for webview
    }
  }

  // Create JSON-RPC connection
  const reader = new VSCodeMessageReader();
  const writer = new VSCodeMessageWriter();
  rpcConnection = createMessageConnection(reader, writer);

  // Handle notifications from extension
  rpcConnection.onNotification('extensionReady', (params: any) => {
    console.log('Webview received extensionReady:', params);
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = `Status: ${params.message}`;
    }
  });

  // Start listening
  rpcConnection.listen();

  // Send initial notification after connection is ready
  setTimeout(() => {
    rpcConnection.sendNotification('webviewReady', {
      message: 'Webview JSON-RPC client initialized',
      domReady: true
    });
  }, 500);
}
```

#### 3. Updated Package.json
```json
{
  "dependencies": {
    "@vscode/webview-ui-toolkit": "^1.2.2",
    "preact": "^10.27.1",
    "preact-render-to-string": "^6.6.1",
    "vscode-jsonrpc": "^8.2.1"
  }
}
```

#### 4. Testing the Implementation

1. **Build the extension:**
   ```bash
   npm run compile
   ```

2. **Press F5** to run the extension in debug mode

3. **Open Command Palette** (`Ctrl+Shift+P`) and run "Hello World: Show"

4. **Click the button** and check:
   - Console logs showing JSON-RPC communication
   - Status updates in the webview
   - DOM info display showing extension responses

### Expected Behavior
- **On load**: Webview sends `webviewReady` → Extension responds with `extensionReady`
- **On button click**: Webview sends `getDOMState` and `inspectElement` requests → Extension returns structured responses
- **Real-time updates**: Status and DOM info displays update with server responses

### Benefits
- **Structured communication** - Type-safe requests/responses
- **Bi-directional** - Both sides can initiate communication
- **Promise-based** - Clean async/await syntax
- **Real-time** - No polling required
- **Standard protocol** - Uses JSON-RPC 2.0 specification

---

## 3. File-Based State Persistence

### Overview
This pattern implements persistent state management using the file system as a bridge between webview and extension for state synchronization.

### Step-by-Step Setup

#### 1. Dependencies (already installed from previous patterns)
```bash
# Uses vscode-jsonrpc from Pattern 2
# Uses file system APIs built into VS Code
```

#### 2. Complete Implementation

**Create `src/state/StateManager.ts`**
```typescript
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface WebviewState {
  formData?: Record<string, any>;
  scrollPosition?: number;
  selectedItems?: string[];
  lastModified?: string;
  customData?: any;
}

export class StateManager {
  private context: vscode.ExtensionContext;
  private stateFile: string;
  private watcher?: vscode.FileSystemWatcher;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.stateFile = path.join(context.globalStorageUri.fsPath, 'webview-state.json');
    this.ensureStorageDirectory();
  }

  private async ensureStorageDirectory() {
    const dir = path.dirname(this.stateFile);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error('Failed to create storage directory:', error);
    }
  }

  async saveState(state: WebviewState): Promise<boolean> {
    try {
      const stateWithTimestamp = {
        ...state,
        lastModified: new Date().toISOString()
      };
      
      await fs.promises.writeFile(
        this.stateFile, 
        JSON.stringify(stateWithTimestamp, null, 2)
      );
      
      console.log('State saved to:', this.stateFile);
      return true;
    } catch (error) {
      console.error('Failed to save state:', error);
      return false;
    }
  }

  async loadState(): Promise<WebviewState> {
    try {
      const content = await fs.promises.readFile(this.stateFile, 'utf8');
      const state = JSON.parse(content);
      console.log('State loaded from:', this.stateFile);
      return state;
    } catch (error) {
      console.log('No existing state found, returning empty state');
      return {};
    }
  }

  async createSnapshot(suffix: string = ''): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const snapshotFile = path.join(
        path.dirname(this.stateFile),
        `snapshot-${timestamp}${suffix}.json`
      );
      
      const currentState = await this.loadState();
      await fs.promises.writeFile(snapshotFile, JSON.stringify(currentState, null, 2));
      
      console.log('Snapshot created:', snapshotFile);
      return snapshotFile;
    } catch (error) {
      console.error('Failed to create snapshot:', error);
      throw error;
    }
  }

  setupFileWatcher(onStateChange: (state: WebviewState) => void) {
    // Clean up existing watcher
    if (this.watcher) {
      this.watcher.dispose();
    }

    // Create file system watcher
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.dirname(this.stateFile), '*.json')
    );

    this.watcher.onDidChange(async (uri) => {
      if (uri.fsPath === this.stateFile) {
        try {
          const state = await this.loadState();
          onStateChange(state);
        } catch (error) {
          console.error('Failed to load changed state:', error);
        }
      }
    });

    this.context.subscriptions.push(this.watcher);
  }

  dispose() {
    if (this.watcher) {
      this.watcher.dispose();
    }
  }
}
```

**Updated `src/panels/HelloWorldPanel.ts`** (extends JSON-RPC version)
```typescript
import { Disposable, Webview, WebviewPanel, window, Uri, ViewColumn } from "vscode";
import { getUri } from "../utilities/getUri";
import { getNonce } from "../utilities/getNonce";
import { h } from "preact";
import { render } from "preact-render-to-string";
import { HelloWorldApp } from "../components/HelloWorldApp";
import { createMessageConnection, MessageConnection, AbstractMessageReader, AbstractMessageWriter, DataCallback, Message } from "vscode-jsonrpc/node";
import { StateManager, WebviewState } from "../state/StateManager";

export class HelloWorldPanel {
  public static currentPanel: HelloWorldPanel | undefined;
  private readonly _panel: WebviewPanel;
  private _disposables: Disposable[] = [];
  private _rpcConnection: MessageConnection | undefined;
  private _stateManager: StateManager;

  private constructor(panel: WebviewPanel, extensionUri: Uri, context: vscode.ExtensionContext) {
    this._panel = panel;
    this._stateManager = new StateManager(context);

    // Set an event listener to listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Set the HTML content for the webview panel
    this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);

    // Setup JSON-RPC connection
    this._setupRpcConnection();

    // Setup file watcher for external state changes
    this._stateManager.setupFileWatcher((newState) => {
      this._rpcConnection?.sendNotification('stateChanged', {
        source: 'file',
        data: newState
      });
    });
  }

  public static render(extensionUri: Uri, context: vscode.ExtensionContext) {
    if (HelloWorldPanel.currentPanel) {
      HelloWorldPanel.currentPanel._panel.reveal(ViewColumn.One);
    } else {
      const panel = window.createWebviewPanel(
        "showHelloWorld",
        "Hello World",
        ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [Uri.joinPath(extensionUri, "out")],
        }
      );

      HelloWorldPanel.currentPanel = new HelloWorldPanel(panel, extensionUri, context);
    }
  }

  public dispose() {
    HelloWorldPanel.currentPanel = undefined;

    // Dispose of state manager
    this._stateManager.dispose();

    // Dispose of JSON-RPC connection
    if (this._rpcConnection) {
      this._rpcConnection.dispose();
    }

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }

  private _getWebviewContent(webview: Webview, extensionUri: Uri) {
    const webviewUri = getUri(webview, extensionUri, ["out", "webview.js"]);
    const nonce = getNonce();

    // Server-side render the complete HTML document
    return "<!DOCTYPE html>" + render(h(HelloWorldApp, { webviewUri, nonce }));
  }

  private _setupRpcConnection() {
    // ... (same reader/writer classes as JSON-RPC pattern)
    
    class WebviewMessageReader extends AbstractMessageReader {
      constructor(private webview: Webview) {
        super();
      }
      listen(callback: DataCallback): void {
        this.webview.onDidReceiveMessage(callback);
      }
    }

    class WebviewMessageWriter extends AbstractMessageWriter {
      constructor(private webview: Webview) {
        super();
      }
      write(msg: Message): Promise<void> {
        this.webview.postMessage(msg);
        return Promise.resolve();
      }
      end(): void {}
    }

    const reader = new WebviewMessageReader(this._panel.webview);
    const writer = new WebviewMessageWriter(this._panel.webview);
    this._rpcConnection = createMessageConnection(reader, writer);

    // State management RPC handlers
    this._rpcConnection.onRequest('saveState', async (params: { state: WebviewState }) => {
      const success = await this._stateManager.saveState(params.state);
      return { success, timestamp: new Date().toISOString() };
    });

    this._rpcConnection.onRequest('loadState', async () => {
      const state = await this._stateManager.loadState();
      return { success: true, data: state };
    });

    this._rpcConnection.onRequest('createSnapshot', async (params: { suffix?: string }) => {
      try {
        const snapshotFile = await this._stateManager.createSnapshot(params.suffix);
        return { success: true, file: snapshotFile };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Original handlers from JSON-RPC pattern
    this._rpcConnection.onRequest('getDOMState', () => {
      return { 
        timestamp: new Date().toISOString(),
        message: 'DOM state requested from extension'
      };
    });

    this._rpcConnection.onRequest('inspectElement', (params: { selector: string }) => {
      return {
        selector: params.selector,
        found: true,
        timestamp: new Date().toISOString()
      };
    });

    this._rpcConnection.onNotification('webviewReady', async (params: any) => {
      // Load saved state and send to webview
      const savedState = await this._stateManager.loadState();
      
      this._rpcConnection?.sendNotification('extensionReady', {
        message: 'JSON-RPC connection established from extension',
        savedState
      });
    });

    this._rpcConnection.listen();
  }
}
```

**Updated `src/webview/main.ts`** (extends JSON-RPC version)
```typescript
import { provideVSCodeDesignSystem, vsCodeButton, Button } from "@vscode/webview-ui-toolkit";
import { createMessageConnection, MessageConnection, AbstractMessageReader, AbstractMessageWriter, DataCallback, Message } from "vscode-jsonrpc/browser";

// Register VS Code design system components
provideVSCodeDesignSystem().register(vsCodeButton());

const vscode = acquireVsCodeApi();
let rpcConnection: MessageConnection;

// State management
interface WebviewState {
  formData?: Record<string, any>;
  scrollPosition?: number;
  selectedItems?: string[];
  lastModified?: string;
  customData?: any;
}

let currentState: WebviewState = {};

window.addEventListener("load", main);

function main() {
  setupRpcConnection();
  setupFormHandling();
  setupAutoSave();

  const howdyButton = document.getElementById("howdy") as Button;
  
  if (howdyButton) {
    let clickCount = 0;
    
    howdyButton.addEventListener("click", async () => {
      clickCount++;
      
      const originalText = howdyButton.textContent?.replace(/ \(\d+\)/, '') || 'Howdy!';
      howdyButton.textContent = `${originalText} (${clickCount})`;
      
      // Update state
      currentState.customData = { 
        clickCount, 
        lastClick: new Date().toISOString() 
      };
      
      // Save state
      await saveState();
      
      // Send JSON-RPC requests
      try {
        const result = await rpcConnection.sendRequest('getDOMState', {});
        console.log('Extension response:', result);
        
        const domInfoEl = document.getElementById('dom-info');
        if (domInfoEl) {
          domInfoEl.innerHTML = `
            <strong>Last Extension Response:</strong><br>
            <pre>${JSON.stringify(result, null, 2)}</pre>
            <br>
            <strong>Current State:</strong><br>
            <pre>${JSON.stringify(currentState, null, 2)}</pre>
          `;
        }
        
        const inspectResult = await rpcConnection.sendRequest('inspectElement', { 
          selector: '#howdy' 
        });
        console.log('Inspect result:', inspectResult);
        
      } catch (error) {
        console.error('RPC Error:', error);
      }
    });
  }
}

function setupRpcConnection() {
  class VSCodeMessageReader extends AbstractMessageReader {
    listen(callback: DataCallback): void {
      window.addEventListener('message', (event) => {
        callback(event.data);
      });
    }
  }

  class VSCodeMessageWriter extends AbstractMessageWriter {
    write(msg: Message): Promise<void> {
      vscode.postMessage(msg);
      return Promise.resolve();
    }
    end(): void {}
  }

  const reader = new VSCodeMessageReader();
  const writer = new VSCodeMessageWriter();
  rpcConnection = createMessageConnection(reader, writer);

  // Handle notifications from extension
  rpcConnection.onNotification('extensionReady', async (params: any) => {
    console.log('Webview received extensionReady:', params);
    
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = `Status: ${params.message}`;
    }

    // Restore saved state
    if (params.savedState && Object.keys(params.savedState).length > 0) {
      currentState = params.savedState;
      restoreState(currentState);
    }
  });

  rpcConnection.onNotification('stateChanged', (params: any) => {
    console.log('External state change detected:', params);
    if (params.source === 'file' && params.data) {
      currentState = params.data;
      restoreState(currentState);
    }
  });

  rpcConnection.listen();

  setTimeout(() => {
    rpcConnection.sendNotification('webviewReady', {
      message: 'Webview JSON-RPC client initialized',
      domReady: true
    });
  }, 500);
}

function setupFormHandling() {
  // Create a sample form for state demonstration
  const body = document.body;
  
  const form = document.createElement('div');
  form.innerHTML = `
    <h3>Form State Example</h3>
    <input type="text" id="username" placeholder="Username">
    <input type="email" id="email" placeholder="Email">
    <textarea id="notes" placeholder="Notes"></textarea>
    <button type="button" id="save-snapshot">Save Snapshot</button>
  `;
  
  body.appendChild(form);

  // Add form change listeners
  ['username', 'email', 'notes'].forEach(id => {
    const element = document.getElementById(id) as HTMLInputElement;
    if (element) {
      element.addEventListener('input', (e) => {
        const target = e.target as HTMLInputElement;
        if (!currentState.formData) {
          currentState.formData = {};
        }
        currentState.formData[id] = target.value;
      });
    }
  });

  // Snapshot button
  const snapshotBtn = document.getElementById('save-snapshot');
  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', async () => {
      try {
        const result = await rpcConnection.sendRequest('createSnapshot', { 
          suffix: '-manual' 
        });
        
        if (result.success) {
          const statusEl = document.getElementById('status');
          if (statusEl) {
            statusEl.textContent = `Snapshot saved: ${result.file}`;
          }
        }
      } catch (error) {
        console.error('Failed to create snapshot:', error);
      }
    });
  }
}

function setupAutoSave() {
  // Auto-save every 5 seconds
  setInterval(async () => {
    if (Object.keys(currentState).length > 0) {
      await saveState();
    }
  }, 5000);

  // Save on page unload
  window.addEventListener('beforeunload', () => {
    saveState();
  });

  // Save on scroll
  window.addEventListener('scroll', () => {
    currentState.scrollPosition = window.scrollY;
  });
}

async function saveState(): Promise<boolean> {
  try {
    const result = await rpcConnection.sendRequest('saveState', { 
      state: currentState 
    });
    
    console.log('State saved:', result);
    return result.success;
  } catch (error) {
    console.error('Failed to save state:', error);
    return false;
  }
}

async function loadState(): Promise<WebviewState> {
  try {
    const result = await rpcConnection.sendRequest('loadState', {});
    
    if (result.success && result.data) {
      currentState = result.data;
      return result.data;
    }
    
    return {};
  } catch (error) {
    console.error('Failed to load state:', error);
    return {};
  }
}

function restoreState(state: WebviewState) {
  console.log('Restoring state:', state);

  // Restore form data
  if (state.formData) {
    Object.entries(state.formData).forEach(([id, value]) => {
      const element = document.getElementById(id) as HTMLInputElement;
      if (element && typeof value === 'string') {
        element.value = value;
      }
    });
  }

  // Restore scroll position
  if (state.scrollPosition) {
    window.scrollTo(0, state.scrollPosition);
  }

  // Restore custom data (like click count)
  if (state.customData?.clickCount) {
    const howdyButton = document.getElementById("howdy") as Button;
    if (howdyButton) {
      const originalText = howdyButton.textContent?.replace(/ \(\d+\)/, '') || 'Howdy!';
      howdyButton.textContent = `${originalText} (${state.customData.clickCount})`;
    }
  }
}
```

**Updated `src/extension.ts`**
```typescript
import { commands, ExtensionContext } from "vscode";
import { HelloWorldPanel } from "./panels/HelloWorldPanel";

export function activate(context: ExtensionContext) {
  const showHelloWorldCommand = commands.registerCommand("hello-world.showHelloWorld", () => {
    HelloWorldPanel.render(context.extensionUri, context);
  });

  context.subscriptions.push(showHelloWorldCommand);
}
```

#### 3. Testing the Implementation

1. **Build and run the extension:**
   ```bash
   npm run compile
   # Press F5 to debug
   ```

2. **Test state persistence:**
   - Open the webview
   - Fill in the form fields
   - Click the button multiple times
   - Close and reopen the webview
   - Verify data is restored

3. **Test external state changes:**
   - Edit the state file manually in `~/.vscode/extensions/.../globalStorage/`
   - Watch the webview update automatically

4. **Test snapshots:**
   - Click "Save Snapshot" button
   - Find snapshot files in the storage directory

#### Webview State Management
```typescript
// Webview side - state persistence
class WebviewStateManager {
  private stateFile = 'workspace/.vscode/webview-state.json';

  async saveState(state: any) {
    // Option 1: Use JSON-RPC to request extension to save
    await rpcConnection.sendRequest('saveState', { 
      file: this.stateFile, 
      data: state 
    });

    // Option 2: Use localStorage as backup
    localStorage.setItem('webview-state', JSON.stringify(state));
  }

  async loadState(): Promise<any> {
    try {
      // Primary: Request state from extension
      const result = await rpcConnection.sendRequest('loadState', { 
        file: this.stateFile 
      });
      return result.data;
    } catch (error) {
      // Fallback: Use localStorage
      const stored = localStorage.getItem('webview-state');
      return stored ? JSON.parse(stored) : {};
    }
  }

  // Auto-save on changes
  setupAutoSave() {
    setInterval(async () => {
      const currentState = this.getCurrentDOMState();
      await this.saveState(currentState);
    }, 5000); // Save every 5 seconds
  }

  private getCurrentDOMState() {
    return {
      html: document.documentElement.outerHTML,
      formData: this.getFormData(),
      scrollPosition: window.scrollY,
      timestamp: Date.now()
    };
  }
}
```

#### Extension File Operations
```typescript
// Extension side - file system operations
class ExtensionStateManager {
  constructor(private context: vscode.ExtensionContext) {
    this.setupRpcHandlers();
    this.setupFileWatcher();
  }

  private setupRpcHandlers() {
    // Handle save state requests
    this._rpcConnection.onRequest('saveState', async (params: { file: string, data: any }) => {
      try {
        const filePath = path.join(this.context.extensionPath, params.file);
        await fs.promises.writeFile(filePath, JSON.stringify(params.data, null, 2));
        return { success: true, timestamp: new Date().toISOString() };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // Handle load state requests  
    this._rpcConnection.onRequest('loadState', async (params: { file: string }) => {
      try {
        const filePath = path.join(this.context.extensionPath, params.file);
        const content = await fs.promises.readFile(filePath, 'utf8');
        return { success: true, data: JSON.parse(content) };
      } catch (error) {
        return { success: false, data: {}, error: error.message };
      }
    });
  }

  private setupFileWatcher() {
    // Watch for external file changes
    const watcher = vscode.workspace.createFileSystemWatcher('**/.vscode/webview-state.json');
    
    watcher.onDidChange(async (uri) => {
      const content = await fs.promises.readFile(uri.fsPath, 'utf8');
      const state = JSON.parse(content);
      
      // Notify webview of state changes
      this._rpcConnection.sendNotification('stateChanged', { 
        source: 'file', 
        data: state 
      });
    });
  }

  // Periodic state snapshots
  setupPeriodicSnapshots() {
    setInterval(async () => {
      // Request current state from webview
      const state = await this._rpcConnection.sendRequest('getCurrentState', {});
      
      // Save timestamped snapshot
      const snapshotFile = `snapshots/state-${Date.now()}.json`;
      await this.saveStateToFile(snapshotFile, state);
    }, 30000); // Snapshot every 30 seconds
  }
}
```

#### Usage Examples
```typescript
// Webview usage
const stateManager = new WebviewStateManager();

// Auto-save form data
document.addEventListener('input', async (event) => {
  const formData = getFormData();
  await stateManager.saveState({ formData, timestamp: Date.now() });
});

// Restore state on load
window.addEventListener('load', async () => {
  const savedState = await stateManager.loadState();
  if (savedState.formData) {
    restoreFormData(savedState.formData);
  }
});

// Extension usage
const stateManager = new ExtensionStateManager(context);

// Monitor webview state changes
stateManager.onStateChange((newState) => {
  console.log('Webview state updated:', newState);
  
  // Sync with workspace settings
  vscode.workspace.getConfiguration().update('webview.lastState', newState);
});
```

### Benefits
- **Persistent state** - Survives extension reload/VS Code restart
- **File-based** - Can be version controlled, shared, backed up
- **Flexible storage** - JSON, binary, database files supported
- **External editing** - State files can be modified outside VS Code
- **Automatic backups** - Timestamped snapshots for recovery
- **Workspace integration** - State tied to specific workspaces

### Use Cases
- **Form persistence** - Save/restore complex form data
- **Editor state** - Remember cursor position, selections, folding
- **User preferences** - Per-workspace webview settings
- **Session recovery** - Restore webview state after crashes
- **Collaborative editing** - Share state across team members
- **Undo/redo systems** - Historical state snapshots

---

## Build Configuration

### esbuild.js
```javascript
// Extension bundle (server-side rendering)
const extensionConfig = {
  platform: "node",
  format: "cjs",
  entryPoints: ["./src/extension.ts"],
  outfile: "./out/extension.js",
  external: ["vscode"],
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment",
};

// Webview bundle (client-side enhancement)
const webviewConfig = {
  target: "es2020",
  format: "esm", 
  entryPoints: ["./src/webview/main.ts"],
  outfile: "./out/webview.js",
  jsx: "transform",
  jsxFactory: "h",
  jsxFragment: "Fragment",
};
```

### package.json Dependencies
```json
{
  "dependencies": {
    "preact": "^10.27.1",
    "preact-render-to-string": "^6.6.1",
    "vscode-jsonrpc": "^8.2.1"
  }
}
```

---

## Best Practices

1. **Separation of Concerns**
   - Extension handles server-side rendering and business logic
   - Webview handles client-side interactivity and UI updates
   - Use JSON-RPC for structured communication

2. **Performance**
   - Pre-render HTML on server for fast initial load
   - Use progressive enhancement for interactivity
   - Implement efficient state synchronization

3. **Security**
   - Validate all data crossing extension/webview boundary
   - Use proper Content Security Policy
   - Sanitize user input and file paths

4. **Error Handling**
   - Implement proper error handling in JSON-RPC calls
   - Provide fallbacks for file system operations
   - Handle network/communication failures gracefully

5. **Development**
   - Use TypeScript for type safety across boundaries
   - Implement proper disposal/cleanup
   - Test both online and offline scenarios