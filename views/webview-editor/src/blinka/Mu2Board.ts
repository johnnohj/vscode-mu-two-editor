/**
 * Mu 2 Editor Virtual Board Implementation
 * Provides a Blinka-compatible board interface that bridges to CircuitPython devices
 */

import { VirtualPin, SerialBridge } from './VirtualPin';

export interface BoardInfo {
  boardId: string;
  name: string;
  pins: number[];
  i2cPins?: { sda: number; scl: number };
  spiPins?: { mosi: number; miso: number; sck: number };
  uartPins?: { tx: number; rx: number };
}

export class Mu2Board {
  public readonly boardInfo: BoardInfo;
  private pins: Map<number, VirtualPin> = new Map();
  private serialBridge: SerialBridge | null = null;

  // Standard pin definitions (can be dynamically mapped based on detected board)
  public readonly D0: VirtualPin;
  public readonly D1: VirtualPin;
  public readonly D2: VirtualPin;
  public readonly D3: VirtualPin;
  public readonly D4: VirtualPin;
  public readonly D5: VirtualPin;
  public readonly D6: VirtualPin;
  public readonly D7: VirtualPin;
  public readonly D8: VirtualPin;
  public readonly D9: VirtualPin;
  public readonly D10: VirtualPin;
  public readonly D11: VirtualPin;
  public readonly D12: VirtualPin;
  public readonly D13: VirtualPin;
  public readonly D14: VirtualPin;
  public readonly D15: VirtualPin;

  // Common aliases
  public readonly LED: VirtualPin;
  public readonly SDA?: VirtualPin;
  public readonly SCL?: VirtualPin;
  public readonly MOSI?: VirtualPin;
  public readonly MISO?: VirtualPin;
  public readonly SCK?: VirtualPin;
  public readonly TX?: VirtualPin;
  public readonly RX?: VirtualPin;

  constructor(boardInfo?: BoardInfo) {
    this.boardInfo = boardInfo || {
      boardId: 'MU2_VIRTUAL',
      name: 'Mu 2 Editor Virtual Board',
      pins: Array.from({ length: 16 }, (_, i) => i)
    };

    // Create virtual pins
    this.D0 = this.createPin(0);
    this.D1 = this.createPin(1);
    this.D2 = this.createPin(2);
    this.D3 = this.createPin(3);
    this.D4 = this.createPin(4);
    this.D5 = this.createPin(5);
    this.D6 = this.createPin(6);
    this.D7 = this.createPin(7);
    this.D8 = this.createPin(8);
    this.D9 = this.createPin(9);
    this.D10 = this.createPin(10);
    this.D11 = this.createPin(11);
    this.D12 = this.createPin(12);
    this.D13 = this.createPin(13);
    this.D14 = this.createPin(14);
    this.D15 = this.createPin(15);

    // Set up common aliases
    this.LED = this.D13; // Common LED pin

    // Set up I2C pins if defined
    if (this.boardInfo.i2cPins) {
      this.SDA = this.getPin(this.boardInfo.i2cPins.sda);
      this.SCL = this.getPin(this.boardInfo.i2cPins.scl);
    }

    // Set up SPI pins if defined
    if (this.boardInfo.spiPins) {
      this.MOSI = this.getPin(this.boardInfo.spiPins.mosi);
      this.MISO = this.getPin(this.boardInfo.spiPins.miso);
      this.SCK = this.getPin(this.boardInfo.spiPins.sck);
    }

    // Set up UART pins if defined
    if (this.boardInfo.uartPins) {
      this.TX = this.getPin(this.boardInfo.uartPins.tx);
      this.RX = this.getPin(this.boardInfo.uartPins.rx);
    }
  }

  private createPin(pinNumber: number): VirtualPin {
    const pin = new VirtualPin(pinNumber);
    this.pins.set(pinNumber, pin);
    
    if (this.serialBridge) {
      pin.setSerialBridge(this.serialBridge);
    }
    
    return pin;
  }

  getPin(pinNumber: number): VirtualPin | undefined {
    return this.pins.get(pinNumber);
  }

  setSerialBridge(bridge: SerialBridge): void {
    this.serialBridge = bridge;
    
    // Update all existing pins with the serial bridge
    this.pins.forEach(pin => {
      pin.setSerialBridge(bridge);
    });
  }

  async initializeBoard(): Promise<void> {
    if (this.serialBridge?.isConnected()) {
      // Send initialization commands to set up the board environment
      const initCommand = `
# Mu 2 Editor Board Initialization
import board
import digitalio
import busio
print("Mu 2 Editor virtual board initialized")
print(f"Board ID: {dir(board)}")
`;
      await this.serialBridge.sendCommand(initCommand);
    }
  }

  async detectActualBoard(): Promise<BoardInfo | null> {
    if (this.serialBridge?.isConnected()) {
      try {
        const detectionCommand = `
# Detect actual CircuitPython board
import board
import sys

# Get board information
board_id = getattr(board, 'board_id', 'unknown')
board_pins = [attr for attr in dir(board) if attr.startswith('D') or attr in ['LED', 'SDA', 'SCL', 'MOSI', 'MISO', 'SCK', 'TX', 'RX']]

print(f"BOARD_ID:{board_id}")
print(f"BOARD_PINS:{','.join(board_pins)}")
`;
        
        const result = await this.serialBridge.sendCommand(detectionCommand);
        
        // Parse the detection result
        const lines = result.split('\n');
        let boardId = 'unknown';
        let pins: number[] = [];
        
        for (const line of lines) {
          if (line.startsWith('BOARD_ID:')) {
            boardId = line.substring(9).trim();
          } else if (line.startsWith('BOARD_PINS:')) {
            const pinNames = line.substring(11).trim().split(',');
            pins = pinNames
              .filter(name => name.startsWith('D'))
              .map(name => parseInt(name.substring(1)))
              .filter(num => !isNaN(num));
          }
        }
        
        if (boardId !== 'unknown') {
          return {
            boardId,
            name: `CircuitPython ${boardId}`,
            pins,
            i2cPins: { sda: 2, scl: 3 }, // Default I2C pins
            spiPins: { mosi: 10, miso: 11, sck: 12 }, // Default SPI pins
            uartPins: { tx: 14, rx: 15 } // Default UART pins
          };
        }
      } catch (error) {
        console.error('Failed to detect actual board:', error);
      }
    }
    
    return null;
  }

  // Blinka compatibility methods
  getAllPins(): VirtualPin[] {
    return Array.from(this.pins.values());
  }

  getPinByName(name: string): VirtualPin | undefined {
    // Handle named pin lookups (D0, LED, SDA, etc.)
    const propertyName = name as keyof Mu2Board;
    const pin = this[propertyName];
    
    if (pin instanceof VirtualPin) {
      return pin;
    }
    
    return undefined;
  }
}