// src/interface/client.ts

// CircuitPython Communication Bridge - Enhanced LanguageServiceBridge for REPL Terminal Communication
// 
// This file implements the communication "trunk line" between webviews (REPL/Editor) and CircuitPython 
// devices using the enhanced LanguageServiceBridge with REPL capabilities. The parallel architecture 
// design separates concerns:
// - DAP (DeviceManager): Handles connection management and device lifecycle 
// - LSP (This Bridge): Handles real-time REPL data streaming with CircuitPython intelligence
//
// Key Features:
// - Real-time REPL communication with CircuitPython context-aware completions
// - Integrated command history management
// - Shell-like command processing via optional commandProcessor
// - Raw binary data pipeline for file transfers and device operations
// - JSON-RPC communication with webviews using existing LanguageService infrastructure

import * as vscode from 'vscode';
import { 
    LanguageServiceBridge, 
    LanguageServiceBridgeConfig,
    REPLSession,
    REPLExecutionContext,
    REPLExecutionResult
} from '../../providers/language/core/LanguageServiceBridge';
import { DeviceManager } from './deviceManager';
import { IDevice } from './deviceDetector';

// Communication Bridge Configuration and Types
export interface CommunicationsBridgeConfig extends LanguageServiceBridgeConfig {
    // Device connection settings
    deviceConnections?: {
        autoDetect?: boolean;
        defaultBaudRate?: number;
        reconnectAttempts?: number;
        reconnectDelay?: number;
    };
    
    // Raw data pipeline settings
    rawDataEnabled?: boolean;
    binaryTransferEnabled?: boolean;
    maxPacketSize?: number;
}

export interface DeviceConnection {
    device: IDevice;
    connected: boolean;
    path: string;
    baudRate: number;
    lastActivity: number;
    connectionAttempts: number;
}

// Legacy compatibility types (maintained for existing code)
export type WebviewSourceType = 'repl' | 'editor' | 'terminal';

export interface TextChannelMessage {
    source: WebviewSourceType;
    sessionId: string;
    content: string;
    timestamp: number;
    type: 'output' | 'input' | 'command' | 'completion';
}

export interface ConnectionStatus {
    connected: boolean;
    deviceInfo?: {
        path: string;
        baudRate: number;
        boardId?: string;
    };
    sessionId?: string;
}

/**
 * CircuitPython Communications Bridge
 * 
 * Enhanced LanguageServiceBridge that provides REPL terminal communication capabilities
 * alongside CircuitPython language intelligence. This serves as the "trunk line" for
 * communication between webviews and CircuitPython devices.
 * 
 * Architecture:
 * - Extends LanguageServiceBridge with REPL streaming capabilities
 * - Integrates with DeviceManager for connection state coordination
 * - Provides raw data pipeline for binary device operations
 * - Maintains session management and command history
 */
export class CircuitPythonCommunicationsBridge extends LanguageServiceBridge {
    private context: vscode.ExtensionContext;
    private deviceManager?: DeviceManager;
    private deviceConnections: Map<string, DeviceConnection> = new Map();
    private bridgeConfig: CommunicationsBridgeConfig;
    
    // Legacy event emitters for backward compatibility
    private _onTextData = new vscode.EventEmitter<TextChannelMessage>();
    private _onConnectionStatus = new vscode.EventEmitter<ConnectionStatus>();
    private _onExecutionResult = new vscode.EventEmitter<REPLExecutionResult>();
    private _onError = new vscode.EventEmitter<{source: WebviewSourceType; sessionId: string; message: string; type: string}>();

    // Public event interfaces (legacy compatibility)
    public readonly onTextData = this._onTextData.event;
    public readonly onConnectionStatus = this._onConnectionStatus.event; 
    public readonly onExecutionResult = this._onExecutionResult.event;
    public readonly onError = this._onError.event;

