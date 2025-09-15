# CircuitPython WASM Integration Guide

This document provides recommendations for integrating the CircuitPython WASM runtime (`src/bin/circuitpython.mjs`) with the Mu Two VS Code extension, replacing the previous PyScript approach.

## Executive Summary

The CircuitPython WASM runtime offers several key advantages:
- **Native CircuitPython execution** without external dependencies
- **Virtual hardware simulation** for development without physical devices
- **Integrated REPL functionality** that can run alongside or replace serial communication
- **Node.js process isolation** for stability and security

## Current Architecture Analysis

### Extension Communication Points
The extension currently manages CircuitPython devices through several key components:

1. **Device Management Layer**
   - `src/devices/deviceManager.ts` - Physical device connection management
   - `src/devices/debugAdapter.ts` - Debug Adapter Protocol implementation
   - `src/sys/boardManager.ts` - Board state and capability management

2. **Communication Interfaces**
   - `src/interface/blinka/circuitpythonRepl.ts` - Serial REPL communication
   - `src/devices/serialMonitorCooperativeManager.ts` - Serial port coordination
   - `src/providers/replViewProvider.ts` - REPL webview interface

3. **Virtual Hardware Support**
   - `src/devices/deviceTwinning/` - Device state simulation infrastructure
   - `src/sys/utils/virtualTaskBoard.ts` - Virtual board implementation

## Integration Strategy

### Phase 1: WASM Runtime Service

Create a new service layer to manage the WASM runtime process:

```typescript
// src/sys/wasmRuntimeManager.ts
export class WasmRuntimeManager {
    private wasmProcess: ChildProcess | null = null;
    private communicationChannel: MessageChannel;
    
    async initialize(): Promise<void> {
        // Launch Node.js process with circuitpython.mjs
        this.wasmProcess = spawn('node', [
            path.join(__dirname, '../bin/circuitpython.mjs')
        ]);
        
        // Establish IPC communication
        this.setupCommunication();
    }
    
    async executeCode(code: string): Promise<ExecutionResult> {
        // Send code to WASM runtime via IPC
    }
    
    async getDeviceState(): Promise<DeviceTwinState> {
        // Query virtual hardware state
    }
}
```

### Phase 2: Board Manager Integration

Extend the existing `BoardManager` to support WASM-based virtual boards:

```typescript
// Extend src/sys/boardManager.ts
export type BoardType = 'usb' | 'ble' | 'virtual' | 'wasm';

export interface WasmBoardConfig extends IBoard {
    type: 'wasm';
    runtimePath: string;
    virtualHardware: EnvironmentProfile;
    capabilities: BoardCapabilities & {
        supportsWasmExecution: true;
        hasVirtualHardware: true;
    };
}
```

### Phase 3: REPL Provider Enhancement

Update the REPL provider to support both serial and WASM execution:

```typescript
// Extend src/providers/replViewProvider.ts
export class HybridReplProvider {
    private serialRepl: CircuitPythonRepl;
    private wasmRepl: WasmRuntimeManager;
    private currentMode: 'serial' | 'wasm' | 'hybrid';
    
    async executeCommand(command: ReplCommand): Promise<ReplResult> {
        switch (this.currentMode) {
            case 'serial':
                return this.serialRepl.executeCommand(command);
            case 'wasm':
                return this.wasmRepl.executeCode(command.code);
            case 'hybrid':
                // Execute on both and compare results
                return this.executeHybrid(command);
        }
    }
}
```

## Communication Architecture

### IPC Protocol Design

Use Node.js IPC for extension-to-WASM communication:

```typescript
interface WasmMessage {
    id: string;
    type: 'execute' | 'query' | 'reset' | 'configure';
    payload: any;
    timestamp: number;
}

interface WasmResponse {
    id: string;
    success: boolean;
    result?: any;
    error?: string;
    executionTime: number;
}
```

### Message Types

1. **Execution Messages**
   ```typescript
   {
     type: 'execute',
     payload: {
       code: string,
       mode: 'repl' | 'file' | 'raw',
       timeout?: number
     }
   }
   ```

2. **Hardware Query Messages**
   ```typescript
   {
     type: 'query',
     payload: {
       target: 'gpio' | 'sensor' | 'board',
       pin?: number,
       sensor?: string
     }
   }
   ```

3. **Configuration Messages**
   ```typescript
   {
     type: 'configure',
     payload: {
       boardProfile: EnvironmentProfile,
       peripherals: SimulatedSensor[],
       gpioConfig: SimulatedGPIO[]
     }
   }
   ```

## Integration Points

### 1. Debug Adapter Extension

Extend the existing `debugAdapter.ts` to support WASM debugging:

```typescript
export class WasmDebugSession extends DebugSession {
    private wasmRuntime: WasmRuntimeManager;
    
    protected async launchRequest(args: DebugProtocol.LaunchRequestArguments) {
        // Launch WASM runtime instead of serial connection
        await this.wasmRuntime.initialize();
        this.sendEvent(new InitializedEvent());
    }
    
    protected async setBreakPointsRequest(args: DebugProtocol.SetBreakpointsArguments) {
        // Implement WASM-based breakpoints
    }
}
```

### 2. File System Provider Integration

Leverage the existing `fileSystemProvider.ts` to bridge WASM file operations:

```typescript
// Extend CtpyFileSystemProvider
export class WasmFileSystemBridge extends CtpyFileSystemProvider {
    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (this.isWasmBoard(uri)) {
            return this.wasmRuntime.readFile(uri.path);
        }
        return super.readFile(uri);
    }
    
    async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
        if (this.isWasmBoard(uri)) {
            return this.wasmRuntime.writeFile(uri.path, content);
        }
        return super.writeFile(uri, content);
    }
}
```

