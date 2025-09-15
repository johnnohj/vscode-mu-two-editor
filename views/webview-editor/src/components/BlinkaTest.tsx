/**
 * Blinka Test Component
 * Demonstrates and tests the Blinka wrapper integration with Mu 2 Editor
 */

import { useRef, useEffect, useState } from 'preact/hooks';
import { BlinkaInterface } from './BlinkaProvider';
import { BlinkaWrapper, getBlinkaWrapper, createBlinkaBoard } from '../blinka';

interface BlinkaTestProps {
  blinkaInterface: BlinkaInterface | null;
}

export function BlinkaTest({ blinkaInterface }: BlinkaTestProps) {
  const [testResults, setTestResults] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [blinkaWrapper, setBlinkaWrapper] = useState<BlinkaWrapper | null>(null);

  useEffect(() => {
    if (blinkaInterface) {
      const wrapper = blinkaInterface.getBlinkaWrapper?.();
      setBlinkaWrapper(wrapper);
    }
  }, [blinkaInterface]);

  const addTestResult = (result: string) => {
    setTestResults(prev => [...prev, `${new Date().toLocaleTimeString()}: ${result}`]);
  };

  const runBlinkaTests = async () => {
    if (!blinkaWrapper || !blinkaInterface?.isConnected()) {
      addTestResult('❌ Blinka wrapper not available or not connected');
      return;
    }

    setIsRunning(true);
    setTestResults([]);

    try {
      addTestResult('🚀 Starting Blinka integration tests...');

      // Test 1: Basic wrapper availability
      addTestResult('✅ Test 1: Blinka wrapper is available');

      // Test 2: Board info retrieval
      const boardInfo = await blinkaWrapper.getBoardInfo();
      addTestResult(`✅ Test 2: Board info - ${boardInfo.name} (${boardInfo.boardId})`);

      // Test 3: Actual board detection
      try {
        const actualBoard = await blinkaWrapper.getActualBoardInfo();
        addTestResult(`✅ Test 3: Detected actual board - ${actualBoard.boardId}`);
      } catch (error) {
        addTestResult(`⚠️ Test 3: Could not detect actual board - ${error.message}`);
      }

      // Test 4: Virtual board creation
      try {
        const virtualBoard = createBlinkaBoard();
        addTestResult(`✅ Test 4: Virtual board created with ID: ${virtualBoard.board_id}`);

        // Test pin access
        const ledPin = virtualBoard.LED;
        if (ledPin) {
          addTestResult(`✅ Test 4a: LED pin accessible (ID: ${ledPin.id})`);
        } else {
          addTestResult('⚠️ Test 4a: LED pin not found');
        }

        // Test pin enumeration
        const allPins = virtualBoard.get_all_pins();
        addTestResult(`✅ Test 4b: Found ${allPins.length} pins`);

      } catch (error) {
        addTestResult(`❌ Test 4: Virtual board creation failed - ${error.message}`);
      }

      // Test 5: Blinka environment setup
      try {
        const serialBridge = blinkaWrapper.getSerialBridge();
        
        // Test Blinka environment setup
        addTestResult('🔧 Test 5: Testing Blinka environment setup...');
        const setupResult = await serialBridge.setupBlinkaEnvironment();
        
        if (setupResult.includes('BLINKA_IMPORT:SUCCESS')) {
          addTestResult('✅ Test 5: Blinka environment setup successful');
        } else if (setupResult.includes('BLINKA_IMPORT:ERROR')) {
          addTestResult('❌ Test 5: Blinka import failed - check adafruit-blinka installation');
        } else {
          addTestResult('⚠️ Test 5: Blinka setup completed with warnings');
        }

        // Test board info retrieval via bridge
        const bridgeBoardInfo = await serialBridge.getBoardInfo();
        if (bridgeBoardInfo.boardId !== 'unknown' && bridgeBoardInfo.boardId !== 'error') {
          addTestResult(`✅ Test 5a: Detected board - ${bridgeBoardInfo.boardId} with ${bridgeBoardInfo.pins.length} pins`);
        } else {
          addTestResult(`⚠️ Test 5a: Board detection failed - ${bridgeBoardInfo.pins[0] || 'no details'}`);
        }

      } catch (error) {
        addTestResult(`❌ Test 5: Blinka environment test failed - ${error.message}`);
      }

      // Test 6: Environment markers
      const hasEnvMarkers = (globalThis as any).MU2_EDITOR_BOARD && (globalThis as any).BLINKA_MU2_VIRTUAL;
      if (hasEnvMarkers) {
        addTestResult('✅ Test 6: Environment markers set correctly');
      } else {
        addTestResult('⚠️ Test 6: Environment markers not found');
      }

      // Test 7: Global wrapper access
      const globalWrapper = getBlinkaWrapper();
      if (globalWrapper === blinkaWrapper) {
        addTestResult('✅ Test 7: Global wrapper access working');
      } else {
        addTestResult('❌ Test 7: Global wrapper access failed');
      }

      addTestResult('🎉 Blinka integration tests completed!');

    } catch (error) {
      addTestResult(`❌ Test suite failed: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const runBasicPinTest = async () => {
    if (!blinkaWrapper || !blinkaInterface?.isConnected()) {
      addTestResult('❌ Cannot run pin test - not connected');
      return;
    }

    setIsRunning(true);

    try {
      addTestResult('🔌 Starting basic pin test...');

      const serialBridge = blinkaWrapper.getSerialBridge();

      // Test setting up pin as output
      await serialBridge.sendPinCommand(13, 'setup_output');
      addTestResult('✅ Pin D13 configured as OUTPUT');

      // Test writing HIGH
      await serialBridge.sendPinCommand(13, 'write', true);
      addTestResult('✅ Pin D13 set to HIGH');

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Test writing LOW
      await serialBridge.sendPinCommand(13, 'write', false);
      addTestResult('✅ Pin D13 set to LOW');

      addTestResult('✅ Basic pin test completed successfully!');

    } catch (error) {
      addTestResult(`❌ Pin test failed: ${error.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <div style={{ padding: '1rem', border: '1px solid #ccc', borderRadius: '4px', margin: '1rem 0' }}>
      <h3>🧪 Blinka Integration Test</h3>
      
      <div style={{ marginBottom: '1rem' }}>
        <p><strong>Status:</strong> {blinkaWrapper ? '✅ Available' : '❌ Not Available'}</p>
        <p><strong>Connected:</strong> {blinkaInterface?.isConnected() ? '✅ Yes' : '❌ No'}</p>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <button 
          onClick={runBlinkaTests}
          disabled={isRunning || !blinkaWrapper}
          style={{ marginRight: '0.5rem' }}
        >
          {isRunning ? '⏳ Running...' : '🧪 Run Integration Tests'}
        </button>
        
        <button 
          onClick={runBasicPinTest}
          disabled={isRunning || !blinkaWrapper}
          style={{ marginRight: '0.5rem' }}
        >
          {isRunning ? '⏳ Running...' : '🔌 Test Pin D13'}
        </button>
        
        <button 
          onClick={clearResults}
          disabled={isRunning}
        >
          🗑️ Clear Results
        </button>
      </div>

      <div style={{ 
        background: '#f5f5f5', 
        padding: '1rem', 
        borderRadius: '4px', 
        maxHeight: '300px', 
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: '0.85rem'
      }}>
        <h4>Test Results:</h4>
        {testResults.length === 0 ? (
          <p style={{ fontStyle: 'italic', color: '#666' }}>No tests run yet</p>
        ) : (
          testResults.map((result, index) => (
            <div key={index} style={{ marginBottom: '0.25rem' }}>
              {result}
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: '#666' }}>
        <p><strong>Usage Example:</strong></p>
        <pre style={{ background: '#eee', padding: '0.5rem', borderRadius: '4px' }}>
{`// In Python REPL after running blinka command:
import os
os.environ['MU2_EDITOR_BOARD'] = '1'

import board
import digitalio

# Use virtual pins that bridge to actual hardware
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT
led.value = True`}
        </pre>
      </div>
    </div>
  );
}