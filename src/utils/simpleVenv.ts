/**
 * Dead simple Python venv creation using VS Code APIs
 * Uses VS Code Tasks API and GlobalEnvironmentVariableCollection for proper integration
 */

import * as vscode from 'vscode';
import { getLogger } from './unifiedLogger';
import { getResourceLocator } from '../core/resourceLocator';

const logger = getLogger();

export async function ensureSimplePythonVenv(context: vscode.ExtensionContext): Promise<string | null> {
    const resourceLocator = getResourceLocator();
    const venvPath = resourceLocator.getVenvPath().fsPath;

    // Initialize venv ready state as not ready
    const { ReplViewProvider } = await import('../providers/views/replViewProvider');
    ReplViewProvider.setVenvReady(false);

    try {
        // Check if venv already exists using VS Code filesystem API
        const pythonExe = resourceLocator.getPythonExecutablePath();

        await vscode.workspace.fs.stat(pythonExe);

        // Already exists and working
        logger.info('VENV', `Python venv already exists at: ${venvPath}`);

        // Set venv ready state for REPL
        const { ReplViewProvider } = await import('../providers/views/replViewProvider');
        ReplViewProvider.setVenvReady(true);

        return venvPath;

    } catch {
        // Doesn't exist, create it using VS Code Terminal API
        logger.info('VENV', `Creating Python venv at: ${venvPath}`);

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Setting up Python environment for Mu Two Editor",
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: "Creating virtual environment..." });

            // Also send progress to REPL webview
            notifyReplVenvProgress(0, "Creating virtual environment...");

            try {
                // Create a simple task for venv creation
                const venvTask = new vscode.Task(
                    { type: 'shell' },
                    vscode.TaskScope.Global,
                    'Create Python Virtual Environment',
                    'Mu Two Extension',
                    new vscode.ShellExecution('python', ['-m', 'venv', venvPath])
                );
					 venvTask.presentationOptions = {
						  echo: true,
						  reveal: vscode.TaskRevealKind.Silent,
						  focus: false,
						  panel: vscode.TaskPanelKind.Shared,
						  showReuseMessage: true,
						  clear: false
					};

                // Execute the task and wait for completion
                notifyReplVenvProgress(25, "Starting Python venv creation task...");
                const execution = await vscode.tasks.executeTask(venvTask);

                return new Promise<string | null>((resolve) => {
                    const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
                        if (e.execution === execution) {
                            disposable.dispose();

                            // Check if venv was actually created by verifying the Python executable
                            const pythonExe = resourceLocator.getPythonExecutablePath();

                            vscode.workspace.fs.stat(pythonExe).then(
                                async () => {
                                    // Success - Python executable exists
                                    logger.info('VENV', `✅ Python venv created successfully at: ${venvPath}`);
                                    progress.report({ increment: 100, message: "Python environment ready!" });

                                    // Send final progress to REPL webview
                                    notifyReplVenvProgress(100, "Python environment ready!");

                                    // Set venv ready state for REPL
                                    const { ReplViewProvider } = await import('../providers/views/replViewProvider');
                                    ReplViewProvider.setVenvReady(true);
                                    resolve(venvPath);
                                },
                                () => {
                                    // Failed - Python executable doesn't exist
                                    logger.error('VENV', `❌ Python venv creation failed - executable not found`);
                                    vscode.window.showErrorMessage('Failed to create Python virtual environment');
                                    resolve(null);
                                }
                            );
                        }
                    });

                    // Fallback timeout in case task event doesn't fire
                    setTimeout(() => {
                        disposable.dispose();

                        // Check if venv was created anyway
                        const pythonExe = resourceLocator.getPythonExecutablePath();

                        vscode.workspace.fs.stat(pythonExe).then(
                            async () => {
                                logger.info('VENV', `✅ Python venv created successfully (detected via timeout): ${venvPath}`);
                                progress.report({ increment: 100, message: "Python environment ready!" });

                                // Send final progress to REPL webview
                                notifyReplVenvProgress(100, "Python environment ready!");

                                // Set venv ready state for REPL
                                const { ReplViewProvider } = await import('../providers/views/replViewProvider');
                                ReplViewProvider.setVenvReady(true);
                                resolve(venvPath);
                            },
                            () => {
                                logger.error('VENV', `❌ Python venv creation failed (timeout)`);
                                vscode.window.showErrorMessage('Failed to create Python virtual environment');
                                resolve(null);
                            }
                        );
                    }, 10000); // 10 second timeout
                });

            } catch (error) {
                logger.error('VENV', `❌ Python venv creation error:`, error);
                vscode.window.showErrorMessage(`Failed to create Python virtual environment: ${error}`);
                return null;
            }
        });
    }
}

