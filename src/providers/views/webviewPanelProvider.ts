import * as vscode from 'vscode';
import { MuTwoLanguageClient } from '../../devices/core/client';
import { WorkspaceValidator } from '../../workspace/workspaceValidator';
import { MuTwoWorkspaceManager } from '../../workspace/workspaceManager';
import { IDevice } from '../../devices/core/deviceDetector';
import { getNonce } from '../../utils/webview';
import { LanguageServiceBridge } from '../language/core/LanguageServiceBridge';
import { getLogger } from '../../utils/unifiedLogger';

import { BoardDetectionHelper } from '../helpers/boardDetectionHelper';
import { ReplSessionHelper } from '../helpers/replSessionHelper';
import { PlotterTabHelper } from '../helpers/plotterTabHelper';
import { ReplCoordinator } from '../../services/replCoordinator';
import { HardwareDrawerContent } from '../../services/hardwareDrawerContent';

// TODO: Determine what feature from editorPanelProvider.ts need to be introduced here for
// integration and eventual replacement of editorPanelProvider.ts by this file
// [This file will be renamed editorPanelProvider.ts once functionality is confirmed]

/**
 * EditorReplPanelProvider - Creates connected REPL panels for editors
 *
 * Based on MU-TODO.md line 15: "Open editors must be able to spawn 'connected' REPL windows
 * [uses the splitBelow API to create a webviewPanel] to connect to a board - virtual or physical"
 *
 * Uses the same split approach as EditorPanelProvider:
 * 1. Execute 'workbench.action.splitEditorDown' to create split
 * 2. Create webview panel in the active (split) column
 */
export class EditorReplPanelProvider {
	private context: vscode.ExtensionContext;
	private activePanels: Map<string, ConnectedReplPanel> = new Map();
	private activeHardwarePanels: Map<string, ConnectedHardwarePanel> = new Map();
	private activePlotterPanels: Map<string, ConnectedPlotterPanel> = new Map();
	private boardDetectionHelper: BoardDetectionHelper;
	private replSessionHelper: ReplSessionHelper;
	private plotterTabHelper: PlotterTabHelper;
	private logger = getLogger();

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.boardDetectionHelper = new BoardDetectionHelper(context);
		this.replSessionHelper = new ReplSessionHelper(context);
		this.plotterTabHelper = new PlotterTabHelper(context);