    constructor(context: vscode.ExtensionContext, config?: CommunicationsBridgeConfig) {
        // Initialize parent LanguageServiceBridge with REPL enabled
        const bridgeConfig: LanguageServiceBridgeConfig = {
            enableDiagnostics: false, // Disable for REPL mode to reduce noise
            enableCompletions: true,
            enableHover: true,
            enableSignatureHelp: true,
            enableREPL: true,
            enableCommandProcessor: true,
            maxREPLHistory: 1000,
            defaultBoard: 'circuitplayground_express', // TODO: Get from device detection
            ...config
        };
        
        super(bridgeConfig, context);
        
        this.context = context;
        this.bridgeConfig = {
            ...bridgeConfig,
            deviceConnections: {
                autoDetect: true,
                defaultBaudRate: 115200,
                reconnectAttempts: 3,
                reconnectDelay: 2000
            },
            rawDataEnabled: true,
            binaryTransferEnabled: true,
            maxPacketSize: 1024,
            ...config
        };
        
        this.setupEventForwarding();
    }

    // DeviceManager Integration
    setDeviceManager(deviceManager: DeviceManager): void {
        this.deviceManager = deviceManager;
        this.setupDeviceEventForwarding();
    }

    // Legacy compatibility methods
    public async start(): Promise<void> {
        console.log('CircuitPython Communications Bridge initialized with enhanced LanguageServiceBridge');
        // The parent LanguageServiceBridge handles all initialization
        // Device connections are managed through the DeviceManager
    }

    private setupEventForwarding(): void {
        // Forward LanguageServiceBridge REPL events to legacy interfaces for backward compatibility
        this.onREPLOutput(({sessionId, data}) => {
            this._onTextData.fire({
                source: 'repl',
                sessionId,
                content: data,
                timestamp: Date.now(),
                type: 'output'
            });
        });

        this.onREPLExecutionResult((result) => {
            this._onExecutionResult.fire(result);
        });

        this.onREPLConnectionStatus(({sessionId, connected}) => {
            this._onConnectionStatus.fire({
                connected,
                sessionId
            });
        });
    }

    private setupDeviceEventForwarding(): void {
        if (!this.deviceManager) return;

        // Listen to DeviceManager events and coordinate with REPL sessions
        this.deviceManager.onConnectionStateChanged(({device, state}) => {
            const deviceConnection: DeviceConnection = {
                device,
                connected: state.isConnected,
                path: state.port || '',
                baudRate: state.baudRate || 115200,
                lastActivity: Date.now(),
                connectionAttempts: state.connectionAttempts
            };

            this.deviceConnections.set(device.path, deviceConnection);

            // Forward to legacy event interface
            this._onConnectionStatus.fire({
                connected: state.isConnected,
                deviceInfo: {
                    path: state.port || '',
                    baudRate: state.baudRate || 115200,
                    boardId: device.boardId
                }
            });
        });
    }

    // Enhanced methods that leverage LanguageServiceBridge
    /**
     * Create a new REPL session for a webview 
     */
    public async createSession(source: WebviewSourceType, options?: any): Promise<string> {
        // Use parent LanguageServiceBridge REPL session management
        const sessionId = this.createREPLSession(source);
        console.log(`Created enhanced REPL session: ${sessionId} for ${source}`);
        return sessionId;
    }

    /**
     * Execute text command through the enhanced REPL bridge
     */
    public async executeText(sessionId: string, text: string): Promise<REPLExecutionResult> {
        // Use parent LanguageServiceBridge REPL execution with CircuitPython intelligence
        const context: REPLExecutionContext = {
            sessionId,
            command: text,
            timestamp: Date.now(),
            source: 'repl'
        };

        // Fire input event for legacy compatibility
        this._onTextData.fire({
            source: 'repl',
            sessionId,
            content: text,
            timestamp: Date.now(),
            type: 'input'
        });

        try {
            const result = await this.executeREPLCommand(context);
            return result;
        } catch (error) {
            const errorResult: REPLExecutionResult = {
                output: '',
                success: false,
                sessionId,
                executionTime: 0
            };

            this._onError.fire({
                source: 'repl',
                sessionId,
                message: error instanceof Error ? error.message : String(error),
                type: 'execution'
            });

            return errorResult;
        }
    }

    /**
     * Get enhanced completions with CircuitPython intelligence
     */
    public async getTextCompletions(sessionId: string, text: string, position: number): Promise<vscode.CompletionItem[]> {
        try {
            // Use parent LanguageServiceBridge REPL completions with full CircuitPython context
            const completions = await this.getREPLCompletions(text, { line: 0, character: position }, sessionId);
            
            // Convert to VS Code completion items (basic conversion for now)
            return completions.map(item => ({
                label: item.label,
                insertText: item.insertText || item.label,
                detail: item.detail,
                kind: vscode.CompletionItemKind.Text // TODO: Map proper kinds
            }));
        } catch (error) {
            console.error('Enhanced completion error:', error);
            return [];
        }
    }

