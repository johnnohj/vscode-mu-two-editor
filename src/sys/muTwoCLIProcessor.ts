// src/sys/muTwoCLIProcessor.ts
// CLI Command Processor for Mu Two Extension
// Handles parsing and execution of CLI commands in webview REPL

import * as vscode from 'vscode';
import { getLogger } from './unifiedLogger';
import { ServiceRegistry } from './serviceRegistry';
import { MuTwoRuntimeCoordinator } from './unifiedRuntimeCoordinator';

const logger = getLogger();

export interface CLIResult {
    type: 'success' | 'error' | 'progress' | 'passthrough';
    message?: string;
    data?: any;
    taskId?: string; // For tracking background tasks
}

export interface CLICommand {
    execute(args: string[], context: CLIExecutionContext): Promise<CLIResult>;
    getHelp(): string;
    getDescription(): string;
}

export interface CLIExecutionContext {
    context: vscode.ExtensionContext;
    serviceRegistry: ServiceRegistry;
    runtimeCoordinator: MuTwoRuntimeCoordinator;
    sendProgress?: (message: string) => void;
    taskProvider?: any; // MuTwoTaskProvider - avoiding circular dependency
}

export class MuTwoCLIProcessor {
    private commands = new Map<string, CLICommand>();
    private executionContext: CLIExecutionContext;

    constructor(
        private context: vscode.ExtensionContext,
        private serviceRegistry: ServiceRegistry,
        private runtimeCoordinator: MuTwoRuntimeCoordinator
    ) {
        this.executionContext = {
            context: this.context,
            serviceRegistry: this.serviceRegistry,
            runtimeCoordinator: this.runtimeCoordinator
        };

        this.registerCommands();
        logger.info('CLI_PROCESSOR', 'MuTwoCLIProcessor initialized');
    }

    /**
     * Set task provider for CLI commands that need to spawn background tasks
     */
    public setTaskProvider(taskProvider: any): void {
        this.executionContext.taskProvider = taskProvider;
        logger.info('CLI_PROCESSOR', 'Task provider integrated with CLI processor');
    }

    private registerCommands(): void {
        // Environment commands that use VS Code Tasks
        this.commands.set('env', new EnvironmentCLICommand());
        this.commands.set('setup', new SetupCLICommand());

        // Device commands using existing managers
        this.commands.set('connect', new ConnectCLICommand());
        this.commands.set('devices', new DevicesCLICommand());
        this.commands.set('disconnect', new DisconnectCLICommand());

        // Runtime commands using Phase 1-3 components
        this.commands.set('runtime', new RuntimeCLICommand());
        this.commands.set('switch', new SwitchCLICommand());
        this.commands.set('which', new WhichCLICommand());

        // Library commands that spawn tasks
        this.commands.set('install', new InstallCLICommand());
        this.commands.set('libraries', new LibrariesCLICommand());
        this.commands.set('sync', new SyncCLICommand());

        // Configuration commands
        this.commands.set('config', new ConfigCLICommand());
        this.commands.set('help', new HelpCLICommand(this.commands));
        this.commands.set('version', new VersionCLICommand());

        logger.info('CLI_PROCESSOR', `Registered ${this.commands.size} CLI commands`);
    }

    async processCommand(input: string): Promise<CLIResult> {
        const trimmedInput = input.trim();

        // Check if this is a CLI command (starts with 'mu ')
        if (!trimmedInput.startsWith('mu ')) {
            return { type: 'passthrough', data: input };
        }

        // Parse command and arguments
        const commandParts = trimmedInput.substring(3).trim().split(/\s+/);
        const commandName = commandParts[0];
        const args = commandParts.slice(1);

        if (!commandName) {
            return {
                type: 'error',
                message: 'No command specified. Use "mu help" for available commands.'
            };
        }

        const handler = this.commands.get(commandName);
        if (!handler) {
            return {
                type: 'error',
                message: `Unknown command: ${commandName}. Use "mu help" for available commands.`
            };
        }

        try {
            logger.info('CLI_PROCESSOR', `Executing command: ${commandName} with args: [${args.join(', ')}]`);
            const result = await handler.execute(args, this.executionContext);
            logger.info('CLI_PROCESSOR', `Command ${commandName} completed with type: ${result.type}`);
            return result;
        } catch (error) {
            logger.error('CLI_PROCESSOR', `Command ${commandName} failed:`, error);
            return {
                type: 'error',
                message: `Error executing ${commandName}: ${error instanceof Error ? error.message : String(error)}`
            };
        }
    }

    getAvailableCommands(): string[] {
        return Array.from(this.commands.keys()).sort();
    }

    getCommandHelp(commandName: string): string | null {
        const command = this.commands.get(commandName);
        return command ? command.getHelp() : null;
    }
}

