/**
 * Resource Locator
 *
 * Single source of truth for all resource paths in the extension.
 * Implements the authoritative resource hierarchy from EXT-APP-ARCHITECTURE.md
 *
 * All paths MUST go through this class. No exceptions.
 * Uses VS Code Uri.joinPath() exclusively - never string concatenation.
 *
 * Resource Hierarchy:
 * - extensionUri/assets/              - Extension-bundled resources (read-only)
 * - extensionUri/venv/                - Python virtual environment (created once, shared)
 * - globalStorageUri/resources/bundles/         - Downloaded CircuitPython bundles (persistent cache)
 * - globalStorageUri/workspaces/      - User workspaces (persistent user data)(?)
 * - globalStorageUri/bin/wasm-runtime/ - WASM runtime binaries (persistent cache)
 * - globalStorageUri/resources/       - Generated data files (module lists, manifests)
 * - globalStorageUri/.mu2/config/          - Extension configuration (user settings)
 * - globalStorageUri/.mu2/logs/       - Development and diagnostic logs
 *
 * IMPORTANT DISTINCTIONS:
 * - resources/ = Generated/cached data (e.g., CircuitPython module lists, bundle manifests)
 * - config/ = User-modifiable settings and preferences
 * - .mu2/logs/ = Diagnostic output files (development logs, error traces)
 */

import * as vscode from 'vscode';

/**
 * Resource types for logging and documentation
 */
export enum ResourceType {
  ASSET = 'ASSET',              // Read-only bundled resources
  VENV = 'VENV',                // Python virtual environment
  BUNDLE = 'BUNDLE',            // CircuitPython library bundles
  WORKSPACE = 'WORKSPACE',      // User workspaces
  WASM = 'WASM',                // WASM runtime
  RESOURCE = 'RESOURCE',        // Generated data files
  CONFIG = 'CONFIG',            // Persistent configuration
  LOG = 'LOG'                   // Diagnostic logs
}

/**
 * Resource location patterns
 */
export interface ResourcePaths {
  assets: vscode.Uri;
  venv: vscode.Uri;
  bundles: vscode.Uri;
  workspaces: vscode.Uri;
  wasmRuntime: vscode.Uri;
  resources: vscode.Uri;
  config: vscode.Uri;
  logs: vscode.Uri;
}

/**
 * ResourceLocator - Single source of truth for all extension paths
 *
 * This class centralizes all path operations and ensures consistent
 * use of VS Code Uri.joinPath() instead of string concatenation.
 *
 * Example usage:
 *   const locator = new ResourceLocator(context);
 *   const iconPath = locator.getAssetPath('mu2-logo.svg');
 *   const venvPath = locator.getVenvPath();
 */
export class ResourceLocator {
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  /**
   * Get all resource paths
   * Useful for logging and debugging
   */
  public getAllPaths(): ResourcePaths {
    return {
      assets: this.getAssetsRoot(),
      venv: this.getVenvPath(),
      bundles: this.getBundlesRoot(),
      workspaces: this.getWorkspacesRoot(),
      wasmRuntime: this.getWasmRuntimePath(),
      resources: this.getResourcesPath(),
      config: this.getConfigPath(),
      logs: this.getLogsPath()
    };
  }

  // ========================================================================
  // CORE PATHS
  // ========================================================================

  /**
   * Get extension URI
   * Location: extensionUri/
   */
  public getExtensionUri(): vscode.Uri {
    return this.context.extensionUri;
  }

  /**
   * Get global storage URI
   * Location: globalStorageUri/
   */
  public getGlobalStorageUri(): vscode.Uri {
    return this.context.globalStorageUri;
  }

  // ========================================================================
  // EXTENSION-BUNDLED RESOURCES (READ-ONLY)
  // ========================================================================

