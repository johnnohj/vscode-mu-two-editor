export interface CommandResult {
    output: string;
    success: boolean;
    requiresTerminalUpdate?: boolean;
}

export interface ExtensionServices {
    languageClient: any;
    historyManager: any;
    deviceDetector: any;
    serialMonitorManager?: any;
}

export class CommandProcessor {
    private isConnected: boolean = false;
    private services: ExtensionServices;

    constructor(services: ExtensionServices) {
        this.services = services;
    }

    setConnectionStatus(connected: boolean): void {
        this.isConnected = connected;
    }

    getConnectionStatus(): boolean {
        return this.isConnected;
    }

    async executeCommand(command: string): Promise<CommandResult> {
        console.log(`[CommandProcessor] Executing command: "${command}"`);
        const parts = command.trim().split(' ');
        const cmd = parts[0].toLowerCase();
        
        // Handle different command types
        if (this.isConnected && !cmd.startsWith('.')) {
            console.log(`[CommandProcessor] Routing to device: ${command}`);
            // When connected, non-dot commands go to device
            return await this.executeDeviceCommand(command);
        }
        
        // Local REPL commands (handle all webview commands here)
        const actualCmd = cmd.startsWith('.') ? cmd.substring(1) : cmd;
        console.log(`[CommandProcessor] Processing REPL command: "${actualCmd}"`);
        
        switch (actualCmd) {
            case 'help':
                return { output: this.getHelpText(), success: true };
                
            case 'clear':
                return { output: '', success: true, requiresTerminalUpdate: true };
                
            case 'history':
                return { output: this.formatHistory(), success: true };
                
            case 'ports':
            case 'list':
                console.log(`[CommandProcessor] Listing serial ports...`);
                return await this.listSerialPorts();
                
            case 'connect':
                if (parts.length < 2) {
                    return { output: 'Usage: connect <port> [baudrate]\nExample: connect COM3 115200\n', success: false };
                }
                const port = parts[1];
                const baudRate = parts[2] ? parseInt(parts[2]) : 115200;
                return await this.connectToPort(port, baudRate);
                
            case 'disconnect':
                return await this.disconnectFromDevice();
                
            case 'status':
                return { output: this.getConnectionStatusText(), success: true };
                
            case 'log':
                return await this.handleLogCommand(parts.slice(1));
                
            default:
                return {
                    output: `Unknown command: ${actualCmd}\nType 'help' for available commands\n`,
                    success: false
                };
        }
    }

    private getHelpText(): string {
        return [
            '📘 Available Commands:',
            '  help                     - Show this help',
            '  clear                    - Clear terminal screen', 
            '  history                  - Show command history',
            '  ports                    - List available serial ports',
            '  connect <port>           - Connect to serial port',
            '  disconnect               - Disconnect from current port',
            '',
            '🐍 CircuitPython Commands (when connected):',
            '  print("hello")           - Execute Python code',
            '  import board             - Import CircuitPython modules',
            '  help()                   - Python help system',
            ''
        ].join('\n');
    }

    private formatHistory(): string {
        // This will be enhanced to work with DocumentManager
        return 'Command history functionality will be integrated with DocumentManager\n';
    }

    private async listSerialPorts(): Promise<CommandResult> {
        console.log(`[CommandProcessor] listSerialPorts called, services:`, !!this.services);
        console.log(`[CommandProcessor] deviceDetector available:`, !!this.services?.deviceDetector);
        
        if (!this.services?.deviceDetector) {
            return {
                output: '❌ Error: Device detector not available',
                success: false
            };
        }
        
        try {
            // Use the actual device detector service
            const result = await this.services.deviceDetector.detectDevices();
            
            if (!result.devices || result.devices.length === 0) {
                return {
                    output: [
                        '🔍 No CircuitPython devices found',
                        '',
                        'Make sure your CircuitPython device is connected and powered on.',
                        'Check that drivers are installed for your device.',
                        `Scanned ${result.totalDevices || 0} total serial devices.`,
                        ''
                    ].join('\n'),
                    success: true
                };
            }
            
            const output = [
                '🐍 Available CircuitPython Devices:',
                '',
                ...result.devices.map(device => 
                    `  ${device.path} - ${device.boardName || device.description || 'Unknown Device'} ${device.manufacturer ? '(' + device.manufacturer + ')' : ''}`
                ),
                '',
                result.conflicts.length > 0 ? `⚠️ ${result.conflicts.length} device(s) have VID/PID conflicts` : '',
                'Use \'connect <port>\' to connect to a device.',
                ''
            ].filter(line => line !== null && line !== undefined).join('\n');
            
            return { output, success: true };
            
        } catch (error) {
            return {
                output: `❌ Error scanning for devices: ${error instanceof Error ? error.message : String(error)}\n`,
                success: false
            };
        }
    }

