import * as vscode from 'vscode';
import { ReplCoordinator } from './replCoordinator';

/**
 * Hardware Drawer Content Generator
 *
 * Generates HTML content for the hardware simulation drawer tabs:
 * - Hardware: Pin controls, sensor simulation, LED displays
 * - Serial: Clean serial connection settings
 * - Plotter: Data visualization controls
 */
export class HardwareDrawerContent {
	private context: vscode.ExtensionContext;
	private coordinator: ReplCoordinator;

	constructor(context: vscode.ExtensionContext) {
		this.context = context;
		this.coordinator = ReplCoordinator.getInstance(context);
	}

	/**
	 * Generate Hardware tab content using VS Code WebView UI Toolkit
	 */
	getHardwareTabContent(): string {
		return `
		<div class="hardware-controls">
			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>📍 Digital Pins</h5>
				<div class="pin-grid">
					${this.generateDigitalPins()}
				</div>
			</div>

			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>📊 Analog Pins</h5>
				<div class="analog-controls">
					${this.generateAnalogPins()}
				</div>
			</div>

			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>💡 Built-in LED</h5>
				<div class="led-control">
					<vscode-button appearance="secondary" class="led-button" onclick="toggleLED()">
						<span class="led-indicator"></span>
						board.LED
					</vscode-button>
				</div>
			</div>

			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>🔬 Virtual Sensors</h5>
				<div class="sensor-controls">
					${this.generateSensorControls()}
				</div>
			</div>

			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>⚡ Power & Status</h5>
				<div class="status-indicators">
					<vscode-badge class="status-badge">Virtual Board Connected</vscode-badge>
					<vscode-tag class="voltage-tag">3.3V</vscode-tag>
				</div>
			</div>
		</div>

		<style>
		.hardware-controls {
			font-size: 12px;
		}

		.section {
			margin-bottom: 16px;
			padding-bottom: 12px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.section:last-child {
			border-bottom: none;
		}

		.section h5 {
			margin: 0 0 8px 0;
			color: var(--vscode-foreground);
			font-weight: 600;
		}

		.pin-grid {
			display: grid;
			grid-template-columns: repeat(3, 1fr);
			gap: 4px;
		}

		.pin-control {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 4px 6px;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
			font-size: 11px;
		}

		.pin-label {
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.pin-toggle {
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			border: none;
			padding: 2px 6px;
			border-radius: 2px;
			font-size: 10px;
			cursor: pointer;
		}

		.pin-toggle.high {
			background: var(--vscode-charts-red);
			color: white;
		}

		.pin-toggle.low {
			background: var(--vscode-button-secondaryBackground);
		}

		.analog-controls {
			display: flex;
			flex-direction: column;
			gap: 8px;
		}

		.analog-control {
			display: flex;
			align-items: center;
			gap: 8px;
		}

		.analog-label {
			min-width: 30px;
			font-weight: 500;
		}

		.analog-slider {
			flex: 1;
			margin: 0;
		}

		.analog-value {
			min-width: 45px;
			text-align: right;
			font-family: 'Courier New', monospace;
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
		}

		.led-control {
			display: flex;
			justify-content: center;
		}

		.led-button {
			display: flex;
			align-items: center;
			gap: 8px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 8px 16px;
			border-radius: 4px;
			cursor: pointer;
			font-size: 12px;
		}

		.led-button:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.led-button.on {
			background: var(--vscode-charts-red);
			color: white;
		}

		.led-indicator {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--vscode-button-secondaryBackground);
		}

		.led-button.on .led-indicator {
			background: #ff4444;
			box-shadow: 0 0 6px rgba(255, 68, 68, 0.8);
		}

		.sensor-controls {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.sensor-control {
			display: flex;
			align-items: center;
			gap: 6px;
			font-size: 11px;
		}

		.sensor-name {
			min-width: 60px;
			font-weight: 500;
		}

		.sensor-slider {
			flex: 1;
			margin: 0;
		}

		.sensor-value {
			min-width: 40px;
			text-align: right;
			font-family: 'Courier New', monospace;
			font-size: 10px;
		}

		.status-indicators {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.status-item {
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: 11px;
		}

		.status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			background: var(--vscode-button-secondaryBackground);
		}

		.status-dot.connected {
			background: var(--vscode-charts-green);
			box-shadow: 0 0 4px rgba(34, 197, 94, 0.6);
		}

		.voltage-display {
			font-family: 'Courier New', monospace;
			font-weight: 600;
			color: var(--vscode-charts-blue);
		}
		</style>

		<script>
		// Hardware simulation JavaScript - compatible with VS Code WebView UI Toolkit
		let ledState = false;
		let pinStates = {};
		let analogValues = { A0: 0, A1: 0, A2: 0, A3: 0 };
		let sensorValues = { temperature: 25, light: 50, accelerometer: 0 };

		// Wait for toolkit to be ready
		window.addEventListener('DOMContentLoaded', () => {
			// Initialize event listeners for VS Code UI components
			initializeHardwareControls();
		});

		function initializeHardwareControls() {
			// Set up pin toggle listeners
			document.querySelectorAll('.pin-toggle').forEach(button => {
				button.addEventListener('click', (e) => {
					const pinName = e.target.getAttribute('data-pin');
					if (pinName) togglePin(pinName);
				});
			});

			// Set up LED toggle listener
			const ledButton = document.querySelector('.led-button');
			if (ledButton) {
				ledButton.addEventListener('click', toggleLED);
			}

			// Set up analog slider listeners
			document.querySelectorAll('.analog-slider').forEach(slider => {
				slider.addEventListener('input', (e) => {
					const pinName = e.target.closest('.analog-control').querySelector('.analog-label').textContent;
					updateAnalogPin(pinName, e.target.value);
				});
			});

			// Set up sensor slider listeners
			document.querySelectorAll('.sensor-slider').forEach(slider => {
				slider.addEventListener('input', (e) => {
					const sensorName = e.target.closest('.sensor-control').querySelector('.sensor-name').textContent.toLowerCase();
					updateSensor(sensorName, e.target.value);
				});
			});
		}

		function togglePin(pinName) {
			pinStates[pinName] = !pinStates[pinName];
			const button = document.querySelector('[data-pin="' + pinName + '"]');
			if (button) {
				button.textContent = pinStates[pinName] ? 'HIGH' : 'LOW';
				button.appearance = pinStates[pinName] ? 'primary' : 'secondary';
			}

			// Broadcast pin state change
			if (window.vscode) {
				window.vscode.postMessage({
					type: 'hardwareSimulation',
					deviceType: 'pin',
					state: { [pinName]: pinStates[pinName] }
				});
			}
		}

		function toggleLED() {
			ledState = !ledState;
			const button = document.querySelector('.led-button');
			const indicator = document.querySelector('.led-indicator');

			if (button) {
				button.appearance = ledState ? 'primary' : 'secondary';
			}

			// Broadcast LED state change
			if (window.vscode) {
				window.vscode.postMessage({
					type: 'hardwareSimulation',
					deviceType: 'led',
					state: { board_LED: ledState }
				});
			}
		}

		function updateAnalogPin(pinName, value) {
			analogValues[pinName] = parseFloat(value);
			const valueElement = document.getElementById(pinName + '-value');
			if (valueElement) {
				valueElement.textContent = value + 'V';
			}

			// Broadcast analog value
			if (window.vscode) {
				window.vscode.postMessage({
					type: 'sensorDataStream',
					sensorName: 'analog.' + pinName,
					value: analogValues[pinName],
					metadata: { units: 'V', range: [0, 3.3] }
				});
			}
		}

		function updateSensor(sensorName, value) {
			sensorValues[sensorName] = parseFloat(value);
			const units = { temperature: '°C', light: '%', accelerometer: 'g' };
			const valueElement = document.getElementById(sensorName + '-value');
			if (valueElement) {
				valueElement.textContent = value + (units[sensorName] || '');
			}

			// Broadcast sensor data
			if (window.vscode) {
				window.vscode.postMessage({
					type: 'sensorDataStream',
					sensorName: sensorName,
					value: sensorValues[sensorName],
					metadata: {
						units: units[sensorName] || '',
						format: 'scalar'
					}
				});
			}
		}

		// Initialize pin states
		['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D13'].forEach(pin => {
			pinStates[pin] = false;
		});
		</script>
		`;
	}