		// Initialize context variables for button visibility
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.exists', false);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.panelCollapsed', true);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', true);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedHardware.exists', false);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedPlotter.exists', false);

		// Set up editor redirection to prevent new files opening in panel groups
		this.setupEditorRedirection();
	}

	/**
	 * Set up editor redirection to prevent new files opening in Connected* Panel groups
	 */
	private setupEditorRedirection(): void {
		// Listen for when the active editor changes
		vscode.window.onDidChangeActiveTextEditor((newEditor) => {
			// If a new editor opened and one of our panels is currently active,
			// redirect focus back to the source editor's group
			if (newEditor && this.hasActivePanels()) {
				this.redirectToSourceEditorGroup(newEditor);
			}
		});

		// Listen for when editors are opened in specific view columns
		vscode.window.onDidChangeVisibleTextEditors((editors) => {
			// Check if any new editors opened in our panel columns (2 or 3)
			const problematicEditors = editors.filter(editor =>
				editor.viewColumn === vscode.ViewColumn.Two ||
				editor.viewColumn === vscode.ViewColumn.Three
			);

			if (problematicEditors.length > 0 && this.hasActivePanels()) {
				// Move these editors to the first column
				problematicEditors.forEach(editor => {
					this.moveEditorToMainGroup(editor);
				});
			}
		});
	}

	/**
	 * Check if we have any active panels that could interfere with editor opening
	 */
	private hasActivePanels(): boolean {
		return this.activePanels.size > 0 ||
			   this.activeHardwarePanels.size > 0 ||
			   this.activePlotterPanels.size > 0;
	}

	/**
	 * Redirect new editor to the source editor's group (Column One)
	 */
	private redirectToSourceEditorGroup(newEditor: vscode.TextEditor): void {
		// Only redirect if the new editor opened in our panel columns
		if (newEditor.viewColumn === vscode.ViewColumn.Two ||
			newEditor.viewColumn === vscode.ViewColumn.Three) {

			this.logger.info('EXTENSION', `Redirecting editor from column ${newEditor.viewColumn} to main group`);
			this.moveEditorToMainGroup(newEditor);
		}
	}

	/**
	 * Move an editor to the main editor group (Column One)
	 */
	private moveEditorToMainGroup(editor: vscode.TextEditor): void {
		setTimeout(async () => {
			try {
				// Focus the editor first
				await vscode.window.showTextDocument(editor.document, vscode.ViewColumn.One);
				this.logger.info('EXTENSION', `Successfully moved editor to main group`);
			} catch (error) {
				this.logger.warn('EXTENSION', `Failed to redirect editor: ${error}`);
			}
		}, 50); // Small delay to let VS Code finish opening the editor
	}

	/**
	 * Create or show a connected REPL panel using splitEditorDown API
	 * Called when editor wants to spawn or show a connected REPL
	 */
	async createOrShowPanel(sourceEditor?: vscode.TextEditor): Promise<ConnectedReplPanel> {
		const panelId = this.generatePanelId(sourceEditor);

		// Check if panel already exists
		if (this.activePanels.has(panelId)) {
			const existingPanel = this.activePanels.get(panelId)!;
			// Show the existing panel
			this.showPanel(sourceEditor);
			return existingPanel;
		}

		// Create new panel if it doesn't exist
		return this.createConnectedReplPanel(sourceEditor);
	}

	/**
	 * Create a connected REPL panel using splitEditorDown API
	 * Called when editor wants to spawn a connected REPL
	 */
	async createConnectedReplPanel(sourceEditor?: vscode.TextEditor): Promise<ConnectedReplPanel> {
		const panelId = this.generatePanelId(sourceEditor);

		// Check if panel already exists for this editor
		if (this.activePanels.has(panelId)) {
			const existingPanel = this.activePanels.get(panelId)!;
			existingPanel.reveal();
			return existingPanel;
		}

		this.logger.info('EXTENSION', 'Creating connected REPL with split editor down');

		try {
			// Create webview panel first
			const panel = vscode.window.createWebviewPanel(
				'muTwo.connectedRepl',
				`${sourceEditor?.document.fileName || 'Untitled'}`,
				vscode.ViewColumn.Active, // Create beside current editor
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: [this.context.extensionUri]
				}
			);

			// Set the icon for the panel tab
			panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'Mu2NoCirc-Red.svg');

			// Set up panel focus tracking for context variables
			panel.onDidChangeViewState((e) => {
				if (e.webviewPanel.active) {
					vscode.commands.executeCommand('setContext', 'activeWebviewPanelId', 'muTwo.connectedRepl');
					vscode.commands.executeCommand('setContext', 'muTwo.panelsActive', true);
				}
			});

			// Set initial context for the active panel
			vscode.commands.executeCommand('setContext', 'activeWebviewPanelId', 'muTwo.connectedRepl');
			vscode.commands.executeCommand('setContext', 'muTwo.panelsActive', true);
			this.logger.info('EXTENSION', 'Set context: activeWebviewPanelId = muTwo.connectedRepl');

			// Then position it below using split command
			await vscode.commands.executeCommand('workbench.action.moveEditorToBelowGroup');
			this.logger.info('EXTENSION', 'Connected REPL panel created and positioned below');

			const connectedPanel = new ConnectedReplPanel(
				panel,
				this.context,
				sourceEditor,
				this.boardDetectionHelper,
				this.replSessionHelper,
				this.plotterTabHelper
			);

			// Register with REPL coordinator for data sharing
			const panelId = this.generatePanelId(sourceEditor);
			const coordinator = ReplCoordinator.getInstance(this.context);
			coordinator.registerConnectedPanel(panelId, panel, sourceEditor);

			// Track panel and handle disposal
			this.activePanels.set(panelId, connectedPanel);
			panel.onDidDispose(() => {
				this.activePanels.delete(panelId);
				this.updatePanelContext(panelId, true); // Mark as collapsed when disposed
				this.updateGlobalPanelsContext();
			});

			// Update context variables to show panel exists and is visible
			this.updatePanelContext(panelId, false); // false = not collapsed

			this.logger.info('EXTENSION', 'Connected REPL panel created successfully');
			return connectedPanel;

		} catch (error) {
			this.logger.error('EXTENSION', 'Failed to create connected REPL panel:', error);
			throw error;
		}
	}

	/**
	 * Generate unique panel ID based on source editor
	 */
	private generatePanelId(sourceEditor?: vscode.TextEditor): string {
		if (sourceEditor) {
			return `repl-${sourceEditor.document.uri.toString()}`;
		}
		return `repl-${Date.now()}`;
	}

	/**
	 * Hide panel for the given source editor
	 */
	hidePanel(sourceEditor?: vscode.TextEditor): void {
		const panelId = this.generatePanelId(sourceEditor);
		const panel = this.activePanels.get(panelId);
		if (panel) {
			panel.hide();
			this.updatePanelContext(panelId, true); // true = collapsed
		}
	}

	/**
	 * Show existing panel for the given source editor
	 */
	showPanel(sourceEditor?: vscode.TextEditor): void {
		const panelId = this.generatePanelId(sourceEditor);
		const panel = this.activePanels.get(panelId);
		if (panel) {
			panel.reveal();
			this.updatePanelContext(panelId, false); // false = not collapsed
		}
	}

	/**
	 * Show header for the given source editor
	 */
	showHeader(sourceEditor?: vscode.TextEditor): void {
		this.logger.info('EXTENSION', 'EditorReplPanelProvider.showHeader called with editor:', sourceEditor?.document.fileName);
		const panelId = this.generatePanelId(sourceEditor);
		this.logger.info('EXTENSION', 'Generated panel ID:', panelId);
		const panel = this.activePanels.get(panelId);
		if (panel) {
			this.logger.info('EXTENSION', 'Found panel, calling showHeader on ConnectedReplPanel');
			panel.showHeader();
			vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', false);
		} else {
			this.logger.warn('EXTENSION', 'No active panel found for panelId:', panelId, 'Available panels:', Array.from(this.activePanels.keys()));
		}
	}

	/**
	 * Hide header for the given source editor
	 */
	hideHeader(sourceEditor?: vscode.TextEditor): void {
		this.logger.info('EXTENSION', 'EditorReplPanelProvider.hideHeader called with editor:', sourceEditor?.document.fileName);
		const panelId = this.generatePanelId(sourceEditor);
		this.logger.info('EXTENSION', 'Generated panel ID:', panelId);
		const panel = this.activePanels.get(panelId);
		if (panel) {
			this.logger.info('EXTENSION', 'Found panel, calling hideHeader on ConnectedReplPanel');
			panel.hideHeader();
			vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', true);
		} else {
			this.logger.warn('EXTENSION', 'No active panel found for panelId:', panelId, 'Available panels:', Array.from(this.activePanels.keys()));
		}
	}

	/**
	 * Update VS Code context variables for panel visibility
	 */
	private updatePanelContext(panelId: string, collapsed: boolean): void {
		const panel = this.activePanels.get(panelId);
		const exists = this.activePanels.has(panelId);

		// Set context variables for the current panel
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.exists', exists);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.panelCollapsed', collapsed);

		this.logger.info('EXTENSION', `Panel context updated: exists=${exists}, collapsed=${collapsed}`);
	}

	/**
	 * Update global context to indicate if any of our panels are active
	 */
	private updateGlobalPanelsContext(): void {
		const anyPanelsActive = this.activePanels.size > 0 ||
								this.activeHardwarePanels.size > 0 ||
								this.activePlotterPanels.size > 0;

		vscode.commands.executeCommand('setContext', 'muTwo.panelsActive', anyPanelsActive);
		this.logger.info('EXTENSION', `Global panels context updated: muTwo.panelsActive=${anyPanelsActive}`);
	}

	/**
	 * Get all active connected REPL panels
	 */
	getActivePanels(): ConnectedReplPanel[] {
		return Array.from(this.activePanels.values());
	}

	getActivePlotterPanels(): ConnectedPlotterPanel[] {
		return Array.from(this.activePlotterPanels.values());
	}

	getActiveHardwarePanels(): ConnectedHardwarePanel[] {
		return Array.from(this.activeHardwarePanels.values());
	}

	/**
	 * Create or show a connected hardware simulation panel
	 */
	async createOrShowHardwarePanel(sourceEditor?: vscode.TextEditor): Promise<ConnectedHardwarePanel> {
		const panelId = this.generatePanelId(sourceEditor);

		// Check if panel already exists
		if (this.activeHardwarePanels.has(panelId)) {
			const existingPanel = this.activeHardwarePanels.get(panelId)!;
			existingPanel.reveal();
			return existingPanel;
		}

		// Create new hardware panel in Column Three
		const panel = vscode.window.createWebviewPanel(
			'muTwo.connectedHardware',
			`Device - ${sourceEditor?.document.fileName?.split(/[\\/]/).pop() || 'Untitled'}`,
			{ viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri]
			}
		);

		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'Mu2NoCirc-Red.svg');

		// Set up panel focus tracking for context variables
		panel.onDidChangeViewState((e) => {
			if (e.webviewPanel.active) {
				vscode.commands.executeCommand('setContext', 'activeWebviewPanelId', 'muTwo.connectedHardware');
				vscode.commands.executeCommand('setContext', 'muTwo.panelsActive', true);
			}
		});

		const hardwarePanel = new ConnectedHardwarePanel(
			panel,
			this.context,
			sourceEditor,
			this.boardDetectionHelper
		);

		// Track panel and handle disposal
		this.activeHardwarePanels.set(panelId, hardwarePanel);
		panel.onDidDispose(() => {
			this.activeHardwarePanels.delete(panelId);
			vscode.commands.executeCommand('setContext', 'muTwo.connectedHardware.exists', false);
			this.updateGlobalPanelsContext();
		});

		vscode.commands.executeCommand('setContext', 'muTwo.connectedHardware.exists', true);
		this.logger.info('EXTENSION', 'Connected Hardware panel created');

		return hardwarePanel;
	}

	/**
	 * Create or show a connected plotter panel
	 */
	async createOrShowPlotterPanel(sourceEditor?: vscode.TextEditor): Promise<ConnectedPlotterPanel> {
		const panelId = this.generatePanelId(sourceEditor);

		// Check if panel already exists
		if (this.activePlotterPanels.has(panelId)) {
			const existingPanel = this.activePlotterPanels.get(panelId)!;
			existingPanel.reveal();
			return existingPanel;
		}

		// Create new plotter panel in Column Two
		const panel = vscode.window.createWebviewPanel(
			'muTwo.connectedPlotter',
			`Plotter - ${sourceEditor?.document.fileName?.split(/[\\/]/).pop() || 'Untitled'}`,
			{ viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri]
			}
		);

		panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'Mu2NoCirc-Red.svg');

		// Set up panel focus tracking for context variables
		panel.onDidChangeViewState((e) => {
			if (e.webviewPanel.active) {
				vscode.commands.executeCommand('setContext', 'activeWebviewPanelId', 'muTwo.connectedPlotter');
				vscode.commands.executeCommand('setContext', 'muTwo.panelsActive', true);
			}
		});

		const plotterPanel = new ConnectedPlotterPanel(
			panel,
			this.context,
			sourceEditor,
			this.plotterTabHelper
		);

		// Track panel and handle disposal
		this.activePlotterPanels.set(panelId, plotterPanel);
		panel.onDidDispose(() => {
			this.activePlotterPanels.delete(panelId);
			vscode.commands.executeCommand('setContext', 'muTwo.connectedPlotter.exists', false);
			this.updateGlobalPanelsContext();
		});

		vscode.commands.executeCommand('setContext', 'muTwo.connectedPlotter.exists', true);
		this.logger.info('EXTENSION', 'Connected Plotter panel created');

		return plotterPanel;
	}

	dispose(): void {
		for (const panel of this.activePanels.values()) {
			panel.dispose();
		}
		for (const panel of this.activeHardwarePanels.values()) {
			panel.dispose();
		}
		for (const panel of this.activePlotterPanels.values()) {
			panel.dispose();
		}
		this.activePanels.clear();
		this.activeHardwarePanels.clear();
		this.activePlotterPanels.clear();
	}
}

