import * as vscode from 'vscode';
// import { HybridTerminalManager, HybridTerminalInstance } from '../terminal/hybridTerminalManager'; // File deleted
// import { UnifiedDebugManager } from '../../sys/unifiedDebugManager';
import { MuTwoLanguageClient } from '../../interface/client';
import { WorkspaceValidator } from '../../workspace/workspaceValidator';
import { MuTwoWorkspaceManager } from '../../workspace/workspaceManager';
import { IDevice } from '../../devices/deviceDetector';
import { getNonce } from '../../sys/utils/webview';
import { LanguageServiceBridge } from './language/core/LanguageServiceBridge';

/**
 * Editor Panel Provider
 * 
 * - Use PTY backend for terminal processing in the editor
 * - Maintain Monaco editor UX in the main area
 * - Provide collapsible terminal subpanel
 */
export class EditorPanelProvider implements vscode.CustomTextEditorProvider{
	private workspaceValidator: WorkspaceValidator;
	private workspaceManager: MuTwoWorkspaceManager;
	private context: vscode.ExtensionContext;
	private currentPanel?: vscode.WebviewPanel;
	private isPanelCollapsed: boolean = true;
	private languageServiceBridge: LanguageServiceBridge;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.workspaceValidator = new WorkspaceValidator(context);
		this.workspaceManager = new MuTwoWorkspaceManager(context);
		
		// Initialize CircuitPython language service bridge
		this.languageServiceBridge = new LanguageServiceBridge({
			enableDiagnostics: true,
			enableCompletions: true,
			enableHover: true,
			enableSignatureHelp: true,
			defaultBoard: 'circuitplayground_express' // TODO: Get from configuration
		});
		
		// Initialize VS Code context variable for menu visibility
		this.updatePanelContext();
		
		console.log('Editor Panel Provider initialized with CircuitPython language service');
	}

	/**
	 * Create or show the webview editor panel 
	 */
	async createOrShowPanel(): Promise<void> {
		const columnToShowIn = vscode.window.activeTextEditor 
			? vscode.window.activeTextEditor.viewColumn 
			: undefined;

		if (this.currentPanel) {
			this.currentPanel.reveal(columnToShowIn);
			return;
		}

		// Create the webview panel
		this.currentPanel = vscode.window.createWebviewPanel(
			'muTwo.editor',
			'Mu 2 Editor',
			columnToShowIn || vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri]
			}
		);

		// Set the webview content
		await this.updateWebviewContent();

		// Handle panel disposal
		this.currentPanel.onDidDispose(() => {
			// Disconnect from language service
			this.languageServiceBridge.disconnectWebview('muTwo.editor');
			this.currentPanel = undefined;
		}, null, this.context.subscriptions);

		// Handle messages from webview
		this.currentPanel.webview.onDidReceiveMessage((message) => {
			this.handlePanelMessage(message);
		}, null, this.context.subscriptions);

		// Connect webview to CircuitPython language service
		this.languageServiceBridge.connectWebview(
			this.currentPanel.webview, 
			'muTwo.editor'
		);
	}

	/**
	 * Handle panel messages with simplified communication
	 */
	private async handlePanelMessage(message: any): Promise<void> {
		console.log('Editor panel message:', message);
		
		// Access global services from extension.ts
		const { debugManager, languageClient } = await import('../../extension');
		
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
							await debugManager.executeCommand(input);
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
						await debugManager.executeCommand(message.data.code);
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
				<title>Mu 2 Editor</title>
				<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.css'))}">
				<script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'editor.js'))}"></script>
			</head>
			<body class="${themeInfo.name}" style="background-color: ${themeInfo.backgroundColor}; color: ${themeInfo.color};">
				<div id="editorContainer"></div>
				<div id="terminalContainer"></div>
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
		// Use the provided webview panel instead of creating a new one
		this.currentPanel = webviewPanel;
		
		// Set up the webview options
		webviewPanel.webview.options = {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [this.context.extensionUri]
		};

		// Set the webview content
		await this.updateWebviewContent();

		// Handle panel disposal
		webviewPanel.onDidDispose(() => {
			// Disconnect from language service
			this.languageServiceBridge.disconnectWebview('muTwo.editor');
			this.currentPanel = undefined;
		}, null, this.context.subscriptions);

		// Handle messages from webview
		webviewPanel.webview.onDidReceiveMessage((message) => {
			this.handlePanelMessage(message);
		}, null, this.context.subscriptions);

		// Handle document changes and sync with webview
		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				this.syncDocumentToWebview(document);
			}
		});

		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
		});

		// Initial content sync
		this.syncDocumentToWebview(document);

		// Connect webview to CircuitPython language service
		this.languageServiceBridge.connectWebview(
			webviewPanel.webview, 
			'muTwo.editor'
		);
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