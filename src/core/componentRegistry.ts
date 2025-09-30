/**
 * Component Registry
 *
 * Simplified component registration system.
 * Replaces the over-engineered ExtensionStateManager with a lightweight registry.
 *
 * Design principles:
 * - Simple Map-based storage
 * - No complex lifecycle management (VS Code handles that via context.subscriptions)
 * - No event emitters (not needed)
 * - Type-safe component access
 */

import * as vscode from 'vscode';

/**
 * Lightweight component registry for cross-component access
 */
export class ComponentRegistry {
    private static instance: ComponentRegistry;
    private components = new Map<string, any>();
    private readonly context: vscode.ExtensionContext;

    // Python environment state (simplified)
    private pythonVenvActivated = false;
    private pythonVenvPath?: string;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get or create singleton instance
     */
    public static getInstance(context?: vscode.ExtensionContext): ComponentRegistry {
        if (!ComponentRegistry.instance && context) {
            ComponentRegistry.instance = new ComponentRegistry(context);
        }
        if (!ComponentRegistry.instance) {
            throw new Error('ComponentRegistry not initialized with context');
        }
        return ComponentRegistry.instance;
    }

    /**
     * Register a component
     */
    public register<T>(name: string, component: T): T {
        this.components.set(name, component);
        return component;
    }

    /**
     * Get a component (throws if not found)
     */
    public get<T>(name: string): T {
        const component = this.components.get(name);
        if (!component) {
            throw new Error(`Component '${name}' not found in registry`);
        }
        return component as T;
    }

    /**
     * Try to get a component (returns undefined if not found)
     */
    public tryGet<T>(name: string): T | undefined {
        return this.components.get(name) as T | undefined;
    }

    /**
     * Check if component exists
     */
    public has(name: string): boolean {
        return this.components.has(name);
    }

    /**
     * Get extension context
     */
    public getContext(): vscode.ExtensionContext {
        return this.context;
    }

    // === Python Environment State (simplified) ===

    /**
     * Mark Python venv as activated
     */
    public setPythonVenvActivated(venvPath: string): void {
        this.pythonVenvActivated = true;
        this.pythonVenvPath = venvPath;
    }

    /**
     * Check if Python venv is activated
     */
    public isPythonVenvActivated(): boolean {
        return this.pythonVenvActivated;
    }

    /**
     * Get Python venv path
     */
    public getPythonVenvPath(): string | undefined {
        return this.pythonVenvPath;
    }
}

/**
 * Get the component registry instance
 */
export function getComponentRegistry(): ComponentRegistry {
    return ComponentRegistry.getInstance();
}
