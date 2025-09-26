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
		// Start with header collapsed so show button appears initially
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.exists', false);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.panelCollapsed', true);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', true);
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
				}
			});

			// Set initial context for the active panel
			vscode.commands.executeCommand('setContext', 'activeWebviewPanelId', 'muTwo.connectedRepl');
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
	 * Get all active connected REPL panels
	 */
	getActivePanels(): ConnectedReplPanel[] {
		return Array.from(this.activePanels.values());
	}


	dispose(): void {
		for (const panel of this.activePanels.values()) {
			panel.dispose();
		}
		this.activePanels.clear();
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
		// Use the existing webview-repl infrastructure with enhanced panel configuration
		// Following the same pattern as replViewProvider.ts
		const webview = this.panel.webview;
		const extensionUri = this.context.extensionUri;

		// Get URIs for bundled webview-repl assets (same as replViewProvider)
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

		// Generate hardware drawer content using the service directly
		const hardwareDrawerContent = new HardwareDrawerContent(this.context);
		const hardwareTabContent = hardwareDrawerContent.getHardwareTabContent();
		const serialTabContent = hardwareDrawerContent.getSerialTabContent();
		const plotterTabContent = hardwareDrawerContent.getPlotterTabContent();

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

		/* Clean frame layout - no overlays */
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

		/* Header with VS Code-style panel tabs */
		.panel-header {
			display: flex;
			background-color: var(--vscode-panel-background);
			border-bottom: 1px solid var(--vscode-panel-border);
			min-height: 35px;
			transition: height 0.2s ease, opacity 0.2s ease;
		}

		.panel-header.hidden {
			height: 0;
			min-height: 0;
			opacity: 0;
			overflow: hidden;
			border-bottom: none;
		}

		.panel-tabs {
			display: flex;
			align-items: stretch;
		}

		.panel-tab {
			background: transparent;
			color: var(--vscode-tab-inactiveForeground);
			border: none;
			padding: 8px 16px;
			cursor: pointer;
			font-size: 13px;
			font-family: var(--vscode-font-family);
			position: relative;
			border-bottom: 2px solid transparent;
		}

		.panel-tab:hover {
			color: var(--vscode-tab-activeForeground);
		}

		.panel-tab.active {
			color: var(--vscode-tab-activeForeground);
			border-bottom-color: var(--vscode-tab-activeBorder);
		}

		/* Main container with content panels */
		.main-container {
			flex: 1;
			overflow: hidden;
			position: relative;
		}

		/* Content panels */
		.content-panel {
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			display: none;
			overflow: auto;
		}

		.content-panel.active {
			display: block;
		}

		/* REPL panel styling */
		#repl-panel {
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

		/* Hardware/Serial/Plotter panels */
		#hardware-panel,
		#serial-panel,
		#plotter-panel {
			padding: 16px;
			background-color: var(--vscode-sideBar-background);
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
	<!-- Header with VS Code-style panel tabs - hidden by default -->
	<div class="panel-header hidden">
		<div class="panel-tabs">
			<button class="panel-tab active" data-tab="repl">REPL</button>
			<button class="panel-tab" data-tab="hardware">Hardware</button>
			<button class="panel-tab" data-tab="serial">Serial</button>
			<button class="panel-tab" data-tab="plotter">Plotter</button>
		</div>
	</div>

	<!-- Main container with content panels -->
	<div class="main-container">
		<div id="repl-panel" class="content-panel active">
			<div id="terminal"></div>
		</div>

		<div id="hardware-panel" class="content-panel">
			${hardwareTabContent}
		</div>

		<div id="serial-panel" class="content-panel">
			${serialTabContent}
		</div>

		<div id="plotter-panel" class="content-panel">
			${plotterTabContent}
		</div>
	</div>

	<script nonce="${nonce}">
		// Panel initialization script - handles VS Code-style tabs
		window.vscode = acquireVsCodeApi();
		window.panelMode = true;
		window.sourceEditor = '${this.sourceEditor?.document.fileName?.replace(/\\/g, '\\\\') || 'Unknown'}';

		// Initialize UI frame when DOM is ready
		document.addEventListener('DOMContentLoaded', () => {
			initializePanelFrame();
		});

		function initializePanelFrame() {
			// Tab switching functionality
			document.querySelectorAll('.panel-tab').forEach(tab => {
				tab.addEventListener('click', (e) => {
					const tabName = e.target.dataset.tab;
					if (tabName) switchTab(tabName);
				});
			});
		}

		function switchTab(tabName) {
			// Update tab appearance
			document.querySelectorAll('.panel-tab').forEach(tab => {
				tab.classList.remove('active');
			});
			document.querySelector('[data-tab="' + tabName + '"]').classList.add('active');

			// Update content panels
			document.querySelectorAll('.content-panel').forEach(panel => {
				panel.classList.remove('active');
			});
			document.getElementById(tabName + '-panel').classList.add('active');

			// Notify extension of tab change
			window.vscode.postMessage({
				type: 'tabChanged',
				tab: tabName
			});

			// Fit terminal if switching to REPL tab
			if (tabName === 'repl') {
				setTimeout(() => {
					if (window.terminal && typeof window.terminal.fit === 'function') {
						window.terminal.fit();
					}
				}, 50);
			}
		}

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

		console.log('Connected REPL Panel with VS Code-style tabs initialized');
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