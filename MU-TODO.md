**NOTE** 
**This file exists:**
      **1.) to contain a record of standing questions and concerns,**
      **2.) to document plans for future development**
**Created - 27 August 2025 by jef**
**Last Updated - 19 September 2025 by jef**


## NEW WEBVIEW UI GAMEPLAN

- The main REPL will first initialize with three options: Blinka-Python, WASM-Node CircuitPython, and PyScript.
- The main REPL webview view should run as frontend for headless cli-style processes of the above via postMessage() APIs. The webview view will continue to run a full instance of Xterm.js while WASM-Node CircuitPython, at least, will use xterm headless (I think). Both may make use of the Xterm.js serialize addon.
- The main REPL, ideally and initially, will be the point of contact for: checking/fetching CircuitPython libraries (circup), updating boards definitions, other shell-like functions on behalf of the extension.

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