/**
 * CircuitPython Stub Loader for Monaco Editor
 * 
 * This module handles loading CircuitPython type definitions into Monaco Editor
 * to provide autocomplete, hover information, and type checking for CircuitPython code.
 */

import * as monaco from 'monaco-editor';

export interface CircuitPythonStub {
  name: string;
  content: string;
  uri: string;
}

export interface StubLoadResult {
  success: boolean;
  loadedStubs: string[];
  errors: string[];
}

export class CircuitPythonStubLoader {
  private loadedStubs = new Set<string>();
  private stubCache = new Map<string, string>();

  constructor() {
    this.setupPythonLanguageService();
  }

  /**
   * Initialize Python language service configuration for CircuitPython
   */
  private setupPythonLanguageService(): void {
    // Register hover provider for CircuitPython modules
    monaco.languages.registerHoverProvider('python', {
      provideHover: (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;

        return this.getHoverInfo(word.word);
      }
    });

    // Register completion provider for CircuitPython modules
    monaco.languages.registerCompletionItemProvider('python', {
      triggerCharacters: ['.', ' '],
      provideCompletionItems: (model, position) => {
        return this.getCompletionItems(model, position);
      }
    });

    // Register signature help provider for function signatures
    monaco.languages.registerSignatureHelpProvider('python', {
      signatureHelpTriggerCharacters: ['(', ','],
      signatureHelpRetriggerCharacters: [')'],
      provideSignatureHelp: (model, position) => {
        return this.getSignatureHelp(model, position);
      }
    });
  }

  /**
   * Load core CircuitPython stubs
   */
  async loadCoreStubs(): Promise<StubLoadResult> {
    const result: StubLoadResult = {
      success: true,
      loadedStubs: [],
      errors: []
    };

    const coreStubs = await this.getCoreCircuitPythonStubs();
    
    for (const stub of coreStubs) {
      try {
        await this.loadStub(stub);
        result.loadedStubs.push(stub.name);
      } catch (error) {
        result.errors.push(`Failed to load ${stub.name}: ${error}`);
        result.success = false;
      }
    }

    return result;
  }

  /**
   * Load a single stub file into Monaco
   */
  private async loadStub(stub: CircuitPythonStub): Promise<void> {
    if (this.loadedStubs.has(stub.name)) {
      return; // Already loaded
    }

    // Cache the stub content
    this.stubCache.set(stub.name, stub.content);

    // Create a virtual model for the stub
    const uri = monaco.Uri.parse(stub.uri);
    
    // Check if model already exists
    const existingModel = monaco.editor.getModel(uri);
    if (existingModel) {
      existingModel.setValue(stub.content);
    } else {
      monaco.editor.createModel(stub.content, 'python', uri);
    }

    this.loadedStubs.add(stub.name);
  }

  /**
   * Get core CircuitPython stub definitions
   */
  private async getCoreCircuitPythonStubs(): Promise<CircuitPythonStub[]> {
    return [
      {
        name: 'board',
        uri: 'inmemory://circuitpython/board.pyi',
        content: await this.getBoardStub()
      },
      {
        name: 'digitalio',
        uri: 'inmemory://circuitpython/digitalio.pyi', 
        content: await this.getDigitalIOStub()
      },
      {
        name: 'analogio',
        uri: 'inmemory://circuitpython/analogio.pyi',
        content: await this.getAnalogIOStub()
      },
      {
        name: 'time',
        uri: 'inmemory://circuitpython/time.pyi',
        content: await this.getTimeStub()
      },
      {
        name: 'microcontroller',
        uri: 'inmemory://circuitpython/microcontroller.pyi',
        content: await this.getMicrocontrollerStub()
      }
    ];
  }

