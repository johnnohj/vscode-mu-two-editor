// src/utils/developmentModeDetector.ts
// Detects whether the extension is running in development mode vs production

import * as vscode from 'vscode';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

export interface DevelopmentModeInfo {
    isDevelopment: boolean;
    mode: 'production' | 'development' | 'test';
    indicators: string[];
    extensionPath: string;
}

/**
 * Detect development mode using multiple indicators
 */
export function detectDevelopmentMode(context: vscode.ExtensionContext): DevelopmentModeInfo {
    const indicators: string[] = [];
    const extensionPath = context.extensionUri.fsPath;
    let isDevelopment = false;

    // 1. Check for explicit environment variable
    if (process.env.VSCODE_MUSTWO_DEV === 'true') {
        indicators.push('VSCODE_MUSTWO_DEV environment variable');
        isDevelopment = true;
    }

    // 2. Check if running in Extension Development Host
    if (process.env.VSCODE_PID && process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET) {
        indicators.push('VS Code Extension Development Host');
        isDevelopment = true;
    }

    // 3. Check for development file structure
    try {
        // Development mode: has src/ directory and package.json with "scripts"
        const srcExists = checkPathExists(vscode.Uri.joinPath(context.extensionUri, 'src'));
        const packageJsonExists = checkPathExists(vscode.Uri.joinPath(context.extensionUri, 'package.json'));

        if (srcExists && packageJsonExists) {
            indicators.push('src/ directory and package.json present');
            isDevelopment = true;
        }
    } catch {
        // File system checks failed, continue with other methods
    }

    // 4. Check if node_modules exists (development)
    try {
        const nodeModulesExists = checkPathExists(vscode.Uri.joinPath(context.extensionUri, 'node_modules'));
        if (nodeModulesExists) {
            indicators.push('node_modules directory present');
            isDevelopment = true;
        }
    } catch {
        // Continue
    }

    // 5. Check extension ID pattern (development extensions often have specific patterns)
    const extensionId = context.extension.id;
    if (extensionId.includes('dev') || extensionId.includes('test') || extensionId.includes('local')) {
        indicators.push(`extension ID pattern: ${extensionId}`);
        isDevelopment = true;
    }

    // 6. Check if running from a typical development path
    const devPathIndicators = [
        'dev', 'development', 'workspace', 'projects', 'code', 'github', 'git'
    ];
    const lowercasePath = extensionPath.toLowerCase();
    for (const indicator of devPathIndicators) {
        if (lowercasePath.includes(indicator)) {
            indicators.push(`development path indicator: ${indicator}`);
            isDevelopment = true;
            break;
        }
    }

    // 7. Check for test mode
    const isTest = process.env.NODE_ENV === 'test' ||
                   process.env.VSCODE_MUSTWO_TEST === 'true' ||
                   extensionId.includes('test');

    let mode: 'production' | 'development' | 'test';
    if (isTest) {
        mode = 'test';
        indicators.push('test mode detected');
    } else if (isDevelopment) {
        mode = 'development';
    } else {
        mode = 'production';
    }

    const result: DevelopmentModeInfo = {
        isDevelopment: isDevelopment || isTest,
        mode,
        indicators,
        extensionPath
    };

    logger.info('DEV_MODE', `Development mode: ${mode}`, {
        isDevelopment: result.isDevelopment,
        indicators: indicators.length > 0 ? indicators : ['none - production mode'],
        path: extensionPath
    });

    return result;
}

/**
 * Check if a path exists without throwing
 */
function checkPathExists(uri: vscode.Uri): boolean {
    try {
        // This is synchronous within the extension host
        return vscode.workspace.fs.stat(uri) !== undefined;
    } catch {
        return false;
    }
}

/**
 * Get development mode configuration overrides
 */
export function getDevelopmentConfig(devMode: DevelopmentModeInfo): {
    enableVerboseLogging: boolean;
    skipOptimizations: boolean;
    enableDebugFeatures: boolean;
    allowUnsafeOperations: boolean;
} {
    return {
        enableVerboseLogging: devMode.isDevelopment,
        skipOptimizations: devMode.isDevelopment, // Skip caching in dev mode
        enableDebugFeatures: devMode.isDevelopment,
        allowUnsafeOperations: devMode.mode === 'test', // Only in test mode
    };
}

/**
 * Log development mode information for debugging
 */
export function logDevelopmentModeInfo(devMode: DevelopmentModeInfo): void {
    if (devMode.isDevelopment) {
        logger.info('DEV_MODE', 'Running in development mode with optimizations disabled');
        logger.info('DEV_MODE', 'Development indicators:', devMode.indicators);
    } else {
        logger.info('DEV_MODE', 'Running in production mode with optimizations enabled');
    }
}

/**
 * Check if we should enable fast activation (skip expensive checks)
 */
export function shouldEnableFastActivation(devMode: DevelopmentModeInfo): boolean {
    // In development mode, always do full activation for debugging
    // In test mode, allow fast activation for performance
    // In production mode, use fast activation for better UX
    return devMode.mode === 'production' || devMode.mode === 'test';
}