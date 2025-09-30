import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { getResourceLocator } from '../core/resourceLocator';
import { getDevLogger } from '../utils/devLogger';
import { withProgress } from '../utils/progressHelper';
import { CircuitPythonBundleManager } from '../workspace/integration/bundleManager';

const logger = getLogger();

export interface PythonEnvironmentInfo {
	path: string;
	pythonPath: string;
	isValid: boolean;
	installedPackages: string[];
}

/**
 * REFACTORED PythonEnvManager - Focus on Detection & VS Code Integration Only
 *
 * This class now serves as a lightweight detector and integrator for Python environments
 * created by the MuTwoTerminalProfile. It no longer creates venvs or installs packages.
 *
 * Responsibilities:
 * - Detect existing Python virtual environments
 * - Validate Python environment structure
 * - Configure VS Code Python extension to use detected environment
 * - Provide environment info to other extension components
 *
 * NOT Responsible For (handled by MuTwoTerminalProfile):
 * - Creating virtual environments
 * - Installing Python packages
 * - System Python operations
 */
export class PythonEnvManager {
	private context: vscode.ExtensionContext;
	private muTwoEnvPath?: string;
	private bundleManager?: CircuitPythonBundleManager;
	private readonly expectedPackages = [
		'setuptools',
		'circup',
		'pyserial'
	];


	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	/**
	 * REFACTORED: Only detect and configure existing Python environments
	 * Does NOT create environments - that's handled by MuTwoTerminalProfile
	 */
	async initialize(): Promise<void> {
		const devLogger = getDevLogger();

		try {
			await withProgress('Detecting Python Environment', async (progress) => {
				devLogger.python('Detecting existing Python environment...');
				progress.report({ message: 'Scanning for Python installations' });

				// Try to detect environment in standard locations
				const detectedPath = await this.detectExistingEnvironment();

				if (detectedPath && await this.validateEnvironment(detectedPath)) {
					progress.report({ message: 'Validating environment', increment: 40 });

					this.muTwoEnvPath = detectedPath;
					await this.context.globalState.update('muTwo.pythonEnvPath', detectedPath);
					devLogger.python(`Valid Python environment detected: ${detectedPath}`);

					// Configure VS Code Python extension to use detected environment
					if (vscode.workspace.workspaceFolders) {
						progress.report({ message: 'Configuring VS Code integration', increment: 30 });
						await this.configureVSCodePythonExtension();
					}

					// Optional: Verify expected packages are present (info only)
					progress.report({ message: 'Checking installed packages', increment: 20 });
					await this.reportPackageStatus();

					// Initialize and verify CircuitPython bundle
					progress.report({ message: 'Initializing bundle manager', increment: 10 });
					await this.initializeBundleManager();

				} else {
					devLogger.python('No valid Python environment detected. Extension will run with limited Python features.');
					this.muTwoEnvPath = undefined;
				}
			});

		} catch (error) {
			devLogger.error('PYTHON', `Python environment detection failed`, error);
			// Don't throw - extension should continue without Python features
			this.muTwoEnvPath = undefined;
		}
	}

	/**
	 * Get the current Python path
	 */
	getCurrentPythonPath(): string | undefined {
		return this.muTwoEnvPath;
	}

	/**
	 * Get the bundle manager instance
	 */
	getBundleManager(): CircuitPythonBundleManager | undefined {
		return this.bundleManager;
	}