    // Raw Data Pipeline for Binary Operations
    public async sendRawData(sessionId: string, data: Buffer): Promise<boolean> {
        if (!this.bridgeConfig.rawDataEnabled) {
            throw new Error('Raw data pipeline is disabled');
        }

        try {
            // Convert binary data to base64 for JSON-RPC transport
            const base64Data = data.toString('base64');
            
            // Use existing JSON-RPC infrastructure through webview connections
            // This will be handled by the 'repl/sendRaw' handler in setupREPLHandlers
            console.log(`Sending ${data.length} bytes of raw data for session ${sessionId}`);
            
            // TODO: Implement actual device communication through DeviceManager
            // For now, just acknowledge
            return true;
        } catch (error) {
            console.error('Error sending raw data:', error);
            return false;
        }
    }

    public async receiveRawData(sessionId: string): Promise<Buffer | null> {
        if (!this.bridgeConfig.rawDataEnabled) {
            throw new Error('Raw data pipeline is disabled');
        }

        try {
            // TODO: Implement binary data reception from device
            // This will coordinate with DeviceManager for actual device communication
            console.log(`Checking for raw data on session ${sessionId}`);
            return null;
        } catch (error) {
            console.error('Error receiving raw data:', error);
            return null;
        }
    }

    /**
     * Connect to a CircuitPython device (delegated to DeviceManager)
     */
    public async connectDevice(path: string, baudRate: number = 115200, sessionId?: string): Promise<boolean> {
        if (!this.deviceManager) {
            console.warn('DeviceManager not set - device connection not available');
            return false;
        }

        try {
            // Coordinate with DeviceManager for actual device connection
            // DeviceManager handles the DAP-based connection management
            console.log(`Requesting device connection through DeviceManager: ${path}@${baudRate}`);
            
            // TODO: Add method to DeviceManager for initiating connections
            // For now, just log the request
            return true;
        } catch (error) {
            console.error('Device connection error:', error);
            return false;
        }
    }

    /**
     * Close a REPL session
     */
    public async closeSession(sessionId: string): Promise<void> {
        // Use parent LanguageServiceBridge session management
        const success = this.closeREPLSession(sessionId);
        console.log(`Closed REPL session: ${sessionId}, success: ${success}`);
    }

    /**
     * Get session information using enhanced LanguageServiceBridge
     */
    public getSessionInfo(sessionId: string): REPLSession | undefined {
        return this.getREPLSession(sessionId);
    }

    /**
     * List all active REPL sessions
     */
    public getActiveSessions(): REPLSession[] {
        return this.getActiveREPLSessions();
    }

    // Legacy compatibility properties
    public get isConnected(): boolean {
        // Check if any device connections are active
        for (const connection of this.deviceConnections.values()) {
            if (connection.connected) {
                return true;
            }
        }
        return false;
    }

    public get connectionInfo() {
        // Return info for the most recent active connection
        for (const connection of this.deviceConnections.values()) {
            if (connection.connected) {
                return {
                    path: connection.path,
                    baudRate: connection.baudRate,
                    device: connection.device
                };
            }
        }
        return null;
    }

    // Enhanced dispose method
    public async stop(): Promise<void> {
        // Clean up device connections
        this.deviceConnections.clear();

        // Dispose legacy event emitters
        this._onTextData.dispose();
        this._onConnectionStatus.dispose();
        this._onExecutionResult.dispose();
        this._onError.dispose();

        // Call parent dispose which handles LanguageServiceBridge cleanup
        super.dispose();
    }

    public dispose(): void {
        this.stop();
    }
}

// Export the main class with legacy compatibility
export { CircuitPythonCommunicationsBridge as MuTwoLanguageClient };

// Legacy interface for backward compatibility
export interface SessionOptions {
    enableCompletion?: boolean;
    enableHistory?: boolean;
    enableEcho?: boolean;
    maxHistorySize?: number;
}