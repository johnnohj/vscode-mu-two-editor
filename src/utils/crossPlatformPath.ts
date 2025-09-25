/**
 * Cross-Platform Path Utilities
 *
 * Provides robust path handling that attempts VS Code URI APIs first,
 * then falls back to Node.js path module for maximum compatibility.
 *
 * This is particularly important for WASM runtime files and child_process
 * spawn() operations that need reliable cross-platform path handling.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { getLogger } from './unifiedLogger';

const logger = getLogger();

/**
 * Create a cross-platform file path using VS Code APIs with Node.js fallback
 *
 * @param basePath - Base directory path
 * @param relativePaths - Path segments to join
 * @returns Cross-platform compatible file path
 */
export function createCrossPlatformPath(basePath: string, ...relativePaths: string[]): string {
    try {
        // Attempt VS Code URI-based path construction first
        let uri = vscode.Uri.file(basePath);

        for (const segment of relativePaths) {
            uri = vscode.Uri.joinPath(uri, segment);
        }

        const vscodePath = uri.fsPath;

        // Log successful VS Code API usage for monitoring
        logger.debug('EXECUTION', `Cross-platform path created via VS Code API: ${vscodePath}`);

        return vscodePath;

    } catch (error) {
        // Fallback to Node.js path module
        logger.debug('EXECUTION', `VS Code path API failed, using Node.js fallback: ${error}`);

        const nodePath = path.join(basePath, ...relativePaths);

        logger.debug('EXECUTION', `Cross-platform path created via Node.js fallback: ${nodePath}`);

        return nodePath;
    }
}

/**
 * Get the directory portion of a path using VS Code APIs with Node.js fallback
 *
 * @param filePath - File path to get directory from
 * @returns Directory path
 */
export function getCrossPlatformDirectory(filePath: string): string {
    try {
        // Attempt VS Code URI-based directory extraction
        const uri = vscode.Uri.file(filePath);
        const parentUri = vscode.Uri.joinPath(uri, '..');

        const vscodePath = parentUri.fsPath;

        logger.debug('EXECUTION', `Cross-platform directory via VS Code API: ${vscodePath}`);

        return vscodePath;

    } catch (error) {
        // Fallback to Node.js path.dirname
        logger.debug('EXECUTION', `VS Code directory API failed, using Node.js fallback: ${error}`);

        const nodePath = path.dirname(filePath);

        logger.debug('EXECUTION', `Cross-platform directory via Node.js fallback: ${nodePath}`);

        return nodePath;
    }
}

/**
 * Resolve a relative path to absolute using VS Code APIs with Node.js fallback
 *
 * @param relativePath - Relative path to resolve
 * @param basePath - Optional base path (defaults to current working directory)
 * @returns Absolute path
 */
export function resolveCrossPlatformPath(relativePath: string, basePath?: string): string {
    try {
        // Attempt VS Code URI-based resolution
        const baseUri = basePath ? vscode.Uri.file(basePath) : vscode.Uri.file(process.cwd());
        const resolvedUri = vscode.Uri.joinPath(baseUri, relativePath);

        const vscodePath = resolvedUri.fsPath;

        logger.debug('EXECUTION', `Cross-platform resolve via VS Code API: ${vscodePath}`);

        return vscodePath;

    } catch (error) {
        // Fallback to Node.js path.resolve
        logger.debug('EXECUTION', `VS Code resolve API failed, using Node.js fallback: ${error}`);

        const nodePath = basePath ? path.resolve(basePath, relativePath) : path.resolve(relativePath);

        logger.debug('EXECUTION', `Cross-platform resolve via Node.js fallback: ${nodePath}`);

        return nodePath;
    }
}

/**
 * Check if a path exists using VS Code APIs with Node.js fallback
 *
 * @param filePath - Path to check
 * @returns Promise<boolean> indicating if path exists
 */
export async function pathExistsCrossPlatform(filePath: string): Promise<boolean> {
    try {
        // Attempt VS Code workspace filesystem API
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.stat(uri);

        logger.debug('EXECUTION', `Path exists check via VS Code API: ${filePath} - true`);

        return true;

    } catch (vscodeError) {
        try {
            // Fallback to Node.js fs (dynamic import to avoid bundling issues)
            const fs = await import('fs');
            const exists = fs.existsSync(filePath);

            logger.debug('EXECUTION', `Path exists check via Node.js fallback: ${filePath} - ${exists}`);

            return exists;

        } catch (nodeError) {
            logger.warn('EXECUTION', `Both VS Code and Node.js path existence checks failed: ${vscodeError}, ${nodeError}`);
            return false;
        }
    }
}

/**
 * Normalize path separators for the current platform using VS Code APIs with fallback
 *
 * @param inputPath - Path to normalize
 * @returns Normalized path with correct separators for current platform
 */
export function normalizeCrossPlatformPath(inputPath: string): string {
    try {
        // VS Code URI automatically handles platform-specific separators
        const uri = vscode.Uri.file(inputPath);
        const normalizedPath = uri.fsPath;

        logger.debug('EXECUTION', `Path normalized via VS Code API: ${inputPath} -> ${normalizedPath}`);

        return normalizedPath;

    } catch (error) {
        // Fallback to Node.js path.normalize
        logger.debug('EXECUTION', `VS Code normalize failed, using Node.js fallback: ${error}`);

        const normalizedPath = path.normalize(inputPath);

        logger.debug('EXECUTION', `Path normalized via Node.js fallback: ${inputPath} -> ${normalizedPath}`);

        return normalizedPath;
    }
}