	/**
	 * Get Python environment information
	 */
	async getCurrentEnvironmentInfo(): Promise<PythonEnvironmentInfo | undefined> {
		if (!this.muTwoEnvPath) {
			return undefined;
		}

		try {
			const isValid = await this.validateEnvironment(this.muTwoEnvPath);
			return {
				path: this.muTwoEnvPath,
				pythonPath: this.muTwoEnvPath,
				isValid,
				installedPackages: [] // Could be populated if needed
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * REFACTORED: Detect existing Python environment in standard locations
	 */
	private async detectExistingEnvironment(): Promise<string | undefined> {
		// Check cached path first
		const cachedPath = this.context.globalState.get<string>('muTwo.pythonEnvPath');
		if (cachedPath) {
			logger.info('PYTHON_ENV', `Checking cached Python environment: ${cachedPath}`);
			if (await this.validateEnvironment(cachedPath)) {
				return cachedPath;
			} else {
				logger.warn('PYTHON_ENV', 'Cached Python environment is invalid, clearing cache');
				await this.context.globalState.update('muTwo.pythonEnvPath', undefined);
			}
		}

		// Check standard locations where MuTwoTerminalProfile creates venvs
		const resourceLocator = getResourceLocator();
		const standardPaths = [
			resourceLocator.getVenvPath().fsPath,
		];

		for (const envPath of standardPaths) {
			logger.info('PYTHON_ENV', `Checking standard location: ${envPath}`);
			const isValid = await this.validateEnvironment(envPath);
			logger.info('PYTHON_ENV', `Validation result for ${envPath}: ${isValid}`);
			if (isValid) {
				logger.info('PYTHON_ENV', `Found valid Python environment: ${envPath}`);
				return envPath;
			}
		}

		logger.warn('PYTHON_ENV', 'No valid Python environment found in standard locations');
		return undefined;
	}

	/**
	 * REFACTORED: Configure VS Code Python extension to use detected environment
	 */
	private async configureVSCodePythonExtension(): Promise<void> {
		if (!this.muTwoEnvPath) {
			logger.warn('PYTHON_ENV', 'Cannot configure VS Code Python extension: no environment detected');
			return;
		}

		try {
			const pythonPath = this.getPythonExecutablePath();
			logger.info('PYTHON_ENV', `Configuring VS Code to use Python environment: ${pythonPath}`);

			// Set workspace Python interpreter (silent configuration)
			const config = vscode.workspace.getConfiguration('python');
			await config.update(
				'defaultInterpreterPath',
				pythonPath,
				vscode.ConfigurationTarget.Workspace
			);

			logger.info('PYTHON_ENV', 'VS Code Python extension configured successfully');

		} catch (error) {
			logger.error('PYTHON_ENV', `Failed to configure VS Code Python extension: ${error}`);
			// Don't throw - extension can continue without Python integration
		}
	}

	private getPythonExecutablePath(): string {
		if (!this.muTwoEnvPath) {
			throw new Error('Environment path not set');
		}

		const isWindows = process.platform === 'win32';
		const envUri = vscode.Uri.file(this.muTwoEnvPath);
		const binDir = isWindows ? 'Scripts' : 'bin';
		const executable = isWindows ? 'python.exe' : 'python';

		return vscode.Uri.joinPath(envUri, binDir, executable).fsPath;
	}

	private getPipExecutablePath(): string {
		if (!this.muTwoEnvPath) {
			throw new Error('Environment path not set');
		}

		const isWindows = process.platform === 'win32';
		const envUri = vscode.Uri.file(this.muTwoEnvPath);
		const binDir = isWindows ? 'Scripts' : 'bin';
		const executable = isWindows ? 'pip.exe' : 'pip';

		return vscode.Uri.joinPath(envUri, binDir, executable).fsPath;
	}

	/**
	 * REFACTORED: Report on package status (info only - no installation)
	 */
	private async reportPackageStatus(): Promise<void> {
		if (!this.muTwoEnvPath) {
			return;
		}

		try {
			const installedPackages = await this.getInstalledPackageNames();
			const missingPackages = this.expectedPackages.filter(pkg =>
				!installedPackages.some(installed =>
					installed.toLowerCase() === pkg.toLowerCase()
				)
			);

			if (missingPackages.length === 0) {
				logger.info('PYTHON_ENV', 'All expected packages are installed');
			} else {
				logger.warn('PYTHON_ENV', `Missing expected packages: ${missingPackages.join(', ')}`);
				logger.info('PYTHON_ENV', 'Package installation is handled by MuTwoTerminalProfile during environment creation');
			}

			logger.info('PYTHON_ENV', `Detected packages: ${installedPackages.join(', ')}`);

		} catch (error) {
			logger.warn('PYTHON_ENV', `Could not check package status: ${error}`);
		}
	}

	/**
	 * Get installed package names for reporting (read-only operation)
	 */
	private async getInstalledPackageNames(): Promise<string[]> {
		try {
			const pipPath = this.getPipExecutablePath();

			// Use a simple task-based approach for pip list
			const result = await this.executeSimpleCommandForOutput(pipPath, ['list', '--format=freeze']);

			// Parse pip freeze output: "package-name==version"
			return result
				.split('\n')
				.filter(line => line.trim() && line.includes('=='))
				.map(line => line.split('==')[0].trim())
				.filter(pkg => pkg.length > 0);
		} catch (error) {
			logger.warn('PYTHON_ENV', `Failed to get installed package names: ${error}`);
			return [];
		}
	}

	/**
	 * REFACTORED: Simple command execution for read-only operations only
	 * No longer handles package installation - that's done by MuTwoTerminalProfile
	 */
	private async executeSimpleCommandForOutput(command: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const { spawn } = require('child_process');
			const childProcess = spawn(command, args, {
				stdio: 'pipe',
				env: {
					...process.env,
					PATH: process.env.PATH // Only keep PATH for executable resolution
				}
			});

			let stdout = '';
			let stderr = '';

			childProcess.stdout?.on('data', (data: any) => {
				stdout += data.toString();
			});

			childProcess.stderr?.on('data', (data: any) => {
				stderr += data.toString();
			});

			childProcess.on('close', (code: number) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`Command failed with code ${code}: ${stderr}`));
				}
			});

