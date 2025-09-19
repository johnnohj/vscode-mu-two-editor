import * as vscode from 'vscode';
import { MuTwoLanguageClient } from '../devices/core/client';
import { WorkspaceValidator } from '../workspace/workspaceValidator';
import { MuTwoWorkspaceManager } from '../workspace/workspaceManager';
import { IDevice } from '../devices/core/deviceDetector';
import { getNonce } from '../sys/utils/webview';
import { LanguageServiceBridge } from './language/core/LanguageServiceBridge';

/**
 * Editor Panel Provider
 * 
 * - Use PTY backend for terminal processing in the editor
 * - Maintain Monaco editor UX in the main area
 * - Provide collapsible terminal subpanel
 */
export class EditorPanelProvider {
	private workspaceValidator: WorkspaceValidator;
	private workspaceManager: MuTwoWorkspaceManager;
	private context: vscode.ExtensionContext;
	private currentPanel?: vscode.WebviewPanel;
	private currentDocument?: vscode.TextDocument;
	private isPanelCollapsed: boolean = true;
	private languageServiceBridge: LanguageServiceBridge;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		// Lazy-load workspace components to avoid dependency loops
		this.workspaceValidator = new WorkspaceValidator(context);
		this.workspaceManager = new MuTwoWorkspaceManager(context);
		
		// Initialize CircuitPython language service bridge with error handling
		try {
			this.languageServiceBridge = new LanguageServiceBridge({
				enableDiagnostics: true,
				enableCompletions: true,
				enableHover: true,
				enableSignatureHelp: true,
				defaultBoard: 'circuitplayground_express' // TODO: Get from configuration
			});
			console.log('EditorPanel: Language service bridge initialized successfully');
		} catch (error) {
			console.error('EditorPanel: Failed to initialize language service bridge:', error);
			// Create a null object that provides safe method calls
			this.languageServiceBridge = this.createNullLanguageServiceBridge();
		}
		
		// Initialize VS Code context variable for menu visibility
		this.updatePanelContext();
		
