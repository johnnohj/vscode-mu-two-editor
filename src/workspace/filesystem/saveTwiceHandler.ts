import * as vscode from 'vscode';
import { ProjectManager } from '../core/projectManager';
import { BoardManager } from '../../sys/boardManager';
import { LibraryManager } from '../integration/libraryManager';
import { FileOperations } from './fileOperations';

// Save-Twice Handler with Project Integration
export class FileSaveTwiceHandler implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _outputChannel: vscode.OutputChannel;
    private _libraryManager: LibraryManager;

    constructor(
        private context: vscode.ExtensionContext,
        private projectManager: ProjectManager,
        private boardManager: BoardManager
    ) {
        this._outputChannel = vscode.window.createOutputChannel('Mu Two Save Twice');
        this._libraryManager = new LibraryManager();
        this.setupSaveHandler();
    }

    private setupSaveHandler(): void {
        // Listen for manual document saves
        this._disposables.push(
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                // Only handle manual saves - we'll check this via the event trigger itself
                await this.handleManualSave(document);
            })
        );
    }

    private async handleManualSave(document: vscode.TextDocument): Promise<void> {
        try {
            const filePath = document.uri.path;
            
            // Only handle files in ctpy-device/current directory
            if (!filePath.includes('/ctpy-device/current/')) {
                return;
            }

            const fileName = filePath.split('/').pop();
            if (!fileName || (!fileName.includes('code.py') && !fileName.includes('main.py'))) {
                return; // Only handle code.py and main.py
            }

            this._outputChannel.appendLine(`Processing save-twice for: ${fileName}`);

            // 1. Update project backup (replaces .board logic)
            await this.updateProjectBackup(document.uri);

            // 2. Update lib.json if needed
            await this.updateLibraryManifest();

            // 3. Check for connected boards using existing BoardManager
            const connectedBoards = this.boardManager.getConnectedBoards();
            if (connectedBoards.length > 0) {
                await this.syncToConnectedBoards(document.uri, connectedBoards);
            } else {
                this._outputChannel.appendLine('No connected CircuitPython boards - saved to project backup only');
                vscode.window.showInformationMessage('💾 File saved to project backup (no board connected)');
            }

        } catch (error) {
            this._outputChannel.appendLine(`Save-twice error: ${error}`);
        }
    }

    private async updateProjectBackup(savedFileUri: vscode.Uri): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 2) {
                return;
            }

            const mainRoot = workspaceFolders[0];
            const projectsDir = vscode.Uri.joinPath(mainRoot.uri, 'projects');
            await FileOperations.ensureDirectoryExists(projectsDir);

            const currentProjectName = this.projectManager.getCurrentProjectName();
            let backupDir: vscode.Uri;

            if (currentProjectName) {
                backupDir = vscode.Uri.joinPath(projectsDir, currentProjectName);
                this._outputChannel.appendLine(`Backing up to project: ${currentProjectName}`);
            } else {
                backupDir = vscode.Uri.joinPath(projectsDir, '.current');
                this._outputChannel.appendLine('Backing up to .current');
            }

            await FileOperations.ensureDirectoryExists(backupDir);

            // Copy the saved file to backup directory
            const fileName = savedFileUri.path.split('/').pop()!;
            const backupFileUri = vscode.Uri.joinPath(backupDir, fileName);

            await vscode.workspace.fs.copy(savedFileUri, backupFileUri, { overwrite: true });
            this._outputChannel.appendLine(`Backed up ${fileName} to project directory`);

        } catch (error) {
            this._outputChannel.appendLine(`Failed to update project backup: ${error}`);
        }
    }

    private async updateLibraryManifest(): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length < 2) {
                return;
            }

            const mainRoot = workspaceFolders[0];
            const ctpyRoot = workspaceFolders[1];
            const currentLibDir = vscode.Uri.joinPath(ctpyRoot.uri, 'current', 'lib');
            const projectsDir = vscode.Uri.joinPath(mainRoot.uri, 'projects');

            const currentProjectName = this.projectManager.getCurrentProjectName();
            let targetDir: vscode.Uri;

            if (currentProjectName) {
                targetDir = vscode.Uri.joinPath(projectsDir, currentProjectName);
            } else {
                targetDir = vscode.Uri.joinPath(projectsDir, '.current');
            }

            await this._libraryManager.generateLibraryManifest(currentLibDir, targetDir);

        } catch (error) {
            this._outputChannel.appendLine(`Failed to update library manifest: ${error}`);
        }
    }

    private async syncToConnectedBoards(savedFileUri: vscode.Uri, boards: any[]): Promise<void> {
        const fileName = savedFileUri.path.split('/').pop()!;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Syncing ${fileName} to CircuitPython`,
            cancellable: false
        }, async (progress) => {
            const increment = 100 / boards.length;
            
            for (let i = 0; i < boards.length; i++) {
                const board = boards[i];
                progress.report({ 
                    increment: i === 0 ? 0 : increment, 
                    message: `Copying to ${board.name}...` 
                });

                try {
                    // Use board's file operations to write to the device
                    if (board.isConnected()) {
                        const content = await vscode.workspace.fs.readFile(savedFileUri);
                        await board.writeFile(fileName, content);
                        this._outputChannel.appendLine(`Synced ${fileName} to ${board.name}`);
                    } else {
                        this._outputChannel.appendLine(`Board ${board.name} is no longer connected`);
                    }
                } catch (error) {
                    this._outputChannel.appendLine(`Failed to sync to ${board.name}: ${error}`);
                }
            }
            
            progress.report({ increment: increment, message: 'Complete!' });
        });

        vscode.window.showInformationMessage(`💾 ${fileName} saved and synced to ${boards.length} board(s)`);
    }

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
        this._outputChannel.dispose();
        this._libraryManager.dispose();
    }
}