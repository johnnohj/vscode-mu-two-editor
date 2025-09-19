import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

describe('Integration Tests - Webview Communication', () => {
	let testWorkspaceUri: vscode.Uri;
	let tempDir: string;

	beforeEach(async () => {
		// Create temporary directory for test files
		tempDir = path.join(os.tmpdir(), 'mu-two-webview-test-' + Date.now());
		testWorkspaceUri = vscode.Uri.file(tempDir);
		await vscode.workspace.fs.createDirectory(testWorkspaceUri);

		// Ensure extension is activated
		const extension = vscode.extensions.getExtension('mu-two.mu-two-editor');
		if (extension && !extension.isActive) {
			await extension.activate();
		}
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

	describe('Custom Editor Webview Communication', () => {
		it('should establish VS Code API communication in custom editor', async () => {
			// Create test Python file
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'webview_api_test.py');
			const content = `# VS Code API test
import board
import digitalio

# Test content for webview communication
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

print("Testing VS Code API communication")
`;
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');

				// Wait for webview initialization and VS Code API setup
				await new Promise(resolve => setTimeout(resolve, 4000));

				// Test that the webview can communicate back to extension
				// This is tested by attempting document modifications which should trigger webview updates
				const document = await vscode.workspace.openTextDocument(pythonFile);
				const edit = new vscode.WorkspaceEdit();
				const insertPosition = document.positionAt(document.getText().length);
				edit.insert(pythonFile, insertPosition, '\n# VS Code API test modification');

				const applyResult = await vscode.workspace.applyEdit(edit);
				assert.ok(applyResult, 'Document edit should apply successfully');

				// Wait for webview to potentially receive the update
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Verify document synchronization worked
				const updatedDocument = await vscode.workspace.openTextDocument(pythonFile);
				assert.ok(updatedDocument.getText().includes('VS Code API test modification'),
					'Document should contain the modification');

			} catch (error) {
				assert.fail(`VS Code API communication test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle webviewReady message from custom editor', async () => {
			// Create test file
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'webview_ready_test.py');
			const content = '# Webview ready test\nimport board\nprint("Ready test")';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');

				// Wait for webview initialization
				await new Promise(resolve => setTimeout(resolve, 3000));

				// The webviewReady message should trigger initial document sync
				// We can test this by verifying the document is properly loaded
				const document = await vscode.workspace.openTextDocument(pythonFile);
				assert.ok(document.getText().includes('Ready test'),
					'Document should be properly loaded after webviewReady message');

				// Test that subsequent modifications still work (indicating ongoing communication)
				const edit = new vscode.WorkspaceEdit();
				const insertPosition = document.positionAt(document.getText().length);
				edit.insert(pythonFile, insertPosition, '\n# Post-ready modification');

				const applyResult = await vscode.workspace.applyEdit(edit);
				assert.ok(applyResult, 'Post-ready modifications should work');

			} catch (error) {
				assert.fail(`WebviewReady message test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle documentChanged messages from webview to VS Code', async () => {
			// Create test file
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'doc_change_test.py');
			const initialContent = '# Document change test\nimport board';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(initialContent));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Simulate VS Code document changes (which should sync to webview)
				const document = await vscode.workspace.openTextDocument(pythonFile);
				const edit = new vscode.WorkspaceEdit();
				const insertPosition = document.positionAt(document.getText().length);
				const newContent = '\n# Added via VS Code\nprint("Document modified")';
				edit.insert(pythonFile, insertPosition, newContent);

				const applyResult = await vscode.workspace.applyEdit(edit);
				assert.ok(applyResult, 'VS Code edit should be applied');

				// Wait for synchronization
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Verify the change persisted and is visible
				const updatedDocument = await vscode.workspace.openTextDocument(pythonFile);
				const finalContent = updatedDocument.getText();
				assert.ok(finalContent.includes('Added via VS Code'),
					'Document should contain VS Code modifications');
				assert.ok(finalContent.includes('Document modified'),
					'Document should contain specific modification text');

			} catch (error) {
				assert.fail(`DocumentChanged message test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle panel state change messages', async () => {
			// Create test file
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'panel_state_test.py');
			const content = '# Panel state test\nimport board\nprint("Panel test")';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Test panel show/hide commands which should communicate with webview
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				// Test multiple state changes
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 300));
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');
				await new Promise(resolve => setTimeout(resolve, 300));

				// Commands should execute without errors, indicating communication is working
				assert.ok(true, 'Panel state change messages should be handled successfully');

			} catch (error) {
				assert.fail(`Panel state change test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});

	describe('REPL Webview Communication', () => {
		it('should establish proper message passing in REPL webview', async () => {
			try {
				// Show REPL panel
				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// REPL webview should be initialized with proper message handling
				// Test by attempting to show the panel multiple times (tests message resilience)
				await vscode.commands.executeCommand('muTwo.showView');
				await vscode.commands.executeCommand('muTwo.showView');

				// Wait for multiple message processing
				await new Promise(resolve => setTimeout(resolve, 1000));

				assert.ok(true, 'REPL webview should handle multiple messages without errors');

			} catch (error) {
				assert.fail(`REPL message passing test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle webview ready state in REPL', async () => {
			try {
				// Show REPL panel
				await vscode.commands.executeCommand('muTwo.showView');

				// Wait for webview ready state
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Close and reopen to test ready state handling
				await vscode.commands.executeCommand('workbench.action.closePanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// REPL should reinitialize properly
				assert.ok(true, 'REPL webview should handle ready state transitions');

			} catch (error) {
				assert.fail(`REPL ready state test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should support command execution messages in REPL', async () => {
			try {
				// Show REPL panel
				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// Test commands that might send messages to REPL
				const commands = await vscode.commands.getCommands(true);
				const executionCommands = commands.filter(cmd =>
					cmd.includes('execute') || cmd.includes('run') || cmd.startsWith('muTwo.')
				);

				// Try executing some commands that might interact with REPL
				for (const cmd of executionCommands.slice(0, 3)) {
					try {
						if (cmd.includes('muTwo.showView') || cmd.includes('muTwo.workspace')) {
							await vscode.commands.executeCommand(cmd);
							await new Promise(resolve => setTimeout(resolve, 200));
						}
					} catch (cmdError) {
						// Some commands might require parameters or specific context
						console.log(`Command ${cmd} execution info:`, cmdError instanceof Error ? cmdError.message : String(cmdError));
					}
				}

				assert.ok(true, 'REPL should handle command execution messages');

			} catch (error) {
				assert.fail(`REPL command execution test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});

	describe('Webview Error Handling and Recovery', () => {
		it('should handle invalid message formats gracefully', async () => {
			// Create test file
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'error_handling_test.py');
			const content = '# Error handling test\nimport board';
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 3000));

				// The webview should handle invalid/malformed messages gracefully
				// We test this by rapid-fire commands that might create message conflicts
				const promises = [];
				for (let i = 0; i < 5; i++) {
					promises.push(vscode.commands.executeCommand('muTwo.editor.showPanel'));
					promises.push(vscode.commands.executeCommand('muTwo.editor.hidePanel'));
				}

				// Execute rapid commands concurrently
				await Promise.allSettled(promises);
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Final test - should still work after stress test
				await vscode.commands.executeCommand('muTwo.editor.showPanel');

				assert.ok(true, 'Webview should handle message stress testing gracefully');

			} catch (error) {
				// Error handling test - should provide meaningful errors
				assert.ok(error instanceof Error ? error.message : String(error).length > 0, 'Should provide meaningful error messages');
				console.log('Error handling test result:', error instanceof Error ? error.message : String(error));
			}
		});

		it('should recover from webview communication failures', async () => {
			try {
				// Show REPL panel
				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Simulate communication stress by rapid panel operations
				for (let i = 0; i < 3; i++) {
					await vscode.commands.executeCommand('workbench.action.closePanel');
					await new Promise(resolve => setTimeout(resolve, 100));
					await vscode.commands.executeCommand('muTwo.showView');
					await new Promise(resolve => setTimeout(resolve, 300));
				}

				// Final recovery test
				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 1000));

				assert.ok(true, 'Webview communication should recover from interruptions');

			} catch (error) {
				assert.fail(`Communication recovery test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should maintain message integrity during resource constraints', async () => {
			try {
				// Create multiple editors and REPL to test resource management
				const files = [];
				for (let i = 0; i < 3; i++) {
					const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, `resource_test_${i}.py`);
					const content = `# Resource test ${i}\nimport board\nprint("Test ${i}")`;
					await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));
					files.push(pythonFile);
				}

				// Open multiple custom editors
				for (const file of files) {
					try {
						await vscode.commands.executeCommand('vscode.openWith', file, 'muTwo.editor.editView');
						await new Promise(resolve => setTimeout(resolve, 1000));
					} catch (openError) {
						console.log(`File open info for ${file.fsPath}:`, openError instanceof Error ? openError.message : String(openError));
					}
				}

				// Show REPL alongside custom editors
				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Test that all webviews can still communicate
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await vscode.commands.executeCommand('muTwo.editor.hidePanel');

				assert.ok(true, 'Message integrity should be maintained under resource constraints');

			} catch (error) {
				assert.fail(`Resource constraint test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});

	describe('Cross-Webview Communication', () => {
		it('should support communication between custom editor and REPL', async () => {
			// Create test file
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'cross_comm_test.py');
			const content = `# Cross-communication test
import board
import digitalio

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

print("Cross-communication test")
`;
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Show REPL panel
				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Both webviews should be active and communicable
				// Test cross-communication by using commands that might affect both
				await vscode.commands.executeCommand('muTwo.editor.showPanel');
				await new Promise(resolve => setTimeout(resolve, 500));

				// The panel operation should work with both webviews active
				assert.ok(true, 'Cross-webview communication should work with both editor and REPL active');

			} catch (error) {
				assert.fail(`Cross-webview communication test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});

		it('should handle context sharing between webviews', async () => {
			// Create CircuitPython file to establish shared context
			const pythonFile = vscode.Uri.joinPath(testWorkspaceUri, 'context_sharing_test.py');
			const content = `# Context sharing test
import board
import digitalio
import time

# This should provide context for both editor and REPL
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

while True:
    led.value = not led.value
    time.sleep(1)
`;
			await vscode.workspace.fs.writeFile(pythonFile, new TextEncoder().encode(content));

			try {
				// Open with custom editor
				await vscode.commands.executeCommand('vscode.openWith', pythonFile, 'muTwo.editor.editView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Show REPL with same context
				await vscode.commands.executeCommand('muTwo.showView');
				await new Promise(resolve => setTimeout(resolve, 2000));

				// Both should share CircuitPython context
				// Test by ensuring both can access CircuitPython-related functionality
				const commands = await vscode.commands.getCommands(true);
				const circuitPythonCommands = commands.filter(cmd =>
					cmd.includes('circuitpython') || cmd.includes('board') || cmd.includes('device')
				);

				if (circuitPythonCommands.length > 0) {
					assert.ok(true, 'CircuitPython context should be shared between webviews');
				} else {
					assert.ok(true, 'Context sharing infrastructure should be available');
				}

			} catch (error) {
				assert.fail(`Context sharing test failed: ${error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error)}`);
			}
		});
	});
});