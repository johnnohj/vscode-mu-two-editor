/**
 * Blinka Integration Bridge
 * 
 * Bridges the new device twinning system with existing Blinka infrastructure.
 * Leverages the mature Blinka codebase for virtual pins, dual execution, and 
 * serial communication while extending it with device twin state management.
 */

import { DeviceTwinState, BasePinState, SensorState, ActuatorState } from './interfaces';
import { Mu2Board, BoardInfo } from '../../views/webview-editor/src/blinka/Mu2Board';
import { VirtualPin, SerialBridge } from '../../views/webview-editor/src/blinka/VirtualPin';
import { 
    DualExecutionInterface, 
    ExecutionMode, 
    ExecutionPreferences 
} from '../../interface/blinka/dualExecutionInterface';
import { 
    BlinkaExecutionManager,
    ExecutionEnvironment,
    BlinkaBoard 
} from '../../interface/blinka/blinkaExecutionManager';

/**
 * Adapter that bridges Blinka VirtualPin to our DeviceTwinState pin interfaces
 */
export class PinStateAdapter {
    /**
     * Convert Blinka VirtualPin to our BasePinState interface
     */
    static virtualPinToBasePinState(pin: VirtualPin): BasePinState {
        return {
            type: 'digital', // Blinka VirtualPin is primarily digital
            pin: pin.id,
            name: `D${pin.id}`,
            aliases: [`GPIO${pin.id}`],
            capabilities: ['digital_io'],
            isReserved: false,
            lastChanged: Date.now(),
            voltage: 3.3,
            // Additional digital pin properties
            mode: pin.getDirection() === 0 ? 'input' : 'output',
            value: false, // Would need to query from pin
            pull: pin.getPullMode() === 0 ? 'none' : (pin.getPullMode() === 1 ? 'up' : 'down'),
            driveMode: 'push_pull'
        } as any;
    }

    /**
     * Update VirtualPin from BasePinState
     */
    static async updateVirtualPinFromState(pin: VirtualPin, state: BasePinState): Promise<boolean> {
        try {
            if (state.type === 'digital') {
                const digitalState = state as any;
                
                // Update direction
                const direction = digitalState.mode === 'output' ? 1 : 0;
                if (pin.getDirection() !== direction) {
                    await pin.setDirection(direction);
                }

                // Update pull mode
                const pullMode = digitalState.pull === 'up' ? 1 : (digitalState.pull === 'down' ? 2 : 0);
                if (pin.getPullMode() !== pullMode) {
                    await pin.setPullMode(pullMode);
                }

                // Update value if output
                if (direction === 1) { // OUTPUT
                    await pin.setValue(digitalState.value ? 1 : 0);
                }
            }

            return true;
        } catch (error) {
            console.error('Failed to update VirtualPin from state:', error);
            return false;
        }
    }
}

/**
 * Adapter for Blinka board detection and device twin creation
 */
export class BoardDetectionAdapter {
    /**
     * Convert Blinka BoardInfo to our DeviceTemplate-compatible format
     */
    static boardInfoToDeviceTwinState(boardInfo: BoardInfo, deviceId: string): DeviceTwinState {
        const digitalPins = new Map();
        const analogPins = new Map();
        const pwmPins = new Map();

        // Convert Blinka board pins to our pin state format
        boardInfo.pins.forEach(pinNumber => {
            const digitalPin = {
                type: 'digital' as const,
                pin: pinNumber,
                name: `D${pinNumber}`,
                aliases: [`GPIO${pinNumber}`],
                capabilities: ['digital_io'],
                isReserved: false,
                lastChanged: Date.now(),
                voltage: 3.3,
                mode: 'input' as const,
                value: false,
                pull: 'none' as const,
                driveMode: 'push_pull' as const
            };
            digitalPins.set(pinNumber, digitalPin);
        });

        return {
            deviceId,
            boardId: boardInfo.boardId,
            displayName: boardInfo.name,
            isConnected: true,
            lastSync: Date.now(),
            digitalPins,
            analogPins,
            pwmPins,
            i2cBuses: new Map(),
            spiBuses: new Map(),
            uartPorts: new Map(),
            sensors: new Map(),
            actuators: new Map(),
            boardFeatures: {
                buttons: new Map(),
                switches: new Map(),
                onboardLeds: new Map(),
                resetButton: {
                    id: 'reset',
                    isPressed: false,
                    lastPressed: 0,
                    pressCount: 0,
                    debounceTime: 50
                },
                powerManagement: {
                    voltage: 3.3,
                    current: 50,
                    powerMode: 'active',
                    batteryLevel: 100,
                    isCharging: false
                },
                filesystem: {
                    totalSpace: 2 * 1024 * 1024,
                    usedSpace: 512 * 1024,
                    freeSpace: 1.5 * 1024 * 1024,
                    files: new Map()
                },
                memory: {
                    totalRam: 320 * 1024,
                    usedRam: 64 * 1024,
                    freeRam: 256 * 1024,
                    gcCollections: 0
                }
            },
            simulation: {
                isSimulated: false, // Physical device detected
                realisticTiming: true,
                noiseLevel: 0,
                updateInterval: 50,
                sensorVariation: 0,
                enablePhysicalLaws: false // Not needed for physical device
            }
        };
    }
}

