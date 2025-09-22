/**
 * Runtime Selection Policy
 *
 * Phase 2 - Separation of Concerns: Configurable runtime selection strategies
 *
 * Responsibilities:
 * - Define runtime selection strategies
 * - Score runtimes based on various criteria
 * - Handle fallback and preference logic
 * - Provide configurable selection policies
 *
 * This component separates the runtime selection logic from the coordinator,
 * making it configurable and testable independently.
 */

import * as vscode from 'vscode';
import { IPythonRuntime, PythonRuntimeType, RuntimeCapabilities } from '../runtime/IPythonRuntime';
import { IDevice } from '../devices/core/deviceDetector';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Runtime selection strategy types
 */
export type SelectionStrategy =
    | 'auto'           // Automatic based on device compatibility
    | 'performance'    // Prioritize speed and responsiveness
    | 'compatibility'  // Prioritize maximum device compatibility
    | 'memory'         // Prioritize low memory usage
    | 'user_preferred' // Use user's explicit preferences
    | 'flagship'       // Always prefer CircuitPython when available
    | 'custom';        // Use custom scoring function

/**
 * Runtime selection preferences
 */
export interface RuntimeSelectionPreferences {
    primaryStrategy: SelectionStrategy;
    fallbackStrategy: SelectionStrategy;
    preferredRuntimeType?: PythonRuntimeType;
    requiredCapabilities?: Partial<RuntimeCapabilities>;
    deviceCompatibilityWeight?: number;    // 0.0 - 1.0
    performanceWeight?: number;            // 0.0 - 1.0
    memoryWeight?: number;                 // 0.0 - 1.0
    flagshipBonus?: number;                // Additional points for CircuitPython
    customScorer?: (runtime: IPythonRuntime, device: IDevice) => number;
}

/**
 * Runtime scoring result
 */
export interface RuntimeScore {
    runtime: IPythonRuntime;
    totalScore: number;
    breakdown: {
        baseCompatibility: number;
        deviceCompatibility: number;
        performanceScore: number;
        memoryScore: number;
        flagshipBonus: number;
        customScore: number;
    };
    reasoning: string[];
}

/**
 * Selection context for runtime choice
 */
export interface SelectionContext {
    device?: IDevice;
    workspace?: vscode.WorkspaceFolder;
    userPreferences?: RuntimeSelectionPreferences;
    previousSelection?: PythonRuntimeType;
    availableRuntimes: Map<PythonRuntimeType, IPythonRuntime>;
}

/**
 * Runtime Selection Policy Implementation
 *
 * Handles all logic for selecting the best runtime for a given context
 */
export class RuntimeSelectionPolicy {
    private defaultPreferences: RuntimeSelectionPreferences;

    constructor() {
        this.defaultPreferences = this.loadDefaultPreferences();
        logger.debug('EXECUTION', 'RuntimeSelectionPolicy created with configurable strategies');
    }

    /**
     * Select the best runtime for the given context
     */
    async selectBestRuntime(context: SelectionContext): Promise<RuntimeScore> {
        logger.debug('EXECUTION', `Selecting best runtime for context with ${context.availableRuntimes.size} available runtimes`);

        const preferences = {
            ...this.defaultPreferences,
            ...context.userPreferences
        };

        // Try primary strategy first
        let result = await this.executeSelectionStrategy(preferences.primaryStrategy, context, preferences);

        // If no suitable runtime found with primary strategy, try fallback
        if (result.totalScore === 0 && preferences.fallbackStrategy !== preferences.primaryStrategy) {
            logger.debug('EXECUTION', `Primary strategy yielded no results, trying fallback strategy: ${preferences.fallbackStrategy}`);
            result = await this.executeSelectionStrategy(preferences.fallbackStrategy, context, preferences);
        }

        // Final fallback to flagship runtime if available
        if (result.totalScore === 0) {
            const flagshipRuntime = context.availableRuntimes.get('circuitpython');
            if (flagshipRuntime) {
                logger.warn('EXECUTION', 'No runtime scored above 0, falling back to flagship CircuitPython runtime');
                result = {
                    runtime: flagshipRuntime,
                    totalScore: 1, // Minimal score for fallback
                    breakdown: {
                        baseCompatibility: 0,
                        deviceCompatibility: 0,
                        performanceScore: 0,
                        memoryScore: 0,
                        flagshipBonus: 1,
                        customScore: 0
                    },
                    reasoning: ['Fallback to flagship CircuitPython runtime']
                };
            }
        }

        if (result.totalScore === 0) {
            throw new Error('No suitable runtime found for the given context');
        }

        logger.info('EXECUTION', `Selected runtime: ${result.runtime.type} (score: ${result.totalScore.toFixed(2)})`);
        return result;
    }

