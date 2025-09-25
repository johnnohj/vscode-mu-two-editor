// src/core/languageFeatureManager.ts
// Handles CircuitPython language features and providers

import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';
import { editorPanelProvider } from './componentManager';

const logger = getLogger();

/**
 * Register CircuitPython language features for standard Python editors
 */
export function registerCircuitPythonLanguageFeatures(context: vscode.ExtensionContext): void {
    logger.info('LANGUAGE', 'Registering CircuitPython language features for Python files...');

    const pythonSelector: vscode.DocumentSelector = { language: 'python' };

    // Get existing services for integration
    const languageServiceBridge = editorPanelProvider.getLanguageServiceBridge();
    const moduleRegistry = getModuleRegistry();
    const boardDatabase = getBoardDatabase();

    // 1. Completion Provider - CircuitPython-specific autocomplete
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        pythonSelector,
        new CircuitPythonCompletionProvider(languageServiceBridge, moduleRegistry, boardDatabase),
        '.', // Trigger on dot
        ' '  // Trigger on space
    );
    context.subscriptions.push(completionProvider);

    // 2. Hover Provider - Show CircuitPython-specific documentation
    const hoverProvider = vscode.languages.registerHoverProvider(
        pythonSelector,
        new CircuitPythonHoverProvider(languageServiceBridge, moduleRegistry)
    );
    context.subscriptions.push(hoverProvider);

    // 3. Signature Help Provider - Function parameter hints
    const signatureProvider = vscode.languages.registerSignatureHelpProvider(
        pythonSelector,
        new CircuitPythonSignatureProvider(languageServiceBridge),
        '(', ','
    );
    context.subscriptions.push(signatureProvider);

    // 4. Definition Provider - Go to definition for CircuitPython modules
    const definitionProvider = vscode.languages.registerDefinitionProvider(
        pythonSelector,
        new CircuitPythonDefinitionProvider(moduleRegistry)
    );
    context.subscriptions.push(definitionProvider);

    // 5. Diagnostic Provider - CircuitPython-specific linting
    const diagnosticCollection = vscode.languages.createDiagnosticCollection('circuitpython');
    context.subscriptions.push(diagnosticCollection);

    // Update diagnostics when documents change
    const diagnosticProvider = new CircuitPythonDiagnosticProvider(diagnosticCollection, moduleRegistry, boardDatabase);
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.languageId === 'python') {
                diagnosticProvider.updateDiagnostics(e.document);
            }
        })
    );

    // Update diagnostics when documents are opened
    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(document => {
            if (document.languageId === 'python') {
                diagnosticProvider.updateDiagnostics(document);
            }
        })
    );

    logger.info('LANGUAGE', 'CircuitPython language features registered successfully');
}

/**
 * Get the ModuleRegistry instance
 */
function getModuleRegistry(): any {
    try {
        const { moduleRegistry } = require('../providers/language/core/ModuleRegistry');
        return moduleRegistry;
    } catch (error) {
        logger.warn('LANGUAGE', 'ModuleRegistry not available:', error);
        return null;
    }
}

/**
 * Get the Board database
 */
function getBoardDatabase(): any {
    try {
        // Access board database through the ModuleRegistry adapter
        const { moduleRegistry } = require('../providers/language/core/ModuleRegistry');
        return moduleRegistry; // ModuleRegistry includes board data
    } catch (error) {
        logger.warn('LANGUAGE', 'Board database not available:', error);
        return null;
    }
}

