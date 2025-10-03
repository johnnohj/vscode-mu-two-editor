# Integration Tests

This directory contains integration tests for the Mu Two Editor extension.

## Test Organization

### Core Extension Tests

- **activation-setup.test.ts** - ⭐ NEW - Comprehensive activation testing
  - First-time activation (clean install simulation)
  - Directory structure creation and verification
  - Python venv setup validation
  - CircuitPython bundle download/deployment
  - Subsequent activation (existing setup)
  - Resource cleanup and error recovery

- **extension.integration.test.ts** - Basic extension metadata
  - Package.json configuration
  - Command registration
  - Activation events
  - Dependencies

### UI Component Tests

- **custom-editor.test.ts** - Custom editor provider
- **custom-editor-functionality.test.ts** - Editor features
- **panel-controls.test.ts** - Panel show/hide controls
- **repl-panel-functionality.test.ts** - REPL panel features
- **webview-communication.test.ts** - Extension ↔ Webview messaging
- **status-bar.test.ts** - Status bar indicators

### Workspace & Storage Tests

- **workspace-management.test.ts** - Workspace operations
- **workspace.integration.test.ts** - Workspace integration
- **storage-operations.test.ts** - File system operations
- **file-operations.test.ts** - File handling
- **project-manager.test.ts** - Project management

## Running Tests

### Run All Integration Tests
```bash
npm run test:integration
```

### Run Specific Test Suite
```bash
npm test -- --grep "Activation Setup"
```

### Run in VS Code
1. Open the Run and Debug panel (Ctrl+Shift+D)
2. Select "Extension Tests"
3. Press F5

## Test Requirements

- **Timeout**: Most tests use 30-120 second timeouts due to:
  - Extension activation
  - Venv creation
  - Bundle downloads
  - File system operations

- **Environment**: Tests run in a VS Code Extension Development Host
  - Clean profile per test run
  - Isolated global storage
  - Fresh extension activation

## Writing New Tests

### Structure
```typescript
suite('Feature Name Tests', () => {
	let extension: vscode.Extension<any>;

	suiteSetup(async function() {
		this.timeout(30000);
		extension = vscode.extensions.getExtension('mu-two.mu-two-editor')!;
		if (!extension.isActive) {
			await extension.activate();
		}
	});

	test('Should do something', async function() {
		this.timeout(10000);
		// Test implementation
	});
});
```

### Best Practices

1. **Use descriptive test names** - "Should create venv directory" not "Test 1"
2. **Set appropriate timeouts** - File I/O and downloads need time
3. **Handle async operations** - Use async/await consistently
4. **Log warnings for optional features** - Use `console.warn()` for features that may not be ready
5. **Verify directory existence before reading** - Check with `fs.stat()` first
6. **Clean up resources** - Use `suiteTeardown()` when needed

### Common Patterns

#### Verify Directory Exists
```typescript
const dirUri = vscode.Uri.joinPath(globalStorageUri, 'resources');
try {
	const stat = await vscode.workspace.fs.stat(dirUri);
	assert.ok(stat.type === vscode.FileType.Directory);
} catch (error) {
	assert.fail(`Directory should exist: ${error}`);
}
```

#### Verify File Contents
```typescript
const fileUri = vscode.Uri.joinPath(globalStorageUri, 'config', 'settings.json');
const content = await vscode.workspace.fs.readFile(fileUri);
const data = JSON.parse(new TextDecoder().decode(content));
assert.ok(data.version, 'Should have version field');
```

#### Test Command Registration
```typescript
const commands = await vscode.commands.getCommands(true);
assert.ok(commands.includes('muTwo.myCommand'), 'Command should be registered');
```

## Debugging Failed Tests

1. **Check Output Panel** - "Mu Two" channel for extension logs
2. **Check Test Output** - VS Code Test Results view
3. **Enable verbose logging** - Set `muTwo.dev.logLevel` to "DEBUG"
4. **Check global storage** - Verify files were created correctly
5. **Run tests individually** - Isolate failing test

## CI/CD Integration

Tests are run automatically on:
- Pull requests
- Commits to main branch
- Release builds

### GitHub Actions
See `.github/workflows/test.yml` for CI configuration.

## Troubleshooting

### Tests Timeout
- Increase timeout in `suiteSetup()` or individual tests
- Check network connectivity for bundle downloads
- Verify disk space for venv creation

### Extension Not Activating
- Check `extension.integration.test.ts` passes first
- Verify package.json activation events
- Check extension logs for errors

### Directory Not Found
- Ensure `globalStorageUri` is correctly set
- Check OS-specific path separators
- Verify permissions on global storage directory

### Flaky Tests
- Add wait delays after async operations
- Check for race conditions
- Verify cleanup between test runs
