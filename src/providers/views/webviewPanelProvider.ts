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
		// Start with collapsed=true so show button appears initially
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.exists', false);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.panelCollapsed', true);
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', false);
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
	private headerCollapsed: boolean = false;
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

		// Initialize context variables
		vscode.commands.executeCommand('setContext', 'muTwo.connectedRepl.headerCollapsed', false);
		this.logger.info('EXTENSION', 'Initialized context: muTwo.connectedRepl.headerCollapsed = false');
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
		// Create custom webview with tabbed interface for Terminal (REPL) and Plotter
		// Uses the logic from Terminal.tsx and Plotter.tsx but as vanilla JS/HTML
		const xtermCssUri = this.panel.webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css')
		);
// TODO: Switch to bundled modules
		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src vscode-webview: vscode-resource: https:; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src vscode-webview: vscode-resource: 'unsafe-inline' https://cdn.jsdelivr.net; font-src vscode-webview: vscode-resource: data:; worker-src 'self' blob:;">
	<title>Connected REPL</title>
	<link rel="stylesheet" href="${xtermCssUri}">
	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
	<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/chart.js"></script>
	<style>
		body {
			font-family: var(--vscode-font-family);
			background-color: var(--vscode-panel-background);
			color: var(--vscode-foreground);
			margin: 0;
			padding: 0;
			height: 100vh;
			overflow: hidden;
		}

		.tab-container {
			display: flex;
			flex-direction: column;
			height: 100vh;
		}

		.tab-header {
			display: flex;
			background-color: var(--vscode-tab-activeBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
			padding: 0;
		}

		.tab-button {
			background: var(--vscode-tab-inactiveBackground);
			color: var(--vscode-tab-inactiveForeground);
			border: none;
			padding: 4px 12px;
			cursor: pointer;
			border-right: 1px solid var(--vscode-panel-border);
			font-size: 12px;
		}

		.tab-button.active {
			background: var(--vscode-tab-activeBackground);
			color: var(--vscode-tab-activeForeground);
		}

		.tab-button:hover {
			background: var(--vscode-tab-hoverBackground);
		}

		.status-light {
			display: inline-block;
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: #22c55e;
			margin-right: 6px;
			box-shadow: 0 0 4px rgba(34, 197, 94, 0.6);
		}

		.tab-content {
			flex: 1;
			overflow: hidden;
		}

		.tab-panel {
			height: 100%;
			display: none;
		}

		.tab-panel.active {
			display: block;
		}

		#terminal-container {
			height: 100%;
			padding: 4px;
		}

		#plotter-container {
			height: 100%;
			padding: 8px;
		}

		#plotter-chart {
			height: calc(100% - 45px);
			width: 100%;
		}

		.plotter-controls {
			display: flex;
			gap: 8px;
			margin-bottom: 8px;
			align-items: center;
		}

		.plotter-controls button {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 6px 12px;
			cursor: pointer;
			border-radius: 3px;
			font-size: 12px;
		}

		.plotter-controls button:hover {
			background: var(--vscode-button-hoverBackground);
		}
	</style>
