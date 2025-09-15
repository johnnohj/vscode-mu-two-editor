/**
 * CircuitPython Debug State Provider
 * Listens to PyScript state updates and provides them to VS Code's debug sidepanel
 * Focused on peripheral register inspection and board state observation
 */

import * as vscode from 'vscode';

export interface CircuitPythonDebugState {
  // Board state
  board: {
    id: string;
    name: string;
    pins: PinState[];
    connected: boolean;
  };
  
  // Peripheral registers (the key insight from Adafruit's i2c debug library)
  peripherals: {
    i2c: I2CRegisterState[];
    spi: SPIRegisterState[];
    gpio: GPIORegisterState[];
    adc: ADCRegisterState[];
    uart: UARTRegisterState[];
  };
  
  // Memory state
  memory: {
    heapUsed: number;
    heapFree: number;
    heapTotal: number;
  };
  
  // Execution context
  execution: {
    currentFile: string;
    lastCommand: string;
    isRunning: boolean;
  };
}

export interface PinState {
  name: string;
  value: boolean | number;
  mode: 'input' | 'output' | 'analog' | 'pwm';
  lastChanged: number;
}

export interface I2CRegisterState {
  deviceAddress: number;
  registerAddress: number;
  valueBefore: number;
  valueAfter: number;
  timestamp: number;
  operation: 'read' | 'write';
}

export interface SPIRegisterState {
  chipSelect: string;
  clockSpeed: number;
  dataOut: number[];
  dataIn: number[];
  timestamp: number;
}

export interface GPIORegisterState {
  pin: string;
  value: boolean;
  direction: 'in' | 'out';
  pullMode: 'none' | 'up' | 'down';
  timestamp: number;
}

export interface ADCRegisterState {
  pin: string;
  value: number;
  voltage: number;
  timestamp: number;
}

export interface UARTRegisterState {
  port: string;
  baudRate: number;
  bytesOut: number[];
  bytesIn: number[];
  timestamp: number;
}

/**
 * VS Code Debug Variable Provider for CircuitPython
 * Integrates with VS Code's built-in debug sidepanel
 */
export class CircuitPythonDebugProvider implements vscode.DebugAdapterTracker {
  private currentState: CircuitPythonDebugState | null = null;
  private session: vscode.DebugSession | null = null;
  private stateUpdateEmitter = new vscode.EventEmitter<CircuitPythonDebugState>();
  
  public readonly onDidChangeState = this.stateUpdateEmitter.event;

  constructor(private context: vscode.ExtensionContext) {}

  private updateBuffer: CircuitPythonDebugState[] = [];
  private lastUpdateTime = 0;
  private bufferTimer: NodeJS.Timeout | undefined;
  private readonly UPDATE_THRESHOLD_MS = 50; // Start buffering if updates come faster than 50ms
  private readonly BUFFER_FLUSH_MS = 200; // Flush buffer every 200ms when buffering

  /**
   * Called when PyScript outputs state updates
   */
  updateStateFromPyScript(stateOutput: string): void {
    try {
      // Parse PyScript state output - expecting JSON format like:
      // {"type": "state_update", "data": {...}}
      const parsed = JSON.parse(stateOutput);
      
      if (parsed.type === 'state_update') {
        const newState = this.transformPyScriptState(parsed.data);
        this.handleStateUpdate(newState);
      }
    } catch (error) {
      console.error('Failed to parse PyScript state output:', error);
    }
  }

  /**
   * Smart buffering: immediate updates for slow changes, buffered for rapid changes
   */
  private handleStateUpdate(newState: CircuitPythonDebugState): void {
    const now = Date.now();
    const timeSinceLastUpdate = now - this.lastUpdateTime;

    if (timeSinceLastUpdate > this.UPDATE_THRESHOLD_MS) {
      // Updates are slow enough - send immediately
      this.currentState = newState;
      this.notifyDebugSession();
      this.stateUpdateEmitter.fire(this.currentState);
      this.lastUpdateTime = now;
    } else {
      // Updates coming too fast - start buffering
      this.updateBuffer.push(newState);
      
      if (!this.bufferTimer) {
        this.bufferTimer = setTimeout(() => {
          this.flushUpdateBuffer();
        }, this.BUFFER_FLUSH_MS);
      }
    }
  }

  /**
   * Flush buffered updates (use the most recent state)
   */
  private flushUpdateBuffer(): void {
    if (this.updateBuffer.length > 0) {
      this.currentState = this.updateBuffer[this.updateBuffer.length - 1];
      this.notifyDebugSession();
      this.stateUpdateEmitter.fire(this.currentState);
      this.updateBuffer = [];
      this.lastUpdateTime = Date.now();
    }
    
    this.bufferTimer = undefined;
  }

