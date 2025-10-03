# Test Infrastructure Cleanup

**Date**: October 2, 2025

## Issue

The old test configuration (`test/tsconfig.json`) had `rootDir: "../"` which caused TypeScript to compile test files and emit `.js` and `.js.map` files alongside source files in the `src/` directory, creating significant clutter.

## Files Removed

### Compiled Artifacts from Source Directory
- **72 files deleted** from `src/` and subdirectories:
  - 36 `.js` files
  - 36 `.js.map` files

### Obsolete Test Configurations
- `test/tsconfig.json` - Old broken config with wrong rootDir
- `test/tsconfig.test-only.json` - Intermediate config, no longer needed

### Stale Test Output Directories
- `out/test/helpers/` - Old compilation artifacts
- `out/test/src/` - Incorrectly placed source compilations
- `out/test/test/` - Duplicate test directory
- `out/test/views/` - View compilation artifacts

## Current Clean State

### Test Configuration
**Active**: `test/tsconfig.integration-only.json`
```json
{
  "rootDir": "./",           // ✅ Correct: Only compiles test/ directory
  "outDir": "../out/test",   // ✅ Outputs to out/test/
  "include": ["./integration/**/*"],
  "exclude": ["../src"]      // ✅ Excludes source files
}
```

### Directory Structure
```
test/
├── integration/
│   ├── index.ts                      → out/test/integration/index.js
│   ├── index-activation-only.ts      → out/test/integration/index-activation-only.js
│   ├── activation-setup.test.ts      → out/test/integration/activation-setup.test.js
│   ├── test-helpers.ts               → out/test/integration/test-helpers.js
│   └── [12 other test files]         → out/test/integration/[...].test.js
└── tsconfig.integration-only.json

out/test/
└── integration/           ✅ Clean - only integration tests
    ├── index.js
    ├── index-activation-only.js
    ├── activation-setup.test.js
    └── [other compiled tests]

src/                       ✅ Clean - NO .js or .js.map files
```

## Protection Added

Updated `.gitignore` to prevent future pollution:

```gitignore
# Prevent compiled test files in source
src/**/*.js
src/**/*.js.map
!src/**/*.test.js
```

This ensures:
- ✅ All `.js` files in `src/` are ignored
- ✅ All `.js.map` files in `src/` are ignored
- ✅ Exception for `.test.js` files (if any legitimate test files exist in src)

## Verification

```bash
# Source directory is clean
$ find src -type f \( -name "*.js" -o -name "*.js.map" \) | wc -l
0

# Only integration tests in output
$ ls out/test/
integration
```

## Summary

- ✅ Removed 72 compiled artifacts from `src/`
- ✅ Removed 2 obsolete test configurations
- ✅ Removed 4 stale output directories
- ✅ Protected against future pollution in `.gitignore`
- ✅ Clean, organized test infrastructure

The test system now correctly compiles only test files to `out/test/integration/` without polluting the source tree.