    private async connectToPort(port: string, baudRate: number = 115200): Promise<CommandResult> {
        if (!this.services?.languageClient) {
            return {
                output: '❌ Error: Extension services not available',
                success: false
            };
        }
        
        // Check for Serial Monitor conflicts if cooperative manager is available
        if (this.services.serialMonitorManager) {
            const conflictAction = await this.services.serialMonitorManager.handlePortConflict(port, baudRate);
            
            if (conflictAction === 'cancel') {
                return {
                    output: `❌ Connection cancelled by user\n`,
                    success: false
                };
            } else if (conflictAction === 'redirect') {
                return {
                    output: `📋 Port ${port} opened in Serial Monitor instead\n`,
                    success: true
                };
            }
            // If conflictAction === 'proceed', continue with normal connection
        }
        
        try {
            const result = await this.services.languageClient.connectSerial(port, baudRate);
            if (result.success) {
                this.isConnected = true;
                
                // Update cooperative manager with current device info
                if (this.services.serialMonitorManager) {
                    await this.services.serialMonitorManager.setCurrentDevice({
                        port: port,
                        baudRate: baudRate,
                        isConnected: true
                    });
                }
                
                return {
                    output: [
                        `✅ Connected to ${port} at ${baudRate} baud`,
                        '🐍 CircuitPython device ready',
                        'Type Python commands or \'help()\' for assistance.',
                        '💡 Tip: Use "Mu 2: Open Current Device in Serial Monitor" to switch to Serial Monitor',
                        ''
                    ].join('\n'),
                    success: true
                };
            } else {
                return {
                    output: `❌ Connection failed: ${result.error || 'Unknown error'}\n`,
                    success: false
                };
            }
        } catch (error) {
            return {
                output: `❌ Connection error: ${error instanceof Error ? error.message : String(error)}\n`,
                success: false
            };
        }
    }
    
    private async disconnectFromDevice(): Promise<CommandResult> {
        if (!this.services?.languageClient) {
            return {
                output: '❌ Error: Extension services not available\n',
                success: false
            };
        }
        
        if (!this.isConnected) {
            return {
                output: 'No active connection to disconnect\n',
                success: true
            };
        }
        
        try {
            await this.services.languageClient.stop();
            this.isConnected = false;
            return {
                output: '📴 Disconnected from serial port\n',
                success: true
            };
        } catch (error) {
            return {
                output: `❌ Disconnect error: ${error instanceof Error ? error.message : String(error)}\n`,
                success: false
            };
        }
    }
    
    private getConnectionStatusText(): string {
        if (this.isConnected) {
            return '🟢 Connection Status: CONNECTED\nUse "disconnect" to close connection gracefully\n';
        } else {
            return '🔴 Connection Status: DISCONNECTED\nUse "connect <port>" to establish connection\n';
        }
    }
    
    private async executeDeviceCommand(command: string): Promise<CommandResult> {
        if (!this.services?.languageClient) {
            return {
                output: '❌ Error: Extension services not available\n',
                success: false
            };
        }
        
        try {
            const result = await this.services.languageClient.executeCode(command);
            if (result.success) {
                return {
                    output: (result.output || '') + '\n',
                    success: true
                };
            } else {
                return {
                    output: `❌ Execution error: ${result.error || 'Unknown error'}\n`,
                    success: false
                };
            }
        } catch (error) {
            return {
                output: `❌ Device command error: ${error instanceof Error ? error.message : String(error)}\n`,
                success: false
            };
        }
    }
    
    private async handleLogCommand(args: string[]): Promise<CommandResult> {
        if (!this.services?.historyManager) {
            return {
                output: '❌ Error: History manager not available\n',
                success: false
            };
        }
        
        const action = args[0] || 'status';
        
        switch (action) {
            case '--start':
            case 'start':
                this.services.historyManager.startLogging();
                return {
                    output: '📝 History logging started\nCommands and outputs will be saved to .vscode/mu2-history.json\n',
                    success: true
                };
                
            case '--stop':
            case '--end':
            case 'stop':
            case 'end':
                this.services.historyManager.stopLogging();
                return {
                    output: '📴 History logging stopped\n',
                    success: true
                };
                
            case '--status':
            case 'status':
            default:
                const enabled = this.services.historyManager.isLoggingEnabled();
                const statusIcon = enabled ? '📝' : '📴';
                const message = enabled ? 'History logging is active' : 'History logging is disabled';
                return {
                    output: `${statusIcon} ${message}\n`,
                    success: true
                };
        }
    }
}