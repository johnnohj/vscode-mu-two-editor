import * as vscode from 'vscode';
import { MuTwoWorkspace } from './workspace';
import { IDevice } from '../devices/core/deviceDetector';
import { getLogger } from '../sys/unifiedLogger';

export interface WorkspaceValidationResult {
    isValidMu2Workspace: boolean;
    hasVscodeDirectory: boolean;
    hasMu2Directory: boolean;
    hasBoardAssociation: boolean;
    hasCircuitPyDrive: boolean;
    hasPythonFiles: boolean;
    isRegisteredWorkspace: boolean;
    errors: string[];
    warnings: string[];
}

export interface WorkspaceValidationOptions {
    checkCircuitPyDrive?: boolean;
    requireBoardAssociation?: boolean;
    workspaceUri?: vscode.Uri;
    respectGlobalPermissions?: boolean;
}

export interface DeviceConnectionPermissions {
    hasGlobalPermission: boolean;
    autoConnectEnabled: boolean;
    skipPermissionPrompts: boolean;
    lastPermissionCheck?: string;
}

export class WorkspaceValidator {
    private workspace: MuTwoWorkspace;
    private logger = getLogger();

    constructor(context: vscode.ExtensionContext) {
        this.workspace = MuTwoWorkspace.getInstance(context);
        // Using unified logger instead of createOutputChannel
    }

    /**
     * Validate the current workspace environment for Mu 2 Editor compatibility
     */
    async validateWorkspace(options: WorkspaceValidationOptions = {}): Promise<WorkspaceValidationResult> {
        const result: WorkspaceValidationResult = {
            isValidMu2Workspace: false,
            hasVscodeDirectory: false,
            hasMu2Directory: false,
            hasBoardAssociation: false,
            hasCircuitPyDrive: false,
            hasPythonFiles: false,
            isRegisteredWorkspace: false,
            errors: [],
            warnings: []
        };

        const workspaceUri = options.workspaceUri || MuTwoWorkspace.rootPath;
        if (!workspaceUri) {
            result.errors.push('No workspace folder is currently open');
            return result;
        }

        this.logger.info('WORKSPACE', `Validating workspace: ${workspaceUri.fsPath}`);

        try {
            // Check for .vscode directory
            result.hasVscodeDirectory = await this.checkVscodeDirectory(workspaceUri);
            if (!result.hasVscodeDirectory) {
                result.warnings.push('No .vscode directory found');
            }

            // Check for .vscode/mu2 directory
            result.hasMu2Directory = await this.checkMu2Directory(workspaceUri);
            if (!result.hasMu2Directory) {
                result.warnings.push('No .vscode/mu2 directory found');
            }

            // Check for board association
            result.hasBoardAssociation = await this.checkBoardAssociation(workspaceUri);
            if (!result.hasBoardAssociation && options.requireBoardAssociation) {
                result.warnings.push('No board association found');
            }

            // Check for CIRCUITPY drive in workspace folders
            if (options.checkCircuitPyDrive) {
                result.hasCircuitPyDrive = await this.checkCircuitPyDrive();
                if (!result.hasCircuitPyDrive) {
                    result.warnings.push('No CIRCUITPY drive found in workspace folders');
                }
            }

            // Check for Python files
            result.hasPythonFiles = await this.checkPythonFiles(workspaceUri);
            if (!result.hasPythonFiles) {
                result.warnings.push('No Python files found in workspace');
            }

            // Check if workspace is registered
            result.isRegisteredWorkspace = await this.checkRegisteredWorkspace(workspaceUri);
            if (!result.isRegisteredWorkspace) {
                result.warnings.push('Workspace is not registered in Mu 2 registry');
            }

            // Determine if this is a valid Mu2 workspace
            result.isValidMu2Workspace = result.hasMu2Directory;

            this.logger.info('WORKSPACE', `Validation complete. Valid Mu2 workspace: ${result.isValidMu2Workspace}`);

        } catch (error) {
            result.errors.push(`Validation error: ${error instanceof Error ? error.message : String(error)}`);
            this.logger.error('WORKSPACE', `Validation error: ${error}`);
        }

        return result;
    }

