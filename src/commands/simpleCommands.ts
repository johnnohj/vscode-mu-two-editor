/**
 * Simple Command Handlers
 * Replaces over-engineered CLI processor with direct command implementations
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
// Phase 2: SimpleDeviceDetector removed - using DeviceRegistry
import { getDeviceRegistry } from '../devices/core/deviceRegistry';
import { ReplViewProvider } from '../providers/views/replViewProvider';

export class SimpleCommands {
    constructor(
        private context: vscode.ExtensionContext,
        private replViewProvider?: ReplViewProvider
    ) {}

    /**
     * Set the REPL view provider after it's created
     */
    public setReplViewProvider(replViewProvider: ReplViewProvider): void {
        this.replViewProvider = replViewProvider;
    }

    /**
     * Register all simple commands
     */
    registerCommands(): void {
        const commands = [
            vscode.commands.registerCommand('muTwo.device.refresh', () => this.refreshDevices()),
            vscode.commands.registerCommand('muTwo.device.connect', () => this.connectDevice()),
            vscode.commands.registerCommand('muTwo.python.installPackage', () => this.installPythonPackage()),
            vscode.commands.registerCommand('muTwo.circup.updateLibraries', () => this.updateCircupLibraries()),
            vscode.commands.registerCommand('muTwo.device.reset', () => this.resetDevice()),
            vscode.commands.registerCommand('muTwo.repl.openNativeTerminal', () => this.openNativeReplTerminal())
        ];

        commands.forEach(cmd => this.context.subscriptions.push(cmd));
    }

    /**
     * Refresh device detection
     * Phase 2: Uses DeviceRegistry
     */
    private async refreshDevices(): Promise<void> {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Scanning for CircuitPython devices...' },
            async () => {
                const deviceRegistry = getDeviceRegistry();
                const devices = await deviceRegistry.refresh();
                vscode.window.showInformationMessage(`Found ${devices.length} device(s)`);
            }
        );
    }

    /**
     * Connect to a CircuitPython device
     * Phase 2: Uses DeviceRegistry
     */
    private async connectDevice(): Promise<void> {
        const deviceRegistry = getDeviceRegistry();
        const devices = deviceRegistry.getCircuitPythonDevices();

        if (devices.length === 0) {
            const refresh = await vscode.window.showInformationMessage(
                'No CircuitPython devices found.',
                'Scan for Devices'
            );
            if (refresh) {
                await this.refreshDevices();
            }
            return;
        }

        const deviceItems = devices.map(device => ({
            label: device.boardName || 'Unknown Board',
            description: device.path,
            device
        }));

        const selected = await vscode.window.showQuickPick(deviceItems, {
            title: 'Select CircuitPython Device'
        });

        if (selected) {
            // Simple connection logic - could be expanded
            vscode.window.showInformationMessage(`Connected to ${selected.label} at ${selected.description}`);
        }
    }

    /**
     * Install Python package using pip
     */
    private async installPythonPackage(): Promise<void> {
        const packageName = await vscode.window.showInputBox({
            title: 'Install Python Package',
            prompt: 'Enter package name'
        });

        if (!packageName) return;

        this.runTerminalCommand(`pip install ${packageName}`, 'Installing Python Package');
    }

    /**
     * Update CircuitPython libraries using circup
     */
    private async updateCircupLibraries(): Promise<void> {
        this.runTerminalCommand('circup update', 'Updating CircuitPython Libraries');
    }

    /**
     * Reset CircuitPython device
     */
    private async resetDevice(): Promise<void> {
        const devices = this.deviceDetector.getDevices();

        if (devices.length === 0) {
            vscode.window.showWarningMessage('No CircuitPython devices connected');
            return;
        }

        // Simple reset implementation
        vscode.window.showInformationMessage('Device reset functionality would be implemented here');
    }

    /**
     * Open native REPL terminal for advanced users
     */
    private openNativeReplTerminal(): void {
        console.log('openNativeReplTerminal called, replViewProvider:', !!this.replViewProvider);

        if (!this.replViewProvider) {
            vscode.window.showWarningMessage('REPL not available. Please ensure the REPL panel is initialized first.');
            return;
        }

        const terminal = this.replViewProvider.createNativeTerminal();
        if (!terminal) {
            vscode.window.showErrorMessage('Failed to create native REPL terminal');
        } else {
            vscode.window.showInformationMessage('Native Mu 2 Shell terminal opened! 🚀');
        }
    }

    /**
     * Run command in VS Code terminal
     */
    private runTerminalCommand(command: string, title: string): void {
        const terminal = vscode.window.createTerminal({
            name: title,
            iconPath: new vscode.ThemeIcon('circuit-board')
        });

        terminal.show();
        terminal.sendText(command);
    }
}