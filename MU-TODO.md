**NOTE**
**This file exists:**
      **1.) to contain a record of standing questions and concerns,**
      **2.) to document plans for future development**
**Created - 27 August 2025 by jef**
**Last Updated - 19 September 2025 by jef**


## FUTURE IMPROVEMENTS

- (circup) When on 'Global' tab, dedicated library view GUI in the Explorer tab area that:
   - Shows currently-installed libraries
   - Shows installed version, bold red if update available
   - has blank input line
   - has 'Install' button - if version entered in input line, installs/adds that version to global lib, else installs latest

- (circup) When on 'Workspace' tab, dedicated library view GUI in the Explorer tab area that:
   - Shows current project 'code.py' local-disk equivalent path+name
   - Shows currently-installed project libraries
   - Shows installed version, bold red if update available
   - has blank input line
   - has 'Install' button - if version entered in input line, installs/adds that version to active project lib, else installs latest

- (webview REPLs) To tie everything together, the main REPL and the editor+REPL need to be able to coordinate. My vision is that the editor's code can 'import tof from mu_repl' or 'import sensor.tof from mu_repl' so that the editor code can read data sent - in this case as tof distance data - from the main REPL webview. For its part, the main REPL will need a secondary tab to provide a web-based UI for: triggering button presses, sending pins high/low, sending/live adjusting analog pin data or sensor data [sliders with customizable range input entry boxes], providing LED representations [blinking and color reproduction]. The main REPL should be able to import the correct library to use for functionality beyond basic board interaction. {The ultimate would be if we can also mimic the register data/use the CONST data item sometimes found in libraries for our debugging. If we can leverage the higher power of the host machine to shadow the registry values of the microcontroller, and use the WASM-Node build to generate the sensor CONST registers, I think this would be a powerful tool for prototyping/rapid proof-of-concept/debugging. This register feature is the lowest priority, however}
- Main REPL needs always-available commands like: which --runtime, switch -r wasm, help
- '.commands'?, e.g., '.which --runtime', '.switch -r wasm', '.help'?

## WEBVIEW QUESTION

- With proof-of-concept preactRenderToString works, perhaps migrate webviews to SSR

## GENERAL QUESTIONS

- What is the proper scope for our filesystem provider? Active when extension is active? Only for workspaces?
- There's an extension called AREPL(?) that executes Python code in editor/background. Could our WASM do this? Might that play with/as a debug adapter? (My understanding is traditional debug adapters don't play well with Python code)
- Device twin as source of truth for our extension? Maybe think of device twin as proxy device?
- Need to check branding/code use re: mu2/Mu Two/muTwo
- Centralized circup functionality? (How are we tracking installed libraries, and should we have a config entry for them?)
- Versioning/updates for our wasm/runtimes?
- What needs to be implemented/setup during install or immediately afterward? Do we know what the directory structure will be and where to place the resources we'll need?

## CONFIGURATION AND SETTINGS EXPOSURE

- 'CIRCUITPY' drive + user-specified??
- 'code.py', 'main.py', boot.py' files + user-specified??


