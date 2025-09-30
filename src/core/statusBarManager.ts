/**
 * Status Bar Manager
 *
 * Provides visual feedback for extension state via VS Code status bar.
 * Shows device connection status and Python environment status.
 *
 * Follows VS Code API patterns from EXT-APP-ARCHITECTURE.md
 */

import * as vscode from 'vscode';

/**
 * Device connection state
 */
export enum DeviceState {
  NO_DEVICE = 'no-device',
  CONNECTED = 'connected',
  CONNECTING = 'connecting',
  ERROR = 'error'
}

/**
 * Python environment state
 */
export enum PythonState {
  NOT_READY = 'not-ready',
  INITIALIZING = 'initializing',
  READY = 'ready',
  ERROR = 'error'
}

/**
 * Status Bar Manager
 *
 * Manages status bar items for extension state display.
 * Provides at-a-glance information about device and Python environment.
 */
export class StatusBarManager {
  private deviceStatusItem: vscode.StatusBarItem;
  private pythonStatusItem: vscode.StatusBarItem;

  private deviceState: DeviceState = DeviceState.NO_DEVICE;
  private pythonState: PythonState = PythonState.NOT_READY;
  private currentDeviceName: string | undefined;

  constructor(context: vscode.ExtensionContext) {
    // Device status (left side, higher priority)
    this.deviceStatusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.deviceStatusItem.command = 'muTwo.selectDevice';
    context.subscriptions.push(this.deviceStatusItem);

    // Python status (left side, lower priority)
    this.pythonStatusItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this.pythonStatusItem.command = 'muTwo.python.showEnvironmentInfo';
    context.subscriptions.push(this.pythonStatusItem);

    // Initialize display
    this.updateDeviceStatus();
    this.updatePythonStatus();
  }

  // ========================================================================
  // DEVICE STATUS
  // ========================================================================

  /**
   * Update device connection status
   */
  public setDeviceState(state: DeviceState, deviceName?: string): void {
    this.deviceState = state;
    this.currentDeviceName = deviceName;
    this.updateDeviceStatus();
  }

  /**
   * Set device as connected
   */
  public setDeviceConnected(deviceName: string): void {
    this.setDeviceState(DeviceState.CONNECTED, deviceName);
  }

  /**
   * Set device as connecting
   */
  public setDeviceConnecting(deviceName: string): void {
    this.setDeviceState(DeviceState.CONNECTING, deviceName);
  }

  /**
   * Set no device connected
   */
  public setNoDevice(): void {
    this.setDeviceState(DeviceState.NO_DEVICE);
  }

  /**
   * Set device error
   */
  public setDeviceError(message?: string): void {
    this.currentDeviceName = message;
    this.setDeviceState(DeviceState.ERROR);
  }

  /**
   * Update device status bar item
   */
  private updateDeviceStatus(): void {
    switch (this.deviceState) {
      case DeviceState.CONNECTED:
        this.deviceStatusItem.text = `$(check) ${this.currentDeviceName || 'Device'}`;
        this.deviceStatusItem.tooltip = `Connected: ${this.currentDeviceName}\nClick to select device`;
        this.deviceStatusItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.prominentBackground'
        );
        break;

      case DeviceState.CONNECTING:
        this.deviceStatusItem.text = `$(sync~spin) ${this.currentDeviceName || 'Connecting...'}`;
        this.deviceStatusItem.tooltip = `Connecting to ${this.currentDeviceName}\nClick to cancel`;
        this.deviceStatusItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground'
        );
        break;

