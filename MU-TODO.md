**NOTE** 
**This file exists:**
      **1.) to contain a record of standing questions and concerns,**
      **2.) to document plans for future development**
**Created - 27 August 2025 by jef**
**Last Updated - 19 September 2025 by jef**


## NEW WEBVIEW UI GAMEPLAN

- The main REPL will first initialize with three options: Blinka-Python, WASM-Node CircuitPython, and PyScript [CircuitPython FruitJam OS support in future?].
- The main REPL webview view should run as frontend for headless cli-style processes of the above via postMessage() APIs. The webview view will continue to run a full instance of Xterm.js while WASM-Node CircuitPython, at least, will use xterm headless (I think). Both may make use of the Xterm.js serialize addon.
- The main REPL, ideally and initially, will be the point of contact for: checking/fetching CircuitPython libraries (circup) [opening a dedicated library tree UI view in the Explorer tab area], updating boards definitions, other shell-like functions on behalf of the extension.
- {How far can we push this - can the WASM build handle extension/application logic in concert with VS Code's UI?}
- Open editors must be able to spawn 'connected' REPL windows [uses the splitBelow API to create a webviewPanel] to connect to a board - virtual or physical - that is workspace-aware and can read/execute the editor's contents. The same webviewPanel can add a plotter tab for visual data output. {We're essentially re-implementing the custom editor, but this time we only need to create/manage the webviewPanels; can we use something like micro-repl or circuitpython-repl-js to handle the setup/connection - naturally the extension handles any serialport management and we have our virtual fallback(?)} The plotter tab will likely use the open or createNewPanel.right, or similar
- To tie everything together, the main REPL and the editor+REPL need to be able to coordinate. My vision is that the editor's code can 'import tof from mu_repl' or 'import sensor.tof from mu_repl' so that the editor code can read data sent - in this case as tof distance data - from the main REPL webview. For its part, the main REPL will need a secondary tab to provide a web-based UI for: triggering button presses, sending pins high/low, sending/live adjusting analog pin data or sensor data [sliders with customizable range input entry boxes], providing LED representations [blinking and color reproduction]. The main REPL should be able to import the correct library to use for functionality beyond basic board interaction. {The ultimate would be if we can also mimic the register data/use the CONST data item sometimes found in libraries for our debugging. If we can leverage the higher power of the host machine to shadow the registry values of the microcontroller, and use the WASM-Node build to generate the sensor CONST registers, I think this would be a powerful tool for prototyping/rapid proof-of-concept/debugging. This register feature is the lowest priority, however}
- Main REPL needs always-available commands like: which --runtime, switch -r wasm, help

## WEBVIEW QUESTION

- With proof-of-concept preactRenderToString works, perhaps migrate webviews to SSR

## GENERAL QUESTIONS

- Do we provide a custom shell profile, and should we?
- What is the proper scope for our filesystem provider? Active when extension is active? Only for workspaces?
- There's an extension called AREPL(?) that executes Python code in editor/background. Could our WASM do this? Might that play with/as a debug adapter? (My understanding is traditional debug adapters don't play well with Python code)
- Device twin as source of truth for our extension? Maybe think of device twin as proxy device?
- Need to check branding/code use re: mu2/Mu Two/muTwo


## CONFIGURATION AND SETTINGS EXPOSURE

- 'CIRCUITPY' drive + user-specified??
- 'code.py', 'main.py', boot.py' files + user-specified??