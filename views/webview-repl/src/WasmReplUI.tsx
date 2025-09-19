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
const activeTab = signal<'terminal' | 'hardware'>('terminal');

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

// VS Code API integration - use shared instance if available
declare const acquireVsCodeApi: () => any;
const vscode = (() => {
    // Check if global vscode API is already available
    if ((window as any).vscode) {
        return (window as any).vscode;
    }

    // Try to acquire new instance
    try {
        const api = acquireVsCodeApi();
        (window as any).vscode = api; // Store globally
        return api;
    } catch (error) {
        console.warn('Failed to acquire VS Code API:', error);
        return null;
    }
})();

function RuntimeSelector() {
    const handleRuntimeChange = (event: Event) => {
        const target = event.target as HTMLSelectElement;
        const runtimeId = target.value as RuntimeConfig['id'];

        if (runtimeId && runtimeId !== currentRuntime.value) {
            connectionStatus.value = 'connecting';

            // Send runtime switch message to extension
            if (vscode) {
                vscode.postMessage({
                    type: 'runtime.switch',
                    runtime: runtimeId,
                    timestamp: Date.now()
                });
            }
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
            if (vscode) {
                vscode.postMessage({
                    type: 'runtime.disconnect',
                    runtime: currentRuntime.value,
                    timestamp: Date.now()
                });
            }
        } else {
            // Connect/Reconnect
            connectionStatus.value = 'connecting';
            if (vscode) {
                vscode.postMessage({
                    type: 'runtime.connect',
                    runtime: currentRuntime.value,
                    timestamp: Date.now()
                });
            }
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
                <div class="compact-header">
                    <svg width="24" height="24" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M22.8133 20.177C21.6969 20.7097 20.5436 21.6098 20.5436 21.9466C20.5436 22.8712 21.3288 22.9692 22.2121 22.1548C23.3838 21.0771 24.3898 20.8383 25.0339 21.4812C25.9786 22.4242 24.6229 24.2918 21.6846 26.1043C19.9793 27.1514 19.4395 27.7148 19.4395 28.4312C19.4395 29.1292 20.1633 29.2088 20.9607 28.5965C21.8564 27.9168 23.4758 27.7392 25.5246 28.1066C27.5919 28.4679 28.9537 27.9168 28.3341 26.9738C28.1501 26.6922 28.0765 26.6677 27.6778 26.7473C26.9662 26.8942 22.5741 26.8942 22.8256 26.7473C24.58 25.7308 26.0522 24.3653 26.6288 23.2325C27.7759 20.973 25.2977 18.9952 22.8133 20.177Z" fill="#D2453C"/>
                        <path d="M16.7404 0.0680508C6.91948 1.02941 -0.0183663 8.48145 3.65229e-05 18.0522C0.0307078 33.44 17.8998 41.5962 29.7573 31.6275C36.7688 25.7308 38.0631 15.0762 32.6772 7.53847C29.1132 2.54798 22.6048 -0.501415 16.7404 0.0680508ZM20.6909 2.499C26.3958 3.49097 31.432 7.93648 33.033 13.3985C36.0265 23.5815 28.5918 33.6665 18.0961 33.6665H16.6607L16.5748 28.3209C16.5319 25.3756 16.4951 21.9037 16.4951 20.6056V18.2359H23.1323H29.7696L29.7144 15.5722C29.653 12.5412 29.5549 12.0819 28.7574 11.2675C27.3343 9.79796 25.0339 9.35096 19.0101 9.36933C11.5263 9.3877 9.63696 9.78571 8.12793 11.6349C6.93788 13.1045 6.92562 13.1903 6.91948 21.9037L6.91335 29.1965L6.24471 28.4617C-3.68052 17.55 6.10362 -0.0421684 20.6909 2.499ZM26.224 11.7513C28.7636 12.4555 28.279 16.2152 25.6412 16.2152C22.9667 16.209 22.476 12.5167 25.0524 11.7452C25.5186 11.6043 25.6903 11.6043 26.224 11.7513Z" fill="#D2453C"/>
                    </svg>
                    <span>Select Runtime</span>
                </div>
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
    if (!hardwareState.value) {
        return (
            <div class="hardware-visualization">
                <p>No hardware data available</p>
            </div>
        );
    }

    const hw = hardwareState.value;

    // Ensure arrays exist and have default values
    const pins = Array.isArray(hw.pins) ? hw.pins : [];
    const sensors = Array.isArray(hw.sensors) ? hw.sensors : [];

    return (
        <div class="hardware-visualization">
            <vscode-panels>
                <vscode-panel-tab id="gpio-tab">
                    🔌 GPIO Pins ({pins.length})
                </vscode-panel-tab>
                <vscode-panel-tab id="sensors-tab">
                    📊 Sensors ({sensors.length})
                </vscode-panel-tab>

                <vscode-panel-view id="gpio-view">
                    <div class="gpio-grid">
                        {pins.map(pin => (
                            <div key={pin.pin} class={`gpio-pin ${pin.mode || 'input'}`}>
                                <div class="pin-number">D{pin.pin || 0}</div>
                                <div class="pin-value">{String(pin.value || 0)}</div>
                                <div class="pin-mode">{pin.mode || 'input'}</div>
                            </div>
                        ))}
                    </div>
                </vscode-panel-view>

                <vscode-panel-view id="sensors-view">
                    <div class="sensors-list">
                        {sensors.map(sensor => (
                            <div key={sensor.id} class="sensor-item">
                                <div class="sensor-name">{sensor.id || 'unknown'}</div>
                                <div class="sensor-value">{sensor.value || 0}</div>
                                <div class="sensor-type">{sensor.type || 'sensor'}</div>
                            </div>
                        ))}
                    </div>
                </vscode-panel-view>
            </vscode-panels>
        </div>
    );
}

function WasmReplUI() {
    const showRuntimeSelector = connectionStatus.value === 'disconnected' || connectionStatus.value === 'error';
    const showTerminal = connectionStatus.value === 'connected';

    return (
        <div class="wasm-repl-ui">
            {showRuntimeSelector && (
                <div class="runtime-selection-interface">
                    <RuntimeSelector />
                </div>
            )}

            {connectionStatus.value === 'connecting' && (
                <div class="connection-status">
                    <div class="connecting-indicator">
                        <vscode-progress-ring></vscode-progress-ring>
                        <p>Connecting to {currentRuntime.value || 'runtime'}...</p>
                        {isWASMInitializing.value && (
                            <p class="wasm-status">Initializing WASM CircuitPython...</p>
                        )}
                    </div>
                </div>
            )}

            {showTerminal && (
                <div class="terminal-interface">
                    <div class="runtime-status-bar">
                        <div class="runtime-info">
                            <vscode-badge appearance="secondary">
                                {currentRuntime.value === 'wasm-circuitpython' ? 'WASM CircuitPython' :
                                 currentRuntime.value === 'blinka-python' ? 'Blinka Python' :
                                 currentRuntime.value === 'pyscript' ? 'PyScript' : 'Connected'}
                            </vscode-badge>
                            {currentRuntime.value === 'wasm-circuitpython' && (
                                <div class="tab-controls">
                                    <vscode-button
                                        appearance={activeTab.value === 'terminal' ? 'primary' : 'secondary'}
                                        onClick={() => {
                                            activeTab.value = 'terminal';
                                            updateTerminalVisibility();
                                        }}
                                        size="small"
                                    >
                                        🖥️ Terminal
                                    </vscode-button>
                                    <vscode-button
                                        appearance={activeTab.value === 'hardware' ? 'primary' : 'secondary'}
                                        onClick={() => {
                                            activeTab.value = 'hardware';
                                            updateTerminalVisibility();
                                        }}
                                        size="small"
                                    >
                                        🔌 Hardware
                                    </vscode-button>
                                </div>
                            )}
                        </div>
                        <vscode-button
                            appearance="icon"
                            onClick={() => {
                                if (vscode) {
                                    vscode.postMessage({
                                        type: 'runtime.disconnect',
                                        runtime: currentRuntime.value,
                                        timestamp: Date.now()
                                    });
                                }
                            }}
                            title="Disconnect and return to runtime selection"
                        >
                            ⏹️
                        </vscode-button>
                    </div>

                    {activeTab.value === 'terminal' ? (
                        <div class="terminal-content">
                            {/* Terminal is positioned absolutely and managed by CSS */}
                        </div>
                    ) : (
                        <div class="hardware-content">
                            <HardwareVisualization />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Message handling from extension
function handleExtensionMessage(event: MessageEvent) {
    const message = event.data;

    switch (message.type) {
        case 'runtime.statusUpdate':
            const previousStatus = connectionStatus.value;
            connectionStatus.value = message.status;
            if (message.runtime) {
                currentRuntime.value = message.runtime;
            }
            // Update terminal visibility when status changes
            if (previousStatus !== message.status) {
                updateTerminalVisibility();
            }
            break;

        case 'wasm.initializationStart':
            isWASMInitializing.value = true;
            break;

        case 'wasm.initializationComplete':
            isWASMInitializing.value = false;
            const previousCompleteStatus = connectionStatus.value;
            connectionStatus.value = message.success ? 'connected' : 'error';
            // Update terminal visibility when WASM initialization completes
            if (previousCompleteStatus !== connectionStatus.value) {
                updateTerminalVisibility();
            }
            break;

        case 'hardware.stateUpdate':
            if (message.hardwareState) {
                hardwareState.value = message.hardwareState;
            }
            break;

        case 'runtime.error':
            const previousErrorStatus = connectionStatus.value;
            connectionStatus.value = 'error';
            console.error('Runtime error:', message.error);
            // Update terminal visibility on error
            if (previousErrorStatus !== 'error') {
                updateTerminalVisibility();
            }
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

    // Add CSS class to manage terminal visibility
    const wasmReplContainer = document.querySelector('.wasm-repl-ui') as HTMLElement;
    if (wasmReplContainer) {
        wasmReplContainer.classList.add('runtime-selecting');
    }

    // Render the UI
    render(<WasmReplUI />, container);

    // Notify extension that webview is ready
    if (vscode) {
        vscode.postMessage({ type: 'webviewReady', timestamp: Date.now() });
    }

    console.log('WASM REPL UI initialized');
}

// Update terminal visibility based on connection status and active tab
function updateTerminalVisibility() {
    const wasmReplContainer = document.querySelector('.wasm-repl-ui') as HTMLElement;
    const terminalElement = document.getElementById('terminal');

    if (!wasmReplContainer || !terminalElement) {
        console.warn('Terminal visibility update failed: missing elements');
        return;
    }

    const isConnected = connectionStatus.value === 'connected';
    const isTerminalTabActive = activeTab.value === 'terminal';

    console.log('Updating terminal visibility:', {
        isConnected,
        status: connectionStatus.value,
        activeTab: activeTab.value
    });

    if (isConnected) {
        // Show terminal interface and hide runtime selection
        wasmReplContainer.classList.remove('runtime-selecting');
        wasmReplContainer.classList.add('terminal-active');

        // Show/hide terminal based on active tab
        if (isTerminalTabActive) {
            terminalElement.style.display = 'block';
            terminalElement.style.visibility = 'visible';
            terminalElement.classList.remove('hardware-tab-active');
            // Don't override the CSS positioning - let CSS handle it

            // Focus and resize terminal after a short delay to ensure it's visible
            setTimeout(() => {
                if (window.terminal) {
                    if (typeof window.terminal.focus === 'function') {
                        window.terminal.focus();
                    }
                    if (typeof window.terminal.resize === 'function') {
                        window.terminal.resize();
                    } else if (window.terminal.getFitAddon && typeof window.terminal.getFitAddon === 'function') {
                        const fitAddon = window.terminal.getFitAddon();
                        if (fitAddon && typeof fitAddon.fit === 'function') {
                            fitAddon.fit();
                        }
                    }
                    console.log('Terminal focused and resized');
                }
            }, 150);
        } else {
            terminalElement.style.display = 'none';
            terminalElement.style.visibility = 'hidden';
            terminalElement.classList.add('hardware-tab-active');
        }
    } else {
        // Show runtime selection and hide terminal
        wasmReplContainer.classList.add('runtime-selecting');
        wasmReplContainer.classList.remove('terminal-active');
        terminalElement.style.display = 'none';
        terminalElement.style.visibility = 'hidden';
        terminalElement.classList.add('hardware-tab-active');
    }
}

// Auto-initialize if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeWasmReplUI);
} else {
    initializeWasmReplUI();
}