● Based on the research-specialist agent's analysis, the Mu 2 Editor codebase achieves a 7.5/10 alignment score with the stated design goals and
  architectural principles in EXT-APP-ARCHITECTURE.md.

  Strong Architectural Alignment Areas:

  ✅ Board-Centric Design (9/10)

  - Excellent: The device detection system (src/devices/core/deviceDetector.ts) with 602+ board database
  - Well Implemented: Board-workspace associations and device-specific configurations
  - Good Pattern: BoardManager and device twinning architecture

  ✅ Workspace Organization (8/10)

  - Strong: MuTwoWorkspace with project templates and learn guide integration
  - Good Structure: Workspace validation and configuration management
  - Effective: Project creation workflows and directory organization

  ✅ Manager Pattern Architecture (8/10)

  - Consistent: Well-defined manager classes (BoardManager, WorkspaceManager, etc.)
  - Clear Separation: Good separation of concerns between managers
  - Modular: Each manager handles specific domain responsibilities

  Areas Needing Improvement:

  ⚠️ VS Code Integration (6/10)

  - Gap: Inconsistent use of VS Code APIs vs Node.js modules
  - Issue: File operations mix vscode.workspace.fs.* with Node.js fs
  - Recommendation: Standardize on VS Code APIs for better workspace integration

  ⚠️ Runtime Coordination (6/10)

  - Problem: Multiple runtime managers with overlapping responsibilities
  - Issue: CircuitPython, WASM, and Python runtimes not well coordinated
  - Need: Better unified runtime abstraction layer

  ⚠️ Output/Logging Consistency (7/10)

  - Recently Improved: New unified logger addresses previous fragmentation
  - Still Needed: Full migration of all components to unified logging
  - Good Progress: WASM runtime updated, but more components need conversion

  Priority Recommendations:

  1. Filesystem Standardization: Convert all Node.js fs operations to vscode.workspace.fs.*
  2. Runtime Unification: Create cleaner abstraction between different Python runtimes
  3. Complete Logging Migration: Finish converting all components to unified logger
  4. Language Service Enhancement: Improve CircuitPython-specific language features

## CODEBASE TODO COMMENTS AUDIT

**Generated**: 22 September 2025 by Claude Code
**Total Items Found**: ~34 TODO/FIXME items across the codebase (1 completed, 1 external)

### **📋 Extension Core (`src/extension.ts`)**
- **Line 12**: TODO: Revise import signatures to reflect proper priorities - order driven by external realities
- **Line 32**: TODO: Check if replView panel is visible to determine if Provider needs immediate initialization
- **Line 51**: TODO: Find cleaner way than 'export let' statements for TypeScript/ESLint compliance
- **Line 171**: TODO: Open documentation about Python environment setup
- **Line 174**: TODO: Add command to retry Python environment setup
- **Line 1946**: TODO: Implement proper Python environment retry logic
- **Line 1972**: TODO: Show detailed logs or output channel
- **Line 1981**: TODO: File is nearly 1000 lines - consider refactoring into smaller modules under `/src/core/`

### **🗂️ Workspace Management (`src/workspace/`)**
- **workspace.ts:110**: TODO: Check for workspace config file
- **workspace.ts:259**: TODO: Standardize method to use workspaceUri; can include string path if needed

### **📚 Library & Integration Management (`src/workspace/integration/`)**
- **libraryManager.ts:24**: TODO: Consider pyproject.toml for user-facing metadata vs JSON for internal use
- **libraryManager.ts:47**: TODO: Add logic to differentiate custom/modified libraries
- **libraryManager.ts:48**: TODO: Consider different file schemes for Adafruit/CircuitPython sources
- **libraryManager.ts:100**: TODO: Use existing tools like 'circup' or 'pip' for library syncing and tracking
- **learnGuideProvider.ts:7**: TODO: Consume Adafruit Learn Guides directly from GitHub repo for offline viewing

### **🔧 System Components (`src/sys/`)**
- **fileSystemProvider.ts:15**: TODO: Migrate to 'mutwo://' URI scheme
- **fileSystemProvider.ts:19**: TODO: Use VS Code API 'fire soon' instead of custom timer
- **taskRunner.ts:136**: TODO: Use task/shell script with Python/pip writing JSON files instead of spawning processes
- **extensionStateManager.ts:25**: TODO: Add flag for Python venv activation status
- **extensionStateManager.ts:296**: TODO: Show user-friendly warning with suggestion to fix
- **extensionStateManager.ts:304**: TODO: Open documentation about Python environment setup
- **extensionStateManager.ts:307**: TODO: Trigger Python environment setup retry