// Base class for CLI commands
abstract class BaseCLICommand implements CLICommand {
    abstract execute(args: string[], context: CLIExecutionContext): Promise<CLIResult>;
    abstract getHelp(): string;
    abstract getDescription(): string;

    protected createSuccess(message: string, data?: any): CLIResult {
        return { type: 'success', message, data };
    }

    protected createError(message: string): CLIResult {
        return { type: 'error', message };
    }

    protected createProgress(taskId: string, data: any): CLIResult {
        return { type: 'progress', taskId, data };
    }

    /**
     * Execute a background task using the task provider
     */
    protected async executeTask(context: CLIExecutionContext, definition: any): Promise<CLIResult> {
        if (!context.taskProvider) {
            return this.createError('Task provider not available - operations requiring background tasks cannot be executed');
        }

        try {
            const execution = await context.taskProvider.executeTask(definition);
            return {
                type: 'progress',
                message: `Task started: ${execution.task.name}`,
                taskId: definition.taskId,
                data: { execution: execution.task.name }
            };
        } catch (error) {
            return this.createError(`Failed to start task: ${error}`);
        }
    }
}

// Environment Management Commands
class EnvironmentCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const subCommand = args[0] || 'status';

        switch (subCommand) {
            case 'status':
                return this.getEnvironmentStatus(context);
            case 'setup':
                return this.setupEnvironment(context);
            case 'retry':
                return this.retryEnvironmentSetup(context);
            default:
                return this.createError(`Unknown env subcommand: ${subCommand}. Use: status, setup, retry`);
        }
    }

    private async getEnvironmentStatus(context: CLIExecutionContext): Promise<CLIResult> {
        const pythonEnvManager = context.serviceRegistry.get('pythonEnvManager');

        if (!pythonEnvManager) {
            return this.createError('Python environment manager not available');
        }

        // Get environment status
        const status = pythonEnvManager.getCurrentPythonPath() ? 'Active' : 'Inactive';
        const venvPath = pythonEnvManager.getCurrentPythonPath();

        let message = `Python environment: ${status}`;
        if (venvPath) {
            message += `\nVirtual environment: ${venvPath}`;
        }

        return this.createSuccess(message);
    }

    private async setupEnvironment(context: CLIExecutionContext): Promise<CLIResult> {
        const taskId = `muTwo-env-setup-${Date.now()}`;

        const taskDefinition = {
            type: 'muTwo',
            operation: 'env-setup',
            taskId
        };

        return this.executeTask(context, taskDefinition);
    }

    private async retryEnvironmentSetup(context: CLIExecutionContext): Promise<CLIResult> {
        const pythonEnvManager = context.serviceRegistry.get('pythonEnvManager');

        if (!pythonEnvManager) {
            return this.createError('Python environment manager not available');
        }

        try {
            await pythonEnvManager.initialize();
            return this.createSuccess('Python environment setup retry completed');
        } catch (error) {
            return this.createError(`Environment setup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getHelp(): string {
        return 'mu env [status|setup|retry] - Manage Python environment';
    }

    getDescription(): string {
        return 'Manage Python virtual environment setup and status';
    }
}

class SetupCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const target = args[0] || 'python';

        if (target === 'python') {
            // Delegate to environment setup
            const envCommand = new EnvironmentCLICommand();
            return envCommand.execute(['setup'], context);
        }

        return this.createError(`Unknown setup target: ${target}. Use: python`);
    }

    getHelp(): string {
        return 'mu setup [python] - Setup extension components';
    }

    getDescription(): string {
        return 'Setup and initialize extension components';
    }
}

// Device Management Commands
class ConnectCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const deviceId = args[0];
        const pureDeviceManager = context.serviceRegistry.get('pureDeviceManager');

        if (!pureDeviceManager) {
            return this.createError('Device manager not available');
        }

        try {
            if (deviceId) {
                // Connect to specific device
                const connection = await pureDeviceManager.connectToDevice(deviceId);
                return this.createSuccess(`Connected to device: ${connection.deviceInfo.name || deviceId}`);
            } else {
                // Auto-detect and connect
                const devices = await pureDeviceManager.detectDevices();
                if (devices.length === 0) {
                    return this.createError('No devices found. Make sure a CircuitPython device is connected.');
                }

                const device = devices[0]; // Connect to first available device
                const connection = await pureDeviceManager.connectToDevice(device.id);
                return this.createSuccess(`Auto-connected to: ${device.name || device.id}`);
            }
        } catch (error) {
            return this.createError(`Connection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getHelp(): string {
        return 'mu connect [device-id] - Connect to CircuitPython device';
    }

    getDescription(): string {
        return 'Connect to a CircuitPython device (auto-detects if no ID provided)';
    }
}

class DevicesCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const pureDeviceManager = context.serviceRegistry.get('pureDeviceManager');

        if (!pureDeviceManager) {
            return this.createError('Device manager not available');
        }

        try {
            const devices = await pureDeviceManager.detectDevices();

            if (devices.length === 0) {
                return this.createSuccess('No CircuitPython devices found');
            }

            let message = `Found ${devices.length} device(s):\n`;
            devices.forEach((device, index) => {
                message += `  ${index + 1}. ${device.name || device.id} (${device.id})\n`;
            });

            return this.createSuccess(message.trim());
        } catch (error) {
            return this.createError(`Device detection failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getHelp(): string {
        return 'mu devices - List available CircuitPython devices';
    }

    getDescription(): string {
        return 'Scan for and list available CircuitPython devices';
    }
}

class DisconnectCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const pureDeviceManager = context.serviceRegistry.get('pureDeviceManager');

        if (!pureDeviceManager) {
            return this.createError('Device manager not available');
        }

        try {
            // Disconnect current device
            await pureDeviceManager.disconnectAll();
            return this.createSuccess('Disconnected from all devices');
        } catch (error) {
            return this.createError(`Disconnect failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getHelp(): string {
        return 'mu disconnect - Disconnect from current device';
    }

    getDescription(): string {
        return 'Disconnect from the currently connected device';
    }
}

// Runtime Management Commands
class RuntimeCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const subCommand = args[0] || 'status';
        const runtimeArg = args[1];

        switch (subCommand) {
            case 'status':
                return this.getRuntimeStatus(context);
            case 'switch':
                if (!runtimeArg) {
                    return this.createError('Runtime type required. Use: wasm, physical, blinka');
                }
                return this.switchRuntime(runtimeArg, context);
            default:
                return this.createError(`Unknown runtime subcommand: ${subCommand}. Use: status, switch`);
        }
    }

    private async getRuntimeStatus(context: CLIExecutionContext): Promise<CLIResult> {
        try {
            const currentRuntime = await context.runtimeCoordinator.getCurrentRuntime();

            if (!currentRuntime) {
                return this.createSuccess('No runtime currently active');
            }

            const runtimeInfo = `Current runtime: ${currentRuntime.type}\nStatus: ${currentRuntime.isHealthy() ? 'Healthy' : 'Unhealthy'}`;
            return this.createSuccess(runtimeInfo);
        } catch (error) {
            return this.createError(`Failed to get runtime status: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async switchRuntime(runtimeType: string, context: CLIExecutionContext): Promise<CLIResult> {
        try {
            // Validate runtime type
            const validTypes = ['wasm', 'physical', 'blinka'];
            if (!validTypes.includes(runtimeType)) {
                return this.createError(`Invalid runtime type: ${runtimeType}. Use: ${validTypes.join(', ')}`);
            }

            // Switch runtime
            const success = await context.runtimeCoordinator.switchRuntime(runtimeType as any);

            if (success) {
                return this.createSuccess(`Switched to ${runtimeType} runtime`);
            } else {
                return this.createError(`Failed to switch to ${runtimeType} runtime`);
            }
        } catch (error) {
            return this.createError(`Runtime switch failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getHelp(): string {
        return 'mu runtime [status|switch] [type] - Manage runtime environment';
    }

    getDescription(): string {
        return 'View or switch between different runtime environments (WASM, physical, Blinka)';
    }
}

class SwitchCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const runtimeType = args[0];

        if (!runtimeType) {
            return this.createError('Runtime type required. Use: wasm, physical, blinka');
        }

        // Delegate to runtime switch
        const runtimeCommand = new RuntimeCLICommand();
        return runtimeCommand.execute(['switch', runtimeType], context);
    }

    getHelp(): string {
        return 'mu switch <type> - Switch runtime (alias for "mu runtime switch")';
    }

    getDescription(): string {
        return 'Quick runtime switching command';
    }
}

class WhichCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const target = args[0] || 'runtime';

        if (target === 'runtime') {
            // Delegate to runtime status
            const runtimeCommand = new RuntimeCLICommand();
            return runtimeCommand.execute(['status'], context);
        }

        return this.createError(`Unknown which target: ${target}. Use: runtime`);
    }

    getHelp(): string {
        return 'mu which [runtime] - Show current runtime information';
    }

    getDescription(): string {
        return 'Display information about current runtime environment';
    }
}

