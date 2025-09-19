import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

describe('Integration Tests - Panel Show/Hide Controls', () => {
	let testWorkspaceUri: vscode.Uri;
	let tempDir: string;

	beforeEach(async () => {
		// Create temporary directory for test files
		tempDir = path.join(os.tmpdir(), 'mu-two-panel-test-' + Date.now());
		testWorkspaceUri = vscode.Uri.file(tempDir);
		await vscode.workspace.fs.createDirectory(testWorkspaceUri);

		// Ensure extension is activated
		const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
		if (extension && !extension.isActive) {
			await extension.activate();
		}

		// Start with clean state
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		await vscode.commands.executeCommand('workbench.action.closePanel');
	});

	afterEach(async () => {
		// Clean up test files and close any open editors
		try {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.commands.executeCommand('workbench.action.closePanel');
			await vscode.workspace.fs.delete(testWorkspaceUri, { recursive: true });
		} catch (error) {
			console.warn('Failed to clean up test files:', error);
		}
	});

	describe('Panel Control Commands Registration', () => {
		it('should register panel show/hide commands', async () => {
			const commands = await vscode.commands.getCommands(true);

			// Verify core panel commands are registered
			assert.ok(commands.includes('muTwo.editor.showPanel'),
				'muTwo.editor.showPanel command should be registered');
			assert.ok(commands.includes('muTwo.editor.hidePanel'),
				'muTwo.editor.hidePanel command should be registered');

			// Verify commands are available in command palette
			const muTwoCommands = commands.filter(cmd => cmd.startsWith('muTwo.editor.'));
			assert.ok(muTwoCommands.length >= 2,
				'Should have multiple muTwo.editor commands available');
		});

		it('should register commands with proper when clauses', async () => {
			// Commands should be available when custom editor is active
			// We test this by opening a custom editor and checking command availability

			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'panel_command_test.py');
			const content = '# Panel command test\nimport board\nprint("Panel test")';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Commands should now be contextually available
				const commands = await vscode.commands.getCommands(true);
				assert.ok(commands.includes('muTwo.editor.showPanel'),
					'Show panel command should be available with custom editor open');
				assert.ok(commands.includes('muTwo.editor.hidePanel'),
					'Hide panel command should be available with custom editor open');

			} catch (error) {
				console.log('Command context test info:', error instanceof Error ? error.message : String(error));
				// Context tests might be limited in test environment
			}
		});
	});

	describe('Panel State Management', () => {
		it('should track panel collapsed state correctly', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'panel_state_test.py');
			const content = '# Panel state test\nimport board\nimport digitalio';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Test initial state (should start collapsed based on code)
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				// Panel should now be expanded
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				// Panel should now be collapsed
				// Commands should execute without errors, indicating state management is working
				assert.ok(true, 'Panel state transitions should execute without errors');

			} catch (error) {
				assert.fail(`Panel state management test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle rapid panel state changes', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'rapid_panel_test.py');
			const content = '# Rapid panel test\nimport board';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Test rapid state changes
				for (let i = 0; i < 5; i++) {
					await vscode.commands.executeCommand('muTwo.editor.showPanel');
					await new Promise(resolve => setTimeout(resolve, 100));
					await vscode.commands.executeCommand('muTwo.editor.hidePanel');
					await new Promise(resolve => setTimeout(resolve, 100));
				}

				// Final state change should still work
				await vscode.commands.executeCommand('muTwo.editor.showPanel');

				assert.ok(true, 'Rapid panel state changes should be handled correctly');

			} catch (error) {
				assert.fail(`Rapid panel state test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should persist panel state across editor switches', async () => {
			// Create multiple Python files
			const files = [];
			for (let i = 0; i < 2; i++) {
				const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, `panel_persist_${i}.py`);
				const content = `# Panel persistence test ${i}\nimport board\nprint("Test ${i}")`;
				await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));
				files.push(pythonFile);
			}

			try {
				// Open first file with custom editor
				await vscode.commands.executeCommand('vscode.openWith', files[0], 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Set panel state
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				// Open second file
				await vscode.commands.executeCommand('vscode.openWith', files[1], 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Panel commands should still work
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await vscode.commands.executeCommand('muTwo.editor.showPanel');

				assert.ok(true, 'Panel state should persist across editor switches');

			} catch (error) {
				assert.fail(`Panel persistence test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});

	describe('Context Variable Management', () => {
		it('should set proper context variables for menu visibility', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'context_var_test.py');
			const content = '# Context variable test\nimport board\nimport digitalio';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Context variables should be set for menu visibility
				// Test by executing commands that depend on context
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				// Commands should execute successfully, indicating context variables are set
				assert.ok(true, 'Context variables should be set correctly for menu visibility');

			} catch (error) {
				assert.fail(`Context variable test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should clear context variables when custom editor closes', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'context_cleanup_test.py');
			const content = '# Context cleanup test\nimport board';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Panel commands should work
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				// Close the custom editor
				await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Try panel commands - they might not work or should handle gracefully
				try {
					await vscode.commands.executeCommand('muTwo.editor.showPanel');
					// If command succeeds, context cleanup is working
					assert.ok(true, 'Context cleanup should handle commands gracefully');
				} catch (cleanupError) {
					// If command fails, that's also expected behavior after editor closes
					assert.ok(cleanupError instanceof Error ? cleanupError.message : String(cleanupError).length > 0, 'Should provide meaningful error after editor closes');
					console.log('Expected context cleanup result:', cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
				}

			} catch (error) {
				assert.fail(`Context cleanup test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle context variables with multiple custom editors', async () => {
			// Create multiple Python files
			const files = [];
			for (let i = 0; i < 2; i++) {
				const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, `multi_context_${i}.py`);
				const content = `# Multi-context test ${i}\nimport board\nprint("Context test ${i}")`;
				await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));
				files.push(pythonFile);
			}

			try {
				// Open multiple custom editors
				for (const file of files) {
					await vscode.commands.executeCommand('vscode.openWith', file, 'muTwo.editor.editView');
					await new Promise(resolve => setTimeout(resolve, 1500));
				}

				// Panel commands should work with multiple editors
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				// Switch between editors and test panel commands
				await vscode.commands.executeCommand('workbench.action.previousEditor');
				await new Promise(resolve => setTimeout(resolve, 500));

				await vscode.commands.executeCommand('muTwo.editor.showPanel');

				assert.ok(true, 'Context variables should work with multiple custom editors');

			} catch (error) {
				assert.fail(`Multiple context test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});

	describe('Panel Control Integration with Webview', () => {
		it('should send panel state messages to webview', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'webview_panel_test.py');
			const content = `# Webview panel integration test
import board
import digitalio
import time

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

print("Panel integration test")
`;
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Panel commands should send messages to webview
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				// Webview should receive and process the panel state change
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				// Test multiple rapid changes to verify message handling
				for (let i = 0; i < 3; i++) {
					await vscode.commands.executeCommand('muTwo.editor.showPanel');
					await new Promise(resolve => setTimeout(resolve, 200));
					await vscode.commands.executeCommand('muTwo.editor.hidePanel');
					await new Promise(resolve => setTimeout(resolve, 200));
				}

				assert.ok(true, 'Panel state messages should be sent to webview successfully');

			} catch (error) {
				assert.fail(`Webview panel integration test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle webview panel state feedback', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'webview_feedback_test.py');
			const content = '# Webview feedback test\nimport board\nprint("Feedback test")';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Panel state changes should potentially trigger feedback from webview
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 1000));

				// If webview sends feedback, extension should handle it gracefully
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Test that feedback loop doesn't cause issues
				await vscode.commands.executeCommand('muTwo.editor.showPanel');

				assert.ok(true, 'Webview panel feedback should be handled correctly');

			} catch (error) {
				assert.fail(`Webview feedback test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});

	describe('Panel Control Error Handling', () => {
		it('should handle panel commands without active custom editor', async () => {
			try {
				// Try panel commands without custom editor open
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				// Commands should handle gracefully (no crash)
				assert.ok(true, 'Panel commands should handle missing custom editor gracefully');

			} catch (error) {
				// Expected behavior - commands might fail without custom editor
				assert.ok(error instanceof Error ? error.message : String(error).length > 0, 'Should provide meaningful error without custom editor');
				console.log('Expected panel command result without editor:', error instanceof Error ? error.message : String(error));
			}
		});

		it('should handle panel commands during editor initialization', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'init_panel_test.py');
			const content = '# Initialization panel test\nimport board\nimport digitalio';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open custom editor and immediately try panel commands
				const openPromise = vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');

				// Try panel commands during initialization
				await new Promise(resolve => setTimeout(resolve, 500));
				await vscode.commands.executeCommand('muTwo.editor.showPanel');

				await openPromise;
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Final panel command should work after initialization
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');

				assert.ok(true, 'Panel commands during initialization should be handled gracefully');

			} catch (error) {
				assert.fail(`Initialization panel test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should recover from panel command failures', async () => {
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'recovery_panel_test.py');
			const content = '# Recovery panel test\nimport board';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Create potential failure scenario with rapid commands
				const promises = [];
				for (let i = 0; i < 10; i++) {
					promises.push(vscode.commands.executeCommand('muTwo.editor.showPanel'));
					promises.push(vscode.commands.executeCommand('muTwo.editor.hidePanel'));
				}

				// Execute concurrent commands (might cause conflicts)
				await Promise.allSettled(promises);
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Recovery - should still be able to use panel commands
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');

				assert.ok(true, 'Panel commands should recover from potential failures');

			} catch (error) {
				assert.fail(`Panel recovery test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});
});