/**
 * WASM Integration Test
 *
 * Tests the integration of WASM runtime with the ExecutionEnvironment
 * to ensure CircuitPython code executes properly in virtual hardware.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { WasmRuntimeManager } from '../sys/wasmRuntimeManager';
import { MuDebugAdapter } from '../devices/protocols/debugAdapter';

suite('WASM Integration Tests', () => {
    let wasmRuntimeManager: WasmRuntimeManager;
    let debugAdapter: MuDebugAdapter;

    setup(async () => {
        // Initialize WASM runtime manager
        wasmRuntimeManager = new WasmRuntimeManager({
            enableHardwareSimulation: true,
            debugMode: true,
            timeout: 10000
        });

        // Initialize debug adapter with WASM integration
        debugAdapter = new MuDebugAdapter();
    });

    teardown(async () => {
        if (wasmRuntimeManager) {
            wasmRuntimeManager.dispose();
        }
        if (debugAdapter) {
            debugAdapter.dispose();
        }
    });

    test('WASM Runtime Manager initializes successfully', async () => {
        await wasmRuntimeManager.initialize();

        const isHealthy = await wasmRuntimeManager.isHealthy();
        assert.strictEqual(isHealthy, true, 'WASM runtime should be healthy after initialization');
    });

    test('WASM Runtime executes basic CircuitPython code', async () => {
        await wasmRuntimeManager.initialize();

        const result = await wasmRuntimeManager.executeCode('print("Hello from WASM CircuitPython!")', {
            enableHardwareMonitoring: true
        });

        assert.strictEqual(result.success, true, 'Code execution should succeed');
        assert.ok(result.output.includes('Hello from WASM CircuitPython!'), 'Output should contain expected text');
    });

    test('WASM Runtime simulates hardware operations', async () => {
        await wasmRuntimeManager.initialize();

        // Test digital I/O simulation
        const gpioCode = `
import digitalio
import board

led = digitalio.DigitalInOut(board.D13)
led.direction = digitalio.Direction.OUTPUT
led.value = True
print("LED turned on")
`;

        const result = await wasmRuntimeManager.executeCode(gpioCode, {
            enableHardwareMonitoring: true
        });

        assert.strictEqual(result.success, true, 'GPIO code should execute successfully');
        assert.ok(result.hardwareChanges && result.hardwareChanges.length > 0, 'Should detect hardware changes');
    });

    test('ExecutionEnvironment creates WASM-backed simulated environment', async () => {
        const environment = await debugAdapter.createEnvironment('simulated', 'test_device_1');

        assert.strictEqual(environment.type, 'simulated', 'Environment should be simulated type');
        assert.strictEqual(environment.capabilities.supportsHardwareAccess, true, 'Should support hardware access');
        assert.ok(environment.profile, 'Should have environment profile');
    });

    test('WASM environment executes CircuitPython with hardware state', async () => {
        const environment = await debugAdapter.createEnvironment('simulated', 'test_device_2');

        // Execute code that interacts with virtual hardware
        const testCode = `
import board
import analogio

# Read from virtual analog pin
analog_pin = analogio.AnalogIn(board.A0)
reading = analog_pin.value
print(f"Analog reading: {reading}")
`;

        const result = await debugAdapter.executeInWasmEnvironment('test_device_2', testCode);

        assert.strictEqual(result.success, true, 'WASM environment execution should succeed');
        assert.ok(result.output, 'Should produce output');
    });

    test('WASM hardware state synchronizes with device twins', async () => {
        const environment = await debugAdapter.createEnvironment('simulated', 'test_device_3');

        // Get initial hardware state
        const initialState = await wasmRuntimeManager.getHardwareState();
        assert.ok(initialState, 'Should get initial hardware state');

        // Modify hardware state
        const success = await wasmRuntimeManager.setHardwareState({
            pins: [{ pin: 13, value: true, mode: 'output' }]
        });

        assert.strictEqual(success, true, 'Should successfully set hardware state');

        // Verify state change
        const updatedState = await wasmRuntimeManager.getHardwareState();
        const pin13 = updatedState.pins.get(13);
        assert.ok(pin13, 'Pin 13 should exist in hardware state');
        assert.strictEqual(pin13.value, true, 'Pin 13 should be set to true');
    });

    test('WASM runtime handles errors gracefully', async () => {
        await wasmRuntimeManager.initialize();

        // Execute invalid Python code
        const result = await wasmRuntimeManager.executeCode('invalid python syntax!', {
            enableHardwareMonitoring: false
        });

        assert.strictEqual(result.success, false, 'Invalid code should fail');
        assert.ok(result.error, 'Should provide error message');
    });

    test('WASM runtime can reset to clean state', async () => {
        await wasmRuntimeManager.initialize();

        // Execute some code to change state
        await wasmRuntimeManager.executeCode('x = 42');

        // Reset the runtime
        await wasmRuntimeManager.reset();

        // Verify clean state
        const isHealthy = await wasmRuntimeManager.isHealthy();
        assert.strictEqual(isHealthy, true, 'Runtime should be healthy after reset');
    });

    test('Multiple WASM environments can coexist', async () => {
        // Create multiple simulated environments
        const env1 = await debugAdapter.createEnvironment('simulated', 'device_a');
        const env2 = await debugAdapter.createEnvironment('simulated', 'device_b');

        assert.strictEqual(env1.deviceId, 'device_a', 'First environment should have correct device ID');
        assert.strictEqual(env2.deviceId, 'device_b', 'Second environment should have correct device ID');

        // Both should be accessible
        const wasmEnv1 = debugAdapter.getWasmEnvironment('device_a');
        const wasmEnv2 = debugAdapter.getWasmEnvironment('device_b');

        assert.ok(wasmEnv1, 'First WASM environment should be accessible');
        assert.ok(wasmEnv2, 'Second WASM environment should be accessible');
    });
});