/**
 * ConnectedReplPanel - Individual connected REPL instance
 *
 * Provides workspace-aware REPL that can read/execute editor contents
 * with optional plotter tab for visual data output
 */
export class ConnectedReplPanel {
	private panel: vscode.WebviewPanel;
	private context: vscode.ExtensionContext;
	private sourceEditor?: vscode.TextEditor;
	private boardDetectionHelper: BoardDetectionHelper;
	private replSessionHelper: ReplSessionHelper;
	private plotterTabHelper: PlotterTabHelper;
	private hasPlotterTab: boolean = false;
	private isHidden: boolean = false;
	private headerCollapsed: boolean = true;
	private logger = getLogger();

	constructor(
		panel: vscode.WebviewPanel,
		context: vscode.ExtensionContext,
		sourceEditor: vscode.TextEditor | undefined,
		boardDetectionHelper: BoardDetectionHelper,
		replSessionHelper: ReplSessionHelper,
		plotterTabHelper: PlotterTabHelper
	) {
		this.panel = panel;
		this.context = context;
		this.sourceEditor = sourceEditor;
		this.boardDetectionHelper = boardDetectionHelper;
		this.replSessionHelper = replSessionHelper;
		this.plotterTabHelper = plotterTabHelper;

		this.setupWebview();
		this.setupMessageHandling();

		// Initialize context variables - header starts collapsed (hidden)
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', true);
		this.logger.info('EXTENSION', 'Initialized context: muTwo.connectedRepl.headerCollapsed = true');
	}

	private setupWebview(): void {
		const nonce = getNonce();
		const webview = this.panel.webview;

		// Set webview HTML for connected REPL
		this.panel.webview.html = this.getWebviewContent(nonce);
	}