    /**
     * Score all available runtimes for the given context
     */
    async scoreAllRuntimes(context: SelectionContext): Promise<RuntimeScore[]> {
        logger.debug('EXECUTION', 'Scoring all available runtimes...');

        const preferences = {
            ...this.defaultPreferences,
            ...context.userPreferences
        };

        const scores: RuntimeScore[] = [];

        for (const runtime of context.availableRuntimes.values()) {
            const score = await this.scoreRuntime(runtime, context, preferences);
            scores.push(score);
        }

        // Sort by total score (highest first)
        scores.sort((a, b) => b.totalScore - a.totalScore);

        logger.debug('EXECUTION', `Scored ${scores.length} runtimes, best: ${scores[0]?.runtime.type} (${scores[0]?.totalScore.toFixed(2)})`);
        return scores;
    }

    /**
     * Update user preferences and save to VS Code configuration
     */
    async updatePreferences(preferences: Partial<RuntimeSelectionPreferences>): Promise<void> {
        logger.info('EXECUTION', 'Updating runtime selection preferences...');

        const config = vscode.workspace.getConfiguration('muTwo.runtime.selection');

        // Update each preference if provided
        if (preferences.primaryStrategy !== undefined) {
            await config.update('primaryStrategy', preferences.primaryStrategy, vscode.ConfigurationTarget.Global);
        }
        if (preferences.fallbackStrategy !== undefined) {
            await config.update('fallbackStrategy', preferences.fallbackStrategy, vscode.ConfigurationTarget.Global);
        }
        if (preferences.preferredRuntimeType !== undefined) {
            await config.update('preferredRuntimeType', preferences.preferredRuntimeType, vscode.ConfigurationTarget.Global);
        }
        if (preferences.deviceCompatibilityWeight !== undefined) {
            await config.update('deviceCompatibilityWeight', preferences.deviceCompatibilityWeight, vscode.ConfigurationTarget.Global);
        }
        if (preferences.performanceWeight !== undefined) {
            await config.update('performanceWeight', preferences.performanceWeight, vscode.ConfigurationTarget.Global);
        }
        if (preferences.memoryWeight !== undefined) {
            await config.update('memoryWeight', preferences.memoryWeight, vscode.ConfigurationTarget.Global);
        }
        if (preferences.flagshipBonus !== undefined) {
            await config.update('flagshipBonus', preferences.flagshipBonus, vscode.ConfigurationTarget.Global);
        }

        // Reload preferences
        this.defaultPreferences = this.loadDefaultPreferences();

        logger.info('EXECUTION', '✓ Runtime selection preferences updated');
    }

    /**
     * Get current preferences
     */
    getPreferences(): RuntimeSelectionPreferences {
        return { ...this.defaultPreferences };
    }

    // ========================= Private Implementation =========================

    private async executeSelectionStrategy(
        strategy: SelectionStrategy,
        context: SelectionContext,
        preferences: RuntimeSelectionPreferences
    ): Promise<RuntimeScore> {
        logger.debug('EXECUTION', `Executing selection strategy: ${strategy}`);

        const scores = await this.scoreAllRuntimes(context);

        switch (strategy) {
            case 'auto':
                return this.selectAutoStrategy(scores, context);

            case 'performance':
                return this.selectPerformanceStrategy(scores, context);

            case 'compatibility':
                return this.selectCompatibilityStrategy(scores, context);

            case 'memory':
                return this.selectMemoryStrategy(scores, context);

            case 'user_preferred':
                return this.selectUserPreferredStrategy(scores, context, preferences);

            case 'flagship':
                return this.selectFlagshipStrategy(scores, context);

            case 'custom':
                return this.selectCustomStrategy(scores, context, preferences);

            default:
                logger.warn('EXECUTION', `Unknown selection strategy: ${strategy}, falling back to auto`);
                return this.selectAutoStrategy(scores, context);
        }
    }

