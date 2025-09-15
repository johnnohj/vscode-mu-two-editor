// src/core/types.ts
import * as vscode from 'vscode';

/**
 * Core device abstraction - both real CircuitPython and virtual PyScript devices implement this
 */
export interface DeviceProvider {
  readonly id: string;
  readonly type: DeviceType;
  readonly displayName: string;
  readonly isConnected: boolean;
  readonly capabilities: DeviceCapability[];

  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // REPL communication - designed for xterm.js integration
  sendInput(data: string): Promise<void>;
  onData: vscode.Event<string>;           // Raw data from device (for xterm display)
  onConnectionChange: vscode.Event<ConnectionState>;
  onError: vscode.Event<DeviceError>;
  
  // Device information and control
  getDeviceInfo(): Promise<DeviceInfo>;
  softReboot?(): Promise<void>;           // Ctrl+D equivalent
  hardReboot?(): Promise<void>;           // Hardware reset
  interrupt?(): Promise<void>;            // Ctrl+C equivalent
  
  // Optional file operations (for future expansion)
  listFiles?(path?: string): Promise<FileInfo[]>;
  readFile?(path: string): Promise<string>;
  writeFile?(path: string, content: string): Promise<void>;
}

/**
 * Device types supported by the extension
 */
export type DeviceType = 'circuitpython' | 'pyscript' | 'micropython';

/**
 * Device capabilities - used to show/hide UI features
 */
export type DeviceCapability = 
  | 'repl'                    // Supports REPL communication
  | 'file-system'            // Supports file operations
  | 'soft-reboot'            // Supports Ctrl+D soft reboot
  | 'hard-reboot'            // Supports hardware reset
  | 'interrupt'              // Supports Ctrl+C interrupt
  | 'multi-line-editing'     // Supports multi-line code input
  | 'auto-completion'        // Supports tab completion
  | 'workspace-sync'         // Can sync with VS Code workspace
  | 'state-monitoring'       // Provides debug state information
  | 'virtual-board';         // Is a virtual/simulated board

/**
 * Connection states for UI feedback
 */
export type ConnectionState = 
  | 'disconnected'
  | 'connecting' 
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * Device information for display and identification
 */
export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType;
  displayName: string;
  description?: string;
  
  // Connection details
  connectionState: ConnectionState;
  lastConnected?: Date;
  autoConnect?: boolean;
  
  // Device-specific metadata
  path?: string;              // Serial port path for real devices
  boardId?: string;           // CircuitPython board identifier  
  firmwareVersion?: string;   // Device firmware version
  pythonVersion?: string;     // Python/MicroPython version
  
  // Capabilities and features
  capabilities: DeviceCapability[];
  
  // Health and diagnostics
  signalStrength?: number;    // Connection quality (0-100)
  lastError?: string;         // Last connection error
}

/**
 * Device errors with context for user feedback
 */
export interface DeviceError {
  type: DeviceErrorType;
  message: string;
  details?: string;
  timestamp: Date;
  recoverable: boolean;       // Can user retry this operation?
  deviceId: string;
}

export type DeviceErrorType =
  | 'connection-failed'
  | 'connection-lost' 
  | 'permission-denied'
  | 'device-busy'
  | 'timeout'
  | 'protocol-error'
  | 'hardware-error'
  | 'unknown';

/**
 * REPL-specific interfaces for xterm.js integration
 */
export interface REPLSession {
  readonly sessionId: string;
  readonly deviceId: string;
  readonly isActive: boolean;
  
  // Terminal integration
  attachToTerminal(terminal: any): void;  // xterm.js Terminal instance
  detachFromTerminal(): void;
  
  // Input handling with multi-line support
  sendInput(data: string): Promise<void>;
  sendCommand(command: string): Promise<void>;
  sendInterrupt(): Promise<void>;          // Ctrl+C
  sendEOF(): Promise<void>;                // Ctrl+D
  
  // History management
  getCommandHistory(): string[];
  clearHistory(): void;
  
  // Multi-line editing support
  isInMultiLineMode(): boolean;
  getCurrentInput(): string;
  