    /**
     * Check if .vscode directory exists
     */
    private async checkVscodeDirectory(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            const vscodeDir = vscode.Uri.joinPath(workspaceUri, '.vscode');
            await vscode.workspace.fs.stat(vscodeDir);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if .vscode/mu2 directory exists
     */
    private async checkMu2Directory(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            const mu2Dir = vscode.Uri.joinPath(workspaceUri, '.vscode', 'mu2');
            await vscode.workspace.fs.stat(mu2Dir);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Check if board association exists
     */
    private async checkBoardAssociation(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            const boardAssociation = await this.workspace.getBoardAssociation(workspaceUri);
            return boardAssociation !== null;
        } catch {
            return false;
        }
    }

    /**
     * Check for CIRCUITPY drive in workspace folders
     */
    private async checkCircuitPyDrive(): Promise<boolean> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return false;
        }

        for (const folder of workspaceFolders) {
            const folderName = folder.name.toUpperCase();
            const folderPath = folder.uri.fsPath.toUpperCase();
            
            // Check if folder name or path contains CIRCUITPY
            if (folderName.includes('CIRCUITPY') || folderPath.includes('CIRCUITPY')) {
                return true;
            }

            // Check if folder has CIRCUITPY scheme or ctpy:// scheme
            if (folder.uri.scheme === 'ctpy' || folder.uri.scheme === 'circuitpy') {
                return true;
            }
        }