// Library Management Commands (placeholder - will spawn tasks)
class InstallCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const libraryName = args[0];

        if (!libraryName) {
            return this.createError('Library name required');
        }

        const taskId = `muTwo-lib-install-${Date.now()}`;

        const taskDefinition = {
            type: 'muTwo',
            operation: 'install-library',
            taskId,
            library: libraryName
        };

        return this.executeTask(context, taskDefinition);
    }

    getHelp(): string {
        return 'mu install <library> - Install CircuitPython library';
    }

    getDescription(): string {
        return 'Install a CircuitPython library using circup';
    }
}

class LibrariesCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        // For now, return placeholder - will implement with actual library detection
        return this.createSuccess('Library listing not yet implemented. Use "mu install <library>" to install libraries.');
    }

    getHelp(): string {
        return 'mu libraries - List installed libraries';
    }

    getDescription(): string {
        return 'List currently installed CircuitPython libraries';
    }
}

class SyncCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const target = args[0] || 'libraries';

        if (target === 'libraries') {
            return this.createProgress('sync-libraries', {
                name: 'Sync Libraries',
                command: 'circup',
                args: ['update']
            });
        }

        return this.createError(`Unknown sync target: ${target}. Use: libraries`);
    }

    getHelp(): string {
        return 'mu sync [libraries] - Sync libraries with device';
    }

    getDescription(): string {
        return 'Synchronize libraries between host and device';
    }
}

