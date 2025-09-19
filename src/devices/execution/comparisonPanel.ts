import * as vscode from 'vscode';
import { DualExecutionComparison, ExecutionResult } from './blinkaExecutionManager';
import { DualExecutionInterface, ExecutionSession } from './dualExecutionInterface';
import { getNonce } from '../../sys/utils/webview';

/**
 * Comparison Visualization Panel - Visual interface for dual execution results
 * 
 * This webview panel provides:
 * - Side-by-side comparison of hardware vs simulation results
 * - Interactive charts showing performance metrics
 * - Educational insights and recommendations
 * - Execution history and trend analysis
 */
export class ComparisonVisualizationPanel {
    public static readonly viewType = 'muTwo.comparisonVisualization';
    
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private dualExecutionInterface: DualExecutionInterface;

    constructor(
        context: vscode.ExtensionContext,
        dualExecutionInterface: DualExecutionInterface
    ) {
        this.context = context;
        this.dualExecutionInterface = dualExecutionInterface;
    }

    /**
     * Create and show the comparison panel
     */
    public async createOrShowPanel(): Promise<void> {
        const column = vscode.window.activeTextEditor ? 
            vscode.window.activeTextEditor.viewColumn : undefined;

        if (this.panel) {
            this.panel.reveal(column);
            return;
        }

        // Create webview panel
        this.panel = vscode.window.createWebviewPanel(
            ComparisonVisualizationPanel.viewType,
            'CircuitPython Execution Comparison',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'dist')
                ]
            }
        );

        // Set up webview content and event handlers
        await this.setupWebview();
        this.setupEventHandlers();

        console.log('Comparison Visualization Panel created successfully');
    }

    /**
     * Show specific comparison result
     */
    public async showComparison(comparison: DualExecutionComparison): Promise<void> {
        await this.createOrShowPanel();
        
        if (this.panel) {
            this.panel.webview.postMessage({
                type: 'showComparison',
                data: comparison
            });
        }
    }

    /**
     * Set up webview content
     */
    private async setupWebview(): Promise<void> {
        if (!this.panel) {
            return;
        }

        const webview = this.panel.webview;
        const nonce = getNonce();

        // Get execution history for display
        const sessionHistory = this.dualExecutionInterface.getSessionHistory();
        const recentComparisons = sessionHistory
            .flatMap(session => session.results)
            .filter((result): result is DualExecutionComparison => 'comparison' in result)
            .slice(-10); // Last 10 comparisons

        // Set webview HTML content
        webview.html = this.getWebviewContent(nonce, recentComparisons);
    }

    /**
     * Set up webview event handlers
     */
    private setupEventHandlers(): void {
        if (!this.panel) {
            return;
        }

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            this.dispose();
        });

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(async (message) => {
            await this.handleWebviewMessage(message);
        });
    }

    /**
     * Handle messages from webview
     */
    private async handleWebviewMessage(message: any): Promise<void> {
        switch (message.type) {
            case 'executeCode':
                await this.executeCodeFromPanel(message.code, message.environment);
                break;

            case 'clearHistory':
                this.clearHistory();
                break;

            case 'exportComparison':
                await this.exportComparison(message.comparisonId);
                break;

            case 'requestHistoryUpdate':
                await this.sendHistoryUpdate();
                break;

            default:
                console.log('Unknown webview message type:', message.type);
        }
    }

    /**
     * Execute code from panel interface
     */
    private async executeCodeFromPanel(code: string, environment: string): Promise<void> {
        try {
            let result;
            
            switch (environment) {
                case 'dual':
                    result = await this.dualExecutionInterface.executeDual(code);
                    break;
                case 'hardware':
                    result = await this.dualExecutionInterface.executeOnHardware(code);
                    break;
                case 'simulation':
                    result = await this.dualExecutionInterface.executeOnSimulation(code);
                    break;
                default:
                    result = await this.dualExecutionInterface.executeCode(code);
            }

            // Send result to webview
            this.panel?.webview.postMessage({
                type: 'executionResult',
                data: result
            });

        } catch (error) {
            this.panel?.webview.postMessage({
                type: 'executionError',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Clear execution history
     */
    private clearHistory(): void {
        this.dualExecutionInterface.clearSessionHistory();
        this.panel?.webview.postMessage({
            type: 'historyCleared'
        });
    }

    /**
     * Export comparison data
     */
    private async exportComparison(comparisonId: string): Promise<void> {
        // This would export the specific comparison data
        // Implementation would depend on how comparisons are tracked
        vscode.window.showInformationMessage('Export functionality not yet implemented');
    }

    /**
     * Send history update to webview
     */
    private async sendHistoryUpdate(): Promise<void> {
        const sessionHistory = this.dualExecutionInterface.getSessionHistory();
        const recentComparisons = sessionHistory
            .flatMap(session => session.results)
            .filter((result): result is DualExecutionComparison => 'comparison' in result)
            .slice(-10);

        this.panel?.webview.postMessage({
            type: 'historyUpdate',
            data: recentComparisons
        });
    }

    /**
     * Generate webview HTML content
     */
    private getWebviewContent(nonce: string, recentComparisons: DualExecutionComparison[]): string {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src data: https:;">
    <title>CircuitPython Execution Comparison</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 30px;
            padding-bottom: 15px;
            border-bottom: 2px solid var(--vscode-panel-border);
        }

        .header h1 {
            font-size: 24px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }

        .header-actions {
            display: flex;
            gap: 10px;
        }

        .btn {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: background-color 0.2s;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .main-content {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 30px;
        }

        .comparison-area {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .code-input {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            padding: 15px;
        }

        .code-input h3 {
            margin-bottom: 10px;
            font-size: 16px;
            font-weight: 600;
        }

        .code-textarea {
            width: 100%;
            min-height: 120px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 12px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            resize: vertical;
        }

        .execution-controls {
            display: flex;
            gap: 10px;
            margin-top: 10px;
        }

        .comparison-results {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            overflow: hidden;
        }

        .comparison-header {
            background: var(--vscode-titleBar-activeBackground);
            color: var(--vscode-titleBar-activeForeground);
            padding: 15px 20px;
            font-weight: 600;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .comparison-body {
            padding: 20px;
        }

        .execution-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }

        .execution-result {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 15px;
        }

        .execution-result h4 {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
            font-size: 14px;
            font-weight: 600;
        }

        .status-icon {
            width: 16px;
            height: 16px;
            border-radius: 50%;
        }

        .status-success { background: var(--vscode-charts-green); }
        .status-error { background: var(--vscode-charts-red); }

        .metric {
            display: flex;
            justify-content: space-between;
            margin: 8px 0;
            font-size: 13px;
        }

        .metric-label {
            color: var(--vscode-descriptionForeground);
        }

        .metric-value {
            font-weight: 500;
        }

        .output-section {
            margin-top: 15px;
        }

        .output-content {
            background: var(--vscode-terminal-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            max-height: 150px;
            overflow-y: auto;
            white-space: pre-wrap;
            color: var(--vscode-terminal-foreground);
        }

        .comparison-analysis {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 15px;
            margin-top: 20px;
        }

        .analysis-section {
            margin-bottom: 15px;
        }

        .analysis-section h5 {
            font-size: 13px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        .analysis-item {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 4px 0;
            font-size: 12px;
        }

        .analysis-icon {
            width: 16px;
            height: 16px;
            text-align: center;
        }

        .sidebar {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .history-panel {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            overflow: hidden;
        }

        .panel-header {
            background: var(--vscode-titleBar-activeBackground);
            color: var(--vscode-titleBar-activeForeground);
            padding: 12px 15px;
            font-weight: 600;
            font-size: 13px;
        }

        .history-list {
            max-height: 400px;
            overflow-y: auto;
        }

        .history-item {
            padding: 12px 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background-color 0.2s;
        }

        .history-item:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .history-item:last-child {
            border-bottom: none;
        }

        .history-item-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 4px;
        }

        .history-timestamp {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .history-status {
            font-size: 11px;
            font-weight: 500;
        }

        .success { color: var(--vscode-charts-green); }
        .error { color: var(--vscode-charts-red); }
        .mixed { color: var(--vscode-charts-orange); }

        .history-summary {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .tips-panel {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 15px;
        }

        .tips-panel h3 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }

        .tip-item {
            margin: 8px 0;
            font-size: 12px;
            line-height: 1.5;
            color: var(--vscode-descriptionForeground);
        }

        .tip-icon {
            color: var(--vscode-charts-blue);
            margin-right: 6px;
        }

        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .loading-state {
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }

        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top: 2px solid var(--vscode-progressBar-foreground);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @media (max-width: 1200px) {
            .main-content {
                grid-template-columns: 1fr;
                gap: 20px;
            }
            
            .execution-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>CircuitPython Execution Comparison</h1>
        <div class="header-actions">
            <button class="btn secondary" onclick="clearHistory()">Clear History</button>
            <button class="btn" onclick="refreshHistory()">Refresh</button>
        </div>
    </div>

    <div class="main-content">
        <div class="comparison-area">
            <div class="code-input">
                <h3>Code to Execute</h3>
                <textarea 
                    id="code-textarea" 
                    class="code-textarea" 
                    placeholder="Enter your CircuitPython code here...
Example:
import board
import digitalio
import time

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

for i in range(5):
    led.value = True
    time.sleep(0.5)
    led.value = False
    time.sleep(0.5)
    print(f'Blink {i+1}')

print('Done!')"></textarea>
                <div class="execution-controls">
                    <button class="btn" onclick="executeCode('dual')">🔄 Dual Execute</button>
                    <button class="btn secondary" onclick="executeCode('hardware')">🔧 Hardware Only</button>
                    <button class="btn secondary" onclick="executeCode('simulation')">💻 Simulation Only</button>
                </div>
            </div>

            <div class="comparison-results" id="comparison-results" style="display: none;">
                <div class="comparison-header">
                    <span id="comparison-title">Execution Results</span>
                    <button class="btn secondary" onclick="exportResults()">Export</button>
                </div>
                <div class="comparison-body" id="comparison-body">
                    <!-- Results will be populated here -->
                </div>
            </div>
        </div>

        <div class="sidebar">
            <div class="history-panel">
                <div class="panel-header">Execution History</div>
                <div class="history-list" id="history-list">
                    <div class="empty-state">No executions yet</div>
                </div>
            </div>

            <div class="tips-panel">
                <h3>💡 Tips</h3>
                <div class="tip-item">
                    <span class="tip-icon">🔄</span>
                    Dual execution helps you understand differences between hardware and simulation
                </div>
                <div class="tip-item">
                    <span class="tip-icon">⚡</span>
                    Simulation is great for rapid prototyping without hardware
                </div>
                <div class="tip-item">
                    <span class="tip-icon">🔧</span>
                    Hardware execution shows real-world behavior and timing
                </div>
                <div class="tip-item">
                    <span class="tip-icon">📊</span>
                    Compare outputs to debug hardware-specific issues
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        let currentComparison = null;
        
        // Initialize with recent comparisons
        const recentComparisons = ${JSON.stringify(recentComparisons)};
        updateHistoryList(recentComparisons);

        // Execute code in specified environment
        function executeCode(environment) {
            const code = document.getElementById('code-textarea').value.trim();
            if (!code) {
                alert('Please enter some code to execute');
                return;
            }

            showLoadingState();
            vscode.postMessage({
                type: 'executeCode',
                code: code,
                environment: environment
            });
        }

        // Clear execution history
        function clearHistory() {
            if (confirm('Are you sure you want to clear all execution history?')) {
                vscode.postMessage({ type: 'clearHistory' });
            }
        }

        // Refresh history
        function refreshHistory() {
            vscode.postMessage({ type: 'requestHistoryUpdate' });
        }

        // Export results
        function exportResults() {
            if (currentComparison) {
                vscode.postMessage({
                    type: 'exportComparison',
                    comparisonId: currentComparison.timestamp
                });
            }
        }

        // Show loading state
        function showLoadingState() {
            const resultsDiv = document.getElementById('comparison-results');
            const bodyDiv = document.getElementById('comparison-body');
            
            resultsDiv.style.display = 'block';
            bodyDiv.innerHTML = '<div class="loading-state"><div class="spinner"></div> Executing...</div>';
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'showComparison':
                    showComparisonResult(message.data);
                    break;

                case 'executionResult':
                    showExecutionResult(message.data);
                    break;

                case 'executionError':
                    showExecutionError(message.error);
                    break;

                case 'historyUpdate':
                    updateHistoryList(message.data);
                    break;

                case 'historyCleared':
                    updateHistoryList([]);
                    break;
            }
        });

        // Show comparison result
        function showComparisonResult(comparison) {
            currentComparison = comparison;
            const resultsDiv = document.getElementById('comparison-results');
            const titleSpan = document.getElementById('comparison-title');
            const bodyDiv = document.getElementById('comparison-body');

            resultsDiv.style.display = 'block';
            titleSpan.textContent = 'Dual Execution Comparison';

            const hardwareResult = comparison.hardwareResult;
            const simulatedResult = comparison.simulatedResult;
            const analysis = comparison.comparison;

            bodyDiv.innerHTML = \`
                <div class="execution-grid">
                    <div class="execution-result">
                        <h4>
                            <span class="status-icon \${hardwareResult.success ? 'status-success' : 'status-error'}"></span>
                            Hardware Execution
                        </h4>
                        <div class="metric">
                            <span class="metric-label">Status:</span>
                            <span class="metric-value">\${hardwareResult.success ? 'Success ✅' : 'Failed ❌'}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Time:</span>
                            <span class="metric-value">\${hardwareResult.executionTime}ms</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Device:</span>
                            <span class="metric-value">\${hardwareResult.deviceId || 'Unknown'}</span>
                        </div>
                        \${hardwareResult.output || hardwareResult.error ? \`
                            <div class="output-section">
                                <h5>Output:</h5>
                                <div class="output-content">\${hardwareResult.output || hardwareResult.error || '(no output)'}</div>
                            </div>
                        \` : ''}
                    </div>
                    
                    <div class="execution-result">
                        <h4>
                            <span class="status-icon \${simulatedResult.success ? 'status-success' : 'status-error'}"></span>
                            Simulation Execution
                        </h4>
                        <div class="metric">
                            <span class="metric-label">Status:</span>
                            <span class="metric-value">\${simulatedResult.success ? 'Success ✅' : 'Failed ❌'}</span>
                        </div>
                        <div class="metric">
                            <span class="metric-label">Time:</span>
                            <span class="metric-value">\${simulatedResult.executionTime}ms</span>
                        </div>
                        \${simulatedResult.memoryUsage ? \`
                            <div class="metric">
                                <span class="metric-label">Memory:</span>
                                <span class="metric-value">\${((simulatedResult.memoryUsage.peak - simulatedResult.memoryUsage.before) / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                        \` : ''}
                        \${simulatedResult.output || simulatedResult.error ? \`
                            <div class="output-section">
                                <h5>Output:</h5>
                                <div class="output-content">\${simulatedResult.output || simulatedResult.error || '(no output)'}</div>
                            </div>
                        \` : ''}
                    </div>
                </div>

                <div class="comparison-analysis">
                    <div class="analysis-section">
                        <h5>📊 Comparison Results</h5>
                        <div class="analysis-item">
                            <span class="analysis-icon">\${analysis.outputMatch ? '✅' : '❌'}</span>
                            Output Match: \${analysis.outputMatch ? 'Yes' : 'No'} (\${(analysis.outputSimilarity * 100).toFixed(1)}% similarity)
                        </div>
                        <div class="analysis-item">
                            <span class="analysis-icon">⏱️</span>
                            Timing Difference: \${analysis.timingDifference}ms
                        </div>
                        \${analysis.memoryDifference ? \`
                            <div class="analysis-item">
                                <span class="analysis-icon">🧠</span>
                                Memory Difference: \${(analysis.memoryDifference / 1024 / 1024).toFixed(2)} MB
                            </div>
                        \` : ''}
                    </div>

                    \${analysis.discrepancies.length > 0 ? \`
                        <div class="analysis-section">
                            <h5>⚠️ Discrepancies</h5>
                            \${analysis.discrepancies.map(d => \`
                                <div class="analysis-item">
                                    <span class="analysis-icon">⚠️</span>
                                    \${d}
                                </div>
                            \`).join('')}
                        </div>
                    \` : ''}

                    \${analysis.recommendations.length > 0 ? \`
                        <div class="analysis-section">
                            <h5>💡 Recommendations</h5>
                            \${analysis.recommendations.map(r => \`
                                <div class="analysis-item">
                                    <span class="analysis-icon">💡</span>
                                    \${r}
                                </div>
                            \`).join('')}
                        </div>
                    \` : ''}
                </div>
            \`;
        }

        // Show single execution result
        function showExecutionResult(result) {
            const resultsDiv = document.getElementById('comparison-results');
            const titleSpan = document.getElementById('comparison-title');
            const bodyDiv = document.getElementById('comparison-body');

            resultsDiv.style.display = 'block';
            titleSpan.textContent = \`\${result.environment} Execution Result\`;

            const envName = result.environment === 'hardware' ? 'Hardware' : 'Simulation';

            bodyDiv.innerHTML = \`
                <div class="execution-result">
                    <h4>
                        <span class="status-icon \${result.success ? 'status-success' : 'status-error'}"></span>
                        \${envName} Execution
                    </h4>
                    <div class="metric">
                        <span class="metric-label">Status:</span>
                        <span class="metric-value">\${result.success ? 'Success ✅' : 'Failed ❌'}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Time:</span>
                        <span class="metric-value">\${result.executionTime}ms</span>
                    </div>
                    \${result.deviceId ? \`
                        <div class="metric">
                            <span class="metric-label">Device:</span>
                            <span class="metric-value">\${result.deviceId}</span>
                        </div>
                    \` : ''}
                    \${result.memoryUsage ? \`
                        <div class="metric">
                            <span class="metric-label">Memory:</span>
                            <span class="metric-value">\${((result.memoryUsage.peak - result.memoryUsage.before) / 1024 / 1024).toFixed(2)} MB</span>
                        </div>
                    \` : ''}
                    \${result.output || result.error ? \`
                        <div class="output-section">
                            <h5>Output:</h5>
                            <div class="output-content">\${result.output || result.error || '(no output)'}</div>
                        </div>
                    \` : ''}
                </div>
            \`;
        }

        // Show execution error
        function showExecutionError(error) {
            const resultsDiv = document.getElementById('comparison-results');
            const titleSpan = document.getElementById('comparison-title');
            const bodyDiv = document.getElementById('comparison-body');

            resultsDiv.style.display = 'block';
            titleSpan.textContent = 'Execution Error';

            bodyDiv.innerHTML = \`
                <div class="execution-result">
                    <h4>
                        <span class="status-icon status-error"></span>
                        Execution Failed
                    </h4>
                    <div class="output-section">
                        <h5>Error:</h5>
                        <div class="output-content">\${error}</div>
                    </div>
                </div>
            \`;
        }

        // Update history list
        function updateHistoryList(comparisons) {
            const historyList = document.getElementById('history-list');
            
            if (comparisons.length === 0) {
                historyList.innerHTML = '<div class="empty-state">No executions yet</div>';
                return;
            }

            historyList.innerHTML = comparisons.reverse().map(comparison => {
                const timestamp = new Date(comparison.timestamp).toLocaleTimeString();
                const hardwareSuccess = comparison.hardwareResult.success;
                const simulatedSuccess = comparison.simulatedResult.success;
                
                let statusClass, statusText;
                if (hardwareSuccess && simulatedSuccess) {
                    statusClass = 'success';
                    statusText = 'Both Success';
                } else if (!hardwareSuccess && !simulatedSuccess) {
                    statusClass = 'error';
                    statusText = 'Both Failed';
                } else {
                    statusClass = 'mixed';
                    statusText = 'Mixed Results';
                }

                return \`
                    <div class="history-item" onclick="showComparison(\${JSON.stringify(comparison).replace(/"/g, '&quot;')})">
                        <div class="history-item-header">
                            <span class="history-timestamp">\${timestamp}</span>
                            <span class="history-status \${statusClass}">\${statusText}</span>
                        </div>
                        <div class="history-summary">
                            Match: \${comparison.comparison.outputMatch ? 'Yes' : 'No'} • 
                            Time Diff: \${comparison.comparison.timingDifference}ms
                        </div>
                    </div>
                \`;
            }).join('');
        }

        // Show comparison from history
        function showComparison(comparison) {
            showComparisonResult(comparison);
        }
    </script>
</body>
</html>
        `;
    }

    /**
     * Dispose the panel and cleanup resources
     */
    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }

        this.panel = undefined;
        
        console.log('Comparison Visualization Panel disposed');
    }
}