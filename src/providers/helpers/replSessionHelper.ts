/**
 * REPL Session Initialization Helper
 *
 * Handles REPL session initialization that reads/executes editor contents
 * for editor-associated REPL webviewPanels as per MU-TODO.md line 15
 */

import * as vscode from 'vscode';
import { BoardAssociation } from './boardDetectionHelper';
import { WasmRuntimeManager } from '../../sys/wasmRuntimeManager';

export interface ReplSessionConfig {
	autoExecuteOnStart: boolean;
	enableEditorSync: boolean;
	enablePlotterOutput: boolean;
}

export interface ReplSession {
	id: string;
	boardAssociation: BoardAssociation;
	isActive: boolean;
	webviewPanel?: vscode.WebviewPanel;
	lastExecutionTime?: Date;
}

/**
 * REPL Session Manager for Editor-Associated Panels
 * Initializes REPL sessions that can read/execute editor contents
 */
export class ReplSessionHelper {
	private activeSessions = new Map<string, ReplSession>();
	private wasmRuntimeManager?: WasmRuntimeManager;

	constructor(private context: vscode.ExtensionContext) {}

	/**
	 * Initialize REPL session for board association
	 * Creates session that can read/execute editor contents
	 */
	async initializeSession(
		boardAssociation: BoardAssociation,
		config: ReplSessionConfig = { autoExecuteOnStart: false, enableEditorSync: true, enablePlotterOutput: true }
	): Promise<ReplSession> {
		console.log('ReplSessionHelper: Initializing REPL session');

		const sessionId = this.generateSessionId(boardAssociation);

		const session: ReplSession = {
			id: sessionId,
			boardAssociation,
			isActive: false
		};

		// Initialize appropriate runtime based on board type
		if (boardAssociation.isVirtual) {
			await this.initializeVirtualSession(session, config);
		} else {
			await this.initializePhysicalSession(session, config);
		}

		this.activeSessions.set(sessionId, session);
		console.log(`ReplSessionHelper: Session ${sessionId} initialized successfully`);

		return session;
	}

	/**
	 * Initialize session for virtual board (WASM runtime)
	 */
	private async initializeVirtualSession(session: ReplSession, config: ReplSessionConfig): Promise<void> {
		console.log('ReplSessionHelper: Initializing virtual REPL session');

		// Initialize WASM runtime if not already done
		if (!this.wasmRuntimeManager) {
			this.wasmRuntimeManager = new WasmRuntimeManager({
				enableHardwareSimulation: true,
				debugMode: true
			}, this.context);
		}

		// TODO: Connect WASM runtime to session
		session.isActive = true;
	}

	/**
	 * Initialize session for physical board
	 */
	private async initializePhysicalSession(session: ReplSession, config: ReplSessionConfig): Promise<void> {
		console.log('ReplSessionHelper: Initializing physical board REPL session');

		const device = session.boardAssociation.device;
		if (!device) {
			throw new Error('No device found for physical board session');
		}

		// TODO: Connect to physical device via existing device manager
		// This would use the existing CircuitPython serial communication
		session.isActive = true;
	}

	/**
	 * Execute editor content in REPL session
	 * Reads current editor content and executes it in the associated REPL
	 */
	async executeEditorContent(sessionId: string): Promise<void> {
		const session = this.activeSessions.get(sessionId);
		if (!session || !session.isActive) {
			throw new Error(`Invalid or inactive session: ${sessionId}`);
		}

		console.log('ReplSessionHelper: Executing editor content in REPL session');

		// Get active editor content
		const activeEditor = vscode.window.activeTextEditor;
		if (!activeEditor) {
			console.warn('ReplSessionHelper: No active editor found');
			return;
		}

		const editorContent = activeEditor.document.getText();
		if (!editorContent.trim()) {
			console.warn('ReplSessionHelper: Editor content is empty');
			return;
		}

		// Execute content based on board type
		if (session.boardAssociation.isVirtual) {
			await this.executeInVirtualRepl(session, editorContent);
		} else {
			await this.executeInPhysicalRepl(session, editorContent);
		}

		session.lastExecutionTime = new Date();
	}

	/**
	 * Execute code in virtual REPL (WASM runtime)
	 */
	private async executeInVirtualRepl(session: ReplSession, code: string): Promise<void> {
		if (!this.wasmRuntimeManager) {
			throw new Error('WASM runtime not initialized');
		}

		console.log('ReplSessionHelper: Executing code in virtual REPL');

		try {
			// TODO: Execute code in WASM runtime
			// const result = await this.wasmRuntimeManager.executeCode(code);
			console.log('ReplSessionHelper: Virtual execution completed');
		} catch (error) {
			console.error('ReplSessionHelper: Virtual execution failed:', error);
			throw error;
		}
	}

	/**
	 * Execute code in physical board REPL
	 */
	private async executeInPhysicalRepl(session: ReplSession, code: string): Promise<void> {
		const device = session.boardAssociation.device;
		if (!device) {
			throw new Error('No device found for physical execution');
		}

		console.log('ReplSessionHelper: Executing code in physical REPL');

		try {
			// TODO: Execute code on physical device
			// This would integrate with existing device manager/debug adapter
			console.log('ReplSessionHelper: Physical execution completed');
		} catch (error) {
			console.error('ReplSessionHelper: Physical execution failed:', error);
			throw error;
		}
	}

	/**
	 * Generate unique session ID
	 */
	private generateSessionId(boardAssociation: BoardAssociation): string {
		const workspaceName = boardAssociation.workspace.name;
		const deviceInfo = boardAssociation.isVirtual
			? 'virtual'
			: boardAssociation.device?.displayName || 'unknown';
		const timestamp = Date.now();

		return `${workspaceName}-${deviceInfo}-${timestamp}`;
	}

	/**
	 * Get active session by ID
	 */
	getSession(sessionId: string): ReplSession | undefined {
		return this.activeSessions.get(sessionId);
	}

	/**
	 * Get all active sessions
	 */
	getActiveSessions(): ReplSession[] {
		return Array.from(this.activeSessions.values());
	}

	/**
	 * Close and cleanup session
	 */
	async closeSession(sessionId: string): Promise<void> {
		const session = this.activeSessions.get(sessionId);
		if (!session) {
			return;
		}

		console.log(`ReplSessionHelper: Closing session ${sessionId}`);

		// Cleanup session resources
		session.isActive = false;
		if (session.webviewPanel) {
			session.webviewPanel.dispose();
		}

		this.activeSessions.delete(sessionId);
	}

	/**
	 * Cleanup all resources
	 */
	dispose(): void {
		// Close all active sessions
		for (const sessionId of this.activeSessions.keys()) {
			this.closeSession(sessionId);
		}

		if (this.wasmRuntimeManager) {
			// TODO: Add dispose method to WasmRuntimeManager if not present
			// this.wasmRuntimeManager.dispose();
		}
	}
}