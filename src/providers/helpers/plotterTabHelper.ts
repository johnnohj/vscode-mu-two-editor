/**
 * Plotter Tab Helper for Visual Data Output
 *
 * Handles plotter tab functionality for visual data output using createNewPanel.right
 * for editor-associated REPL webviewPanels as per MU-TODO.md line 15
 */

import * as vscode from 'vscode';
import { getNonce } from '../../sys/utils/webview';

export interface PlotterDataPoint {
	timestamp: number;
	value: number;
	label?: string;
	sensor?: string;
}

export interface PlotterSeries {
	name: string;
	data: PlotterDataPoint[];
	color?: string;
	visible: boolean;
}

export interface PlotterConfig {
	maxDataPoints: number;
	refreshRate: number; // ms
	autoScale: boolean;
	showGrid: boolean;
	enableExport: boolean;
}

/**
 * Plotter Tab Manager for Visual Data Output
 * Creates and manages plotter tabs that display sensor data and variable values
 */
export class PlotterTabHelper {
	private plotterPanels = new Map<string, vscode.WebviewPanel>();
	private activeSeries = new Map<string, PlotterSeries[]>();
	private config: PlotterConfig;

	constructor(
		private context: vscode.ExtensionContext,
		config: Partial<PlotterConfig> = {}
	) {
		this.config = {
			maxDataPoints: 1000,
			refreshRate: 100,
			autoScale: true,
			showGrid: true,
			enableExport: true,
			...config
		};
	}

	/**
	 * Create plotter tab using createNewPanel.right approach
	 * Opens plotter in right panel for visual data output
	 */
	async createPlotterTab(sessionId: string, title: string = 'CircuitPython Plotter'): Promise<vscode.WebviewPanel> {
		console.log(`PlotterTabHelper: Creating plotter tab for session ${sessionId}`);

		// Create webview panel in the right area (as mentioned in MU-TODO.md)
		const panel = vscode.window.createWebviewPanel(
			'muTwo.plotter',
			title,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [this.context.extensionUri]
			}
		);

		// Set up plotter HTML content
		await this.setupPlotterContent(panel);

		// Initialize empty data series for this session
		this.activeSeries.set(sessionId, []);

		// Handle panel disposal
		panel.onDidDispose(() => {
			this.plotterPanels.delete(sessionId);
			this.activeSeries.delete(sessionId);
			console.log(`PlotterTabHelper: Plotter panel for session ${sessionId} disposed`);
		}, null, this.context.subscriptions);

		// Handle messages from plotter webview
		panel.webview.onDidReceiveMessage((message) => {
			this.handlePlotterMessage(sessionId, message);
		}, null, this.context.subscriptions);

		this.plotterPanels.set(sessionId, panel);
		console.log(`PlotterTabHelper: Plotter tab created for session ${sessionId}`);

