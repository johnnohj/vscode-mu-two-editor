/**
 * Unified Logger for Mu 2 Extension
 *
 * Single output channel with color-coded sections for different components.
 * Optional split-off channels for active device communication and debugging.
 */

import * as vscode from 'vscode';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'SUCCESS';
export type LogCategory =
    | 'EXTENSION'
    | 'DEVICE_DETECTOR'
    | 'WASM_RUNTIME'
    | 'WORKSPACE'
    | 'LIBRARIES'
    | 'EXECUTION'
    | 'BOARD_MANAGER'
    | 'FILE_SYNC';

export interface LogEntry {
    level: LogLevel;
    category: LogCategory;
    message: string;
    timestamp: Date;
    data?: any;
}

/**
 * Unified logger with color-coded output and optional device communication split-off
 */
export class UnifiedLogger {
    private static instance: UnifiedLogger;
    private mainChannel: vscode.OutputChannel;
    private deviceCommChannel: vscode.OutputChannel | null = null;
    private isDeviceCommActive = false;

    private readonly categoryColors: Record<LogCategory, string> = {
        'EXTENSION': '🔧',
        'DEVICE_DETECTOR': '🔍',
        'WASM_RUNTIME': '⚡',
        'WORKSPACE': '📁',
        'LIBRARIES': '📚',
        'EXECUTION': '▶️',
        'BOARD_MANAGER': '🔌',
        'FILE_SYNC': '🔄'
    };

    private readonly levelColors: Record<LogLevel, string> = {
        'INFO': 'ℹ️',
        'WARN': '⚠️',
        'ERROR': '❌',
        'DEBUG': '🐛',
        'SUCCESS': '✅'
    };

    private constructor() {
        this.mainChannel = vscode.window.createOutputChannel('Mu 2 Editor');
        this.logStartup();
    }

    static getInstance(): UnifiedLogger {
        if (!UnifiedLogger.instance) {
            UnifiedLogger.instance = new UnifiedLogger();
        }
        return UnifiedLogger.instance;
    }

    /**
     * Log a message to the main unified channel
     */
    log(category: LogCategory, level: LogLevel, message: string, data?: any): void {
        const entry: LogEntry = {
            category,
            level,
            message,
            timestamp: new Date(),
            data
        };

        this.writeToMainChannel(entry);

        // Auto-show channel for errors
        if (level === 'ERROR') {
            this.mainChannel.show(true);
        }
    }

    /**
     * Log device communication (uses split-off channel when active)
     */
    logDeviceComm(direction: 'TX' | 'RX', deviceId: string, data: string | Buffer): void {
        const channel = this.getDeviceCommChannel();
        const timestamp = new Date().toISOString().substring(11, 23); // HH:mm:ss.sss
        const dataStr = Buffer.isBuffer(data) ? `[${data.length} bytes]` : data.substring(0, 100);

        channel.appendLine(`[${timestamp}] ${direction === 'TX' ? '→' : '←'} ${deviceId}: ${dataStr}`);
    }

    /**
     * Start device communication logging (creates split-off channel)
     */
    startDeviceCommLogging(deviceId: string): void {
        if (!this.isDeviceCommActive) {
            this.deviceCommChannel = vscode.window.createOutputChannel(`Mu 2 Device: ${deviceId}`);
            this.isDeviceCommActive = true;
            this.log('DEVICE_DETECTOR', 'INFO', `Started device communication logging for ${deviceId}`);
        }
    }

    /**
     * Stop device communication logging (disposes split-off channel)
     */
    stopDeviceCommLogging(): void {
        if (this.deviceCommChannel) {
            this.deviceCommChannel.dispose();
            this.deviceCommChannel = null;
            this.isDeviceCommActive = false;
            this.log('DEVICE_DETECTOR', 'INFO', 'Stopped device communication logging');
        }
    }

    /**
     * Clear the main channel
     */
    clear(): void {
        this.mainChannel.clear();
        this.logStartup();
    }

    /**
     * Show the main channel
     */
    show(preserveFocus: boolean = true): void {
        this.mainChannel.show(preserveFocus);
    }

    /**
     * Show the device communication channel if active
     */
    showDeviceComm(): void {
        if (this.deviceCommChannel) {
            this.deviceCommChannel.show();
        }
    }

    /**
     * Convenience methods for different log levels
     */
    info(category: LogCategory, message: string, data?: any): void {
        this.log(category, 'INFO', message, data);
    }

    warn(category: LogCategory, message: string, data?: any): void {
        this.log(category, 'WARN', message, data);
    }

    error(category: LogCategory, message: string, data?: any): void {
        this.log(category, 'ERROR', message, data);
    }

    debug(category: LogCategory, message: string, data?: any): void {
        this.log(category, 'DEBUG', message, data);
    }

    success(category: LogCategory, message: string, data?: any): void {
        this.log(category, 'SUCCESS', message, data);
    }

    /**
     * Log extension lifecycle events
     */
    logExtensionEvent(event: 'ACTIVATE' | 'DEACTIVATE' | 'ERROR', message?: string): void {
        const level: LogLevel = event === 'ERROR' ? 'ERROR' : 'INFO';
        const eventMessage = message || `Extension ${event.toLowerCase()}d`;
        this.log('EXTENSION', level, eventMessage);
    }

    /**
     * Dispose of all channels
     */
    dispose(): void {
        this.stopDeviceCommLogging();
        this.mainChannel.dispose();
    }

    // Private methods

    private writeToMainChannel(entry: LogEntry): void {
        const timestamp = entry.timestamp.toISOString().substring(11, 19); // HH:mm:ss
        const categoryIcon = this.categoryColors[entry.category];
        const levelIcon = this.levelColors[entry.level];

        let line = `[${timestamp}] ${levelIcon} ${categoryIcon} ${entry.category}: ${entry.message}`;

        // Add data if present
        if (entry.data) {
            line += ` | Data: ${JSON.stringify(entry.data)}`;
        }

        this.mainChannel.appendLine(line);
    }

    private getDeviceCommChannel(): vscode.OutputChannel {
        if (!this.deviceCommChannel) {
            this.deviceCommChannel = vscode.window.createOutputChannel('Mu 2 Device Communication');
        }
        return this.deviceCommChannel;
    }

    private logStartup(): void {
        this.mainChannel.appendLine('═══════════════════════════════════════════════════════════════');
        this.mainChannel.appendLine('🎯 Mu 2 Editor - CircuitPython Development Environment');
        this.mainChannel.appendLine('═══════════════════════════════════════════════════════════════');
        this.mainChannel.appendLine('');
    }
}

/**
 * Convenience function to get the singleton logger instance
 */
export function getLogger(): UnifiedLogger {
    return UnifiedLogger.getInstance();
}

/**
 * Convenience logging functions for common use cases
 */
export function logInfo(category: LogCategory, message: string, data?: any): void {
    getLogger().info(category, message, data);
}

export function logWarn(category: LogCategory, message: string, data?: any): void {
    getLogger().warn(category, message, data);
}

export function logError(category: LogCategory, message: string, data?: any): void {
    getLogger().error(category, message, data);
}

export function logSuccess(category: LogCategory, message: string, data?: any): void {
    getLogger().success(category, message, data);
}

export function logDebug(category: LogCategory, message: string, data?: any): void {
    getLogger().debug(category, message, data);
}