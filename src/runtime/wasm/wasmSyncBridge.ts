// src/runtime/wasmSyncBridge.ts
// Phase 4E: WASM Sync API Integration
// Bridges synchronous CircuitPython hardware operations with asynchronous VS Code extension

import * as vscode from 'vscode';
import { ChildProcess } from 'child_process';
import { getLogger } from '../../utils/unifiedLogger';
import { MuTwoRuntimeCoordinator } from '../core/unifiedRuntimeCoordinator';
import { SyncAPIServiceRegistry, executeSyncAPIService } from './syncAPIServiceRegistry';

const logger = getLogger();

export interface SyncAPIHandler {
    (serviceName: string, ...args: any[]): Promise<any>;
}

export interface HardwareOperation {
    pin: number;
    value?: boolean | number;
    address?: number;
    data?: Uint8Array;
}

export interface ExtensionOperation {
    libraryName?: string;
    path?: string;
    content?: string;
}

/**
 * Phase 4E: WASM Sync Bridge for CircuitPython Hardware Operations
 *
 * Provides synchronous hardware interface for WASM CircuitPython runtime
 * by bridging to asynchronous extension services through IPC communication.
 */
export class WASMSyncBridge {
    private activeProcess?: ChildProcess;
    private messageId = 0;
    private pendingCalls = new Map<number, { resolve: Function; reject: Function }>();
    private serviceRegistry: SyncAPIServiceRegistry;

    constructor(private context: vscode.ExtensionContext) {
        this.serviceRegistry = SyncAPIServiceRegistry.getInstance();
    }


    /**
     * Start the sync bridge with a WASM child process
     */
    public startBridge(wasmProcess: ChildProcess): void {
        this.activeProcess = wasmProcess;

        if (!wasmProcess.stdin || !wasmProcess.stdout) {
            throw new Error('WASM process does not have stdin/stdout streams');
        }

        // Set up IPC communication
        wasmProcess.stdout.on('data', (data: Buffer) => {
            this.handleProcessMessage(data);
        });

        wasmProcess.on('error', (error) => {
            logger.error('WASM_SYNC', `WASM process error: ${error}`);
        });

        wasmProcess.on('exit', (code) => {
            logger.info('WASM_SYNC', `WASM process exited with code: ${code}`);
            this.activeProcess = undefined;
        });

        logger.info('WASM_SYNC', 'Sync bridge started with WASM process');
    }

    /**
     * Handle incoming messages from WASM process
     */
    private handleProcessMessage(data: Buffer): void {
        try {
            const lines = data.toString().split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;

                let message;
                try {
                    message = JSON.parse(line);
                } catch (parseError) {
                    // Not a JSON message, might be regular WASM output
                    continue;
                }

                if (message.type === 'sync-call') {
                    this.handleSyncCall(message);
                } else if (message.type === 'sync-response') {
                    this.handleSyncResponse(message);
                }
            }

        } catch (error) {
            logger.error('WASM_SYNC', `Error processing message: ${error}`);
        }
    }

    /**
     * Handle synchronous calls from WASM process
     */
    private async handleSyncCall(message: any): Promise<void> {
        const { id, service, args } = message;

        try {
            const result = await this.serviceRegistry.executeService(service, ...args);
            this.sendResponse(id, { success: true, result });

        } catch (error) {
            this.sendResponse(id, {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Handle synchronous responses from WASM process
     */
    private handleSyncResponse(message: any): void {
        const { id, response } = message;
        const pendingCall = this.pendingCalls.get(id);

        if (pendingCall) {
            this.pendingCalls.delete(id);

            if (response.success) {
                pendingCall.resolve(response.result);
            } else {
                pendingCall.reject(new Error(response.error));
            }
        }
    }

    /**
     * Send response to WASM process
     */
    private sendResponse(id: number, response: any): void {
        if (!this.activeProcess?.stdin) {
            logger.error('WASM_SYNC', 'Cannot send response - no active process');
            return;
        }

        const message = JSON.stringify({
            type: 'sync-response',
            id,
            response
        });

        this.activeProcess.stdin.write(message + '\n');
    }

    /**
     * Call a service in the WASM process
     */
    public async callWASMService(service: string, ...args: any[]): Promise<any> {
        if (!this.activeProcess?.stdin) {
            throw new Error('No active WASM process');
        }

        const id = ++this.messageId;

        const promise = new Promise((resolve, reject) => {
            this.pendingCalls.set(id, { resolve, reject });

            // Set timeout for the call
            setTimeout(() => {
                if (this.pendingCalls.has(id)) {
                    this.pendingCalls.delete(id);
                    reject(new Error('WASM service call timeout'));
                }
            }, 10000); // 10 second timeout
        });

        const message = JSON.stringify({
            type: 'sync-call',
            id,
            service,
            args
        });

        this.activeProcess.stdin.write(message + '\n');

        return promise;
    }

    /**
     * Check if sync bridge is active
     */
    public isActive(): boolean {
        return this.activeProcess !== undefined;
    }

    /**
     * Dispose of the sync bridge
     */
    public dispose(): void {
        if (this.activeProcess) {
            this.activeProcess.kill();
            this.activeProcess = undefined;
        }

        // Reject all pending calls
        for (const [id, { reject }] of this.pendingCalls) {
            reject(new Error('Sync bridge disposed'));
        }
        this.pendingCalls.clear();

        logger.info('WASM_SYNC', 'Sync bridge disposed');
    }
}