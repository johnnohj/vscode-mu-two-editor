/**
 * Data Sharing Module for Webview-REPL
 *
 * Implements 'import ... from mu_repl' functionality by:
 * - Intercepting import-like commands
 * - Requesting data from ReplCoordinator
 * - Injecting variables into the REPL context
 */

class MuReplDataSharing {
    constructor(vscode, terminal) {
        this.vscode = vscode;
        this.terminal = terminal;
        this.sharedData = new Map();
        this.pendingRequests = new Map();
        this.setupMessageHandling();
        this.setupImportInterception();
    }

    /**
     * Set up message handling for data coordination
     */
    setupMessageHandling() {
        // Listen for data updates from extension
        window.addEventListener('message', (event) => {
            const message = event.data;

            switch (message.type) {
                case 'dataUpdate':
                    this.handleDataUpdate(message);
                    break;
                case 'dataResponse':
                    this.handleDataResponse(message);
                    break;
                case 'initialDataSync':
                    this.handleInitialDataSync(message);
                    break;
                case 'sensorDataUpdate':
                    this.handleSensorDataUpdate(message);
                    break;
                case 'hardwareStateUpdate':
                    this.handleHardwareStateUpdate(message);
                    break;
                case 'pinStateUpdate':
                    this.handlePinStateUpdate(message);
                    break;
            }
        });
    }

    /**
     * Set up import command interception
     */
    setupImportInterception() {
        // Override terminal data handler to intercept import commands
        if (this.terminal && this.terminal.onData) {
            const originalOnData = this.terminal.onData;

            // Store reference to original handler
            this.originalDataHandler = null;

            // Intercept terminal input
            this.terminal.onData((data) => {
                const currentInput = this.getCurrentInput();
                const fullInput = currentInput + data;

                // Check for import-like patterns
                if (this.isImportCommand(fullInput)) {
                    this.handleImportCommand(fullInput);
                    return; // Don't pass to original handler
                }

                // Check for special mu_repl commands
                if (this.isMuReplCommand(fullInput)) {
                    this.handleMuReplCommand(fullInput);
                    return;
                }

                // Pass to original handler for normal input
                if (this.originalDataHandler) {
                    this.originalDataHandler(data);
                }
            });
        }
    }

    /**
     * Check if input is an import command
     */
    isImportCommand(input) {
        const trimmed = input.trim();

        // Pattern: import <name> from mu_repl
        // Pattern: import <namespace>.<name> from mu_repl
        // Pattern: from mu_repl import <name>
        const patterns = [
            /^import\s+(\w+(?:\.\w+)*)\s+from\s+mu_repl/,
            /^from\s+mu_repl\s+import\s+(\w+(?:\.\w+)*)/
        ];

        return patterns.some(pattern => pattern.test(trimmed));
    }

    /**
     * Check if input is a special mu_repl command
     */
    isMuReplCommand(input) {
        const trimmed = input.trim();

        // Special commands: mu_repl.list(), mu_repl.status(), etc.
        return trimmed.startsWith('mu_repl.');
    }

    /**
     * Handle import command execution
     */
    async handleImportCommand(input) {
        const trimmed = input.trim();

        // Parse import statement
        let importPath = null;
        let variableName = null;

        // Pattern: import <name> from mu_repl
        const pattern1 = /^import\s+(\w+(?:\.\w+)*)\s+from\s+mu_repl/.exec(trimmed);
        if (pattern1) {
            importPath = pattern1[1];
            variableName = importPath.split('.').pop(); // Use last part as variable name
        }

        // Pattern: from mu_repl import <name>
        const pattern2 = /^from\s+mu_repl\s+import\s+(\w+(?:\.\w+)*)/.exec(trimmed);
        if (pattern2) {
            importPath = pattern2[1];
            variableName = importPath.split('.').pop();
        }

        if (!importPath) {
            this.writeError('Invalid import syntax. Use: import <name> from mu_repl');
            return;
        }

        // Request data from extension
        const requestId = this.generateRequestId();
        const request = {
            type: 'dataRequest',
            importPath,
            requestId,
            timestamp: Date.now()
        };

        // Store pending request
        this.pendingRequests.set(requestId, { importPath, variableName, timestamp: Date.now() });

        // Send request to extension
        this.vscode.postMessage(request);

        // Show loading message
        this.writeInfo(`📥 Importing '${importPath}' from mu_repl...`);

        // Set up timeout
        setTimeout(() => {
            if (this.pendingRequests.has(requestId)) {
                this.pendingRequests.delete(requestId);
                this.writeError(`Import timeout: No data found for '${importPath}'`);
            }
        }, 5000);
    }

    /**
     * Handle special mu_repl commands
     */
    handleMuReplCommand(input) {
        const trimmed = input.trim();

        if (trimmed === 'mu_repl.list()' || trimmed === 'mu_repl.list') {
            this.showAvailableData();
        } else if (trimmed === 'mu_repl.status()' || trimmed === 'mu_repl.status') {
            this.showDataBusStatus();
        } else if (trimmed === 'mu_repl.clear()' || trimmed === 'mu_repl.clear') {
            this.clearSharedData();
        } else {
            this.writeError(`Unknown mu_repl command: ${trimmed}`);
        }

        this.showPrompt();
    }

    /**
     * Handle data response from extension
     */
    handleDataResponse(message) {
        const { requestId, importPath, data, success } = message;

        if (!this.pendingRequests.has(requestId)) {
            return; // Request expired or unknown
        }

        const request = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);