      case DeviceState.ERROR:
        this.deviceStatusItem.text = `$(error) Device Error`;
        this.deviceStatusItem.tooltip = `Error: ${this.currentDeviceName || 'Unknown error'}\nClick to select device`;
        this.deviceStatusItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground'
        );
        break;

      case DeviceState.NO_DEVICE:
      default:
        this.deviceStatusItem.text = '$(circuit-board) No Device';
        this.deviceStatusItem.tooltip = 'No CircuitPython device connected\nClick to select device';
        this.deviceStatusItem.backgroundColor = undefined;
        break;
    }

    this.deviceStatusItem.show();
  }

  // ========================================================================
  // PYTHON STATUS
  // ========================================================================

  /**
   * Update Python environment status
   */
  public setPythonState(state: PythonState, message?: string): void {
    this.pythonState = state;
    this.updatePythonStatus(message);
  }

  /**
   * Set Python environment as ready
   */
  public setPythonReady(venvPath?: string): void {
    this.pythonState = PythonState.READY;
    this.updatePythonStatus(venvPath);
  }

  /**
   * Set Python environment as initializing
   */
  public setPythonInitializing(message?: string): void {
    this.pythonState = PythonState.INITIALIZING;
    this.updatePythonStatus(message);
  }

  /**
   * Set Python environment as not ready
   */
  public setPythonNotReady(): void {
    this.pythonState = PythonState.NOT_READY;
    this.updatePythonStatus();
  }

  /**
   * Set Python environment error
   */
  public setPythonError(error: string): void {
    this.pythonState = PythonState.ERROR;
    this.updatePythonStatus(error);
  }

  /**
   * Update Python status bar item
   */
  private updatePythonStatus(message?: string): void {
    switch (this.pythonState) {
      case PythonState.READY:
        this.pythonStatusItem.text = '$(python) Python Ready';
        this.pythonStatusItem.tooltip = message
          ? `Python environment ready\nPath: ${message}\nClick for details`
          : 'Python environment ready\nClick for details';
        this.pythonStatusItem.backgroundColor = undefined;
        break;

      case PythonState.INITIALIZING:
        this.pythonStatusItem.text = '$(sync~spin) Python Setup';
        this.pythonStatusItem.tooltip = message
          ? `Initializing Python environment\n${message}`
          : 'Initializing Python environment...';
        this.pythonStatusItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.warningBackground'
        );
        break;

      case PythonState.ERROR:
        this.pythonStatusItem.text = '$(error) Python Error';
        this.pythonStatusItem.tooltip = message
          ? `Python environment error\n${message}\nClick for details`
          : 'Python environment error\nClick for details';
        this.pythonStatusItem.backgroundColor = new vscode.ThemeColor(
          'statusBarItem.errorBackground'
        );
        break;

      case PythonState.NOT_READY:
      default:
        this.pythonStatusItem.text = '$(python) Python Setup';
        this.pythonStatusItem.tooltip = 'Python environment not initialized\nClick to setup';
        this.pythonStatusItem.backgroundColor = undefined;
        break;
    }

    this.pythonStatusItem.show();
  }

  // ========================================================================
  // VISIBILITY CONTROL
  // ========================================================================

  /**
   * Show device status item
   */
  public showDevice(): void {
    this.deviceStatusItem.show();
  }

  /**
   * Hide device status item
   */
  public hideDevice(): void {
    this.deviceStatusItem.hide();
  }

  /**
   * Show Python status item
   */
  public showPython(): void {
    this.pythonStatusItem.show();
  }

  /**
   * Hide Python status item
   */
  public hidePython(): void {
    this.pythonStatusItem.hide();
  }

  /**
   * Show all status items
   */
  public showAll(): void {
    this.showDevice();
    this.showPython();
  }

  /**
   * Hide all status items
   */
  public hideAll(): void {
    this.hideDevice();
    this.hidePython();
  }

  // ========================================================================
  // CLEANUP
  // ========================================================================

  /**
   * Dispose status bar items
   */
  public dispose(): void {
    this.deviceStatusItem.dispose();
    this.pythonStatusItem.dispose();
  }
}

/**
 * Global status bar manager instance
 */
let statusBarManager: StatusBarManager | undefined;

/**
 * Initialize the global status bar manager
 */
export function initStatusBar(context: vscode.ExtensionContext): StatusBarManager {
  statusBarManager = new StatusBarManager(context);
  return statusBarManager;
}

/**
 * Get the global status bar manager instance
 */
export function getStatusBar(): StatusBarManager {
  if (!statusBarManager) {
    throw new Error('StatusBarManager not initialized. Call initStatusBar first.');
  }
  return statusBarManager;
}
