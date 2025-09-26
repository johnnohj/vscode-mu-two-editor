import * as vscode from 'vscode';
import { ReplDataBus, ReplDataEntry } from './replDataBus';
import { getLogger } from '../utils/unifiedLogger';

/**
 * REPL Coordinator Service
 *
 * Coordinates data sharing and communication between:
 * - Main REPL (webviewView)
 * - Connected Editor REPLs (webviewPanels)
 * - WASM-Node runtime
 * - Hardware simulation
 *
 * Enables notebook-cell-like functionality where editor code can access
 * data from other REPL sessions via 'import ... from mu_repl' syntax.
 */
export class ReplCoordinator {
	private static instance: ReplCoordinator;
	private dataBus: ReplDataBus;
	private logger = getLogger();
	private context: vscode.ExtensionContext;

	// Track active REPL instances
	private mainReplView?: vscode.WebviewView;
	private connectedPanels: Map<string, vscode.WebviewPanel> = new Map();

	// Subscription management
	private subscriptions: vscode.Disposable[] = [];

	private constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.dataBus = ReplDataBus.getInstance(context);
		this.setupDataBusSubscriptions();
		this.logger.info('EXTENSION', 'ReplCoordinator initialized');
	}

	/**
	 * Get singleton instance
	 */
	public static getInstance(context?: vscode.ExtensionContext): ReplCoordinator {
		if (!ReplCoordinator.instance) {
			if (!context) {
				throw new Error('ReplCoordinator: Extension context required for initialization');
			}
			ReplCoordinator.instance = new ReplCoordinator(context);
		}
		return ReplCoordinator.instance;
	}

	/**
	 * Register main REPL webview
	 */
	public registerMainRepl(webview: vscode.WebviewView): void {
		this.mainReplView = webview;
		this.logger.info('EXTENSION', 'ReplCoordinator: Main REPL registered');

		// Set up message handling for data sharing
		this.setupReplMessageHandling(webview.webview, 'main_repl');
	}

	/**
	 * Register connected editor REPL panel
	 */
	public registerConnectedPanel(panelId: string, panel: vscode.WebviewPanel, sourceEditor?: vscode.TextEditor): void {
		this.connectedPanels.set(panelId, panel);
		this.logger.info('EXTENSION', `ReplCoordinator: Connected panel ${panelId} registered`);

		// Set up message handling for data sharing
		this.setupReplMessageHandling(panel.webview, 'editor_repl', panelId);

		// Handle panel disposal
		panel.onDidDispose(() => {
			this.connectedPanels.delete(panelId);
			this.dataBus.clearSource(`editor_repl_${panelId}`);
			this.logger.info('EXTENSION', `ReplCoordinator: Connected panel ${panelId} unregistered`);
		});

		// Send initial shared data to new panel
		this.sendInitialDataToPanel(panel.webview);
	}

	/**
	 * Handle data import requests from editor REPLs
	 * Supports: 'import tof from mu_repl', 'import sensor.tof from mu_repl', etc.
	 */
	public handleDataImport(importPath: string, requestingPanelId?: string): any {
		this.logger.info('EXTENSION', `ReplCoordinator: Data import request for '${importPath}' from ${requestingPanelId || 'main_repl'}`);

		const data = this.dataBus.getExportData(importPath);

		if (data !== undefined) {
			this.logger.info('EXTENSION', `ReplCoordinator: Data import successful for '${importPath}'`);
			return data;
		} else {
			this.logger.warn('EXTENSION', `ReplCoordinator: No data found for import path '${importPath}'`);
			return undefined;
		}
	}

	/**
	 * Broadcast sensor data from main REPL to all connected panels
	 */
	public broadcastSensorData(sensorName: string, value: any, metadata?: ReplDataEntry['metadata']): void {
		// Publish to data bus
		this.dataBus.publishSensorData(sensorName, value, metadata);

		// Broadcast to all connected panels
		const message = {
			type: 'sensorDataUpdate',
			sensorName,
			value,
			metadata,
			timestamp: Date.now()
		};

		this.broadcastToAllPanels(message);
	}

	/**
	 * Broadcast hardware state changes
	 */
	public broadcastHardwareState(deviceType: string, state: any): void {
		// Publish to data bus
		this.dataBus.publishHardwareState(deviceType, state);

		// Broadcast to all REPLs
		const message = {
			type: 'hardwareStateUpdate',
			deviceType,
			state,
			timestamp: Date.now()
		};

		this.broadcastToAllPanels(message);
		this.sendToMainRepl(message);
	}

	/**
	 * Broadcast pin state changes from hardware simulation
	 */
	public broadcastPinState(pinName: string, state: boolean | number): void {
		// Publish to data bus
		this.dataBus.publishPinState(pinName, state);

		// Broadcast to all REPLs
		const message = {
			type: 'pinStateUpdate',
			pinName,
			state,
			timestamp: Date.now()
		};

		this.broadcastToAllPanels(message);
		this.sendToMainRepl(message);
	}

	/**
	 * Execute code in connected editor panel
	 */
	public executeInPanel(panelId: string, code: string): void {
		const panel = this.connectedPanels.get(panelId);
		if (panel) {
			panel.webview.postMessage({
				type: 'executeCode',
				code,
				timestamp: Date.now()
			});
		}
	}

	/**
	 * Get coordination status for debugging
	 */
	public getStatus(): {
		mainReplRegistered: boolean;
		connectedPanelCount: number;
		dataBusStatus: any;
	} {
		return {
			mainReplRegistered: !!this.mainReplView,
			connectedPanelCount: this.connectedPanels.size,
			dataBusStatus: this.dataBus.getStatus()
		};
	}

	/**
	 * Private helper methods
	 */
	private setupDataBusSubscriptions(): void {
		// Subscribe to all data changes for logging and coordination
		const subscriptionId = this.dataBus.subscribe(
			/.*/,  // Match all keys
			(entry) => {
				this.logger.info('EXTENSION', `ReplCoordinator: Data bus update - ${entry.type} '${entry.key}' from ${entry.source}`);

				// Forward data updates to relevant REPLs
				this.forwardDataUpdate(entry);
			}
		);

		this.subscriptions.push({
			dispose: () => this.dataBus.unsubscribe(subscriptionId)
		});
	}

	private setupReplMessageHandling(webview: vscode.Webview, source: string, panelId?: string): void {
		// Set up message handler for data coordination
		webview.onDidReceiveMessage((message) => {
			this.handleReplMessage(message, source, panelId);
		});
	}

	private handleReplMessage(message: any, source: string, panelId?: string): void {
		switch (message.type) {
			case 'dataPublish':
				// REPL wants to publish data to the bus
				this.dataBus.publish({
					key: message.key,
					value: message.value,
					type: message.dataType || 'variable',
					source: panelId ? `${source}_${panelId}` as ReplDataEntry['source'] : source as ReplDataEntry['source'],
					metadata: message.metadata
				});
				break;

			case 'dataRequest':
				// REPL wants to import data
				const data = this.handleDataImport(message.importPath, panelId);
				this.sendDataResponse(message, source, panelId, data);
				break;

			case 'sensorDataStream':
				// Main REPL is streaming sensor data
				if (source === 'main_repl') {
					this.broadcastSensorData(message.sensorName, message.value, message.metadata);
				}
				break;

			case 'hardwareSimulation':
				// Hardware simulation update
				this.broadcastHardwareState(message.deviceType, message.state);
				break;
		}
	}

	private forwardDataUpdate(entry: ReplDataEntry): void {
		const message = {
			type: 'dataUpdate',
			key: entry.key,
			value: entry.value,
			dataType: entry.type,
			source: entry.source,
			timestamp: entry.timestamp,
			metadata: entry.metadata
		};

		// Don't forward data back to its source
		if (entry.source === 'main_repl') {
			this.broadcastToAllPanels(message);
		} else if (entry.source.startsWith('editor_repl_')) {
			// Forward to main REPL and other panels
			this.sendToMainRepl(message);
			this.broadcastToOtherPanels(message, entry.source.replace('editor_repl_', ''));
		} else {
			// Forward to all REPLs
			this.sendToMainRepl(message);
			this.broadcastToAllPanels(message);
		}
	}

	private sendDataResponse(originalMessage: any, source: string, panelId: string | undefined, data: any): void {
		const response = {
			type: 'dataResponse',
			requestId: originalMessage.requestId,
			importPath: originalMessage.importPath,
			data,
			success: data !== undefined
		};

		if (source === 'main_repl' && this.mainReplView) {
			this.mainReplView.webview.postMessage(response);
		} else if (panelId) {
			const panel = this.connectedPanels.get(panelId);
			if (panel) {
				panel.webview.postMessage(response);
			}
		}
	}

	private sendToMainRepl(message: any): void {
		if (this.mainReplView) {
			this.mainReplView.webview.postMessage(message);
		}
	}

	private broadcastToAllPanels(message: any): void {
		for (const [_, panel] of Array.from(this.connectedPanels.entries())) {
			panel.webview.postMessage(message);
		}
	}

	private broadcastToOtherPanels(message: any, excludePanelId: string): void {
		for (const [panelId, panel] of Array.from(this.connectedPanels.entries())) {
			if (panelId !== excludePanelId) {
				panel.webview.postMessage(message);
			}
		}
	}

	private sendInitialDataToPanel(webview: vscode.Webview): void {
		// Send current data bus contents to newly connected panel
		const allData = Array.from(this.dataBus['data'].values()); // Access private data map

		if (allData.length > 0) {
			webview.postMessage({
				type: 'initialDataSync',
				data: allData,
				timestamp: Date.now()
			});
		}
	}

	/**
	 * Dispose resources
	 */
	public dispose(): void {
		// Dispose all subscriptions
		this.subscriptions.forEach(sub => sub.dispose());
		this.subscriptions = [];

		// Clear references
		this.connectedPanels.clear();
		this.mainReplView = undefined;

		// Dispose data bus
		this.dataBus.dispose();

		this.logger.info('EXTENSION', 'ReplCoordinator disposed');
	}
}