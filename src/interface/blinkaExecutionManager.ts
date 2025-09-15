import * as vscode from 'vscode';
import { EventEmitter } from 'events';
import { UnifiedDebugManager } from '../../sys/unifiedDebugManager';
import { PythonEnvManager } from '../../sys/pythonEnvManager';

/**
 * Execution environment types
 */
export enum ExecutionEnvironment {
    HARDWARE = 'hardware',
    SIMULATED = 'simulated',
    DUAL = 'dual'
}

/**
 * Execution result from hardware or simulated environment
 */
export interface ExecutionResult {
    environment: ExecutionEnvironment;
    deviceId?: string;
    success: boolean;
    output: string;
    error?: string;
    executionTime: number;
    memoryUsage?: {
        before: number;
        after: number;
        peak: number;
    };
    timestamp: number;
}

/**
 * Dual execution comparison result
 */
export interface DualExecutionComparison {
    hardwareResult: ExecutionResult;
    simulatedResult: ExecutionResult;
    comparison: {
        outputMatch: boolean;
        outputSimilarity: number; // 0-1 similarity score
        timingDifference: number; // ms difference
        memoryDifference?: number;
        discrepancies: string[];
        recommendations: string[];
    };
    timestamp: number;
}

/**
 * Blinka board configuration for simulation
 */
export interface BlinkaBoard {
    name: string;
    boardId: string;
    pins: {
        digital: number[];
        analog: number[];
        i2c: { sda: number; scl: number }[];
        spi: { mosi: number; miso: number; sck: number }[];
    };
    features: string[];
    pythonPath?: string;
}

/**
 * Code execution request
 */
export interface CodeExecutionRequest {
    code: string;
    fileName?: string;
    environment: ExecutionEnvironment;
    deviceId?: string;
    boardConfig?: BlinkaBoard;
    timeout?: number;
    enableProfiling?: boolean;
}

/**
 * Blinka Execution Manager - Dual Execution Environment
 * 
 * This manager provides:
 * - Adafruit Blinka integration for simulated CircuitPython execution
 * - Dual execution (hardware + simulation) with comparison analysis
 * - Real-time feedback and performance metrics
 * - Educational insights through execution comparison
 */
export class BlinkaExecutionManager extends EventEmitter {
    private context: vscode.ExtensionContext;
    private unifiedDebugManager: UnifiedDebugManager;
    private pythonEnvManager: PythonEnvManager;

    // Execution state
    private isInitialized = false;
    private blinkaEnvironment?: string;
    private availableBoards = new Map<string, BlinkaBoard>();
    private activeExecutions = new Map<string, CodeExecutionRequest>();

    // Configuration
    private defaultTimeout = 30000; // 30 seconds
    private enableComparison = true;
    private enableProfiling = true;

    constructor(
        context: vscode.ExtensionContext,
        unifiedDebugManager: UnifiedDebugManager,
        pythonEnvManager: PythonEnvManager
    ) {
        super();
        this.context = context;
        this.unifiedDebugManager = unifiedDebugManager;
        this.pythonEnvManager = pythonEnvManager;

        this.initializeBoards();
    }

    /**
     * Initialize the Blinka execution manager
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return;
        }

        try {
            console.log('Initializing Blinka Execution Manager...');

            // Check Python environment
            await this.validatePythonEnvironment();

            // Install/verify Blinka installation
            await this.ensureBlinkaInstalled();

            // Set up execution environment
            await this.setupExecutionEnvironment();

            this.isInitialized = true;
            console.log('Blinka Execution Manager initialized successfully');
            
            this.emit('initialized');
        } catch (error) {
            console.error('Failed to initialize Blinka Execution Manager:', error);
            throw error;
        }
    }

    /**
     * Execute code in specified environment(s)
     */
    async executeCode(request: CodeExecutionRequest): Promise<ExecutionResult | DualExecutionComparison> {
        if (!this.isInitialized) {
            throw new Error('Blinka Execution Manager not initialized');
        }

        const executionId = this.generateExecutionId();
        this.activeExecutions.set(executionId, request);

        try {
            switch (request.environment) {
                case ExecutionEnvironment.HARDWARE:
                    return await this.executeOnHardware(request, executionId);
                
                case ExecutionEnvironment.SIMULATED:
                    return await this.executeOnSimulator(request, executionId);
                
                case ExecutionEnvironment.DUAL:
                    return await this.executeDual(request, executionId);
                
                default:
                    throw new Error(`Unsupported execution environment: ${request.environment}`);
            }
        } finally {
            this.activeExecutions.delete(executionId);
        }
    }

