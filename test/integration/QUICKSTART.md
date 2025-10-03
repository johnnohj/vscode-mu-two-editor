# Quick Start: Running Activation Tests in VS Code

## Current Status

✅ Test files created and ready
✅ VS Code launch configurations added
❌ Blocked by TypeScript compilation errors in main source

## What You Need

The VS Code Test Runner is already configured in `.vscode/launch.json`. However, tests cannot run yet because of pre-existing TypeScript errors in the source code.

## Option 1: Run Via VS Code (RECOMMENDED - When TypeScript Errors Fixed)

### Setup
1. Open VS Code
2. Open Run and Debug panel (Ctrl+Shift+D or Cmd+Shift+D)
3. Select one of the test configurations from dropdown:
   - **"Extension Tests"** - Run all integration tests
   - **"Activation Tests Only"** - Run only activation-setup tests

### Run Tests
1. Press **F5** or click the green play button
2. A new VS Code window opens (Extension Development Host)
3. Tests run automatically
4. View results in:
   - Debug Console (original window)
   - Output panel → "Extension Host Test Results"
   - Test Explorer sidebar

### What Happens
- Pre-launch task `build: tests` runs (builds extension)
- New VS Code instance launches with extension loaded
- Tests execute in the extension host
- Results displayed in test runner UI

## Option 2: Manual Verification (WORKS NOW)

Since automated tests can't run yet, you can manually verify the activation:

### Steps
1. **Build Extension**
   ```bash
   npm run build-all
   ```

2. **Launch Extension Development Host**
   - Press F5 with "Run Extension" configuration
   - OR: Run > Start Debugging

3. **Verify Directory Structure**
   - Open File Explorer
   - Navigate to global storage:
     - **Windows**: `%APPDATA%\Code\User\globalStorage\mu-two.mu-two-editor`
     - **macOS**: `~/Library/Application Support/Code/User/globalStorage/mu-two.mu-two-editor`
     - **Linux**: `~/.config/Code/User/globalStorage/mu-two.mu-two-editor`

4. **Check Expected Directories**
   ```
   globalStorage/mu-two.mu-two-editor/
   ├── .mu2/
   │   ├── data/
   │   └── logs/                ← Should contain mu2-dev-YYYY-MM-DD.log
   ├── bin/
   │   └── wasm-runtime/
   ├── bundles/
   ├── config/
   ├── resources/              ← Should contain circuitpython-modules.json (when created)
   └── workspaces/
       └── registry/
   ```

5. **Check Logs**
   - Open `.mu2/logs/mu2-dev-YYYY-MM-DD.log`
   - Look for activation messages:
     ```
     [EXTENSION] Starting simplified Mu 2 Extension activation...
     [ACTIVATION] Initializing Python environment manager...
     [ACTIVATION] Essential services initialized
     ```

6. **Check Python venv** (if created)
   - Navigate to extension installation:
     - Windows: `%USERPROFILE%\.vscode\extensions\mu-two.mu-two-editor-*\venv`
   - Verify:
     - `Scripts/python.exe` (Windows) or `bin/python` (Unix)
     - `Lib/site-packages` or `lib/site-packages`

7. **Check Commands**
   - Press Ctrl+Shift+P (Cmd+Shift+P on macOS)
   - Type "Mu Two"
   - Verify commands are registered:
     - "Mu Two: Create Workspace"
     - "Mu Two: Open Workspace"
     - "Mu Two: Show Connected REPL"
     - etc.

## Option 3: Fix TypeScript Errors (For Full Automation)

To enable automated test execution:

### Approach A: Relax TypeScript Strictness
Edit `test/tsconfig.json`:
```json
{
  "compilerOptions": {
    "strict": false,
    "noImplicitAny": false,
    "skipLibCheck": true
  }
}
```

### Approach B: Skip Source Files
Modify `test:compile` in `package.json`:
```json
{
  "scripts": {
    "test:compile": "npm run build-all"
  }
}
```

This uses the existing Vite build instead of TypeScript compiler.

### Approach C: Fix Source Code Type Errors
Address the ~150 TypeScript errors in:
- `src/devices/`
- `src/providers/`
- `src/workspace/`

## What VS Code Test Runner Needs

✅ **launch.json** - Test configurations (DONE)
```json
{
  "name": "Extension Tests",
  "type": "extensionHost",
  "args": [
    "--extensionDevelopmentPath=${workspaceFolder}",
    "--extensionTestsPath=${workspaceFolder}/out/test/integration/index"
  ]
}
```

✅ **tasks.json** - Build task (DONE)
```json
{
  "label": "build: tests",
  "command": "npm",
  "args": ["run", "build-all"]
}
```

❌ **Compiled Test Files** - In `out/test/` (BLOCKED)
- Needs: TypeScript compilation to succeed
- Currently: Fails with source code type errors

✅ **Test Entry Point** - `test/integration/index.ts` (EXISTS)
- Already configured by existing tests
- Mocha test runner setup

## Expected Test Results (When Runnable)

### First Run (Clean Install)
```
✓ Extension should activate successfully
✓ Should create global storage directory structure (10 directories)
✓ Should create development log file
✓ Should verify ResourceLocator paths
⚠ Should have venv directory (may not exist yet)
⚠ Should have Python executable (may not exist yet)
⚠ Should have CircuitPython module list (created on-demand)
✓ Should have bundles directory ready
```

### Subsequent Runs
```
✓ Should activate faster with existing setup
✓ Should preserve existing module list
✓ Should not recreate existing directories
✓ Should verify all core commands remain registered
```

## Troubleshooting

### "Cannot find module" errors
- Run `npm run build-all` first
- Ensure `dist/` directory has compiled extension

### "Extension not found" error
- Check extension is in `.vscode/extensions/`
- Verify `package.json` has correct publisher/name

### Tests don't appear in Test Explorer
- Ensure Test Explorer extension is installed
- Reload VS Code window
- Check Output → Test Results channel

### Extension doesn't activate in test
- Check extension activationEvents in `package.json`
- Verify `dist/extension.js` exists
- Check Developer Tools Console for errors

## Next Steps

1. Choose one of the options above
2. Manually verify activation (Option 2) works now
3. Fix TypeScript issues to enable automated testing
4. Run full test suite
5. Add to CI/CD pipeline

## Summary

**Status**: Test infrastructure is complete and ready
**Blocker**: Pre-existing TypeScript compilation errors
**Workaround**: Manual verification (works now)
**Solution**: Fix TypeScript config or source code errors
