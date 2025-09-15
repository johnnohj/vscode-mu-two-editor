import { useRef, useEffect, useState } from 'preact/hooks';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Plotter } from './plotter/Plotter';
import { BlinkaProvider, BlinkaInterface } from './BlinkaProvider';
import { BlinkaTest } from './BlinkaTest';
import styles from './Terminal.module.css';

export function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [activeTab, setActiveTab] = useState<'repl' | 'plotter' | 'blinka-test'>('repl');
  const blinkaRef = useRef<BlinkaInterface | null>(null);
  const [isVirtualDeviceConnected, setIsVirtualDeviceConnected] = useState(false);
  
  // Command line buffer for handling special commands
  const commandBufferRef = useRef<string>('');
  const cursorPositionRef = useRef<number>(0);
  const _el =  document.getElementsByTagName('html')[0];
  const vsStyle = _el.style
  
  // Handle the 'blinka' command with progress bar
  const handleBlinkaCommand = async () => {
    if (!terminalRef.current || !blinkaRef.current) return;
    
    const terminal = terminalRef.current;
    
    // Show progress bar
    terminal.write('\r\n\x1b[36mStarting Blinka REPL connection...\x1b[0m\r\n');
    
    const progressChars = ['█', '▉', '▊', '▋', '▌', '▍', '▎', '▏', ' '];
    const totalSteps = 30;
    let currentStep = 0;
    
    const updateProgress = (step: number, message: string) => {
      const percentage = Math.round((step / totalSteps) * 100);
      const filledBars = Math.floor((step / totalSteps) * 20);
      const remainder = ((step / totalSteps) * 20) % 1;
      const remainderIndex = Math.floor(remainder * 8);
      
      let progressBar = '█'.repeat(filledBars);
      if (remainderIndex > 0 && filledBars < 20) {
        progressBar += progressChars[8 - remainderIndex];
      }
      progressBar += ' '.repeat(Math.max(0, 20 - filledBars - (remainderIndex > 0 ? 1 : 0)));
      
      terminal.write(`\r\x1b[K[\x1b[32m${progressBar}\x1b[0m] ${percentage}% ${message}`);
    };
    
    const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
    
    try {
      // Simulate connection process with progress updates
      updateProgress(0, 'Initializing...');
      await delay(200);
      
      updateProgress(5, 'Starting Python process...');
      await delay(300);
      
      updateProgress(10, 'Loading Blinka libraries...');
      await delay(400);
      
      updateProgress(15, 'Detecting hardware...');
      await delay(300);
      
      updateProgress(20, 'Setting up CircuitPython compatibility...');
      await delay(400);
      
      updateProgress(25, 'Establishing communication...');
      await delay(300);
      
      // Actually try to connect
      const connected = await blinkaRef.current.connect();
      
      if (connected) {
        updateProgress(30, 'Connected!');
        await delay(200);
        terminal.write('\r\n\x1b[32m✓ Blinka REPL connection established!\x1b[0m\r\n>>> ');
        setIsVirtualDeviceConnected(true);
      } else {
        terminal.write('\r\n\x1b[31m✗ Connection failed\x1b[0m\r\n>>> ');
      }
    } catch (error) {
      terminal.write(`\r\n\x1b[31m✗ Error: ${error.message}\x1b[0m\r\n>>> `);
    }
  };


  useEffect(() => {
    if (!containerRef.current) return;

    // Create xterm.js terminal with Monaco-style scrollbars
    terminalRef.current = new XTerm({
      theme: {
		  background: vsStyle.getPropertyValue('--vscode-editor-background'),
        foreground: 'var(--vscode-editor-foreground, #d4d4d4)',
        cursor: 'var(--vscode-terminalCursor-foreground, #d4d4d4)',
        selectionBackground: 'var(--vscode-editor-selectionBackground, #264f78)',
        // Monaco-style scrollbar theming using xterm.js built-in API
        scrollbarSliderBackground: vsStyle.getPropertyValue('--vscode-scrollbarSlider-background') || 'rgba(121, 121, 121, 0.4)',
        scrollbarSliderHoverBackground: vsStyle.getPropertyValue('--vscode-scrollbarSlider-hoverBackground') || 'rgba(100, 100, 100, 0.7)',
        scrollbarSliderActiveBackground: vsStyle.getPropertyValue('--vscode-scrollbarSlider-activeBackground') || 'rgba(191, 191, 191, 0.4)',
        overviewRulerBorder: vsStyle.getPropertyValue('--vscode-scrollbarSlider-background') || 'rgba(121, 121, 121, 0.1)'
      },
      fontSize: 14,
		rows: 13,
		cols: 80,
      fontFamily: 'var(--vscode-terminal-font-family, "Consolas", "Courier New", monospace)',
      lineHeight: 1.4, // Increase line height to prevent character cutoff
      cursorBlink: false,
      cursorStyle: 'block',
      scrollback: 1000,
      convertEol: true
    });

    // Create fit addon for responsive sizing
    fitAddonRef.current = new FitAddon();
    terminalRef.current.loadAddon(fitAddonRef.current);

    // Open terminal in container
    terminalRef.current.open(containerRef.current);
    fitAddonRef.current.fit();

    // Welcome message
    terminalRef.current.writeln('\x1b[38:5:171mMu 2 Editor REPL\x1b[0m');
    terminalRef.current.writeln('\x1b[38:5:208mWaiting for serial connection...\x1b[0m');
    terminalRef.current.writeln('');

    // Handle terminal input
    terminalRef.current.onData(async (data) => {
      // Handle special keys and command processing (same for both connected and non-connected modes)
      if (data === '\r') {
        // Enter key - process complete command
        const command = commandBufferRef.current.trim();
        
        if (command === 'blinka' && !isVirtualDeviceConnected) {
          // Handle blinka connection command
          terminalRef.current?.write('\r\n');
          commandBufferRef.current = '';
          cursorPositionRef.current = 0;
          await handleBlinkaCommand();
          return;
        }
        
        // Add newline and reset buffer
        terminalRef.current?.write('\r\n');
        const fullCommand = commandBufferRef.current;
        commandBufferRef.current = '';
        cursorPositionRef.current = 0;
        
        // Process command based on connection state
        if (isVirtualDeviceConnected && blinkaRef.current && fullCommand.trim()) {
          // Send complete command to Blinka REPL
          try {
            const output = await blinkaRef.current.processInput(fullCommand);
            if (output) {
              terminalRef.current?.write(output);
            }
          } catch (error) {
            terminalRef.current?.write(`\x1b[31mError: ${error.message}\x1b[0m\n>>> `);
          }
        } else if (!isVirtualDeviceConnected && fullCommand.trim()) {
          // Send command to VS Code extension for serial communication
          if (window.vscode) {
            window.vscode.postMessage({
              type: 'terminalInput',
              data: fullCommand + '\r'
            });
          }
        } else if (!fullCommand.trim()) {
          // Empty command - just show prompt
          terminalRef.current?.write('>>> ');
        }
        
      } else if (data === '\u007F') {
        // Backspace - handle buffer and display
        if (commandBufferRef.current.length > 0 && cursorPositionRef.current > 0) {
          // Remove character from buffer
          const buffer = commandBufferRef.current;
          const pos = cursorPositionRef.current;
          commandBufferRef.current = buffer.slice(0, pos - 1) + buffer.slice(pos);
          cursorPositionRef.current = pos - 1;
          
          // Update display
          terminalRef.current?.write('\b \b');
        }
      } else if (data >= ' ' && data <= '~') {
        // Printable character - add to buffer and display
        const buffer = commandBufferRef.current;
        const pos = cursorPositionRef.current;
        commandBufferRef.current = buffer.slice(0, pos) + data + buffer.slice(pos);
        cursorPositionRef.current = pos + 1;
        
        // Echo character
        terminalRef.current?.write(data);
      }
      // Ignore other control characters for now
    });

    // Set up resize observer for responsive layout with throttling
    let resizeTimeout: NodeJS.Timeout;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
        }
      }, 100);
    });

    resizeObserver.observe(containerRef.current);

    // Consolidated message handler for VS Code extension
    const handleExtensionMessage = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.type) {
        case 'terminalWrite':
        case 'terminal-write':
          if (terminalRef.current) {
            const data = message.data || message.payload?.data;
            if (data) {
              terminalRef.current.write(data);
            }
          }
          break;
          
        case 'terminalClear':
        case 'terminal-clear':
          if (terminalRef.current) {
            terminalRef.current.clear();
          }
          break;
          
        case 'terminal-resize':
          if (terminalRef.current && fitAddonRef.current) {
            terminalRef.current.resize(message.payload.cols, message.payload.rows);
          }
          break;
          
        case 'showTerminalPanel':
          // Show terminal subpanel (handled by CSS/parent component)
          console.log('Show terminal panel message received');
          break;
          
        case 'hideTerminalPanel':
          // Hide terminal subpanel (handled by CSS/parent component)
          console.log('Hide terminal panel message received');
          break;
          
        case 'connectVirtualDevice':
          if (blinkaRef.current) {
            blinkaRef.current.connect().then(() => {
              setIsVirtualDeviceConnected(true);
            });
          }
          break;
          
        default:
          console.log('Unhandled terminal message:', message.type);
          break;
      }
    };

    window.addEventListener('message', handleExtensionMessage);
    
    // Notify extension that terminal is ready
    if (window.vscode) {
      window.vscode.postMessage({
        type: 'terminal-ready',
        payload: {}
      });
    }
    
    // Cleanup
    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener('message', handleExtensionMessage);
      resizeObserver.disconnect();
      terminalRef.current?.dispose();
    };
  }, []);

  return (
    <BlinkaProvider
      onOutput={(output) => {
        if (terminalRef.current) {
          terminalRef.current.write(output);
        }
      }}
      onReady={(blinka) => {
        blinkaRef.current = blinka;
        // Notify extension that virtual device is available
        if (window.vscode) {
          window.vscode.postMessage({
            type: 'virtualDeviceReady',
            data: { 
              port: 'Blinka Virtual Board',
              description: 'Virtual CircuitPython Device'
            }
          });
        }
      }}
      onError={(error) => {
        if (terminalRef.current) {
          terminalRef.current.write(`\x1b[31mBlinka Error: ${error}\x1b[0m\n`);
        }
      }}
    >
      <div className={styles.terminalContainer}>
      
      <div className={styles.terminalHeader}>
        <div className={styles.tabs}>
          <button 
            className={`${styles.tab} ${activeTab === 'repl' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('repl')}
          >
            📟 REPL
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'plotter' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('plotter')}
          >
            📊 Plotter
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'blinka-test' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('blinka-test')}
          >
            🧪 Blinka Test
          </button>
        </div>
        <div className={styles.terminalActions}>
          {activeTab === 'repl' && (
            <>
              <button 
                className={styles.terminalButton}
                onClick={() => {
                  if (window.vscode) {
                    window.vscode.postMessage({ type: 'listPorts' });
                  }
                }}
              >
                📡 Ports
              </button>
              <button 
                className={styles.terminalButton}
                onClick={() => {
                  if (terminalRef.current) {
                    terminalRef.current.clear();
                  }
                }}
              >
                🗑️ Clear
              </button>
            </>
          )}
        </div>
      </div>
      <div className={styles.terminalContent}>
        {activeTab === 'repl' && (
          <div ref={containerRef} className={styles.terminal} />
        )}
        {activeTab === 'plotter' && (
          <Plotter />
        )}
        {activeTab === 'blinka-test' && (
          <BlinkaTest blinkaInterface={blinkaRef.current} />
        )}
      </div>
      </div>
    </BlinkaProvider>
  );
}