/**
 * WASM-enabled REPL UI Component
 *
 * Provides runtime selection UI using VS Code webview UI toolkit
 * Integrates with WASM-Node CircuitPython backend and traditional serial/Blinka runtimes
 */

import { signal } from '@preact/signals';
import { render } from 'preact';

// VS Code webview UI toolkit types
declare global {
    namespace JSX {
        interface IntrinsicElements {
            'vscode-button': any;
            'vscode-dropdown': any;
            'vscode-option': any;
            'vscode-panels': any;
            'vscode-panel-tab': any;
            'vscode-panel-view': any;
            'vscode-badge': any;
            'vscode-progress-ring': any;
            'vscode-divider': any;
        }
    }
}

export interface RuntimeConfig {
    id: 'blinka-python' | 'wasm-circuitpython' | 'pyscript';
    name: string;
    description: string;
    icon: string;
    available: boolean;
}

export interface HardwareState {
    pins: Array<{pin: number; value: any; mode: string}>;
    sensors: Array<{id: string; value: any; type: string}>;
    timestamp: number;
}

// Signals for reactive state management
const currentRuntime = signal<RuntimeConfig['id'] | null>(null);
const connectionStatus = signal<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
const hardwareState = signal<HardwareState | null>(null);
const isWASMInitializing = signal(false);

const availableRuntimes: RuntimeConfig[] = [
    {
        id: 'blinka-python',
        name: 'Blinka Python',
        description: 'Physical device via serial connection',
        icon: '🐍',
        available: true
    },
    {
        id: 'wasm-circuitpython',
        name: 'WASM CircuitPython',
        description: 'Virtual hardware simulation',
        icon: '⚡',
        available: true
    },
    {
        id: 'pyscript',
        name: 'PyScript',
        description: 'Browser-based Python runtime',
        icon: '🌐',
        available: false // TODO: Implement PyScript support
    }
];

// VS Code API integration
declare const acquireVsCodeApi: () => any;
const vscode = acquireVsCodeApi();

function RuntimeSelector() {
    const handleRuntimeChange = (event: Event) => {
        const target = event.target as HTMLSelectElement;
        const runtimeId = target.value as RuntimeConfig['id'];

        if (runtimeId && runtimeId !== currentRuntime.value) {
            connectionStatus.value = 'connecting';

            // Send runtime switch message to extension
            vscode.postMessage({
                type: 'runtime.switch',
                runtime: runtimeId,
                timestamp: Date.now()
            });
        }
    };

    const handleConnectClick = () => {
        if (!currentRuntime.value) {
            // Auto-select first available runtime
            const firstAvailable = availableRuntimes.find(r => r.available);
            if (firstAvailable) {
                currentRuntime.value = firstAvailable.id;
                handleRuntimeChange({ target: { value: firstAvailable.id } } as Event);
            }
            return;
        }

        if (connectionStatus.value === 'connected') {
            // Disconnect
            vscode.postMessage({
                type: 'runtime.disconnect',
                runtime: currentRuntime.value,
                timestamp: Date.now()
            });
        } else {
            // Connect/Reconnect
            connectionStatus.value = 'connecting';
            vscode.postMessage({
                type: 'runtime.connect',
                runtime: currentRuntime.value,
                timestamp: Date.now()
            });
        }
    };

    const getConnectionButtonText = () => {
        switch (connectionStatus.value) {
            case 'connecting': return 'Connecting...';
            case 'connected': return 'Disconnect';
            case 'error': return 'Retry';
            default: return 'Connect';
        }
    };

    const getConnectionButtonAppearance = () => {
        switch (connectionStatus.value) {
            case 'connected': return 'secondary';
            case 'error': return 'primary';
            default: return 'primary';
        }
    };

    return (
        <div class="runtime-selector">
            <div class="runtime-selection-header">
                <h3>🔧 Mu 2 REPL Runtime Selection</h3>
                <p>Choose your Python/CircuitPython execution environment:</p>
            </div>

            <div class="runtime-controls">
                <vscode-dropdown
                    value={currentRuntime.value || ''}
                    onChange={handleRuntimeChange}
                    disabled={connectionStatus.value === 'connecting'}
                >
                    <vscode-option value="">Select Runtime...</vscode-option>
                    {availableRuntimes.map(runtime => (
                        <vscode-option
                            key={runtime.id}
                            value={runtime.id}
                            disabled={!runtime.available}
                        >
                            {runtime.icon} {runtime.name} - {runtime.description}
                            {!runtime.available && ' (Coming Soon)'}
                        </vscode-option>
                    ))}
                </vscode-dropdown>

                <vscode-button
                    appearance={getConnectionButtonAppearance()}
                    onClick={handleConnectClick}
                    disabled={connectionStatus.value === 'connecting' || isWASMInitializing.value}
                >
                    {isWASMInitializing.value && currentRuntime.value === 'wasm-circuitpython' ? (
                        <>
                            <vscode-progress-ring></vscode-progress-ring>
                            Initializing WASM...
                        </>
                    ) : (
                        getConnectionButtonText()
                    )}
                </vscode-button>
            </div>

            {currentRuntime.value && (
                <div class="runtime-status">
                    <vscode-badge>
                        Status: {connectionStatus.value}
                    </vscode-badge>

                    {currentRuntime.value === 'wasm-circuitpython' && connectionStatus.value === 'connected' && (
                        <vscode-badge appearance="secondary">
                            Virtual Hardware Active
                        </vscode-badge>
                    )}
                </div>
            )}
        </div>
    );
}