// Language Feature Provider Classes
class CircuitPythonCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private languageServiceBridge: any,
        private moduleRegistry: any,
        private boardDatabase: any
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[]> {
        const items: vscode.CompletionItem[] = [];

        try {
            // Get dynamic modules from ModuleRegistry
            if (this.moduleRegistry) {
                const availableModules = this.moduleRegistry.getAvailableModules();
                availableModules.forEach((module: any) => {
                    const item = new vscode.CompletionItem(module.name, vscode.CompletionItemKind.Module);
                    item.detail = `CircuitPython module: ${module.name}`;
                    item.documentation = new vscode.MarkdownString(module.description || `Import the \`${module.name}\` CircuitPython module`);
                    if (module.version) {
                        item.detail += ` (v${module.version})`;
                    }
                    items.push(item);
                });
            }

            // Get board-specific completions from board database
            if (this.boardDatabase && document.getText().includes('import board')) {
                const currentBoard = this.getCurrentBoard();
                if (currentBoard) {
                    const boardPins = this.getBoardPins(currentBoard);
                    boardPins.forEach((pin: any) => {
                        const item = new vscode.CompletionItem(`board.${pin.name}`, vscode.CompletionItemKind.Property);
                        item.detail = `Board pin: ${pin.name}`;
                        item.documentation = new vscode.MarkdownString(
                            `Access pin \`${pin.name}\` on the ${currentBoard.name} board\n\n` +
                            `**Type:** ${pin.type}\n` +
                            `**Capabilities:** ${pin.capabilities?.join(', ') || 'Digital I/O'}`
                        );
                        items.push(item);
                    });
                }
            }

            // Use LanguageServiceBridge for context-aware completions
            if (this.languageServiceBridge) {
                const line = document.lineAt(position).text;
                const currentWord = document.getText(document.getWordRangeAtPosition(position));

                const bridgeCompletions = await this.languageServiceBridge.getLanguageService().getCompletions(
                    document.getText(),
                    { line: position.line, character: position.character }
                );

                if (bridgeCompletions) {
                    bridgeCompletions.forEach((completion: any) => {
                        const item = new vscode.CompletionItem(completion.label, this.mapCompletionKind(completion.kind));
                        item.detail = completion.detail;
                        item.documentation = completion.documentation;
                        item.insertText = completion.insertText;
                        items.push(item);
                    });
                }
            }

        } catch (error) {
            logger.error('LANGUAGE', 'Error in CircuitPython completion provider:', error);
        }

        return items;
    }

    private getCurrentBoard(): any {
        if (this.boardDatabase && this.boardDatabase.getConnectedBoards) {
            const connected = this.boardDatabase.getConnectedBoards();
            return connected.length > 0 ? connected[0] : null;
        }
        return null;
    }

    private getBoardPins(board: any): any[] {
        // Extract pins from board definition
        if (board.pins) {
            return board.pins;
        }

        // Fallback to common pins if board doesn't have specific pin definitions
        return [
            { name: 'LED', type: 'digital', capabilities: ['output'] },
            { name: 'A0', type: 'analog', capabilities: ['input', 'output'] },
            { name: 'A1', type: 'analog', capabilities: ['input', 'output'] },
            { name: 'D0', type: 'digital', capabilities: ['input', 'output'] },
            { name: 'D1', type: 'digital', capabilities: ['input', 'output'] },
            { name: 'SDA', type: 'i2c', capabilities: ['i2c'] },
            { name: 'SCL', type: 'i2c', capabilities: ['i2c'] }
        ];
    }

    private mapCompletionKind(kind: string): vscode.CompletionItemKind {
        switch (kind) {
            case 'module': return vscode.CompletionItemKind.Module;
            case 'class': return vscode.CompletionItemKind.Class;
            case 'function': return vscode.CompletionItemKind.Function;
            case 'variable': return vscode.CompletionItemKind.Variable;
            case 'property': return vscode.CompletionItemKind.Property;
            default: return vscode.CompletionItemKind.Text;
        }
    }
}

class CircuitPythonHoverProvider implements vscode.HoverProvider {
    constructor(
        private languageServiceBridge: any,
        private moduleRegistry: any
    ) {}

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return undefined;

        const word = document.getText(range);

