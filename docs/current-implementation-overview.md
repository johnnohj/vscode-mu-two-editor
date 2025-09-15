# Mu 2 VS Code Extension - Current Implementation Overview

## Currently Implemented UI Components

### **Monaco Editor (Code Editor)**
• **CircuitPython Syntax Support** - Full Python syntax highlighting optimized for CircuitPython
• **Stub Loading System** - Automatic loading of CircuitPython library stubs for IntelliSense
• **Monaco Worker Integration** - Web worker support for advanced language features in VS Code webview environment
• **Split-Panel Layout** - Resizable split view with terminal panel below editor
• **Panel Toggle System** - Collapsible terminal panel with VS Code command integration
• **Auto-Layout Management** - Responsive editor sizing with resize observers and throttling
• **VS Code Theme Integration** - Uses VS Code's color theme and font settings
• **Content Change Tracking** - Real-time dirty state detection and change notifications
• **Welcome Template** - Default CircuitPython LED blink example for new files

### **Plotter (Data Visualization)**
• **Real-Time Data Streaming** - Live plotting from CircuitPython serial output
• **Multiple Input Formats** - Supports both tuple `(x,y,z)` and CSV `x,y,z` data formats
• **Multi-Series Support** - Plots multiple data series with individual enable/disable controls
• **Configurable Data Window** - Adjustable time windows and maximum data points
• **Auto-Scaling** - Automatic Y-axis scaling or manual range control
• **Data Export** - Export plot data to CSV or JSON formats
• **Connection Status** - Visual indicator showing device connection state
• **Plot Canvas** - Custom HTML5 canvas-based plotting with smooth animations
• **Data Controls Panel** - Controls for clearing data, toggling series, and export options

### **Terminal/REPL System**
• **XTerm.js Integration** - Full terminal emulation with ANSI escape sequence support
• **Multi-Tab Interface** - Tabbed interface for REPL, Plotter, and Blinka Test views
• **Blinka Virtual Device Support** - Built-in Python/Blinka virtual CircuitPython environment
• **Connection Progress Indicators** - Animated progress bars for device connection
• **Command Buffer Management** - Local command editing with backspace and cursor handling
• **VS Code Theme Compatibility** - Uses VS Code editor colors and Monaco-style scrollbars
• **Bidirectional Communication** - Message passing between terminal UI and extension backend
• **Port Management** - Device port listing and connection controls
• **Auto-Resize** - Responsive terminal sizing with fit addon

### **Mu 2 Workspaces (Project Management)**
• **Automated Workspace Creation** - Detects CircuitPython boards and creates associated workspaces
• **Board Association System** - Links workspaces to specific CircuitPython devices by VID/PID
• **File Structure Generation** - Creates proper `.vscode/mu2/` directory structure with config files
• **Enhanced Workspace Registry** - Global storage system for tracking all Mu 2 workspaces
• **Learn Guide Integration** - Automatic download of board-specific documentation
• **Development Mode Support** - Special handling for `mu2-test` workspace during development
• **Pending Downloads System** - Queued downloads for board resources and documentation
• **Workspace Restoration** - Ability to restore workspaces to initial configurations
• **Cross-Platform Path Handling** - Proper URI-based file operations for Windows/Mac/Linux
• **Session Management** - Tracks workspace usage and provides cleanup for test sessions

### **Board Manager (Device Management System)**
• **Unified Board Interface** - Single `IBoard` interface for all board types (USB, BLE, Virtual)
• **USB CircuitPython Board Implementation** - Full support for physical CircuitPython devices
• **Board Capabilities System** - Declares what each board supports (REPL, file system, debugging)
• **Connection State Management** - Tracks connected/disconnected/connecting states with events
• **File Operations** - Read, write, list, and delete files on connected boards
• **REPL Session Management** - Create and manage multiple REPL sessions per board
• **Code Execution** - Execute Python code directly on boards with result feedback
• **Event-Driven Architecture** - Events for connection changes, file system changes, REPL output
• **Device Detection Integration** - Works with CircuitPython device detector for auto-discovery
• **Board Registry** - Maintains list of available boards with automatic refresh

## Core Infrastructure Components

### **Extension State Manager (Core Infrastructure)**
• **Singleton State Management** - Centralized, type-safe state for all extension components
• **Component Lifecycle Tracking** - Manages initialization and disposal of all extension services
• **Event-Driven State Changes** - Emits events when extension state changes occur
• **Graceful Error Handling** - Continues operation even when individual components fail to initialize
• **Lazy Loading Coordination** - Tracks which components are loaded on-demand vs immediately
• **Development Mode Detection** - Special handling for development/testing scenarios
• **Component Dependency Management** - Ensures proper initialization order and dependencies
• **Disposal Safety** - Prevents state updates during extension shutdown
• **Connection Status Aggregation** - Provides unified view of device connection state
• **Workspace Context Awareness** - Tracks current workspace folders and configuration

