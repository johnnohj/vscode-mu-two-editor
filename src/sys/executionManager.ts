/**
 * Execution Manager
 *
 * Phase 3 - Runtime-Agnostic Device Management: Unified code execution
 *
 * This manager provides runtime-agnostic code execution across all runtime types.
 * It coordinates with the RuntimeBinder to determine which runtime to use for
 * each device and provides a unified execution interface.
 */

import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { IPythonRuntime, PythonRuntimeType, RuntimeExecutionContext, RuntimeExecutionResult } from '../runtime/IPythonRuntime';
import { IExecutionManager } from './deviceManagerInterface';
import { RuntimeBinder } from './runtimeBinder';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Execution mode types
 */
export type ExecutionMode = 'repl' | 'file' | 'raw' | 'debug';

/**
 * Execution options
 */
export interface ExecutionOptions {
    mode?: ExecutionMode;
    timeout?: number;
    workingDirectory?: string;
    environment?: Record<string, string>;
    enableDebugging?: boolean;
    enableHardwareAccess?: boolean;
    streamOutput?: boolean;
}

/**
 * Execution result (runtime-agnostic)
 */
export interface ExecutionResult {
    success: boolean;
    output: string;
    error?: string;
    executionTime: number;
    runtimeUsed: string;
    deviceId: string;
    metadata?: {
        memoryUsage?: {
            used: number;
            free: number;
            total: number;
        };
        hardwareChanges?: Array<{
            type: 'pin' | 'sensor' | 'actuator';
            target: string | number;
            oldValue: any;
            newValue: any;
            timestamp: number;
        }>;
        executionStats?: {
            linesExecuted: number;
            functionsInvoked: number;
            loopIterations: number;
        };
    };
}

/**
 * Batch execution request
 */
export interface BatchExecutionRequest {
    deviceId: string;
    code: string;
    options?: ExecutionOptions;
}

/**
 * Batch execution result
 */
export interface BatchExecutionResult {
    deviceId: string;
    result?: ExecutionResult;
    error?: Error;
    executionOrder: number;
}

/**
 * Execution status
 */
export interface ExecutionStatus {
    isExecuting: boolean;
    currentRuntime?: string;
    startedAt?: number;
    progress?: number;
    estimatedTimeRemaining?: number;
    currentLine?: number;
    totalLines?: number;
}

/**
 * Streaming execution event
 */
export interface StreamExecutionEvent {
    type: 'output' | 'error' | 'progress' | 'complete' | 'hardware_change';
    data: any;
    timestamp: number;
    deviceId: string;
    runtime: string;
}

/**
 * Execution manager events
 */
export interface ExecutionManagerEvents {
    'executionStarted': [string, ExecutionOptions]; // deviceId, options
    'executionCompleted': [string, ExecutionResult]; // deviceId, result
    'executionFailed': [string, Error]; // deviceId, error
    'executionInterrupted': [string]; // deviceId
    'streamEvent': [StreamExecutionEvent]; // streaming event
    'batchCompleted': [BatchExecutionResult[]]; // batch results
}

/**
 * Active execution tracking
 */
interface ActiveExecution {
    deviceId: string;
    runtime: IPythonRuntime;
    startedAt: number;
    options: ExecutionOptions;
    controller?: AbortController;
    progress: number;
    currentLine?: number;
    totalLines?: number;
}

/**
 * Execution Manager Implementation
 *
 * Provides unified code execution across all runtime types
 */
export class ExecutionManager extends EventEmitter implements IExecutionManager {
    private static instance: ExecutionManager;

    // Dependencies
    private runtimeBinder: RuntimeBinder;

    // Execution tracking
    private activeExecutions = new Map<string, ActiveExecution>();
    private executionHistory: Array<{
        deviceId: string;
        code: string;
        result: ExecutionResult;
        timestamp: number;
    }> = [];

    // Configuration
    private maxHistorySize = 100;
    private defaultTimeout = 30000; // 30 seconds
    private maxConcurrentExecutions = 5;

    // State management
    private isInitialized = false;

    constructor() {
        super();
        this.runtimeBinder = RuntimeBinder.getInstance();

        logger.info('EXECUTION', 'ExecutionManager created - runtime-agnostic code execution');
    }

    /**
     * Singleton pattern for extension-wide execution management
     */
    static getInstance(): ExecutionManager {
        if (!ExecutionManager.instance) {
            ExecutionManager.instance = new ExecutionManager();
        }
        return ExecutionManager.instance;
    }