</head>
<body>
	<div class="tab-container">
		<div class="tab-header" id="tabHeader">
			<button class="tab-button active" onclick="switchTab('terminal')">
				<span class="status-light"></span>REPL
			</button>
			<button class="tab-button" onclick="switchTab('plotter')">Plotter</button>
		</div>

		<div class="tab-content">
			<div id="terminal-panel" class="tab-panel active">
				<div id="terminal-container"></div>
			</div>

			<div id="plotter-panel" class="tab-panel">
				<div id="plotter-container">
					<div class="plotter-controls">
						<button onclick="clearPlotterData()">Clear</button>
						<button onclick="pauseResumePlotter()">Pause</button>
						<button onclick="exportPlotterData()">Export</button>
					</div>
					<canvas id="plotter-chart"></canvas>
				</div>
			</div>
		</div>
	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();
		const sourceFileName = '${this.sourceEditor?.document.fileName?.replace(/\\/g, '\\\\') || 'Unknown'}';

		// Terminal setup (based on Terminal.tsx logic)
		let terminal = null;
		let fitAddon = null;
		let chart = null;
		let plotterPaused = false;

		// Tab management
		function switchTab(tabName) {
			// Hide all panels
			document.querySelectorAll('.tab-panel').forEach(panel => {
				panel.classList.remove('active');
			});
			document.querySelectorAll('.tab-button').forEach(button => {
				button.classList.remove('active');
			});

			// Show selected panel
			document.getElementById(tabName + '-panel').classList.add('active');
			event.target.classList.add('active');

			// Fit terminal if switching to terminal tab
			if (tabName === 'terminal' && terminal && fitAddon) {
				setTimeout(() => fitAddon.fit(), 100);
			}
		}

		// Initialize terminal (based on Terminal.tsx)
		function initTerminal() {
			const container = document.getElementById('terminal-container');

			terminal = new window.Terminal({
				theme: {
					background: 'var(--vscode-terminal-background)',
					foreground: 'var(--vscode-terminal-foreground)',
					cursor: 'var(--vscode-terminalCursor-foreground)'
				},
				fontFamily: 'var(--vscode-editor-font-family)',
				fontSize: 14,
				cursorBlink: true,
				scrollback: 1000
			});

			fitAddon = new window.FitAddon.FitAddon();
			terminal.loadAddon(fitAddon);

			terminal.open(container);
			fitAddon.fit();

			// Terminal event handlers
			terminal.onData(data => {
				vscode.postMessage({
					type: 'terminalInput',
					data: data
				});
			});

			// Start with prompt
			terminal.write('>>> ');
		}

		// Initialize plotter (based on Plotter.tsx logic)
		function initPlotter() {
			const ctx = document.getElementById('plotter-chart').getContext('2d');
			chart = new window.Chart(ctx, {
				type: 'line',
				data: {
					datasets: []
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					animation: {
						duration: 0
					},
					scales: {
						x: {
							type: 'linear',
							position: 'bottom',
							title: {
								display: true,
								text: 'Time (ms)'
							}
						},
						y: {
							title: {
								display: true,
								text: 'Value'
							}
						}
					}
				}
			});
		}

		// Plotter controls
		function clearPlotterData() {
			if (chart) {
				chart.data.datasets = [];
				chart.update();
			}
			vscode.postMessage({ type: 'clearPlotterData' });
		}

		function pauseResumePlotter() {
			plotterPaused = !plotterPaused;
			event.target.textContent = plotterPaused ? 'Resume' : 'Pause';
			vscode.postMessage({ type: 'pauseResumePlotter', paused: plotterPaused });
		}

		function exportPlotterData() {
			vscode.postMessage({ type: 'exportPlotterData' });
		}

		// Message handling from extension
		window.addEventListener('message', event => {
			const message = event.data;

			switch (message.type) {
				case 'terminalWrite':
					if (terminal) {
						terminal.write(message.data);
					}
					break;
				case 'plotterData':
					if (chart && !plotterPaused) {
						// Update chart with new data
						updatePlotterChart(message.data);
					}
					break;
				case 'showHeader':
					showTabHeader();
					break;
				case 'hideHeader':
					hideTabHeader();
					break;
			}
		});

		function updatePlotterChart(data) {
			// Add/update data series in chart
			if (chart) {
				chart.data.datasets = data.series || [];
				chart.update('none');
			}
		}

		function showTabHeader() {
			const tabHeader = document.getElementById('tabHeader');
			const tabContent = document.querySelector('.tab-content');

			tabHeader.style.display = 'flex';
			tabContent.style.height = 'calc(100vh - 33px)'; // Adjust for header height

			// Resize terminal and chart when header shows
			setTimeout(() => {
				if (terminal && fitAddon) {
					fitAddon.fit();
				}
				if (chart) {
					chart.resize();
				}
			}, 100);
		}

		function hideTabHeader() {
			const tabHeader = document.getElementById('tabHeader');
			const tabContent = document.querySelector('.tab-content');

			tabHeader.style.display = 'none';
			tabContent.style.height = '100vh';

			// Resize terminal and chart when header hides
			setTimeout(() => {
				if (terminal && fitAddon) {
					fitAddon.fit();
				}
				if (chart) {
					chart.resize();
				}
			}, 100);
		}

		// Initialize components
		document.addEventListener('DOMContentLoaded', () => {
			initTerminal();
			initPlotter();

			// Handle window resize
			window.addEventListener('resize', () => {
				if (terminal && fitAddon) {
					fitAddon.fit();
				}
				if (chart) {
					chart.resize();
				}
			});

			console.log('Connected REPL initialized with REPL and Plotter tabs');
			vscode.postMessage({ type: 'webviewReady' });
		});
	</script>
</body>
</html>`;
	}

	reveal(): void {
		this.panel.reveal();
		this.isHidden = false;
	}

	hide(): void {
		// Since VS Code doesn't have panel.hide(), we track state and handle it in the provider
		this.isHidden = true;
		// Keep panel alive but mark as hidden for context variable management
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