    private async scoreRuntime(
        runtime: IPythonRuntime,
        context: SelectionContext,
        preferences: RuntimeSelectionPreferences
    ): Promise<RuntimeScore> {
        const breakdown = {
            baseCompatibility: 0,
            deviceCompatibility: 0,
            performanceScore: 0,
            memoryScore: 0,
            flagshipBonus: 0,
            customScore: 0
        };

        const reasoning: string[] = [];

        // Base compatibility score
        breakdown.baseCompatibility = this.calculateBaseCompatibility(runtime, context);
        if (breakdown.baseCompatibility > 0) {
            reasoning.push(`Base compatibility: ${breakdown.baseCompatibility}`);
        }

        // Device compatibility score
        if (context.device) {
            breakdown.deviceCompatibility = this.calculateDeviceCompatibility(runtime, context.device);
            if (breakdown.deviceCompatibility > 0) {
                reasoning.push(`Device compatibility: ${breakdown.deviceCompatibility}`);
            }
        }

        // Performance score
        breakdown.performanceScore = this.calculatePerformanceScore(runtime);
        if (breakdown.performanceScore > 0) {
            reasoning.push(`Performance: ${breakdown.performanceScore}`);
        }

        // Memory efficiency score
        breakdown.memoryScore = this.calculateMemoryScore(runtime);
        if (breakdown.memoryScore > 0) {
            reasoning.push(`Memory efficiency: ${breakdown.memoryScore}`);
        }

        // Flagship bonus (CircuitPython)
        if (runtime.type === 'circuitpython') {
            breakdown.flagshipBonus = preferences.flagshipBonus || 5;
            reasoning.push(`Flagship bonus: ${breakdown.flagshipBonus}`);
        }

        // Custom scoring
        if (preferences.customScorer && context.device) {
            breakdown.customScore = preferences.customScorer(runtime, context.device);
            if (breakdown.customScore > 0) {
                reasoning.push(`Custom score: ${breakdown.customScore}`);
            }
        }

        // Calculate weighted total score
        const totalScore =
            breakdown.baseCompatibility +
            (breakdown.deviceCompatibility * (preferences.deviceCompatibilityWeight || 1.0)) +
            (breakdown.performanceScore * (preferences.performanceWeight || 0.8)) +
            (breakdown.memoryScore * (preferences.memoryWeight || 0.6)) +
            breakdown.flagshipBonus +
            breakdown.customScore;

        return {
            runtime,
            totalScore,
            breakdown,
            reasoning
        };
    }

    private calculateBaseCompatibility(runtime: IPythonRuntime, context: SelectionContext): number {
        let score = 5; // Base score for any working runtime

        // Check required capabilities
        const userPrefs = context.userPreferences;
        if (userPrefs?.requiredCapabilities) {
            for (const [capability, required] of Object.entries(userPrefs.requiredCapabilities)) {
                if (required && !runtime.capabilities[capability as keyof RuntimeCapabilities]) {
                    return 0; // Failed requirement = no compatibility
                }
            }
            score += 2; // Bonus for meeting all requirements
        }

        return score;
    }

    private calculateDeviceCompatibility(runtime: IPythonRuntime, device: IDevice): number {
        const deviceName = device.name.toLowerCase();

        // Define compatibility mappings
        const compatibilityMap: Record<PythonRuntimeType, string[]> = {
            'circuitpython': ['adafruit', 'circuitpython', 'feather', 'metro', 'trinket', 'gemma', 'circuit', 'playground'],
            'micropython': ['esp32', 'esp8266', 'pico', 'pyboard', 'wipy', 'micro', 'raspberry'],
            'python': ['pc', 'computer', 'desktop', 'laptop', 'server']
        };

        const compatibleKeywords = compatibilityMap[runtime.type] || [];

        // Check for direct compatibility matches
        let score = 0;
        for (const keyword of compatibleKeywords) {
            if (deviceName.includes(keyword)) {
                score += 10;
            }
        }

        // Additional scoring based on runtime capabilities
        if (device.name.includes('ESP') && runtime.capabilities.hasWiFi) {
            score += 5;
        }
        if (device.name.includes('Bluetooth') && runtime.capabilities.hasBluetooth) {
            score += 5;
        }

        return Math.min(score, 20); // Cap at 20 points
    }

    private calculatePerformanceScore(runtime: IPythonRuntime): number {
        let score = 0;

        // WASM execution is generally faster for simulation
        if (runtime.capabilities.supportsWASMExecution) {
            score += 8;
        }

        // CircuitPython optimizations
        if (runtime.type === 'circuitpython') {
            score += 6;
        }

        // MicroPython is generally fast but less optimized
        if (runtime.type === 'micropython') {
            score += 4;
        }

        // Standard Python can be slow on microcontrollers
        if (runtime.type === 'python') {
            score += 2;
        }

        return score;
    }