### 3. Device Twin Synchronization

Use existing device twinning infrastructure to synchronize WASM state:

```typescript
// Extend src/devices/deviceTwinning/DeviceStateSynchronizer.ts
export class WasmStateSynchronizer extends DeviceStateSynchronizer {
    async syncFromWasm(): Promise<DeviceTwinState> {
        const wasmState = await this.wasmRuntime.getDeviceState();
        return this.convertToTwinState(wasmState);
    }
    
    async syncToWasm(state: DeviceTwinState): Promise<void> {
        await this.wasmRuntime.setDeviceState(state);
    }
}
```

## Configuration and Settings

### VS Code Settings Integration

Add WASM-specific configuration options:

```json
{
  "muTwo.wasm.enabled": true,
  "muTwo.wasm.runtimePath": "./src/bin/circuitpython.mjs",
  "muTwo.wasm.defaultBoard": "adafruit_circuitplayground_express",
  "muTwo.wasm.virtualHardware": {
    "enableSensors": true,
    "enableActuators": true,
    "enableGPIO": true
  },
  "muTwo.wasm.execution": {
    "timeout": 30000,
    "memoryLimit": "64MB",
    "allowFileSystem": true
  }
}
```

### Board Profile Management

Extend existing board configuration to include WASM profiles:

```typescript
export interface WasmBoardProfile {
    boardId: string;
    displayName: string;
    wasmConfig: {
        memorySize: number;
        features: string[];
        peripherals: SimulatedSensor[];
        gpios: SimulatedGPIO[];
    };
}
```

## Development Workflow

### 1. Hybrid Development Mode

Support simultaneous physical and virtual development:

```typescript
export class HybridDevelopmentManager {
    async createHybridSession(physicalBoard: IDevice, wasmProfile: WasmBoardProfile) {
        // Create session that mirrors physical board with WASM equivalent
        const session = new HybridSession({
            physical: await this.connectPhysical(physicalBoard),
            virtual: await this.createWasmBoard(wasmProfile)
        });
        
        return session;
    }
}
```

### 2. Code Execution Modes

Provide multiple execution modes:

- **Virtual Only**: Execute in WASM runtime exclusively
- **Physical Only**: Execute on connected device exclusively  
- **Comparison Mode**: Execute on both and compare results
- **Fallback Mode**: Try physical first, fallback to WASM

### 3. Hardware Simulation

Leverage WASM for comprehensive hardware simulation:

```typescript
export class WasmHardwareSimulator {
    async simulateGPIO(pin: number, operation: 'read' | 'write', value?: boolean) {
        return this.wasmRuntime.gpioOperation(pin, operation, value);
    }
    
    async simulateSensor(sensorType: string): Promise<SensorReading> {
        return this.wasmRuntime.readSensor(sensorType);
    }
    
    async simulateEnvironment(profile: EnvironmentProfile) {
        return this.wasmRuntime.loadEnvironment(profile);
    }
}
```

## Testing Strategy

### Unit Testing

Create comprehensive tests for WASM integration:

```typescript
describe('WasmRuntimeManager', () => {
    test('should initialize WASM runtime', async () => {
        const manager = new WasmRuntimeManager();
        await manager.initialize();
        expect(manager.isRunning()).toBe(true);
    });
    
    test('should execute CircuitPython code', async () => {
        const result = await manager.executeCode('print("Hello, WASM!")');
        expect(result.success).toBe(true);
        expect(result.output).toBe('Hello, WASM!\n');
    });
});
```

### Integration Testing

Test extension-to-WASM communication:

```typescript
describe('WASM Integration', () => {
    test('should bridge REPL commands to WASM', async () => {
        const replProvider = new HybridReplProvider();
        await replProvider.setMode('wasm');
        
        const result = await replProvider.executeCommand({
            code: 'import board; print(dir(board))',
            mode: ReplMode.Normal
        });
        
        expect(result.success).toBe(true);
    });
});
```

## Security Considerations

### Process Isolation

- Run WASM runtime in isolated Node.js process
- Implement resource limits (memory, CPU, execution time)
- Sandbox file system access to workspace directories

### Communication Security

- Validate all IPC messages
- Implement message signing/verification
- Rate limit command execution

### Resource Management

- Monitor WASM process memory usage
- Implement automatic cleanup on extension deactivation
- Provide manual reset/restart capabilities

## Performance Optimization

### Startup Optimization

- Lazy-load WASM runtime when needed
- Cache frequently used board profiles
- Pre-compile common CircuitPython modules

### Execution Optimization

- Batch multiple commands when possible
- Implement command queuing with priorities
- Cache execution results for identical code

### Memory Management

- Monitor WASM heap usage
- Implement garbage collection triggers
- Provide memory usage metrics in status bar

## Migration Path

### Phase 1: Foundation (Week 1-2)
- Implement `WasmRuntimeManager`
- Create basic IPC communication
- Add WASM board type to `BoardManager`

### Phase 2: Integration (Week 3-4)
- Extend REPL provider for WASM support
- Implement file system bridging
- Add configuration settings

### Phase 3: Enhancement (Week 5-6)
- Implement hybrid development mode
- Add hardware simulation features
- Create comprehensive test suite

### Phase 4: Polish (Week 7-8)
- Performance optimization
- Security hardening
- Documentation and examples

## Conclusion

This WASM integration strategy leverages the existing extension architecture while adding powerful virtual development capabilities. By extending current components rather than replacing them, we maintain compatibility with physical devices while adding WASM-based virtual development.

The phased approach ensures steady progress while maintaining extension stability throughout the integration process.