	/**
	 * Generate Serial tab content using VS Code WebView UI Toolkit
	 */
	getSerialTabContent(): string {
		return `
		<div class="serial-settings">
			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>🔌 Connection</h5>
				<div class="connection-controls">
					<div class="form-group">
						<vscode-dropdown id="serial-port">
							<vscode-option value="">Auto-detect</vscode-option>
							<vscode-option value="COM3">COM3 - CircuitPython Device</vscode-option>
							<vscode-option value="COM4">COM4 - USB Serial</vscode-option>
						</vscode-dropdown>
					</div>
					<div class="form-group">
						<vscode-dropdown id="baud-rate">
							<vscode-option value="115200" selected>115200</vscode-option>
							<vscode-option value="9600">9600</vscode-option>
							<vscode-option value="19200">19200</vscode-option>
							<vscode-option value="38400">38400</vscode-option>
							<vscode-option value="57600">57600</vscode-option>
						</vscode-dropdown>
					</div>
					<vscode-button appearance="primary" class="connect-button" onclick="toggleConnection()">
						<span slot="start" class="connection-status codicon codicon-circle-filled"></span>
						Connect
					</vscode-button>
				</div>
			</div>

			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>⚙️ Settings</h5>
				<div class="setting-controls">
					<vscode-checkbox id="auto-connect" checked>Auto-connect on startup</vscode-checkbox>
					<vscode-checkbox id="show-timestamps">Show timestamps</vscode-checkbox>
					<vscode-checkbox id="echo-input">Echo input</vscode-checkbox>
				</div>
			</div>

			<vscode-divider role="separator"></vscode-divider>

			<div class="section">
				<h5>📊 Statistics</h5>
				<div class="stats-display">
					<vscode-data-grid id="serial-stats">
						<vscode-data-grid-row>
							<vscode-data-grid-cell grid-column="1">Bytes Sent</vscode-data-grid-cell>
							<vscode-data-grid-cell grid-column="2" id="bytes-sent">0</vscode-data-grid-cell>
						</vscode-data-grid-row>
						<vscode-data-grid-row>
							<vscode-data-grid-cell grid-column="1">Bytes Received</vscode-data-grid-cell>
							<vscode-data-grid-cell grid-column="2" id="bytes-received">0</vscode-data-grid-cell>
						</vscode-data-grid-row>
						<vscode-data-grid-row>
							<vscode-data-grid-cell grid-column="1">Connection Time</vscode-data-grid-cell>
							<vscode-data-grid-cell grid-column="2" id="connection-time">--:--</vscode-data-grid-cell>
						</vscode-data-grid-row>
					</vscode-data-grid>
				</div>
			</div>
		</div>

		<style>
		.serial-settings {
			font-size: 12px;
		}

		.form-group {
			display: flex;
			flex-direction: column;
			gap: 4px;
			margin-bottom: 8px;
		}

		.form-group label {
			font-weight: 500;
			color: var(--vscode-foreground);
		}

		.form-control {
			background: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
			padding: 4px 6px;
			font-size: 11px;
		}

		.connect-button {
			display: flex;
			align-items: center;
			gap: 6px;
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 6px 12px;
			border-radius: 3px;
			cursor: pointer;
			margin-top: 8px;
			font-size: 11px;
		}

		.connect-button:hover {
			background: var(--vscode-button-hoverBackground);
		}

		.connect-button.connected {
			background: var(--vscode-charts-green);
			color: white;
		}

		.connection-status {
			color: var(--vscode-charts-red);
		}

		.connect-button.connected .connection-status {
			color: white;
		}

		.checkbox-group {
			display: flex;
			align-items: center;
			gap: 6px;
			margin-bottom: 6px;
		}

		.checkbox-group input[type="checkbox"] {
			margin: 0;
		}

		.checkbox-group label {
			cursor: pointer;
			font-size: 11px;
		}

		.stats-display {
			display: flex;
			flex-direction: column;
			gap: 4px;
		}

		.stat-item {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding: 2px 0;
		}

		.stat-label {
			font-size: 10px;
			color: var(--vscode-descriptionForeground);
		}

		.stat-value {
			font-family: 'Courier New', monospace;
			font-size: 10px;
			font-weight: 600;
			color: var(--vscode-charts-blue);
		}
		</style>

		<script>
		let connected = false;
		let connectionStartTime = null;

		function toggleConnection() {
			connected = !connected;
			const button = document.querySelector('.connect-button');
			const port = document.getElementById('serial-port').value;

			if (connected) {
				button.textContent = 'Disconnect';
				button.classList.add('connected');
				connectionStartTime = Date.now();
				startConnectionTimer();

				// Notify extension of connection
				window.vscode.postMessage({
					type: 'serialConnect',
					port: port || 'auto-detected'
				});
			} else {
				button.innerHTML = '<span class="connection-status">●</span>Connect';
				button.classList.remove('connected');
				connectionStartTime = null;
				document.getElementById('connection-time').textContent = '--:--';

				// Notify extension of disconnection
				window.vscode.postMessage({
					type: 'serialDisconnect'
				});
			}
		}

		function startConnectionTimer() {
			if (!connectionStartTime) return;

			const updateTimer = () => {
				if (!connected || !connectionStartTime) return;

				const elapsed = Math.floor((Date.now() - connectionStartTime) / 1000);
				const minutes = Math.floor(elapsed / 60);
				const seconds = elapsed % 60;
				document.getElementById('connection-time').textContent =
					minutes.toString().padStart(2, '0') + ':' + seconds.toString().padStart(2, '0');

				setTimeout(updateTimer, 1000);
			};

			updateTimer();
		}
		</script>
		`;
	}

