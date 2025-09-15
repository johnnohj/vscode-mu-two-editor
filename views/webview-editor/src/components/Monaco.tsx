import { useRef, useEffect, useImperativeHandle } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import * as monaco from 'monaco-editor';
import styles from './Monaco.module.css';
import { CircuitPythonStubLoader } from '../stub-loader';
import { CircuitPythonLanguageClient } from '../CircuitPythonLanguageClient';

// Global language client reference for providers
let globalLanguageClient: CircuitPythonLanguageClient | null = null;

// Register CircuitPython language providers with Monaco
function registerCircuitPythonLanguageProviders() {
  if (!globalLanguageClient) return;

  // Register completion provider
  monaco.languages.registerCompletionItemProvider('python', {
    provideCompletionItems: async (model, position, context, token) => {
      if (!globalLanguageClient) return { suggestions: [] };
      
      const suggestions = await globalLanguageClient.getMonacoCompletions(model, position);
      return { suggestions };
    },
    triggerCharacters: ['.', ' ']
  });

  // Register hover provider
  monaco.languages.registerHoverProvider('python', {
    provideHover: async (model, position, token) => {
      if (!globalLanguageClient) return null;
      
      return await globalLanguageClient.getMonacoHover(model, position);
    }
  });

  // Register diagnostics (via marker service)
  const updateDiagnostics = async (model: monaco.editor.ITextModel) => {
    if (!globalLanguageClient) return;
    
    const diagnostics = await globalLanguageClient.getMonacoDiagnostics(model);
    monaco.editor.setModelMarkers(model, 'circuitpython', diagnostics);
  };

  // Set up diagnostics callback
  globalLanguageClient.onDiagnostics((diagnostics) => {
    // This callback will be used for real-time diagnostics updates
    const activeModel = monaco.editor.getModels()[0]; // Get the active model
    if (activeModel) {
      monaco.editor.setModelMarkers(activeModel, 'circuitpython', diagnostics);
    }
  });

  console.log('CircuitPython language providers registered with Monaco');
}

interface MonacoProps {
  language?: string;
  defaultValue?: string;
  onTogglePanel?: () => void;
  isPanelCollapsed?: boolean;
}

export interface MonacoRef {
  getValue: () => string;
  setValue: (value: string) => void;
  layout: () => void;
  getEditor: () => monaco.editor.IStandaloneCodeEditor | null;
  loadCircuitPythonStubs: () => Promise<boolean>;
}