  /**
   * Generate board module stub
   */
  private async getBoardStub(): Promise<string> {
    return `"""Board specific pin definitions for CircuitPython."""

from typing import Any
from microcontroller import Pin

# Common board pins - actual pins vary by board
LED: Pin
"""Built-in LED pin"""

A0: Pin
"""Analog pin A0"""

A1: Pin
"""Analog pin A1"""

A2: Pin
"""Analog pin A2"""

A3: Pin
"""Analog pin A3"""

D0: Pin
"""Digital pin D0"""

D1: Pin
"""Digital pin D1"""

D2: Pin
"""Digital pin D2"""

D3: Pin
"""Digital pin D3"""

D4: Pin
"""Digital pin D4"""

D5: Pin
"""Digital pin D5"""

D6: Pin
"""Digital pin D6"""

D7: Pin
"""Digital pin D7"""

D8: Pin
"""Digital pin D8"""

D9: Pin
"""Digital pin D9"""

D10: Pin
"""Digital pin D10"""

D11: Pin
"""Digital pin D11"""

D12: Pin
"""Digital pin D12"""

D13: Pin
"""Digital pin D13"""

# Common I2C pins
SCL: Pin
"""I2C Clock pin"""

SDA: Pin  
"""I2C Data pin"""

# Common SPI pins
SCK: Pin
"""SPI Clock pin"""

MOSI: Pin
"""SPI Master Out Slave In pin"""

MISO: Pin
"""SPI Master In Slave Out pin"""

# Common UART pins
TX: Pin
"""UART Transmit pin"""

RX: Pin
"""UART Receive pin"""
`;
  }

  /**
   * Generate digitalio module stub
   */
  private async getDigitalIOStub(): Promise<string> {
    return `"""Digital input/output support for CircuitPython."""

from typing import Optional, Union
from microcontroller import Pin

class Direction:
    """Defines the direction of a digital pin."""
    INPUT: Direction
    OUTPUT: Direction

class Pull:
    """Defines the pull configuration of an input pin."""
    UP: Pull
    DOWN: Pull

class DriveMode:
    """Defines the drive mode of an output pin."""
    PUSH_PULL: DriveMode
    OPEN_DRAIN: DriveMode

class DigitalInOut:
    """Digital input/output pin control."""
    
    def __init__(self, pin: Pin) -> None:
        """Create a DigitalInOut object for the given pin."""
        ...
    
    @property 
    def direction(self) -> Direction:
        """The direction of the pin."""
        ...
    
    @direction.setter
    def direction(self, value: Direction) -> None:
        ...
    
    @property
    def value(self) -> bool:
        """The digital value of the pin."""
        ...
    
    @value.setter  
    def value(self, value: bool) -> None:
        ...
    
    @property
    def pull(self) -> Optional[Pull]:
        """The pull configuration of an input pin."""
        ...
    
    @pull.setter
    def pull(self, value: Optional[Pull]) -> None:
        ...
    
    @property
    def drive_mode(self) -> DriveMode:
        """The drive mode of an output pin."""
        ...
    
    @drive_mode.setter
    def drive_mode(self, value: DriveMode) -> None:
        ...

    def deinit(self) -> None:
        """Deinitialize the pin."""
        ...
`;
  }

  /**
   * Generate analogio module stub
   */
  private async getAnalogIOStub(): Promise<string> {
    return `"""Analog input/output support for CircuitPython."""

from typing import Optional
from microcontroller import Pin

class AnalogIn:
    """Analog input pin."""
    
    def __init__(self, pin: Pin) -> None:
        """Create an AnalogIn object for the given pin."""
        ...
    
    @property
    def value(self) -> int:
        """The raw analog value (0-65535)."""
        ...
    
    @property 
    def reference_voltage(self) -> float:
        """The reference voltage for analog reads."""
        ...

    def deinit(self) -> None:
        """Deinitialize the pin."""
        ...

class AnalogOut:
    """Analog output pin (DAC)."""
    
    def __init__(self, pin: Pin) -> None:
        """Create an AnalogOut object for the given pin."""
        ...
    
    @property
    def value(self) -> int:
        """The raw analog output value (0-65535)."""
        ...
    
    @value.setter
    def value(self, value: int) -> None:
        ...

    def deinit(self) -> None:
        """Deinitialize the pin."""
        ...
`;
  }

  /**
   * Generate time module stub
   */
  private async getTimeStub(): Promise<string> {
    return `"""Time-related functions for CircuitPython."""

from typing import Union

def sleep(seconds: Union[int, float]) -> None:
    """Sleep for the given number of seconds."""
    ...

def monotonic() -> float:
    """Return the current monotonic time in seconds."""
    ...

def monotonic_ns() -> int:
    """Return the current monotonic time in nanoseconds."""
    ...

def time() -> float:
    """Return the current time in seconds since epoch."""
    ...

struct_time = tuple
"""Time structure tuple."""
`;
  }