function HardwareVisualization() {
    if (currentRuntime.value !== 'wasm-circuitpython' || !hardwareState.value) {
        return null;
    }

    const hw = hardwareState.value;

    return (
        <div class="hardware-visualization">
            <vscode-divider></vscode-divider>

            <vscode-panels>
                <vscode-panel-tab id="gpio-tab">
                    🔌 GPIO Pins ({hw.pins.length})
                </vscode-panel-tab>
                <vscode-panel-tab id="sensors-tab">
                    📊 Sensors ({hw.sensors.length})
                </vscode-panel-tab>

                <vscode-panel-view id="gpio-view">
                    <div class="gpio-grid">
                        {hw.pins.map(pin => (
                            <div key={pin.pin} class={`gpio-pin ${pin.mode}`}>
                                <div class="pin-number">D{pin.pin}</div>
                                <div class="pin-value">{String(pin.value)}</div>
                                <div class="pin-mode">{pin.mode}</div>
                            </div>
                        ))}
                    </div>
                </vscode-panel-view>

                <vscode-panel-view id="sensors-view">
                    <div class="sensors-list">
                        {hw.sensors.map(sensor => (
                            <div key={sensor.id} class="sensor-item">
                                <div class="sensor-name">{sensor.id}</div>
                                <div class="sensor-value">{sensor.value}</div>
                                <div class="sensor-type">{sensor.type}</div>
                            </div>
                        ))}
                    </div>
                </vscode-panel-view>
            </vscode-panels>
        </div>
    );
}

function WasmReplUI() {
    return (
        <div class="wasm-repl-ui">
            <RuntimeSelector />
            <HardwareVisualization />
        </div>
    );
}

// Message handling from extension
function handleExtensionMessage(event: MessageEvent) {
    const message = event.data;

    switch (message.type) {
        case 'runtime.statusUpdate':
            connectionStatus.value = message.status;
            if (message.runtime) {
                currentRuntime.value = message.runtime;
            }
            break;

        case 'wasm.initializationStart':
            isWASMInitializing.value = true;
            break;

        case 'wasm.initializationComplete':
            isWASMInitializing.value = false;
            connectionStatus.value = message.success ? 'connected' : 'error';
            break;

        case 'hardware.stateUpdate':
            if (message.hardwareState) {
                hardwareState.value = message.hardwareState;
            }
            break;

        case 'runtime.error':
            connectionStatus.value = 'error';
            console.error('Runtime error:', message.error);
            break;
    }
}

// Initialize UI component
export function initializeWasmReplUI() {
    // Set up message listener
    window.addEventListener('message', handleExtensionMessage);

    // Find the container element (create if doesn't exist)
    let container = document.getElementById('wasm-repl-ui');
    if (!container) {
        container = document.createElement('div');
        container.id = 'wasm-repl-ui';
        document.body.insertBefore(container, document.body.firstChild);
    }

    // Render the UI
    render(<WasmReplUI />, container);

    // Notify extension that webview is ready
    vscode.postMessage({ type: 'webviewReady', timestamp: Date.now() });

    console.log('WASM REPL UI initialized');
}

// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWasmReplUI);
} else {
    initializeWasmReplUI();
}