		console.log('Editor Panel Provider initialized with CircuitPython language service');
	}

	/**
	 * Split the editor view vertically - simple and clean
	 */
	async createOrShowPanel(): Promise<void> {
		console.log('Creating vertical split in editor');

		try {
			// Use VS Code's built-in split functionality
			await vscode.commands.executeCommand('workbench.action.splitEditorDown');
			console.log('Editor split successfully');
		} catch (error) {
			console.error('Failed to split editor:', error);
			throw error;
		}
	}

	/**
	 * Get the LanguageServiceBridge for integration with language providers
	 */
	public getLanguageServiceBridge(): LanguageServiceBridge {
		return this.languageServiceBridge;
	}

	/**
	 * Handle panel messages with simplified communication
	 */
	private async handlePanelMessage(message: any): Promise<void> {
		console.log('Editor panel message:', message);

		// Access global services safely without circular imports
		const debugManager = this.getDebugManager();
		const languageClient = this.getLanguageClient();
		
		switch (message.type) {
			case 'panelStateChanged':
				// Update local state and VS Code context when panel is toggled in webview
				this.isPanelCollapsed = message.collapsed;
				this.updatePanelContext();
				console.log('Panel state updated:', this.isPanelCollapsed ? 'collapsed' : 'expanded');
				break;
				
			case 'showTerminalPanel':
			case 'hideTerminalPanel':
				// Panel state is managed in webview App component
				console.log('Panel state message:', message.type);
				break;

			case 'terminalInput':
			case 'terminal-input':
				// Send input to debug manager
				if (message.payload?.data || message.data) {
					const input = message.payload?.data || message.data;
					if (debugManager) {
						try {
							// Use proper method signature
							await debugManager.sendToRepl(input);
						} catch (error) {
							console.error('Terminal input error:', error);
						}
					}
				}
				break;
				
			case 'runCode':
				// Execute code through debug manager
				if (message.data?.code && debugManager) {
					try {
						// Use proper method signature
						await debugManager.sendToRepl(message.data.code);
						this.currentPanel?.webview.postMessage({
							type: 'codeExecutionResult',
							success: true
						});
					} catch (error) {
						this.currentPanel?.webview.postMessage({
							type: 'codeExecutionResult',
							success: false,
							error: error instanceof Error ? error.message : String(error)
						});
					}
				}
				break;
				
			case 'terminal-ready':
				// Terminal is ready for communication
				this.currentPanel?.webview.postMessage({
					type: 'terminalWrite',
					data: 'Mu 2 Editor Terminal Ready\n>>> '
				});
				break;

			case 'documentChanged':
				// Handle document changes from Monaco editor in webview
				if (message.text !== undefined && this.currentDocument) {
					await this.updateDocumentFromWebview(message.text);
				}
				break;

			case 'webviewReady':
				// Webview is ready, send initial document content
				if (this.currentDocument) {
					this.syncDocumentToWebview(this.currentDocument);
				}
				break;

			default:
				console.log('Unhandled editor message:', message.type);
				break;
		}
	}

	/**
	 * Send message to webview
	 */
	public sendMessage(message: any): void {
		if (this.currentPanel) {
			// Update local state when sending panel commands
			if (message.type === 'showPanel') {
				this.isPanelCollapsed = false;
				this.updatePanelContext();
			} else if (message.type === 'hidePanel') {
				this.isPanelCollapsed = true;
				this.updatePanelContext();
			}
			
			this.currentPanel.webview.postMessage(message);
		}
	}

	/**
	 * Update VS Code context variable for menu visibility
	 */
	private updatePanelContext(): void {
		vscode.commands.executeCommand('setContext', 'muTwo.editor.panelCollapsed', this.isPanelCollapsed);
		vscode.commands.executeCommand('setContext', 'muTwo.editor.navIcon', true);
	}

	/**
	 * Get current panel collapsed state
	 */
	public getIsPanelCollapsed(): boolean {
		return this.isPanelCollapsed;
	}

	/**
	 * Update panel title with hybrid status
	 */
	private async updatePanelTitle(panel: vscode.WebviewPanel): void {
		const fileName = (this as any).currentFileName || 'code.py';
		const isDirty = (this as any).isDirty || false;
		
		let title = fileName;
		if (isDirty) {
			title = title + '●';
		}		

		panel.title = title;
	}

	/**
	 * Get VS Code theme information
	 */
	private getThemeInfo(): { name: string; backgroundColor: string; color: string } {
		const activeTheme = vscode.window.activeColorTheme;
		
		return {
			name: activeTheme.kind === vscode.ColorThemeKind.Light ? 'vscode-light' : 'vscode-dark',
			backgroundColor: activeTheme.kind === vscode.ColorThemeKind.Light ? '#ffffff' : '#1e1e1e',
			color: activeTheme.kind === vscode.ColorThemeKind.Light ? '#000000' : '#d4d4d4'
		};
	}
	/**
	 * Update the webview content
	 */
	private async updateWebviewContent(): Promise<void> {
		if (!this.currentPanel) {return};

		const webview = this.currentPanel.webview;
		const extensionUri = this.context.extensionUri;

		const nonce = getNonce();
		const themeInfo = this.getThemeInfo();

		this.currentPanel.webview.html = `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview: vscode-resource: https:; script-src 'nonce-${nonce}' vscode-webview:; style-src vscode-webview: vscode-resource: 'unsafe-inline' http: https: data:; font-src vscode-webview: vscode-resource: data:; worker-src 'self' blob:;">
				<title>Mu 2 Editor</title>
				<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'public', 'editor', 'index.css'))}">
				<script type="module" nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'public', 'editor', 'index.js'))}"></script>
			</head>
			<body class="${themeInfo.name}" style="background-color: ${themeInfo.backgroundColor}; color: ${themeInfo.color};">
				<div id="root"></div>
				<script nonce="${nonce}">
					// Initialize VS Code API before loading the editor
					window.vscode = acquireVsCodeApi();
					console.log('Mu 2 Editor webview loaded with VS Code API');
					console.log('Root element:', document.getElementById('root'));
				</script>
			</body>
			</html>`;
		
		await this.updatePanelTitle(this.currentPanel);
	}
	/**
	 * Required by vscode.CustomTextEditorProvider interface
	 * Called when a custom editor is opened
	 */
	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		token: vscode.CancellationToken
	): Promise<void> {
		try {
			console.log(`=== CUSTOM EDITOR RESOLVE START ===`);
			console.log(`EditorPanel: Resolving custom text editor for ${document.fileName}`);
			console.log(`EditorPanel: Document URI: ${document.uri.toString()}`);
			console.log(`EditorPanel: Webview panel viewType: ${webviewPanel.viewType}`);
			console.log(`EditorPanel: Panel title: ${webviewPanel.title}`);
			console.log(`EditorPanel: Panel visible: ${webviewPanel.visible}`);
			console.log(`EditorPanel: Panel active: ${webviewPanel.active}`);

			// Use the provided webview panel instead of creating a new one
			this.currentPanel = webviewPanel;
			this.currentDocument = document;

			// Set VS Code context variables for custom editor menu visibility
			await vscode.commands.executeCommand('setContext', 'activeCustomEditorId', 'muTwo.editor.editView');
			this.updatePanelContext();

			// Set up the webview options
			webviewPanel.webview.options = {
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri]
			};

			// Set the webview content
			await this.updateWebviewContent();

			// Handle document changes and sync with webview
			const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
				if (e.document.uri.toString() === document.uri.toString()) {
					this.syncDocumentToWebview(document);
				}
			});

			// Handle panel disposal
			webviewPanel.onDidDispose(() => {
				// Disconnect from language service
				this.languageServiceBridge.disconnectWebview('muTwo.editor.editView');
				this.currentPanel = undefined;
				this.currentDocument = undefined;
				// Clear custom editor context variables
				vscode.commands.executeCommand('setContext', 'activeCustomEditorId', undefined);
				vscode.commands.executeCommand('setContext', 'muTwo.editor.panelCollapsed', undefined);
				vscode.commands.executeCommand('setContext', 'muTwo.editor.navIcon', false);
				// Dispose document subscription
				changeDocumentSubscription.dispose();
			}, null, this.context.subscriptions);

			// Handle messages from webview
			webviewPanel.webview.onDidReceiveMessage((message) => {
				this.handlePanelMessage(message);
			}, null, this.context.subscriptions);

			// Initial content sync
			this.syncDocumentToWebview(document);

			// Connect webview to CircuitPython language service
			try {
				if (this.languageServiceBridge) {
					this.languageServiceBridge.connectWebview(
						webviewPanel.webview,
						'muTwo.editor.editView'
					);
				}
			} catch (error) {
				console.warn('EditorPanel: Failed to connect language service bridge in custom editor:', error);
			}

		} catch (error) {
			console.error('EditorPanel: Failed to resolve custom text editor:', error);
			// Show error message to user
			webviewPanel.webview.html = this.getErrorHtml(error);
		}
	}

	/**
	 * Sync document content to webview
	 */
	private syncDocumentToWebview(document: vscode.TextDocument) {
		if (this.currentPanel) {
			this.currentPanel.webview.postMessage({
				type: 'documentUpdate',
				text: document.getText(),
				fileName: document.fileName
			});
		}
	}

	/**
	 * Update VS Code document from webview changes
	 */
	private async updateDocumentFromWebview(text: string): Promise<void> {
		if (!this.currentDocument) {
			console.warn('EditorPanel: No current document to update');
			return;
		}

		try {
			const edit = new vscode.WorkspaceEdit();

			// Replace the entire document content
			const fullRange = new vscode.Range(
				this.currentDocument.positionAt(0),
				this.currentDocument.positionAt(this.currentDocument.getText().length)
			);

			edit.replace(this.currentDocument.uri, fullRange, text);

			// Apply the edit
			const success = await vscode.workspace.applyEdit(edit);
			if (!success) {
				console.error('EditorPanel: Failed to apply document edit');
			}
		} catch (error) {
			console.error('EditorPanel: Error updating document from webview:', error);
		}
	}

	/**
	 * Get error HTML for failed webview initialization
	 */
	private getErrorHtml(error: any): string {
		const errorMessage = error instanceof Error ? error.message : String(error);
		return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>Mu 2 Editor - Error</title>
				<style>
					body { font-family: var(--vscode-font-family); padding: 20px; }
					.error { color: var(--vscode-errorForeground); }
					.retry-btn {
						background: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						padding: 8px 16px;
						margin-top: 10px;
						cursor: pointer;
					}
				</style>
			</head>
			<body>
				<h2>Mu 2 Editor Failed to Load</h2>
				<p class="error">Error: ${errorMessage}</p>
				<p>Please try reloading the editor or check the VS Code output panel for more details.</p>
				<button class="retry-btn" onclick="window.location.reload()">Retry</button>
			</body>
			</html>
		`;
	}

	/**
	 * Create a null language service bridge for fallback
	 */
	private createNullLanguageServiceBridge(): any {
		return {
			connectWebview: () => console.warn('Language service not available'),
			disconnectWebview: () => {},
			dispose: () => {}
		};
	}

	/**
	 * Safely get debug manager instance
	 */
	private getDebugManager(): any {
		try {
			// Import service registry to access global service
			const { getService } = require('../sys/serviceRegistry');
			return getService('deviceManager');
		} catch (error) {
			console.warn('Debug manager not available:', error);
			return null;
		}
	}

	/**
	 * Safely get language client instance
	 */
	private getLanguageClient(): any {
		try {
			// Import service registry to access global service
			const { getService } = require('../sys/serviceRegistry');
			return getService('languageClient');
		} catch (error) {
			console.warn('Language client not available:', error);
			return null;
		}
	}

	/**
	 * Cleanup
	 */
	dispose(): void {
		// Dispose resources
		this.workspaceValidator.dispose();
		this.workspaceManager.dispose();
		this.languageServiceBridge.dispose();
		if (this.currentPanel) {
			this.currentPanel.dispose();
		}
	}
}