### **CircuitPython Device Detection System**
• **Cross-Platform USB Enumeration** - Detects CircuitPython devices on Windows, macOS, and Linux
• **VID/PID Database** - Maintains database of known CircuitPython board identifiers
• **Automatic Board Recognition** - Identifies specific board models (Pico, Feather, etc.)
• **Serial Port Discovery** - Finds and validates CircuitPython serial interfaces
• **Device Capability Detection** - Determines what features each detected board supports
• **Hot-Plug Support** - Real-time detection of device connect/disconnect events
• **Board Information Extraction** - Reads board name, version, and capabilities from device
• **Error Recovery** - Handles device detection failures gracefully without crashing
• **Polling-Based Updates** - Periodic device refresh with configurable intervals
• **Device Path Normalization** - Consistent device path handling across platforms

### **Blinka Execution Manager (Virtual Device Support)**
• **Dual Execution Environment** - Runs code simultaneously on hardware and in Adafruit Blinka simulation
• **Performance Comparison Analysis** - Compares execution results, timing, and outputs between environments
• **Educational Feedback System** - Provides learning tips and recommendations based on execution differences
• **Multiple Board Simulation** - Supports various CircuitPython board configurations (RPi, Feather, CircuitPlayground)
• **Memory Profiling** - Tracks memory usage during simulation execution with Python tracemalloc
• **Smart Environment Selection** - Automatically chooses best execution environment based on available resources
• **Execution Session Management** - Tracks execution history and provides detailed reports
• **Blinka Auto-Installation** - Automatically installs Adafruit Blinka if not present in Python environment
• **Code Preparation System** - Wraps user code with proper Blinka imports and board configuration
• **Error Correlation Analysis** - Identifies discrepancies between hardware and simulation behavior

### **Dual Execution Interface (User Experience Layer)**
• **Execution Mode Selection** - Auto-select, hardware-only, simulation-only, or dual comparison modes
• **Smart Execution Context** - Automatically determines best approach based on connected devices
• **Educational Tips Integration** - Provides learning insights based on execution results
• **Session History Tracking** - Maintains record of all execution attempts with results
• **User Preference Management** - Saves execution preferences and board selections to VS Code settings
• **Detailed Result Analysis** - Shows comprehensive comparison reports with timing and output analysis
• **Result Export System** - Save execution reports as markdown files for documentation
• **Retry Mechanisms** - Easily retry execution in different environments after initial run
• **Conflict Resolution** - Handles device availability and provides graceful fallbacks
• **Real-time Progress Feedback** - Shows execution progress and connection status

### **Unified Debug Manager (Communication Coordination)**
• **Multi-Protocol Coordination** - Manages DAP, LSP, direct serial, and webview communication channels
• **Resource Conflict Prevention** - Prevents multiple components from accessing same device simultaneously
• **Priority-Based Access Control** - DAP > LSP > Direct > Webview priority ordering for device access
• **Connection State Tracking** - Monitors all active device connections with health and capability info
• **Automatic Conflict Resolution** - Detects and resolves resource conflicts between communication methods
• **Event Aggregation** - Forwards events from all communication channels through unified interface
• **Device Lock Management** - Prevents lower-priority components from interfering with active connections
• **Stale Connection Cleanup** - Automatically removes inactive connections after timeout periods
• **Resource Monitoring** - Proactively monitors device availability and connection health
• **Error Handling & Recovery** - Graceful handling of communication errors with automatic retry logic

### **CircuitPython Debug Provider (State Inspection)**
• **Peripheral Register Inspection** - Real-time monitoring of I2C, SPI, GPIO, ADC, and UART registers
• **VS Code Debug Integration** - Displays board state in VS Code's built-in debug sidepanel
• **Pin State Monitoring** - Tracks pin values, modes, and state changes over time
• **Memory Usage Tracking** - Shows heap usage, free memory, and total memory consumption
• **Transaction Logging** - Records all peripheral transactions with before/after values
• **Smart Update Buffering** - Buffers rapid updates to prevent UI flooding while maintaining responsiveness
• **Execution Context Display** - Shows current file, last command, and execution status
• **State Change Visualization** - Visual indicators for connection status and board state
• **JSON State Parsing** - Handles PyScript/virtual device state updates in JSON format
• **Debug Variable Hierarchy** - Organized display of board components in debug variable tree

