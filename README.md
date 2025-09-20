# Mu Two Editor - VS Code Extension

A professional CircuitPython development environment for VS Code, inspired by the excellent MU Editor.

## Features

✅ **CircuitPython Development Tools**
- Device detection for 602+ CircuitPython boards
- Interactive REPL with xterm.js terminal
- Monaco code editor with Python/CircuitPython support
- Real-time data plotting and visualization
- Serial communication management

✅ **Professional VS Code Integration**
- Native VS Code theming and UI patterns
- Debug Adapter Protocol (DAP) implementation
- File system provider with `ctpy://` URI scheme
- Task system integration for Python operations
- Workspace management and templates

✅ **Modern Architecture**
- Triple-package structure (Main + REPL + Editor webviews)
- TypeScript with comprehensive error handling
- Vite 6.3.5 unified build system
- State management with proper lifecycle
- Error boundaries and recovery mechanisms

## Quick Start

### Development Setup
```bash
# Install dependencies and build all components
npm install
npm run build-all    # ~18 seconds to build all packages

# Launch extension in VS Code
# Press F5 to start Extension Development Host
```

### Using the Extension
1. **Open Command Palette** (`Ctrl+Shift+P`)
2. **Run "Mu Two: Open REPL"** for terminal interface
3. **Run "Mu Two: Open Editor"** for Monaco editor with terminal
4. **Connect to CircuitPython device** and start developing!

## Project Structure

```
vscode-mu-two-editor/
├── src/                    # Main extension (TypeScript + Vite)
├── webview/               # REPL terminal (TypeScript + Webpack)  
├── editor-webview/        # Monaco editor (Preact + Vite)
├── docs/                  # Technical documentation
└── .vscode/              # Analysis reports and settings
```

## Documentation

- **[Architecture](docs/ARCHITECTURE.md)** - System design and component overview
- **[Development Guide](docs/DEVELOPMENT.md)** - Build setup and debugging
- **[Debug Adapter Protocol](docs/DEBUG_ADAPTER_PROTOCOL.md)** - DAP implementation details
- **[Project Status](docs/PROJECT_STATUS.md)** - Current state and roadmap

## Development Commands

```bash
# Unified build (recommended)
npm run build-all      # Build all packages
npm run dev            # Alias for build-all

# Individual package builds  
npm run compile        # Main extension
cd webview && npm run webpack     # REPL webview
cd editor-webview && npm run build # Editor webview
```

## Technical Highlights

- **State Management**: Centralized ExtensionStateManager with lifecycle handling
- **Error Boundaries**: Comprehensive webview communication protection  
- **VS Code API**: Modern task system integration (no direct spawn() usage)
- **Device Detection**: Advanced CircuitPython board identification
- **Build System**: Locked stable configuration (Vite 6.3.5)

## Contributing

This is a production-ready CircuitPython development environment. The codebase follows VS Code extension best practices and maintains high code quality standards.

**Architecture is stable** - major structural changes should be carefully planned and documented.

## License

Licensed under the MIT License - see individual file headers for details.

