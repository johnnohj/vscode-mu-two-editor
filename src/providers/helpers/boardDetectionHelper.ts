/**
 * Board Detection Helper for Editor REPL Panels
 *
 * Handles automatic board detection and workspace association logic
 * for editor-associated REPL webviewPanels as per MU-TODO.md line 15
 */

import * as vscode from 'vscode';
import { MuDeviceDetector, IDevice, MuDevice, DetectionResult } from '../../devices/core/deviceDetector';
import { WasmRuntimeManager } from '../../sys/wasmRuntimeManager';
import { getLogger } from '../../sys/unifiedLogger';
import { MuTwoRuntimeCoordinator } from '../../sys/unifiedRuntimeCoordinator';
import { getService } from '../../sys/serviceRegistry';

export interface BoardAssociation {
	device?: MuDevice;
	workspace: vscode.WorkspaceFolder;
	isVirtual: boolean;
	confidence: 'high' | 'medium' | 'low' | 'virtual';
}

export interface EditorReplConfig {
	preferredBoard?: string;
	enableVirtualFallback: boolean;
	autoDetectWorkspaceBoards: boolean;
}

/**
 * Board Detection and Association Logic
 * Automatically detects connected boards and associates them with workspace
 */
export class BoardDetectionHelper {
	private deviceDetector: MuDeviceDetector;
	private wasmRuntimeManager?: WasmRuntimeManager;
	private currentAssociation?: BoardAssociation;
	private logger = getLogger();

	constructor(private context: vscode.ExtensionContext) {
		this.deviceDetector = new MuDeviceDetector();
	}

	/**
	 * Detect and associate board with current workspace
	 * Returns board association or creates virtual fallback
	 */
	async detectAndAssociate(): Promise<BoardAssociation> {
		this.logger.info('EXTENSION', 'BoardDetectionHelper: Starting board detection and workspace association');

		// Get current workspace
		const workspace = this.getCurrentWorkspace();
		if (!workspace) {
			throw new Error('No workspace found for board association');
		}

		// Attempt to detect physical boards
		const physicalBoard = await this.detectPhysicalBoard(workspace);
		if (physicalBoard) {
			this.logger.info('EXTENSION', `BoardDetectionHelper: Found physical board ${physicalBoard.displayName}`);
			this.currentAssociation = {
				device: physicalBoard,
				workspace,
				isVirtual: false,
				confidence: physicalBoard.confidence
			};
			return this.currentAssociation;
		}

		// Fallback to virtual board
		this.logger.info('EXTENSION', 'BoardDetectionHelper: No physical board detected, creating virtual board fallback');
		this.currentAssociation = await this.createVirtualBoardFallback(workspace);
		return this.currentAssociation;
	}

	/**
	 * Get current workspace folder
	 */
	private getCurrentWorkspace(): vscode.WorkspaceFolder | undefined {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return undefined;
		}

		// For now, use the first workspace folder
		// TODO: Implement smarter workspace selection based on active editor
		return workspaceFolders[0];
	}

	/**
	 * Detect physical CircuitPython board
	 */
	private async detectPhysicalBoard(workspace: vscode.WorkspaceFolder): Promise<MuDevice | undefined> {
		try {
			const detectionResult: DetectionResult = await this.deviceDetector.detectDevices();

			if (detectionResult.circuitPythonDevices.length === 0) {
				this.logger.info('EXTENSION', 'BoardDetectionHelper: No CircuitPython devices detected');
				return undefined;
			}

			// Prefer high-confidence devices
			const highConfidenceDevices = detectionResult.circuitPythonDevices
				.filter(device => device.confidence === 'high');

			if (highConfidenceDevices.length > 0) {
				return highConfidenceDevices[0];
			}

			// Fall back to any detected device
			return detectionResult.circuitPythonDevices[0];
		} catch (error) {
			this.logger.error('EXTENSION', 'BoardDetectionHelper: Physical board detection failed:', error);
			return undefined;
		}
	}

	/**
	 * Create virtual board fallback using WASM runtime
	 */
	private async createVirtualBoardFallback(workspace: vscode.WorkspaceFolder): Promise<BoardAssociation> {
		this.logger.info('EXTENSION', 'BoardDetectionHelper: Setting up WASM virtual board fallback');

		// Initialize WASM runtime manager if not already done
		if (!this.wasmRuntimeManager) {
			try {
				// Use shared WASM runtime from unified coordinator
				const coordinator = getService<MuTwoRuntimeCoordinator>('runtimeCoordinator');
				if (coordinator) {
					this.wasmRuntimeManager = await coordinator.getSharedWasmRuntime();
					this.logger.info('EXTENSION', 'BoardDetectionHelper: Using shared WASM runtime from coordinator');
				} else {
					// Fallback: create runtime directly if coordinator not available
					this.logger.warn('EXTENSION', 'BoardDetectionHelper: Coordinator not available, creating runtime directly');
					this.wasmRuntimeManager = new WasmRuntimeManager({
						enableHardwareSimulation: true,
						debugMode: true
					}, this.context);
					await this.wasmRuntimeManager.initialize();
				}
			} catch (error) {
				this.logger.error('EXTENSION', 'BoardDetectionHelper: Failed to get WASM runtime', error);
				// Continue with virtual board setup even if WASM runtime fails
			}
		}

		return {
			device: undefined, // Virtual board doesn't have a physical device
			workspace,
			isVirtual: true,
			confidence: 'virtual'
		};
	}

	/**
	 * Get current board association
	 */
	getCurrentAssociation(): BoardAssociation | undefined {
		return this.currentAssociation;
	}

	/**
	 * Check if current association is ready for REPL session
	 */
	isReadyForRepl(): boolean {
		return !!this.currentAssociation;
	}

	/**
	 * Get WASM runtime manager for virtual board operations
	 */
	getWasmRuntimeManager(): WasmRuntimeManager | undefined {
		return this.wasmRuntimeManager;
	}

	/**
	 * Cleanup resources
	 */
	dispose(): void {
		this.deviceDetector.dispose();
		if (this.wasmRuntimeManager) {
			this.wasmRuntimeManager.dispose();
		}
	}
}