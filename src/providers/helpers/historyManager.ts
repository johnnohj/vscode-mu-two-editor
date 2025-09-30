// File: src/app/terminalHistoryManager.ts
import * as vscode from 'vscode';
import { getLogger } from '../../utils/unifiedLogger';
import { getResourceLocator } from '../../core/resourceLocator';
// import { SerialMessage } from './serialProvider'; // File deleted - using any for now
type SerialMessage = any;

export interface HistoryEntry {
  command: string;
  output?: string;
  timestamp: number;
  type: 'command' | 'output';
}

export class TerminalHistoryManager implements vscode.Disposable {
  private _commandHistory: string[] = [];
  private _fullHistory: HistoryEntry[] = [];
  private _currentHistoryIndex = -1;
  private _maxCommandHistory = 1000;
  private _maxFullHistory = 5000;
  private _workspaceUri: vscode.Uri;
  private _historyFile: vscode.Uri;
  private _commandsFile: vscode.Uri;
  private _loggingEnabled = false;
  private logger = getLogger();

  constructor(private _context: vscode.ExtensionContext) {
    const resourceLocator = getResourceLocator();
    this._workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri || resourceLocator.getGlobalStorageUri();
    this._historyFile = vscode.Uri.joinPath(this._workspaceUri, '.vscode', 'mu2-history.json');
    this._commandsFile = vscode.Uri.joinPath(this._workspaceUri, '.vscode', 'mu2-commands.json');

    this._loadHistoryFromDisk();
  }

  addCommand(command: string): void {
    // Clean the command to remove any line endings and trim whitespace
    const cleanCommand = command.replace(/\r?\n/g, '').trim();
    if (cleanCommand === '') {return};
    
    // Always maintain in-memory command history (for navigation)
    const existingIndex = this._commandHistory.indexOf(cleanCommand);
    if (existingIndex !== -1) {
      this._commandHistory.splice(existingIndex, 1);
    }

    this._commandHistory.push(cleanCommand);
    
    // Maintain max size
    if (this._commandHistory.length > this._maxCommandHistory) {
      this._commandHistory.shift();
    }

    // Only add to persistent history if logging is enabled
    if (this._loggingEnabled) {
      this._fullHistory.push({
        command: cleanCommand,
        timestamp: Date.now(),
        type: 'command'
      });

      // Maintain max size for full history
      if (this._fullHistory.length > this._maxFullHistory) {
        this._fullHistory.shift();
      }

      queueMicrotask(() => this._saveHistoryToDisk());
    }

    this._currentHistoryIndex = -1;
  }

  addMessage(message: SerialMessage): void {
    // Only log messages if logging is enabled
    if (this._loggingEnabled && message.type === 'data') {
      this._fullHistory.push({
        command: message.payload.data,
        timestamp: message.timestamp,
        type: message.payload.direction === 'out' ? 'command' : 'output'
      });

      // Maintain max size
      if (this._fullHistory.length > this._maxFullHistory) {
        this._fullHistory.shift();
      }

      queueMicrotask(() => this._saveHistoryToDisk());
    }
  }

  getNextCommand(): string | null {
    if (this._commandHistory.length === 0) {return null};
    
    if (this._currentHistoryIndex === -1) {
      this._currentHistoryIndex = this._commandHistory.length - 1;
    } else if (this._currentHistoryIndex > 0) {
      this._currentHistoryIndex--;
    }
    
    return this._commandHistory[this._currentHistoryIndex] || null;
  }

  getPreviousCommand(): string | null {
    if (this._commandHistory.length === 0) {return null};
    
    if (this._currentHistoryIndex === -1 || this._currentHistoryIndex >= this._commandHistory.length - 1) {
      return null;
    }
    
    this._currentHistoryIndex++;
    return this._commandHistory[this._currentHistoryIndex] || null;
  }

  resetHistoryIndex(): void {
    this._currentHistoryIndex = -1;
  }

  getFullHistory(): HistoryEntry[] {
    return [...this._fullHistory];
  }

  getCommandHistory(): string[] {
    return [...this._commandHistory];
  }

  private async _loadHistoryFromDisk(): Promise<void> {
    try {
      // Ensure .vscode directory exists
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this._workspaceUri, '.vscode'));

      // Load full history
      try {
        const historyData = await vscode.workspace.fs.readFile(this._historyFile);
        const historyText = new TextDecoder().decode(historyData);
        const parsed = JSON.parse(historyText);
        
        // Verify file integrity (basic check)
        const stats = await vscode.workspace.fs.stat(this._historyFile);
        if (parsed._metadata?.lastModified && Math.abs(stats.mtime - parsed._metadata.lastModified) < 5000) {
          this._fullHistory = parsed.history || [];
        }
      } catch (e) {
        // File doesn't exist or is corrupted, start fresh
        this.logger.warn('EXTENSION', 'History file not found or corrupted, starting fresh', e);
      }

      // Load commands
      try {
        const commandsData = await vscode.workspace.fs.readFile(this._commandsFile);
        const commandsText = new TextDecoder().decode(commandsData);
        const parsed = JSON.parse(commandsText);
        
        const stats = await vscode.workspace.fs.stat(this._commandsFile);
        if (parsed._metadata?.lastModified && Math.abs(stats.mtime - parsed._metadata.lastModified) < 5000) {
          this._commandHistory = parsed.commands || [];
        }
      } catch (e) {
        this.logger.warn('EXTENSION', 'Commands file not found or corrupted, starting fresh', e);
      }
    } catch (error) {
      this.logger.error('EXTENSION', 'Error loading history:', error);
    }
  }

  private async _saveHistoryToDisk(): Promise<void> {
    try {
      const timestamp = Date.now();
      
      // Save full history
      const historyContent = {
        history: this._fullHistory,
        _metadata: {
          lastModified: timestamp,
          source: 'mu2-extension'
        }
      };
      
      await vscode.workspace.fs.writeFile(
        this._historyFile,
        new TextEncoder().encode(JSON.stringify(historyContent, null, 2))
      );

      // Save commands
      const commandsContent = {
        commands: this._commandHistory,
        _metadata: {
          lastModified: timestamp,
          source: 'mu2-extension'
        }
      };
      
      await vscode.workspace.fs.writeFile(
        this._commandsFile,
        new TextEncoder().encode(JSON.stringify(commandsContent, null, 2))
      );
    } catch (error) {
      this.logger.error('EXTENSION', 'Error saving history:', error);
    }
  }

  startLogging(): void {
    this._loggingEnabled = true;
  }

  stopLogging(): void {
    this._loggingEnabled = false;
  }

  isLoggingEnabled(): boolean {
    return this._loggingEnabled;
  }

  dispose(): void {
    // Final save if logging is enabled
    if (this._loggingEnabled) {
      this._saveHistoryToDisk();
    }
  }
}