// Configuration and Help Commands
class ConfigCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const action = args[0];
        const key = args[1];
        const value = args[2];

        switch (action) {
            case 'get':
                if (!key) {
                    return this.createError('Configuration key required');
                }
                return this.getConfig(key, context);
            case 'set':
                if (!key || !value) {
                    return this.createError('Configuration key and value required');
                }
                return this.setConfig(key, value, context);
            case 'list':
                return this.listConfig(context);
            default:
                return this.createError('Unknown config action. Use: get, set, list');
        }
    }

    private async getConfig(key: string, context: CLIExecutionContext): Promise<CLIResult> {
        const config = vscode.workspace.getConfiguration('muTwo');
        const value = config.get(key);

        if (value === undefined) {
            return this.createError(`Configuration key "${key}" not found`);
        }

        return this.createSuccess(`${key} = ${JSON.stringify(value)}`);
    }

    private async setConfig(key: string, value: string, context: CLIExecutionContext): Promise<CLIResult> {
        try {
            const config = vscode.workspace.getConfiguration('muTwo');

            // Try to parse value as JSON, fallback to string
            let parsedValue: any = value;
            try {
                parsedValue = JSON.parse(value);
            } catch {
                // Keep as string if not valid JSON
            }

            await config.update(key, parsedValue, vscode.ConfigurationTarget.Workspace);
            return this.createSuccess(`Set ${key} = ${JSON.stringify(parsedValue)}`);
        } catch (error) {
            return this.createError(`Failed to set config: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async listConfig(context: CLIExecutionContext): Promise<CLIResult> {
        const config = vscode.workspace.getConfiguration('muTwo');
        const keys = Object.keys(config);

        if (keys.length === 0) {
            return this.createSuccess('No Mu Two configuration found');
        }

        let message = 'Mu Two Configuration:\n';
        keys.forEach(key => {
            const value = config.get(key);
            message += `  ${key} = ${JSON.stringify(value)}\n`;
        });

        return this.createSuccess(message.trim());
    }

    getHelp(): string {
        return 'mu config [get|set|list] [key] [value] - Manage configuration';
    }

    getDescription(): string {
        return 'Get, set, or list Mu Two configuration settings';
    }
}

class HelpCLICommand extends BaseCLICommand {
    constructor(private commands: Map<string, CLICommand>) {
        super();
    }

    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        const commandName = args[0];

        if (commandName) {
            // Help for specific command
            const command = this.commands.get(commandName);
            if (!command) {
                return this.createError(`Unknown command: ${commandName}`);
            }

            const help = `${command.getHelp()}\n\n${command.getDescription()}`;
            return this.createSuccess(help);
        }

        // General help
        let message = 'Mu Two CLI Commands:\n\n';

        const sortedCommands = Array.from(this.commands.entries()).sort(([a], [b]) => a.localeCompare(b));

        sortedCommands.forEach(([name, command]) => {
            message += `  ${command.getHelp()}\n`;
        });

        message += '\nUse "mu help <command>" for detailed help on a specific command.';

        return this.createSuccess(message);
    }

    getHelp(): string {
        return 'mu help [command] - Show help information';
    }

    getDescription(): string {
        return 'Display help for CLI commands';
    }
}

class VersionCLICommand extends BaseCLICommand {
    async execute(args: string[], context: CLIExecutionContext): Promise<CLIResult> {
        try {
            const packageJson = require('../../package.json');
            const version = packageJson.version || 'unknown';

            let message = `Mu Two Extension v${version}`;

            // Add runtime information
            const currentRuntime = await context.runtimeCoordinator.getCurrentRuntime();
            if (currentRuntime) {
                message += `\nRuntime: ${currentRuntime.type}`;
            }

            return this.createSuccess(message);
        } catch (error) {
            return this.createError(`Failed to get version: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    getHelp(): string {
        return 'mu version - Show extension version information';
    }

    getDescription(): string {
        return 'Display Mu Two extension version and runtime information';
    }
}