        try {
            // First try to get hover info from LanguageServiceBridge
            if (this.languageServiceBridge) {
                const hoverInfo = await this.languageServiceBridge.getLanguageService().getHover(
                    document.getText(),
                    { line: position.line, character: position.character }
                );

                if (hoverInfo) {
                    const markdownString = new vscode.MarkdownString();
                    if (hoverInfo.signature) {
                        markdownString.appendCodeblock(hoverInfo.signature, 'python');
                    }
                    if (hoverInfo.documentation) {
                        markdownString.appendMarkdown(hoverInfo.documentation);
                    }
                    return new vscode.Hover(markdownString, range);
                }
            }

            // Fallback to ModuleRegistry for module information
            if (this.moduleRegistry) {
                const moduleInfo = this.moduleRegistry.getModuleInfo(word);
                if (moduleInfo) {
                    const markdownString = new vscode.MarkdownString();
                    markdownString.appendCodeblock(`# ${word}`, 'python');
                    markdownString.appendMarkdown(moduleInfo.description || `CircuitPython module: ${word}`);

                    if (moduleInfo.version) {
                        markdownString.appendMarkdown(`\n\n**Version:** ${moduleInfo.version}`);
                    }

                    if (moduleInfo.url) {
                        markdownString.appendMarkdown(`\n\n[Documentation](${moduleInfo.url})`);
                    }

                    return new vscode.Hover(markdownString, range);
                }
            }

            // Final fallback to static CircuitPython info
            const circuitPythonInfo: { [key: string]: string } = {
                'board': 'CircuitPython board module - provides access to board pins and hardware',
                'digitalio': 'CircuitPython digital I/O module - control digital pins',
                'analogio': 'CircuitPython analog I/O module - read analog sensors and control analog outputs',
                'LED': 'Built-in LED pin on the CircuitPython board',
                'neopixel': 'CircuitPython NeoPixel module - control addressable RGB LEDs',
                'busio': 'CircuitPython bus I/O module - I2C, SPI, and UART communication',
                'microcontroller': 'CircuitPython microcontroller module - low-level hardware access'
            };

            if (circuitPythonInfo[word]) {
                const markdownString = new vscode.MarkdownString();
                markdownString.appendCodeblock(`# ${word}`, 'python');
                markdownString.appendMarkdown(circuitPythonInfo[word]);
                return new vscode.Hover(markdownString, range);
            }

        } catch (error) {
            logger.error('LANGUAGE', 'Error in CircuitPython hover provider:', error);
        }

        return undefined;
    }
}

class CircuitPythonSignatureProvider implements vscode.SignatureHelpProvider {
    constructor(private languageServiceBridge: any) {}

    async provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): Promise<vscode.SignatureHelp | undefined> {
        try {
            if (this.languageServiceBridge) {
                const signatureInfo = await this.languageServiceBridge.getLanguageService().getSignatureHelp(
                    document.getText(),
                    { line: position.line, character: position.character }
                );

                if (signatureInfo && signatureInfo.signatures) {
                    const signatureHelp = new vscode.SignatureHelp();

                    signatureHelp.signatures = signatureInfo.signatures.map((sig: any) => {
                        const signature = new vscode.SignatureInformation(sig.label, sig.documentation);

                        if (sig.parameters) {
                            signature.parameters = sig.parameters.map((param: any) =>
                                new vscode.ParameterInformation(param.label, param.documentation)
                            );
                        }

                        return signature;
                    });

                    signatureHelp.activeSignature = signatureInfo.activeSignature || 0;
                    signatureHelp.activeParameter = signatureInfo.activeParameter || 0;

                    return signatureHelp;
                }
            }
        } catch (error) {
            logger.error('LANGUAGE', 'Error in CircuitPython signature provider:', error);
        }

        return undefined;
    }
}

class CircuitPythonDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private moduleRegistry: any) {}

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {
        const range = document.getWordRangeAtPosition(position);
        if (!range) return undefined;

        const word = document.getText(range);

        try {
            if (this.moduleRegistry) {
                const moduleInfo = this.moduleRegistry.getModuleInfo(word);

                if (moduleInfo) {
                    // If module has a local stub file, go to it
                    if (moduleInfo.stubPath) {
                        const stubUri = vscode.Uri.file(moduleInfo.stubPath);
                        return new vscode.Location(stubUri, new vscode.Position(0, 0));
                    }

                    // If module has online documentation, could open that
                    if (moduleInfo.documentationUrl) {
                        // For now, log the URL - could implement opening in browser
                        logger.info('LANGUAGE', `Documentation for ${word}: ${moduleInfo.documentationUrl}`);
                    }
                }
            }
        } catch (error) {
            logger.warn('LANGUAGE', 'Error in CircuitPython definition provider:', error);
        }

        return undefined;
    }
}

class CircuitPythonDiagnosticProvider {
    constructor(
        private diagnosticCollection: vscode.DiagnosticCollection,
        private moduleRegistry: any,
        private boardDatabase: any
    ) {}

