# Bundle Manager Testing Guide

## Overview

The `CircuitPythonBundleManager` handles downloading and managing CircuitPython libraries using `circup` (the official CircuitPython library manager). Testing bundle operations requires understanding how the manager interacts with Python/circup.

## Architecture

The BundleManager uses:
- **Node.js `child_process.spawn()`** to execute Python commands
- **`python -m circup`** to run circup commands
- **VS Code file system APIs** for reading/writing files
- **Persistent storage** for module lists and caching

## Testing Approach

### Integration Tests (Preferred)

Integration tests are located in `test/integration/activation-setup.test.ts` and test:
- ✅ Persistent module list creation/loading
- ✅ Bundle installation detection
- ✅ Requirements.txt operations
- ✅ Module list refresh timing

**Status**: All 18 activation tests passing

### Unit Tests (Complex)

Unit testing the BundleManager in isolation is challenging because:
1. The extension is bundled (Vite), making imports complex
2. Mocking `child_process.spawn` requires complex event emitter mocking
3. Testing circup integration requires either:
   - Network access (slow, unreliable)
   - Complex mocking of circup output
   - An actual Python environment with circup installed

### Manual Testing

For testing bundle download and circup operations manually:

1. **Test circup installation**:
   ```typescript
   const bundleManager = new CircuitPythonBundleManager(context);
   bundleManager.setPythonPath('/path/to/python');
   await bundleManager.downloadAndInstallBundle();
   ```

2. **Test library installation**:
   ```typescript
   await bundleManager.installLibraryWithCircup('neopixel', '/path/to/workspace/lib');
   ```

3. **Test module list refresh**:
   ```typescript
   const shouldRefresh = await bundleManager.shouldRefreshBundle();
   if (shouldRefresh) {
       await bundleManager.refreshModulesList();
   }
   ```

## Key Methods and Their Commands

### Download and Install Bundle
```typescript
downloadAndInstallBundle()
```
Executes:
- `python -m circup bundle-show --modules` - Get list of available modules
- Saves module list to persistent storage

### Install Library
```typescript
installLibraryWithCircup(libraryName, targetPath)
```
Executes:
- `python -m circup --path <targetPath> install <libraryName>`

### Update Libraries
```typescript
updateLibrariesWithCircup(targetPath)
```
Executes:
- `python -m circup --path <targetPath> update --all`

### Install from Requirements
```typescript
installFromRequirements()
```
Executes:
- `python -m circup install -r <requirementsPath> --path <libPath>`

## Testing Circup Commands Directly

You can test circup commands directly from the terminal:

```bash
# Activate venv
cd /path/to/extension
source venv/bin/activate  # or venv\Scripts\activate on Windows

# Test circup
circup --version
circup bundle-show --modules
circup install neopixel --path ./test-workspace/lib
circup update --all --path ./test-workspace/lib
```

## Future Testing Enhancements

1. **Mock child_process.spawn** for unit tests
2. **Create fixture files** with sample circup output
3. **Add integration tests** for specific bundle operations:
   - Library installation
   - Library updates
   - Requirements file processing
4. **Performance tests** for large bundle downloads

## Related Files

- `src/workspace/integration/bundleManager.ts` - BundleManager implementation
- `test/integration/activation-setup.test.ts` - Integration tests (18 passing)
- `src/utils/simpleVenv.ts` - Python venv setup
- `requirements.txt` - Python dependencies including circup

## Testing Status

- ✅ **Integration Tests**: 18/18 passing
- ⏸️  **Unit Tests**: Deferred due to bundling complexity
- ✅ **Manual Testing**: Documented above