  /**
   * Generate microcontroller module stub
   */
  private async getMicrocontrollerStub(): Promise<string> {
    return `"""Microcontroller specific functions and objects."""

from typing import Optional

class Pin:
    """A pin on the microcontroller."""
    pass

def reset() -> None:
    """Reset the microcontroller."""
    ...

def enable_autoreload() -> None:
    """Enable automatic reloading of code.py."""
    ...

def disable_autoreload() -> None:
    """Disable automatic reloading of code.py."""
    ...

cpu: object
"""CPU information object."""

nvm: bytearray
"""Non-volatile memory storage."""
`;
  }

  /**
   * Provide hover information for CircuitPython symbols
   */
  private getHoverInfo(word: string): monaco.languages.Hover | null {
    const hoverMap: Record<string, string> = {
      'board': 'Board-specific pin definitions and hardware constants',
      'digitalio': 'Digital input/output functionality', 
      'analogio': 'Analog input/output functionality',
      'time': 'Time-related functions and utilities',
      'microcontroller': 'Microcontroller-specific functions and objects',
      'DigitalInOut': 'Digital input/output pin control class',
      'AnalogIn': 'Read analog values from a pin',
      'AnalogOut': 'Output analog values to a pin (DAC)',
      'Direction': 'Pin direction constants (INPUT, OUTPUT)',
      'Pull': 'Pin pull resistor constants (UP, DOWN)',
      'sleep': 'Pause execution for specified time in seconds'
    };

    const description = hoverMap[word];
    if (description) {
      return {
        contents: [
          { value: `**${word}**` },
          { value: description }
        ]
      };
    }

    return null;
  }

  /**
   * Provide completion items for CircuitPython modules
   */
  private getCompletionItems(
    model: monaco.editor.ITextModel, 
    position: monaco.Position
  ): monaco.languages.ProviderResult<monaco.languages.CompletionList> {
    const suggestions: monaco.languages.CompletionItem[] = [];

    // Get the current line to check context
    const lineContent = model.getLineContent(position.lineNumber);
    const wordInfo = model.getWordAtPosition(position);
    const lineUpToPosition = lineContent.substr(0, position.column - 1);
    
    // Check if we're completing after a dot (module.attribute)
    const lastDotIndex = lineUpToPosition.lastIndexOf('.');
    if (lastDotIndex !== -1) {
      const beforeDot = lineUpToPosition.substr(0, lastDotIndex).trim();
      const lastWord = beforeDot.split(/\s+/).pop();
      
      // Module-specific completions
      if (lastWord === 'board') {
        suggestions.push(...this.getBoardCompletions());
      } else if (lastWord === 'digitalio') {
        suggestions.push(...this.getDigitalIOCompletions());
      } else if (lastWord === 'analogio') {
        suggestions.push(...this.getAnalogIOCompletions());
      } else if (lastWord === 'time') {
        suggestions.push(...this.getTimeCompletions());
      } else if (lastWord === 'microcontroller') {
        suggestions.push(...this.getMicrocontrollerCompletions());
      }
      // Check for object attribute completions
      else if (this.isDigitalInOutObject(model, lastWord)) {
        suggestions.push(...this.getDigitalInOutAttributeCompletions());
      } else if (this.isAnalogInObject(model, lastWord)) {
        suggestions.push(...this.getAnalogInAttributeCompletions());
      } else if (this.isAnalogOutObject(model, lastWord)) {
        suggestions.push(...this.getAnalogOutAttributeCompletions());
      }
    } else {
      // General module and keyword suggestions
      suggestions.push(...this.getModuleCompletions());
      
      // Add import suggestions if at beginning of line or after 'import'
      if (lineUpToPosition.trim() === '' || lineUpToPosition.trim().endsWith('import')) {
        suggestions.push(...this.getImportCompletions());
      }
    }

    return {
      suggestions: suggestions.filter(s => s.label.length > 0)
    };
  }

  /**
   * Provide signature help for function calls
   */
  private getSignatureHelp(
    model: monaco.editor.ITextModel,
    position: monaco.Position
  ): monaco.languages.ProviderResult<monaco.languages.SignatureHelp> {
    const lineContent = model.getLineContent(position.lineNumber);
    const lineUpToPosition = lineContent.substr(0, position.column - 1);
    
    // Look for function calls like DigitalInOut(
    const functionCallMatch = lineUpToPosition.match(/(\w+)\s*\([^)]*$/);
    if (functionCallMatch) {
      const functionName = functionCallMatch[1];
      
      const signatures = this.getFunctionSignatures(functionName);
      if (signatures.length > 0) {
        return {
          signatures: signatures,
          activeSignature: 0,
          activeParameter: this.getActiveParameter(lineUpToPosition)
        };
      }
    }
    
    return null;
  }

