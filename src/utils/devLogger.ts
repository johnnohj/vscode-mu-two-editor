/**
 * Development Logger
 *
 * Provides colored, component-filtered logging for development workflow.
 * Uses ANSI escape codes for terminal colors.
 * Integrates with VS Code Output Channel for persistent logs.
 *
 * Usage:
 *   const logger = getDevLogger();
 *   logger.device('Device connected', { port: '/dev/ttyUSB0' });
 *   logger.python('Venv created at', venvPath);
 *   logger.bundle('Downloaded 350 libraries');
 */

import * as vscode from 'vscode';
import { getResourceLocator } from '../core/resourceLocator';

/**
 * Log component types - matches extension architecture
 */
export type LogComponent =
  | 'DEVICE'      // Device detection, connection
  | 'BOARD'       // Board operations
  | 'PYTHON'      // Python environment
  | 'BUNDLE'      // Library/bundle management
  | 'WORKSPACE'   // Workspace operations
  | 'PROJECT'     // Project management
  | 'TERMINAL'    // Terminal/task operations
  | 'REPL'        // REPL operations
  | 'WASM'        // WASM runtime
  | 'FILE'        // File operations
  | 'STATE'       // State management
  | 'EXTENSION';  // Extension lifecycle

/**
 * Log level with colors
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SUCCESS = 4
}

/**
 * ANSI color codes for terminal output
 */
const ANSI = {
  // Text colors
  RED: '\x1b[31m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  BLUE: '\x1b[34m',
  MAGENTA: '\x1b[35m',
  CYAN: '\x1b[36m',
  WHITE: '\x1b[37m',
  GRAY: '\x1b[90m',

  // Bright colors
  BRIGHT_RED: '\x1b[91m',
  BRIGHT_GREEN: '\x1b[92m',
  BRIGHT_YELLOW: '\x1b[93m',
  BRIGHT_BLUE: '\x1b[94m',
  BRIGHT_MAGENTA: '\x1b[95m',
  BRIGHT_CYAN: '\x1b[96m',

  // Styles
  BOLD: '\x1b[1m',
  DIM: '\x1b[2m',
  RESET: '\x1b[0m'
};

/**
 * Component color mapping
 */
const COMPONENT_COLORS: Record<LogComponent, string> = {
  DEVICE: ANSI.BRIGHT_CYAN,
  BOARD: ANSI.BRIGHT_BLUE,
  PYTHON: ANSI.BRIGHT_GREEN,
  BUNDLE: ANSI.BRIGHT_MAGENTA,
  WORKSPACE: ANSI.CYAN,
  PROJECT: ANSI.BLUE,
  TERMINAL: ANSI.MAGENTA,
  REPL: ANSI.YELLOW,
  WASM: ANSI.GREEN,
  FILE: ANSI.WHITE,
  STATE: ANSI.GRAY,
  EXTENSION: ANSI.BRIGHT_YELLOW
};

/**
 * Level color mapping
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: ANSI.GRAY,
  [LogLevel.INFO]: ANSI.WHITE,
  [LogLevel.WARN]: ANSI.YELLOW,
  [LogLevel.ERROR]: ANSI.RED,
  [LogLevel.SUCCESS]: ANSI.GREEN
};

/**
 * Level prefix mapping
 */
const LEVEL_PREFIX: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO ',
  [LogLevel.WARN]: 'WARN ',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SUCCESS]: 'OK   '
};

/**
 * Development logger configuration
 */
interface DevLoggerConfig {
  minLevel: LogLevel;
  enabledComponents: Set<LogComponent> | 'all';
  useColors: boolean;
  includeTimestamp: boolean;
  includeStackTrace: boolean; // For errors
  writeToFile: boolean; // Write logs to file
}

/**
 * Development Logger
 *
 * Provides colored, filtered logging for development.
 * NO EMOJIS - uses ANSI colors for visual distinction.
 */
