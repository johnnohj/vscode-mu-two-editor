/**
 * Mu 2 Editor Blinka Wrapper
 * Main entry point for Blinka integration with Mu 2 Editor
 */

export { VirtualPin, PinDirection, PinValue, PullMode } from './VirtualPin';
export { Mu2Board } from './Mu2Board';
export { Mu2SerialBridge } from './SerialBridge';

import { Mu2Board, BoardInfo } from './Mu2Board';
import { Mu2SerialBridge } from './SerialBridge';
import { BlinkaInterface } from '../components/BlinkaProvider';

export interface BlinkaWrapperConfig {
  autoDetectBoard?: boolean;
  defaultBoardInfo?: BoardInfo;
  enableLogging?: boolean;
}

export class BlinkaWrapper {
  private board: Mu2Board;
  private serialBridge: Mu2SerialBridge;
  private config: BlinkaWrapperConfig;

  constructor(config: BlinkaWrapperConfig = {}) {
    this.config = {
      autoDetectBoard: true,
      enableLogging: false,
      ...config
    };

    this.serialBridge = new Mu2SerialBridge();
    this.board = new Mu2Board(this.config.defaultBoardInfo);
    this.board.setSerialBridge(this.serialBridge);
  }

  async initialize(blinkaInterface: BlinkaInterface): Promise<void> {
    this.log('Initializing Blinka wrapper...');
    
    this.serialBridge.setBlinkaInterface(blinkaInterface);
    
    // Test the connection
    const isConnected = await this.serialBridge.testConnection();
    if (!isConnected) {
      throw new Error('Failed to establish connection with CircuitPython device');
    }

    this.log('Connection established');

    // Set up Blinka environment variables first
    this.log('Setting up Blinka environment...');
    try {
      const setupResult = await this.serialBridge.setupBlinkaEnvironment();
      this.log('Blinka environment setup result:', setupResult);
      
      if (setupResult.includes('BLINKA_IMPORT:ERROR')) {
        throw new Error('Blinka import failed - check installation');
      }
    } catch (error) {
      this.log('Blinka environment setup failed:', error);
      throw new Error(`Blinka environment setup failed: ${error.message}`);
    }

    // Initialize the board
    await this.board.initializeBoard();
    this.log('Board initialized');

    // Auto-detect actual board if enabled
    if (this.config.autoDetectBoard) {
      await this.detectAndConfigureBoard();
    }

    // Set environment variable to indicate Mu 2 board is available
    this.setEnvironmentMarkers();
    
    this.log('Blinka wrapper initialization complete');
  }

  private async detectAndConfigureBoard(): Promise<void> {
    this.log('Detecting actual CircuitPython board...');
    
    try {
      const detectedBoard = await this.board.detectActualBoard();
      if (detectedBoard) {
        this.log(`Detected board: ${detectedBoard.name} (${detectedBoard.boardId})`);
        
        // Create new board instance with detected configuration
        this.board = new Mu2Board(detectedBoard);
        this.board.setSerialBridge(this.serialBridge);
      } else {
        this.log('Could not detect specific board, using default configuration');
      }
    } catch (error) {
      this.log('Board detection failed, using default configuration:', error);
    }
  }

  private setEnvironmentMarkers(): void {
    // Set Blinka platform detection environment variables
    const envVars = {
      'BLINKA_FORCEBOARD': 'GENERIC_LINUX_PC',
      'BLINKA_FORCECHIP': 'GENERIC_X86',
      'MU2_EDITOR_BOARD': '1',
      'BLINKA_MU2_VIRTUAL': '1'
    };

    // Set environment variables for Blinka detection
    if (typeof window !== 'undefined' && (window as any).process?.env) {
      Object.entries(envVars).forEach(([key, value]) => {
        (window as any).process.env[key] = value;
      });
    }
    
    // Also set markers on global object for detection
    Object.entries(envVars).forEach(([key, value]) => {
      (globalThis as any)[key] = value;
    });
    
    this.log('Environment variables set for Blinka platform detection:', envVars);
  }

  getBoard(): Mu2Board {
    return this.board;
  }

  getSerialBridge(): Mu2SerialBridge {
    return this.serialBridge;
  }

  async getBoardInfo(): Promise<BoardInfo> {
    return this.board.boardInfo;
  }

  async getActualBoardInfo(): Promise<{ boardId: string; pins: string[] }> {
    return await this.serialBridge.getBoardInfo();
  }

  isConnected(): boolean {
    return this.serialBridge.isConnected();
  }

  private log(message: string, ...args: any[]): void {
    if (this.config.enableLogging) {
      console.log(`[BlinkaWrapper] ${message}`, ...args);
    }
  }

  dispose(): void {
    this.log('Disposing Blinka wrapper...');
    this.serialBridge.dispose();
  }
}

// Global instance for easy access
let globalBlinkaWrapper: BlinkaWrapper | null = null;

export function createBlinkaWrapper(config?: BlinkaWrapperConfig): BlinkaWrapper {
  if (globalBlinkaWrapper) {
    globalBlinkaWrapper.dispose();
  }
  
  globalBlinkaWrapper = new BlinkaWrapper(config);
  
  // Make it available globally for Blinka detection
  (globalThis as any).mu2BlinkaWrapper = globalBlinkaWrapper;
  
  return globalBlinkaWrapper;
}

export function getBlinkaWrapper(): BlinkaWrapper | null {
  return globalBlinkaWrapper;
}

// Blinka-compatible board object for environment detection
export function createBlinkaBoard(): any {
  const wrapper = getBlinkaWrapper();
  if (!wrapper) {
    throw new Error('Blinka wrapper not initialized. Call createBlinkaWrapper() first.');
  }

  const board = wrapper.getBoard();
  
  // Return an object that matches Blinka's expected board interface
  return {
    // Pin definitions
    D0: board.D0,
    D1: board.D1,
    D2: board.D2,
    D3: board.D3,
    D4: board.D4,
    D5: board.D5,
    D6: board.D6,
    D7: board.D7,
    D8: board.D8,
    D9: board.D9,
    D10: board.D10,
    D11: board.D11,
    D12: board.D12,
    D13: board.D13,
    D14: board.D14,
    D15: board.D15,
    
    // Common aliases
    LED: board.LED,
    SDA: board.SDA,
    SCL: board.SCL,
    MOSI: board.MOSI,
    MISO: board.MISO,
    SCK: board.SCK,
    TX: board.TX,
    RX: board.RX,
    
    // Board info
    board_id: board.boardInfo.boardId,
    
    // Methods for compatibility
    get_pin: (name: string) => board.getPinByName(name),
    get_all_pins: () => board.getAllPins()
  };
}