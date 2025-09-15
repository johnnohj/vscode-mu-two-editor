/**
 * CircuitPython Language Service Core
 * 
 * Standalone language service for CircuitPython development.
 * Designed for extraction as independent language server.
 * 
 * This module provides:
 * - Code completion for CircuitPython modules and APIs
 * - Board-aware pin validation and suggestions
 * - Hover documentation for CircuitPython objects
 * - Signature help for functions and constructors
 * - Diagnostics for CircuitPython-specific issues
 */

import { 
    CircuitPythonModule, 
    CircuitPythonBoard, 
    CompletionItem, 
    HoverInfo, 
    SignatureHelp, 
    Diagnostic,
    Position,
    CompletionContext,
    CircuitPythonLanguageServiceConfig
} from '../types';
import { moduleRegistry } from './ModuleRegistry';

export interface ICircuitPythonLanguageService {
    // Core language features
    getCompletions(document: string, position: Position, context?: CompletionContext): Promise<CompletionItem[]>;
    getHover(document: string, position: Position): Promise<HoverInfo | null>;
    getSignatureHelp(document: string, position: Position): Promise<SignatureHelp | null>;
    getDiagnostics(document: string): Promise<Diagnostic[]>;
    
    // Board management
    setBoard(board: CircuitPythonBoard): void;
    getBoard(): CircuitPythonBoard | null;
    getAvailableBoards(): CircuitPythonBoard[];
    
    // Module management
    getAvailableModules(): CircuitPythonModule[];
    getModule(name: string): CircuitPythonModule | null;
    
    // Configuration
    updateConfig(config: Partial<CircuitPythonLanguageServiceConfig>): void;
    getConfig(): CircuitPythonLanguageServiceConfig;
}

export class CircuitPythonLanguageService implements ICircuitPythonLanguageService {
    private currentBoard: CircuitPythonBoard | null = null;
    private config: CircuitPythonLanguageServiceConfig;
    
    constructor(config?: Partial<CircuitPythonLanguageServiceConfig>) {
        this.config = {
            enableDiagnostics: true,
            enableCompletions: true,
            enableHover: true,
            enableSignatureHelp: true,
            strictPinValidation: true,
            enableBoardSpecificCompletions: true,
            ...config
        };
    }

    // Board Management
    setBoard(board: CircuitPythonBoard): void {
        this.currentBoard = board;
    }

    getBoard(): CircuitPythonBoard | null {
        return this.currentBoard;
    }

    getAvailableBoards(): CircuitPythonBoard[] {
        return moduleRegistry.boards;
    }

    // Module Management  
    getAvailableModules(): CircuitPythonModule[] {
        return moduleRegistry.modules;
    }

    getModule(name: string): CircuitPythonModule | null {
        return moduleRegistry.modules.find(m => m.name === name) || null;
    }

    // Configuration
    updateConfig(config: Partial<CircuitPythonLanguageServiceConfig>): void {
        this.config = { ...this.config, ...config };
    }

    getConfig(): CircuitPythonLanguageServiceConfig {
        return { ...this.config };
    }

    // Core Language Features
    async getCompletions(document: string, position: Position, context?: CompletionContext): Promise<CompletionItem[]> {
        if (!this.config.enableCompletions) {
            return [];
        }

        const completions: CompletionItem[] = [];
        const lines = document.split('\n');
        const currentLine = lines[position.line] || '';
        const beforeCursor = currentLine.substring(0, position.character);
        
        // Parse the context around the cursor
        const completionContext = this.parseCompletionContext(beforeCursor, lines.slice(0, position.line));
        
        // Module-level completions
        if (completionContext.type === 'module') {
            completions.push(...this.getModuleCompletions(completionContext));
        }
        
        // Member access completions (obj.member)
        else if (completionContext.type === 'member') {
            completions.push(...this.getMemberCompletions(completionContext));
        }
        
        // Board pin completions (board.*)
        else if (completionContext.type === 'board' && this.currentBoard) {
            completions.push(...this.getBoardCompletions(completionContext));
        }
        
        // Import statement completions
        else if (completionContext.type === 'import') {
            completions.push(...this.getImportCompletions(completionContext));
        }

        return completions;
    }

