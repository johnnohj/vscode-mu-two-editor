// src/core/boardEventManager.ts
// Handles board events, status bar updates, and webview notifications

import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { BoardManager, IBoard } from '../devices/management/boardManager';
import { webviewViewProvider, webviewPanelProvider } from './componentManager';

const logger = getLogger();

// Status bar item for board connection status
let statusBarItem: vscode.StatusBarItem;

/**
 * Initialize BoardManager as the primary device management system
 * Phase 2: No longer requires deviceDetector - uses DeviceRegistry instead
 */
export async function initializeBoardManager(
    context: vscode.ExtensionContext,
    deviceManager: any,
    languageClient: any,
    fileSystemProvider: any
): Promise<BoardManager> {
    logger.info('BOARD_EVENTS', 'Initializing BoardManager as primary device system...');

    try {
        // Check if required dependencies are available
        if (!deviceManager || !languageClient) {
            logger.warn('BOARD_EVENTS', 'Some required services for BoardManager not available, skipping BoardManager initialization');
            throw new Error('Required dependencies not available');
        }

        // File system provider is now passed directly (initialized early in activation)

        // Create BoardManager - Phase 2: Uses DeviceRegistry internally
        const boardManager = new BoardManager(
            context,
            deviceManager,
            languageClient,
            fileSystemProvider
        );

        // Set up board event handlers
        setupBoardEventHandlers(boardManager);

        // Connect board manager to view provider if it exists
        if (webviewViewProvider) {
            webviewViewProvider.setBoardManager(boardManager);
        }

        // Initialize board detection
        await boardManager.initialize();

        logger.info('BOARD_EVENTS', 'BoardManager initialized successfully');
        return boardManager;

    } catch (error) {
        logger.error('BOARD_EVENTS', 'BoardManager initialization failed:', error);
        throw error;
    }
}

/**
 * Set up board event handlers
 */
export function setupBoardEventHandlers(boardManager: BoardManager): void {
    boardManager.onBoardAdded((board) => {
        logger.info('BOARD_EVENTS', `Board added: ${board.name} (${board.type})`);
        updateStatusBar(boardManager);
        notifyWebviewsOfBoardChange(boardManager);
    });

    boardManager.onBoardRemoved((board) => {
        logger.info('BOARD_EVENTS', `Board removed: ${board.name}`);
        updateStatusBar(boardManager);
        notifyWebviewsOfBoardChange(boardManager);
    });

    boardManager.onBoardConnectionChanged(({ board, state }) => {
        logger.info('BOARD_EVENTS', `Board ${board.name} connection changed:`, state);
        updateStatusBar(boardManager);
        notifyWebviewsOfBoardChange(boardManager);
    });
}

/**
 * Update the status bar with current board connection status
 */
export function updateStatusBar(boardManager: BoardManager): void {
    if (!statusBarItem) {
        // Create persistent status bar item for device connection status
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = 'muTwo.boards.list';
        statusBarItem.tooltip = 'Click to view CircuitPython boards';
        statusBarItem.show();
    }

    const connectedBoards = boardManager.getConnectedBoards();
    const totalBoards = boardManager.getAllBoards();

    if (totalBoards.length === 0) {
        statusBarItem.text = `$(plug) No CircuitPython boards`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (connectedBoards.length === 0) {
        statusBarItem.text = `$(circle-outline) ${totalBoards.length} board(s) available`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = `$(check-all) ${connectedBoards.length}/${totalBoards.length} connected`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    }
}

/**
 * Notify webviews of board changes
 */
export function notifyWebviewsOfBoardChange(boardManager: BoardManager): void {
    const boardList = boardManager.getAllBoards().map(board => ({
        id: board.id,
        name: board.name,
        type: board.type,
        connected: board.isConnected(),
        connectionState: board.connectionState,
        capabilities: board.capabilities
    }));

    if (webviewViewProvider && typeof webviewViewProvider.sendMessage === 'function') {
        webviewViewProvider.sendMessage({
            type: 'boardsUpdated',
            data: boardList
        });
    }

    // TODO: Re-enable after webviewPanelProvider has sendMessage method
    // if (webviewPanelProvider && typeof webviewPanelProvider.sendMessage === 'function') {
    //     webviewPanelProvider.sendMessage({
    //         type: 'boardsUpdated',
    //         data: boardList
    //     });
    // }
}

/**
 * Dispose of status bar item during deactivation
 */
export function disposeStatusBar(): void {
    if (statusBarItem) {
        statusBarItem.dispose();
    }
}