        return false;
    }

    /**
     * Check for Python files (.py) in workspace
     */
    private async checkPythonFiles(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            const files = await vscode.workspace.fs.readDirectory(workspaceUri);
            
            for (const [fileName] of files) {
                if (fileName.endsWith('.py')) {
                    return true;
                };
					 if (fileName === 'code.py' || fileName === 'main.py' || fileName === 'boot.py') {
						  return true;
					 }
            }

            // Also check for files with ctpy:// scheme in active text editors
            const textEditors = vscode.window.visibleTextEditors;
            for (const editor of textEditors) {
                const uri = editor.document.uri;
                if (uri.scheme === 'ctpy' || uri.fsPath.endsWith('.py')) {
                    return true;
                }
            }

            return false;
        } catch {
            return false;
        }
    }

    /**
     * Check if workspace is registered in Mu 2 registry
     */
    private async checkRegisteredWorkspace(workspaceUri: vscode.Uri): Promise<boolean> {
        try {
            const workspaceConfig = await this.workspace.getWorkspaceConfig(workspaceUri);
            if (!workspaceConfig) {
                return false;
            }

            const registry = await this.workspace.getWorkspaceRegistry();
            return registry.workspaces.some(ws => ws.id === workspaceConfig.workspace_id);
        } catch {
            return false;
        }
    }

    /**
     * Prompt user for workspace recreation permission
     */
    async promptWorkspaceRecreation(
        validationResult: WorkspaceValidationResult,
        device?: IDevice
    ): Promise<'recreate' | 'continue' | 'cancel'> {
        const deviceInfo = device ? ` with ${device.displayName}` : '';
        const issues = [...validationResult.errors, ...validationResult.warnings];
        
        let message = `This workspace doesn't appear to be a properly configured Mu 2 Editor workspace${deviceInfo}.`;
        
        if (issues.length > 0) {
            message += `\n\nIssues found:\n${issues.map(issue => `• ${issue}`).join('\n')}`;
        }

        message += '\n\nWould you like to (re)create it as a Mu 2 Editor workspace?';

        const choice = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            'Create Mu 2 Workspace',
            'Continue Without Setup',
            'Cancel'
        );

        switch (choice) {
            case 'Create Mu 2 Workspace':
                return 'recreate';
            case 'Continue Without Setup':
                return 'continue';
            case 'Cancel':
            default:
                return 'cancel';
        }
    }

    /**
     * Check global device connection permissions
     */
    getDeviceConnectionPermissions(): DeviceConnectionPermissions {
        const config = vscode.workspace.getConfiguration('muTwo.device');
        
        return {
            hasGlobalPermission: config.get('allowAutoConnection', false),
            autoConnectEnabled: config.get('autoConnectEnabled', true),
            skipPermissionPrompts: config.get('skipPermissionPrompts', false),
            lastPermissionCheck: config.get('lastPermissionCheck', undefined)
        };
    }

    /**
     * Set global device connection permissions
     */
    async setDeviceConnectionPermissions(permissions: Partial<DeviceConnectionPermissions>): Promise<void> {
        const config = vscode.workspace.getConfiguration('muTwo.device');
        
        if (permissions.hasGlobalPermission !== undefined) {
            await config.update('allowAutoConnection', permissions.hasGlobalPermission, vscode.ConfigurationTarget.Global);
        }
        
        if (permissions.autoConnectEnabled !== undefined) {
            await config.update('autoConnectEnabled', permissions.autoConnectEnabled, vscode.ConfigurationTarget.Global);
        }
        
        if (permissions.skipPermissionPrompts !== undefined) {
            await config.update('skipPermissionPrompts', permissions.skipPermissionPrompts, vscode.ConfigurationTarget.Global);
        }
        
        if (permissions.lastPermissionCheck !== undefined) {
            await config.update('lastPermissionCheck', permissions.lastPermissionCheck, vscode.ConfigurationTarget.Global);
        }
    }

    /**
     * Show safety warning about automatic device connection (respects global settings)
     */
    async showDeviceConnectionWarning(device?: IDevice, respectGlobalSettings: boolean = true): Promise<boolean> {
        if (respectGlobalSettings) {
            const permissions = this.getDeviceConnectionPermissions();
            
            // If global permission is already granted and auto-connect is enabled
            if (permissions.hasGlobalPermission && permissions.autoConnectEnabled) {
                return true;
            }
            
            // If global permission is denied and prompts are disabled
            if (!permissions.hasGlobalPermission && permissions.skipPermissionPrompts) {
                return false;
            }
        }

        const deviceInfo = device ? ` (${device.displayName})` : '';
        
        const message = `Mu 2 Editor will attempt to automatically connect to CircuitPython devices${deviceInfo} ` +
                       'for serial communication. This allows the extension to interact with your board\'s REPL and file system.\n\n' +
                       'Do you want to proceed with device connection capabilities?';

        const choice = await vscode.window.showInformationMessage(
            message,
            { modal: true },
            'Allow Device Connection',
            'Always Allow',
            'Never Allow',
            'Disable Device Features'
        );

        switch (choice) {
            case 'Allow Device Connection':
                return true;
            case 'Always Allow':
                await this.setDeviceConnectionPermissions({
                    hasGlobalPermission: true,
                    autoConnectEnabled: true,
                    lastPermissionCheck: new Date().toISOString()
                });
                return true;
            case 'Never Allow':
                await this.setDeviceConnectionPermissions({
                    hasGlobalPermission: false,
                    skipPermissionPrompts: true,
                    lastPermissionCheck: new Date().toISOString()
                });
                return false;
            case 'Disable Device Features':
            default:
                return false;
        }
    }

    /**
     * Check if device connections should be enabled based on global settings and user preferences
     */
    shouldEnableDeviceConnections(device?: IDevice): 'enabled' | 'disabled' | 'prompt' {
        const permissions = this.getDeviceConnectionPermissions();
        
        // If global permission is granted and auto-connect is enabled
        if (permissions.hasGlobalPermission && permissions.autoConnectEnabled) {
            return 'enabled';
        }
        
        // If global permission is denied or prompts are skipped
        if (!permissions.hasGlobalPermission && permissions.skipPermissionPrompts) {
            return 'disabled';
        }
        
        // Otherwise, prompt the user
        return 'prompt';
    }

    /**
     * Get detailed validation report as string
     */
    getValidationReport(result: WorkspaceValidationResult): string {
        const report = [`Mu 2 Workspace Validation Report`, '='.repeat(35)];
        
        report.push(`Valid Mu2 Workspace: ${result.isValidMu2Workspace ? '✓' : '✗'}`);
        report.push(`Has .vscode directory: ${result.hasVscodeDirectory ? '✓' : '✗'}`);
        report.push(`Has .vscode/mu2 directory: ${result.hasMu2Directory ? '✓' : '✗'}`);
        report.push(`Has board association: ${result.hasBoardAssociation ? '✓' : '✗'}`);
        report.push(`Has CIRCUITPY drive: ${result.hasCircuitPyDrive ? '✓' : '✗'}`);
        report.push(`Has Python files: ${result.hasPythonFiles ? '✓' : '✗'}`);
        report.push(`Is registered workspace: ${result.isRegisteredWorkspace ? '✓' : '✗'}`);

        if (result.errors.length > 0) {
            report.push('', 'Errors:', ...result.errors.map(e => `  • ${e}`));
        }

        if (result.warnings.length > 0) {
            report.push('', 'Warnings:', ...result.warnings.map(w => `  • ${w}`));
        }

        return report.join('\n');
    }

    dispose(): void {
        // Using unified logger - no manual disposal needed
    }
}