/**
 * Main integration bridge that coordinates between device twinning and Blinka systems
 */
export class BlinkaIntegrationBridge {
    private dualExecutionInterface: DualExecutionInterface;
    private blinkaExecutionManager: BlinkaExecutionManager;
    private activeBoardInstances = new Map<string, Mu2Board>();
    private deviceTwins = new Map<string, DeviceTwinState>();
    
    // Physical-first sync with Blinka's dual execution
    private syncInterval: NodeJS.Timeout | null = null;
    private readonly SYNC_RATE_MS = 50; // 50ms = 20Hz for sub-250ms responsiveness

    constructor(
        dualExecutionInterface: DualExecutionInterface,
        blinkaExecutionManager: BlinkaExecutionManager
    ) {
        this.dualExecutionInterface = dualExecutionInterface;
        this.blinkaExecutionManager = blinkaExecutionManager;
        
        this.startPhysicalFirstSyncLoop();
    }

    /**
     * Create or update device twin using Blinka board detection
     */
    async createDeviceTwinFromBlinka(
        deviceId: string, 
        serialBridge: SerialBridge
    ): Promise<DeviceTwinState | null> {
        try {
            // Create Blinka board instance
            const mu2Board = new Mu2Board();
            mu2Board.setSerialBridge(serialBridge);
            
            // Initialize and detect actual board
            await mu2Board.initializeBoard();
            const detectedBoard = await mu2Board.detectActualBoard();
            
            if (!detectedBoard) {
                console.warn('Failed to detect board via Blinka');
                return null;
            }

            console.log(`Detected board via Blinka: ${detectedBoard.boardId}`);
            
            // Convert to device twin state
            const deviceTwin = BoardDetectionAdapter.boardInfoToDeviceTwinState(detectedBoard, deviceId);
            
            // Store board instance for ongoing sync
            this.activeBoardInstances.set(deviceId, mu2Board);
            this.deviceTwins.set(deviceId, deviceTwin);
            
            return deviceTwin;
            
        } catch (error) {
            console.error('Failed to create device twin from Blinka:', error);
            return null;
        }
    }

    /**
     * Sync device twin state with Blinka virtual pins (Physical-First)
     */
    async syncDeviceTwinWithBlinka(deviceId: string): Promise<boolean> {
        try {
            const deviceTwin = this.deviceTwins.get(deviceId);
            const mu2Board = this.activeBoardInstances.get(deviceId);
            
            if (!deviceTwin || !mu2Board) {
                return false;
            }

            let hasChanges = false;

            // Sync each virtual pin with device twin pin state
            const allPins = mu2Board.getAllPins();
            
            for (const virtualPin of allPins) {
                const pinNumber = virtualPin.id;
                const twinPin = deviceTwin.digitalPins.get(pinNumber);
                
                if (twinPin) {
                    // Check if physical pin state has changed
                    const currentValue = await virtualPin.getValue();
                    const physicalState = currentValue === 1;
                    
                    if (twinPin.value !== physicalState) {
                        // Physical device has changed - update twin (Physical-First principle)
                        twinPin.value = physicalState;
                        twinPin.lastChanged = Date.now();
                        hasChanges = true;
                        
                        console.log(`Pin ${pinNumber} physical change: ${physicalState}`);
                    }
                }
            }

            if (hasChanges) {
                deviceTwin.lastSync = Date.now();
                
                // Emit change event for LSP sync
                this.onDeviceTwinStateChanged?.(deviceId, deviceTwin);
            }

            return true;

        } catch (error) {
            console.error(`Blinka sync failed for device ${deviceId}:`, error);
            return false;
        }
    }