  /**
   * Transform PyScript state format to our debug state format
   */
  private transformPyScriptState(pyScriptData: any): CircuitPythonDebugState {
    return {
      board: {
        id: pyScriptData.board?.id || 'unknown',
        name: pyScriptData.board?.name || 'PyScript Virtual Board',
        pins: this.transformPins(pyScriptData.pins || []),
        connected: pyScriptData.board?.connected ?? true
      },
      
      peripherals: {
        i2c: this.transformI2CRegisters(pyScriptData.i2c || []),
        spi: this.transformSPIRegisters(pyScriptData.spi || []),
        gpio: this.transformGPIORegisters(pyScriptData.gpio || []),
        adc: this.transformADCRegisters(pyScriptData.adc || []),
        uart: this.transformUARTRegisters(pyScriptData.uart || [])
      },
      
      memory: {
        heapUsed: pyScriptData.memory?.used || 0,
        heapFree: pyScriptData.memory?.free || 0,
        heapTotal: pyScriptData.memory?.total || 0
      },
      
      execution: {
        currentFile: pyScriptData.execution?.file || 'main.py',
        lastCommand: pyScriptData.execution?.lastCommand || '',
        isRunning: pyScriptData.execution?.running ?? false
      }
    };
  }

  private transformPins(pins: any[]): PinState[] {
    return pins.map(pin => ({
      name: pin.name,
      value: pin.value,
      mode: pin.mode || 'input',
      lastChanged: pin.lastChanged || Date.now()
    }));
  }

  private transformI2CRegisters(i2cData: any[]): I2CRegisterState[] {
    return i2cData.map(reg => ({
      deviceAddress: reg.deviceAddr,
      registerAddress: reg.regAddr,
      valueBefore: reg.before,
      valueAfter: reg.after,
      timestamp: reg.timestamp || Date.now(),
      operation: reg.op
    }));
  }

  private transformSPIRegisters(spiData: any[]): SPIRegisterState[] {
    return spiData.map(spi => ({
      chipSelect: spi.cs,
      clockSpeed: spi.clock,
      dataOut: spi.out || [],
      dataIn: spi.in || [],
      timestamp: spi.timestamp || Date.now()
    }));
  }

  private transformGPIORegisters(gpioData: any[]): GPIORegisterState[] {
    return gpioData.map(gpio => ({
      pin: gpio.pin,
      value: gpio.value,
      direction: gpio.dir,
      pullMode: gpio.pull || 'none',
      timestamp: gpio.timestamp || Date.now()
    }));
  }

  private transformADCRegisters(adcData: any[]): ADCRegisterState[] {
    return adcData.map(adc => ({
      pin: adc.pin,
      value: adc.value,
      voltage: adc.voltage,
      timestamp: adc.timestamp || Date.now()
    }));
  }

  private transformUARTRegisters(uartData: any[]): UARTRegisterState[] {
    return uartData.map(uart => ({
      port: uart.port,
      baudRate: uart.baud,
      bytesOut: uart.out || [],
      bytesIn: uart.in || [],
      timestamp: uart.timestamp || Date.now()
    }));
  }

  /**
   * Notify the debug session of state changes for the sidepanel
   */
  private notifyDebugSession(): void {
    if (!this.session || !this.currentState) return;

    // Create debug variables for VS Code's debug sidepanel
    const variables = this.createDebugVariables(this.currentState);
    
    // Send custom event to update debug sidepanel
    this.session.customRequest('updateVariables', { variables });
  }