### **🎮 Device & Hardware (`src/devices/`)**
- **protocols/debugAdapter.ts:225**: TODO: Log/read ticks from hardware to help match chronology
- **core/client.ts:116**: TODO: Get default board from device detection
- **core/client.ts:272**: TODO: Map proper completion item kinds
- **core/client.ts:294**: TODO: Implement actual device communication through DeviceManager
- **core/client.ts:309**: TODO: Implement binary data reception from device
- **core/client.ts:333**: TODO: Add method to DeviceManager for initiating connections

### **🔌 Providers & Language Services (`src/providers/`)**
- **editorPanelProvider.ts:40**: TODO: Get default board from configuration
- **replViewProvider.ts:67**: TODO: Get default board from device detection
- **webviewPanelProvider.ts:17**: Reference to MU-TODO.md for connected REPL windows feature
- **language/core/LanguageServiceBridge.ts:564**: TODO: Get version from package.json
- **language/core/LanguageServiceBridge.ts:666**: TODO: Implement raw data sending to device
- **language/core/LanguageServiceBridge.ts:708**: TODO: Add clear method to TerminalHistoryManager if not exists

### **🎯 Helper Components (`src/providers/helpers/`)**
- **boardDetectionHelper.ts:5**: Reference to MU-TODO.md line 15 for board detection logic
- **boardDetectionHelper.ts:82**: TODO: Implement smarter workspace selection based on active editor
- **replSessionHelper.ts:83**: TODO: Connect WASM runtime to session
- **replSessionHelper.ts:98**: TODO: Connect to physical device via existing device manager
- **replSessionHelper.ts:149**: TODO: Execute code in WASM runtime
- **replSessionHelper.ts:170**: TODO: Execute code on physical device

### **🌐 WebView Components (`views/`)**
- **webview-repl/src/WasmReplUI.tsx:69**: TODO: Implement PyScript support

### **🔍 TODO Completion Status Analysis**

**Generated**: 22 September 2025 by Claude Code Agent Analysis
**Status**: 1 item completed, 32 items still active, 1 obsolete, 1 reference

**✅ COMPLETED (1 item)**
- WasmRuntimeManager dispose method - ✅ Implemented and TODO comments removed

**❌ OBSOLETE (1 item)**
- CSS composition position (xterm.css) - External library TODO, not our responsibility

**📍 CURRENTLY ACTIVE (32 items)**
The following TODOs represent genuine development work still needed:

### **📈 Priority Assessment**

**🔴 High Priority (Core Functionality)**
1. Device communication implementation (`src/devices/core/client.ts`)
2. Python environment setup and retry logic (`src/extension.ts`, `src/sys/extensionStateManager.ts`)
3. WASM runtime integration (`src/providers/helpers/replSessionHelper.ts`)
4. Board detection and workspace association (`src/providers/helpers/boardDetectionHelper.ts`)

**🟡 Medium Priority (Developer Experience)**
1. Extension architecture refactoring (`src/extension.ts` - reduce file size)
2. File system provider URI scheme migration (`src/sys/fileSystemProvider.ts`)
3. Library management tool integration (`src/workspace/integration/libraryManager.ts`)
4. Configuration management improvements (`src/providers/`)

**🟢 Low Priority (Polish & Documentation)**
1. Version management from package.json (`src/providers/language/core/LanguageServiceBridge.ts`)
2. User documentation links (`src/extension.ts`, `src/sys/extensionStateManager.ts`)
3. CSS composition fixes (`views/webview-repl/src/xterm.css`)
4. PyScript support (`views/webview-repl/src/WasmReplUI.tsx`)

### **✅ Potentially Completed Items**
Some TODOs may already be addressed but comments weren't removed - audit needed to verify completion status.

### **📝 Recommended Next Steps**
1. **Audit completion status** - Review each TODO to determine if already implemented
2. **Prioritize device communication** - Core REPL functionality depends on this
3. **Address Python environment issues** - Critical for extension stability
4. **Refactor extension.ts** - Break into smaller, manageable modules
5. **Update documentation links** - Ensure all help links point to valid resources