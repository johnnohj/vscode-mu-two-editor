import * as vscode from 'vscode';
import { SerialMonitorApi, Version, getSerialMonitorApi, LineEnding, Parity, StopBits, Port } from '@microsoft/vscode-serial-monitor-api';

export interface DeviceConnectionInfo {
    port: string;
    baudRate: number;
    boardType?: string;
    isConnected: boolean;
}

export class SerialMonitorCooperativeManager {
    private serialMonitorApi: SerialMonitorApi | undefined;
    private currentDeviceConnection: DeviceConnectionInfo | undefined;
    private statusBarItem: vscode.StatusBarItem;
    
    constructor(private context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.context.subscriptions.push(this.statusBarItem);
        
        this.initializeSerialMonitorApi();
        this.registerCommands();
        this.updateStatusBar();
    }
    
    private async initializeSerialMonitorApi(): Promise<void> {
        try {
            // Check if Serial Monitor extension is available
            const serialMonitorExtension = vscode.extensions.getExtension('ms-vscode.vscode-serial-monitor');
            if (!serialMonitorExtension) {
                console.log('Serial Monitor extension not available - cooperative features disabled');
                return;
            }
            
            // Activate the extension if not already active
            if (!serialMonitorExtension.isActive) {
                await serialMonitorExtension.activate();
            }
            
            // Get the API
            this.serialMonitorApi = await getSerialMonitorApi(Version.latest, this.context);
            
            if (this.serialMonitorApi) {
                console.log('Serial Monitor API initialized successfully');
                this.updateStatusBar();
            } else {
                console.log('Failed to initialize Serial Monitor API');
            }
        } catch (error) {
            console.log('Error initializing Serial Monitor API:', error);
        }
    }
    
    private registerCommands(): void {
        // Command to open current device in Serial Monitor
        this.context.subscriptions.push(
            vscode.commands.registerCommand('muTwo.serial.openInSerialMonitor', () => {
                this.openCurrentDeviceInSerialMonitor();
            })
        );
        
        // Command to check for port conflicts
        this.context.subscriptions.push(
            vscode.commands.registerCommand('muTwo.serial.checkSerialMonitorConflict', () => {
                this.checkPortConflicts();
            })
        );
    }
    
    public async setCurrentDevice(deviceInfo: DeviceConnectionInfo): Promise<void> {
        this.currentDeviceConnection = deviceInfo;
        this.updateStatusBar();
    }
    
    public getCurrentDevice(): DeviceConnectionInfo | undefined {
        return this.currentDeviceConnection;
    }
    
    public async handlePortConflict(requestedPort: string, baudRate: number): Promise<'proceed' | 'redirect' | 'cancel'> {
        // Basic conflict detection only - complex cooperative logic removed
        if (!this.serialMonitorApi) {
            return 'proceed';
        }
        
        return 'proceed';
    }
    