    /**
     * Execute code on hardware device
     */
    private async executeOnHardware(request: CodeExecutionRequest, executionId: string): Promise<ExecutionResult> {
        const startTime = Date.now();
        
        try {
            if (!request.deviceId) {
                // Auto-select first available device
                const connections = this.unifiedDebugManager.getConnectionStates();
                if (connections.size === 0) {
                    throw new Error('No hardware devices connected');
                }
                request.deviceId = Array.from(connections.keys())[0];
            }

            // Send code to device through unified debug manager
            const deviceOutput = await this.executeCodeOnDevice(request.deviceId, request.code, request.timeout);
            
            const executionTime = Date.now() - startTime;
            
            return {
                environment: ExecutionEnvironment.HARDWARE,
                deviceId: request.deviceId,
                success: true,
                output: deviceOutput,
                executionTime,
                timestamp: Date.now()
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            return {
                environment: ExecutionEnvironment.HARDWARE,
                deviceId: request.deviceId,
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                executionTime,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Execute code on Blinka simulator
     */
    private async executeOnSimulator(request: CodeExecutionRequest, executionId: string): Promise<ExecutionResult> {
        const startTime = Date.now();
        
        try {
            // Prepare simulation environment
            const simulatedCode = await this.prepareSimulatedCode(request.code, request.boardConfig);
            
            // Execute in Blinka environment
            const simulationOutput = await this.executeInBlinka(simulatedCode, request.timeout);
            
            const executionTime = Date.now() - startTime;
            
            return {
                environment: ExecutionEnvironment.SIMULATED,
                success: true,
                output: simulationOutput.output,
                executionTime,
                memoryUsage: simulationOutput.memoryUsage,
                timestamp: Date.now()
            };

        } catch (error) {
            const executionTime = Date.now() - startTime;
            return {
                environment: ExecutionEnvironment.SIMULATED,
                success: false,
                output: '',
                error: error instanceof Error ? error.message : String(error),
                executionTime,
                timestamp: Date.now()
            };
        }
    }

    /**
     * Execute code in both environments and compare results
     */
    private async executeDual(request: CodeExecutionRequest, executionId: string): Promise<DualExecutionComparison> {
        console.log(`Starting dual execution for ${executionId}`);
        
        // Execute on both environments in parallel
        const [hardwareResult, simulatedResult] = await Promise.all([
            this.executeOnHardware({ ...request, environment: ExecutionEnvironment.HARDWARE }, executionId),
            this.executeOnSimulator({ ...request, environment: ExecutionEnvironment.SIMULATED }, executionId)
        ]);

        // Compare results
        const comparison = this.compareExecutionResults(hardwareResult, simulatedResult);

        const dualComparison: DualExecutionComparison = {
            hardwareResult,
            simulatedResult,
            comparison,
            timestamp: Date.now()
        };

        // Emit comparison result for real-time feedback
        this.emit('dualExecutionComplete', dualComparison);

        return dualComparison;
    }

    /**
     * Execute code on physical device through unified debug manager
     */
    private async executeCodeOnDevice(deviceId: string, code: string, timeout = this.defaultTimeout): Promise<string> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Hardware execution timeout after ${timeout}ms`));
            }, timeout);

            let output = '';
            
            const outputHandler = (receivedDeviceId: string, data: string) => {
                if (receivedDeviceId === deviceId) {
                    output += data;
                }
            };

            // Listen for device output
            this.unifiedDebugManager.on('dataReceived', outputHandler);

            // Send code to device
            this.unifiedDebugManager.sendToDevice(deviceId, code + '\r\n')
                .then(() => {
                    // Wait for execution to complete
                    setTimeout(() => {
                        clearTimeout(timeoutId);
                        this.unifiedDebugManager.off('dataReceived', outputHandler);
                        resolve(output);
                    }, 2000); // Wait 2 seconds for output
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    this.unifiedDebugManager.off('dataReceived', outputHandler);
                    reject(error);
                });
        });
    }

    /**
     * Prepare code for Blinka simulation
     */
    private async prepareSimulatedCode(code: string, boardConfig?: BlinkaBoard): Promise<string> {
        const board = boardConfig || this.getDefaultBoard();
        
        // Wrap code with Blinka imports and board setup
        const blinkaWrapper = `
# Blinka Simulation Environment
import os
os.environ["BLINKA_FORCEBOARD"] = "${board.boardId}"
os.environ["BLINKA_FORCEPLATFORM"] = "linux"

import board
import digitalio
import analogio
import busio
import time

# Original user code:
try:
${code.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
`;

        return blinkaWrapper;
    }

    /**
     * Execute code in Blinka Python environment
     */
    private async executeInBlinka(code: string, timeout = this.defaultTimeout): Promise<{
        output: string;
        memoryUsage?: { before: number; after: number; peak: number };
    }> {
        // Create temporary file for execution
        const tempFile = vscode.Uri.joinPath(this.context.globalStorageUri, `blinka_exec_${Date.now()}.py`);
        
        try {
            // Write code to temp file
            await vscode.workspace.fs.writeFile(tempFile, Buffer.from(code, 'utf8'));
            
            // Execute with memory profiling
            const profilingCode = `
import tracemalloc
import subprocess
import sys

tracemalloc.start()
before = tracemalloc.get_traced_memory()[0]

try:
    result = subprocess.run([sys.executable, "${tempFile.fsPath}"], 
                          capture_output=True, 
                          text=True, 
                          timeout=${timeout / 1000})
    output = result.stdout
    if result.stderr:
        output += "\\nSTDERR: " + result.stderr
except subprocess.TimeoutExpired:
    output = f"Execution timeout after {timeout / 1000} seconds"
except Exception as e:
    output = f"Execution error: {e}"

current, peak = tracemalloc.get_traced_memory()
tracemalloc.stop()

print(f"OUTPUT_START\\n{output}\\nOUTPUT_END")
print(f"MEMORY_BEFORE:{before}")
print(f"MEMORY_AFTER:{current}")
print(f"MEMORY_PEAK:{peak}")
`;

            // Execute profiling script
            const profilingFile = vscode.Uri.joinPath(this.context.globalStorageUri, `blinka_profile_${Date.now()}.py`);
            await vscode.workspace.fs.writeFile(profilingFile, Buffer.from(profilingCode, 'utf8'));

            // Run the profiling script
            const profilingResult = await this.pythonEnvManager.runPythonScript(profilingFile.fsPath);
            
            // Parse results
            const outputMatch = profilingResult.match(/OUTPUT_START\n(.*?)\nOUTPUT_END/s);
            const memoryBefore = profilingResult.match(/MEMORY_BEFORE:(\d+)/);
            const memoryAfter = profilingResult.match(/MEMORY_AFTER:(\d+)/);
            const memoryPeak = profilingResult.match(/MEMORY_PEAK:(\d+)/);

            const output = outputMatch ? outputMatch[1] : profilingResult;
            const memoryUsage = (memoryBefore && memoryAfter && memoryPeak) ? {
                before: parseInt(memoryBefore[1]),
                after: parseInt(memoryAfter[1]),
                peak: parseInt(memoryPeak[1])
            } : undefined;

            return { output, memoryUsage };

        } finally {
            // Clean up temp files
            try {
                await vscode.workspace.fs.delete(tempFile);
            } catch (error) {
                console.warn('Failed to cleanup temp file:', error);
            }
        }
    }

    /**
     * Compare execution results from hardware and simulation
     */
    private compareExecutionResults(hardwareResult: ExecutionResult, simulatedResult: ExecutionResult): DualExecutionComparison['comparison'] {
        const outputMatch = this.normalizeOutput(hardwareResult.output) === this.normalizeOutput(simulatedResult.output);
        const outputSimilarity = this.calculateOutputSimilarity(hardwareResult.output, simulatedResult.output);
        const timingDifference = Math.abs(hardwareResult.executionTime - simulatedResult.executionTime);
        
        const discrepancies: string[] = [];
        const recommendations: string[] = [];

        // Analyze discrepancies
        if (!outputMatch) {
            discrepancies.push('Output mismatch between hardware and simulation');
            if (outputSimilarity < 0.8) {
                recommendations.push('Consider checking hardware-specific behavior or sensor readings');
            }
        }

        if (timingDifference > 1000) {
            discrepancies.push(`Significant timing difference: ${timingDifference}ms`);
            if (simulatedResult.executionTime > hardwareResult.executionTime) {
                recommendations.push('Simulation is slower than hardware - consider optimizing simulation');
            } else {
                recommendations.push('Hardware is slower than simulation - check for blocking operations');
            }
        }

        if (!hardwareResult.success && simulatedResult.success) {
            discrepancies.push('Simulation succeeded but hardware failed');
            recommendations.push('Check hardware connectivity and device state');
        } else if (hardwareResult.success && !simulatedResult.success) {
            discrepancies.push('Hardware succeeded but simulation failed');
            recommendations.push('Check Blinka board configuration and simulation environment');
        }

        // Memory analysis
        let memoryDifference: number | undefined;
        if (simulatedResult.memoryUsage) {
            const simMemoryUsed = simulatedResult.memoryUsage.peak - simulatedResult.memoryUsage.before;
            // Hardware memory is estimated or could be retrieved from enhanced debugging
            memoryDifference = simMemoryUsed; // Simplified for now
        }

        // Success recommendations
        if (outputMatch && timingDifference < 500) {
            recommendations.push('Excellent correlation between hardware and simulation!');
        }

        return {
            outputMatch,
            outputSimilarity,
            timingDifference,
            memoryDifference,
            discrepancies,
            recommendations
        };
    }

    /**
     * Normalize output for comparison
     */
    private normalizeOutput(output: string): string {
        return output
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/>>> /g, '')
            .replace(/^\s+|\s+$/gm, '') // Trim each line
            .replace(/\n+/g, '\n') // Normalize multiple newlines
            .trim();
    }

    /**
     * Calculate output similarity using simple string comparison
     */
    private calculateOutputSimilarity(output1: string, output2: string): number {
        const norm1 = this.normalizeOutput(output1);
        const norm2 = this.normalizeOutput(output2);
        
        if (norm1 === norm2) {
            return 1.0;
        }

        // Simple similarity calculation based on common lines
        const lines1 = norm1.split('\n').filter(line => line.length > 0);
        const lines2 = norm2.split('\n').filter(line => line.length > 0);
        
        const commonLines = lines1.filter(line => lines2.includes(line));
        const totalLines = Math.max(lines1.length, lines2.length);
        
        return totalLines > 0 ? commonLines.length / totalLines : 0;
    }

    /**
     * Validate Python environment for Blinka
     */
    private async validatePythonEnvironment(): Promise<void> {
        try {
            const pythonPath = await this.pythonEnvManager.getCurrentPythonPath();
            if (!pythonPath) {
                throw new Error('Python environment not available');
            }
            console.log('Python environment validated for Blinka:', pythonPath);
        } catch (error) {
            throw new Error(`Python validation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Ensure Blinka is installed in the Python environment
     */
    private async ensureBlinkaInstalled(): Promise<void> {
        try {
            console.log('Checking Blinka installation...');
            
            // Check if Blinka is installed
            const checkScript = `
try:
    import board
    import digitalio
    print("Blinka is installed and working")
except ImportError as e:
    print(f"Blinka not available: {e}")
    exit(1)
`;
            
            const tempFile = vscode.Uri.joinPath(this.context.globalStorageUri, 'blinka_check.py');
            await vscode.workspace.fs.writeFile(tempFile, Buffer.from(checkScript, 'utf8'));
            
            try {
                const result = await this.pythonEnvManager.runPythonScript(tempFile.fsPath);
                if (!result.includes('Blinka is installed and working')) {
                    await this.installBlinka();
                }
            } finally {
                await vscode.workspace.fs.delete(tempFile);
            }
            
            console.log('Blinka installation verified');
        } catch (error) {
            throw new Error(`Blinka installation check failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Install Blinka using pip
     */
    private async installBlinka(): Promise<void> {
        const installChoice = await vscode.window.showInformationMessage(
            'Adafruit Blinka is required for simulation but not installed. Install now?',
            'Install Blinka',
            'Cancel'
        );

        if (installChoice !== 'Install Blinka') {
            throw new Error('Blinka installation cancelled by user');
        }

        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Installing Adafruit Blinka...',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Installing pip packages...' });
            
            try {
                // Install Blinka and common CircuitPython libraries
                await this.pythonEnvManager.installPackage('adafruit-blinka');
                progress.report({ increment: 50, message: 'Installing additional libraries...' });
                
                await this.pythonEnvManager.installPackage('adafruit-circuitpython-motor');
                await this.pythonEnvManager.installPackage('adafruit-circuitpython-neopixel');
                
                progress.report({ increment: 100, message: 'Installation complete!' });
                
                vscode.window.showInformationMessage('Blinka installed successfully!');
            } catch (error) {
                throw new Error(`Blinka installation failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }

    /**
     * Set up execution environment paths and configuration
     */
    private async setupExecutionEnvironment(): Promise<void> {
        // Ensure global storage directory exists
        try {
            await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
        } catch (error) {
            // Directory might already exist
        }

        console.log('Blinka execution environment setup complete');
    }

    /**
     * Initialize supported board configurations
     */
    private initializeBoards(): void {
        // Common CircuitPython boards for simulation
        const boards: BlinkaBoard[] = [
            {
                name: 'Generic Raspberry Pi',
                boardId: 'GENERIC_LINUX_PC',
                pins: {
                    digital: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
                    analog: [0, 1, 2, 3],
                    i2c: [{ sda: 2, scl: 3 }],
                    spi: [{ mosi: 10, miso: 9, sck: 11 }]
                },
                features: ['digitalio', 'analogio', 'busio', 'time']
            },
            {
                name: 'Adafruit CircuitPlayground Express',
                boardId: 'CIRCUITPLAYGROUND_EXPRESS',
                pins: {
                    digital: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                    analog: [0, 1, 2, 3, 4, 5, 6],
                    i2c: [{ sda: 2, scl: 3 }],
                    spi: [{ mosi: 16, miso: 14, sck: 18 }]
                },
                features: ['digitalio', 'analogio', 'busio', 'neopixel', 'accelerometer']
            },
            {
                name: 'Adafruit Feather M4 Express',
                boardId: 'FEATHER_M4_EXPRESS',
                pins: {
                    digital: [5, 6, 9, 10, 11, 12, 13],
                    analog: [0, 1, 2, 3, 4, 5],
                    i2c: [{ sda: 22, scl: 21 }],
                    spi: [{ mosi: 24, miso: 23, sck: 25 }]
                },
                features: ['digitalio', 'analogio', 'busio', 'pwmio']
            }
        ];

        for (const board of boards) {
            this.availableBoards.set(board.boardId, board);
        }

        console.log(`Initialized ${boards.length} board configurations for Blinka simulation`);
    }

    /**
     * Get default board configuration
     */
    private getDefaultBoard(): BlinkaBoard {
        return this.availableBoards.get('GENERIC_LINUX_PC') || Array.from(this.availableBoards.values())[0];
    }

    /**
     * Generate unique execution ID
     */
    private generateExecutionId(): string {
        return `blinka-exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get available board configurations
     */
    getAvailableBoards(): BlinkaBoard[] {
        return Array.from(this.availableBoards.values());
    }

    /**
     * Set board configuration for simulation
     */
    setBoardConfiguration(boardId: string): BlinkaBoard | undefined {
        return this.availableBoards.get(boardId);
    }

    /**
     * Cancel active execution
     */
    cancelExecution(executionId: string): boolean {
        if (this.activeExecutions.has(executionId)) {
            this.activeExecutions.delete(executionId);
            this.emit('executionCancelled', executionId);
            return true;
        }
        return false;
    }

    /**
     * Get execution statistics
     */
    getExecutionStats(): {
        isInitialized: boolean;
        availableBoards: number;
        activeExecutions: number;
        blinkaEnvironment?: string;
    } {
        return {
            isInitialized: this.isInitialized,
            availableBoards: this.availableBoards.size,
            activeExecutions: this.activeExecutions.size,
            blinkaEnvironment: this.blinkaEnvironment
        };
    }

    /**
     * Dispose and cleanup resources
     */
    dispose(): void {
        // Cancel all active executions
        for (const executionId of this.activeExecutions.keys()) {
            this.cancelExecution(executionId);
        }

        this.availableBoards.clear();
        this.isInitialized = false;
        
        console.log('Blinka Execution Manager disposed');
    }
}