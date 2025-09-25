import * as vscode from 'vscode';
// import {
//     BlinkaExecutionManager,
//     ExecutionEnvironment,
//     CodeExecutionRequest,
//     ExecutionResult,
//     DualExecutionComparison,
//     BlinkaBoard
// } from './executionManager'; // File removed during reorganization
// import { UnifiedDebugManager } from '../../sys/unifiedDebugManager'; // File removed during reorganization
import { getLogger } from '../utils/unifiedLogger';

/**
 * Execution mode selection for user interface
 */
export enum ExecutionMode {
    HARDWARE_ONLY = 'hardware-only',
    SIMULATION_ONLY = 'simulation-only',
    DUAL_COMPARISON = 'dual-comparison',
    AUTO_SELECT = 'auto-select'
}

/**
 * User execution preferences
 */
export interface ExecutionPreferences {
    mode: ExecutionMode;
    selectedBoard?: string;
    enableProfiling: boolean;
    timeout: number;
    autoShowComparison: boolean;
    enableEducationalTips: boolean;
}

/**
 * Execution session tracking
 */
export interface ExecutionSession {
    sessionId: string;
    startTime: number;
    code: string;
    fileName?: string;
    preferences: ExecutionPreferences;
    results: (ExecutionResult | DualExecutionComparison)[];
    isActive: boolean;
}

/**
 * Dual Execution Interface - User-friendly wrapper for Blinka execution
 * 
 * This interface provides:
 * - Simplified code execution API for different environments
 * - Smart execution mode selection based on context
 * - Educational feedback and tips for learning
 * - Session management and result history
 */
export class DualExecutionInterface {
    private blinkaExecutionManager: BlinkaExecutionManager;
    private unifiedDebugManager: UnifiedDebugManager;
    private context: vscode.ExtensionContext;

    // Session management
    private activeSessions = new Map<string, ExecutionSession>();
    private sessionCounter = 0;

    // User preferences
    private userPreferences: ExecutionPreferences = {
        mode: ExecutionMode.AUTO_SELECT,
        enableProfiling: true,
        timeout: 30000,
        autoShowComparison: true,
        enableEducationalTips: true
    };

    constructor(
        blinkaExecutionManager: BlinkaExecutionManager,
        unifiedDebugManager: UnifiedDebugManager,
        context: vscode.ExtensionContext
    ) {
        this.blinkaExecutionManager = blinkaExecutionManager;
        this.unifiedDebugManager = unifiedDebugManager;
        this.context = context;

        this.loadUserPreferences();
        this.setupEventHandlers();
    }

    /**
     * Execute code with smart environment selection
     */
    async executeCode(code: string, fileName?: string): Promise<ExecutionResult | DualExecutionComparison> {
        const sessionId = this.createExecutionSession(code, fileName);
        
        try {
            // Determine execution environment based on preferences and context
            const environment = await this.selectExecutionEnvironment();
            
            // Create execution request
            const request: CodeExecutionRequest = {
                code,
                fileName,
                environment,
                timeout: this.userPreferences.timeout,
                enableProfiling: this.userPreferences.enableProfiling,
                deviceId: await this.selectDevice(),
                boardConfig: await this.selectBoard()
            };

            console.log(`Executing code in ${environment} environment for session ${sessionId}`);

            // Execute code
            const result = await this.blinkaExecutionManager.executeCode(request);

            // Store result in session
            this.updateSession(sessionId, result);

            // Show results based on preferences
            await this.handleExecutionResult(result, sessionId);

            return result;

        } catch (error) {
            this.handleExecutionError(sessionId, error);
            throw error;
        }
    }

    /**
     * Execute code in hardware environment only
     */
    async executeOnHardware(code: string, deviceId?: string): Promise<ExecutionResult> {
        const request: CodeExecutionRequest = {
            code,
            environment: ExecutionEnvironment.HARDWARE,
            deviceId: deviceId || await this.selectDevice(),
            timeout: this.userPreferences.timeout,
            enableProfiling: this.userPreferences.enableProfiling
        };

        const result = await this.blinkaExecutionManager.executeCode(request);
        return result as ExecutionResult;
    }