    /**
     * Execute code using Blinka's dual execution with physical-first validation
     */
    async executeCodeWithPhysicalFirst(
        code: string, 
        deviceId: string
    ): Promise<{ success: boolean; physicalMatch: boolean; result: any }> {
        try {
            // Use Blinka's dual execution to run on both physical and simulated
            const dualResult = await this.dualExecutionInterface.executeDual(code, deviceId);
            
            if ('comparison' in dualResult) {
                const physicalMatch = dualResult.comparison.outputMatch;
                
                // Physical-first: if outputs differ, trust the physical device
                const authoritative = physicalMatch ? 
                    dualResult.hardwareResult : 
                    dualResult.hardwareResult; // Always trust hardware
                
                // Update device twin based on physical result
                await this.updateDeviceTwinFromExecution(deviceId, authoritative);
                
                return {
                    success: authoritative.success,
                    physicalMatch,
                    result: dualResult
                };
            }
            
            return {
                success: false,
                physicalMatch: false,
                result: null
            };

        } catch (error) {
            console.error('Dual execution with physical-first failed:', error);
            return {
                success: false,
                physicalMatch: false,
                result: error
            };
        }
    }

    /**
     * Start high-frequency physical-first sync loop
     */
    private startPhysicalFirstSyncLoop(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        this.syncInterval = setInterval(async () => {
            // Sync all active device twins with their Blinka counterparts
            const syncPromises: Promise<boolean>[] = [];
            
            for (const deviceId of this.deviceTwins.keys()) {
                syncPromises.push(this.syncDeviceTwinWithBlinka(deviceId));
            }

            // Execute syncs in parallel for performance
            try {
                await Promise.all(syncPromises);
            } catch (error) {
                console.warn('Some device syncs failed:', error);
            }
            
        }, this.SYNC_RATE_MS);
    }

    /**
     * Update device twin state based on code execution results
     */
    private async updateDeviceTwinFromExecution(deviceId: string, executionResult: any): Promise<void> {
        const deviceTwin = this.deviceTwins.get(deviceId);
        if (!deviceTwin) {
            return;
        }

        // Parse execution result for state changes
        // This would analyze the code output for pin state changes, sensor readings, etc.
        // For now, just update the last sync timestamp
        deviceTwin.lastSync = Date.now();
        
        this.onDeviceTwinStateChanged?.(deviceId, deviceTwin);
    }

    /**
     * Get device twin integrated with Blinka capabilities
     */
    getDeviceTwin(deviceId: string): DeviceTwinState | null {
        return this.deviceTwins.get(deviceId) || null;
    }

    /**
     * Get Blinka board instance for direct access
     */
    getBlinkaBoard(deviceId: string): Mu2Board | null {
        return this.activeBoardInstances.get(deviceId) || null;
    }

    /**
     * Validate virtual state changes against physical device using Blinka
     */
    async validateStateChangeWithBlinka(
        deviceId: string, 
        pinNumber: number, 
        newState: BasePinState
    ): Promise<boolean> {
        try {
            const mu2Board = this.activeBoardInstances.get(deviceId);
            if (!mu2Board) {
                return false;
            }

            const virtualPin = mu2Board.getPin(pinNumber);
            if (!virtualPin) {
                return false;
            }

            // Apply state change to Blinka virtual pin
            const success = await PinStateAdapter.updateVirtualPinFromState(virtualPin, newState);
            
            if (success) {
                // Verify the change took effect on physical device
                await new Promise(resolve => setTimeout(resolve, 10)); // Brief delay for physical response
                const actualValue = await virtualPin.getValue();
                const expectedValue = (newState as any).value ? 1 : 0;
                
                return actualValue === expectedValue;
            }
            
            return false;

        } catch (error) {
            console.error('Blinka state validation failed:', error);
            return false;
        }
    }