		return panel;
	}

	/**
	 * Add data point to plotter
	 * Updates the visual plot with new sensor/variable data
	 */
	addDataPoint(sessionId: string, seriesName: string, value: number, label?: string): void {
		const series = this.getOrCreateSeries(sessionId, seriesName);

		const dataPoint: PlotterDataPoint = {
			timestamp: Date.now(),
			value,
			label,
			sensor: seriesName
		};

		series.data.push(dataPoint);

		// Limit data points to prevent memory issues
		if (series.data.length > this.config.maxDataPoints) {
			series.data.shift();
		}

		// Update plotter display
		this.updatePlotterDisplay(sessionId);
	}

	/**
	 * Add multiple data points at once (for bulk sensor data)
	 */
	addDataPoints(sessionId: string, dataPoints: { [seriesName: string]: number }): void {
		const timestamp = Date.now();

		for (const [seriesName, value] of Object.entries(dataPoints)) {
			const series = this.getOrCreateSeries(sessionId, seriesName);

			series.data.push({
				timestamp,
				value,
				sensor: seriesName
			});

			// Limit data points
			if (series.data.length > this.config.maxDataPoints) {
				series.data.shift();
			}
		}

		// Update plotter display once for all series
		this.updatePlotterDisplay(sessionId);
	}

	/**
	 * Get or create data series for plotter
	 */
	private getOrCreateSeries(sessionId: string, seriesName: string): PlotterSeries {
		let sessionSeries = this.activeSeries.get(sessionId) || [];

		let series = sessionSeries.find(s => s.name === seriesName);
		if (!series) {
			series = {
				name: seriesName,
				data: [],
				color: this.generateSeriesColor(sessionSeries.length),
				visible: true
			};
			sessionSeries.push(series);
			this.activeSeries.set(sessionId, sessionSeries);
		}

		return series;
	}

	/**
	 * Generate color for new data series
	 */
	private generateSeriesColor(index: number): string {
		const colors = [
			'#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
			'#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf'
		];
		return colors[index % colors.length];
	}

	/**
	 * Update plotter display with current data
	 */
	private updatePlotterDisplay(sessionId: string): void {
		const panel = this.plotterPanels.get(sessionId);
		const series = this.activeSeries.get(sessionId);

		if (!panel || !series) {
			return;
		}

		// Send data update to plotter webview
		panel.webview.postMessage({
			type: 'updateData',
			series: series,
			config: this.config
		});
	}

	/**
	 * Setup plotter HTML content with Chart.js for plotting
	 */
	private async setupPlotterContent(panel: vscode.WebviewPanel): Promise<void> {
		const webview = panel.webview;
		const nonce = getNonce();

		// Get theme information for proper styling
		const theme = this.getThemeInfo();

		panel.webview.html = `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://cdn.jsdelivr.net; img-src vscode-resource: https:;">
				<title>CircuitPython Plotter</title>
				<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/chart.js"></script>
				<style>
					body {
						font-family: var(--vscode-font-family);
						background-color: var(--vscode-panel-background);
						color: var(--vscode-foreground);
						margin: 0;
						padding: 16px;
					}

					.plotter-container {
						height: calc(100vh - 100px);
						width: 100%;
						position: relative;
					}

					.plotter-controls {
						display: flex;
						gap: 8px;
						margin-bottom: 16px;
						align-items: center;
					}

					.control-group {
						display: flex;
						align-items: center;
						gap: 4px;
					}

					button {
						background: var(--vscode-button-background);
						color: var(--vscode-button-foreground);
						border: none;
						padding: 6px 12px;
						cursor: pointer;
						border-radius: 3px;
						font-size: 12px;
					}

					button:hover {
						background: var(--vscode-button-hoverBackground);
					}

					.series-legend {
						display: flex;
						flex-wrap: wrap;
						gap: 12px;
						margin-bottom: 12px;
					}

					.series-item {
						display: flex;
						align-items: center;
						gap: 6px;
						font-size: 12px;
					}

					.series-color {
						width: 12px;
						height: 12px;
						border-radius: 2px;
					}
				</style>
			</head>
			<body class="${theme.name}">
				<div class="plotter-controls">
					<div class="control-group">
						<button onclick="clearData()">Clear</button>
						<button onclick="pauseResume()">Pause</button>
						<button onclick="exportData()">Export</button>
					</div>
				</div>

				<div class="series-legend" id="seriesLegend"></div>

				<div class="plotter-container">
					<canvas id="plotterChart"></canvas>
				</div>

				<script nonce="${nonce}">
					window.vscode = acquireVsCodeApi();

					let chart;
					let isPaused = false;

					// Initialize Chart.js
					const ctx = document.getElementById('plotterChart').getContext('2d');
					chart = new Chart(ctx, {
						type: 'line',
						data: {
							datasets: []
						},
						options: {
							responsive: true,
							maintainAspectRatio: false,
							animation: {
								duration: 0 // Disable animations for real-time data
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
							},
							plugins: {
								legend: {
									display: false // Use custom legend
								}
							}
						}
					});

					// Handle messages from extension
					window.addEventListener('message', event => {
						const message = event.data;

						switch (message.type) {
							case 'updateData':
								if (!isPaused) {
									updateChart(message.series);
									updateLegend(message.series);
								}
								break;
						}
					});

					function updateChart(series) {
						chart.data.datasets = series.map(s => ({
							label: s.name,
							data: s.data.map(d => ({ x: d.timestamp, y: d.value })),
							borderColor: s.color,
							backgroundColor: s.color + '20',
							borderWidth: 2,
							fill: false,
							pointRadius: 0,
							hidden: !s.visible
						}));

						chart.update('none');
					}

					function updateLegend(series) {
						const legend = document.getElementById('seriesLegend');
						legend.innerHTML = series.map(s =>
							\`<div class="series-item">
								<div class="series-color" style="background-color: \${s.color}"></div>
								<span>\${s.name}</span>
							</div>\`
						).join('');
					}

					function clearData() {
						window.vscode.postMessage({ type: 'clearData' });
					}

					function pauseResume() {
						isPaused = !isPaused;
						const button = event.target;
						button.textContent = isPaused ? 'Resume' : 'Pause';
						window.vscode.postMessage({ type: 'pauseResume', paused: isPaused });
					}

					function exportData() {
						window.vscode.postMessage({ type: 'exportData' });
					}

					console.log('CircuitPython Plotter initialized');
				</script>
			</body>
			</html>
		`;
	}

	/**
	 * Handle messages from plotter webview
	 */
	private handlePlotterMessage(sessionId: string, message: any): void {
		switch (message.type) {
			case 'clearData':
				this.clearSeriesData(sessionId);
				break;
			case 'pauseResume':
				// Handle pause/resume logic if needed
				console.log(`PlotterTabHelper: ${message.paused ? 'Paused' : 'Resumed'} plotting for session ${sessionId}`);
				break;
			case 'exportData':
				this.exportSeriesData(sessionId);
				break;
		}
	}

	/**
	 * Clear all data series for session
	 */
	private clearSeriesData(sessionId: string): void {
		const series = this.activeSeries.get(sessionId);
		if (series) {
			series.forEach(s => s.data = []);
			this.updatePlotterDisplay(sessionId);
		}
	}

	/**
	 * Export data series to CSV
	 */
	private async exportSeriesData(sessionId: string): Promise<void> {
		const series = this.activeSeries.get(sessionId);
		if (!series || series.length === 0) {
			vscode.window.showWarningMessage('No data to export');
			return;
		}

		// Convert data to CSV format
		const csvData = this.seriesToCSV(series);

		// Save to file
		const uri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(`plotter-data-${sessionId}.csv`),
			filters: { 'CSV Files': ['csv'] }
		});

		if (uri) {
			await vscode.workspace.fs.writeFile(uri, Buffer.from(csvData, 'utf8'));
			vscode.window.showInformationMessage(`Plotter data exported to ${uri.fsPath}`);
		}
	}

	/**
	 * Convert series data to CSV format
	 */
	private seriesToCSV(series: PlotterSeries[]): string {
		const headers = ['timestamp', ...series.map(s => s.name)];
		const rows = [headers.join(',')];

		// Get all unique timestamps
		const timestamps = new Set<number>();
		series.forEach(s => s.data.forEach(d => timestamps.add(d.timestamp)));

		const sortedTimestamps = Array.from(timestamps).sort((a, b) => a - b);

		// Create CSV rows
		sortedTimestamps.forEach(timestamp => {
			const row = [timestamp.toString()];
			series.forEach(s => {
				const dataPoint = s.data.find(d => d.timestamp === timestamp);
				row.push(dataPoint ? dataPoint.value.toString() : '');
			});
			rows.push(row.join(','));
		});

		return rows.join('\n');
	}

	/**
	 * Get theme information for proper styling
	 */
	private getThemeInfo(): { name: string } {
		const activeTheme = vscode.window.activeColorTheme;
		return {
			name: activeTheme.kind === vscode.ColorThemeKind.Light ? 'vscode-light' : 'vscode-dark'
		};
	}

	/**
	 * Get plotter panel for session
	 */
	getPlotterPanel(sessionId: string): vscode.WebviewPanel | undefined {
		return this.plotterPanels.get(sessionId);
	}

	/**
	 * Check if plotter exists for session
	 */
	hasPlotter(sessionId: string): boolean {
		return this.plotterPanels.has(sessionId);
	}

	/**
	 * Cleanup all resources
	 */
	dispose(): void {
		// Dispose all plotter panels
		for (const panel of this.plotterPanels.values()) {
			panel.dispose();
		}
		this.plotterPanels.clear();
		this.activeSeries.clear();
	}
}