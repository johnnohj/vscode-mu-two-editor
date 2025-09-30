import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { CircuitPythonLanguageService } from './circuitPythonLanguageService';

/**
 * Language Override Manager
 *
 * Manages CircuitPython language override when working in mutwo:// workspaces.
 * Only activates CircuitPython language features when we detect we're in a
 * CircuitPython workspace (using mutwo:// file scheme).
 */
export class LanguageOverrideManager {
	private logger = getLogger();
	private isCircuitPythonWorkspace = false;
	private disposables: vscode.Disposable[] = [];
	private circuitPythonLanguageService: CircuitPythonLanguageService;

	constructor(private context: vscode.ExtensionContext) {
		this.circuitPythonLanguageService = new CircuitPythonLanguageService(context);
		this.checkWorkspaceType();
		this.setupWorkspaceWatcher();
	}

	/**
	 * Check if current workspace contains mutwo:// URIs
	 */
	private async checkWorkspaceType(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders) {
			this.isCircuitPythonWorkspace = false;
			return;
		}

		// Check if any workspace folder uses mutwo:// scheme
		let hasCircuitPythonWorkspace = false;
		for (const folder of workspaceFolders) {
			if (folder.uri.scheme === 'mutwo') {
				hasCircuitPythonWorkspace = true;
				this.logger.info('EXTENSION', `LanguageOverride: Detected CircuitPython workspace: ${folder.uri.toString()}`);
				break;
			}
		}