    /**
     * Use Blinka's educational features for device twinning learning
     */
    async generateLearningInsights(deviceId: string): Promise<string[]> {
        const insights: string[] = [];
        const deviceTwin = this.deviceTwins.get(deviceId);
        
        if (!deviceTwin) {
            return insights;
        }

        // Leverage Blinka's execution comparison data
        const executionHistory = this.dualExecutionInterface.getSessionHistory();
        const recentSessions = executionHistory.slice(-5); // Last 5 sessions
        
        if (recentSessions.length > 0) {
            insights.push('🎓 **Device Twinning Learning Insights:**');
            
            const physicalSuccessRate = recentSessions.filter(s => 
                s.results.some(r => ('hardwareResult' in r) ? r.hardwareResult.success : r.success)
            ).length / recentSessions.length;
            
            if (physicalSuccessRate > 0.8) {
                insights.push('✅ Excellent physical device connectivity and reliability');
                insights.push('💡 Your device twin accurately reflects physical hardware state');
            } else {
                insights.push('⚠️ Some physical device communication issues detected');
                insights.push('💡 Check connections and power supply to improve device twin accuracy');
            }
            
            // Analyze sync performance
            const avgSyncTime = deviceTwin.lastSync ? Date.now() - deviceTwin.lastSync : 0;
            if (avgSyncTime < 100) {
                insights.push('⚡ Ultra-fast sync: Device twin updates in real-time');
            } else if (avgSyncTime < 500) {
                insights.push('🚀 Good sync performance: Device twin updates quickly');
            } else {
                insights.push('🐌 Slow sync detected: Consider optimizing communication');
            }
        }
        
        return insights;
    }

    /**
     * Event callback for device twin state changes (to be set by debugAdapter)
     */
    public onDeviceTwinStateChanged?: (deviceId: string, state: DeviceTwinState) => void;

    /**
     * Cleanup and disposal
     */
    dispose(): void {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        
        // Dispose all Blinka board instances
        this.activeBoardInstances.clear();
        this.deviceTwins.clear();
        
        console.log('Blinka Integration Bridge disposed');
    }

    /**
     * Get comprehensive device status combining twin state and Blinka capabilities
     */
    getComprehensiveDeviceStatus(deviceId: string): {
        deviceTwin: DeviceTwinState | null;
        blinkaBoard: Mu2Board | null;
        syncStatus: {
            lastSync: number;
            syncRate: number;
            isResponsive: boolean;
        };
        executionCapabilities: {
            hardwareExecution: boolean;
            simulationExecution: boolean;
            dualExecution: boolean;
        };
    } {
        const deviceTwin = this.getDeviceTwin(deviceId);
        const blinkaBoard = this.getBlinkaBoard(deviceId);
        
        const lastSync = deviceTwin?.lastSync || 0;
        const syncAge = Date.now() - lastSync;
        
        return {
            deviceTwin,
            blinkaBoard,
            syncStatus: {
                lastSync,
                syncRate: this.SYNC_RATE_MS,
                isResponsive: syncAge < (this.SYNC_RATE_MS * 5) // 5x sync rate threshold
            },
            executionCapabilities: {
                hardwareExecution: blinkaBoard !== null,
                simulationExecution: this.blinkaExecutionManager.getExecutionStats().isInitialized,
                dualExecution: blinkaBoard !== null && this.blinkaExecutionManager.getExecutionStats().isInitialized
            }
        };
    }
}

/**
 * Enhanced LSP completions using Blinka board capabilities
 */
export class BlinkaLSPCompletionProvider {
    private blinkaIntegrationBridge: BlinkaIntegrationBridge;

    constructor(blinkaIntegrationBridge: BlinkaIntegrationBridge) {
        this.blinkaIntegrationBridge = blinkaIntegrationBridge;
    }

