## Blinka Directory, '/src/interface/'
# This file maintained for organizing development plans
# Last edited: 22 Aug 2025

- This directory doesn't really seem to fit here, but it also doesn't really seem to 
fit anywhere else, either. I'm keeping it in the active codebase, though, because it 
has important ideas and code to help flesh out the 'debugging' system of making
available simulated sensors/data for attached physical devices, to creating an entirely
simulated device.
- There are a few conceptual challenges:
   * How will we know what sort of data to mock? (UI? Interpret from drivers?)
   * What is the best configuration for running CircuitPython in the extension?
         - WASM?
         - venv Python + Blinka?
         - PyScript/MicroPython + Blinka?
      (This is difficult to resolve because I genuinely don't know how libraries might
         be loaded dynamically for use by WebAssembly - it's completely new territory.
         I will mention the Python library 'invoke' because of its potential to work as the
         glue to bring disparate parts together)
   * How do we best translate our simulated data into something physical devices can use?
      (Do we inject substitution logic into the 'code.py'? I'm rather keen on the idea of
         silently taking over the board's REPL in the background for more granular control,
         but creating a system like that is bound to be complex, perhaps overly so, or perhaps
         there's already a library to use? Does pyocd work like this?)