	/**
	 * Generate Plotter tab content
	 */
	getPlotterTabContent(): string {
		return `
		<div class="plotter-controls">
			<div class="section">
				<h5>📈 Data Visualization</h5>
				<canvas id="mini-chart" width="250" height="120"></canvas>
			</div>

			<div class="section">
				<h5>📊 Data Sources</h5>
				<div class="data-sources">
					<div class="source-item">
						<input type="checkbox" id="source-temp" checked>
						<label for="source-temp">Temperature</label>
						<span class="source-color temp-color"></span>
					</div>
					<div class="source-item">
						<input type="checkbox" id="source-light">
						<label for="source-light">Light Sensor</label>
						<span class="source-color light-color"></span>
					</div>
					<div class="source-item">
						<input type="checkbox" id="source-accel">
						<label for="source-accel">Accelerometer</label>
						<span class="source-color accel-color"></span>
					</div>
				</div>
			</div>

			<div class="section">
				<h5>⚙️ Settings</h5>
				<div class="plot-settings">
					<div class="form-group">
						<label>Time Range:</label>
						<select id="time-range" class="form-control">
							<option value="30">30 seconds</option>
							<option value="60">1 minute</option>
							<option value="300">5 minutes</option>
							<option value="600">10 minutes</option>
						</select>
					</div>
					<div class="form-group">
						<label>Update Rate:</label>
						<select id="update-rate" class="form-control">
							<option value="100">10 Hz</option>
							<option value="500">2 Hz</option>
							<option value="1000">1 Hz</option>
						</select>
					</div>
				</div>
			</div>

			<div class="section">
				<h5>🎮 Controls</h5>
				<div class="control-buttons">
					<button class="control-btn" onclick="pausePlotter()">
						<span id="pause-icon">⏸️</span> Pause
					</button>
					<button class="control-btn" onclick="clearPlotter()">
						🗑️ Clear
					</button>
					<button class="control-btn" onclick="exportData()">
						💾 Export
					</button>
				</div>
			</div>
		</div>

		<style>
		.plotter-controls {
			font-size: 12px;
		}

		#mini-chart {
			width: 100%;
			max-width: 250px;
			height: 120px;
			background: var(--vscode-input-background);
			border: 1px solid var(--vscode-input-border);
			border-radius: 3px;
		}

		.data-sources {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.source-item {
			display: flex;
			align-items: center;
			gap: 6px;
		}

		.source-item label {
			flex: 1;
			font-size: 11px;
			cursor: pointer;
		}

		.source-color {
			width: 12px;
			height: 12px;
			border-radius: 2px;
			border: 1px solid var(--vscode-panel-border);
		}

		.temp-color { background: #ff6b6b; }
		.light-color { background: #4ecdc4; }
		.accel-color { background: #45b7d1; }

		.plot-settings {
			display: flex;
			flex-direction: column;
			gap: 8px;
		}

		.control-buttons {
			display: flex;
			gap: 4px;
			flex-wrap: wrap;
		}

		.control-btn {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			padding: 4px 8px;
			border-radius: 3px;
			cursor: pointer;
			font-size: 10px;
			flex: 1;
			min-width: 60px;
		}

		.control-btn:hover {
			background: var(--vscode-button-hoverBackground);
		}
		</style>

		<script>
		let plotterPaused = false;
		let plotData = [];

		// Initialize mini chart
		const canvas = document.getElementById('mini-chart');
		const ctx = canvas.getContext('2d');

		function drawMiniChart() {
			const width = canvas.width;
			const height = canvas.height;

			// Clear canvas
			ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--vscode-input-background');
			ctx.fillRect(0, 0, width, height);

			// Draw grid
			ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--vscode-panel-border');
			ctx.lineWidth = 0.5;

			// Vertical lines
			for (let x = 0; x <= width; x += width / 10) {
				ctx.beginPath();
				ctx.moveTo(x, 0);
				ctx.lineTo(x, height);
				ctx.stroke();
			}

			// Horizontal lines
			for (let y = 0; y <= height; y += height / 6) {
				ctx.beginPath();
				ctx.moveTo(0, y);
				ctx.lineTo(width, y);
				ctx.stroke();
			}

			// Draw sample data wave
			ctx.strokeStyle = '#ff6b6b';
			ctx.lineWidth = 2;
			ctx.beginPath();

			for (let x = 0; x < width; x += 2) {
				const y = height / 2 + Math.sin(x * 0.1 + Date.now() * 0.01) * 20;
				if (x === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.stroke();
		}

		function pausePlotter() {
			plotterPaused = !plotterPaused;
			const icon = document.getElementById('pause-icon');
			icon.textContent = plotterPaused ? '▶️' : '⏸️';

			window.vscode.postMessage({
				type: 'plotterControl',
				action: plotterPaused ? 'pause' : 'resume'
			});
		}

		function clearPlotter() {
			plotData = [];
			drawMiniChart();

			window.vscode.postMessage({
				type: 'plotterControl',
				action: 'clear'
			});
		}

		function exportData() {
			window.vscode.postMessage({
				type: 'plotterControl',
				action: 'export'
			});
		}

		// Animate the mini chart
		setInterval(() => {
			if (!plotterPaused) {
				drawMiniChart();
			}
		}, 100);

		// Initialize chart
		drawMiniChart();
		</script>
		`;
	}

