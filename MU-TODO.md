**NOTE** 
**This file exists:**
      **1.) to contain a record of standing questions and concerns,**
      **2.) to document plans for future development**
**Created/Last updated - 27 August 2025 by jef**

### RESTRUCTURE

- Move '/src/interface/client.ts' to '/src/providers/'
- Create an LSP json-rpc 'server' run in a VS Code task or child process
- The server will handle current language-related duties, plus:
- Our simulated board model will be held on the server, just like a textDocument model
- Our CircuitPython WASM module will be run on the server
- Our deviceManager and debugAdapter will connect/attach to the server task/process
- Physical/virtual boards connect to deviceManager 
- Bidirectional data passing is handled over json-rpc

## WEBVIEW QUESTION

- With proof-of-concept preactRenderToString works, perhaps migrate webviews to SSR