  private getFunctionSignatures(functionName: string): monaco.languages.SignatureInformation[] {
    const signatureMap: Record<string, monaco.languages.SignatureInformation> = {
      'DigitalInOut': {
        label: 'DigitalInOut(pin: Pin)',
        documentation: 'Create a DigitalInOut object for the given pin',
        parameters: [
          {
            label: 'pin: Pin',
            documentation: 'The microcontroller pin to use'
          }
        ]
      },
      'AnalogIn': {
        label: 'AnalogIn(pin: Pin)',
        documentation: 'Create an AnalogIn object for the given pin',
        parameters: [
          {
            label: 'pin: Pin', 
            documentation: 'The analog-capable pin to read from'
          }
        ]
      },
      'AnalogOut': {
        label: 'AnalogOut(pin: Pin)',
        documentation: 'Create an AnalogOut object for the given pin',
        parameters: [
          {
            label: 'pin: Pin',
            documentation: 'The DAC-capable pin to output to'
          }
        ]
      },
      'sleep': {
        label: 'sleep(seconds: Union[int, float])',
        documentation: 'Sleep for the given number of seconds',
        parameters: [
          {
            label: 'seconds: Union[int, float]',
            documentation: 'Time to sleep in seconds'
          }
        ]
      }
    };

    const signature = signatureMap[functionName];
    return signature ? [signature] : [];
  }

  private getActiveParameter(lineUpToPosition: string): number {
    const openParenIndex = lineUpToPosition.lastIndexOf('(');
    if (openParenIndex === -1) return 0;
    
    const paramsText = lineUpToPosition.substr(openParenIndex + 1);
    return paramsText.split(',').length - 1;
  }

  private getBoardCompletions(): monaco.languages.CompletionItem[] {
    const pins = ['LED', 'A0', 'A1', 'A2', 'A3', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 
                  'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'SCL', 'SDA', 
                  'SCK', 'MOSI', 'MISO', 'TX', 'RX'];
    
    return pins.map(pin => ({
      label: pin,
      kind: monaco.languages.CompletionItemKind.Property,
      documentation: `Board pin: ${pin}`,
      insertText: pin
    }));
  }