    private async openPortInSerialMonitor(port: string, baudRate: number): Promise<void> {
        if (!this.serialMonitorApi) {
            vscode.window.showErrorMessage('Serial Monitor API not available');
            return;
        }
        
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Opening ${port} in Serial Monitor...`,
                cancellable: false
            }, async () => {
                const portConnection: Port = await this.serialMonitorApi!.startMonitoringPort({
                    port: port,
                    baudRate: baudRate,
                    lineEnding: LineEnding.CRLF,
                    dataBits: 8,
                    stopBits: StopBits.One,
                    parity: Parity.None
                });
                
                // Set up port closed handler
                portConnection.onClosed(() => {
                    console.log(`Serial Monitor port ${port} was closed`);
                });
            });
            
            vscode.window.showInformationMessage(
                `Port ${port} opened in Serial Monitor`,
                'Show Serial Monitor'
            ).then(selection => {
                if (selection === 'Show Serial Monitor') {
                    vscode.commands.executeCommand('workbench.panel.repl.view.focus');
                }
            });
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open port in Serial Monitor: ${error}`);
        }
    }
    
    private async checkPortConflicts(): Promise<void> {
        // This is a diagnostic command to help users understand port usage
        const serialPorts = await this.getAvailableSerialPorts();
        const conflicts: string[] = [];
        
        for (const portInfo of serialPorts) {
            // Basic conflict detection - this could be enhanced with actual port testing
            if (await this.isPortPotentiallyInUse(portInfo.path)) {
                conflicts.push(portInfo.path);
            }
        }
        
        if (conflicts.length === 0) {
            vscode.window.showInformationMessage('No obvious port conflicts detected');
        } else {
            const message = `Potential conflicts detected on ports: ${conflicts.join(', ')}`;
            vscode.window.showWarningMessage(message);
        }
    }
    
    private async getAvailableSerialPorts(): Promise<Array<{path: string, manufacturer?: string}>> {
        try {
            // Use the same serialport library that Mu 2 uses
            const { SerialPort } = await import('serialport');
            return await SerialPort.list();
        } catch (error) {
            console.error('Error listing serial ports:', error);
            return [];
        }
    }
    
    private async isPortPotentiallyInUse(port: string): Promise<boolean> {
        // Simple heuristic - try to briefly open and close the port
        try {
            const { SerialPort } = await import('serialport');
            const testPort = new SerialPort({ path: port, baudRate: 9600, autoOpen: false });
            
            return new Promise((resolve) => {
                testPort.open((error) => {
                    if (error) {
                        // Port is likely in use or not available
                        resolve(true);
                    } else {
                        testPort.close(() => {
                            resolve(false);
                        });
                    }
                });
            });
        } catch (error) {
            return true; // Assume conflict if we can't test
        }
    }
    
    private updateStatusBar(): void {
        if (this.currentDeviceConnection?.isConnected) {
            this.statusBarItem.text = `$(plug) ${this.currentDeviceConnection.port}`;
            this.statusBarItem.tooltip = `Connected to ${this.currentDeviceConnection.port} at ${this.currentDeviceConnection.baudRate} baud`;
            
            if (this.serialMonitorApi) {
                this.statusBarItem.command = 'muTwo.serial.openInSerialMonitor';
                this.statusBarItem.tooltip += ' (Click to open in Serial Monitor)';
            }
            
            this.statusBarItem.show();
        } else {
            this.statusBarItem.hide();
        }
    }
    
    public async syncBaudRateConfiguration(): Promise<void> {
        // Sync custom baud rates from Serial Monitor configuration
        try {
            const serialMonitorConfig = vscode.workspace.getConfiguration('vscode-serial-monitor');
            const customBaudRates = serialMonitorConfig.get<number[]>('customBaudRates', []);
            
            if (customBaudRates.length > 0) {
                // Make these available to Mu 2's device connection logic
                // This could be stored in workspace state or passed to device managers
                await this.context.workspaceState.update('serialMonitor.customBaudRates', customBaudRates);
                console.log('Synced custom baud rates from Serial Monitor:', customBaudRates);
            }
        } catch (error) {
            console.log('Error syncing baud rate configuration:', error);
        }
    }
    
    public getCustomBaudRates(): number[] {
        return this.context.workspaceState.get('serialMonitor.customBaudRates', []);
    }
    
    public isSerialMonitorAvailable(): boolean {
        return this.serialMonitorApi !== undefined;
    }

    /**
     * Open current device in Serial Monitor extension
     */
    private async openCurrentDeviceInSerialMonitor(): Promise<void> {
        try {
            // Get the current active device (this would need to be implemented)
            const activeDevicePath = this.context.workspaceState.get<string>('muTwo.activeDevicePath');

            if (!activeDevicePath) {
                vscode.window.showWarningMessage('No active CircuitPython device to open in Serial Monitor');
                return;
            }

            // Execute the Serial Monitor command to open the device
            await vscode.commands.executeCommand('extension.vscode-serial-monitor.openPortWithPath', {
                path: activeDevicePath,
                baudRate: 115200
            });

            vscode.window.showInformationMessage(`Opened ${activeDevicePath} in Serial Monitor`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open device in Serial Monitor: ${error}`);
        }
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
}