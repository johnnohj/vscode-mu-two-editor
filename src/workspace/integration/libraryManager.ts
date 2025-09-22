import * as vscode from 'vscode';
import { getLogger } from '../../sys/unifiedLogger';

export interface LibraryManifest {
    libraries: string[];
    generated: string;
    custom_libraries: string[];
    modified_libraries: string[];
}

/**
 * Manages lib.json generation and library tracking for projects
 */
export class LibraryManager {
    private logger = getLogger();

    constructor() {
        // Using unified logger instead of createOutputChannel
    }

    /**
     * Generate lib.json from lib directory contents
     */
	 // TODO: JSON files are okay if it's for the extension's internal use, but we should consider pyproject.toml for
	 // user-facing metadata depending on how 'circup' locates/expects to find library metadata. -jef
    async generateLibraryManifest(libDir: vscode.Uri, targetDir: vscode.Uri): Promise<void> {
        try {
            const libJsonPath = vscode.Uri.joinPath(targetDir, 'lib.json');
            const libraries: string[] = [];
            
            try {
                const entries = await vscode.workspace.fs.readDirectory(libDir);
                for (const [name, type] of entries) {
                    if (type === vscode.FileType.File && name.endsWith('.py')) {
                        libraries.push(name.replace('.py', ''));
                    } else if (type === vscode.FileType.Directory) {
                        libraries.push(name);
                    }
                }
            } catch {
                // lib directory doesn't exist or is empty
            }

            const libManifest: LibraryManifest = {
                libraries: libraries.sort(),
                generated: new Date().toISOString(),
                // TODO: Add logic to differentiate custom/modified libraries
                // TODO: Consider different file schemes for Adafruit/CircuitPython sources
                custom_libraries: [], // Placeholder for future implementation
                modified_libraries: [] // Placeholder for future implementation
            };

            await vscode.workspace.fs.writeFile(
                libJsonPath,
                new TextEncoder().encode(JSON.stringify(libManifest, null, 2))
            );

            this.logger.info('WORKSPACE', `Updated lib.json with ${libraries.length} libraries`);
        } catch (error) {
            this.logger.error('WORKSPACE', `Failed to generate library manifest: ${error}`);
            throw error;
        }
    }

    /**
     * Read existing lib.json if it exists
     */
    async readLibraryManifest(projectDir: vscode.Uri): Promise<LibraryManifest | null> {
        try {
            const libJsonPath = vscode.Uri.joinPath(projectDir, 'lib.json');
            const content = await vscode.workspace.fs.readFile(libJsonPath);
            const text = new TextDecoder().decode(content);
            return JSON.parse(text) as LibraryManifest;
        } catch {
            return null; // File doesn't exist or is invalid
        }
    }

    /**
     * Compare two library manifests to detect changes
     */
    compareManifests(current: LibraryManifest, previous: LibraryManifest): {
        added: string[];
        removed: string[];
        unchanged: string[];
    } {
        const currentSet = new Set(current.libraries);
        const previousSet = new Set(previous.libraries);

        const added = current.libraries.filter(lib => !previousSet.has(lib));
        const removed = previous.libraries.filter(lib => !currentSet.has(lib));
        const unchanged = current.libraries.filter(lib => previousSet.has(lib));

        return { added, removed, unchanged };
    }

    /**
     * Update lib.json for a project directory
     */
	 // TODO: For this function and the next (syncLibrariesFromProject), we might ease the burden on our extension
	 // if we leaned on an existing library management tool like 'circup' or 'pip' to handle library syncing and tracking.
	 // Hence the comment above (line 23) about pyproject.toml. -jef
    async updateProjectLibraries(projectDir: vscode.Uri): Promise<void> {
        const libDir = vscode.Uri.joinPath(projectDir, 'lib');
        await this.generateLibraryManifest(libDir, projectDir);
    }

    /**
     * Sync libraries from one project to current workspace
     */
    async syncLibrariesFromProject(sourceProjectDir: vscode.Uri, targetCurrentDir: vscode.Uri): Promise<void> {
        try {
            const sourceLibDir = vscode.Uri.joinPath(sourceProjectDir, 'lib');
            const targetLibDir = vscode.Uri.joinPath(targetCurrentDir, 'lib');

            // Ensure target lib directory exists
            await this.ensureDirectoryExists(targetLibDir);

            // Copy all library files
            try {
                const entries = await vscode.workspace.fs.readDirectory(sourceLibDir);
                for (const [name, type] of entries) {
                    const sourcePath = vscode.Uri.joinPath(sourceLibDir, name);
                    const targetPath = vscode.Uri.joinPath(targetLibDir, name);
                    
                    if (type === vscode.FileType.Directory) {
                        await this.copyDirectoryRecursive(sourcePath, targetPath);
                    } else {
                        await vscode.workspace.fs.copy(sourcePath, targetPath, { overwrite: true });
                    }
                }

                this.logger.info('WORKSPACE', `Synced libraries from project to current workspace`);
            } catch {
                // Source lib directory doesn't exist
                this.logger.info('WORKSPACE', `No libraries found in source project`);
            }
        } catch (error) {
            this.logger.error('WORKSPACE', `Failed to sync libraries: ${error}`);
            throw error;
        }
    }

    private async ensureDirectoryExists(dirUri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.stat(dirUri);
        } catch {
            await vscode.workspace.fs.createDirectory(dirUri);
        }
    }

    private async copyDirectoryRecursive(sourceDir: vscode.Uri, targetDir: vscode.Uri): Promise<void> {
        await this.ensureDirectoryExists(targetDir);
        
        const entries = await vscode.workspace.fs.readDirectory(sourceDir);
        for (const [name, type] of entries) {
            const sourcePath = vscode.Uri.joinPath(sourceDir, name);
            const targetPath = vscode.Uri.joinPath(targetDir, name);
            
            if (type === vscode.FileType.Directory) {
                await this.copyDirectoryRecursive(sourcePath, targetPath);
            } else {
                await vscode.workspace.fs.copy(sourcePath, targetPath, { overwrite: true });
            }
        }
    }

    dispose(): void {
        // Using unified logger - no manual disposal needed
    }
}