  private getDigitalIOCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'DigitalInOut',
        kind: monaco.languages.CompletionItemKind.Class,
        documentation: 'Digital input/output pin control',
        insertText: 'DigitalInOut'
      },
      {
        label: 'Direction',
        kind: monaco.languages.CompletionItemKind.Enum,
        documentation: 'Pin direction constants',
        insertText: 'Direction'
      },
      {
        label: 'Pull',
        kind: monaco.languages.CompletionItemKind.Enum,
        documentation: 'Pin pull resistor constants',
        insertText: 'Pull'
      }
    ];
  }

  private getAnalogIOCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'AnalogIn',
        kind: monaco.languages.CompletionItemKind.Class,
        documentation: 'Analog input pin',
        insertText: 'AnalogIn'
      },
      {
        label: 'AnalogOut', 
        kind: monaco.languages.CompletionItemKind.Class,
        documentation: 'Analog output pin (DAC)',
        insertText: 'AnalogOut'
      }
    ];
  }

  private getModuleCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'board',
        kind: monaco.languages.CompletionItemKind.Module,
        documentation: 'Board-specific pin definitions',
        insertText: 'board'
      },
      {
        label: 'digitalio',
        kind: monaco.languages.CompletionItemKind.Module,
        documentation: 'Digital input/output functionality',
        insertText: 'digitalio'
      },
      {
        label: 'analogio',
        kind: monaco.languages.CompletionItemKind.Module,
        documentation: 'Analog input/output functionality',
        insertText: 'analogio'
      },
      {
        label: 'time',
        kind: monaco.languages.CompletionItemKind.Module,
        documentation: 'Time-related functions',
        insertText: 'time'
      },
      {
        label: 'microcontroller',
        kind: monaco.languages.CompletionItemKind.Module,
        documentation: 'Microcontroller-specific functions',
        insertText: 'microcontroller'
      }
    ];
  }

  private getImportCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'import board',
        kind: monaco.languages.CompletionItemKind.Snippet,
        documentation: 'Import board-specific pin definitions',
        insertText: 'import board'
      },
      {
        label: 'import digitalio',
        kind: monaco.languages.CompletionItemKind.Snippet,
        documentation: 'Import digital I/O functionality',
        insertText: 'import digitalio'
      },
      {
        label: 'import analogio',
        kind: monaco.languages.CompletionItemKind.Snippet,
        documentation: 'Import analog I/O functionality',
        insertText: 'import analogio'
      },
      {
        label: 'import time',
        kind: monaco.languages.CompletionItemKind.Snippet,
        documentation: 'Import time functions',
        insertText: 'import time'
      }
    ];
  }

  private getTimeCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'sleep',
        kind: monaco.languages.CompletionItemKind.Function,
        documentation: 'Sleep for specified seconds',
        insertText: 'sleep'
      },
      {
        label: 'monotonic',
        kind: monaco.languages.CompletionItemKind.Function,
        documentation: 'Get monotonic time in seconds',
        insertText: 'monotonic'
      },
      {
        label: 'time',
        kind: monaco.languages.CompletionItemKind.Function,
        documentation: 'Get current time since epoch',
        insertText: 'time'
      }
    ];
  }

  private getMicrocontrollerCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'Pin',
        kind: monaco.languages.CompletionItemKind.Class,
        documentation: 'Microcontroller pin class',
        insertText: 'Pin'
      },
      {
        label: 'reset',
        kind: monaco.languages.CompletionItemKind.Function,
        documentation: 'Reset the microcontroller',
        insertText: 'reset'
      },
      {
        label: 'cpu',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'CPU information object',
        insertText: 'cpu'
      }
    ];
  }

  private isDigitalInOutObject(model: monaco.editor.ITextModel, variableName: string): boolean {
    const content = model.getValue();
    const regex = new RegExp(`${variableName}\\s*=\\s*digitalio\\.DigitalInOut`, 'm');
    return regex.test(content);
  }

  private isAnalogInObject(model: monaco.editor.ITextModel, variableName: string): boolean {
    const content = model.getValue();
    const regex = new RegExp(`${variableName}\\s*=\\s*analogio\\.AnalogIn`, 'm');
    return regex.test(content);
  }

  private isAnalogOutObject(model: monaco.editor.ITextModel, variableName: string): boolean {
    const content = model.getValue();
    const regex = new RegExp(`${variableName}\\s*=\\s*analogio\\.AnalogOut`, 'm');
    return regex.test(content);
  }

  private getDigitalInOutAttributeCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'direction',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'Pin direction (INPUT or OUTPUT)',
        insertText: 'direction'
      },
      {
        label: 'value',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'Digital value (True or False)',
        insertText: 'value'
      },
      {
        label: 'pull',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'Pull resistor configuration',
        insertText: 'pull'
      },
      {
        label: 'drive_mode',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'Output drive mode',
        insertText: 'drive_mode'
      },
      {
        label: 'deinit', 
        kind: monaco.languages.CompletionItemKind.Method,
        documentation: 'Deinitialize the pin',
        insertText: 'deinit()'
      }
    ];
  }

  private getAnalogInAttributeCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'value',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'Raw analog value (0-65535)',
        insertText: 'value'
      },
      {
        label: 'reference_voltage',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'Reference voltage for analog reads',
        insertText: 'reference_voltage'
      },
      {
        label: 'deinit',
        kind: monaco.languages.CompletionItemKind.Method,
        documentation: 'Deinitialize the pin',
        insertText: 'deinit()'
      }
    ];
  }

  private getAnalogOutAttributeCompletions(): monaco.languages.CompletionItem[] {
    return [
      {
        label: 'value',
        kind: monaco.languages.CompletionItemKind.Property,
        documentation: 'Analog output value (0-65535)',
        insertText: 'value'
      },
      {
        label: 'deinit',
        kind: monaco.languages.CompletionItemKind.Method,
        documentation: 'Deinitialize the pin',
        insertText: 'deinit()'
      }
    ];
  }

  /**
   * Get loaded stub names
   */
  getLoadedStubs(): string[] {
    return Array.from(this.loadedStubs);
  }

  /**
   * Clear all loaded stubs
   */
  clearStubs(): void {
    this.loadedStubs.clear();
    this.stubCache.clear();
  }
}