    /**
     * Initialize the execution manager
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            logger.debug('EXECUTION', 'ExecutionManager already initialized');
            return;
        }

        logger.info('EXECUTION', 'Initializing ExecutionManager...');

        try {
            // Initialize the runtime binder
            await this.runtimeBinder.initialize();

            this.isInitialized = true;
            logger.info('EXECUTION', '✓ ExecutionManager initialized successfully');

        } catch (error) {
            logger.error('EXECUTION', `Failed to initialize ExecutionManager: ${error}`);
            throw error;
        }
    }

    /**
     * Dispose the execution manager
     */
    async dispose(): Promise<void> {
        if (!this.isInitialized) {
            return;
        }

        logger.info('EXECUTION', 'Disposing ExecutionManager...');

        try {
            // Interrupt all active executions
            for (const deviceId of this.activeExecutions.keys()) {
                await this.interruptExecution(deviceId);
            }

            // Dispose the runtime binder
            await this.runtimeBinder.dispose();

            // Clear state
            this.activeExecutions.clear();
            this.executionHistory = [];
            this.removeAllListeners();

            this.isInitialized = false;
            logger.info('EXECUTION', '✓ ExecutionManager disposed successfully');

        } catch (error) {
            logger.error('EXECUTION', `Error disposing ExecutionManager: ${error}`);
            throw error;
        }
    }

    // ========================= Code Execution =========================

    /**
     * Execute code on a device regardless of runtime
     */
    async executeCode(deviceId: string, code: string, options?: ExecutionOptions): Promise<ExecutionResult> {
        logger.info('EXECUTION', `Executing code on device ${deviceId} (runtime-agnostic)...`);

        // Check if device is already executing
        if (this.activeExecutions.has(deviceId)) {
            throw new Error(`Device ${deviceId} is already executing code. Use interruptExecution() first.`);
        }

        // Check concurrent execution limit
        if (this.activeExecutions.size >= this.maxConcurrentExecutions) {
            throw new Error(`Maximum concurrent executions (${this.maxConcurrentExecutions}) reached`);
        }

        // Get runtime bound to device
        const runtime = this.runtimeBinder.getDeviceRuntime(deviceId);
        if (!runtime) {
            throw new Error(`No runtime bound to device ${deviceId}. Use RuntimeBinder to bind a runtime first.`);
        }

        // Prepare execution options
        const executionOptions: ExecutionOptions = {
            mode: 'repl',
            timeout: this.defaultTimeout,
            enableHardwareAccess: true,
            enableDebugging: false,
            streamOutput: false,
            ...options
        };

        // Track active execution
        const execution: ActiveExecution = {
            deviceId,
            runtime,
            startedAt: Date.now(),
            options: executionOptions,
            controller: new AbortController(),
            progress: 0,
            totalLines: code.split('\n').length
        };

        this.activeExecutions.set(deviceId, execution);
        this.emit('executionStarted', deviceId, executionOptions);

        try {
            // Convert to runtime-specific execution context
            const runtimeContext: RuntimeExecutionContext = {
                mode: executionOptions.mode === 'debug' ? 'repl' : executionOptions.mode || 'repl',
                timeout: executionOptions.timeout,
                workingDirectory: executionOptions.workingDirectory,
                environment: executionOptions.environment,
                enableHardwareAccess: executionOptions.enableHardwareAccess,
                enableDebugging: executionOptions.enableDebugging
            };

            // Execute on the runtime
            const startTime = Date.now();
            const runtimeResult = await this.executeOnRuntime(runtime, deviceId, code, runtimeContext, execution);
            const executionTime = Date.now() - startTime;

            // Convert runtime result to our unified format
            const result: ExecutionResult = {
                success: runtimeResult.success,
                output: runtimeResult.output,
                error: runtimeResult.error,
                executionTime,
                runtimeUsed: runtime.type,
                deviceId,
                metadata: {
                    memoryUsage: runtimeResult.memoryUsage,
                    hardwareChanges: runtimeResult.hardwareChanges,
                    executionStats: {
                        linesExecuted: execution.currentLine || execution.totalLines || 0,
                        functionsInvoked: 0, // Would need runtime-specific tracking
                        loopIterations: 0   // Would need runtime-specific tracking
                    }
                }
            };

            // Update binding activity
            this.runtimeBinder.updateBindingActivity(deviceId);

            // Store in history
            this.addToExecutionHistory(deviceId, code, result);

            this.emit('executionCompleted', deviceId, result);
            logger.info('EXECUTION', `✓ Code execution completed on device ${deviceId} (${runtime.type}) in ${executionTime}ms`);

            return result;

        } catch (error) {
            const executionError = error instanceof Error ? error : new Error(String(error));

            this.emit('executionFailed', deviceId, executionError);
            logger.error('EXECUTION', `Code execution failed on device ${deviceId}: ${error}`);

            throw executionError;

        } finally {
            // Clean up active execution
            this.activeExecutions.delete(deviceId);
        }
    }