    /**
     * Generate high-granularity board-aware completions
     */
    getBoardAwareCompletions(deviceId: string, context: string): Array<{
        label: string;
        detail: string;
        documentation: string;
        insertText: string;
        kind: string;
    }> {
        const completions: any[] = [];
        const deviceTwin = this.blinkaIntegrationBridge.getDeviceTwin(deviceId);
        const blinkaBoard = this.blinkaIntegrationBridge.getBlinkaBoard(deviceId);
        
        if (!deviceTwin || !blinkaBoard) {
            return completions;
        }

        // Board-specific pin completions
        if (context.includes('board.')) {
            // Digital pins
            deviceTwin.digitalPins.forEach((pin, pinNumber) => {
                completions.push({
                    label: `D${pinNumber}`,
                    detail: `Digital Pin ${pinNumber}`,
                    documentation: `Digital I/O pin with capabilities: ${pin.capabilities.join(', ')}. Current state: ${pin.value ? 'HIGH' : 'LOW'}`,
                    insertText: `D${pinNumber}`,
                    kind: 'property'
                });
            });

            // Special pins (LED, SDA, SCL, etc.)
            const specialPins = ['LED', 'SDA', 'SCL', 'MOSI', 'MISO', 'SCK', 'TX', 'RX'];
            specialPins.forEach(pinName => {
                const pin = blinkaBoard.getPinByName(pinName);
                if (pin) {
                    completions.push({
                        label: pinName,
                        detail: `Special Pin - ${pinName}`,
                        documentation: `Board-specific ${pinName} pin (GPIO ${pin.id})`,
                        insertText: pinName,
                        kind: 'constant'
                    });
                }
            });
        }

        // Sensor completions based on detected sensors
        if (context.includes('sensor') || context.includes('read')) {
            deviceTwin.sensors.forEach((sensor, sensorId) => {
                completions.push({
                    label: `${sensorId}.value`,
                    detail: `${sensor.name} Reading`,
                    documentation: `Current ${sensor.type} sensor value: ${(sensor as any).value} ${sensor.unit}. Range: ${sensor.range.min}-${sensor.range.max}`,
                    insertText: `${sensorId}.value`,
                    kind: 'property'
                });
            });
        }

        // Actuator completions
        if (context.includes('led') || context.includes('motor') || context.includes('servo')) {
            deviceTwin.actuators.forEach((actuator, actuatorId) => {
                completions.push({
                    label: `${actuatorId}.set_value()`,
                    detail: `Control ${actuator.name}`,
                    documentation: `Set the value for ${actuator.type} actuator`,
                    insertText: `${actuatorId}.set_value($0)`,
                    kind: 'method'
                });
            });
        }

        return completions;
    }

    /**
     * Get real-time hover information with current device state
     */
    getRealtimeHoverInfo(deviceId: string, symbol: string): string | null {
        const deviceTwin = this.blinkaIntegrationBridge.getDeviceTwin(deviceId);
        if (!deviceTwin) {
            return null;
        }

        // Pin hover info with real-time state
        const pinMatch = symbol.match(/D(\d+)|LED|SDA|SCL/);
        if (pinMatch) {
            const pinNumber = pinMatch[1] ? parseInt(pinMatch[1]) : 13; // LED typically on pin 13
            const pin = deviceTwin.digitalPins.get(pinNumber);
            
            if (pin) {
                const lastChanged = new Date(pin.lastChanged).toLocaleTimeString();
                return `**${pin.name}** (GPIO ${pinNumber})
                
**Current State:** ${pin.value ? 'HIGH' : 'LOW'}
**Mode:** ${pin.mode.toUpperCase()}
**Pull:** ${pin.pull.toUpperCase()}
**Capabilities:** ${pin.capabilities.join(', ')}
**Last Changed:** ${lastChanged}
**Voltage:** ${pin.voltage}V`;
            }
        }

        // Sensor hover info with real-time readings
        const sensor = Array.from(deviceTwin.sensors.values()).find(s => 
            s.id === symbol || s.name.toLowerCase().includes(symbol.toLowerCase())
        );
        
        if (sensor) {
            const lastReading = new Date(sensor.lastReading).toLocaleTimeString();
            return `**${sensor.name}**
            
**Current Value:** ${(sensor as any).value} ${sensor.unit}
**Type:** ${sensor.type}
**Range:** ${sensor.range.min} - ${sensor.range.max} ${sensor.unit}
**Last Reading:** ${lastReading}
**Accuracy:** ±${sensor.accuracy} ${sensor.unit}`;
        }

        return null;
    }
}