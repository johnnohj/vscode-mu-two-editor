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
                // Create a simple task for venv creation with pip included
                const venvTask = new vscode.Task(
                    { type: 'shell' },
                    vscode.TaskScope.Global,
                    'Create Python Virtual Environment',
                    'Mu Two Extension',
                    new vscode.ShellExecution('python', ['-m', 'venv', '--upgrade-deps', venvPath])
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
                                    progress.report({ increment: 40, message: "Installing dependencies..." });
                                    notifyReplVenvProgress(40, "Installing dependencies...");

                                    // Install requirements.txt
                                    const installed = await installRequirements(pythonExe.fsPath, context);

                                    if (installed) {
                                        progress.report({ increment: 100, message: "Python environment ready!" });
                                        notifyReplVenvProgress(100, "Python environment ready!");
                                        logger.info('VENV', `✅ Dependencies installed successfully`);
                                    } else {
                                        progress.report({ increment: 100, message: "Python environment ready (check logs)" });
                                        notifyReplVenvProgress(100, "Python environment ready");
                                        logger.warn('VENV', `⚠️ Some dependencies may not have installed - check logs`);
                                    }

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
                    // Increased to 60 seconds for slow systems or when --upgrade-deps downloads pip
                    setTimeout(() => {
                        disposable.dispose();

                        // Check if venv was created anyway
                        const pythonExe = resourceLocator.getPythonExecutablePath();

                        vscode.workspace.fs.stat(pythonExe).then(
                            async () => {
                                logger.info('VENV', `✅ Python venv created successfully (detected via timeout): ${venvPath}`);
                                progress.report({ increment: 40, message: "Installing dependencies..." });
                                notifyReplVenvProgress(40, "Installing dependencies...");

                                // Install requirements.txt
                                const installed = await installRequirements(pythonExe.fsPath, context);

                                if (installed) {
                                    progress.report({ increment: 100, message: "Python environment ready!" });
                                    notifyReplVenvProgress(100, "Python environment ready!");
                                    logger.info('VENV', `✅ Dependencies installed successfully`);
                                } else {
                                    progress.report({ increment: 100, message: "Python environment ready (check logs)" });
                                    notifyReplVenvProgress(100, "Python environment ready");
                                    logger.warn('VENV', `⚠️ Some dependencies may not have installed - check logs`);
                                }

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
                    }, 60000); // 60 second timeout for venv creation with --upgrade-deps
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

/**
 * Install requirements from extension's requirements.txt file
 */
async function installRequirements(pythonPath: string, context: vscode.ExtensionContext): Promise<boolean> {
    try {
        const resourceLocator = getResourceLocator();

        // Get requirements.txt from extension's data directory
        // Try multiple locations for dev vs packaged extension:
        // 1. dist/data/requirements.txt (production build)
        // 2. data/requirements.txt (packaged extension)
        // 3. src/data/requirements.txt (development mode)
        let requirementsPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'data', 'requirements.txt');

        logger.info('VENV', `Checking for requirements.txt at: ${requirementsPath.fsPath}`);

        try {
            await vscode.workspace.fs.stat(requirementsPath);
            logger.info('VENV', `✅ Found requirements.txt at: ${requirementsPath.fsPath}`);
        } catch (error) {
            logger.warn('VENV', `⚠️ requirements.txt not found at ${requirementsPath.fsPath}`);
            logger.info('VENV', `Trying alternate location: data/requirements.txt`);
            // If dist/data doesn't exist, try just data/ (packaged extension)
            requirementsPath = vscode.Uri.joinPath(context.extensionUri, 'data', 'requirements.txt');

            try {
                await vscode.workspace.fs.stat(requirementsPath);
                logger.info('VENV', `✅ Found requirements.txt at alternate location: ${requirementsPath.fsPath}`);
            } catch (altError) {
                logger.warn('VENV', `⚠️ requirements.txt not found at ${requirementsPath.fsPath}`);
                logger.info('VENV', `Trying development location: src/data/requirements.txt`);
                // If data/ doesn't exist, try src/data/ (development mode)
                requirementsPath = vscode.Uri.joinPath(context.extensionUri, 'src', 'data', 'requirements.txt');

                try {
                    await vscode.workspace.fs.stat(requirementsPath);
                    logger.info('VENV', `✅ Found requirements.txt at development location: ${requirementsPath.fsPath}`);
                } catch (devError) {
                    logger.error('VENV', `❌ requirements.txt not found at any location`);
                    logger.error('VENV', `   Tried: dist/data, data, src/data`);
                    throw new Error(`requirements.txt not found in dist/data, data, or src/data directories`);
                }
            }
        }

        logger.info('VENV', `Installing requirements from: ${requirementsPath.fsPath}`);

        // Use child_process.spawn for reliable completion detection
        // Tasks API onDidEndTaskProcess event doesn't always fire reliably
        return new Promise<boolean>((resolve) => {
            const { spawn } = require('child_process');
            const childProcess = spawn(pythonPath, ['-m', 'pip', 'install', '-r', requirementsPath.fsPath], {
                stdio: 'pipe',
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            childProcess.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                stdout += output;
                // Log progress for long-running installs
                if (output.includes('Collecting') || output.includes('Installing')) {
                    logger.debug('VENV', output.trim());
                }
            });

            childProcess.stderr?.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            childProcess.on('close', (code: number) => {
                if (code === 0) {
                    logger.info('VENV', `✅ Requirements installed successfully`);
                    resolve(true);
                } else {
                    logger.warn('VENV', `⚠️ Requirements installation completed with exit code: ${code}`);
                    logger.warn('VENV', `   Error output: ${stderr}`);
                    resolve(false);
                }
            });

            childProcess.on('error', (error: Error) => {
                logger.error('VENV', `❌ Failed to spawn pip install:`, error);
                resolve(false);
            });
        });
    } catch (error) {
        logger.error('VENV', `❌ Failed to install requirements:`, error);
        return false;
    }
}