    /**
     * Execute code on multiple devices simultaneously
     */
    async executeBatch(executions: BatchExecutionRequest[]): Promise<BatchExecutionResult[]> {
        logger.info('EXECUTION', `Executing batch of ${executions.length} code executions...`);

        const results: BatchExecutionResult[] = [];

        // Execute all requests in parallel
        const promises = executions.map(async (request, index) => {
            try {
                const result = await this.executeCode(request.deviceId, request.code, request.options);
                return {
                    deviceId: request.deviceId,
                    result,
                    executionOrder: index
                } as BatchExecutionResult;
            } catch (error) {
                return {
                    deviceId: request.deviceId,
                    error: error instanceof Error ? error : new Error(String(error)),
                    executionOrder: index
                } as BatchExecutionResult;
            }
        });

        const batchResults = await Promise.allSettled(promises);

        // Process results
        for (const promiseResult of batchResults) {
            if (promiseResult.status === 'fulfilled') {
                results.push(promiseResult.value);
            } else {
                // This shouldn't happen since we catch errors above, but just in case
                results.push({
                    deviceId: 'unknown',
                    error: new Error('Batch execution promise rejected'),
                    executionOrder: results.length
                });
            }
        }

        // Sort by execution order
        results.sort((a, b) => a.executionOrder - b.executionOrder);

        this.emit('batchCompleted', results);
        logger.info('EXECUTION', `✓ Batch execution completed: ${results.length} results`);

        return results;
    }

    /**
     * Interrupt execution on a device
     */
    async interruptExecution(deviceId: string): Promise<void> {
        logger.info('EXECUTION', `Interrupting execution on device ${deviceId}...`);

        const execution = this.activeExecutions.get(deviceId);
        if (!execution) {
            logger.debug('EXECUTION', `No active execution found for device ${deviceId}`);
            return;
        }

        try {
            // Signal abortion
            execution.controller?.abort();

            // Try to interrupt on the runtime if supported
            if (typeof execution.runtime.interruptExecution === 'function') {
                await execution.runtime.interruptExecution();
            }

            // Remove from active executions
            this.activeExecutions.delete(deviceId);

            this.emit('executionInterrupted', deviceId);
            logger.info('EXECUTION', `✓ Execution interrupted on device ${deviceId}`);

        } catch (error) {
            logger.error('EXECUTION', `Failed to interrupt execution on device ${deviceId}: ${error}`);
            throw error;
        }
    }

    /**
     * Get execution status for a device
     */
    getExecutionStatus(deviceId: string): ExecutionStatus {
        const execution = this.activeExecutions.get(deviceId);

        if (!execution) {
            return {
                isExecuting: false
            };
        }

        const elapsed = Date.now() - execution.startedAt;
        const estimatedTotal = execution.options.timeout || this.defaultTimeout;
        const progress = Math.min(execution.progress, elapsed / estimatedTotal);

        return {
            isExecuting: true,
            currentRuntime: execution.runtime.type,
            startedAt: execution.startedAt,
            progress,
            estimatedTimeRemaining: Math.max(0, estimatedTotal - elapsed),
            currentLine: execution.currentLine,
            totalLines: execution.totalLines
        };
    }

    /**
     * Stream code execution (for real-time output)
     */
    async *streamExecution(deviceId: string, code: string): AsyncIterable<StreamExecutionEvent> {
        logger.info('EXECUTION', `Starting streaming execution on device ${deviceId}...`);

        // Get runtime bound to device
        const runtime = this.runtimeBinder.getDeviceRuntime(deviceId);
        if (!runtime) {
            throw new Error(`No runtime bound to device ${deviceId}`);
        }

        const execution: ActiveExecution = {
            deviceId,
            runtime,
            startedAt: Date.now(),
            options: { mode: 'repl', streamOutput: true },
            progress: 0,
            totalLines: code.split('\n').length
        };

        this.activeExecutions.set(deviceId, execution);

        try {
            // Simulate streaming execution (in a real implementation, this would
            // integrate with the runtime's streaming capabilities)
            const lines = code.split('\n');

            for (let i = 0; i < lines.length; i++) {
                execution.currentLine = i + 1;
                execution.progress = (i + 1) / lines.length;

                // Yield progress event
                yield {
                    type: 'progress',
                    data: {
                        line: i + 1,
                        totalLines: lines.length,
                        progress: execution.progress
                    },
                    timestamp: Date.now(),
                    deviceId,
                    runtime: runtime.type
                };

                // Simulate line execution
                await new Promise(resolve => setTimeout(resolve, 100));

                // Yield output event (simulated)
                yield {
                    type: 'output',
                    data: `Line ${i + 1} executed: ${lines[i]}`,
                    timestamp: Date.now(),
                    deviceId,
                    runtime: runtime.type
                };
            }

            // Final completion event
            yield {
                type: 'complete',
                data: {
                    success: true,
                    totalLines: lines.length,
                    executionTime: Date.now() - execution.startedAt
                },
                timestamp: Date.now(),
                deviceId,
                runtime: runtime.type
            };

        } finally {
            this.activeExecutions.delete(deviceId);
        }
    }