export class DevLogger {
  private outputChannel: vscode.OutputChannel;
  private config: DevLoggerConfig;
  private logFileUri?: vscode.Uri;
  private sessionStartTime: Date;

  constructor(
    outputChannel: vscode.OutputChannel,
    logFileUri?: vscode.Uri,
    config?: Partial<DevLoggerConfig>
  ) {
    this.outputChannel = outputChannel;
    this.logFileUri = logFileUri;
    this.sessionStartTime = new Date();
    this.config = {
      minLevel: LogLevel.DEBUG,
      enabledComponents: 'all',
      useColors: true,
      includeTimestamp: true,
      includeStackTrace: true,
      writeToFile: true,
      ...config
    };

    // Write session header to log file
    if (this.logFileUri && this.config.writeToFile) {
      this.writeSessionHeader();
    }
  }

  /**
   * Write session header to log file
   */
  private async writeSessionHeader(): Promise<void> {
    if (!this.logFileUri) return;

    const header = [
      '='.repeat(80),
      `Mu 2 Editor Extension - Development Log`,
      `Session Start: ${this.sessionStartTime.toISOString()}`,
      `Platform: ${process.platform}`,
      `VS Code: ${vscode.version}`,
      '='.repeat(80),
      ''
    ].join('\n');

    try {
      // Append to existing log file
      const encoder = new TextEncoder();
      await vscode.workspace.fs.writeFile(
        this.logFileUri,
        encoder.encode(header)
      );
    } catch (error) {
      // Silently fail if can't write to file
      console.error('Failed to write log file header:', error);
    }
  }

  /**
   * Write log entry to file
   */
  private async writeToLogFile(plainText: string): Promise<void> {
    if (!this.logFileUri || !this.config.writeToFile) return;

    try {
      const encoder = new TextEncoder();
      const existing = await vscode.workspace.fs.readFile(this.logFileUri);
      const newContent = new Uint8Array(existing.length + encoder.encode(plainText + '\n').length);
      newContent.set(existing);
      newContent.set(encoder.encode(plainText + '\n'), existing.length);
      await vscode.workspace.fs.writeFile(this.logFileUri, newContent);
    } catch (error) {
      // If file doesn't exist, create it
      try {
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(
          this.logFileUri,
          encoder.encode(plainText + '\n')
        );
      } catch (writeError) {
        // Silently fail if can't write
        console.error('Failed to write to log file:', writeError);
      }
    }
  }

  /**
   * Get log file path for reading
   */
  getLogFilePath(): vscode.Uri | undefined {
    return this.logFileUri;
  }

  /**
   * Open log file in editor
   */
  async openLogFile(): Promise<void> {
    if (!this.logFileUri) {
      vscode.window.showWarningMessage('Log file not configured');
      return;
    }

    try {
      // Ensure log file exists
      await vscode.workspace.fs.stat(this.logFileUri);
      const doc = await vscode.workspace.openTextDocument(this.logFileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to open log file: ${error}`);
    }
  }

  /**
   * Reveal log file in file explorer
   */
  async revealLogFile(): Promise<void> {
    if (!this.logFileUri) {
      vscode.window.showWarningMessage('Log file not configured');
      return;
    }

    try {
      await vscode.commands.executeCommand('revealFileInOS', this.logFileUri);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reveal log file: ${error}`);
    }
  }