  /**
   * Create debug variables structure for VS Code sidepanel
   */
  private createDebugVariables(state: CircuitPythonDebugState): any {
    return {
      name: 'CircuitPython Board State',
      value: state.board.name,
      type: 'object',
      variablesReference: 1,
      children: [
        {
          name: 'Board Info',
          value: `${state.board.name} (${state.board.connected ? 'Connected' : 'Disconnected'})`,
          type: 'object',
          variablesReference: 2,
          children: [
            { name: 'ID', value: state.board.id, type: 'string' },
            { name: 'Connected', value: state.board.connected.toString(), type: 'boolean' },
            { name: 'Pin Count', value: state.board.pins.length.toString(), type: 'number' }
          ]
        },
        
        {
          name: 'GPIO Pins',
          value: `${state.board.pins.length} pins`,
          type: 'object',
          variablesReference: 4,
          children: state.board.pins.map((pin, index) => ({
            name: pin.name,
            value: `${pin.value} (${pin.mode})`,
            type: pin.mode === 'analog' ? 'number' : 'boolean',
            variablesReference: 0
          }))
        },

        {
          name: 'I2C Registers',
          value: `${state.peripherals.i2c.length} transactions`,
          type: 'object',
          variablesReference: 5,
          children: state.peripherals.i2c.slice(-10).map((reg, index) => ({
            name: `0x${reg.deviceAddress.toString(16).padStart(2, '0')}:0x${reg.registerAddress.toString(16).padStart(2, '0')}`,
            value: `${reg.valueBefore} → ${reg.valueAfter} (${reg.operation})`,
            type: 'object',
            variablesReference: 0
          }))
        },

        {
          name: 'SPI Registers',
          value: `${state.peripherals.spi.length} transactions`,
          type: 'object',
          variablesReference: 6,
          children: state.peripherals.spi.slice(-5).map((spi, index) => ({
            name: `${spi.chipSelect} @ ${spi.clockSpeed}Hz`,
            value: `Out: [${spi.dataOut.map(b => '0x' + b.toString(16)).join(', ')}] In: [${spi.dataIn.map(b => '0x' + b.toString(16)).join(', ')}]`,
            type: 'object',
            variablesReference: 0
          }))
        },

        {
          name: 'UART Registers',
          value: `${state.peripherals.uart.length} transactions`,
          type: 'object',
          variablesReference: 9,
          children: state.peripherals.uart.slice(-5).map((uart, index) => ({
            name: `${uart.port} @ ${uart.baudRate} baud`,
            value: `Out: ${uart.bytesOut.length}B, In: ${uart.bytesIn.length}B`,
            type: 'object',
            variablesReference: 0
          }))
        },

        {
          name: 'ADC Readings',
          value: `${state.peripherals.adc.length} channels`,
          type: 'object',
          variablesReference: 7,
          children: state.peripherals.adc.map((adc, index) => ({
            name: adc.pin,
            value: `${adc.value} (${adc.voltage.toFixed(2)}V)`,
            type: 'number',
            variablesReference: 0
          }))
        },
        
        {
          name: 'Memory',
          value: `${state.memory.heapUsed}/${state.memory.heapTotal} bytes`,
          type: 'object',
          variablesReference: 3,
          children: [
            { name: 'Heap Used', value: state.memory.heapUsed.toString(), type: 'number' },
            { name: 'Heap Free', value: state.memory.heapFree.toString(), type: 'number' },
            { name: 'Heap Total', value: state.memory.heapTotal.toString(), type: 'number' },
            { 
              name: 'Usage %', 
              value: state.memory.heapTotal > 0 ? 
                Math.round((state.memory.heapUsed / state.memory.heapTotal) * 100).toString() + '%' : '0%',
              type: 'number' 
            }
          ]
        },

        {
          name: 'Execution',
          value: state.execution.isRunning ? 'Running' : 'Stopped',
          type: 'object',
          variablesReference: 8,
          children: [
            { name: 'Current File', value: state.execution.currentFile, type: 'string' },
            { name: 'Last Command', value: state.execution.lastCommand, type: 'string' },
            { name: 'Is Running', value: state.execution.isRunning.toString(), type: 'boolean' }
          ]
        }
      ]
    };
  }

  /**
   * Debug adapter tracker methods
   */
  onWillStartSession(session: vscode.DebugSession): void {
    this.session = session;
  }

  onWillStopSession(session: vscode.DebugSession): void {
    if (this.session === session) {
      this.session = null;
    }
  }

  /**
   * Get current state for external access
   */
  getCurrentState(): CircuitPythonDebugState | null {
    return this.currentState;
  }

  /**
   * Manual state update for testing
   */
  updateState(state: CircuitPythonDebugState): void {
    this.currentState = state;
    this.notifyDebugSession();
    this.stateUpdateEmitter.fire(state);
  }

  dispose(): void {
    if (this.bufferTimer) {
      clearTimeout(this.bufferTimer);
    }
    this.stateUpdateEmitter.dispose();
  }
}

/**
 * Register the debug provider with VS Code
 */
export function registerCircuitPythonDebugProvider(context: vscode.ExtensionContext): CircuitPythonDebugProvider {
  const provider = new CircuitPythonDebugProvider(context);

  // Register as debug adapter tracker to integrate with VS Code's debug sidepanel
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterTrackerFactory('circuitpython', {
      createDebugAdapterTracker: (session) => provider
    })
  );

  return provider;
}