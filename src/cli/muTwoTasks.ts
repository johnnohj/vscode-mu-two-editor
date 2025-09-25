// src/sys/muTwoTasks.ts
// Phase 4D: VS Code Tasks Integration
// Provides TaskProvider for Mu Two CLI operations

import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { MuTwoRuntimeCoordinator } from '../runtime/core/unifiedRuntimeCoordinator';

const logger = getLogger();

export interface MuTaskDefinition extends vscode.TaskDefinition {
    operation: 'env-setup' | 'install-library' | 'sync-device' | 'device-scan' | 'runtime-switch';
    args?: any;
    library?: string;
    deviceId?: string;
    runtime?: string;
    taskId?: string;
}

/**
 * Phase 4D: VS Code Tasks Provider for Mu Two CLI Operations
 *
 * Provides integration between CLI commands and VS Code's task system,
 * enabling background operations with proper progress tracking and cancellation.
 */
export class MuTwoTaskProvider implements vscode.TaskProvider {
    static readonly type = 'muTwo';

    private context: vscode.ExtensionContext;
    private disposables: vscode.Disposable[] = [];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Provide static tasks that are always available
     */
    provideTasks(): vscode.Task[] {
        logger.info('TASK_PROVIDER', 'Providing Mu Two tasks');

        return [
            this.createEnvironmentSetupTask(),
            this.createDeviceScanTask(),
            this.createLibrarySyncTask(),
            this.createRuntimeSwitchTask('wasm-circuitpython'),
            this.createRuntimeSwitchTask('blinka-python'),
            this.createRuntimeSwitchTask('pyscript')
        ];
    }

    /**
     * Resolve dynamic tasks based on task definition
     */
    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const definition = task.definition as MuTaskDefinition;

        if (definition.type !== MuTwoTaskProvider.type) {
            return undefined;
        }

        logger.info('TASK_PROVIDER', `Resolving task: ${definition.operation}`);