    async getHover(document: string, position: Position): Promise<HoverInfo | null> {
        if (!this.config.enableHover) {
            return null;
        }

        const lines = document.split('\n');
        const currentLine = lines[position.line] || '';
        const wordRange = this.getWordAtPosition(currentLine, position.character);
        
        if (!wordRange) {
            return null;
        }

        const word = currentLine.substring(wordRange.start, wordRange.end);
        const context = this.parseHoverContext(word, currentLine, lines.slice(0, position.line));
        
        // Module hover info
        if (context.type === 'module') {
            const module = this.getModule(context.moduleName);
            if (module) {
                return {
                    contents: module.description,
                    range: wordRange
                };
            }
        }
        
        // Member hover info
        else if (context.type === 'member') {
            const module = this.getModule(context.moduleName);
            const member = module?.members.find(m => m.name === context.memberName);
            if (member) {
                return {
                    contents: this.formatMemberHover(member),
                    range: wordRange
                };
            }
        }
        
        // Board pin hover info
        else if (context.type === 'board_pin' && this.currentBoard) {
            const pin = this.currentBoard.pins.find(p => 
                p.name === context.pinName || p.aliases?.includes(context.pinName)
            );
            if (pin) {
                return {
                    contents: this.formatPinHover(pin),
                    range: wordRange
                };
            }
        }

        return null;
    }

    async getSignatureHelp(document: string, position: Position): Promise<SignatureHelp | null> {
        if (!this.config.enableSignatureHelp) {
            return null;
        }

        const lines = document.split('\n');
        const currentLine = lines[position.line] || '';
        const beforeCursor = currentLine.substring(0, position.character);
        
        // Find function call context
        const functionContext = this.parseFunctionCallContext(beforeCursor, lines.slice(0, position.line));
        
        if (!functionContext) {
            return null;
        }

        const module = this.getModule(functionContext.moduleName);
        const member = module?.members.find(m => m.name === functionContext.functionName);
        
        if (member && member.type === 'function') {
            return {
                signatures: [{
                    label: this.formatSignature(member),
                    documentation: member.description,
                    parameters: member.parameters?.map(p => ({
                        label: p.name,
                        documentation: p.description
                    })) || []
                }],
                activeSignature: 0,
                activeParameter: functionContext.parameterIndex
            };
        }

        return null;
    }

    async getDiagnostics(document: string): Promise<Diagnostic[]> {
        if (!this.config.enableDiagnostics) {
            return [];
        }

        const diagnostics: Diagnostic[] = [];
        const lines = document.split('\n');
        
        // Check for common CircuitPython issues
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for undefined board pins
            if (this.currentBoard && this.config.enableBoardSpecificCompletions) {
                const pinReferences = this.extractPinReferences(line);
                for (const pinRef of pinReferences) {
                    if (!this.isValidPin(pinRef.name)) {
                        diagnostics.push({
                            message: `Pin '${pinRef.name}' is not available on board '${this.currentBoard.name}'`,
                            severity: 'error',
                            range: {
                                start: { line: i, character: pinRef.start },
                                end: { line: i, character: pinRef.end }
                            },
                            source: 'circuitpython'
                        });
                    }
                }
            }
            
            // Check for missing imports
            const moduleUsage = this.extractModuleUsage(line);
            for (const usage of moduleUsage) {
                if (!this.isModuleImported(usage.module, lines.slice(0, i))) {
                    diagnostics.push({
                        message: `Module '${usage.module}' is not imported`,
                        severity: 'error',
                        range: {
                            start: { line: i, character: usage.start },
                            end: { line: i, character: usage.end }
                        },
                        source: 'circuitpython'
                    });
                }
            }
        }