// Status bar item for Python venv indicator
let pythonVenvStatusBar: vscode.StatusBarItem | undefined;

export function setPythonEnvironmentVariables(venvPath: string, context: vscode.ExtensionContext): void {
    // Use VS Code's GlobalEnvironmentVariableCollection instead of process.env
    const envCollection = context.environmentVariableCollection;

    // Clear any previous Python environment variables
    envCollection.clear();

    // Set VIRTUAL_ENV variable
    envCollection.replace('VIRTUAL_ENV', venvPath);

    // Set PATH to include Python venv binary directory
    const binPath = process.platform === 'win32'
        ? vscode.Uri.joinPath(vscode.Uri.file(venvPath), 'Scripts').fsPath
        : vscode.Uri.joinPath(vscode.Uri.file(venvPath), 'bin').fsPath;

    envCollection.prepend('PATH', binPath + (process.platform === 'win32' ? ';' : ':'));

    // Set a description for the environment variables
    envCollection.description = 'Mu Two Editor Python Virtual Environment';

    // For PowerShell, try to set VIRTUAL_ENV_PROMPT for better shell prompt indication
    if (process.platform === 'win32') {
        envCollection.replace('VIRTUAL_ENV_PROMPT', '(venv) ');
    }

    // Create status bar indicator like Python extension
    if (!pythonVenvStatusBar) {
        pythonVenvStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        context.subscriptions.push(pythonVenvStatusBar);
    }

    pythonVenvStatusBar.text = '$(python) mu2:venv';
    pythonVenvStatusBar.tooltip = `Mu Two Editor Python Virtual Environment\n${venvPath}`;
    pythonVenvStatusBar.show();

    logger.info('VENV', `✅ Python environment variables set using VS Code API for venv: ${venvPath}`);
    logger.info('VENV', `   VIRTUAL_ENV: ${venvPath}`);
    logger.info('VENV', `   PATH prepended: ${binPath}`);
    logger.info('VENV', `   Status bar indicator: $(python) mu2:venv`);

    // Venv ready state is already set above - REPL can proceed immediately
    logger.info('VENV', '✅ Set venv ready state - REPL can proceed immediately');

    // Also try to notify REPL webview if it's already available
    notifyReplVenvReady();
}

/**
 * Notify the REPL webview that the virtual environment is ready
 */
function notifyReplVenvReady(): void {
    try {
        // Get the REPL webview provider from component manager
        const { webviewViewProvider } = require('../core/componentManager');

        if (webviewViewProvider && typeof webviewViewProvider.sendMessage === 'function') {
            webviewViewProvider.sendMessage({
                type: 'venv_ready',
                data: {}
            });
            logger.info('VENV', 'Sent venv_ready message to REPL webview');
        } else {
            logger.warn('VENV', 'REPL webview provider not available for venv_ready notification');
        }
    } catch (error) {
        logger.warn('VENV', 'Failed to notify REPL webview of venv ready:', error);
    }
}

/**
 * Notify the REPL webview of Python virtual environment setup progress
 */
function notifyReplVenvProgress(progress: number, message: string): void {
    try {
        // Get the REPL webview provider from component manager
        const { webviewViewProvider } = require('../core/componentManager');

        if (webviewViewProvider && typeof webviewViewProvider.sendMessage === 'function') {
            webviewViewProvider.sendMessage({
                type: 'venv_progress',
                data: {
                    progress: progress,
                    message: message
                }
            });
            logger.info('VENV', `Sent venv_progress: ${progress}% - ${message}`);
        } else {
            logger.debug('VENV', 'REPL webview provider not available for progress notification');
        }
    } catch (error) {
        logger.debug('VENV', 'Failed to notify REPL webview of venv progress:', error);
    }
}