### **Language Server Protocol (LSP) Client**
• **Text Channel Architecture** - Provides shared communication channel for REPL and editor webviews
• **Enhanced Serial Event Forwarding** - Forwards serial communication as structured text channel messages
• **REPL Command Completion** - Basic CircuitPython completions for REPL input
• **Session Management** - Creates and manages text sessions for different webview sources
• **Connection Status Broadcasting** - Notifies all components of device connection changes
• **Execution Result Tracking** - Captures and forwards code execution results with timing information
• **Direct vs Server Mode** - Can operate with or without separate LSP server process
• **Error Event Propagation** - Structured error handling and reporting across all text channels
• **Device Communication Abstraction** - Unified interface for device communication regardless of backend
• **Multi-Source Support** - Handles communication from both REPL and editor webview sources

### **Python Environment Manager**
• **Virtual Environment Detection** - Automatically detects and manages Python virtual environments
• **Python Installation Discovery** - Cross-platform Python interpreter detection and validation
• **Package Installation Management** - Handles pip installations for Blinka and CircuitPython libraries
• **Environment Activation** - Manages virtual environment activation for development sessions
• **Script Execution Interface** - Provides Python script execution with proper environment context
• **Dependency Management** - Ensures required packages are available for extension functionality
• **Cross-Platform Support** - Works on Windows, macOS, and Linux with platform-specific optimizations
• **Error Recovery** - Graceful handling of Python environment issues with user guidance
• **Configuration Persistence** - Saves Python environment preferences for consistency across sessions
• **Development Mode Support** - Special handling for development and testing scenarios

## Project Architecture

### File Structure
```
C:\Users\jef\dev\vscode-mu-two-editor\
├── src/                              # Main extension TypeScript source
│   ├── extension.ts                  # Entry point and extension activation
│   ├── core/                         # Core systems (BoardManager, StateManager, etc.)
│   ├── terminal/                     # REPL/Terminal webview components
│   ├── editor/                       # Code editor components
│   ├── language/                     # Language server integration
│   ├── circuitpython/                # CircuitPython-specific functionality
│   ├── blinka/                       # Virtual device and dual execution
│   ├── debug/                        # Enhanced debugging features
│   └── utils/                        # Shared utilities and helpers
├── views/                            # Frontend webview components
│   ├── webview-editor/               # Monaco Editor webview (Preact + Monaco)
│   ├── webview-repl/                 # REPL Terminal webview (XTerm.js)
│   └── shared/                       # Shared webview utilities
├── docs/                             # Documentation and design specifications
└── package.json                     # Extension manifest and dependencies
```

### Key Architectural Decisions
- **Multi-Process Architecture**: Extension backend + 2 webview frontends (terminal + editor)
- **State Management**: Centralized in extension.ts with message-based communication to webviews
- **Device Discovery**: Polling-based with 5-second intervals for real-time device detection
- **Error Resilience**: Non-blocking component initialization with graceful feature degradation
- **Cross-Platform Support**: Platform-specific device discovery with unified API abstraction
- **Build System**: Vite-based bundling for fast development iteration and optimized production builds

## Save Twice Strategy

### Local-First Development Approach
The extension implements a local-first editing environment where:
- **Auto-saves**: Handle local workspace files only (fast, no device disruption)
- **Manual saves**: Trigger synchronized deployment to associated CircuitPython device

### Workspace Structure
```
workspace/
├── current/           # Active project files for development
├── projects/          # Archived/stored past projects
├── .board/           # Local mirror/backup of device files + sync metadata
└── lib/              # Library coordination with on-board libraries
```

### "Save Twice" Implementation
When user manually saves a file in the `current/` directory:

**Device Connected:**
1. **First Save**: Local file (`current/[filename].py`) 
2. **Second Save**: Same content to device as `code.py` (or `main.py` if configured)
   - Triggers CircuitPython device auto-reboot
   - Uses custom file system provider for device transfer

**Device Disconnected:**
1. **First Save**: Local file (`current/[filename].py`)
2. **Second Save**: Content to `.board/code.py` 
   - Creates "pending sync" state for next device connection
   - User notification about pending update

### Implementation Components
- `onDidSaveDocument` event handler with `TextDocumentSaveReason.Manual` filtering
- Integration with workspace manager for file/board tracking
- Device connectivity validation via debug manager
- File transfer coordination through CircuitPython file system provider