	private setupMessageHandling(): void {
		this.panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'executeEditorCode':
					await this.executeEditorCode();
					break;
				case 'addPlotterTab':
					await this.addPlotterTab();
					break;
				case 'connectToBoard':
					await this.connectToBoard(message.boardId);
					break;
				case 'replCommand':
					await this.handleReplCommand(message.command);
					break;
				case 'drawerStateChanged':
					// Handle hardware drawer state change
					this.logger.info('EXTENSION', `Connected REPL drawer ${message.expanded ? 'expanded' : 'collapsed'}`);
					break;
				case 'dataPublish':
				case 'dataRequest':
				case 'sensorDataStream':
				case 'hardwareSimulation':
					// Forward data coordination messages to ReplCoordinator
					// The coordinator will handle these via its message handling setup
					this.logger.info('EXTENSION', `Connected REPL data coordination message: ${message.type}`);
					break;
				case 'webviewReady':
					// Forward to replViewProvider-style initialization
					this.logger.info('EXTENSION', 'Connected REPL webview ready');

					// Initialize the terminal with a single clean path to avoid multiple prompts
					setTimeout(() => {
						// Send venv ready message to transition from awaiting_venv to idle
						this.panel.webview.postMessage({
							type: 'venv_ready',
							data: { ready: true }
						});

						// Send initial session restore with proper state - this will show the single prompt
						setTimeout(() => {
							this.panel.webview.postMessage({
								type: 'sessionRestore',
								data: {
									sessionContent: '',
									initialState: true,
									replState: 'idle' // Force idle state and show single prompt
								}
							});
						}, 150); // Wait for venv_ready to complete state transition
					}, 50);
					break;
				case 'requestRestore':
					// Terminal wants its session content restored
					// Skip duplicate sessionRestore during initial setup to avoid double prompts
					this.logger.info('EXTENSION', 'Connected REPL requestRestore - skipping to avoid duplicate prompts');
					this.panel.webview.postMessage({
						type: 'commandHistory',
						data: { commands: [] }
					});
					break;
				// Forward all other REPL messages to existing handlers
				default:
					// Let existing panel-specific handlers process the message
					break;
			}
		});
	}

	/**
	 * Execute code from the connected editor
	 */
	private async executeEditorCode(): Promise<void> {
		if (!this.sourceEditor) {
			return;
		}

		// Initialize board association if not done
		const boardAssociation = await this.boardDetectionHelper.detectAndAssociate();

		// Initialize REPL session if not done
		const session = await this.replSessionHelper.initializeSession(boardAssociation);

		// Execute editor content
		await this.replSessionHelper.executeEditorContent(session.id);
	}

	/**
	 * Add plotter tab for visual data output
	 */
	private async addPlotterTab(): Promise<void> {
		if (this.hasPlotterTab) {
			return;
		}

		// Generate session ID for plotter
		const sessionId = `plotter-${Date.now()}`;

		this.logger.info('EXTENSION', 'Creating plotter tab for visual data output');

		try {
			// Create plotter tab using helper - it will handle positioning
			await this.plotterTabHelper.createPlotterTab(sessionId, 'CircuitPython Plotter');
			this.hasPlotterTab = true;
			this.logger.info('EXTENSION', 'Plotter tab created successfully');
		} catch (error) {
			this.logger.error('EXTENSION', 'Failed to create plotter tab:', error);
			throw error;
		}
	}

	private async connectToBoard(boardId: string): Promise<void> {
		// Use board detection helper to detect and associate
		const boardAssociation = await this.boardDetectionHelper.detectAndAssociate();
		this.logger.info('EXTENSION', `ConnectedReplPanel: Connected to board association:`, boardAssociation);
	}

	private async handleReplCommand(command: string): Promise<void> {
		// Get current session or create one
		const boardAssociation = await this.boardDetectionHelper.detectAndAssociate();
		const session = await this.replSessionHelper.initializeSession(boardAssociation);

		// For now, execute editor content - in future this could execute specific commands
		await this.replSessionHelper.executeEditorContent(session.id);
	}

	private getWebviewContent(nonce: string): string {
		// Simplified REPL-only webview using existing webview-repl infrastructure
		const webview = this.panel.webview;
		const extensionUri = this.context.extensionUri;

		// Get URIs for bundled webview-repl assets
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'public', 'repl', 'index.js')
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'public', 'repl', 'xterm.css')
		);
		const blinkafontUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'assets', 'font_experiments', 'FreeMono-Terminal-Blinka.ttf')
		);

		// Get URIs for VS Code WebView UI Toolkit
		const toolkitUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js')
		);

		// Get URI for data sharing module
		const dataSharingUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'views', 'webview-repl', 'src', 'dataSharing.js')
		);

		// Generate serial connection content for header
		const hardwareDrawerContent = new HardwareDrawerContent(this.context);
		const serialConnectionContent = hardwareDrawerContent.getSerialTabContent();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview: vscode-resource: https:; script-src 'nonce-${nonce}' vscode-webview:; style-src vscode-webview: vscode-resource: 'unsafe-inline' http: https: data:; font-src vscode-webview: vscode-resource: data:; worker-src 'self' blob:;">
	<title>Connected REPL - ${this.sourceEditor?.document.fileName?.split('\\').pop() || 'Untitled'}</title>

	<!-- Use same stylesheets as replViewProvider -->
	<link rel="stylesheet" href="${styleUri}">

	<!-- VS Code WebView UI Toolkit -->
	<script type="module" nonce="${nonce}" src="${toolkitUri}"></script>

	<style>
		/* Blinka Font Integration (same as replViewProvider) */
		@font-face {
			font-family: 'FreeMono-Terminal-Blinka';
			src: url('${blinkafontUri}') format('truetype');
			font-weight: normal;
			font-style: normal;
			font-display: fallback;
		}

		/* Clean frame layout for REPL-only */
		body {
			font-family: var(--vscode-font-family);
			background-color: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			margin: 0;
			padding: 0;
			height: 100vh;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}

		/* Header with serial connection controls */
		.panel-header {
			display: flex;
			align-items: center;
			background-color: var(--vscode-panel-background);
			border-bottom: 1px solid var(--vscode-panel-border);
			min-height: 35px;
			padding: 0 12px;
			transition: height 0.2s ease, opacity 0.2s ease;
		}

		.panel-header.hidden {
			height: 0;
			min-height: 0;
			opacity: 0;
			overflow: hidden;
			border-bottom: none;
			padding: 0;
		}

		.serial-controls {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.header-label {
			font-size: 13px;
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		/* Main terminal container */
		.main-container {
			flex: 1;
			overflow: hidden;
		}

		#terminal {
			width: 100%;
			height: 100%;
			background-color: var(--vscode-editor-background);
		}

		/* Terminal styling */
		.terminal {
			font-family: 'FreeMono-Terminal-Blinka', 'Courier New', 'Monaco', 'Liberation Mono', monospace !important;
		}
		.xterm {
			font-family: 'FreeMono-Terminal-Blinka', 'Courier New', 'Monaco', 'Liberation Mono', monospace !important;
			background-color: var(--vscode-editor-background) !important;
		}
		.xterm-viewport, .xterm-screen {
			font-family: 'FreeMono-Terminal-Blinka', 'Courier New', 'Monaco', 'Liberation Mono', monospace !important;
			background-color: var(--vscode-editor-background) !important;
		}

		/* Blinka Glyph in Prompt (same as replViewProvider) */
		.blinka-prompt::before {
			content: 'ϴ';
			margin-right: 4px;
			font-family: 'FreeMono-Terminal-Blinka', monospace;
		}

		@supports not (font-family: 'FreeMono-Terminal-Blinka') {
			.blinka-prompt::before {
				content: '🐍';
				font-family: inherit;
			}
		}
	</style>
</head>
<body>
	<!-- Header with serial connection controls - hidden by default -->
	<div class="panel-header hidden">
		<div class="serial-controls">
			<span class="header-label">Connected REPL</span>
			${serialConnectionContent}
		</div>
	</div>

	<!-- Main terminal container -->
	<div class="main-container">
		<div id="terminal"></div>
	</div>

	<script nonce="${nonce}">
		// REPL panel initialization script
		window.vscode = acquireVsCodeApi();
		window.panelMode = true;
		window.sourceEditor = '${this.sourceEditor?.document.fileName?.replace(/\\/g, '\\\\') || 'Unknown'}';

		// Extension message handling
		window.addEventListener('message', event => {
			const message = event.data;

			// Handle header show/hide messages
			switch (message.type) {
				case 'showHeader':
					showHeader();
					break;
				case 'hideHeader':
					hideHeader();
					break;
				default:
					// Forward terminal-related messages to terminal component
					if (window.terminal && typeof window.terminal.handleExtensionMessage === 'function') {
						window.terminal.handleExtensionMessage(message);
					}
					break;
			}
		});

		function showHeader() {
			const header = document.querySelector('.panel-header');
			if (header) {
				header.classList.remove('hidden');
				// Fit terminal after header animation
				setTimeout(() => {
					if (window.terminal && typeof window.terminal.fit === 'function') {
						window.terminal.fit();
					}
				}, 250);
			}
		}

		function hideHeader() {
			const header = document.querySelector('.panel-header');
			if (header) {
				header.classList.add('hidden');
				// Fit terminal after header animation
				setTimeout(() => {
					if (window.terminal && typeof window.terminal.fit === 'function') {
						window.terminal.fit();
					}
				}, 250);
			}
		}

		console.log('Connected REPL Panel initialized');
	</script>

	<!-- Load data sharing functionality -->
	<script nonce="${nonce}" src="${dataSharingUri}"></script>

	<!-- Main webview-repl script -->
	<script nonce="${nonce}" src="${scriptUri}"></script>

	<!-- Initialize data sharing after terminal is ready -->
	<script nonce="${nonce}">
		// Initialize data sharing when terminal becomes available
		function initializeDataSharing() {
			if (window.terminal && window.MuReplDataSharing) {
				window.dataSharing = new window.MuReplDataSharing(window.vscode, window.terminal);
				console.log('Data sharing initialized for connected REPL panel');
			} else {
				// Retry in 100ms if terminal not ready
				setTimeout(initializeDataSharing, 100);
			}
		}

		// Start initialization
		setTimeout(initializeDataSharing, 500);
	</script>
</body>
</html>`;
	}

	reveal(): void {
		this.panel.reveal();
		this.isHidden = false;
	}

	hide(): void {
		this.isHidden = true;

		this.logger.info('EXTENSION', 'ConnectedReplPanel.hide() called - disposing panel');

		// Update context variables first before disposing
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.exists', false);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.panelCollapsed', true);

		// Store reference to source editor to focus back to it
		const sourceEditor = this.sourceEditor;

		// Simply dispose the panel - VS Code will handle the layout automatically
		this.panel.dispose();

		// Try to focus back to the original editor if we have one
		if (sourceEditor) {
			setTimeout(() => {
				vscode.window.showTextDocument(sourceEditor.document, sourceEditor.viewColumn).then(() => {
					this.logger.info('EXTENSION', 'Focused back to source editor successfully');
				}).catch(error => {
					this.logger.warn('EXTENSION', 'Failed to focus back to source editor:', error);
				});
			}, 100);
		}

		this.logger.info('EXTENSION', 'Connected REPL panel disposed');
	}

	getIsHidden(): boolean {
		return this.isHidden;
	}

	getSourceEditor(): vscode.TextEditor | undefined {
		return this.sourceEditor;
	}

	showHeader(): void {
		this.logger.info('EXTENSION', 'ConnectedReplPanel.showHeader called');
		this.headerCollapsed = false;

		// Send message to webview to show header
		this.panel.webview.postMessage({
			type: 'showHeader'
		});
		this.logger.info('EXTENSION', 'Sent showHeader message to webview');

		// Update context variable
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', false);
	}

	hideHeader(): void {
		this.logger.info('EXTENSION', 'ConnectedReplPanel.hideHeader called');
		this.headerCollapsed = true;

		// Send message to webview to hide header
		this.panel.webview.postMessage({
			type: 'hideHeader'
		});
		this.logger.info('EXTENSION', 'Sent hideHeader message to webview');

		// Update context variable
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', true);
	}

	dispose(): void {
		this.panel.dispose();
	}
}

/**
 * ConnectedHardwarePanel - Hardware simulation and sensor controls
 */
export class ConnectedHardwarePanel {
	private panel: vscode.WebviewPanel;
	private context: vscode.ExtensionContext;
	private sourceEditor?: vscode.TextEditor;
	private boardDetectionHelper: BoardDetectionHelper;
	private logger = getLogger();

	constructor(
		panel: vscode.WebviewPanel,
		context: vscode.ExtensionContext,
		sourceEditor: vscode.TextEditor | undefined,
		boardDetectionHelper: BoardDetectionHelper
	) {
		this.panel = panel;
		this.context = context;
		this.sourceEditor = sourceEditor;
		this.boardDetectionHelper = boardDetectionHelper;

		this.setupWebview();
		this.setupMessageHandling();
	}

	private setupWebview(): void {
		const nonce = getNonce();
		this.panel.webview.html = this.getWebviewContent(nonce);
	}

	private setupMessageHandling(): void {
		this.panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'sensorUpdate':
					// Handle sensor simulation updates
					this.logger.info('EXTENSION', `Hardware panel sensor update: ${message.sensor} = ${message.value}`);
					break;
				case 'hardwareStateChange':
					// Handle hardware state changes
					this.logger.info('EXTENSION', `Hardware panel state change: ${message.device} = ${message.state}`);
					break;
				case 'webviewReady':
					this.logger.info('EXTENSION', 'Hardware panel webview ready');
					break;
			}
		});
	}

	private getWebviewContent(nonce: string): string {
		const webview = this.panel.webview;
		const extensionUri = this.context.extensionUri;

		// Get URIs for VS Code WebView UI Toolkit
		const toolkitUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js')
		);

		// Generate hardware simulation content
		const hardwareDrawerContent = new HardwareDrawerContent(this.context);
		const hardwareTabContent = hardwareDrawerContent.getHardwareTabContent();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview: vscode-resource: https:; script-src 'nonce-${nonce}' vscode-webview:; style-src vscode-webview: vscode-resource: 'unsafe-inline' http: https: data:; font-src vscode-webview: vscode-resource: data:;">
	<title>Hardware Simulator - ${this.sourceEditor?.document.fileName?.split('\\').pop() || 'Untitled'}</title>

	<!-- VS Code WebView UI Toolkit -->
	<script type="module" nonce="${nonce}" src="${toolkitUri}"></script>

	<style>
		body {
			font-family: var(--vscode-font-family);
			background-color: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			margin: 0;
			padding: 16px;
			height: 100vh;
			overflow-y: auto;
		}

		.hardware-container {
			max-width: 800px;
			margin: 0 auto;
		}

		.section {
			margin-bottom: 24px;
			padding: 16px;
			background-color: var(--vscode-sideBar-background);
			border-radius: 4px;
			border: 1px solid var(--vscode-panel-border);
		}

		.section-title {
			font-size: 16px;
			font-weight: 600;
			margin-bottom: 12px;
			color: var(--vscode-foreground);
		}

		.sensor-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
			gap: 16px;
		}

		.sensor-control {
			padding: 12px;
			background-color: var(--vscode-input-background);
			border-radius: 4px;
			border: 1px solid var(--vscode-input-border);
		}

		.sensor-label {
			font-weight: 500;
			margin-bottom: 8px;
			display: block;
		}

		.sensor-value {
			font-family: monospace;
			font-size: 14px;
			color: var(--vscode-textPreformat-foreground);
		}
	</style>
</head>
<body>
	<div class="hardware-container">
		<div class="section">
			<div class="section-title">Hardware Simulation</div>
			${hardwareTabContent}
		</div>

		<div class="section">
			<div class="section-title">Sensor Controls</div>
			<div class="sensor-grid">
				<div class="sensor-control">
					<label class="sensor-label">Temperature (°C)</label>
					<vscode-text-field id="temp-sensor" type="number" value="25.0" step="0.1"></vscode-text-field>
					<div class="sensor-value">sensor.temperature = <span id="temp-value">25.0</span></div>
				</div>

				<div class="sensor-control">
					<label class="sensor-label">Humidity (%)</label>
					<vscode-text-field id="humidity-sensor" type="number" value="50.0" step="0.1" min="0" max="100"></vscode-text-field>
					<div class="sensor-value">sensor.humidity = <span id="humidity-value">50.0</span></div>
				</div>

				<div class="sensor-control">
					<label class="sensor-label">Light Level (lux)</label>
					<vscode-text-field id="light-sensor" type="number" value="300" step="1" min="0"></vscode-text-field>
					<div class="sensor-value">sensor.light = <span id="light-value">300</span></div>
				</div>

				<div class="sensor-control">
					<label class="sensor-label">Accelerometer X</label>
					<vscode-text-field id="accel-x-sensor" type="number" value="0.0" step="0.1" min="-10" max="10"></vscode-text-field>
					<div class="sensor-value">sensor.accel.x = <span id="accel-x-value">0.0</span></div>
				</div>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		window.vscode = acquireVsCodeApi();

		// Initialize sensor controls
		document.addEventListener('DOMContentLoaded', () => {
			initializeSensorControls();
			notifyWebviewReady();
		});

		function initializeSensorControls() {
			// Temperature sensor
			const tempSensor = document.getElementById('temp-sensor');
			const tempValue = document.getElementById('temp-value');
			tempSensor?.addEventListener('input', (e) => {
				const value = e.target.value;
				tempValue.textContent = value;
				publishSensorData('temperature', parseFloat(value));
			});

			// Humidity sensor
			const humiditySensor = document.getElementById('humidity-sensor');
			const humidityValue = document.getElementById('humidity-value');
			humiditySensor?.addEventListener('input', (e) => {
				const value = e.target.value;
				humidityValue.textContent = value;
				publishSensorData('humidity', parseFloat(value));
			});

			// Light sensor
			const lightSensor = document.getElementById('light-sensor');
			const lightValue = document.getElementById('light-value');
			lightSensor?.addEventListener('input', (e) => {
				const value = e.target.value;
				lightValue.textContent = value;
				publishSensorData('light', parseInt(value));
			});

			// Accelerometer X
			const accelXSensor = document.getElementById('accel-x-sensor');
			const accelXValue = document.getElementById('accel-x-value');
			accelXSensor?.addEventListener('input', (e) => {
				const value = e.target.value;
				accelXValue.textContent = value;
				publishSensorData('accel.x', parseFloat(value));
			});
		}

		function publishSensorData(sensor, value) {
			window.vscode.postMessage({
				type: 'sensorUpdate',
				sensor: sensor,
				value: value,
				timestamp: Date.now()
			});
		}

		function notifyWebviewReady() {
			window.vscode.postMessage({
				type: 'webviewReady'
			});
		}

		console.log('Hardware simulation panel initialized');
	</script>
</body>
</html>`;
	}

	reveal(): void {
		this.panel.reveal();
	}

	dispose(): void {
		this.panel.dispose();
	}
}