  /**
   * Update logger configuration at runtime
   */
  configure(config: Partial<DevLoggerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Enable specific components
   */
  enableComponents(...components: LogComponent[]): void {
    if (this.config.enabledComponents === 'all') {
      this.config.enabledComponents = new Set(components);
    } else {
      components.forEach(c => this.config.enabledComponents.add(c));
    }
  }

  /**
   * Disable specific components
   */
  disableComponents(...components: LogComponent[]): void {
    if (this.config.enabledComponents === 'all') {
      // Convert to set of all components except disabled
      const allComponents: LogComponent[] = [
        'DEVICE', 'BOARD', 'PYTHON', 'BUNDLE', 'WORKSPACE',
        'PROJECT', 'TERMINAL', 'REPL', 'WASM', 'FILE', 'STATE', 'EXTENSION'
      ];
      this.config.enabledComponents = new Set(
        allComponents.filter(c => !components.includes(c))
      );
    } else {
      components.forEach(c => this.config.enabledComponents.delete(c));
    }
  }

  /**
   * Check if component is enabled
   */
  private isComponentEnabled(component: LogComponent): boolean {
    return this.config.enabledComponents === 'all' ||
           this.config.enabledComponents.has(component);
  }

  /**
   * Format log message with colors
   */
  private format(
    level: LogLevel,
    component: LogComponent,
    message: string,
    data?: any
  ): string {
    // Check if component is enabled
    if (!this.isComponentEnabled(component)) {
      return '';
    }

    // Check if level is enabled
    if (level < this.config.minLevel) {
      return '';
    }

    const parts: string[] = [];

    // Timestamp
    if (this.config.includeTimestamp) {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      if (this.config.useColors) {
        parts.push(`${ANSI.GRAY}[${timestamp}]${ANSI.RESET}`);
      } else {
        parts.push(`[${timestamp}]`);
      }
    }

    // Level
    const levelStr = LEVEL_PREFIX[level];
    if (this.config.useColors) {
      parts.push(`${LEVEL_COLORS[level]}${levelStr}${ANSI.RESET}`);
    } else {
      parts.push(levelStr);
    }

    // Component
    if (this.config.useColors) {
      const color = COMPONENT_COLORS[component];
      parts.push(`${color}${ANSI.BOLD}[${component}]${ANSI.RESET}`);
    } else {
      parts.push(`[${component}]`);
    }

    // Message
    parts.push(message);

    // Data (if provided)
    if (data !== undefined) {
      const dataStr = typeof data === 'string'
        ? data
        : JSON.stringify(data, null, 2);

      if (this.config.useColors) {
        parts.push(`${ANSI.DIM}${dataStr}${ANSI.RESET}`);
      } else {
        parts.push(dataStr);
      }
    }

    return parts.join(' ');
  }

  /**
   * Format log message without colors (for file output)
   */
  private formatPlain(
    level: LogLevel,
    component: LogComponent,
    message: string,
    data?: any
  ): string {
    // Check if component is enabled
    if (!this.isComponentEnabled(component)) {
      return '';
    }

    // Check if level is enabled
    if (level < this.config.minLevel) {
      return '';
    }

    const parts: string[] = [];

    // Timestamp
    if (this.config.includeTimestamp) {
      const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
      parts.push(`[${timestamp}]`);
    }

    // Level
    parts.push(LEVEL_PREFIX[level]);

    // Component
    parts.push(`[${component}]`);

    // Message
    parts.push(message);

    // Data (if provided)
    if (data !== undefined) {
      const dataStr = typeof data === 'string'
        ? data
        : JSON.stringify(data, null, 2);
      parts.push(dataStr);
    }

    return parts.join(' ');
  }

  /**
   * Log a message
   */
  private log(
    level: LogLevel,
    component: LogComponent,
    message: string,
    data?: any
  ): void {
    const formatted = this.format(level, component, message, data);
    if (formatted) {
      this.outputChannel.appendLine(formatted);

      // Also write to log file if enabled
      if (this.config.writeToFile && this.logFileUri) {
        const plainText = this.formatPlain(level, component, message, data);
        if (plainText) {
          // Use void to ignore promise (async write, don't block)
          void this.writeToLogFile(plainText);
        }
      }
    }
  }

  /**
   * Component-specific logging methods
   */
  device(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'DEVICE', message, data);
  }