    /**
     * Execute code in simulation environment only
     */
    async executeOnSimulation(code: string, boardConfig?: BlinkaBoard): Promise<ExecutionResult> {
        const request: CodeExecutionRequest = {
            code,
            environment: ExecutionEnvironment.SIMULATED,
            boardConfig: boardConfig || await this.selectBoard(),
            timeout: this.userPreferences.timeout,
            enableProfiling: this.userPreferences.enableProfiling
        };

        const result = await this.blinkaExecutionManager.executeCode(request);
        return result as ExecutionResult;
    }

    /**
     * Execute code in both environments and compare
     */
    async executeDual(code: string, deviceId?: string, boardConfig?: BlinkaBoard): Promise<DualExecutionComparison> {
        const request: CodeExecutionRequest = {
            code,
            environment: ExecutionEnvironment.DUAL,
            deviceId: deviceId || await this.selectDevice(),
            boardConfig: boardConfig || await this.selectBoard(),
            timeout: this.userPreferences.timeout,
            enableProfiling: this.userPreferences.enableProfiling
        };

        const result = await this.blinkaExecutionManager.executeCode(request);
        return result as DualExecutionComparison;
    }

    /**
     * Smart execution environment selection based on context
     */
    private async selectExecutionEnvironment(): Promise<ExecutionEnvironment> {
        switch (this.userPreferences.mode) {
            case ExecutionMode.HARDWARE_ONLY:
                return ExecutionEnvironment.HARDWARE;
            
            case ExecutionMode.SIMULATION_ONLY:
                return ExecutionEnvironment.SIMULATED;
            
            case ExecutionMode.DUAL_COMPARISON:
                return ExecutionEnvironment.DUAL;
            
            case ExecutionMode.AUTO_SELECT:
            default:
                return await this.autoSelectEnvironment();
        }
    }

    /**
     * Automatically select the best execution environment
     */
    private async autoSelectEnvironment(): Promise<ExecutionEnvironment> {
        const connections = this.unifiedDebugManager.getConnectionStates();
        const hasHardware = connections.size > 0;
        const hasBlinka = this.blinkaExecutionManager.getExecutionStats().isInitialized;

        // Decision logic
        if (hasHardware && hasBlinka) {
            // Both available - use dual execution for educational value
            return ExecutionEnvironment.DUAL;
        } else if (hasHardware) {
            // Only hardware available
            return ExecutionEnvironment.HARDWARE;
        } else if (hasBlinka) {
            // Only simulation available
            return ExecutionEnvironment.SIMULATED;
        } else {
            // Nothing available - try simulation anyway and let it fail gracefully
            return ExecutionEnvironment.SIMULATED;
        }
    }

    /**
     * Select device for hardware execution
     */
    private async selectDevice(): Promise<string | undefined> {
        const connections = this.unifiedDebugManager.getConnectionStates();
        if (connections.size === 0) {
            return undefined;
        }

        if (connections.size === 1) {
            return Array.from(connections.keys())[0];
        }

        // Multiple devices - let user choose
        const deviceItems = Array.from(connections.entries()).map(([deviceId, state]) => ({
            label: deviceId,
            description: `${state.connectionMethod} - ${state.isConnected ? 'Connected' : 'Disconnected'}`,
            deviceId
        }));

        const selectedDevice = await vscode.window.showQuickPick(deviceItems, {
            placeHolder: 'Select hardware device for execution',
            canPickMany: false
        });

        return selectedDevice?.deviceId;
    }