			childProcess.on('error', (error: any) => {
				reject(error);
			});

			// Timeout handling for read-only operations
			setTimeout(() => {
				childProcess.kill();
				reject(new Error('Command execution timeout (30 seconds)'));
			}, 30000); // Shorter timeout for simple queries
		});
	}

	private async validateEnvironment(envPath: string): Promise<boolean> {
		try {
			logger.info('PYTHON_ENV', `Validating environment at: ${envPath}`);

			// Check if environment directory exists
			const envUri = vscode.Uri.file(envPath);
			try {
				const envStat = await vscode.workspace.fs.stat(envUri);
				logger.info('PYTHON_ENV', `Environment directory exists: ${envStat.type === vscode.FileType.Directory}`);
			} catch (error) {
				logger.warn('PYTHON_ENV', `Environment directory does not exist: ${envPath}`);
				return false;
			}

			// Check if Python executable exists
			const isWindows = process.platform === 'win32';
			const binDir = isWindows ? 'Scripts' : 'bin';
			const executable = isWindows ? 'python.exe' : 'python';
			const pythonUri = vscode.Uri.joinPath(envUri, binDir, executable);

			logger.info('PYTHON_ENV', `Looking for Python executable at: ${pythonUri.fsPath}`);

			try {
				await vscode.workspace.fs.stat(pythonUri);
				logger.info('PYTHON_ENV', `Python executable found at: ${pythonUri.fsPath}`);
			} catch (error) {
				logger.warn('PYTHON_ENV', `Python executable not found at: ${pythonUri.fsPath}`);
				return false;
			}

			// Try to run Python to ensure it works
			try {
				const versionOutput = await this.executeSimpleCommandForOutput(pythonUri.fsPath, ['--version']);
				logger.info('PYTHON_ENV', `Python version check successful: ${versionOutput.trim()}`);
			} catch (error) {
				logger.warn('PYTHON_ENV', `Python version check failed: ${error}`);
				return false;
			}

			logger.info('PYTHON_ENV', `Environment validation successful: ${envPath}`);
			return true;
		} catch (error) {
			logger.error('PYTHON_ENV', `Environment validation error: ${error}`);
			return false;
		}
	}

	/**
	 * REFACTORED: Get environment info for external consumption
	 * Now focuses on reporting detected environment information
	 */
	async getEnvironmentInfo(): Promise<PythonEnvironmentInfo | null> {
		if (!this.muTwoEnvPath) {
			return null;
		}

		try {
			const pythonPath = this.getPythonExecutablePath();
			const isValid = await this.validateEnvironment(this.muTwoEnvPath);
			const installedPackages = await this.getDetectedPackages();

			return {
				path: this.muTwoEnvPath,
				pythonPath,
				isValid,
				installedPackages
			};
		} catch (error) {
			logger.warn('PYTHON_ENV', `Failed to get environment info: ${error}`);
			return null;
		}
	}

	/**
	 * Get detected packages that match our expected packages
	 */
	private async getDetectedPackages(): Promise<string[]> {
		try {
			const allInstalled = await this.getInstalledPackageNames();

			// Filter to only return packages that are in our expected list
			return allInstalled.filter(pkg =>
				this.expectedPackages.some(expected =>
					expected.toLowerCase() === pkg.toLowerCase()
				)
			);
		} catch {
			return [];
		}
	}

	/**
	 * Initialize and verify CircuitPython bundle
	 */
	private async initializeBundleManager(): Promise<void> {
		if (!this.muTwoEnvPath) {
			logger.warn('BUNDLE', 'Cannot initialize bundle manager: Python environment path not available');
			return;
		}

		try {
			logger.info('BUNDLE', 'Initializing CircuitPython bundle manager...');

			// Create bundle manager instance
			this.bundleManager = new CircuitPythonBundleManager(this.context);

			// Set Python path for bundle operations
			if (this.muTwoEnvPath) {
				const pythonPath = this.getCurrentPythonPath();
				if (pythonPath) {
					this.bundleManager.setPythonPath(pythonPath);
				}
			}

			await this.bundleManager.initialize();

			// Check if bundle needs setup (non-blocking)
			const needsSetup = await this.bundleManager.shouldRefreshBundle();

			if (needsSetup) {
				logger.info('BUNDLE', 'CircuitPython bundle needs setup - will prompt user when Library Manager is accessed');

				// Show non-intrusive message
				const setupPromise = vscode.window.showInformationMessage(
					'CircuitPython library bundle is not set up. Libraries will be available after setup.',
					'Setup Now',
					'Setup Later'
				).then(choice => {
					if (choice === 'Setup Now') {
						return this.bundleManager.downloadAndInstallBundle().then(success => {
							if (success) {
								vscode.window.showInformationMessage('CircuitPython bundle setup complete! All libraries are now available.');
								logger.info('BUNDLE', 'CircuitPython bundle setup completed successfully');
							} else {
								vscode.window.showWarningMessage('Bundle setup failed. You can retry from the Library Manager.');
								logger.warn('BUNDLE', 'CircuitPython bundle setup failed');
							}
						});
					} else {
						logger.info('BUNDLE', 'User chose to defer bundle setup');
					}
				});

				// Don't wait for user response - continue activation
				setupPromise.catch(error => {
					logger.warn('BUNDLE', `Bundle setup promise failed: ${error}`);
				});
			} else {
				logger.info('BUNDLE', 'CircuitPython bundle is up to date');
			}

		} catch (error) {
			logger.error('BUNDLE', `Failed to initialize bundle manager: ${error}`);
			// Don't show error to user as this is not critical for core functionality
		}
	}

	/**
	 * REMOVED: Package update functionality
	 * Package installation/updates are now handled by MuTwoTerminalProfile with proper safety checks
	 */

	dispose(): void {
		// Minimal cleanup for refactored version
		logger.info('PYTHON_ENV', 'PythonEnvManager disposed');
	}
}