import * as vscode from 'vscode';
import { SyncCoordinator } from '../syncCoordinator';
import { getLogger } from '../../utils/unifiedLogger';

// Save-Twice Handler using SyncCoordinator
export class FileSaveTwiceHandler implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _logger = getLogger();

    constructor(
        private context: vscode.ExtensionContext,
        private syncCoordinator: SyncCoordinator
    ) {
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
            const fileName = filePath.split('/').pop();

            // Check if this is a file we need to sync (code.py, main.py, or lib/ contents)
            const isRelevantFile = fileName && (
                fileName.includes('code.py') ||
                fileName.includes('main.py') ||
                filePath.includes('/lib/')
            );

            if (!isRelevantFile) {
                return; // Not a file we need to sync
            }

            this._logger.info('WORKSPACE', `Processing sync save for: ${fileName}`);

            // Delegate to SyncCoordinator for project-aware handling
            const success = await this.syncCoordinator.handleFileSave(document.uri);

            if (success) {
                const projectName = this.syncCoordinator.getCurrentProjectName();
                const boardConnected = this.syncCoordinator.isBoardConnected();

                if (projectName && boardConnected) {
                    this._logger.info('WORKSPACE', `File saved to project '${projectName}' and synced to board`);
                } else if (projectName) {
                    this._logger.info('WORKSPACE', `File saved to project '${projectName}' (board will sync when connected)`);
                } else {
                    this._logger.info('WORKSPACE', 'File saved - project created');
                }
            } else {
                this._logger.warn('WORKSPACE', 'File save sync failed or was cancelled');
            }

        } catch (error) {
            this._logger.error('WORKSPACE', `Save-twice error: ${error}`);
        }
    }

    public dispose(): void {
        this._disposables.forEach(d => d.dispose());
        this._disposables = [];
    }
}