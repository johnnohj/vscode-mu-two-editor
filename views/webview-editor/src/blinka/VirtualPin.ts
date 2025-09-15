/**
 * Virtual Pin implementation for Mu 2 Editor Blinka integration
 * Bridges Blinka API calls to CircuitPython device via serial communication
 */

export enum PinDirection {
  INPUT = 0,
  OUTPUT = 1
}

export enum PinValue {
  LOW = 0,
  HIGH = 1
}

export enum PullMode {
  NONE = 0,
  UP = 1,
  DOWN = 2
}

export interface SerialBridge {
  sendCommand(command: string): Promise<string>;
  isConnected(): boolean;
}

export class VirtualPin {
  public readonly id: number;
  private direction: PinDirection = PinDirection.INPUT;
  private pullMode: PullMode = PullMode.NONE;
  private serialBridge: SerialBridge | null = null;

  constructor(pinNumber: number) {
    this.id = pinNumber;
  }

  setSerialBridge(bridge: SerialBridge): void {
    this.serialBridge = bridge;
  }

  async setDirection(direction: PinDirection): Promise<void> {
    this.direction = direction;
    
    if (this.serialBridge?.isConnected()) {
      const directionStr = direction === PinDirection.OUTPUT ? 'OUTPUT' : 'INPUT';
      const command = `
import digitalio
import board
pin = digitalio.DigitalInOut(board.D${this.id})
pin.direction = digitalio.Direction.${directionStr}
`;
      await this.serialBridge.sendCommand(command);
    }
  }

  async setValue(value: PinValue): Promise<void> {
    if (this.direction !== PinDirection.OUTPUT) {
      throw new Error(`Pin D${this.id} must be set to OUTPUT before writing value`);
    }

    if (this.serialBridge?.isConnected()) {
      const command = `
pin.value = ${value === PinValue.HIGH ? 'True' : 'False'}
`;
      await this.serialBridge.sendCommand(command);
    }
  }

  async getValue(): Promise<PinValue> {
    if (this.serialBridge?.isConnected()) {
      const command = `print(pin.value)`;
      const result = await this.serialBridge.sendCommand(command);
      
      // Parse the result to determine pin value
      const output = result.toLowerCase().trim();
      if (output.includes('true') || output.includes('1')) {
        return PinValue.HIGH;
      }
    }
    
    return PinValue.LOW;
  }

  async setPullMode(mode: PullMode): Promise<void> {
    this.pullMode = mode;
    
    if (this.serialBridge?.isConnected()) {
      let pullStr = 'None';
      if (mode === PullMode.UP) pullStr = 'UP';
      else if (mode === PullMode.DOWN) pullStr = 'DOWN';
      
      const command = `
pin.pull = digitalio.Pull.${pullStr}
`;
      await this.serialBridge.sendCommand(command);
    }
  }

  getDirection(): PinDirection {
    return this.direction;
  }

  getPullMode(): PullMode {
    return this.pullMode;
  }

  // Hash function for compatibility with Blinka pin collections
  hash(): number {
    return this.id;
  }
}