    updateDiagnostics(document: vscode.TextDocument): void {
        const diagnostics: vscode.Diagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        // Check for common CircuitPython mistakes
        this.checkCommonMistakes(lines, diagnostics);

        // Check for unavailable modules
        this.checkUnavailableModules(lines, diagnostics);

        // Check for board-specific issues
        this.checkBoardSpecificIssues(lines, diagnostics);

        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private checkCommonMistakes(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        const commonMistakes = [
            {
                pattern: /import RPi\.GPIO/,
                message: 'RPi.GPIO is not available in CircuitPython. Use digitalio instead.',
                suggestion: 'import digitalio'
            },
            {
                pattern: /import wiringpi/,
                message: 'wiringpi is not available in CircuitPython. Use digitalio instead.',
                suggestion: 'import digitalio'
            },
            {
                pattern: /import pygame/,
                message: 'pygame is not available on microcontrollers. Consider using displayio for graphics.',
                suggestion: 'import displayio'
            }
        ];

        lines.forEach((line, lineIndex) => {
            commonMistakes.forEach(mistake => {
                if (mistake.pattern.test(line)) {
                    const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                    const diagnostic = new vscode.Diagnostic(
                        range,
                        mistake.message,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'CircuitPython';
                    diagnostic.code = 'incompatible-import';
                    diagnostics.push(diagnostic);
                }
            });
        });
    }

    private checkUnavailableModules(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        if (!this.moduleRegistry) return;

        const importPattern = /^(?:from\s+(\S+)\s+import|import\s+(\S+))/;

        lines.forEach((line, lineIndex) => {
            const match = line.match(importPattern);
            if (match) {
                const moduleName = match[1] || match[2];

                if (moduleName && !this.moduleRegistry.isModuleAvailable(moduleName)) {
                    // Check if it's a known CircuitPython module that might need installation
                    const suggestions = this.moduleRegistry.getSimilarModules(moduleName);

                    const range = new vscode.Range(lineIndex, 0, lineIndex, line.length);
                    let message = `Module '${moduleName}' is not available in the current CircuitPython environment.`;

                    if (suggestions.length > 0) {
                        message += ` Did you mean: ${suggestions.join(', ')}?`;
                    }

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        message,
                        vscode.DiagnosticSeverity.Warning
                    );
                    diagnostic.source = 'CircuitPython';
                    diagnostic.code = 'module-not-found';
                    diagnostics.push(diagnostic);
                }
            }
        });
    }

    private checkBoardSpecificIssues(lines: string[], diagnostics: vscode.Diagnostic[]): void {
        if (!this.boardDatabase) return;

        const currentBoard = this.getCurrentBoard();
        if (!currentBoard) return;

        // Check for board pin usage
        const boardPinPattern = /board\.(\w+)/g;

        lines.forEach((line, lineIndex) => {
            let match;
            while ((match = boardPinPattern.exec(line)) !== null) {
                const pinName = match[1];

                if (!this.isPinAvailableOnBoard(pinName, currentBoard)) {
                    const startPos = match.index;
                    const endPos = startPos + match[0].length;
                    const range = new vscode.Range(lineIndex, startPos, lineIndex, endPos);

                    const diagnostic = new vscode.Diagnostic(
                        range,
                        `Pin '${pinName}' is not available on ${currentBoard.name}. Available pins: ${this.getAvailablePins(currentBoard).join(', ')}`,
                        vscode.DiagnosticSeverity.Error
                    );
                    diagnostic.source = 'CircuitPython';
                    diagnostic.code = 'invalid-pin';
                    diagnostics.push(diagnostic);
                }
            }
        });
    }

    private getCurrentBoard(): any {
        if (this.boardDatabase && this.boardDatabase.getConnectedBoards) {
            const connected = this.boardDatabase.getConnectedBoards();
            return connected.length > 0 ? connected[0] : null;
        }
        return null;
    }

    private isPinAvailableOnBoard(pinName: string, board: any): boolean {
        if (board.pins) {
            return board.pins.some((pin: any) => pin.name === pinName);
        }
        // Fallback - assume common pins are available
        const commonPins = ['LED', 'A0', 'A1', 'A2', 'D0', 'D1', 'D2', 'SDA', 'SCL'];
        return commonPins.includes(pinName);
    }

    private getAvailablePins(board: any): string[] {
        if (board.pins) {
            return board.pins.map((pin: any) => pin.name);
        }
        return ['LED', 'A0', 'A1', 'A2', 'D0', 'D1', 'D2', 'SDA', 'SCL'];
    }
}