export const Monaco = forwardRef<MonacoRef, MonacoProps>(({ 
  language = 'python', 
  defaultValue = `# Welcome to Mu 2 CircuitPython Editor
import board
import digitalio
import time

# Create an LED object
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

# Blink the LED
while True:
    led.value = True
    time.sleep(0.5)
    led.value = False
    time.sleep(0.5)
`,
  onTogglePanel,
  isPanelCollapsed = true
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const stubLoaderRef = useRef<CircuitPythonStubLoader | null>(null);
  const languageClientRef = useRef<CircuitPythonLanguageClient | null>(null);

  useImperativeHandle(ref, () => ({
    getValue: () => editorRef.current?.getValue() || '',
    setValue: (value: string) => editorRef.current?.setValue(value),
    layout: () => editorRef.current?.layout(),
    getEditor: () => editorRef.current,
    loadCircuitPythonStubs: async () => {
      if (!stubLoaderRef.current) {
        stubLoaderRef.current = new CircuitPythonStubLoader();
      }
      try {
        const result = await stubLoaderRef.current.loadCoreStubs();
        if (result.errors.length > 0) {
          console.warn('Stub loading warnings:', result.errors);
        }
        console.log('Loaded CircuitPython stubs:', result.loadedStubs);
        return result.success;
      } catch (error) {
        console.error('Failed to load CircuitPython stubs:', error);
        return false;
      }
    }
  }));

  useEffect(() => {
    if (!containerRef.current) return;

    // Configure Monaco web workers for VS Code webview environment
    // Cache for worker blob URLs to avoid repeated loading
    const workerCache = new Map<string, string>();
    
    (self as any).MonacoEnvironment = {
      getWorker: function (workerId: string, label: string) {
        // Determine worker name based on label
        let workerName = 'editor.worker.js';
        switch (label) {
          case 'json':
            workerName = 'json.worker.js';
            break;
          case 'css':
          case 'scss':
          case 'less':
            workerName = 'css.worker.js';
            break;
          case 'html':
          case 'handlebars':
          case 'razor':
            workerName = 'html.worker.js';
            break;
          case 'typescript':
          case 'javascript':
            workerName = 'ts.worker.js';
            break;
        }

        // Check if we already have this worker cached
        const cachedUrl = workerCache.get(workerName);
        if (cachedUrl) {
          return new Worker(cachedUrl);
        }

        // Create a fallback worker immediately while we load the real one
        const createFallbackWorker = () => {
          const fallbackWorker = `
            self.onmessage = function(e) {
              // Minimal worker that just responds to keep Monaco happy
              if (e.data.id) {
                self.postMessage({ id: e.data.id, result: null });
              }
            };
          `;
          const blob = new Blob([fallbackWorker], { type: 'application/javascript' });
          const fallbackUrl = URL.createObjectURL(blob);
          return new Worker(fallbackUrl);
        };

        // Start loading the real worker asynchronously
        const loadRealWorker = async () => {
          try {
            const vscode = (window as any).vscode;
            if (!vscode) {
              console.warn('VS Code API not available for worker loading');
              return;
            }

            const messageId = `worker-${Date.now()}-${Math.random()}`;
            
            return new Promise<void>((resolve, reject) => {
              const handleMessage = (event: MessageEvent) => {
                const message = event.data;
                if (message.type === 'monaco-worker-response' && message.id === messageId) {
                  window.removeEventListener('message', handleMessage);
                  
                  if (message.error) {
                    console.warn(`Failed to load Monaco worker ${workerName}:`, message.error);
                    reject(new Error(message.error));
                    return;
                  }
                  
                  // Create blob URL from worker code and cache it
                  try {
                    const workerCode = atob(message.workerCode);
                    const blob = new Blob([workerCode], { type: 'application/javascript' });
                    const blobUrl = URL.createObjectURL(blob);
                    workerCache.set(workerName, blobUrl);
                    console.log(`Monaco worker ${workerName} loaded and cached`);
                    resolve();
                  } catch (error) {
                    console.warn(`Failed to create blob for Monaco worker ${workerName}:`, error);
                    reject(error);
                  }
                }
              };
              
              window.addEventListener('message', handleMessage);
              
              vscode.postMessage({
                type: 'load-monaco-worker',
                id: messageId,
                workerName: workerName
              });
              
              // Timeout after 5 seconds
              setTimeout(() => {
                window.removeEventListener('message', handleMessage);
                reject(new Error(`Timeout loading Monaco worker: ${workerName}`));
              }, 5000);
            });
          } catch (error) {
            console.warn(`Error loading Monaco worker ${workerName}:`, error);
          }
        };

        // Start loading the real worker but return fallback immediately
        loadRealWorker().catch(error => {
          console.warn(`Monaco worker ${workerName} will use fallback:`, error);
        });

        return createFallbackWorker();
      }
    };

    // Create Monaco editor instance
    editorRef.current = monaco.editor.create(containerRef.current, {
      value: defaultValue,
      language: language,
      theme: 'vs-dark',
      automaticLayout: false,
      fontSize: 14,
      fontFamily: 'var(--vscode-editor-font-family, "Consolas", "Courier New", monospace)',
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      wordWrap: 'on',
      contextmenu: true,
      selectOnLineNumbers: true,
      glyphMargin: true,
      folding: true,
      renderLineHighlight: 'all'
    });

    // Set up ResizeObserver for responsive layout with throttling
    let resizeTimeout: NodeJS.Timeout;
    let diagnosticsTimeout: NodeJS.Timeout;
    resizeObserver.current = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (editorRef.current) {
          editorRef.current.layout();
        }
      }, 100);
    });

    resizeObserver.current.observe(containerRef.current);

    // Initialize CircuitPython language client
    const vscode = (window as any).vscode;
    if (vscode && !languageClientRef.current) {
      languageClientRef.current = new CircuitPythonLanguageClient(vscode);
      globalLanguageClient = languageClientRef.current;
      
      // Register Monaco language providers
      registerCircuitPythonLanguageProviders();
    }

    // Initialize CircuitPython stub loader
    if (!stubLoaderRef.current) {
      stubLoaderRef.current = new CircuitPythonStubLoader();
      // Auto-load core stubs for better user experience
      stubLoaderRef.current.loadCoreStubs().then(result => {
        if (result.success) {
          console.log('CircuitPython stubs loaded successfully:', result.loadedStubs);
        } else {
          console.warn('Some CircuitPython stubs failed to load:', result.errors);
        }
      }).catch(error => {
        console.error('Failed to initialize CircuitPython stubs:', error);
      });
    }

    // Track initial content for dirty state
    const initialContent = defaultValue;
    
    // Listen for editor changes and notify VS Code
    const onDidChangeModelContent = editorRef.current.onDidChangeModelContent(() => {
      if (window.vscode && editorRef.current) {
        const currentContent = editorRef.current.getValue();
        const isDirty = currentContent !== initialContent;
        
        window.vscode.postMessage({
          type: 'editorContentChanged',
          content: currentContent,
          isDirty: isDirty
        });

        // Update diagnostics when content changes (debounced)
        if (languageClientRef.current && editorRef.current.getModel()) {
          clearTimeout(diagnosticsTimeout);
          diagnosticsTimeout = setTimeout(() => {
            if (languageClientRef.current && editorRef.current?.getModel()) {
              languageClientRef.current.updateDiagnostics(editorRef.current.getModel()!);
            }
          }, 1000); // 1 second debounce
        }
      }
    });


    // Cleanup function
    return () => {
      clearTimeout(resizeTimeout);
      clearTimeout(diagnosticsTimeout);
      onDidChangeModelContent.dispose();
      resizeObserver.current?.disconnect();
      
      // Dispose language client
      if (languageClientRef.current) {
        languageClientRef.current.dispose();
        languageClientRef.current = null;
        globalLanguageClient = null;
      }
      
      editorRef.current?.dispose();
    };
  }, []); // Remove dependencies to prevent re-renders

  return (
    <div className={styles.monacoContainer}>
      <div ref={containerRef} className={styles.editor} />
    </div>
  );
});