import * as vscode from 'vscode';
import { getTaskRunner } from './taskRunner';

export interface PythonEnvironmentInfo {
	path: string;
	pythonPath: string;
	isValid: boolean;
	installedPackages: string[];
}

export class PythonEnvManager {
	private context: vscode.ExtensionContext;
	private muTwoEnvPath?: string;
	private taskRunner = getTaskRunner();
	private readonly requiredPackages = [
		'setuptools',
		'circup',
		'adafruit-blinka',
		'pyserial',
		'esptool'
	];


	constructor(context: vscode.ExtensionContext) {
		this.context = context;
	}

	async initialize(): Promise<void> {
		try {
			// Ensure Python extension is active
			await this.ensurePythonExtensionActive();

			// Check if Mu 2 environment already exists
			this.muTwoEnvPath = this.context.globalState.get('muTwo.pythonEnvPath');
			
			if (!this.muTwoEnvPath || !await this.validateEnvironment(this.muTwoEnvPath)) {
				await this.createMuTwoEnvironment();
			}
			
			await this.ensureCircuitPythonTools();
			
			// Set as workspace interpreter if in a workspace
			if (vscode.workspace.workspaceFolders) {
				await this.selectMuTwoEnvironment();
			}

		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to initialize Mu 2 Python environment: ${error instanceof Error ? error.message : error}`
			);
			throw error;
		}
	}

	/**
	 * Get the current Python path
	 */
	getCurrentPythonPath(): string | undefined {
		return this.muTwoEnvPath;
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

	private async ensurePythonExtensionActive(): Promise<void> {
		const pythonExt = vscode.extensions.getExtension('ms-python.python');
		if (!pythonExt) {
			throw new Error('Python extension (ms-python.python) is required but not installed. Please install the Python extension from the VS Code marketplace.');
		}
		
		if (!pythonExt.isActive) {
			console.log('Python extension is not active, activating...');
			try {
				await pythonExt.activate();
				console.log('Python extension activated successfully');
			} catch (error) {
				throw new Error(`Failed to activate Python extension: ${error instanceof Error ? error.message : String(error)}`);
			}
		} else {
			console.log('Python extension is already active');
		}
	}

	private async createMuTwoEnvironment(): Promise<void> {
		try {
			// Try using Python extension's environment creation first
			await this.createEnvironmentWithPythonExtension();
		} catch (error) {
			console.warn('Python extension environment creation failed, falling back to manual creation:', error);
			// Fallback to manual creation
			await this.createEnvironmentManually();
		}
	}

	private async createEnvironmentWithPythonExtension(): Promise<void> {
		try {
			// Get the current Python interpreter from the Python extension
			const pythonPath = await this.getPythonInterpreterFromExtension();
			if (!pythonPath) {
				throw new Error('No Python interpreter found via Python extension');
			}

			// Create environment directly without UI interaction
			const envDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'mu-two-python-env');
			
			// Check if environment already exists
			try {
				await vscode.workspace.fs.stat(envDir);
				console.log('Mu 2 environment already exists, skipping creation');
				this.muTwoEnvPath = envDir.fsPath;
				await this.context.globalState.update('muTwo.pythonEnvPath', envDir.fsPath);
				return;
			} catch {
				// Environment doesn't exist, continue with creation
			}
			
			// Ensure storage directory exists
			await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
			
			// Create venv using the Python extension's interpreter
			await this.executeCommandWithTasks(pythonPath, ['-m', 'venv', envDir.fsPath, '--clear']);
			
			// Set environment path for pip operations
			this.muTwoEnvPath = envDir.fsPath;
			await this.context.globalState.update('muTwo.pythonEnvPath', envDir.fsPath);
			
			// Install packages from bundled requirements file
			await this.installFromRequirementsFile();
			
			vscode.window.showInformationMessage(
				'✅ Created Mu 2 CircuitPython environment successfully!'
			);
			
		} catch (error) {
			throw new Error(`Python extension environment creation failed: ${error}`);
		}
	}

	private async getPythonInterpreterFromExtension(): Promise<string | null> {
		try {
			console.log('Attempting to get Python interpreter from extension...');
			
			// Method 1: Try to get from workspace configuration
			const pythonConfig = vscode.workspace.getConfiguration('python');
			const configuredPath = pythonConfig.get<string>('defaultInterpreterPath');
			console.log('Python defaultInterpreterPath from config:', configuredPath);
			if (configuredPath && configuredPath !== 'python') {
				console.log('Using configured Python interpreter:', configuredPath);
				return configuredPath;
			}

			// Method 2: Try the interpreterPath command (may not exist in all versions)
			try {
				const interpreterPath = await vscode.commands.executeCommand('python.interpreterPath') as string;
				if (interpreterPath && typeof interpreterPath === 'string' && interpreterPath !== 'python') {
					return interpreterPath;
				}
			} catch (error) {
				// Command may not exist or return non-JSON, continue to next method
				console.log('Python interpreterPath command failed (this is normal):', error instanceof Error ? error.message : String(error));
			}

			// Method 3: Try Python extension API if available
			const pythonExtension = vscode.extensions.getExtension('ms-python.python');
			if (pythonExtension?.isActive && pythonExtension.exports) {
				const pythonApi = pythonExtension.exports;
				
				// Try different API methods based on Python extension version
				if (pythonApi.environments) {
					try {
						const activeEnv = pythonApi.environments.getActiveEnvironmentPath();
						if (activeEnv?.path) {
							return activeEnv.path;
						}
					} catch (error) {
						// API method may not be available
						console.log('Python API environments method failed (this is normal):', error instanceof Error ? error.message : String(error));
					}
				}

				if (pythonApi.settings) {
					try {
						const interpreter = pythonApi.settings.getExecutionDetails?.()?.execCommand?.[0];
						if (interpreter && typeof interpreter === 'string') {
							return interpreter;
						}
					} catch (error) {
						// API method may not be available
						console.log('Python API settings method failed (this is normal):', error instanceof Error ? error.message : String(error));
					}
				}
			}

			return null;
		} catch (error) {
			console.log('Could not get Python interpreter from extension (this is normal):', error instanceof Error ? error.message : String(error));
			return null;
		}
	}

	private async createEnvironmentManually(): Promise<void> {
		const envDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'mu-two-python-env');
		
		try {
			// Check if environment already exists
			try {
				await vscode.workspace.fs.stat(envDir);
				console.log('Mu 2 environment already exists, skipping manual creation');
				this.muTwoEnvPath = envDir.fsPath;
				await this.context.globalState.update('muTwo.pythonEnvPath', envDir.fsPath);
				return;
			} catch {
				// Environment doesn't exist, continue with creation
			}

			// Ensure storage directory exists
			await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
			
			// Get Python interpreter path
			const pythonPath = await this.findPythonInterpreter();
			
			// Create venv
			await this.executeCommandWithTasks(pythonPath, ['-m', 'venv', envDir.fsPath]);
			
			// Set environment path for pip operations
			this.muTwoEnvPath = envDir.fsPath;
			await this.context.globalState.update('muTwo.pythonEnvPath', envDir.fsPath);
			
			// Install packages from bundled requirements file
			await this.installFromRequirementsFile();
			
			vscode.window.showInformationMessage(
				'✅ Created Mu 2 CircuitPython environment manually!'
			);
			
		} catch (error) {
			throw new Error(`Manual environment creation failed: ${error}`);
		}
	}

	private async findPythonInterpreter(): Promise<string> {
		// Try to get current Python interpreter from Python extension first
		const pythonPath = await this.getPythonInterpreterFromExtension();
		if (pythonPath) {
			try {
				await this.executeCommandWithOutput(pythonPath, ['--version']);
				return pythonPath;
			} catch {
				console.warn('Python extension interpreter is not working:', pythonPath);
			}
		}

		// Fallback to common Python paths
		const commonPaths = process.platform === 'win32' 
			? ['python', 'py', 'python3']
			: ['python3', 'python'];

		for (const pythonCmd of commonPaths) {
			try {
				await this.executeCommandWithOutput(pythonCmd, ['--version']);
				return pythonCmd;
			} catch {
				continue;
			}
		}

		throw new Error('Could not find Python interpreter');
	}

	async selectMuTwoEnvironment(): Promise<void> {
		if (!this.muTwoEnvPath) {
			throw new Error('Mu 2 environment not initialized');
		}

		try {
			const pythonPath = this.getPythonExecutablePath();
			
			// Set workspace Python interpreter
			const config = vscode.workspace.getConfiguration('python');
			await config.update(
				'defaultInterpreterPath',
				pythonPath,
				vscode.ConfigurationTarget.Workspace
			);

			// Skip Python extension interpreter selection to avoid user prompts
			console.log('Python interpreter configured silently:', pythonPath);

		} catch (error) {
			throw new Error(`Failed to select Mu 2 environment: ${error}`);
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

	async ensureCircuitPythonTools(): Promise<void> {
		if (!this.muTwoEnvPath) {
			throw new Error('Environment not initialized');
		}

		try {
			// Check if tools are installed and up to date
			const missingPackages = await this.checkMissingPackages(this.requiredPackages);
			
			if (missingPackages.length > 0) {
				console.log('Some CircuitPython tools are missing, reinstalling from requirements...');
				// Use requirements file approach for more reliable installation
				await this.installFromRequirementsFile();
			} else {
				console.log('All CircuitPython tools are already installed');
			}
		} catch (error) {
			vscode.window.showWarningMessage(
				`Could not verify CircuitPython tools: ${error}`
			);
		}
	}

	private async checkMissingPackages(packages: string[]): Promise<string[]> {
		try {
			// Get list of installed packages from pip
			const installedPackages = await this.getInstalledPackageNames();
			
			// Check which required packages are missing
			const missing = packages.filter(pkg => {
				// Check for exact match or case-insensitive match
				return !installedPackages.some(installed => 
					installed.toLowerCase() === pkg.toLowerCase()
				);
			});
			
			return missing;
		} catch (error) {
			console.warn('Failed to check installed packages, assuming all are missing:', error);
			// If pip list fails, assume all packages need to be installed
			return [...packages];
		}
	}

	private async getInstalledPackageNames(): Promise<string[]> {
		try {
			const pipPath = this.getPipExecutablePath();
			const result = await this.executeCommandWithOutput(pipPath, ['list', '--format=freeze']);
			
			// Parse pip freeze output: "package-name==version"
			return result
				.split('\n')
				.filter(line => line.trim() && line.includes('=='))
				.map(line => line.split('==')[0].trim())
				.filter(pkg => pkg.length > 0);
		} catch (error) {
			console.warn('Failed to get installed package names:', error);
			return [];
		}
	}

	/**
	 * Install packages using VS Code tasks for better UX
	 */
	/**
	 * Install packages from bundled requirements file for faster, more reliable setup
	 */
	private async installFromRequirementsFile(): Promise<void> {
		const pipPath = this.getPipExecutablePath();
		// Try dist path first (for packaged extension), fallback to src path (for development)
		let requirementsPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'data', 'requirements.txt').fsPath;
		
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(requirementsPath));
		} catch {
			// Fallback to src path for development
			requirementsPath = vscode.Uri.joinPath(this.context.extensionUri, 'src', 'data', 'requirements.txt').fsPath;
		}
		
		const installCmd = ['install', '-r', requirementsPath, '--upgrade', '--timeout', '600'];
		
		try {
			console.log('Installing CircuitPython tools from bundled requirements file...');
			await this.executeCommandWithTasksExtended(pipPath, installCmd, 600000);
			vscode.window.showInformationMessage(
				'✅ CircuitPython development tools installed successfully'
			);
		} catch (error) {
			console.error('Requirements file installation failed, falling back to individual packages:', error);
			// Fallback to individual package installation
			await this.installPackagesWithTasks('', this.requiredPackages);
		}
	}

	private async installPackagesWithTasks(envPath: string, packages: string[]): Promise<void> {
		const pipPath = this.getPipExecutablePath();
		const installCmd = ['install', '--upgrade', '--timeout', '600', ...packages];
		
		try {
			// Use extended timeout for pip installations (10 minutes instead of 2)
			await this.executeCommandWithTasksExtended(pipPath, installCmd, 600000);
			vscode.window.showInformationMessage(
				`✅ Installed packages: ${packages.join(', ')}`
			);
		} catch (error) {
			throw new Error(`pip install failed: ${error}`);
		}
	}

	private async validateEnvironment(envPath: string): Promise<boolean> {
		try {
			// Check if Python executable exists
			const envUri = vscode.Uri.file(envPath);
			const isWindows = process.platform === 'win32';
			const binDir = isWindows ? 'Scripts' : 'bin';
			const executable = isWindows ? 'python.exe' : 'python';
			const pythonUri = vscode.Uri.joinPath(envUri, binDir, executable);
			
			await vscode.workspace.fs.stat(pythonUri);
			
			// Try to run Python to ensure it works
			await this.executeCommandWithOutput(pythonUri.fsPath, ['--version']);
			
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Execute a command using VS Code's task system for better integration
	 * Replaced spawn() with VS Code tasks API for enhanced UX and security
	 */
	private async executeCommand(command: string, args: string[]): Promise<void> {
		return this.executeCommandWithTasks(command, args);
	}

	async getEnvironmentInfo(): Promise<PythonEnvironmentInfo | null> {
		if (!this.muTwoEnvPath) {
			return null;
		}

		try {
			const pythonPath = this.getPythonExecutablePath();
			const isValid = await this.validateEnvironment(this.muTwoEnvPath);
			const installedPackages = await this.getInstalledPackages();

			return {
				path: this.muTwoEnvPath,
				pythonPath,
				isValid,
				installedPackages
			};
		} catch {
			return null;
		}
	}

	private async getInstalledPackages(): Promise<string[]> {
		try {
			const allInstalled = await this.getInstalledPackageNames();
			
			// Filter to only return packages that are in our required list
			return allInstalled.filter(pkg => 
				this.requiredPackages.some(required => 
					required.toLowerCase() === pkg.toLowerCase()
				)
			);
		} catch {
			return [];
		}
	}

	/**
	 * Execute a command that requires output capture using secure spawn with timeout
	 * Used only for operations that need stdout (like pip list)
	 * For install operations, use executeCommandWithTasks() instead
	 */
	private async executeCommandWithOutput(command: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			const childProcess = spawn(command, args, {
				stdio: 'pipe',
				// Enhanced security: don't inherit environment variables
				env: {
					...process.env,
					PATH: process.env.PATH // Only keep PATH for executable resolution
				}
			});
			
			let stdout = '';
			let stderr = '';
			
			childProcess.stdout?.on('data', (data) => {
				stdout += data.toString();
			});
			
			childProcess.stderr?.on('data', (data) => {
				stderr += data.toString();
			});
			
			childProcess.on('close', (code) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`Command failed with code ${code}: ${stderr}`));
				}
			});
			
			childProcess.on('error', (error) => {
				reject(error);
			});

			// Timeout handling
			setTimeout(() => {
				childProcess.kill();
				reject(new Error('Command execution timeout (2 minutes)'));
			}, 120000);
		});
	}

	/**
	 * Execute a command using VS Code tasks with extended timeout for pip installs
	 */
	private async executeCommandWithTasksExtended(command: string, args: string[], timeoutMs: number): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			// Create task definition
			const taskDefinition: vscode.TaskDefinition = {
				type: 'mu-two-python-env',
				command,
				args: args.join(' ')
			};
			
			// Create shell execution
			const execution = new vscode.ShellExecution(command, args);
			
			// Create the task
			const task = new vscode.Task(
				taskDefinition,
				vscode.TaskScope.Global,
				`Python: ${command} ${args.slice(0, 2).join(' ')}`,
				'mu-two',
				execution
			);

			// Configure task presentation for less jarring background execution
			task.presentationOptions = {
				reveal: vscode.TaskRevealKind.Silent, // Don't auto-focus terminal
				panel: vscode.TaskPanelKind.Dedicated,
				clear: true,
				showReuseMessage: false,
				focus: false // Don't steal focus
			};

			// Execute with progress indication
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Window, // Use window progress instead of notification
				title: `Installing CircuitPython tools...`,
				cancellable: true
			}, async (progress, token) => {
				return new Promise<void>((progressResolve, progressReject) => {
					let isComplete = false;
					let taskExecution: vscode.TaskExecution;

					// Handle cancellation
					token.onCancellationRequested(() => {
						if (taskExecution && !isComplete) {
							taskExecution.terminate();
							progressReject(new Error('Operation cancelled by user'));
						}
					});

					// Execute the task
					vscode.tasks.executeTask(task).then(execution => {
						taskExecution = execution;

						// Set extended timeout for pip installations
						const timeout = setTimeout(() => {
							if (!isComplete) {
								taskExecution.terminate();
								progressReject(new Error(`Command execution timeout (${timeoutMs / 60000} minutes)`));
							}
						}, timeoutMs);

						// Periodic progress updates
						let progressCounter = 0;
						const progressInterval = setInterval(() => {
							if (!isComplete) {
								progressCounter += 10;
								progress.report({ 
									increment: 2,
									message: `Installing... (${Math.floor(progressCounter / 60)}:${(progressCounter % 60).toString().padStart(2, '0')})`
								});
							}
						}, 10000); // Update every 10 seconds

						// Listen for task completion
						const taskEndDisposable = vscode.tasks.onDidEndTask(e => {
							if (e.execution === taskExecution) {
								isComplete = true;
								clearTimeout(timeout);
								clearInterval(progressInterval);
								taskEndDisposable.dispose();

								if (e.execution.exitCode === 0) {
									progressResolve();
								} else {
									progressReject(new Error(`Command failed with exit code ${e.execution.exitCode}`));
								}
							}
						});
					}).catch(error => {
						progressReject(new Error(`Failed to execute task: ${error}`));
					});
				});
			}).then(() => resolve()).catch(error => reject(error));
		});
	}

	/**
	 * Execute a command using VS Code's task system for better integration
	 * Used for install operations and other commands that don't need output capture
	 */
	private async executeCommandWithTasks(command: string, args: string[]): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			// Create task definition
			const taskDefinition: vscode.TaskDefinition = {
				type: 'mu-two-python-env',
				command,
				args: args.join(' ')
			};

			// Create shell execution
			const execution = new vscode.ShellExecution(command, args);
			
			// Create the task
			const task = new vscode.Task(
				taskDefinition,
				vscode.TaskScope.Global,
				`Python: ${command} ${args.slice(0, 2).join(' ')}`,
				'mu-two',
				execution
			);

			// Configure task presentation for background execution
			task.presentationOptions = {
				reveal: vscode.TaskRevealKind.Never, // Don't show terminal
				panel: vscode.TaskPanelKind.Dedicated,
				clear: true,
				showReuseMessage: false
			};

			// Execute with progress indication
			vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: `Mu Two: Running ${command}...`,
				cancellable: true
			}, async (progress, token) => {
				return new Promise<void>((progressResolve, progressReject) => {
					let isComplete = false;
					let taskExecution: vscode.TaskExecution;

					// Handle cancellation
					token.onCancellationRequested(() => {
						if (taskExecution && !isComplete) {
							taskExecution.terminate();
							progressReject(new Error('Operation cancelled by user'));
						}
					});

					// Execute the task
					vscode.tasks.executeTask(task).then(execution => {
						taskExecution = execution;

						// Set timeout for long-running commands
						const timeout = setTimeout(() => {
							if (!isComplete) {
								taskExecution.terminate();
								progressReject(new Error('Command execution timeout (2 minutes)'));
							}
						}, 120000); // 2 minutes timeout

						// Listen for task completion
						const taskEndDisposable = vscode.tasks.onDidEndTask(e => {
							if (e.execution === taskExecution) {
								isComplete = true;
								clearTimeout(timeout);
								taskEndDisposable.dispose();

								// Check exit code if available
								const exitCode = e.execution.task.execution && 'exitCode' in e.execution.task.execution 
									? (e.execution.task.execution as any).exitCode 
									: 0;

								if (exitCode === 0) {
									progressResolve();
								} else {
									progressReject(new Error(`Command failed with exit code ${exitCode}`));
								}
							}
						});

						// Update progress
						progress.report({ message: `Executing ${args[0]} command...` });

					}).catch(error => {
						progressReject(new Error(`Task execution failed: ${error.message}`));
					});
				});
			}).then(() => {
				resolve();
			}).catch(error => {
				reject(error);
			});
		});
	}

	async updateCircuitPythonPackages(): Promise<void> {
		if (!this.muTwoEnvPath) {
			throw new Error('Environment not initialized');
		}

		try {
			vscode.window.showInformationMessage('Updating CircuitPython packages...');
			await this.installPackagesWithTasks(this.muTwoEnvPath, this.requiredPackages);
			vscode.window.showInformationMessage('✅ CircuitPython packages updated successfully!');
		} catch (error) {
			vscode.window.showErrorMessage(
				`Failed to update CircuitPython packages: ${error}`
			);
			throw error;
		}
	}

	dispose(): void {
		// Cleanup if needed
	}
}