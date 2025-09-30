/**
 * Progress Helper
 *
 * Provides convenient wrappers for VS Code progress API.
 * Shows user feedback for long-running operations.
 *
 * Follows VS Code API patterns from EXT-APP-ARCHITECTURE.md
 */

import * as vscode from 'vscode';

/**
 * Progress location options
 */
export enum ProgressLocation {
  Notification = vscode.ProgressLocation.Notification,
  Window = vscode.ProgressLocation.Window,
  SourceControl = vscode.ProgressLocation.SourceControl
}

/**
 * Progress step callback
 */
export type ProgressCallback = (
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
) => Promise<void>;

/**
 * Progress step definition
 */
export interface ProgressStep {
  message: string;
  increment: number;
  action: () => Promise<void>;
}

/**
 * Show progress with notification
 *
 * @param title - Progress title
 * @param callback - Async operation to perform
 * @param cancellable - Whether operation can be cancelled
 */
export async function withProgress<T>(
  title: string,
  callback: ProgressCallback,
  cancellable: boolean = false
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable
    },
    callback
  );
}

/**
 * Show progress in window status bar
 *
 * @param title - Progress title
 * @param callback - Async operation to perform
 */
export async function withWindowProgress<T>(
  title: string,
  callback: ProgressCallback
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title
    },
    callback
  );
}

/**
 * Show progress with multiple steps
 *
 * @param title - Progress title
 * @param steps - Array of progress steps
 * @param cancellable - Whether operation can be cancelled
 */
export async function withSteps(
  title: string,
  steps: ProgressStep[],
  cancellable: boolean = false
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable
    },
    async (progress, token) => {
      for (const step of steps) {
        // Check for cancellation
        if (token.isCancellationRequested) {
          throw new Error('Operation cancelled by user');
        }

        // Report progress
        progress.report({
          message: step.message,
          increment: step.increment
        });

        // Execute step
        await step.action();
      }
    }
  );
}

/**
 * Show indeterminate progress (no percentage)
 *
 * @param title - Progress title
 * @param message - Progress message
 * @param action - Async operation to perform
 */
export async function withIndeterminate(
  title: string,
  message: string,
  action: () => Promise<void>
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title
    },
    async (progress) => {
      progress.report({ message });
      await action();
    }
  );
}

/**
 * Progress builder for complex operations
 *
 * Example:
 *   await new ProgressBuilder('Downloading Bundle')
 *     .addStep('Fetching metadata', 10, async () => { ... })
 *     .addStep('Downloading files', 60, async () => { ... })
 *     .addStep('Extracting', 20, async () => { ... })
 *     .addStep('Finalizing', 10, async () => { ... })
 *     .run();
 */
export class ProgressBuilder {
  private title: string;
  private steps: ProgressStep[] = [];
  private cancellable: boolean = false;
  private location: vscode.ProgressLocation = vscode.ProgressLocation.Notification;

  constructor(title: string) {
    this.title = title;
  }

  /**
   * Add a progress step
   */
  addStep(message: string, increment: number, action: () => Promise<void>): this {
    this.steps.push({ message, increment, action });
    return this;
  }

  /**
   * Make progress cancellable
   */
  setCancellable(cancellable: boolean = true): this {
    this.cancellable = cancellable;
    return this;
  }

  /**
   * Set progress location
   */
  setLocation(location: vscode.ProgressLocation): this {
    this.location = location;
    return this;
  }

  /**
   * Run the progress
   */
  async run(): Promise<void> {
    await vscode.window.withProgress(
      {
        location: this.location,
        title: this.title,
        cancellable: this.cancellable
      },
      async (progress, token) => {
        for (const step of this.steps) {
          // Check for cancellation
          if (token.isCancellationRequested) {
            throw new Error('Operation cancelled by user');
          }

          // Report progress
          progress.report({
            message: step.message,
            increment: step.increment
          });

          // Execute step
          await step.action();
        }
      }
    );
  }
}

/**
 * Common progress patterns for extension operations
 */
export const CommonProgress = {
  /**
   * Show progress for Python environment setup
   */
  async pythonSetup(steps: {
    createVenv?: () => Promise<void>;
    installPip?: () => Promise<void>;
    installPackages?: () => Promise<void>;
    validate?: () => Promise<void>;
  }): Promise<void> {
    const builder = new ProgressBuilder('Setting up Python Environment')
      .setCancellable(false);

    if (steps.createVenv) {
      builder.addStep('Creating virtual environment', 30, steps.createVenv);
    }
    if (steps.installPip) {
      builder.addStep('Upgrading pip', 20, steps.installPip);
    }
    if (steps.installPackages) {
      builder.addStep('Installing packages', 40, steps.installPackages);
    }
    if (steps.validate) {
      builder.addStep('Validating environment', 10, steps.validate);
    }

    await builder.run();
  },

  /**
   * Show progress for bundle download
   */
  async bundleDownload(steps: {
    fetchMetadata?: () => Promise<void>;
    download?: () => Promise<void>;
    extract?: () => Promise<void>;
    index?: () => Promise<void>;
  }): Promise<void> {
    const builder = new ProgressBuilder('Downloading CircuitPython Bundle')
      .setCancellable(true);

    if (steps.fetchMetadata) {
      builder.addStep('Fetching bundle information', 10, steps.fetchMetadata);
    }
    if (steps.download) {
      builder.addStep('Downloading bundle', 50, steps.download);
    }
    if (steps.extract) {
      builder.addStep('Extracting libraries', 30, steps.extract);
    }
    if (steps.index) {
      builder.addStep('Indexing libraries', 10, steps.index);
    }

    await builder.run();
  },

  /**
   * Show progress for library installation
   */
  async libraryInstall(libraryName: string, action: () => Promise<void>): Promise<void> {
    await withIndeterminate(
      'Installing Library',
      `Installing ${libraryName}...`,
      action
    );
  },

  /**
   * Show progress for workspace creation
   */
  async workspaceCreate(workspaceName: string, steps: {
    createDirectory?: () => Promise<void>;
    createStructure?: () => Promise<void>;
    writeSettings?: () => Promise<void>;
    createFiles?: () => Promise<void>;
  }): Promise<void> {
    const builder = new ProgressBuilder(`Creating Workspace: ${workspaceName}`)
      .setCancellable(false);

    if (steps.createDirectory) {
      builder.addStep('Creating workspace directory', 25, steps.createDirectory);
    }
    if (steps.createStructure) {
      builder.addStep('Setting up folder structure', 25, steps.createStructure);
    }
    if (steps.writeSettings) {
      builder.addStep('Writing configuration files', 25, steps.writeSettings);
    }
    if (steps.createFiles) {
      builder.addStep('Creating initial files', 25, steps.createFiles);
    }

    await builder.run();
  },

  /**
   * Show progress for device connection
   */
  async deviceConnect(deviceName: string, action: () => Promise<void>): Promise<void> {
    await withIndeterminate(
      'Connecting to Device',
      `Connecting to ${deviceName}...`,
      action
    );
  },

  /**
   * Show progress for file sync
   */
  async fileSync(fileCount: number, action: () => Promise<void>): Promise<void> {
    await withIndeterminate(
      'Syncing Files',
      `Syncing ${fileCount} file${fileCount !== 1 ? 's' : ''} to device...`,
      action
    );
  }
};