        if (success && data !== undefined) {
            // Store data locally
            this.sharedData.set(request.importPath, data);

            // Inject into REPL context (simulate variable assignment)
            this.writeSuccess(`✅ Imported '${request.variableName}' = ${this.formatValue(data)}`);

            // Send variable assignment command to terminal
            this.executeInternalCommand(`${request.variableName} = ${this.formatValueForPython(data)}`);
        } else {
            this.writeError(`❌ Import failed: No data found for '${importPath}'`);
        }

        this.showPrompt();
    }

    /**
     * Handle real-time data updates
     */
    handleDataUpdate(message) {
        const { key, value, dataType, source } = message;

        // Update local cache
        this.sharedData.set(key, value);

        // Show update notification if data is actively being used
        if (this.isDataActivelyUsed(key)) {
            this.writeInfo(`🔄 ${key} updated: ${this.formatValue(value)} (from ${source})`);
        }
    }

    /**
     * Handle initial data sync
     */
    handleInitialDataSync(message) {
        const { data } = message;

        data.forEach(entry => {
            this.sharedData.set(entry.key, entry.value);
        });

        console.log('MuRepl: Synced', data.length, 'data entries');
    }

    /**
     * Handle sensor data updates
     */
    handleSensorDataUpdate(message) {
        const { sensorName, value, metadata } = message;
        const key = `sensor.${sensorName}`;

        this.sharedData.set(key, value);

        // Show live updates for active sensors
        if (this.isDataActivelyUsed(key)) {
            const units = metadata?.units || '';
            this.writeInfo(`📊 ${sensorName}: ${value}${units}`);
        }
    }

    /**
     * Handle hardware state updates
     */
    handleHardwareStateUpdate(message) {
        const { deviceType, state } = message;
        const key = `hardware.${deviceType}`;

        this.sharedData.set(key, state);
    }

    /**
     * Handle pin state updates
     */
    handlePinStateUpdate(message) {
        const { pinName, state } = message;
        const key = `pin.${pinName}`;

        this.sharedData.set(key, state);
    }

    /**
     * Show available data sources
     */
    showAvailableData() {
        this.writeInfo('📋 Available data sources in mu_repl:');

        if (this.sharedData.size === 0) {
            this.writeInfo('   No data available. Run code in main REPL to generate data.');
            return;
        }

        // Group data by type
        const grouped = {};
        for (const [key, value] of this.sharedData.entries()) {
            const type = key.includes('.') ? key.split('.')[0] : 'variables';
            if (!grouped[type]) grouped[type] = [];
            grouped[type].push({ key, value });
        }

        // Display grouped data
        for (const [type, entries] of Object.entries(grouped)) {
            this.writeInfo(`\n   ${type.toUpperCase()}:`);
            entries.forEach(({ key, value }) => {
                this.writeInfo(`     ${key} = ${this.formatValue(value)}`);
            });
        }

        this.writeInfo('\n💡 Usage: import <name> from mu_repl');
    }

    /**
     * Show data bus status
     */
    showDataBusStatus() {
        // Request status from extension
        this.vscode.postMessage({
            type: 'dataStatusRequest',
            timestamp: Date.now()
        });

        this.writeInfo(`📊 Data Bus Status:
   Cached entries: ${this.sharedData.size}
   Active requests: ${this.pendingRequests.size}
   Last update: ${new Date().toLocaleTimeString()}

💡 Use mu_repl.list() to see available data`);
    }

    /**
     * Clear shared data cache
     */
    clearSharedData() {
        this.sharedData.clear();
        this.writeInfo('🧹 Cleared local data cache');
    }

    /**
     * Utility methods
     */
    getCurrentInput() {
        // Try to get current input from terminal state
        // This would need to be implemented based on your terminal implementation
        return window.terminal?.state?.currentInput || '';
    }

    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    formatValue(value) {
        if (typeof value === 'string') return `"${value}"`;
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    }

    formatValueForPython(value) {
        if (typeof value === 'string') return `"${value}"`;
        if (typeof value === 'object') return JSON.stringify(value);
        if (typeof value === 'boolean') return value ? 'True' : 'False';
        return String(value);
    }

    isDataActivelyUsed(key) {
        // Simple heuristic: check if data was recently requested
        const recentThreshold = 30000; // 30 seconds
        const now = Date.now();

        for (const request of this.pendingRequests.values()) {
            if (request.importPath === key && (now - request.timestamp) < recentThreshold) {
                return true;
            }
        }

        return false;
    }

    executeInternalCommand(command) {
        // Execute command in terminal context
        if (this.terminal && this.terminal.write) {
            this.terminal.write(command + '\r');
        }
    }

    writeInfo(message) {
        if (this.terminal && this.terminal.write) {
            this.terminal.write(`\r\n\x1b[36m${message}\x1b[0m\r\n`);
        }
    }

    writeSuccess(message) {
        if (this.terminal && this.terminal.write) {
            this.terminal.write(`\r\n\x1b[32m${message}\x1b[0m\r\n`);
        }
    }

    writeError(message) {
        if (this.terminal && this.terminal.write) {
            this.terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
        }
    }

    showPrompt() {
        if (this.terminal && this.terminal.write) {
            // Always use >>> prompt as requested by user
            const prompt = '>>> ';
            this.terminal.write(`\r\n\x1b[38;2;210;117;55m${prompt}\x1b[0m`);
        }
    }
}

// Export for integration with existing webview-repl
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MuReplDataSharing;
}

// Auto-initialize if in browser context
if (typeof window !== 'undefined') {
    window.MuReplDataSharing = MuReplDataSharing;
}