    /**
     * Select board configuration for simulation
     */
    private async selectBoard(): Promise<BlinkaBoard | undefined> {
        const availableBoards = this.blinkaExecutionManager.getAvailableBoards();
        
        if (availableBoards.length === 0) {
            return undefined;
        }

        // Use selected board from preferences if available
        if (this.userPreferences.selectedBoard) {
            const selectedBoard = availableBoards.find(b => b.boardId === this.userPreferences.selectedBoard);
            if (selectedBoard) {
                return selectedBoard;
            }
        }

        // Single board - use it
        if (availableBoards.length === 1) {
            return availableBoards[0];
        }

        // Multiple boards - let user choose
        const boardItems = availableBoards.map(board => ({
            label: board.name,
            description: `${board.features.join(', ')}`,
            detail: `Digital: ${board.pins.digital.length}, Analog: ${board.pins.analog.length}`,
            board
        }));

        const selectedBoard = await vscode.window.showQuickPick(boardItems, {
            placeHolder: 'Select board configuration for simulation',
            canPickMany: false
        });

        if (selectedBoard) {
            // Save selection for future use
            this.userPreferences.selectedBoard = selectedBoard.board.boardId;
            await this.saveUserPreferences();
        }

        return selectedBoard?.board;
    }

    /**
     * Create new execution session
     */
    private createExecutionSession(code: string, fileName?: string): string {
        const sessionId = `exec-session-${++this.sessionCounter}`;
        
        const session: ExecutionSession = {
            sessionId,
            startTime: Date.now(),
            code,
            fileName,
            preferences: { ...this.userPreferences },
            results: [],
            isActive: true
        };

        this.activeSessions.set(sessionId, session);
        return sessionId;
    }