  board(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'BOARD', message, data);
  }

  python(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'PYTHON', message, data);
  }

  bundle(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'BUNDLE', message, data);
  }

  workspace(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'WORKSPACE', message, data);
  }

  project(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'PROJECT', message, data);
  }

  terminal(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'TERMINAL', message, data);
  }

  repl(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'REPL', message, data);
  }

  wasm(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'WASM', message, data);
  }

  file(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'FILE', message, data);
  }

  state(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'STATE', message, data);
  }

  extension(message: string, data?: any, level: LogLevel = LogLevel.INFO): void {
    this.log(level, 'EXTENSION', message, data);
  }

  /**
   * Level-specific shortcuts
   */
  debug(component: LogComponent, message: string, data?: any): void {
    this.log(LogLevel.DEBUG, component, message, data);
  }

  info(component: LogComponent, message: string, data?: any): void {
    this.log(LogLevel.INFO, component, message, data);
  }

  warn(component: LogComponent, message: string, data?: any): void {
    this.log(LogLevel.WARN, component, message, data);
  }

  error(component: LogComponent, message: string, error?: Error | any): void {
    const data = error instanceof Error
      ? (this.config.includeStackTrace ? error.stack : error.message)
      : error;
    this.log(LogLevel.ERROR, component, message, data);
  }

  success(component: LogComponent, message: string, data?: any): void {
    this.log(LogLevel.SUCCESS, component, message, data);
  }

  /**
   * Show the output channel
   */
  show(): void {
    this.outputChannel.show();
  }

  /**
   * Clear the output channel
   */
  clear(): void {
    this.outputChannel.clear();
  }

  /**
   * Dispose the output channel
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}

/**
 * Global dev logger instance
 */
let devLogger: DevLogger | undefined;

/**
 * Initialize the development logger
 */
export function initDevLogger(context: vscode.ExtensionContext): DevLogger {
  const outputChannel = vscode.window.createOutputChannel('Mu Two (Dev)', { log: true });

  // Create log file path in global storage
  const logFileName = `mu2-dev-${new Date().toISOString().split('T')[0]}.log`;
  const resourceLocator = getResourceLocator();
  const logFileUri = vscode.Uri.joinPath(resourceLocator.getGlobalStorageUri(), 'logs', logFileName);

  // Get configuration from VS Code settings
  const config = vscode.workspace.getConfiguration('muTwo.dev');
  const minLevel = config.get<string>('logLevel', 'DEBUG');
  const enabledComponents = config.get<string[]>('enabledComponents', []);
  const writeToFile = config.get<boolean>('writeToFile', true);

  devLogger = new DevLogger(outputChannel, logFileUri, {
    minLevel: LogLevel[minLevel as keyof typeof LogLevel] || LogLevel.DEBUG,
    enabledComponents: enabledComponents.length > 0
      ? new Set(enabledComponents as LogComponent[])
      : 'all',
    useColors: true,
    includeTimestamp: true,
    includeStackTrace: true,
    writeToFile
  });

  context.subscriptions.push(outputChannel);

  return devLogger;
}

/**
 * Get the global dev logger instance
 */
export function getDevLogger(): DevLogger {
  if (!devLogger) {
    throw new Error('DevLogger not initialized. Call initDevLogger first.');
  }
  return devLogger;
}

/**
 * Helper to create a scoped logger for a specific component
 */
export function createComponentLogger(component: LogComponent): {
  debug: (message: string, data?: any) => void;
  info: (message: string, data?: any) => void;
  warn: (message: string, data?: any) => void;
  error: (message: string, error?: Error | any) => void;
  success: (message: string, data?: any) => void;
} {
  const logger = getDevLogger();

  return {
    debug: (message: string, data?: any) => logger.debug(component, message, data),
    info: (message: string, data?: any) => logger.info(component, message, data),
    warn: (message: string, data?: any) => logger.warn(component, message, data),
    error: (message: string, error?: Error | any) => logger.error(component, message, error),
    success: (message: string, data?: any) => logger.success(component, message, data)
  };
}
