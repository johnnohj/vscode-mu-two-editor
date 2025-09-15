import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import { Monaco } from './Monaco';
import { Terminal } from './Terminal';
import styles from './App.module.css';

export function App() {
  const monacoRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [topPanelHeight, setTopPanelHeight] = useState(50); // Percentage
  const [isDragging, setIsDragging] = useState(false);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true); // Start collapsed to match VS Code context

  const handleTogglePanel = useCallback(() => {
    setIsPanelCollapsed(prev => {
      const newState = !prev;
      
      // Notify VS Code of the state change
      if (window.vscode) {
        window.vscode.postMessage({
          type: 'panelStateChanged',
          collapsed: newState
        });
      }
      
      return newState;
    });
    
    // Trigger Monaco layout update after panel toggle
    setTimeout(() => {
      if (monacoRef.current?.layout) {
        monacoRef.current.layout();
      }
    }, 150);
  }, []);

  const handleResize = useCallback(() => {
    // Trigger Monaco editor layout update after panel resize
    if (monacoRef.current?.layout) {
      setTimeout(() => {
        monacoRef.current.layout();
      }, 100);
    }
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (isPanelCollapsed) return;
    e.preventDefault();
    setIsDragging(true);
  }, [isPanelCollapsed]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current || isPanelCollapsed) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    const newTopHeight = ((e.clientY - containerRect.top) / containerRect.height) * 100;
    
    // Constrain between 20% and 80%
    const constrainedHeight = Math.max(20, Math.min(80, newTopHeight));
    setTopPanelHeight(constrainedHeight);
    
    // Trigger layout update
    handleResize();
  }, [isDragging, handleResize]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    // Listen for messages from VS Code extension
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      
      switch (message.type) {
        case 'showPanel':
          setIsPanelCollapsed(false);
          break;
        case 'hidePanel':
          setIsPanelCollapsed(true);
          break;
        case 'setPanelState':
          setIsPanelCollapsed(message.collapsed);
          break;
      }
    };

    window.addEventListener('message', messageHandler);

    // Remove VS Code default padding by targeting _defaultStyles
    const removeVSCodePadding = () => {
      // Method 1: Try to find and modify the _defaultStyles element
      const defaultStyles = document.getElementById('_defaultStyles');
      if (defaultStyles) {
        try {
          // Modify the stylesheet content directly
          if (defaultStyles.sheet) {
            const sheet = defaultStyles.sheet as CSSStyleSheet;
            // Add rule to override body padding
            sheet.insertRule('body { padding: 0 !important; margin: 0 !important; }', 0);
          } else if (defaultStyles.textContent) {
            // Replace padding in text content
            defaultStyles.textContent = defaultStyles.textContent.replace(/padding:\s*20px/g, 'padding: 0');
          }
        } catch (error) {
          console.warn('Could not modify _defaultStyles directly:', error);
        }
      }

      // Method 2: Add high-specificity override styles
      const customStyle = document.createElement('style');
      customStyle.textContent = `
        html body {
          padding: 0 !important;
          margin: 0 !important;
        }
        body.vscode-body {
          padding: 0 !important;
          margin: 0 !important;
        }
      `;
      document.head.appendChild(customStyle);
    };

    // Try immediately and also after a short delay to ensure DOM is ready
    removeVSCodePadding();
    setTimeout(removeVSCodePadding, 100);

    // Notify VS Code that webview is ready
    if (window.vscode) {
      window.vscode.postMessage({ type: 'webviewReady' });
    }

    // Add window resize listener
    window.addEventListener('resize', handleResize);
    
    return () => {
      window.removeEventListener('message', messageHandler);
      window.removeEventListener('resize', handleResize);
    };
  }, [handleResize]);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div className={styles.app}>
      <div 
        ref={containerRef}
        className={styles.splitContainer}
        style={{
          gridTemplateRows: isPanelCollapsed 
            ? '1fr' 
            : `${topPanelHeight}% 4px ${100 - topPanelHeight}%`
        }}
      >
        <div className={styles.editorPanel}>
          <Monaco 
            ref={monacoRef} 
            onTogglePanel={handleTogglePanel}
            isPanelCollapsed={isPanelCollapsed}
          />
        </div>
        
        {!isPanelCollapsed && (
          <>
            <div 
              className={styles.gutter}
              onMouseDown={handleMouseDown}
            />
            
            <div className={styles.terminalPanel}>
              <Terminal />
            </div>
          </>
        )}
      </div>
    </div>
  );
}