		// Update workspace type and activate language features if needed
		if (hasCircuitPythonWorkspace !== this.isCircuitPythonWorkspace) {
			this.isCircuitPythonWorkspace = hasCircuitPythonWorkspace;

			if (this.isCircuitPythonWorkspace) {
				this.activateCircuitPythonFeatures();
			} else {
				this.deactivateCircuitPythonFeatures();
			}
		}
	}

	/**
	 * Set up workspace change monitoring
	 */
	private setupWorkspaceWatcher(): void {
		// Watch for workspace folder changes
		const workspaceFoldersWatcher = vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
			this.logger.info('EXTENSION', 'LanguageOverride: Workspace folders changed, rechecking...');
			await this.checkWorkspaceType();
		});

		// Watch for file changes that might indicate CircuitPython project
		const fileWatcher = vscode.workspace.onDidOpenTextDocument(async (document) => {
			if (document.uri.scheme === 'mutwo') {
				this.logger.info('EXTENSION', `LanguageOverride: Opened mutwo:// file: ${document.uri.toString()}`);
				await this.checkWorkspaceType();
			}
		});

		this.disposables.push(workspaceFoldersWatcher, fileWatcher);
	}

	/**
	 * Activate CircuitPython language features
	 */
	private activateCircuitPythonFeatures(): void {
		this.logger.info('EXTENSION', 'LanguageOverride: Activating CircuitPython language features');

		// Set context variable for conditional activation
		vscode.commands.executeCommand('setContext', 'muTwo.isCircuitPythonWorkspace', true);

		// Configure Pylance/Pyright for CircuitPython
		this.configurePylanceForCircuitPython();

		// Register language-specific features for CircuitPython
		this.registerCircuitPythonLanguageFeatures();
	}

	/**
	 * Deactivate CircuitPython language features
	 */
	private deactivateCircuitPythonFeatures(): void {
		this.logger.info('EXTENSION', 'LanguageOverride: Deactivating CircuitPython language features');

		// Clear context variable
		vscode.commands.executeCommand('setContext', 'muTwo.isCircuitPythonWorkspace', false);

		// Dispose language-specific features
		this.disposeCircuitPythonFeatures();
	}

	/**
	 * Register CircuitPython-specific language features
	 */
	private registerCircuitPythonLanguageFeatures(): void {
		// Use the comprehensive CircuitPython language service
		this.circuitPythonLanguageService.registerLanguageProviders();
		this.logger.info('EXTENSION', 'LanguageOverride: CircuitPython language features registered');
	}

	/**
	 * Configure Pylance/Pyright for CircuitPython development
	 */
	private async configurePylanceForCircuitPython(): Promise<void> {
		try {
			// First, ensure circuitpython-stubs is installed
			await this.ensureCircuitPythonStubs();

			// Get workspace configuration
			const config = vscode.workspace.getConfiguration('python');

			// Set up CircuitPython-specific Python settings
			const circuitPythonSettings = {
				// Use official CircuitPython type stubs from pip package
				'analysis.autoImportCompletions': true,
				'analysis.autoSearchPaths': true,

				// CircuitPython-specific analysis settings
				'analysis.diagnosticMode': 'workspace',
				'analysis.typeCheckingMode': 'basic',

				// CircuitPython doesn't have full standard library
				'analysis.exclude': [
					'**/threading.py',
					'**/multiprocessing',
					'**/subprocess.py',
					'**/socket.py',
					'**/urllib',
					'**/http',
					'**/asyncio',
					'**/json.py',
					'**/pickle.py',
					'**/sqlite3.py',
					'**/tkinter',
					'**/pathlib.py',
					'**/tempfile.py',
					'**/datetime.py'
				],

				// Enable stub-based type checking
				'analysis.useLibraryCodeForTypes': false,
				'analysis.stubPath': '',  // Let it use site-packages stubs
				'analysis.typeshedPaths': []
			};

			// Apply settings for the workspace
			for (const [key, value] of Object.entries(circuitPythonSettings)) {
				await config.update(key, value, vscode.ConfigurationTarget.Workspace);
			}

			// Create pyrightconfig.json for better CircuitPython support
			await this.createPyrightConfig();

			this.logger.info('EXTENSION', 'LanguageOverride: Pylance configured for CircuitPython with official stubs');
		} catch (error) {
			this.logger.warn('EXTENSION', 'LanguageOverride: Failed to configure Pylance:', error);
		}
	}

	/**
	 * Ensure CircuitPython stubs are installed
	 */
	private async ensureCircuitPythonStubs(): Promise<void> {
		try {
			// Check if circuitpython-stubs is installed
			const pythonPath = await this.getPythonPath();
			if (!pythonPath) {
				this.logger.warn('EXTENSION', 'No Python interpreter found, skipping stub installation');
				return;
			}

			// Check if stubs are already installed
			const checkResult = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Checking CircuitPython stubs...',
					cancellable: false
				},
				async () => {
					const terminal = vscode.window.createTerminal({
						name: 'CircuitPython Stubs Check',
						hideFromUser: true
					});

					return new Promise<boolean>((resolve) => {
						// Check if stubs package is installed
						terminal.sendText(`"${pythonPath}" -c "import circuitpython_stubs; print('installed')" 2>/dev/null || echo "not_installed"`);

						// Simple timeout-based approach for checking
						setTimeout(() => {
							terminal.dispose();
							resolve(false); // Assume not installed if we can't verify quickly
						}, 3000);
					});
				}
			);

			// If not installed, offer to install
			if (!checkResult) {
				const install = await vscode.window.showInformationMessage(
					'CircuitPython type stubs are not installed. Install them for better IDE support?',
					'Install', 'Skip'
				);

				if (install === 'Install') {
					await this.installCircuitPythonStubs(pythonPath);
				}
			}

		} catch (error) {
			this.logger.warn('EXTENSION', 'Failed to ensure CircuitPython stubs:', error);
		}
	}

	/**
	 * Install CircuitPython stubs via pip
	 */
	private async installCircuitPythonStubs(pythonPath: string): Promise<void> {
		try {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Installing CircuitPython stubs...',
					cancellable: false
				},
				async (progress) => {
					const terminal = vscode.window.createTerminal({
						name: 'Install CircuitPython Stubs'
					});

					terminal.show();
					terminal.sendText(`"${pythonPath}" -m pip install circuitpython-stubs`);

					// Wait a bit for installation to complete
					await new Promise(resolve => setTimeout(resolve, 10000));

					this.logger.info('EXTENSION', 'CircuitPython stubs installation initiated');
				}
			);
		} catch (error) {
			this.logger.error('EXTENSION', 'Failed to install CircuitPython stubs:', error);
			vscode.window.showErrorMessage('Failed to install CircuitPython stubs. Please install manually: pip install circuitpython-stubs');
		}
	}

	/**
	 * Get Python interpreter path
	 */
	private async getPythonPath(): Promise<string | undefined> {
		try {
			// Try to get from Python extension
			const pythonExtension = vscode.extensions.getExtension('ms-python.python');
			if (pythonExtension?.isActive) {
				const pythonApi = pythonExtension.exports;
				if (pythonApi?.settings?.getExecutionDetails) {
					const details = await pythonApi.settings.getExecutionDetails();
					return details?.execCommand?.[0];
				}
			}

			// Fallback to configuration
			const config = vscode.workspace.getConfiguration('python');
			const pythonPath = config.get<string>('pythonPath') || config.get<string>('defaultInterpreterPath');

			return pythonPath || 'python';
		} catch (error) {
			this.logger.warn('EXTENSION', 'Failed to get Python path:', error);
			return 'python'; // Default fallback
		}
	}

	/**
	 * Create pyrightconfig.json for CircuitPython workspace
	 */
	private async createPyrightConfig(): Promise<void> {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return;
		}

		// Create pyrightconfig.json in the workspace root
		const configPath = vscode.Uri.joinPath(workspaceFolders[0].uri, 'pyrightconfig.json');

		const pyrightConfig = {
			pythonVersion: "3.8", // CircuitPython typically uses Python 3.8 syntax
			typeCheckingMode: "basic",
			useLibraryCodeForTypes: false,

			// Let Pylance find CircuitPython stubs from site-packages
			// (installed via pip install circuitpython-stubs)
			stubPath: "", // Use default stub resolution

			// Ignore standard library modules not available in CircuitPython
			ignore: [
				"**/threading.py",
				"**/multiprocessing/**",
				"**/subprocess.py",
				"**/socket.py",
				"**/urllib/**",
				"**/http/**",
				"**/asyncio/**",
				"**/json.py",
				"**/pickle.py",
				"**/sqlite3/**",
				"**/tkinter/**",
				"**/pathlib.py",
				"**/tempfile.py",
				"**/datetime.py",
				"**/concurrent/**",
				"**/email/**"
			],

			// CircuitPython reporting settings
			reportMissingImports: "warning",
			reportMissingTypeStubs: false,
			reportUndefinedVariable: "error",
			reportUnboundVariable: "warning",
			reportGeneralTypeIssues: "warning",
			reportShadowedImports: false,  // CircuitPython requires code.py/main.py as entry points

			// CircuitPython has different module structure
			reportImportCycles: false,
			reportPrivateUsage: "warning",

			// Stricter settings for CircuitPython development
			reportUnusedImport: "information",
			reportUnusedVariable: "information",
			reportDuplicateImport: "warning",

			// CircuitPython-specific settings
			executionEnvironments: [
				{
					root: "./",
					pythonVersion: "3.8",
					pythonPlatform: "All"
				}
			]
		};

		try {
			const configContent = JSON.stringify(pyrightConfig, null, 2);
			await vscode.workspace.fs.writeFile(configPath, Buffer.from(configContent, 'utf8'));
			this.logger.info('EXTENSION', `Created pyrightconfig.json at ${configPath.fsPath}`);
		} catch (error) {
			this.logger.warn('EXTENSION', `Failed to create pyrightconfig.json: ${error}`);
		}
	}

	/**
	 * Dispose CircuitPython-specific features
	 */
	private disposeCircuitPythonFeatures(): void {
		// Dispose all CircuitPython-specific disposables
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables = [];
	}

	/**
	 * Provide CircuitPython-specific completions
	 */
	private async provideCircuitPythonCompletions(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[]> {
		const completions: vscode.CompletionItem[] = [];

		// Add CircuitPython-specific imports and APIs
		if (this.isAtModuleLevel(document, position)) {
			// Common CircuitPython imports
			const circuitPythonImports = [
				'board',
				'digitalio',
				'analogio',
				'busio',
				'microcontroller',
				'neopixel',
				'adafruit_motor',
				'adafruit_display_text',
				'displayio',
				'time'
			];

			circuitPythonImports.forEach(module => {
				const completion = new vscode.CompletionItem(module, vscode.CompletionItemKind.Module);
				completion.detail = `CircuitPython module`;
				completion.documentation = new vscode.MarkdownString(`Import the \`${module}\` CircuitPython module`);
				completions.push(completion);
			});
		}

		// Add board pin completions after 'board.'
		const lineText = document.lineAt(position.line).text;
		const linePrefix = lineText.substring(0, position.character);

		if (linePrefix.endsWith('board.')) {
			const boardPins = [
				'LED', 'NEOPIXEL',
				'A0', 'A1', 'A2', 'A3', 'A4', 'A5',
				'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13',
				'SCL', 'SDA', 'MOSI', 'MISO', 'SCK'
			];

			boardPins.forEach(pin => {
				const completion = new vscode.CompletionItem(pin, vscode.CompletionItemKind.Constant);
				completion.detail = `Board pin`;
				completion.documentation = new vscode.MarkdownString(`CircuitPython board pin \`${pin}\``);
				completions.push(completion);
			});
		}

		return completions;
	}

	/**
	 * Provide CircuitPython-specific hover information
	 */
	private async provideCircuitPythonHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Hover | undefined> {
		const range = document.getWordRangeAtPosition(position);
		if (!range) return undefined;

		const word = document.getText(range);

		// Provide CircuitPython-specific documentation
		const circuitPythonDocs: Record<string, string> = {
			'board': '**CircuitPython Board Module**\n\nProvides access to board-specific pins and hardware.',
			'digitalio': '**CircuitPython Digital I/O Module**\n\nProvides classes for digital input/output operations.',
			'analogio': '**CircuitPython Analog I/O Module**\n\nProvides classes for analog input/output operations.',
			'time': '**CircuitPython Time Module**\n\nProvides time-related functions including sleep() and monotonic().'
		};

		const documentation = circuitPythonDocs[word];
		if (documentation) {
			return new vscode.Hover(new vscode.MarkdownString(documentation), range);
		}

		return undefined;
	}

	/**
	 * Provide CircuitPython-specific document symbols
	 */
	private async provideCircuitPythonSymbols(
		document: vscode.TextDocument,
		token: vscode.CancellationToken
	): Promise<vscode.DocumentSymbol[]> {
		// Basic Python symbol parsing with CircuitPython awareness
		const symbols: vscode.DocumentSymbol[] = [];
		const text = document.getText();
		const lines = text.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Look for CircuitPython-specific patterns
			const importMatch = line.match(/^import\s+(board|digitalio|analogio|busio|microcontroller|neopixel)/);
			if (importMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					`import ${importMatch[1]}`,
					'CircuitPython Module Import',
					vscode.SymbolKind.Module,
					range,
					range
				);
				symbols.push(symbol);
			}

			// Look for pin assignments
			const pinMatch = line.match(/(\w+)\s*=\s*board\.(\w+)/);
			if (pinMatch) {
				const range = new vscode.Range(i, 0, i, line.length);
				const symbol = new vscode.DocumentSymbol(
					pinMatch[1],
					`Board Pin: ${pinMatch[2]}`,
					vscode.SymbolKind.Constant,
					range,
					range
				);
				symbols.push(symbol);
			}
		}

		return symbols;
	}

	/**
	 * Check if position is at module level (for import suggestions)
	 */
	private isAtModuleLevel(document: vscode.TextDocument, position: vscode.Position): boolean {
		// Simple heuristic: check if we're at the start of a line or after 'import'
		const lineText = document.lineAt(position.line).text;
		const beforeCursor = lineText.substring(0, position.character);

		return beforeCursor.trim().length === 0 || beforeCursor.trim().endsWith('import');
	}

	/**
	 * Get current workspace type
	 */
	public isInCircuitPythonWorkspace(): boolean {
		return this.isCircuitPythonWorkspace;
	}

	/**
	 * Force re-check workspace type (for testing)
	 */
	public async refreshWorkspaceType(): Promise<void> {
		await this.checkWorkspaceType();
	}

	/**
	 * Dispose all resources
	 */
	public dispose(): void {
		this.disposables.forEach(disposable => disposable.dispose());
		this.circuitPythonLanguageService.dispose();
		this.disposables = [];
	}
}