  // Events for xterm.js integration
  onData: vscode.Event<string>;
  onPromptChange: vscode.Event<REPLPrompt>;
  onModeChange: vscode.Event<REPLMode>;
  onHistoryChange: vscode.Event<string[]>;
}

/**
 * REPL prompt states for UI feedback
 */
export interface REPLPrompt {
  type: 'primary' | 'continuation' | 'raw';
  text: string;               // ">>> " or "... " or ""
  position: number;           // Character position in terminal
}

/**
 * REPL modes for different interaction states
 */
export type REPLMode = 
  | 'interactive'             // Normal REPL mode
  | 'raw'                     // Raw mode (paste mode)
  | 'multi-line'              // Multi-line input mode
  | 'busy'                    // Executing command
  | 'error'                   // Error state
  | 'disconnected';           // No device connection

/**
 * File system interfaces for device file operations
 */
export interface FileInfo {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: Date;
  isReadOnly?: boolean;
}

/**
 * Central device manager interface
 */
export interface DeviceManager {
  // Device discovery and enumeration
  scanForDevices(): Promise<void>;
  getAvailableDevices(): DeviceInfo[];
  getConnectedDevice(): DeviceProvider | null;
  
  // Connection management (single device initially)
  connectToDevice(deviceId: string): Promise<void>;
  disconnectCurrentDevice(): Promise<void>;
  reconnectCurrentDevice(): Promise<void>;
  
  // REPL session management
  createREPLSession(): Promise<REPLSession | null>;
  getCurrentREPLSession(): REPLSession | null;
  closeREPLSession(): Promise<void>;
  
  // Events for UI updates
  onDeviceListChanged: vscode.Event<DeviceInfo[]>;
  onConnectionChanged: vscode.Event<DeviceInfo | null>;
  onSessionChanged: vscode.Event<REPLSession | null>;
  onError: vscode.Event<DeviceError>;
}

/**
 * Message types for webview communication
 */
export interface WebviewMessage {
  type: string;
  payload: any;
  timestamp: number;
  requestId?: string;         // For request/response patterns
}

/**
 * Device-to-webview messages
 */
export type DeviceToWebviewMessage = 
  | { type: 'device-list-updated'; payload: DeviceInfo[] }
  | { type: 'connection-changed'; payload: DeviceInfo | null }
  | { type: 'repl-data'; payload: { data: string; sessionId: string } }
  | { type: 'repl-prompt-changed'; payload: REPLPrompt }
  | { type: 'repl-mode-changed'; payload: REPLMode }
  | { type: 'error'; payload: DeviceError }
  | { type: 'device-info-updated'; payload: DeviceInfo };

/**
 * Webview-to-device messages  
 */
export type WebviewToDeviceMessage =
  | { type: 'scan-devices'; payload: {} }
  | { type: 'connect-device'; payload: { deviceId: string } }
  | { type: 'disconnect-device'; payload: {} }
  | { type: 'send-input'; payload: { data: string } }
  | { type: 'send-command'; payload: { command: string } }
  | { type: 'send-interrupt'; payload: {} }
  | { type: 'send-eof'; payload: {} }
  | { type: 'get-device-info'; payload: { deviceId: string } }
  | { type: 'create-repl-session'; payload: {} }
  | { type: 'close-repl-session'; payload: {} };

/**
 * Configuration for device providers
 */
export interface DeviceProviderConfig {
  // Connection settings
  autoReconnect: boolean;
  reconnectDelay: number;
  connectionTimeout: number;
  
  // REPL settings
  enableHistory: boolean;
  historySize: number;
  enableMultiLine: boolean;
  promptTimeout: number;
  
  // Terminal settings
  encoding: string;
  newlineMode: 'auto' | 'cr' | 'lf' | 'crlf';
  
  // Device-specific settings
  [key: string]: any;
}

/**
 * CircuitPython-specific configuration
 */
export interface CircuitPythonConfig extends DeviceProviderConfig {
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: 'none' | 'even' | 'odd';
  flowControl: boolean;
  