    private calculateMemoryScore(runtime: IPythonRuntime): number {
        let score = 0;

        // MicroPython is designed for low memory usage
        if (runtime.type === 'micropython') {
            score += 10;
        }

        // CircuitPython is reasonably memory efficient
        if (runtime.type === 'circuitpython') {
            score += 7;
        }

        // Standard Python uses more memory
        if (runtime.type === 'python') {
            score += 3;
        }

        return score;
    }

    // Strategy implementations
    private selectAutoStrategy(scores: RuntimeScore[], context: SelectionContext): RuntimeScore {
        // Auto strategy: balanced approach, pick highest overall score
        return scores[0] || this.createZeroScore();
    }

    private selectPerformanceStrategy(scores: RuntimeScore[], context: SelectionContext): RuntimeScore {
        // Performance strategy: prioritize performance score
        const sortedByPerformance = scores.sort((a, b) =>
            b.breakdown.performanceScore - a.breakdown.performanceScore
        );
        return sortedByPerformance[0] || this.createZeroScore();
    }

    private selectCompatibilityStrategy(scores: RuntimeScore[], context: SelectionContext): RuntimeScore {
        // Compatibility strategy: prioritize device compatibility
        const sortedByCompatibility = scores.sort((a, b) =>
            b.breakdown.deviceCompatibility - a.breakdown.deviceCompatibility
        );
        return sortedByCompatibility[0] || this.createZeroScore();
    }

    private selectMemoryStrategy(scores: RuntimeScore[], context: SelectionContext): RuntimeScore {
        // Memory strategy: prioritize memory efficiency
        const sortedByMemory = scores.sort((a, b) =>
            b.breakdown.memoryScore - a.breakdown.memoryScore
        );
        return sortedByMemory[0] || this.createZeroScore();
    }

    private selectUserPreferredStrategy(
        scores: RuntimeScore[],
        context: SelectionContext,
        preferences: RuntimeSelectionPreferences
    ): RuntimeScore {
        // User preferred strategy: use explicit preference if available
        if (preferences.preferredRuntimeType) {
            const preferred = scores.find(s => s.runtime.type === preferences.preferredRuntimeType);
            if (preferred) {
                return preferred;
            }
        }
        // Fall back to auto strategy
        return this.selectAutoStrategy(scores, context);
    }

    private selectFlagshipStrategy(scores: RuntimeScore[], context: SelectionContext): RuntimeScore {
        // Flagship strategy: always prefer CircuitPython
        const circuitPython = scores.find(s => s.runtime.type === 'circuitpython');
        return circuitPython || scores[0] || this.createZeroScore();
    }

    private selectCustomStrategy(
        scores: RuntimeScore[],
        context: SelectionContext,
        preferences: RuntimeSelectionPreferences
    ): RuntimeScore {
        // Custom strategy: use custom scorer if provided
        if (preferences.customScorer) {
            const sortedByCustom = scores.sort((a, b) =>
                b.breakdown.customScore - a.breakdown.customScore
            );
            return sortedByCustom[0] || this.createZeroScore();
        }
        // Fall back to auto strategy
        return this.selectAutoStrategy(scores, context);
    }

    private createZeroScore(): RuntimeScore {
        // Create a zero score result for when no runtime is suitable
        return {
            runtime: null as any,
            totalScore: 0,
            breakdown: {
                baseCompatibility: 0,
                deviceCompatibility: 0,
                performanceScore: 0,
                memoryScore: 0,
                flagshipBonus: 0,
                customScore: 0
            },
            reasoning: ['No suitable runtime found']
        };
    }

    private loadDefaultPreferences(): RuntimeSelectionPreferences {
        const config = vscode.workspace.getConfiguration('muTwo.runtime.selection');

        return {
            primaryStrategy: config.get('primaryStrategy', 'auto'),
            fallbackStrategy: config.get('fallbackStrategy', 'flagship'),
            preferredRuntimeType: config.get('preferredRuntimeType', undefined),
            deviceCompatibilityWeight: config.get('deviceCompatibilityWeight', 1.0),
            performanceWeight: config.get('performanceWeight', 0.8),
            memoryWeight: config.get('memoryWeight', 0.6),
            flagshipBonus: config.get('flagshipBonus', 5)
        };
    }
}