    /**
     * Update execution session with result
     */
    private updateSession(sessionId: string, result: ExecutionResult | DualExecutionComparison): void {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.results.push(result);
            session.isActive = false;
        }
    }

    /**
     * Handle execution result display and analysis
     */
    private async handleExecutionResult(result: ExecutionResult | DualExecutionComparison, sessionId: string): Promise<void> {
        if ('comparison' in result) {
            // Dual execution result
            await this.handleDualExecutionResult(result, sessionId);
        } else {
            // Single environment result
            await this.handleSingleExecutionResult(result, sessionId);
        }
    }

    /**
     * Handle dual execution result with comparison analysis
     */
    private async handleDualExecutionResult(result: DualExecutionComparison, sessionId: string): Promise<void> {
        const { hardwareResult, simulatedResult, comparison } = result;

        // Create result summary
        let message = `Dual Execution Complete (Session: ${sessionId})\n\n`;
        
        // Execution status
        message += `Hardware: ${hardwareResult.success ? '✅ Success' : '❌ Failed'} (${hardwareResult.executionTime}ms)\n`;
        message += `Simulation: ${simulatedResult.success ? '✅ Success' : '❌ Failed'} (${simulatedResult.executionTime}ms)\n\n`;

        // Comparison results
        message += `Comparison Results:\n`;
        message += `Output Match: ${comparison.outputMatch ? '✅ Yes' : '❌ No'} (${(comparison.outputSimilarity * 100).toFixed(1)}% similarity)\n`;
        message += `Timing Difference: ${comparison.timingDifference}ms\n\n`;

        // Discrepancies
        if (comparison.discrepancies.length > 0) {
            message += `Discrepancies:\n`;
            comparison.discrepancies.forEach(d => message += `⚠️ ${d}\n`);
            message += '\n';
        }

        // Recommendations
        if (comparison.recommendations.length > 0) {
            message += `Recommendations:\n`;
            comparison.recommendations.forEach(r => message += `💡 ${r}\n`);
        }

        // Show results with options
        const actions = ['Show Details', 'Save Report'];
        if (this.userPreferences.enableEducationalTips) {
            actions.push('Learning Tips');
        }

        const choice = await vscode.window.showInformationMessage(message, ...actions);

        switch (choice) {
            case 'Show Details':
                await this.showDetailedResults(result);
                break;
            case 'Save Report':
                await this.saveExecutionReport(result, sessionId);
                break;
            case 'Learning Tips':
                await this.showLearningTips(result);
                break;
        }
    }

    /**
     * Handle single execution result
     */
    private async handleSingleExecutionResult(result: ExecutionResult, sessionId: string): Promise<void> {
        const envName = result.environment === ExecutionEnvironment.HARDWARE ? 'Hardware' : 'Simulation';
        const status = result.success ? '✅ Success' : '❌ Failed';
        
        let message = `${envName} Execution Complete (Session: ${sessionId})\n\n`;
        message += `Status: ${status}\n`;
        message += `Execution Time: ${result.executionTime}ms\n`;
        
        if (result.memoryUsage) {
            const memoryUsed = result.memoryUsage.peak - result.memoryUsage.before;
            message += `Memory Used: ${(memoryUsed / 1024 / 1024).toFixed(2)} MB\n`;
        }
        
        if (result.output) {
            message += `\nOutput:\n${result.output}`;
        }
        
        if (result.error) {
            message += `\nError: ${result.error}`;
        }

        const actions = ['Show Output'];
        if (result.success && result.environment === ExecutionEnvironment.SIMULATED) {
            actions.push('Try on Hardware');
        } else if (result.success && result.environment === ExecutionEnvironment.HARDWARE) {
            actions.push('Compare with Simulation');
        }

        const choice = await vscode.window.showInformationMessage(message, ...actions);

        switch (choice) {
            case 'Show Output':
                await this.showExecutionOutput(result);
                break;
            case 'Try on Hardware':
                await this.retryOnHardware(sessionId);
                break;
            case 'Compare with Simulation':
                await this.retryWithComparison(sessionId);
                break;
        }
    }

    /**
     * Show detailed execution results in a new document
     */
    private async showDetailedResults(result: ExecutionResult | DualExecutionComparison): Promise<void> {
        let content = `# Execution Results - ${new Date().toLocaleString()}\n\n`;

        if ('comparison' in result) {
            // Dual execution
            content += `## Dual Execution Comparison\n\n`;
            content += `### Hardware Results\n`;
            content += this.formatExecutionResult(result.hardwareResult);
            content += `\n### Simulation Results\n`;
            content += this.formatExecutionResult(result.simulatedResult);
            content += `\n### Comparison Analysis\n`;
            content += this.formatComparison(result.comparison);
        } else {
            // Single execution
            content += `## ${result.environment === ExecutionEnvironment.HARDWARE ? 'Hardware' : 'Simulation'} Execution\n\n`;
            content += this.formatExecutionResult(result);
        }

        // Create new document
        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });
        
        await vscode.window.showTextDocument(doc);
    }

    /**
     * Format execution result for display
     */
    private formatExecutionResult(result: ExecutionResult): string {
        let content = `**Status:** ${result.success ? 'Success ✅' : 'Failed ❌'}\n`;
        content += `**Execution Time:** ${result.executionTime}ms\n`;
        content += `**Device:** ${result.deviceId || 'Simulation'}\n`;
        
        if (result.memoryUsage) {
            content += `**Memory Usage:**\n`;
            content += `  - Before: ${(result.memoryUsage.before / 1024 / 1024).toFixed(2)} MB\n`;
            content += `  - After: ${(result.memoryUsage.after / 1024 / 1024).toFixed(2)} MB\n`;
            content += `  - Peak: ${(result.memoryUsage.peak / 1024 / 1024).toFixed(2)} MB\n`;
        }

        content += `\n**Output:**\n\`\`\`\n${result.output || '(no output)'}\n\`\`\`\n`;
        
        if (result.error) {
            content += `\n**Error:**\n\`\`\`\n${result.error}\n\`\`\`\n`;
        }

        return content;
    }

    /**
     * Format comparison analysis for display
     */
    private formatComparison(comparison: DualExecutionComparison['comparison']): string {
        let content = `**Output Match:** ${comparison.outputMatch ? 'Yes ✅' : 'No ❌'}\n`;
        content += `**Output Similarity:** ${(comparison.outputSimilarity * 100).toFixed(1)}%\n`;
        content += `**Timing Difference:** ${comparison.timingDifference}ms\n`;
        
        if (comparison.memoryDifference !== undefined) {
            content += `**Memory Difference:** ${(comparison.memoryDifference / 1024 / 1024).toFixed(2)} MB\n`;
        }

        if (comparison.discrepancies.length > 0) {
            content += `\n**Discrepancies:**\n`;
            comparison.discrepancies.forEach(d => content += `- ${d}\n`);
        }

        if (comparison.recommendations.length > 0) {
            content += `\n**Recommendations:**\n`;
            comparison.recommendations.forEach(r => content += `- ${r}\n`);
        }

        return content;
    }

    /**
     * Show learning tips based on execution results
     */
    private async showLearningTips(result: DualExecutionComparison): Promise<void> {
        const tips: string[] = [];

        // Analyze results and provide educational insights
        if (result.comparison.outputMatch && result.comparison.timingDifference < 1000) {
            tips.push('🎉 Excellent! Your code works consistently across both hardware and simulation.');
            tips.push('💡 This indicates good, portable CircuitPython code that doesn\'t depend on hardware-specific timing.');
        }

        if (!result.comparison.outputMatch) {
            tips.push('🔍 The outputs differ between hardware and simulation. This could be due to:');
            tips.push('  • Sensor readings (simulation uses mock data)');
            tips.push('  • Hardware-specific features not available in simulation');
            tips.push('  • Timing-sensitive operations');
            tips.push('💡 Consider adding print statements to debug where the outputs diverge.');
        }

        if (result.comparison.timingDifference > 2000) {
            tips.push('⏱️ Significant timing difference detected!');
            if (result.simulatedResult.executionTime > result.hardwareResult.executionTime) {
                tips.push('💡 Simulation is slower - this is normal for complex calculations.');
            } else {
                tips.push('💡 Hardware is slower - check for blocking I/O operations like time.sleep().');
            }
        }

        if (result.hardwareResult.success && !result.simulatedResult.success) {
            tips.push('⚠️ Code works on hardware but fails in simulation.');
            tips.push('💡 This might indicate use of hardware-specific libraries not supported by Blinka.');
        }

        if (!result.hardwareResult.success && result.simulatedResult.success) {
            tips.push('⚠️ Code works in simulation but fails on hardware.');
            tips.push('💡 Check your hardware connections and ensure devices are properly connected.');
        }

        // Educational content about dual execution benefits
        tips.push('');
        tips.push('📚 **Why Dual Execution Matters:**');
        tips.push('• Helps debug hardware issues by comparing with known-good simulation');
        tips.push('• Validates code logic before deploying to expensive hardware');
        tips.push('• Provides immediate feedback during development');
        tips.push('• Teaches differences between simulation and real-world behavior');

        const tipsText = tips.join('\n');
        
        const doc = await vscode.workspace.openTextDocument({
            content: `# Learning Tips - Dual Execution\n\n${tipsText}`,
            language: 'markdown'
        });
        
        await vscode.window.showTextDocument(doc, { preview: true });
    }

    /**
     * Handle execution errors
     */
    private handleExecutionError(sessionId: string, error: unknown): void {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.isActive = false;
        }

        console.error(`Execution error in session ${sessionId}:`, error);
    }

    /**
     * Get execution session history
     */
    getSessionHistory(): ExecutionSession[] {
        return Array.from(this.activeSessions.values());
    }

    /**
     * Clear session history
     */
    clearSessionHistory(): void {
        this.activeSessions.clear();
        this.sessionCounter = 0;
    }

    /**
     * Load user preferences from VS Code settings
     */
    private loadUserPreferences(): void {
        const config = vscode.workspace.getConfiguration('muTwo.blinka');
        
        this.userPreferences = {
            mode: config.get('defaultExecutionMode', ExecutionMode.AUTO_SELECT) as ExecutionMode,
            selectedBoard: config.get('preferredBoard'),
            enableProfiling: config.get('enableProfiling', true),
            timeout: config.get('executionTimeout', 30000),
            autoShowComparison: config.get('autoShowComparison', true),
            enableEducationalTips: config.get('enableEducationalTips', true)
        };
    }

    /**
     * Save user preferences to VS Code settings
     */
    private async saveUserPreferences(): Promise<void> {
        const config = vscode.workspace.getConfiguration('muTwo.blinka');
        
        await config.update('defaultExecutionMode', this.userPreferences.mode);
        await config.update('preferredBoard', this.userPreferences.selectedBoard);
        await config.update('enableProfiling', this.userPreferences.enableProfiling);
        await config.update('executionTimeout', this.userPreferences.timeout);
        await config.update('autoShowComparison', this.userPreferences.autoShowComparison);
        await config.update('enableEducationalTips', this.userPreferences.enableEducationalTips);
    }

    /**
     * Set up event handlers
     */
    private setupEventHandlers(): void {
        // Listen for dual execution completion
        this.blinkaExecutionManager.on('dualExecutionComplete', (result: DualExecutionComparison) => {
            if (this.userPreferences.autoShowComparison) {
                // Auto-show results handled by handleExecutionResult
            }
        });
    }

    /**
     * Show execution output in output channel
     */
    private async showExecutionOutput(result: ExecutionResult): Promise<void> {
        const logger = getLogger();
        logger.info('EXECUTION', `${result.environment} Execution Results`);
        logger.info('EXECUTION', '='.repeat(50));
        logger.info('EXECUTION', `Status: ${result.success ? 'Success' : 'Failed'}`);
        logger.info('EXECUTION', `Execution Time: ${result.executionTime}ms`);
        logger.info('EXECUTION', `Device: ${result.deviceId || 'Simulation'}`);
        logger.info('EXECUTION', `Output: ${result.output || '(no output)'}`);

        if (result.error) {
            logger.error('EXECUTION', `Error: ${result.error}`);
        }
    }

    /**
     * Retry execution on hardware
     */
    private async retryOnHardware(sessionId: string): Promise<void> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return;
        }

        try {
            const result = await this.executeOnHardware(session.code);
            this.updateSession(sessionId, result);
            await this.handleSingleExecutionResult(result, sessionId);
        } catch (error) {
            vscode.window.showErrorMessage(`Hardware execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Retry with dual execution comparison
     */
    private async retryWithComparison(sessionId: string): Promise<void> {
        const session = this.activeSessions.get(sessionId);
        if (!session) {
            return;
        }

        try {
            const result = await this.executeDual(session.code);
            this.updateSession(sessionId, result);
            await this.handleDualExecutionResult(result, sessionId);
        } catch (error) {
            vscode.window.showErrorMessage(`Dual execution failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Save execution report to file
     */
    private async saveExecutionReport(result: ExecutionResult | DualExecutionComparison, sessionId: string): Promise<void> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `execution-report-${sessionId}-${timestamp}.md`;
        
        let content = `# Execution Report - ${new Date().toLocaleString()}\n\n`;
        content += `Session ID: ${sessionId}\n\n`;

        if ('comparison' in result) {
            content += this.formatExecutionResult(result.hardwareResult);
            content += '\n---\n\n';
            content += this.formatExecutionResult(result.simulatedResult);
            content += '\n---\n\n';
            content += this.formatComparison(result.comparison);
        } else {
            content += this.formatExecutionResult(result);
        }

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.joinPath(this.context.globalStorageUri, fileName),
            filters: {
                'Markdown': ['md'],
                'All Files': ['*']
            }
        });

        if (saveUri) {
            await vscode.workspace.fs.writeFile(saveUri, Buffer.from(content, 'utf8'));
            vscode.window.showInformationMessage(`Execution report saved: ${saveUri.fsPath}`);
        }
    }

    /**
     * Update user preferences
     */
    async updatePreferences(newPreferences: Partial<ExecutionPreferences>): Promise<void> {
        this.userPreferences = { ...this.userPreferences, ...newPreferences };
        await this.saveUserPreferences();
    }

    /**
     * Get current user preferences
     */
    getPreferences(): ExecutionPreferences {
        return { ...this.userPreferences };
    }

    /**
     * Dispose and cleanup
     */
    dispose(): void {
        this.activeSessions.clear();
        console.log('Dual Execution Interface disposed');
    }
}