  // CircuitPython-specific
  enableSoftReboot: boolean;
  enableSafeMode: boolean;
  detectBoardType: boolean;
}

/**
 * PyScript-specific configuration
 */
export interface PyScriptConfig extends DeviceProviderConfig {
  enableBlinka: boolean;
  enableWorkspaceSync: boolean;
  virtualBoardType: string;
  simulateHardware: boolean;
  
  // Performance settings
  executionTimeout: number;
  memoryLimit: number;
}

export type TerminalToWebviewMessage = 
  | { type: 'terminal-write'; payload: { data: string } }
  | { type: 'terminal-clear'; payload: {} }
  | { type: 'terminal-resize'; payload: { cols: number; rows: number } }
  | { type: 'terminal-set-options'; payload: { options: any } }
  | { type: 'terminal-show-status'; payload: { status: TerminalStatus } }
  | { type: 'history-update'; payload: { history: string[] } }
  | { type: 'repl-prompt-changed'; payload: { prompt: string; mode: REPLMode } };

export type WebviewToTerminalMessage =
  | { type: 'terminal-input'; payload: { data: string } }
  | { type: 'terminal-resize'; payload: { cols: number; rows: number } }
  | { type: 'terminal-ready'; payload: {} }
  | { type: 'history-navigate'; payload: { direction: 'up' | 'down' } }
  | { type: 'interrupt-request'; payload: {} }
  | { type: 'eof-request'; payload: {} };

export interface TerminalStatus {
  type: 'connected' | 'disconnected' | 'connecting' | 'error';
  deviceName?: string;
  message?: string;
}

/**
 * Xterm.js integration helpers
 */
export interface TerminalIntegration {
  // Terminal instance management
  createTerminal(containerId: string, options?: any): any;
  attachDevice(terminal: any, session: REPLSession): void;
  detachDevice(terminal: any): void;
  
  // Input processing for multi-line support
  processInput(input: string, mode: REPLMode): ProcessedInput;
  
  // Terminal control
  clearTerminal(terminal: any): void;
  setTerminalSize(terminal: any, cols: number, rows: number): void;
  
  // History integration
  setupHistoryNavigation(terminal: any, session: REPLSession): void;
  
  // Visual feedback
  showConnectedIndicator(terminal: any, device: DeviceInfo): void;
  showDisconnectedIndicator(terminal: any): void;
  showErrorIndicator(terminal: any, error: DeviceError): void;
}

export interface ProcessedInput {
  type: 'command' | 'continuation' | 'interrupt' | 'eof' | 'raw';
  data: string;
  shouldExecute: boolean;
  isMultiLine: boolean;
}

/**
 * Extension state management
 */
export interface ExtensionState {
  // Current connections
  currentDevice: DeviceInfo | null;
  currentSession: REPLSession | null;
  
  // Available devices
  availableDevices: DeviceInfo[];
  
  // Configuration
  config: DeviceProviderConfig;
  
  // UI state
  terminalVisible: boolean;
  devicePanelVisible: boolean;
  lastActiveDevice: string | null;
}

/**
 * Service interfaces for dependency injection
 */
export interface ServiceContainer {
  deviceManager: DeviceManager;
  terminalIntegration: TerminalIntegration;
  configurationManager: ConfigurationManager;
  
  // Provider factories
  createCircuitPythonProvider(config: CircuitPythonConfig): DeviceProvider;
  createPyScriptProvider(config: PyScriptConfig): DeviceProvider;
}

export interface ConfigurationManager {
  getDeviceConfig(type: DeviceType): DeviceProviderConfig;
  updateDeviceConfig(type: DeviceType, config: Partial<DeviceProviderConfig>): void;
  getGlobalConfig(): ExtensionConfig;
  onConfigChanged: vscode.Event<DeviceType>;
}

export interface ExtensionConfig {
  defaultDeviceType: DeviceType;
  autoScanInterval: number;
  enableDebugMode: boolean;
  terminalTheme: string;
  
  // Device type configs
  circuitpython: CircuitPythonConfig;
  pyscript: PyScriptConfig;
}