        return diagnostics;
    }

    // Private helper methods
    private parseCompletionContext(beforeCursor: string, previousLines: string[]): any {
        // Simplified implementation - would need full parser
        if (beforeCursor.includes('import ')) {
            return { type: 'import' };
        }
        if (beforeCursor.includes('board.')) {
            return { type: 'board' };
        }
        if (beforeCursor.includes('.')) {
            const parts = beforeCursor.split('.');
            return { 
                type: 'member',
                moduleName: parts[parts.length - 2],
                prefix: parts[parts.length - 1]
            };
        }
        return { type: 'module' };
    }

    private getModuleCompletions(context: any): CompletionItem[] {
        return moduleRegistry.modules.map(module => ({
            label: module.name,
            kind: 'module',
            detail: module.description,
            documentation: module.description
        }));
    }

    private getMemberCompletions(context: any): CompletionItem[] {
        const module = this.getModule(context.moduleName);
        if (!module) return [];
        
        return module.members.map(member => ({
            label: member.name,
            kind: member.type === 'function' ? 'function' : 'property',
            detail: member.description,
            documentation: member.description
        }));
    }

    private getBoardCompletions(context: any): CompletionItem[] {
        if (!this.currentBoard) return [];
        
        return this.currentBoard.pins.map(pin => ({
            label: pin.name,
            kind: 'property',
            detail: `Pin: ${pin.capabilities.join(', ')}`,
            documentation: `Board pin with capabilities: ${pin.capabilities.join(', ')}`
        }));
    }

    private getImportCompletions(context: any): CompletionItem[] {
        return moduleRegistry.modules.map(module => ({
            label: module.name,
            kind: 'module',
            detail: `import ${module.name}`,
            documentation: module.description
        }));
    }

    private getWordAtPosition(line: string, character: number): { start: number; end: number } | null {
        const wordRegex = /[a-zA-Z_][a-zA-Z0-9_]*/g;
        let match;
        
        while ((match = wordRegex.exec(line)) !== null) {
            if (match.index <= character && character <= match.index + match[0].length) {
                return {
                    start: match.index,
                    end: match.index + match[0].length
                };
            }
        }
        
        return null;
    }

    private parseHoverContext(word: string, line: string, previousLines: string[]): any {
        // Simplified context parsing
        if (line.includes('board.')) {
            return { type: 'board_pin', pinName: word };
        }
        if (line.includes('.')) {
            const parts = line.split('.');
            const moduleIndex = parts.findIndex(p => p.includes(word)) - 1;
            if (moduleIndex >= 0) {
                return { 
                    type: 'member',
                    moduleName: parts[moduleIndex],
                    memberName: word
                };
            }
        }
        // Check if word is a module name
        if (this.getModule(word)) {
            return { type: 'module', moduleName: word };
        }
        return { type: 'unknown' };
    }

    private parseFunctionCallContext(beforeCursor: string, previousLines: string[]): any {
        // Find function call pattern: module.function(
        const match = beforeCursor.match(/(\w+)\.(\w+)\([^)]*$/);
        if (match) {
            const parameterIndex = (beforeCursor.match(/,/g) || []).length;
            return {
                moduleName: match[1],
                functionName: match[2],
                parameterIndex
            };
        }
        return null;
    }

    private formatMemberHover(member: any): string {
        let content = `**${member.name}**`;
        if (member.type === 'function') {
            content += `\n\n\`\`\`python\n${this.formatSignature(member)}\n\`\`\``;
        }
        if (member.description) {
            content += `\n\n${member.description}`;
        }
        if (member.example) {
            content += `\n\n**Example:**\n\`\`\`python\n${member.example}\n\`\`\``;
        }
        return content;
    }

    private formatPinHover(pin: any): string {
        let content = `**${pin.name}**`;
        if (pin.aliases && pin.aliases.length > 0) {
            content += ` (${pin.aliases.join(', ')})`;
        }
        content += `\n\nCapabilities: ${pin.capabilities.join(', ')}`;
        return content;
    }

    private formatSignature(member: any): string {
        const params = member.parameters?.map((p: any) => {
            let param = p.name;
            if (p.type) param += `: ${p.type}`;
            if (p.default !== undefined) param += ` = ${p.default}`;
            return param;
        }).join(', ') || '';
        
        return `${member.name}(${params})`;
    }

    private extractPinReferences(line: string): Array<{ name: string; start: number; end: number }> {
        const pinRefs: Array<{ name: string; start: number; end: number }> = [];
        const boardPinRegex = /board\.(\w+)/g;
        let match;
        
        while ((match = boardPinRegex.exec(line)) !== null) {
            pinRefs.push({
                name: match[1],
                start: match.index + 6, // After "board."
                end: match.index + match[0].length
            });
        }
        
        return pinRefs;
    }

    private extractModuleUsage(line: string): Array<{ module: string; start: number; end: number }> {
        const usage: Array<{ module: string; start: number; end: number }> = [];
        
        // Look for module usage patterns (simplified)
        for (const module of moduleRegistry.modules) {
            const regex = new RegExp(`\\b${module.name}\\.`, 'g');
            let match;
            
            while ((match = regex.exec(line)) !== null) {
                usage.push({
                    module: module.name,
                    start: match.index,
                    end: match.index + module.name.length
                });
            }
        }
        
        return usage;
    }

    private isValidPin(pinName: string): boolean {
        if (!this.currentBoard) return true; // No validation without board
        
        return this.currentBoard.pins.some(pin => 
            pin.name === pinName || pin.aliases?.includes(pinName)
        );
    }

    private isModuleImported(moduleName: string, previousLines: string[]): boolean {
        const importRegex = new RegExp(`import\\s+${moduleName}|from\\s+${moduleName}\\s+import`);
        return previousLines.some(line => importRegex.test(line));
    }
}