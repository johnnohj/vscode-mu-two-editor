/**
 * VS Code Task Runner
 *
 * Provides a unified interface for running external commands using VS Code's Task API
 * instead of Node.js child_process.spawn() for better integration and user experience.
 */

import * as vscode from 'vscode';
import { getLogger } from './unifiedLogger';

export interface TaskOptions {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    showOutput?: boolean;
    captureOutput?: boolean;
    timeout?: number;
}

export interface TaskResult {
    success: boolean;
    exitCode: number;
    output?: string;
    error?: string;
}

/**
 * VS Code Task Runner for external command execution
 */
export class TaskRunner {
    private logger = getLogger();
    private runningTasks = new Map<string, vscode.TaskExecution>();

    /**
     * Execute a command using VS Code Tasks API
     */
    async executeTask(taskId: string, options: TaskOptions): Promise<TaskResult> {
        return new Promise((resolve) => {
            const taskDefinition: vscode.TaskDefinition = {
                type: 'mu2-external',
                command: options.command,
                args: options.args
            };

            const execution = new vscode.ShellExecution(
                options.command,
                options.args,
                {
                    cwd: options.cwd,
                    env: options.env
                }
            );

            const task = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                `Mu 2: ${options.command} ${options.args.join(' ')}`,
                'mu2',
                execution
            );

            // Configure task presentation
            task.presentationOptions = {
                echo: true,
                reveal: options.showOutput ? vscode.TaskRevealKind.Always : vscode.TaskRevealKind.Silent,
                focus: false,
                panel: vscode.TaskPanelKind.Shared,
                showReuseMessage: false,
                clear: false
            };

            let output = '';
            let hasResolved = false;

            // Set up timeout if specified
            const timeoutHandle = options.timeout ? setTimeout(() => {
                if (!hasResolved) {
                    hasResolved = true;
                    this.logger.warn('EXECUTION', `Task ${taskId} timed out after ${options.timeout}ms`);
                    resolve({
                        success: false,
                        exitCode: -1,
                        error: 'Task execution timed out'
                    });
                }
            }, options.timeout) : null;

            vscode.tasks.executeTask(task).then((taskExecution) => {
                this.runningTasks.set(taskId, taskExecution);
                this.logger.info('EXECUTION', `Started task: ${options.command} ${options.args.join(' ')}`);

                // Listen for task completion
                const disposable = vscode.tasks.onDidEndTask((event) => {
                    if (event.execution === taskExecution && !hasResolved) {
                        hasResolved = true;
                        if (timeoutHandle) clearTimeout(timeoutHandle);

                        this.runningTasks.delete(taskId);
                        disposable.dispose();

                        const success = event.execution.task.execution instanceof vscode.ShellExecution;

                        this.logger.info('EXECUTION', `Task completed: ${options.command} (${success ? 'success' : 'failed'})`);

                        resolve({
                            success,
                            exitCode: success ? 0 : 1,
                            output: options.captureOutput ? output : undefined
                        });
                    }
                });
            }).catch((error: any) => {
                if (!hasResolved) {
                    hasResolved = true;
                    if (timeoutHandle) clearTimeout(timeoutHandle);

                    this.logger.error('EXECUTION', `Failed to start task: ${error.message}`);
                    resolve({
                        success: false,
                        exitCode: -1,
                        error: error.message
                    });
                }
            });
        });
    }

    /**
     * Execute a command and capture its output
     */
    async executeWithOutput(taskId: string, options: TaskOptions): Promise<TaskResult> {
        // For output capture, we still need to use Node.js spawn as VS Code Tasks
        // don't provide direct stdout capture. This is used sparingly for cases
        // like 'pip list --format=json' where we need the actual output.

        const { spawn } = await import('child_process');

        return new Promise((resolve) => {
            this.logger.debug('EXECUTION', `Executing with output capture: ${options.command} ${options.args.join(' ')}`);

            const childProcess = spawn(options.command, options.args, {
                cwd: options.cwd,
                env: { ...process.env, ...options.env },
                shell: true
            });

            let output = '';
            let error = '';

            childProcess.stdout?.on('data', (data: any) => {
                output += data.toString();
            });

            childProcess.stderr?.on('data', (data: any) => {
                error += data.toString();
            });

            childProcess.on('close', (code: number | null) => {
                const success = code === 0;

                this.logger.debug('EXECUTION', `Output capture completed: ${options.command} (exit code: ${code})`);

                resolve({
                    success,
                    exitCode: code || 0,
                    output: output.trim(),
                    error: error.trim() || undefined
                });
            });

            childProcess.on('error', (err: any) => {
                this.logger.error('EXECUTION', `Process error: ${err.message}`);
                resolve({
                    success: false,
                    exitCode: -1,
                    error: err.message
                });
            });

            // Handle timeout
            if (options.timeout) {
                setTimeout(() => {
                    if (!childProcess.killed) {
                        childProcess.kill('SIGTERM');
                        resolve({
                            success: false,
                            exitCode: -1,
                            error: 'Process timed out'
                        });
                    }
                }, options.timeout);
            }
        });
    }

    /**
     * Check if a command is available on the system
     */
    async checkCommandAvailable(command: string): Promise<boolean> {
        const taskId = `check_${command}_${Date.now()}`;

        const result = await this.executeTask(taskId, {
            command: command,
            args: ['--version'],
            showOutput: false,
            timeout: 5000
        });

        return result.success;
    }

    /**
     * Terminate a running task
     */
    async terminateTask(taskId: string): Promise<boolean> {
        const taskExecution = this.runningTasks.get(taskId);
        if (taskExecution) {
            taskExecution.terminate();
            this.runningTasks.delete(taskId);
            return true;
        }
        return false;
    }

    /**
     * Get list of running task IDs
     */
    getRunningTasks(): string[] {
        return Array.from(this.runningTasks.keys());
    }
}

/**
 * Singleton instance
 */
let taskRunnerInstance: TaskRunner | null = null;

export function getTaskRunner(): TaskRunner {
    if (!taskRunnerInstance) {
        taskRunnerInstance = new TaskRunner();
    }
    return taskRunnerInstance;
}