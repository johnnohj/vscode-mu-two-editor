/**
 * Serial Bridge Implementation for Mu 2 Editor Blinka Integration
 * Handles communication between virtual pins and actual CircuitPython device
 */

import { SerialBridge } from './VirtualPin';
import { BlinkaInterface } from '../components/BlinkaProvider';

export class Mu2SerialBridge implements SerialBridge {
  private blinkaInterface: BlinkaInterface | null = null;
  private commandQueue: Array<{ command: string; resolve: Function; reject: Function }> = [];
  private isProcessing = false;

  constructor(blinkaInterface?: BlinkaInterface) {
    if (blinkaInterface) {
      this.blinkaInterface = blinkaInterface;
    }
  }

  setBlinkaInterface(blinkaInterface: BlinkaInterface): void {
    this.blinkaInterface = blinkaInterface;
  }

  isConnected(): boolean {
    return this.blinkaInterface?.isConnected() ?? false;
  }

  async sendCommand(command: string): Promise<string> {
    if (!this.blinkaInterface || !this.isConnected()) {
      throw new Error('Not connected to CircuitPython device');
    }

    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, resolve, reject });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.commandQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      while (this.commandQueue.length > 0) {
        const { command, resolve, reject } = this.commandQueue.shift()!;

        try {
          const result = await this.executeCommand(command);
          resolve(result);
        } catch (error) {
          reject(error);
        }

        // Small delay between commands to prevent overwhelming the device
        await this.delay(50);
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeCommand(command: string): Promise<string> {
    if (!this.blinkaInterface) {
      throw new Error('Blinka interface not available');
    }

    // Clean up the command - remove extra whitespace and ensure proper formatting
    const cleanCommand = command
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n');

    // Execute the command via the Blinka interface
    const output = await this.blinkaInterface.executeCode(cleanCommand);
    
    return output;
  }

  async sendPinCommand(pinNumber: number, operation: string, value?: any): Promise<string> {
    let command = '';

    switch (operation) {
      case 'setup_output':
        command = `
import digitalio
import board
pin_${pinNumber} = digitalio.DigitalInOut(board.D${pinNumber})
pin_${pinNumber}.direction = digitalio.Direction.OUTPUT
print(f"Pin D${pinNumber} set to OUTPUT")
`;
        break;

      case 'setup_input':
        command = `
import digitalio
import board
pin_${pinNumber} = digitalio.DigitalInOut(board.D${pinNumber})
pin_${pinNumber}.direction = digitalio.Direction.INPUT
print(f"Pin D${pinNumber} set to INPUT")
`;
        break;

      case 'write':
        command = `
pin_${pinNumber}.value = ${value ? 'True' : 'False'}
print(f"Pin D${pinNumber} = {value ? 'HIGH' : 'LOW'}")
`;
        break;

      case 'read':
        command = `
value = pin_${pinNumber}.value
print(f"D${pinNumber}_VALUE:{value}")
`;
        break;

      case 'set_pull':
        let pullValue = 'None';
        if (value === 1) pullValue = 'UP';
        else if (value === 2) pullValue = 'DOWN';
        
        command = `
pin_${pinNumber}.pull = digitalio.Pull.${pullValue}
print(f"Pin D${pinNumber} pull set to {pullValue}")
`;
        break;

      default:
        throw new Error(`Unknown pin operation: ${operation}`);
    }

    return await this.sendCommand(command);
  }

  async setupI2C(sdaPin: number, sclPin: number): Promise<string> {
    const command = `
import busio
import board
i2c = busio.I2C(board.D${sclPin}, board.D${sdaPin})
print(f"I2C initialized on SDA=D${sdaPin}, SCL=D${sclPin}")
`;
    return await this.sendCommand(command);
  }

  async setupSPI(sckPin: number, mosiPin: number, misoPin: number): Promise<string> {
    const command = `
import busio
import board
spi = busio.SPI(board.D${sckPin}, MOSI=board.D${mosiPin}, MISO=board.D${misoPin})
print(f"SPI initialized on SCK=D${sckPin}, MOSI=D${mosiPin}, MISO=D${misoPin}")
`;
    return await this.sendCommand(command);
  }

  async setupUART(txPin: number, rxPin: number, baudrate: number = 9600): Promise<string> {
    const command = `
import busio
import board
uart = busio.UART(board.D${txPin}, board.D${rxPin}, baudrate=${baudrate})
print(f"UART initialized on TX=D${txPin}, RX=D${rxPin}, baudrate={baudrate}")
`;
    return await this.sendCommand(command);
  }

  async setupBlinkaEnvironment(): Promise<string> {
    // Note: This method is now handled by the extension's Python script
    // via the setup_blinka message type, so we just return a success message
    return "BLINKA_ENV_SETUP:SUCCESS\nBLINKA_IMPORT:SUCCESS";
  }

  async getBoardInfo(): Promise<{ boardId: string; pins: string[] }> {
    const command = `
try:
    import board
    from adafruit_platformdetect import Detector
    
    detector = Detector()
    board_id = detector.board.id
    board_pins = [attr for attr in dir(board) if not attr.startswith('_')]
    
    print(f"BOARD_INFO:{board_id}:{','.join(board_pins)}")
except Exception as e:
    print(f"BOARD_INFO:error:{str(e)}")
`;
    
    const result = await this.sendCommand(command);
    
    // Parse the board info from the output
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.startsWith('BOARD_INFO:')) {
        const parts = line.substring(11).split(':');
        if (parts.length >= 2) {
          return {
            boardId: parts[0],
            pins: parts[1] ? parts[1].split(',') : []
          };
        }
      }
    }

    return { boardId: 'unknown', pins: [] };
  }

  async testConnection(): Promise<boolean> {
    try {
      const command = `
print("BRIDGE_TEST:OK")
`;
      const result = await this.sendCommand(command);
      return result.includes('BRIDGE_TEST:OK');
    } catch (error) {
      console.error('Bridge connection test failed:', error);
      return false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Cleanup method
  dispose(): void {
    // Reject any pending commands
    this.commandQueue.forEach(({ reject }) => {
      reject(new Error('Serial bridge disposed'));
    });
    this.commandQueue = [];
    this.isProcessing = false;
  }
}