    // ========================= Private Implementation =========================

    private async executeOnRuntime(
        runtime: IPythonRuntime,
        deviceId: string,
        code: string,
        context: RuntimeExecutionContext,
        execution: ActiveExecution
    ): Promise<RuntimeExecutionResult> {
        logger.debug('EXECUTION', `Executing on ${runtime.type} runtime for device ${deviceId}...`);

        try {
            // Check if runtime has execute method
            if (typeof runtime.executeCode !== 'function') {
                throw new Error(`Runtime ${runtime.type} does not support code execution`);
            }

            // Execute the code on the runtime
            const result = await runtime.executeCode(code, context);

            logger.debug('EXECUTION', `✓ Runtime execution completed: ${result.success ? 'success' : 'failure'}`);
            return result;

        } catch (error) {
            logger.error('EXECUTION', `Runtime execution failed: ${error}`);

            // Return failed result
            return {
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                executionTime: Date.now() - execution.startedAt
            };
        }
    }

    private addToExecutionHistory(deviceId: string, code: string, result: ExecutionResult): void {
        this.executionHistory.push({
            deviceId,
            code,
            result,
            timestamp: Date.now()
        });

        // Maintain history size limit
        if (this.executionHistory.length > this.maxHistorySize) {
            this.executionHistory.splice(0, this.executionHistory.length - this.maxHistorySize);
        }
    }

    // ========================= Utility Methods =========================

    /**
     * Get execution history
     */
    getExecutionHistory(deviceId?: string): Array<{
        deviceId: string;
        code: string;
        result: ExecutionResult;
        timestamp: number;
    }> {
        if (deviceId) {
            return this.executionHistory.filter(entry => entry.deviceId === deviceId);
        }
        return [...this.executionHistory];
    }

    /**
     * Clear execution history
     */
    clearExecutionHistory(deviceId?: string): void {
        if (deviceId) {
            this.executionHistory = this.executionHistory.filter(entry => entry.deviceId !== deviceId);
            logger.debug('EXECUTION', `Cleared execution history for device ${deviceId}`);
        } else {
            this.executionHistory = [];
            logger.debug('EXECUTION', 'Cleared all execution history');
        }
    }

    /**
     * Get execution statistics
     */
    getExecutionStatistics(): {
        totalExecutions: number;
        successfulExecutions: number;
        failedExecutions: number;
        averageExecutionTime: number;
        runtimeUsageDistribution: Record<string, number>;
        activeExecutions: number;
    } {
        const stats = {
            totalExecutions: this.executionHistory.length,
            successfulExecutions: 0,
            failedExecutions: 0,
            averageExecutionTime: 0,
            runtimeUsageDistribution: {} as Record<string, number>,
            activeExecutions: this.activeExecutions.size
        };

        let totalTime = 0;

        for (const entry of this.executionHistory) {
            if (entry.result.success) {
                stats.successfulExecutions++;
            } else {
                stats.failedExecutions++;
            }

            totalTime += entry.result.executionTime;

            stats.runtimeUsageDistribution[entry.result.runtimeUsed] =
                (stats.runtimeUsageDistribution[entry.result.runtimeUsed] || 0) + 1;
        }

        if (this.executionHistory.length > 0) {
            stats.averageExecutionTime = totalTime / this.executionHistory.length;
        }

        return stats;
    }
}

// Type augmentation for EventEmitter events
declare interface ExecutionManager {
    on<K extends keyof ExecutionManagerEvents>(
        event: K,
        listener: (...args: ExecutionManagerEvents[K]) => void
    ): this;

    emit<K extends keyof ExecutionManagerEvents>(
        event: K,
        ...args: ExecutionManagerEvents[K]
    ): boolean;
}