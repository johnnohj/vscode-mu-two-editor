import { useRef, useEffect, useState } from 'preact/hooks';
import { BlinkaWrapper, createBlinkaWrapper, getBlinkaWrapper } from '../blinka';

export interface VirtualHardware {
  pins: Map<string, any>;
  i2cDevices: number[];
  spiConfig: any;
  uartConfig: any;
}

export interface BlinkaInterface {
  connect(): Promise<boolean>;
  disconnect(): void;
  executeCode(code: string): Promise<string>;
  processInput(input: string): Promise<string>;
  isConnected(): boolean;
  getHardwareState(): VirtualHardware;
  getBlinkaWrapper?(): BlinkaWrapper | null;
}

interface BlinkaProviderProps {
  onOutput?: (output: string) => void;
  onReady?: (blinka: BlinkaInterface) => void;
  onError?: (error: string) => void;
  children?: any;
}

export function BlinkaProvider({ onOutput, onReady, onError, children }: BlinkaProviderProps) {
  const blinkaRef = useRef<BlinkaInterface | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const blinkaWrapperRef = useRef<BlinkaWrapper | null>(null);
  const vscode = (window as any).vscode;
  
  // Message counter for tracking responses
  const messageIdRef = useRef(0);
  const pendingRequestsRef = useRef<Map<string, { resolve: Function, reject: Function }>>(new Map());

  useEffect(() => {
    console.log('BlinkaProvider: Initializing Blinka REPL communication...');
    
    // Set up message listener for responses from Python process
    const messageListener = (event: MessageEvent) => {
      const message = event.data;
      
      if (message.type === 'python-response') {
        const { id, data } = message;
        const pending = pendingRequestsRef.current.get(id);
        
        if (pending) {
          pendingRequestsRef.current.delete(id);
          
          if (data.type === 'error') {
            pending.reject(new Error(data.message));
          } else {
            pending.resolve(data);
          }
        }
      } else if (message.type === 'python-startup') {
        // Handle startup message separately if needed
        console.log('Python REPL started:', message.data);
        onOutput?.(message.data);
      } else if (message.type === 'python-output') {
        // Handle output from Python process
        onOutput?.(message.data);
      }
    };
    
    window.addEventListener('message', messageListener);
    
    // Send Python command via extension host
    const sendPythonMessage = (messageType: string, data: any = {}): Promise<any> => {
      return new Promise((resolve, reject) => {
        const id = `msg-${++messageIdRef.current}`;
        
        pendingRequestsRef.current.set(id, { resolve, reject });
        
        // Send message to extension host
        vscode?.postMessage({
          type: 'python-command',
          id,
          messageType,
          data
        });
        
        // Set timeout
        setTimeout(() => {
          if (pendingRequestsRef.current.has(id)) {
            pendingRequestsRef.current.delete(id);
            reject(new Error('Python command timeout'));
          }
        }, 10000);
      });
    };
    
    // Initialize Blinka wrapper with the interface
    const initializeBlinkaWrapper = async () => {
      if (!blinkaInterface) return;
      
      try {
        console.log('BlinkaProvider: Initializing Blinka wrapper...');
        
        // Create the Blinka wrapper with configuration
        const wrapper = createBlinkaWrapper({
          autoDetectBoard: true,
          enableLogging: true
        });
        
        // Initialize with the current interface
        await wrapper.initialize(blinkaInterface);
        
        blinkaWrapperRef.current = wrapper;
        
        console.log('BlinkaProvider: Blinka wrapper initialized successfully');
        
        // Log detected board info
        const boardInfo = await wrapper.getBoardInfo();
        console.log('BlinkaProvider: Virtual board info:', boardInfo);
        
        // Notify extension about Blinka board availability
        vscode?.postMessage({
          type: 'blinka-board-ready',
          data: {
            boardId: boardInfo.boardId,
            boardName: boardInfo.name,
            pins: boardInfo.pins
          }
        });
        
      } catch (error) {
        console.error('BlinkaProvider: Failed to initialize Blinka wrapper:', error);
        onError?.(`Blinka wrapper initialization failed: ${error.message}`);
      }
    };
    
    // Create Blinka interface
    const blinkaInterface: BlinkaInterface = {
      connect: async () => {
        console.log('BlinkaProvider: Connecting to Python REPL process...');
        
        try {
          // Start the Python REPL task with Blinka proxy setup
          vscode?.postMessage({
            type: 'start-python-repl',
            setupBlinka: true  // Signal to use Blinka proxy setup
          });
          
          // Wait a bit for the process to start
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Initialize Blinka environment first
          const blinkaSetup = await sendPythonMessage('setup_blinka');
          console.log('BlinkaProvider: Blinka setup result:', blinkaSetup);
          
          if (!blinkaSetup.success) {
            throw new Error(`Blinka setup failed: ${blinkaSetup.message || 'Unknown error'}`);
          }
          
          // Ping to verify connection
          const pingResult = await sendPythonMessage('ping');
          console.log('BlinkaProvider: Ping result:', pingResult);
          
          setIsConnected(true);
          
          // Get board info
          const boardInfo = await sendPythonMessage('board_info');
          console.log('BlinkaProvider: Board info received:', boardInfo);
          
          // Initialize Blinka wrapper after successful connection
          await initializeBlinkaWrapper();
          
          return true;
        } catch (error) {
          console.error('BlinkaProvider: Connection failed:', error);
          onError?.(error instanceof Error ? error.message : String(error));
          setIsConnected(false);
          return false;
        }
      },
      
      disconnect: () => {
        console.log('BlinkaProvider: Disconnecting from Python REPL...');
        setIsConnected(false);
        
        // Cleanup Blinka wrapper
        if (blinkaWrapperRef.current) {
          blinkaWrapperRef.current.dispose();
          blinkaWrapperRef.current = null;
        }
        
        vscode?.postMessage({
          type: 'stop-python-repl'
        });
        
        onOutput?.('\nREPL disconnected\n');
      },
      
      executeCode: async (code: string) => {
        console.log('BlinkaProvider: Executing code:', code);
        
        if (!isConnected) {
          throw new Error('Not connected to Python REPL');
        }
        
        try {
          const result = await sendPythonMessage('execute', { code });
          
          let output = '';
          
          if (result.stdout) {
            output += result.stdout;
          }
          
          if (result.stderr) {
            output += result.stderr;
          }
          
          if (!result.success && result.error) {
            output += `${result.error}\n`;
          }
          
          output += '>>> ';
          
          return output;
          
        } catch (error) {
          console.error('BlinkaProvider: Code execution failed:', error);
          return `Error: ${error.message}\n>>> `;
        }
      },
      
      processInput: async (input: string) => {
        // For REPL, processInput is the same as executeCode
        return blinkaInterface.executeCode(input);
      },
      
      isConnected: () => isConnected,
      
      getHardwareState: () => ({
        pins: new Map(),
        i2cDevices: [],
        spiConfig: null,
        uartConfig: null
      }),
      
      getBlinkaWrapper: () => blinkaWrapperRef.current
    };

    blinkaRef.current = blinkaInterface;
    setIsReady(true);
    onReady?.(blinkaInterface);
    
    // Cleanup
    return () => {
      window.removeEventListener('message', messageListener);
      // Clear any pending requests
      pendingRequestsRef.current.forEach(({ reject }) => {
        reject(new Error('Component unmounting'));
      });
      pendingRequestsRef.current.clear();
    };

  }, [vscode, onOutput, onReady, onError]);

  return children;
}