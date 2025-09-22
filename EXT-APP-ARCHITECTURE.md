## GENERAL + DESIGN PHILOSOPHY
* Mu 2 Editor is a local-disk-first, board-centric development environment
* Projects *should* be developed on a user's host machine and synced to a connected board, when available 
* Project file changes will be 'backed-up' on local disk until the board connects again [user config: auto sync or ask first upon board reconnect(reconnect means longer than simple reset since last seen)]
* Workspaces are essentially organized by board, with each workspace supporting many projects
* Because this is a Python extension, the REPL has pride of place in the workflow
* Main REPL operates at roughly the extension/workspace level; editor REPLs operate at project level

## CORE

- Managers
   - Filesystem: host machine and connected board capable
      - Storage: handles extension-wide data storage for settings/configurations/resources (libraries, guides, etc.)
      - Scheme: helps VS Code associate files/directories with the extension [Any use for webviews?]
      - Sync: ensures resources are up-to-date and that expected versions remain available [need setting/config for this]
      - Sync again: helps user keep on-board/on-disk files current (e.g., save-twice strategy or *.mpy conversion)
   - Workspaces: manage creation and registration of Mu 2 workspaces/directories
      - Board: workspaces are created with an associated board; connecting board prompts opening its workspace
      - Projects: workspaces support multiple projects, just as a given board can be used in many ways
      - Storage: manage workspace-specific storage: logs, data, back-ups, serial/repl history
      - Interactivity: handles making open text editors interactive via repl and plotter coordination
   - Projects: manages project files/directories within workspaces [jukebox model]
      - Organization: tracks 'code.py' and related files, with their respective required libraries, including custom ones
      - Conversions: tracks which files need to be compiled to *.mpy when saved to a board [user config for this]
      - Typings: works with workspace to provide code completion, highlighting, typing
   - Devices
      - Detection: tracks when devices connect to/disconnect from host machine
      - Communication: establishes appropriate communication/connection protocol for REPL interaction
      - Database: uses extension board database to help make connecting 'invisible' to user

## SERVICES

- Providers
   - Context: sets Python environment
      - System: uses any detected system install, or VSC Python extension, to create a venv for our extension
      - Blinka: compatibility between system Python and CircuitPython or MicroPython
      - WASM: self-contained Python interpreter 
   - Views: supplies the real-time UI views
      - REPLs: powered by xterm.js with a workflow or serial device 'backend'
      - Main REPL: provides limited extension/workspace shell functionality
      - Editor REPL: essentially forms a two-window interactive notebook, executes code from associated editor
      - Plotter: plots data (!) as sent from the Editor REPL, possibly supplemented from Main REPL
   - Language: provides language-specific features
      - Completion
      - Intellisense and highlighting
      - Typings and Board/module awareness
   - Debugging: tools to manage board connections
      - Connection: manages extension <-> board connection
      - Debug connection: enhances standard connections to provide additional features for Python/MCU/embedded

- Runtimes
   - Provide a native Python REPL/cli interface that can be use to coordinate interaction with Editor REPLs
   - To users, connecting to a runtime should look like connecting to the REPL (in some cases, can be straight echo of background task/process)
   - Various flavors: 
      - Adafruit Blinka + System Python
      - CircuitPython web assembly [wasm-node]
      - MicroPython web assembly(future addition?)
      - PyScript(future addition?)
   - Library access, seamless imports from extension's globalStorage(?) library

## FUNCTIONALITY
**Out of the box, users of this extension should be able to:**

* Create and edit *.py text documents as specifically CircuitPython (later MicroPython) documents, with the editing support that entails
* Work interactively with connected or simulated microcontroller boards and sensors to develop portable code
* See results of code execution in real time through the REPL, plotter, or simulated board displays
* Supplement code execution by providing fill-in, or mocked, data (as separate program?)
* Maintain code projects centered upon particular boards in dedicated workspaces
* Work using the latest, or with specific, versions of libraries for project testing and development
* Get up and running with next to no setup necessary - connect a board, or select its simulated version, and go!


initial draft: 21 Sept 2025 - jef