  /**
   * Get root assets directory
   * Location: extensionUri/assets/
   */
  public getAssetsRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, 'assets');
  }

  /**
   * Get path to specific asset
   * Location: extensionUri/assets/{asset}
   *
   * @param asset - Asset filename (e.g., 'mu2-logo.svg', 'boards.json')
   */
  public getAssetPath(asset: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getAssetsRoot(), asset);
  }

  /**
   * Get board database path
   * Location: extensionUri/assets/boards.json
   */
  public getBoardDatabasePath(): vscode.Uri {
    return this.getAssetPath('boards.json');
  }

  /**
   * Get icon path
   * Location: extensionUri/assets/{icon}
   */
  public getIconPath(icon: string): vscode.Uri {
    return this.getAssetPath(icon);
  }

  // ========================================================================
  // PYTHON VIRTUAL ENVIRONMENT (CREATED ONCE, SHARED)
  // ========================================================================

  /**
   * Get Python virtual environment root
   * Location: extensionUri/venv/
   */
  public getVenvPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.extensionUri, 'venv');
  }

  /**
   * Get Python executable path
   * Platform-aware: Scripts/python.exe on Windows, bin/python on Unix
   */
  public getPythonExecutablePath(): vscode.Uri {
    const venvPath = this.getVenvPath();
    const platform = process.platform;

    if (platform === 'win32') {
      return vscode.Uri.joinPath(venvPath, 'Scripts', 'python.exe');
    } else {
      return vscode.Uri.joinPath(venvPath, 'bin', 'python');
    }
  }

  /**
   * Get site-packages directory
   * Platform-aware: Lib/site-packages on Windows, lib/pythonX.X/site-packages on Unix
   */
  public getSitePackagesPath(): vscode.Uri {
    const venvPath = this.getVenvPath();
    const platform = process.platform;

    if (platform === 'win32') {
      return vscode.Uri.joinPath(venvPath, 'Lib', 'site-packages');
    } else {
      // Note: On Unix, actual path includes Python version (e.g., python3.11)
      // This returns the base path - caller may need to resolve
      return vscode.Uri.joinPath(venvPath, 'lib', 'site-packages');
    }
  }

  /**
   * Get pip executable path
   * Platform-aware: Scripts/pip.exe on Windows, bin/pip on Unix
   */
  public getPipExecutablePath(): vscode.Uri {
    const venvPath = this.getVenvPath();
    const platform = process.platform;

    if (platform === 'win32') {
      return vscode.Uri.joinPath(venvPath, 'Scripts', 'pip.exe');
    } else {
      return vscode.Uri.joinPath(venvPath, 'bin', 'pip');
    }
  }

  // ========================================================================
  // GLOBAL STORAGE (PERSISTENT CACHE & USER DATA)
  // ========================================================================

  /**
   * Get bundles root directory
   * Location: globalStorageUri/resources/bundles/
   */
  public getBundlesRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'resources', 'bundles');
  }

  /**
   * Get CircuitPython bundle path
   * Location: globalStorageUri/bundles/circuitpython/
   */
  public getCircuitPythonBundlePath(): vscode.Uri {
    return vscode.Uri.joinPath(this.getBundlesRoot(), 'circuitpython');
  }

  /**
   * Get specific bundle version path
   * Location: globalStorageUri/bundles/circuitpython/{version}/
   */
  public getBundleVersionPath(version: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getCircuitPythonBundlePath(), version);
  }

  /**
   * Get workspaces root directory
   * Location: globalStorageUri/workspaces/
   */
  public getWorkspacesRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'workspaces');
  }

  /**
   * Get specific workspace path
   * Location: globalStorageUri/workspaces/{workspaceName}/
   */
  public getWorkspacePath(workspaceName: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getWorkspacesRoot(), workspaceName);
  }

  /**
   * Get workspace code-workspace file path
   * Location: globalStorageUri/workspaces/{workspaceName}.code-workspace
   */
  public getWorkspaceFilePath(workspaceName: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getWorkspacesRoot(), `${workspaceName}.code-workspace`);
  }

  /**
   * Get WASM runtime directory
   * Location: globalStorageUri/bin/
   */
  public getWasmRuntimePath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'bin');
  }

  /**
   * Get WASM runtime binary path
   * Location: globalStorageUri/bin/{binaryName}
   */
  public getWasmBinaryPath(binaryName: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getWasmRuntimePath(), binaryName);
  }

  /**
   * Get resources root directory (for read-only data files)
   * Location: globalStorageUri/resources/
   */
  public getResourcesPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'resources');
  }

  /**
   * Get specific resource file path
   * Location: globalStorageUri/resources/{filename}
   */
  public getResourceFilePath(filename: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getResourcesPath(), filename);
  }

  /**
   * Get configuration root directory
   * Location: globalStorageUri/config/
   */
  public getConfigPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, '.mu2', 'config');
  }

  /**
   * Get persistent module list path
   * Location: globalStorageUri/resources/circuitpython-modules.json
   */
  public getPersistentModuleListPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.getResourcesPath(), 'circuitpython-modules.json');
  }

  /**
   * Get specific config file path
   * Location: globalStorageUri/config/{filename}
   */
  public getConfigFilePath(filename: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getConfigPath(), filename);
  }

  /**
   * Get logs root directory
   * Location: globalStorageUri/.mu2/logs/
   */
  public getLogsPath(): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, '.mu2', 'logs');
  }

  /**
   * Get specific log file path
   * Location: globalStorageUri/.mu2/logs/{filename}
   */
  public getLogFilePath(filename: string): vscode.Uri {
    return vscode.Uri.joinPath(this.getLogsPath(), filename);
  }

  // ========================================================================
  // WORKSPACE-SPECIFIC PATHS
  // ========================================================================

  /**
   * Get workspace lib directory
   * Location: {workspaceUri}/lib/
   */
  public getWorkspaceLibPath(workspaceUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(workspaceUri, 'lib');
  }

  /**
   * Get workspace .vscode directory
   * Location: {workspaceUri}/.vscode/
   */
  public getWorkspaceVSCodePath(workspaceUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(workspaceUri, '.vscode');
  }

  /**
   * Get workspace settings.json path
   * Location: {workspaceUri}/.vscode/settings.json
   */
  public getWorkspaceSettingsPath(workspaceUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(this.getWorkspaceVSCodePath(workspaceUri), 'settings.json');
  }

  /**
   * Get workspace code.py path
   * Location: {workspaceUri}/code.py
   */
  public getWorkspaceCodePyPath(workspaceUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(workspaceUri, 'code.py');
  }

  /**
   * Get workspace .mu2 config directory
   * Location: {workspaceUri}/.vscode/mu2/
   */
  public getWorkspaceMu2ConfigPath(workspaceUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(this.getWorkspaceVSCodePath(workspaceUri), 'mu2');
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Check if a resource exists
   */
  public async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Ensure a directory exists (create if needed)
   */
  public async ensureDirectory(uri: vscode.Uri): Promise<void> {
    if (!await this.exists(uri)) {
      await vscode.workspace.fs.createDirectory(uri);
    }
  }

  /**
   * Get resource type for a given URI
   * Useful for logging and categorization
   */
  public getResourceType(uri: vscode.Uri): ResourceType | undefined {
    const uriStr = uri.toString();

    if (uriStr.includes('/assets/')) {return ResourceType.ASSET};
    if (uriStr.includes('/venv/')) {return ResourceType.VENV};
    if (uriStr.includes('/bundles/')) {return ResourceType.BUNDLE};
    if (uriStr.includes('/workspaces/')) {return ResourceType.WORKSPACE};
    if (uriStr.includes('/wasm-runtime/')) {return ResourceType.WASM};
    if (uriStr.includes('/resources/')) {return ResourceType.RESOURCE};
    if (uriStr.includes('/config/')) {return ResourceType.CONFIG};
    if (uriStr.includes('/.mu2/logs/')) {return ResourceType.LOG};

    return undefined;
  }

  /**
   * Log all resource paths (for debugging)
   */
  public logAllPaths(logger: (message: string) => void): void {
    const paths = this.getAllPaths();

    logger('=== Resource Locator Paths ===');
    logger(`Assets:     ${paths.assets.fsPath}`);
    logger(`Venv:       ${paths.venv.fsPath}`);
    logger(`Bundles:    ${paths.bundles.fsPath}`);
    logger(`Workspaces: ${paths.workspaces.fsPath}`);
    logger(`WASM:       ${paths.wasmRuntime.fsPath}`);
    logger(`Resources:  ${paths.resources.fsPath}`);
    logger(`Config:     ${paths.config.fsPath}`);
    logger(`Logs:       ${paths.logs.fsPath}`);
    logger('==============================');
  }
}

/**
 * Global resource locator instance
 * Initialized in extension activation
 */
let resourceLocator: ResourceLocator | undefined;

/**
 * Initialize the global resource locator
 */
export function initResourceLocator(context: vscode.ExtensionContext): ResourceLocator {
  resourceLocator = new ResourceLocator(context);
  return resourceLocator;
}

/**
 * Get the global resource locator instance
 */
export function getResourceLocator(): ResourceLocator {
  if (!resourceLocator) {
    throw new Error('ResourceLocator not initialized. Call initResourceLocator first.');
  }
  return resourceLocator;
}