	/**
	 * Private helper methods
	 */
	private generateDigitalPins(): string {
		const pins = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D13'];
		return pins.map(pin => `
			<div class="pin-control">
				<vscode-tag class="pin-label">${pin}</vscode-tag>
				<vscode-button appearance="secondary" size="small" class="pin-toggle" data-pin="${pin}" onclick="togglePin('${pin}')">
					LOW
				</vscode-button>
			</div>
		`).join('');
	}

	private generateAnalogPins(): string {
		const pins = ['A0', 'A1', 'A2', 'A3'];
		return pins.map(pin => `
			<div class="analog-control">
				<vscode-tag class="analog-label">${pin}</vscode-tag>
				<vscode-text-field
					type="range"
					class="analog-slider"
					min="0"
					max="3.3"
					step="0.1"
					value="0"
					oninput="updateAnalogPin('${pin}', this.value)">
				</vscode-text-field>
				<vscode-tag class="analog-value" id="${pin}-value">0.0V</vscode-tag>
			</div>
		`).join('');
	}

	private generateSensorControls(): string {
		const sensors = [
			{ name: 'temperature', label: 'Temperature', min: -20, max: 50, value: 25, unit: '°C' },
			{ name: 'light', label: 'Light', min: 0, max: 100, value: 50, unit: '%' },
			{ name: 'accelerometer', label: 'Accel X', min: -2, max: 2, value: 0, step: 0.1, unit: 'g' }
		];

		return sensors.map(sensor => `
			<div class="sensor-control">
				<vscode-tag class="sensor-name">${sensor.label}</vscode-tag>
				<vscode-text-field
					type="range"
					class="sensor-slider"
					min="${sensor.min}"
					max="${sensor.max}"
					step="${sensor.step || 1}"
					value="${sensor.value}"
					oninput="updateSensor('${sensor.name}', this.value)">
				</vscode-text-field>
				<vscode-tag class="sensor-value" id="${sensor.name}-value">${sensor.value}${sensor.unit}</vscode-tag>
			</div>
		`).join('');
	}
}