import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';

/**
 * Shared State Bus for REPL Data Coordination
 *
 * Enables data sharing between main REPL and editor REPLs to support
 * notebook-cell-like functionality where editor code can access data from
 * main REPL sessions (e.g., 'import tof from mu_repl').
 */
export interface ReplDataEntry {
	key: string;
	value: any;
	type: 'variable' | 'module' | 'sensor_data' | 'pin_state' | 'hardware_state';
	source: 'main_repl' | 'editor_repl' | 'wasm_runtime' | 'hardware_simulation';
	timestamp: number;
	metadata?: {
		description?: string;
		units?: string;
		range?: [number, number];
		format?: 'scalar' | 'array' | 'object' | 'stream';
	};
}

export interface ReplDataSubscription {
	id: string;
	pattern: string | RegExp;
	callback: (entry: ReplDataEntry) => void;
	source?: string; // Filter by source if specified
}

export class ReplDataBus {
	private static instance: ReplDataBus;
	private data: Map<string, ReplDataEntry> = new Map();
	private subscriptions: Map<string, ReplDataSubscription> = new Map();
	private logger = getLogger();
	private context: vscode.ExtensionContext;

	private constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.logger.info('EXTENSION', 'ReplDataBus initialized');
	}

	/**
	 * Get singleton instance
	 */
	public static getInstance(context?: vscode.ExtensionContext): ReplDataBus {
		if (!ReplDataBus.instance) {
			if (!context) {
				throw new Error('ReplDataBus: Extension context required for initialization');
			}
			ReplDataBus.instance = new ReplDataBus(context);
		}
		return ReplDataBus.instance;
	}

	/**
	 * Publish data to the bus
	 */
	public publish(entry: Omit<ReplDataEntry, 'timestamp'>): void {
		const fullEntry: ReplDataEntry = {
			...entry,
			timestamp: Date.now()
		};

		this.data.set(entry.key, fullEntry);
		this.logger.info('EXTENSION', `ReplDataBus: Published ${entry.type} '${entry.key}' from ${entry.source}`);

		// Notify subscribers
		this.notifySubscribers(fullEntry);

		// Persist important data to workspace state
		if (entry.type === 'variable' || entry.type === 'sensor_data') {
			this.persistToWorkspace(fullEntry);
		}
	}

	/**
	 * Subscribe to data changes
	 */
	public subscribe(pattern: string | RegExp, callback: (entry: ReplDataEntry) => void, source?: string): string {
		const id = this.generateSubscriptionId();
		const subscription: ReplDataSubscription = {
			id,
			pattern,
			callback,
			source
		};

		this.subscriptions.set(id, subscription);
		this.logger.info('EXTENSION', `ReplDataBus: New subscription ${id} for pattern ${pattern}`);

		// Send existing matching data to new subscriber
		this.sendExistingDataToSubscriber(subscription);

		return id;
	}

	/**
	 * Unsubscribe from data changes
	 */
	public unsubscribe(subscriptionId: string): void {
		if (this.subscriptions.delete(subscriptionId)) {
			this.logger.info('EXTENSION', `ReplDataBus: Unsubscribed ${subscriptionId}`);
		}
	}

	/**
	 * Get data by key
	 */
	public get(key: string): ReplDataEntry | undefined {
		return this.data.get(key);
	}

	/**
	 * Get all data from a specific source
	 */
	public getBySource(source: string): ReplDataEntry[] {
		return Array.from(this.data.values()).filter(entry => entry.source === source);
	}

	/**
	 * Get data matching pattern
	 */
	public query(pattern: string | RegExp): ReplDataEntry[] {
		const results: ReplDataEntry[] = [];

		for (const entry of Array.from(this.data.values())) {
			if (this.matchesPattern(entry.key, pattern)) {
				results.push(entry);
			}
		}

		return results.sort((a, b) => b.timestamp - a.timestamp);
	}

	/**
	 * Clear data from specific source
	 */
	public clearSource(source: string): void {
		const keysToDelete: string[] = [];

		for (const [key, entry] of Array.from(this.data.entries())) {
			if (entry.source === source) {
				keysToDelete.push(key);
			}
		}

		keysToDelete.forEach(key => this.data.delete(key));
		this.logger.info('EXTENSION', `ReplDataBus: Cleared ${keysToDelete.length} entries from ${source}`);
	}

	/**
	 * Get data export for import functionality
	 * Supports patterns like 'import tof from mu_repl' or 'import sensor.tof from mu_repl'
	 */
	public getExportData(importPath: string): any {
		// Parse import path: 'tof' or 'sensor.tof'
		const parts = importPath.split('.');

		if (parts.length === 1) {
			// Simple import: 'import tof from mu_repl'
			const entry = this.get(parts[0]);
			return entry ? entry.value : undefined;
		} else {
			// Nested import: 'import sensor.tof from mu_repl'
			const namespace = parts[0];
			const key = parts.slice(1).join('.');

			// Get all entries in namespace
			const namespaceData = this.query(new RegExp(`^${namespace}\\.`));

			if (key === '*') {
				// Import all from namespace
				const result: any = {};
				namespaceData.forEach(entry => {
					const shortKey = entry.key.replace(`${namespace}.`, '');
					result[shortKey] = entry.value;
				});
				return result;
			} else {
				// Import specific key from namespace
				const fullKey = `${namespace}.${key}`;
				const entry = this.get(fullKey);
				return entry ? entry.value : undefined;
			}
		}
	}

	/**
	 * Register sensor data stream from main REPL
	 */
	public publishSensorData(sensorName: string, value: any, metadata?: ReplDataEntry['metadata']): void {
		this.publish({
			key: `sensor.${sensorName}`,
			value,
			type: 'sensor_data',
			source: 'main_repl',
			metadata: {
				format: 'scalar',
				...metadata
			}
		});
	}

	/**
	 * Register hardware pin state change
	 */
	public publishPinState(pinName: string, state: boolean | number): void {
		this.publish({
			key: `pin.${pinName}`,
			value: state,
			type: 'pin_state',
			source: 'hardware_simulation',
			metadata: {
				format: 'scalar',
				description: `Pin ${pinName} state`
			}
		});
	}

	/**
	 * Register hardware state update
	 */
	public publishHardwareState(deviceType: string, state: any): void {
		this.publish({
			key: `hardware.${deviceType}`,
			value: state,
			type: 'hardware_state',
			source: 'hardware_simulation',
			metadata: {
				format: 'object',
				description: `${deviceType} hardware state`
			}
		});
	}

	/**
	 * Get data bus status for debugging
	 */
	public getStatus(): {
		entryCount: number;
		subscriptionCount: number;
		sourceBreakdown: Record<string, number>;
		typeBreakdown: Record<string, number>;
	} {
		const sourceBreakdown: Record<string, number> = {};
		const typeBreakdown: Record<string, number> = {};

		for (const entry of Array.from(this.data.values())) {
			sourceBreakdown[entry.source] = (sourceBreakdown[entry.source] || 0) + 1;
			typeBreakdown[entry.type] = (typeBreakdown[entry.type] || 0) + 1;
		}

		return {
			entryCount: this.data.size,
			subscriptionCount: this.subscriptions.size,
			sourceBreakdown,
			typeBreakdown
		};
	}

	/**
	 * Private helper methods
	 */
	private notifySubscribers(entry: ReplDataEntry): void {
		for (const subscription of Array.from(this.subscriptions.values())) {
			// Check source filter
			if (subscription.source && subscription.source !== entry.source) {
				continue;
			}

			// Check pattern match
			if (this.matchesPattern(entry.key, subscription.pattern)) {
				try {
					subscription.callback(entry);
				} catch (error) {
					this.logger.error('EXTENSION', `ReplDataBus: Subscription callback error for ${subscription.id}:`, error);
				}
			}
		}
	}

	private sendExistingDataToSubscriber(subscription: ReplDataSubscription): void {
		for (const entry of Array.from(this.data.values())) {
			// Check source filter
			if (subscription.source && subscription.source !== entry.source) {
				continue;
			}

			// Check pattern match
			if (this.matchesPattern(entry.key, subscription.pattern)) {
				try {
					subscription.callback(entry);
				} catch (error) {
					this.logger.error('EXTENSION', `ReplDataBus: Initial data callback error for ${subscription.id}:`, error);
				}
			}
		}
	}

	private matchesPattern(key: string, pattern: string | RegExp): boolean {
		if (typeof pattern === 'string') {
			return key.includes(pattern) || key === pattern;
		} else {
			return pattern.test(key);
		}
	}

	private generateSubscriptionId(): string {
		return `sub_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	private persistToWorkspace(entry: ReplDataEntry): void {
		try {
			// Persist important data to workspace state for session restoration
			const persistedData = this.context.workspaceState.get<Record<string, any>>('replDataBus', {});
			persistedData[entry.key] = {
				value: entry.value,
				type: entry.type,
				source: entry.source,
				timestamp: entry.timestamp,
				metadata: entry.metadata
			};
			this.context.workspaceState.update('replDataBus', persistedData);
		} catch (error) {
			this.logger.warn('EXTENSION', 'ReplDataBus: Failed to persist data to workspace:', error);
		}
	}

	/**
	 * Restore data from workspace state
	 */
	public restoreFromWorkspace(): void {
		try {
			const persistedData = this.context.workspaceState.get<Record<string, ReplDataEntry>>('replDataBus', {});

			for (const [key, entry] of Object.entries(persistedData)) {
				// Only restore recent data (within last hour)
				if (Date.now() - entry.timestamp < 60 * 60 * 1000) {
					this.data.set(key, entry);
				}
			}

			this.logger.info('EXTENSION', `ReplDataBus: Restored ${Object.keys(persistedData).length} entries from workspace`);
		} catch (error) {
			this.logger.warn('EXTENSION', 'ReplDataBus: Failed to restore data from workspace:', error);
		}
	}

	/**
	 * Dispose resources
	 */
	public dispose(): void {
		this.subscriptions.clear();
		this.data.clear();
		this.logger.info('EXTENSION', 'ReplDataBus disposed');
	}
}