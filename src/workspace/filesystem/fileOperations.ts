import * as vscode from 'vscode';

/**
 * Utility functions for file and directory operations in Mu Two workspaces
 */
export class FileOperations {
    
    /**
     * Ensure directory exists, create if it doesn't
     */
    static async ensureDirectoryExists(dirUri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.stat(dirUri);
        } catch {
            await vscode.workspace.fs.createDirectory(dirUri);
        }
    }

    /**
     * Clear all contents of a directory
     */
    static async clearDirectory(dirUri: vscode.Uri): Promise<void> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(dirUri);
            for (const [name] of entries) {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(dirUri, name), { recursive: true });
            }
        } catch {
            // Directory might not exist
        }
    }

    /**
     * Recursively copy all contents from source to target directory
     */
    static async copyDirectoryContents(sourceDir: vscode.Uri, targetDir: vscode.Uri): Promise<void> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(sourceDir);
            for (const [name, type] of entries) {
                const sourcePath = vscode.Uri.joinPath(sourceDir, name);
                const targetPath = vscode.Uri.joinPath(targetDir, name);
                
                if (type === vscode.FileType.Directory) {
                    await FileOperations.ensureDirectoryExists(targetPath);
                    await FileOperations.copyDirectoryContents(sourcePath, targetPath);
                } else {
                    await vscode.workspace.fs.copy(sourcePath, targetPath, { overwrite: true });
                }
            }
        } catch (error) {
            throw new Error(`Failed to copy directory contents: ${error}`);
        }
    }

    /**
     * Check if a directory has significant content worth preserving
     */
    static async hasSignificantContent(currentDir: vscode.Uri): Promise<boolean> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(currentDir);
            
            // Look for Python files or meaningful content
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && (name.endsWith('.py') || name === 'settings.toml')) {
                    const fileUri = vscode.Uri.joinPath(currentDir, name);
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    const text = new TextDecoder().decode(content).trim();
                    
                    // Check if file has more than just boilerplate content
                    if (text.length > 50 && !text.includes('# Write your code here!')) {
                        return true;
                    }
                }
            }
            
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Generate project name from code content or timestamp
     */
    static async generateProjectName(workspaceRoot?: vscode.Uri): Promise<string> {
        try {
            if (workspaceRoot) {
                const currentDir = vscode.Uri.joinPath(workspaceRoot, 'current');
                
                // Try to find a meaningful name from code.py or main.py
                const pythonFiles = ['code.py', 'main.py'];
                for (const filename of pythonFiles) {
                    try {
                        const fileUri = vscode.Uri.joinPath(currentDir, filename);
                        const content = await vscode.workspace.fs.readFile(fileUri);
                        const text = new TextDecoder().decode(content);
                        
                        // Look for project name in comments
                        const nameMatch = text.match(/(?:#|""").*?(?:project|name).*?[:=]\s*([^#\n"]*)/i);
                        if (nameMatch && nameMatch[1]) {
                            const name = nameMatch[1].trim().replace(/[^a-zA-Z0-9-_]/g, '-');
                            if (name.length > 0) {
                                return name;
                            }
                        }
                    } catch {
                        continue;
                    }
                }
            }

            // Fallback to timestamp-based name
            const now = new Date();
            return `project-${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
        } catch {
            return `project-${Date.now()}`;
        }
    }

    /**
     * Create basic CircuitPython project structure
     */
    static async createBasicProjectStructure(projectDir: vscode.Uri): Promise<void> {
        // Create lib directory
        await FileOperations.ensureDirectoryExists(vscode.Uri.joinPath(projectDir, 'lib'));
        
        // Create a basic code.py file
        const codeContent = `# Mu Two CircuitPython Project
# Write your code here!

print("Hello from Mu Two!")
`;
        await vscode.workspace.fs.writeFile(
            vscode.Uri.joinPath(projectDir, 'code.py'),
            new TextEncoder().encode(codeContent)
        );
    }
}