/**
 * ConnectedPlotterPanel - Data visualization and plotting
 */
export class ConnectedPlotterPanel {
	private panel: vscode.WebviewPanel;
	private context: vscode.ExtensionContext;
	private sourceEditor?: vscode.TextEditor;
	private plotterTabHelper: PlotterTabHelper;
	private headerCollapsed: boolean = true;
	private logger = getLogger();

	constructor(
		panel: vscode.WebviewPanel,
		context: vscode.ExtensionContext,
		sourceEditor: vscode.TextEditor | undefined,
		plotterTabHelper: PlotterTabHelper
	) {
		this.panel = panel;
		this.context = context;
		this.sourceEditor = sourceEditor;
		this.plotterTabHelper = plotterTabHelper;

		this.setupWebview();
		this.setupMessageHandling();

		// Initialize context variables - header starts collapsed (hidden)
		vscode.commands.executeCommand('setContext', 'muTwo.connectedPlotter.headerCollapsed', true);
		this.logger.info('EXTENSION', 'Initialized context: muTwo.connectedPlotter.headerCollapsed = true');
	}

	private setupWebview(): void {
		const nonce = getNonce();
		this.panel.webview.html = this.getWebviewContent(nonce);
	}

	private setupMessageHandling(): void {
		this.panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case 'plotData':
					// Handle data plotting requests
					this.logger.info('EXTENSION', `Plotter panel plot data: ${message.data}`);
					break;
				case 'clearPlot':
					// Handle plot clearing
					this.logger.info('EXTENSION', 'Plotter panel clear plot');
					break;
				case 'showHeader':
					this.showHeader();
					break;
				case 'hideHeader':
					this.hideHeader();
					break;
				case 'toggleHeader':
					this.toggleHeader();
					break;
				case 'webviewReady':
					this.logger.info('EXTENSION', 'Plotter panel webview ready');
					break;
			}
		});
	}

	private showHeader(): void {
		this.headerCollapsed = false;
		vscode.commands.executeCommand('setContext', 'muTwo.connectedPlotter.headerCollapsed', false);
		this.panel.webview.postMessage({ type: 'showHeader' });
		this.logger.info('EXTENSION', 'Plotter panel header shown');
	}

	private hideHeader(): void {
		this.headerCollapsed = true;
		vscode.commands.executeCommand('setContext', 'muTwo.connectedPlotter.headerCollapsed', true);
		this.panel.webview.postMessage({ type: 'hideHeader' });
		this.logger.info('EXTENSION', 'Plotter panel header hidden');
	}

	private toggleHeader(): void {
		if (this.headerCollapsed) {
			this.showHeader();
		} else {
			this.hideHeader();
		}
	}

	private getWebviewContent(nonce: string): string {
		const webview = this.panel.webview;
		const extensionUri = this.context.extensionUri;

		// Get URIs for VS Code WebView UI Toolkit
		const toolkitUri = webview.asWebviewUri(
			vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'webview-ui-toolkit', 'dist', 'toolkit.js')
		);

		// Generate plotter settings content for header
		const plotterSettingsContent = this.getPlotterSettingsContent();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview: vscode-resource: https:; script-src 'nonce-${nonce}' vscode-webview: 'unsafe-inline'; style-src vscode-webview: vscode-resource: 'unsafe-inline' http: https: data:; font-src vscode-webview: vscode-resource: data:;">
	<title>Data Plotter - ${this.sourceEditor?.document.fileName?.split('\\').pop() || 'Untitled'}</title>

	<!-- VS Code WebView UI Toolkit -->
	<script type="module" nonce="${nonce}" src="${toolkitUri}"></script>

	<style>
		body {
			font-family: var(--vscode-font-family);
			background-color: var(--vscode-editor-background);
			color: var(--vscode-foreground);
			margin: 0;
			padding: 0;
			height: 100vh;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}

		/* Header with plotter settings controls */
		.panel-header {
			display: flex;
			align-items: center;
			background-color: var(--vscode-panel-background);
			border-bottom: 1px solid var(--vscode-panel-border);
			min-height: 35px;
			padding: 0 12px;
			transition: height 0.2s ease, opacity 0.2s ease;
		}

		.panel-header.hidden {
			height: 0;
			min-height: 0;
			opacity: 0;
			overflow: hidden;
			border-bottom: none;
			padding: 0;
		}

		.plotter-controls {
			display: flex;
			align-items: center;
			gap: 12px;
		}

		.header-label {
			font-size: 13px;
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		/* Main plotter container - terminal-like */
		.main-container {
			flex: 1;
			overflow: hidden;
			display: flex;
			flex-direction: column;
		}

		.plotter-viewport {
			flex: 1;
			overflow-y: auto;
			overflow-x: hidden;
			background-color: var(--vscode-editor-background);
			padding: 8px;
		}

		.plot-container {
			display: flex;
			flex-direction: column;
			gap: 16px;
			min-height: 100%;
		}

		.plot-item {
			background-color: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			padding: 12px;
			min-height: 150px;
			max-height: 80vh;
			position: relative;
			resize: vertical;
			overflow: hidden;
		}

		.plot-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 8px;
			font-size: 12px;
			color: var(--vscode-descriptionForeground);
		}

		.plot-title {
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.plot-timestamp {
			font-family: monospace;
		}

		.plot-canvas {
			width: 100%;
			height: 100%;
			min-height: 120px;
			display: block;
			background-color: var(--vscode-editor-background);
		}

		.plot-canvas-container {
			flex: 1;
			min-height: 120px;
			position: relative;
		}

		.placeholder {
			position: absolute;
			top: 50%;
			left: 50%;
			transform: translate(-50%, -50%);
			color: var(--vscode-descriptionForeground);
			text-align: center;
		}

		.status-bar {
			background-color: var(--vscode-statusBar-background);
			border-top: 1px solid var(--vscode-statusBar-border);
			padding: 4px 12px;
			font-size: 12px;
			font-family: monospace;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}

		.status-left {
			color: var(--vscode-statusBar-foreground);
		}

		.status-right {
			color: var(--vscode-statusBar-foreground);
			display: flex;
			gap: 16px;
		}

		/* Adaptive height classes */
		.plot-item.compact {
			min-height: 120px;
			max-height: 200px;
		}

		.plot-item.standard {
			min-height: 180px;
			max-height: 300px;
		}

		.plot-item.expanded {
			min-height: 250px;
			max-height: 60vh;
		}

		.plot-item.full {
			min-height: 400px;
			max-height: 80vh;
		}

		/* Height resize handle styling */
		.plot-item::-webkit-resizer {
			background-color: var(--vscode-panel-border);
		}
	</style>
</head>
<body>
	<!-- Header with plotter settings controls - hidden by default -->
	<div class="panel-header hidden">
		<div class="plotter-controls">
			<span class="header-label">Data Plotter</span>
			${plotterSettingsContent}
		</div>
	</div>

	<!-- Main plotter container - terminal-like -->
	<div class="main-container">
		<div class="plotter-viewport" id="plotter-viewport">
			<div class="plot-container" id="plot-container">
				<!-- Default placeholder when no plots exist -->
				<div class="plot-item" id="placeholder-plot">
					<div class="placeholder">
						<div>📊 Data Plotter</div>
						<div style="margin-top: 8px; font-size: 14px;">Run your CircuitPython code to see real-time data visualization</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Status bar like terminal -->
		<div class="status-bar">
			<div class="status-left">
				Data Plotter - <span id="status-message">Ready</span>
			</div>
			<div class="status-right">
				<span>Plots: <span id="plot-count">0</span></span>
				<span>Points: <span id="data-count">0</span></span>
				<span id="last-update">Never</span>
			</div>
		</div>
	</div>
	</div>

	<script nonce="${nonce}">
		window.vscode = acquireVsCodeApi();

		let plots = new Map(); // plotId -> { data: [], canvas: element, ctx: context, title: string }
		let autoUpdateEnabled = true;
		let autoScaleEnabled = true;
		let adaptiveHeightEnabled = false;
		let defaultPlotHeight = 'standard';
		let totalDataPoints = 0;

		document.addEventListener('DOMContentLoaded', () => {
			initializePlotter();
			notifyWebviewReady();
		});

		function initializePlotter() {
			// Set up header controls (when header is visible)
			setupHeaderControls();

			// Handle window resize
			window.addEventListener('resize', () => {
				plots.forEach(plot => resizeCanvas(plot.canvas));
			});
		}

		function setupHeaderControls() {
			// These controls are in the header dropdown
			document.getElementById('clear-plot')?.addEventListener('click', clearAllPlots);

			document.getElementById('auto-update-checkbox')?.addEventListener('change', (e) => {
				autoUpdateEnabled = e.target.checked;
				updateStatusMessage(\`Auto-update \${autoUpdateEnabled ? 'enabled' : 'disabled'}\`);
			});

			document.getElementById('auto-scale-checkbox')?.addEventListener('change', (e) => {
				autoScaleEnabled = e.target.checked;
				if (autoScaleEnabled) {
					plots.forEach((plot, plotId) => autoScalePlot(plotId));
				}
			});

			document.getElementById('adaptive-height-checkbox')?.addEventListener('change', (e) => {
				adaptiveHeightEnabled = e.target.checked;
				updateStatusMessage(\`Adaptive height \${adaptiveHeightEnabled ? 'enabled' : 'disabled'}\`);
				plots.forEach((plot, plotId) => updatePlotHeight(plotId));
			});

			document.getElementById('plot-height-dropdown')?.addEventListener('change', (e) => {
				defaultPlotHeight = e.target.value;
				plots.forEach((plot, plotId) => setPlotHeight(plotId, defaultPlotHeight));
				updateStatusMessage(\`Plot height: \${defaultPlotHeight}\`);
			});
		}

		function createPlot(plotId, title = 'Data Plot') {
			// Hide placeholder if this is first plot
			if (plots.size === 0) {
				document.getElementById('placeholder-plot').style.display = 'none';
			}

			const plotContainer = document.getElementById('plot-container');

			const plotItem = document.createElement('div');
			plotItem.className = 'plot-item';
			plotItem.id = \`plot-\${plotId}\`;

			plotItem.innerHTML = \`
				<div class="plot-header">
					<span class="plot-title">\${title}</span>
					<span class="plot-timestamp">\${new Date().toLocaleTimeString()}</span>
				</div>
				<div class="plot-canvas-container">
					<canvas class="plot-canvas" id="canvas-\${plotId}"></canvas>
				</div>
			\`;

			plotContainer.appendChild(plotItem);

			const canvas = document.getElementById(\`canvas-\${plotId}\`);
			const ctx = canvas.getContext('2d');

			const plot = {
				data: [],
				canvas: canvas,
				ctx: ctx,
				title: title,
				element: plotItem
			};

			plots.set(plotId, plot);

			// Set initial height and resize canvas
			setPlotHeight(plotId, defaultPlotHeight);
			resizeCanvas(canvas);
			updatePlotCount();

			// Auto-scroll to new plot
			plotItem.scrollIntoView({ behavior: 'smooth', block: 'end' });

			return plot;
		}

		function addDataPoint(plotId, value, timestamp = Date.now(), title = 'Data Plot') {
			if (!autoUpdateEnabled) return;

			let plot = plots.get(plotId);
			if (!plot) {
				plot = createPlot(plotId, title);
			}

			plot.data.push({ value, timestamp });

			// Keep only last 1000 points per plot
			if (plot.data.length > 1000) {
				plot.data.shift();
			}

			totalDataPoints++;
			updateDataCount();
			redrawPlot(plotId);

			// Auto-scale if enabled
			if (autoScaleEnabled) {
				autoScalePlot(plotId);
			}

			// Update height if adaptive height is enabled
			if (adaptiveHeightEnabled) {
				updatePlotHeight(plotId);
			}
		}

		function resizeCanvas(canvas) {
			const container = canvas.parentElement;
			canvas.width = container.offsetWidth - 24; // Account for padding
			canvas.height = container.offsetHeight - 4; // Account for container padding
		}

		function setPlotHeight(plotId, heightClass) {
			const plot = plots.get(plotId);
			if (!plot) return;

			// Remove existing height classes
			plot.element.classList.remove('compact', 'standard', 'expanded', 'full');

			// Add new height class
			plot.element.classList.add(heightClass);

			// Resize canvas after height change
			setTimeout(() => resizeCanvas(plot.canvas), 50);
		}

		function updatePlotHeight(plotId) {
			if (!adaptiveHeightEnabled) return;

			const plot = plots.get(plotId);
			if (!plot || plot.data.length === 0) return;

			// Calculate adaptive height based on data characteristics
			const dataPoints = plot.data.length;
			const values = plot.data.map(p => p.value);
			const range = Math.max(...values) - Math.min(...values);
			const variance = calculateVariance(values);

			let suggestedHeight = 'standard';

			// More data points or higher variance suggests larger plot
			if (dataPoints > 500 || variance > range * 0.3) {
				suggestedHeight = 'expanded';
			} else if (dataPoints > 200 || variance > range * 0.1) {
				suggestedHeight = 'standard';
			} else {
				suggestedHeight = 'compact';
			}

			setPlotHeight(plotId, suggestedHeight);
		}

		function calculateVariance(values) {
			if (values.length === 0) return 0;

			const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
			const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
			return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
		}

		function clearAllPlots() {
			plots.forEach((plot, plotId) => {
				plot.element.remove();
			});
			plots.clear();
			totalDataPoints = 0;
			updateDataCount();
			updatePlotCount();

			// Show placeholder
			document.getElementById('placeholder-plot').style.display = 'block';

			window.vscode.postMessage({
				type: 'clearPlot'
			});
		}

		function autoScalePlot(plotId) {
			const plot = plots.get(plotId);
			if (!plot || plot.data.length === 0) return;

			// Auto-scaling logic here
			redrawPlot(plotId);
		}

		function redrawPlot(plotId) {
			const plot = plots.get(plotId);
			if (!plot || !plot.ctx || plot.data.length === 0) {
				return;
			}

			const { ctx, canvas, data } = plot;
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Find min/max values for scaling
			const values = data.map(p => p.value);
			const minValue = Math.min(...values);
			const maxValue = Math.max(...values);
			const range = maxValue - minValue || 1;

			// Draw plot lines
			ctx.strokeStyle = '#007ACC';
			ctx.lineWidth = 2;
			ctx.beginPath();

			data.forEach((point, index) => {
				const x = (index / (data.length - 1)) * canvas.width;
				const y = canvas.height - ((point.value - minValue) / range) * canvas.height;

				if (index === 0) {
					ctx.moveTo(x, y);
				} else {
					ctx.lineTo(x, y);
				}
			});

			ctx.stroke();

			// Draw axes
			ctx.strokeStyle = 'var(--vscode-panel-border)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(0, canvas.height - 1);
			ctx.lineTo(canvas.width, canvas.height - 1);
			ctx.stroke();
		}

		function updateDataCount() {
			document.getElementById('data-count').textContent = totalDataPoints;
			document.getElementById('last-update').textContent = new Date().toLocaleTimeString();
		}

		function updatePlotCount() {
			document.getElementById('plot-count').textContent = plots.size;
		}

		function updateStatusMessage(message) {
			document.getElementById('status-message').textContent = message;
			setTimeout(() => {
				document.getElementById('status-message').textContent = 'Ready';
			}, 2000);
		}

		function notifyWebviewReady() {
			window.vscode.postMessage({
				type: 'webviewReady'
			});
		}

		// Listen for data from extension
		window.addEventListener('message', event => {
			const message = event.data;

			switch (message.type) {
				case 'plotData':
					// Support both single value and multi-plot data
					if (message.plotId) {
						addDataPoint(message.plotId, message.value, message.timestamp, message.title);
					} else {
						// Default plot for backward compatibility
						addDataPoint('default', message.value, message.timestamp, 'Data Plot');
					}
					break;
				case 'clearPlot':
					if (message.plotId) {
						clearPlot(message.plotId);
					} else {
						clearAllPlots();
					}
					break;
				case 'showHeader':
					showHeader();
					break;
				case 'hideHeader':
					hideHeader();
					break;
			}
		});

		function clearPlot(plotId) {
			const plot = plots.get(plotId);
			if (plot) {
				plot.element.remove();
				plots.delete(plotId);
				updatePlotCount();

				// Show placeholder if no plots remain
				if (plots.size === 0) {
					document.getElementById('placeholder-plot').style.display = 'block';
				}
			}
		}

		function showHeader() {
			const header = document.querySelector('.panel-header');
			if (header) {
				header.classList.remove('hidden');
				// Re-setup header controls since they may be newly available
				setTimeout(() => {
					setupHeaderControls();
					plots.forEach(plot => resizeCanvas(plot.canvas));
				}, 250);
			}
		}

		function hideHeader() {
			const header = document.querySelector('.panel-header');
			if (header) {
				header.classList.add('hidden');
				// Resize canvases after header animation
				setTimeout(() => {
					plots.forEach(plot => resizeCanvas(plot.canvas));
				}, 250);
			}
		}

		console.log('Data plotter panel initialized');
	</script>
</body>
</html>`;
	}

	private getPlotterSettingsContent(): string {
		return `
			<vscode-dropdown id="plot-type-dropdown" position="below">
				<vscode-option value="line">Line Plot</vscode-option>
				<vscode-option value="scatter">Scatter Plot</vscode-option>
				<vscode-option value="bar">Bar Chart</vscode-option>
			</vscode-dropdown>

			<vscode-dropdown id="data-source-dropdown" position="below">
				<vscode-option value="sensor">Sensor Data</vscode-option>
				<vscode-option value="variable">Variable Watch</vscode-option>
				<vscode-option value="custom">Custom Stream</vscode-option>
			</vscode-dropdown>

			<vscode-dropdown id="plot-height-dropdown" position="below">
				<vscode-option value="compact">Compact</vscode-option>
				<vscode-option value="standard" selected>Standard</vscode-option>
				<vscode-option value="expanded">Expanded</vscode-option>
				<vscode-option value="full">Full Height</vscode-option>
			</vscode-dropdown>

			<vscode-checkbox id="auto-update-checkbox" checked>Auto Update</vscode-checkbox>
			<vscode-checkbox id="auto-scale-checkbox" checked>Auto Scale</vscode-checkbox>
			<vscode-checkbox id="adaptive-height-checkbox">Adaptive Height</vscode-checkbox>

			<vscode-button id="clear-plot" appearance="secondary">Clear Plot</vscode-button>
			<vscode-button id="export-data" appearance="secondary">Export</vscode-button>
			<vscode-button id="plotter-settings" appearance="icon" aria-label="Plotter Settings">
				<span class="codicon codicon-settings-gear"></span>
			</vscode-button>
		`;
	}

	reveal(): void {
		this.panel.reveal();
	}

	dispose(): void {
		this.panel.dispose();
	}
}