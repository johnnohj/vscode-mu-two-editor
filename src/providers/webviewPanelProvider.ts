import * as vscode from 'vscode';
import { MuTwoLanguageClient } from '../devices/core/client';
import { WorkspaceValidator } from '../workspace/workspaceValidator';
import { MuTwoWorkspaceManager } from '../workspace/workspaceManager';
import { IDevice } from '../devices/core/deviceDetector';
import { getNonce } from '../sys/utils/webview';
import { LanguageServiceBridge } from './language/core/LanguageServiceBridge';

export class EditorPanel implements vscode.WebviewPanel{
	
}