        switch (definition.operation) {
            case 'env-setup':
                return this.createEnvironmentSetupTask(definition.args);
            case 'install-library':
                return this.createLibraryInstallTask(definition.library);
            case 'sync-device':
                return this.createDeviceSyncTask(definition.deviceId);
            case 'device-scan':
                return this.createDeviceScanTask();
            case 'runtime-switch':
                return this.createRuntimeSwitchTask(definition.runtime);
            default:
                logger.warn('TASK_PROVIDER', `Unknown task operation: ${definition.operation}`);
                return undefined;
        }
    }

    /**
     * Create environment setup task
     */
    private createEnvironmentSetupTask(args?: any): vscode.Task {
        const taskId = `muTwo-env-setup-${Date.now()}`;

        const definition: MuTaskDefinition = {
            type: MuTwoTaskProvider.type,
            operation: 'env-setup',
            taskId,
            args
        };

        // Determine the appropriate command based on platform and environment
        const commands = this.getEnvironmentSetupCommands();

        const execution = new vscode.ShellExecution(
            commands.command,
            commands.args,
            {
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                env: {
                    ...process.env,
                    MUTWO_TASK_ID: taskId
                }
            }
        );

        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            'Setup Python Environment',
            'muTwo',
            execution,
            ['$python']
        );

        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            echo: true,
            reveal: vscode.TaskRevealKind.Silent,
            focus: false,
            panel: vscode.TaskPanelKind.Shared,
            showReuseMessage: true,
            clear: false
        };

        return task;
    }

    /**
     * Create library installation task
     * INCLUDES SAFETY WARNINGS for Python environment validation
     */
    private createLibraryInstallTask(library?: string): vscode.Task {
        const taskId = `muTwo-lib-install-${Date.now()}`;
        const libraryName = library || '${input:libraryName}';

        const definition: MuTaskDefinition = {
            type: MuTwoTaskProvider.type,
            operation: 'install-library',
            taskId,
            library: libraryName
        };

        // SAFETY WARNING: Add environment validation check
        const isCircuitPythonLib = this.isCircuitPythonLibrary(libraryName);
        const command = isCircuitPythonLib ? 'circup' : 'python';
        const args = isCircuitPythonLib
            ? ['install', libraryName]
            : ['-m', 'pip', 'install', libraryName];

        const execution = new vscode.ShellExecution(command, args, {
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            env: {
                ...process.env,
                MUTWO_TASK_ID: taskId,
                MUTWO_SAFETY_CHECK: '1' // Flag for safety validation
            }
        });

        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            `Install Library: ${libraryName} (⚠️ requires valid venv)`,
            'muTwo',
            execution,
            ['$python']
        );

        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            echo: true,
            reveal: vscode.TaskRevealKind.Silent,
            focus: false,
            panel: vscode.TaskPanelKind.Shared,
            showReuseMessage: true,
            clear: false
        };

        return task;
    }

    /**
     * Create device sync task
     */
    private createDeviceSyncTask(deviceId?: string): vscode.Task {
        const taskId = `muTwo-device-sync-${Date.now()}`;

        const definition: MuTaskDefinition = {
            type: MuTwoTaskProvider.type,
            operation: 'sync-device',
            taskId,
            deviceId
        };

        // Use circup to sync libraries to device
        const execution = new vscode.ShellExecution('circup', ['update'], {
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            env: {
                ...process.env,
                MUTWO_TASK_ID: taskId
            }
        });

        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            `Sync Device: ${deviceId || 'Current Device'}`,
            'muTwo',
            execution,
            ['$circup']
        );

        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            echo: true,
            reveal: vscode.TaskRevealKind.Silent,
            focus: false,
            panel: vscode.TaskPanelKind.Shared,
            showReuseMessage: false,
            clear: false
        };

        return task;
    }

    /**
     * Create device scanning task
     */
    private createDeviceScanTask(): vscode.Task {
        const taskId = `muTwo-device-scan-${Date.now()}`;

        const definition: MuTaskDefinition = {
            type: MuTwoTaskProvider.type,
            operation: 'device-scan',
            taskId
        };

        // Create a process execution for device scanning
        const execution = new vscode.ProcessExecution(
            'python',
            ['-c', 'import serial.tools.list_ports; [print(f"{p.device}: {p.description}") for p in serial.tools.list_ports.comports()]'],
            {
                cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
                env: {
                    ...process.env,
                    MUTWO_TASK_ID: taskId
                }
            }
        );

        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            'Scan for Devices',
            'muTwo',
            execution
        );

        task.group = vscode.TaskGroup.Test;
        task.presentationOptions = {
            echo: false,
            reveal: vscode.TaskRevealKind.Never,
            focus: false,
            panel: vscode.TaskPanelKind.Shared,
            showReuseMessage: false,
            clear: false
        };

        return task;
    }

    /**
     * Create runtime switching task
     */
    private createRuntimeSwitchTask(runtime?: string): vscode.Task {
        const taskId = `muTwo-runtime-switch-${Date.now()}`;
        const targetRuntime = runtime || 'wasm-circuitpython';

        const definition: MuTaskDefinition = {
            type: MuTwoTaskProvider.type,
            operation: 'runtime-switch',
            taskId,
            runtime: targetRuntime
        };

        // This task will primarily use the extension's internal APIs
        const execution = new vscode.ShellExecution(
            'echo',
            [`Switching to ${targetRuntime} runtime...`],
            {
                env: {
                    ...process.env,
                    MUTWO_TASK_ID: taskId,
                    MUTWO_TARGET_RUNTIME: targetRuntime
                }
            }
        );

        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            `Switch Runtime: ${targetRuntime}`,
            'muTwo',
            execution
        );

        task.group = vscode.TaskGroup.Build;
        task.presentationOptions = {
            echo: true,
            reveal: vscode.TaskRevealKind.Silent,
            focus: false,
            panel: vscode.TaskPanelKind.Shared,
            showReuseMessage: false,
            clear: false
        };

        return task;
    }

    /**
     * Create library sync task for current device
     */
    private createLibrarySyncTask(): vscode.Task {
        const taskId = `muTwo-lib-sync-${Date.now()}`;

        const definition: MuTaskDefinition = {
            type: MuTwoTaskProvider.type,
            operation: 'sync-device',
            taskId
        };

        const execution = new vscode.ShellExecution('circup', ['freeze'], {
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
            env: {
                ...process.env,
                MUTWO_TASK_ID: taskId
            }
        });

        const task = new vscode.Task(
            definition,
            vscode.TaskScope.Workspace,
            'Sync Libraries',
            'muTwo',
            execution,
            ['$circup']
        );

        task.group = vscode.TaskGroup.Build;
        return task;
    }

    /**
     * Get environment setup commands based on platform
     */
    private getEnvironmentSetupCommands(): { command: string; args: string[] } {
        const isWindows = process.platform === 'win32';

        if (isWindows) {
            return {
                command: 'python',
                args: ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel', 'circup']
            };
        } else {
            return {
                command: 'python3',
                args: ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel', 'circup']
            };
        }
    }

    /**
     * Determine if a library is a CircuitPython library
     */
    private isCircuitPythonLibrary(libraryName: string): boolean {
        // Common CircuitPython library patterns
        const circuitPythonPatterns = [
            /^adafruit[-_]/i,
            /^circuitpython[-_]/i,
            /^simpleio$/i,
            /^neopixel$/i,
            /^displayio$/i,
            /^busio$/i,
            /^digitalio$/i,
            /^analogio$/i
        ];

        return circuitPythonPatterns.some(pattern => pattern.test(libraryName));
    }

    /**
     * Create task execution with proper monitoring
     */
    public async executeTask(definition: MuTaskDefinition): Promise<vscode.TaskExecution> {
        let task: vscode.Task | undefined;

        switch (definition.operation) {
            case 'env-setup':
                task = this.createEnvironmentSetupTask(definition.args);
                break;
            case 'install-library':
                task = this.createLibraryInstallTask(definition.library);
                break;
            case 'sync-device':
                task = this.createDeviceSyncTask(definition.deviceId);
                break;
            case 'device-scan':
                task = this.createDeviceScanTask();
                break;
            case 'runtime-switch':
                task = this.createRuntimeSwitchTask(definition.runtime);
                break;
            default:
                throw new Error(`Unknown task operation: ${definition.operation}`);
        }

        const execution = await vscode.tasks.executeTask(task);

        logger.info('TASK_PROVIDER', `Started task: ${definition.operation} (${execution.task.name})`);

        return execution;
    }

    /**
     * Dispose of the task provider
     */
    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        logger.info('TASK_PROVIDER', 'MuTwoTaskProvider disposed');
    }
}

/**
 * Register input variables for tasks
 */
export function registerTaskInputs(context: vscode.ExtensionContext): void {
    // Register input for library name
    const libraryNameInput: vscode.InputBoxOptions = {
        prompt: 'Enter library name to install',
        placeHolder: 'e.g., adafruit-circuitpython-neopixel',
        validateInput: (value: string) => {
            if (!value || value.trim().length === 0) {
                return 'Library name cannot be empty';
            }
            if (!/^[a-zA-Z0-9\-_\.]+$/.test(value)) {
                return 'Library name contains invalid characters';
            }
            return null;
        }
    };

    // Input variables are registered via package.json contribution points
    // This function can be extended to register additional dynamic inputs
}