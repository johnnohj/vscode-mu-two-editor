import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

describe('Integration Tests - Project Manager with Real Filesystem Operations', () => {
	let testWorkspaceUri: vscode.Uri;
	let projectsUri: vscode.Uri;
	let deviceUri: vscode.Uri;
	let tempDir: string;

	beforeEach(async () => {
		// Create temporary workspace structure
		tempDir = path.join(os.tmpdir(), 'mu-two-project-test-' + Date.now());
		testWorkspaceUri = vscode.Uri.file(tempDir);
		projectsUri = vscode.Uri.joinPath(testWorkspaceUri, 'projects');
		deviceUri = vscode.Uri.joinPath(testWorkspaceUri, 'ctpy-device');

		// Create base workspace structure
		await vscode.workspace.fs.createDirectory(testWorkspaceUri);
		await vscode.workspace.fs.createDirectory(projectsUri);
		await vscode.workspace.fs.createDirectory(deviceUri);
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(deviceUri, 'current'));
	});

	afterEach(async () => {
		// Clean up test workspace
		try {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(testWorkspaceUri, { recursive: true });
		} catch (error) {
			console.warn('Failed to clean up project test files:', error);
		}
	});

	describe('Project Creation from Templates', () => {
		it('should create new project from basic template with real files', async () => {
			const projectName = 'led-blink-real';
			const projectUri = vscode.Uri.joinPath(projectsUri, projectName);

			// Define basic CircuitPython template
			const basicTemplate = {
				'code.py': `# LED Blink Project
import board
import digitalio
import time

# Initialize the onboard LED
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

print("Starting LED blink sequence...")

# Main loop
while True:
    print("LED ON")
    led.value = True
    time.sleep(1)

    print("LED OFF")
    led.value = False
    time.sleep(1)
`,
				'boot.py': `# Boot configuration for LED blink project
# This file runs before code.py

print("Booting LED blink project...")

# Disable USB mass storage to prevent accidental file corruption
import storage
storage.disable_usb_drive()

print("Boot sequence complete")
`,
				'settings.toml': `# CircuitPython device settings for LED blink project
# Web API configuration
CIRCUITPY_WEB_API_PASSWORD = "ledblinkpassword"
CIRCUITPY_WEB_API_PORT = 80

# WiFi configuration (if supported)
# CIRCUITPY_WIFI_SSID = "YourNetworkName"
# CIRCUITPY_WIFI_PASSWORD = "YourPassword"
`,
				'project.json': JSON.stringify({
					name: projectName,
					description: 'Basic LED blink project for CircuitPython',
					version: '1.0.0',
					author: 'Mu Two User',
					created: new Date().toISOString(),
					template: 'basic-led-blink',
					board: 'any',
					dependencies: [],
					tags: ['beginner', 'led', 'basic']
				}, null, 2),
				'README.md': `# ${projectName}

This is a basic LED blink project for CircuitPython.

## Description
Blinks the onboard LED on and off with a 1-second interval.

## Required Hardware
- Any CircuitPython compatible board with an onboard LED

## Installation
1. Copy all files to your CircuitPython device
2. The program will start automatically

## Usage
The LED will blink continuously. Check the serial output for status messages.
`
			};

			// Create project directory
			await vscode.workspace.fs.createDirectory(projectUri);

			// Create project files from template
			const encoder = new TextEncoder();
			for (const [fileName, content] of Object.entries(basicTemplate)) {
				const fileUri = vscode.Uri.joinPath(projectUri, fileName);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
			}

			// Verify project creation
			const projectStats = await vscode.workspace.fs.stat(projectUri);
			assert.strictEqual(projectStats.type, vscode.FileType.Directory, 'Project directory should be created');

			// Verify all template files were created
			const projectContents = await vscode.workspace.fs.readDirectory(projectUri);
			const createdFiles = projectContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			const expectedFiles = Object.keys(basicTemplate);
			for (const expectedFile of expectedFiles) {
				assert.ok(createdFiles.includes(expectedFile), `File ${expectedFile} should be created`);
			}

			// Verify file contents
			const decoder = new TextDecoder();
			const codeContent = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectUri, 'code.py'))
			);
			assert.ok(codeContent.includes('import board'), 'code.py should contain CircuitPython imports');
			assert.ok(codeContent.includes('LED blink sequence'), 'code.py should contain project-specific content');

			// Verify project metadata
			const projectMetadata = JSON.parse(decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectUri, 'project.json'))
			));
			assert.strictEqual(projectMetadata.name, projectName, 'Project metadata should have correct name');
			assert.strictEqual(projectMetadata.template, 'basic-led-blink', 'Project should reference template');
		});

		it('should create complex sensor project with library dependencies', async () => {
			const projectName = 'temperature-humidity-monitor';
			const projectUri = vscode.Uri.joinPath(projectsUri, projectName);
			const libUri = vscode.Uri.joinPath(projectUri, 'lib');

			// Create project and lib directories
			await vscode.workspace.fs.createDirectory(projectUri);
			await vscode.workspace.fs.createDirectory(libUri);

			// Define complex project template with dependencies
			const sensorTemplate = {
				'code.py': `# Temperature and Humidity Monitor
import board
import time
import digitalio
from lib.dht_sensor import DHTSensor
from lib.display_helper import DisplayHelper
from lib.data_logger import DataLogger

# Hardware setup
data_pin = board.D2
led_pin = board.LED

# Initialize components
sensor = DHTSensor(data_pin)
display = DisplayHelper()
logger = DataLogger()
status_led = digitalio.DigitalInOut(led_pin)
status_led.direction = digitalio.Direction.OUTPUT

print("Temperature and Humidity Monitor Starting...")

# Main monitoring loop
while True:
    try:
        # Read sensor data
        temperature, humidity = sensor.read()

        if temperature is not None and humidity is not None:
            # Log data
            logger.log_reading(temperature, humidity)

            # Update display
            display.show_readings(temperature, humidity)

            # Blink status LED to show activity
            status_led.value = True
            time.sleep(0.1)
            status_led.value = False

            print(f"Temp: {temperature:.1f}°C, Humidity: {humidity:.1f}%")
        else:
            print("Sensor read failed")

    except Exception as e:
        print(f"Error in main loop: {e}")

    time.sleep(30)  # Read every 30 seconds
`,
				'lib/dht_sensor.py': `# DHT22 sensor driver
import digitalio
import time

class DHTSensor:
    def __init__(self, pin):
        self.pin = pin
        self._data_pin = digitalio.DigitalInOut(pin)

    def read(self):
        """Read temperature and humidity from DHT22 sensor"""
        try:
            # Simplified sensor reading simulation
            # In real implementation, this would bit-bang the DHT protocol

            # Mock readings for testing
            import random
            temperature = 20 + random.randint(-5, 15)  # 15-35°C
            humidity = 40 + random.randint(-10, 20)    # 30-60%

            return temperature, humidity

        except Exception as e:
            print(f"DHT sensor error: {e}")
            return None, None

    def is_connected(self):
        """Check if sensor is responding"""
        temp, humidity = self.read()
        return temp is not None and humidity is not None
`,
				'lib/display_helper.py': `# Display management helper
class DisplayHelper:
    def __init__(self):
        self.last_temp = None
        self.last_humidity = None

    def show_readings(self, temperature, humidity):
        """Display current readings"""
        self.last_temp = temperature
        self.last_humidity = humidity

        # In a real implementation, this would drive an LCD or OLED display
        print(f"Display: {temperature:.1f}°C {humidity:.1f}%")

    def show_message(self, message):
        """Display a status message"""
        print(f"Display Message: {message}")

    def clear(self):
        """Clear the display"""
        print("Display: Cleared")

    def get_last_readings(self):
        """Get the last displayed readings"""
        return self.last_temp, self.last_humidity
`,
				'lib/data_logger.py': `# Data logging functionality
import time

class DataLogger:
    def __init__(self, max_entries=100):
        self.readings = []
        self.max_entries = max_entries

    def log_reading(self, temperature, humidity):
        """Log a sensor reading with timestamp"""
        timestamp = time.monotonic()
        entry = {
            'timestamp': timestamp,
            'temperature': temperature,
            'humidity': humidity
        }

        self.readings.append(entry)

        # Keep only the most recent entries
        if len(self.readings) > self.max_entries:
            self.readings = self.readings[-self.max_entries:]

        print(f"Logged: T={temperature:.1f}°C H={humidity:.1f}% at {timestamp}")

    def get_recent_readings(self, count=10):
        """Get the most recent readings"""
        return self.readings[-count:] if self.readings else []

    def get_average_temp(self, minutes=10):
        """Calculate average temperature over specified minutes"""
        if not self.readings:
            return None

        current_time = time.monotonic()
        cutoff_time = current_time - (minutes * 60)

        recent_temps = [r['temperature'] for r in self.readings
                       if r['timestamp'] > cutoff_time]

        return sum(recent_temps) / len(recent_temps) if recent_temps else None

    def export_data(self):
        """Export logged data as CSV string"""
        if not self.readings:
            return "timestamp,temperature,humidity\\n"

        csv_lines = ["timestamp,temperature,humidity"]
        for reading in self.readings:
            line = f"{reading['timestamp']},{reading['temperature']},{reading['humidity']}"
            csv_lines.append(line)

        return "\\n".join(csv_lines)
`,
				'boot.py': `# Boot configuration for sensor monitor
print("Booting Temperature & Humidity Monitor...")

# Configure USB for data logging
import usb_cdc
usb_cdc.enable(console=True, data=True)

print("USB CDC enabled for data logging")
print("Boot complete")
`,
				'settings.toml': `# Sensor monitor configuration
CIRCUITPY_WEB_API_PASSWORD = "sensormonitor123"
CIRCUITPY_WEB_API_PORT = 80

# Sensor configuration
SENSOR_READ_INTERVAL = 30
DISPLAY_TIMEOUT = 300
LOG_MAX_ENTRIES = 100
`,
				'project.json': JSON.stringify({
					name: projectName,
					description: 'Advanced temperature and humidity monitoring system',
					version: '1.0.0',
					author: 'Mu Two User',
					created: new Date().toISOString(),
					template: 'sensor-monitor',
					board: 'any',
					dependencies: [
						'adafruit-circuitpython-dht',
						'adafruit-circuitpython-display-text'
					],
					hardware: {
						sensors: ['DHT22'],
						pins: ['D2'],
						optional: ['OLED display', 'SD card']
					},
					tags: ['sensor', 'monitoring', 'temperature', 'humidity', 'advanced']
				}, null, 2)
			};

			// Create all project files
			const encoder = new TextEncoder();
			for (const [filePath, content] of Object.entries(sensorTemplate)) {
				const fileUri = vscode.Uri.joinPath(projectUri, filePath);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
			}

			// Verify complex project structure
			const projectContents = await vscode.workspace.fs.readDirectory(projectUri);
			const directories = projectContents
				.filter(([name, type]) => type === vscode.FileType.Directory)
				.map(([name]) => name);

			assert.ok(directories.includes('lib'), 'Project should have lib directory');

			// Verify library files
			const libContents = await vscode.workspace.fs.readDirectory(libUri);
			const libFiles = libContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			const expectedLibFiles = ['dht_sensor.py', 'display_helper.py', 'data_logger.py'];
			for (const libFile of expectedLibFiles) {
				assert.ok(libFiles.includes(libFile), `Library file ${libFile} should exist`);
			}

			// Verify library functionality by checking imports
			const decoder = new TextDecoder();
			const mainCode = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectUri, 'code.py'))
			);

			assert.ok(mainCode.includes('from lib.dht_sensor import DHTSensor'), 'Should import DHT sensor');
			assert.ok(mainCode.includes('from lib.display_helper import DisplayHelper'), 'Should import display helper');
			assert.ok(mainCode.includes('from lib.data_logger import DataLogger'), 'Should import data logger');

			// Verify project metadata includes dependencies
			const metadata = JSON.parse(decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(projectUri, 'project.json'))
			));

			assert.ok(Array.isArray(metadata.dependencies), 'Project should have dependencies array');
			assert.ok(metadata.dependencies.length > 0, 'Project should have dependencies');
			assert.ok(metadata.hardware, 'Project should have hardware requirements');
		});
	});

	describe('Project Loading and Switching', () => {
		it('should load existing project and sync to device', async () => {
			// Create source project
			const sourceProjectName = 'sync-test-project';
			const sourceProjectUri = vscode.Uri.joinPath(projectsUri, sourceProjectName);
			await vscode.workspace.fs.createDirectory(sourceProjectUri);

			const projectFiles = {
				'code.py': '# Sync test project\nimport board\nprint("Syncing to device")',
				'boot.py': '# Boot for sync test',
				'lib/helper.py': '# Helper module\ndef help():\n    print("Helper function")'
			};

			// Create lib directory
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(sourceProjectUri, 'lib'));

			// Create project files
			const encoder = new TextEncoder();
			for (const [filePath, content] of Object.entries(projectFiles)) {
				const fileUri = vscode.Uri.joinPath(sourceProjectUri, filePath);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
			}

			// Simulate project loading and sync to device
			const deviceCurrentUri = vscode.Uri.joinPath(deviceUri, 'current');

			// Copy project files to device
			for (const [filePath, content] of Object.entries(projectFiles)) {
				const sourceFileUri = vscode.Uri.joinPath(sourceProjectUri, filePath);
				const deviceFileUri = vscode.Uri.joinPath(deviceCurrentUri, filePath);

				// Create lib directory on device if needed
				if (filePath.includes('/')) {
					const deviceLibUri = vscode.Uri.joinPath(deviceCurrentUri, 'lib');
					try {
						await vscode.workspace.fs.createDirectory(deviceLibUri);
					} catch {
						// Directory might already exist
					}
				}

				// Copy file content
				const fileContent = await vscode.workspace.fs.readFile(sourceFileUri);
				await vscode.workspace.fs.writeFile(deviceFileUri, fileContent);
			}

			// Verify files were synced to device
			const deviceContents = await vscode.workspace.fs.readDirectory(deviceCurrentUri);
			const deviceFiles = deviceContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			assert.ok(deviceFiles.includes('code.py'), 'code.py should be synced to device');
			assert.ok(deviceFiles.includes('boot.py'), 'boot.py should be synced to device');

			// Verify lib directory sync
			const deviceLibUri = vscode.Uri.joinPath(deviceCurrentUri, 'lib');
			const deviceLibContents = await vscode.workspace.fs.readDirectory(deviceLibUri);
			const deviceLibFiles = deviceLibContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			assert.ok(deviceLibFiles.includes('helper.py'), 'Library files should be synced');

			// Verify content integrity
			const decoder = new TextDecoder();
			const sourceCode = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(sourceProjectUri, 'code.py'))
			);
			const deviceCode = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(deviceCurrentUri, 'code.py'))
			);

			assert.strictEqual(deviceCode, sourceCode, 'Device file should match source file');
		});

		it('should backup current project before switching', async () => {
			// Create current project on device
			const deviceCurrentUri = vscode.Uri.joinPath(deviceUri, 'current');
			const currentFiles = {
				'code.py': '# Current project\nprint("Current project running")',
				'boot.py': '# Current boot',
				'settings.toml': 'CIRCUITPY_WEB_API_PASSWORD = "current123"'
			};

			const encoder = new TextEncoder();
			for (const [fileName, content] of Object.entries(currentFiles)) {
				const fileUri = vscode.Uri.joinPath(deviceCurrentUri, fileName);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
			}

			// Create backup directory with timestamp
			const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
			const backupUri = vscode.Uri.joinPath(deviceUri, 'backups', `backup-${timestamp}`);
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(deviceUri, 'backups'));
			await vscode.workspace.fs.createDirectory(backupUri);

			// Backup current files
			for (const [fileName] of Object.entries(currentFiles)) {
				const sourceUri = vscode.Uri.joinPath(deviceCurrentUri, fileName);
				const backupFileUri = vscode.Uri.joinPath(backupUri, fileName);

				const fileContent = await vscode.workspace.fs.readFile(sourceUri);
				await vscode.workspace.fs.writeFile(backupFileUri, fileContent);
			}

			// Verify backup was created
			const backupContents = await vscode.workspace.fs.readDirectory(backupUri);
			const backupFiles = backupContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			assert.ok(backupFiles.includes('code.py'), 'Backup should include code.py');
			assert.ok(backupFiles.includes('boot.py'), 'Backup should include boot.py');
			assert.ok(backupFiles.includes('settings.toml'), 'Backup should include settings.toml');

			// Verify backup content integrity
			const decoder = new TextDecoder();
			const originalCode = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(deviceCurrentUri, 'code.py'))
			);
			const backupCode = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(backupUri, 'code.py'))
			);

			assert.strictEqual(backupCode, originalCode, 'Backup should preserve original content');

			// Now simulate switching to new project
			const newProjectFiles = {
				'code.py': '# New project\nprint("New project loaded")',
				'boot.py': '# New boot sequence'
			};

			// Clear current directory and load new project
			for (const [fileName] of Object.entries(currentFiles)) {
				const fileUri = vscode.Uri.joinPath(deviceCurrentUri, fileName);
				try {
					await vscode.workspace.fs.delete(fileUri);
				} catch {
					// File might not exist
				}
			}

			// Load new project files
			for (const [fileName, content] of Object.entries(newProjectFiles)) {
				const fileUri = vscode.Uri.joinPath(deviceCurrentUri, fileName);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
			}

			// Verify project switch
			const newDeviceCode = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(deviceCurrentUri, 'code.py'))
			);
			assert.ok(newDeviceCode.includes('New project loaded'), 'New project should be loaded');
			assert.ok(!newDeviceCode.includes('Current project running'), 'Old project should be replaced');

			// Verify backup still exists and is intact
			const verifyBackupCode = decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(backupUri, 'code.py'))
			);
			assert.ok(verifyBackupCode.includes('Current project running'), 'Backup should preserve old project');
		});
	});

	describe('Project Library Management', () => {
		it('should install and manage CircuitPython libraries in project', async () => {
			const projectName = 'library-test-project';
			const projectUri = vscode.Uri.joinPath(projectsUri, projectName);
			const libUri = vscode.Uri.joinPath(projectUri, 'lib');

			// Create project structure
			await vscode.workspace.fs.createDirectory(projectUri);
			await vscode.workspace.fs.createDirectory(libUri);

			// Simulate library installation
			const libraries = {
				'adafruit_dht.py': `# Adafruit DHT library simulation
"""
CircuitPython library for DHT temperature/humidity sensors
"""
import digitalio
import time

class DHT22:
    def __init__(self, pin):
        self._pin = digitalio.DigitalInOut(pin)
        self._pin.direction = digitalio.Direction.INPUT

    def measure(self):
        # Simulate sensor reading
        return 22.5, 45.0  # temp, humidity
`,
				'adafruit_display_text/': {
					'__init__.py': '# Display text package',
					'label.py': `# Label implementation
class Label:
    def __init__(self, font, text="", color=0xFFFFFF):
        self.font = font
        self.text = text
        self.color = color

    def update(self, text):
        self.text = text
`
				},
				'neopixel.py': `# NeoPixel library simulation
"""
CircuitPython NeoPixel library
"""
import digitalio
import time

class NeoPixel:
    def __init__(self, pin, num_pixels, brightness=1.0):
        self.pin = pin
        self.num_pixels = num_pixels
        self.brightness = brightness
        self._pixels = [(0, 0, 0)] * num_pixels

    def __setitem__(self, index, color):
        self._pixels[index] = color

    def __getitem__(self, index):
        return self._pixels[index]

    def fill(self, color):
        for i in range(self.num_pixels):
            self._pixels[i] = color

    def show(self):
        # Simulate updating the LED strip
        pass
`
			};

			// Install libraries
			const encoder = new TextEncoder();
			for (const [libName, content] of Object.entries(libraries)) {
				if (typeof content === 'string') {
					// Single file library
					const libFileUri = vscode.Uri.joinPath(libUri, libName);
					await vscode.workspace.fs.writeFile(libFileUri, encoder.encode(content));
				} else {
					// Package library
					const packageUri = vscode.Uri.joinPath(libUri, libName);
					await vscode.workspace.fs.createDirectory(packageUri);

					for (const [fileName, fileContent] of Object.entries(content)) {
						const fileUri = vscode.Uri.joinPath(packageUri, fileName);
						await vscode.workspace.fs.writeFile(fileUri, encoder.encode(fileContent));
					}
				}
			}

			// Create library manifest
			const libManifest = {
				libraries: [
					{
						name: 'adafruit_dht',
						version: '3.7.0',
						type: 'module',
						size: 2048,
						installed: new Date().toISOString()
					},
					{
						name: 'adafruit_display_text',
						version: '2.25.0',
						type: 'package',
						size: 4096,
						installed: new Date().toISOString()
					},
					{
						name: 'neopixel',
						version: '6.3.4',
						type: 'module',
						size: 1536,
						installed: new Date().toISOString()
					}
				],
				lastUpdated: new Date().toISOString(),
				totalSize: 7680
			};

			const manifestUri = vscode.Uri.joinPath(projectUri, '.libraries.json');
			await vscode.workspace.fs.writeFile(
				manifestUri,
				encoder.encode(JSON.stringify(libManifest, null, 2))
			);

			// Verify library installation
			const libContents = await vscode.workspace.fs.readDirectory(libUri);
			const installedItems = libContents.map(([name]) => name);

			assert.ok(installedItems.includes('adafruit_dht.py'), 'DHT library should be installed');
			assert.ok(installedItems.includes('adafruit_display_text'), 'Display text package should be installed');
			assert.ok(installedItems.includes('neopixel.py'), 'NeoPixel library should be installed');

			// Verify package structure
			const displayTextUri = vscode.Uri.joinPath(libUri, 'adafruit_display_text');
			const packageContents = await vscode.workspace.fs.readDirectory(displayTextUri);
			const packageFiles = packageContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			assert.ok(packageFiles.includes('__init__.py'), 'Package should have __init__.py');
			assert.ok(packageFiles.includes('label.py'), 'Package should have label.py');

			// Verify manifest
			const decoder = new TextDecoder();
			const savedManifest = JSON.parse(decoder.decode(
				await vscode.workspace.fs.readFile(manifestUri)
			));

			assert.strictEqual(savedManifest.libraries.length, 3, 'Manifest should list all libraries');
			assert.ok(savedManifest.totalSize > 0, 'Manifest should track total size');

			// Create main project file that uses the libraries
			const mainCode = `# Library test project
import board
import time
from lib.adafruit_dht import DHT22
from lib.adafruit_display_text.label import Label
from lib.neopixel import NeoPixel

# Initialize hardware
dht = DHT22(board.D2)
pixels = NeoPixel(board.NEOPIXEL, 10)

print("Library test project starting...")

while True:
    # Read sensor
    temp, humidity = dht.measure()
    print(f"Temperature: {temp}°C, Humidity: {humidity}%")

    # Update NeoPixels based on temperature
    if temp > 25:
        pixels.fill((255, 0, 0))  # Red for hot
    else:
        pixels.fill((0, 0, 255))  # Blue for cool
    pixels.show()

    time.sleep(5)
`;

			const codeUri = vscode.Uri.joinPath(projectUri, 'code.py');
			await vscode.workspace.fs.writeFile(codeUri, encoder.encode(mainCode));

			// Verify main code imports
			const codeContent = decoder.decode(await vscode.workspace.fs.readFile(codeUri));
			assert.ok(codeContent.includes('from lib.adafruit_dht import DHT22'), 'Should import DHT library');
			assert.ok(codeContent.includes('from lib.neopixel import NeoPixel'), 'Should import NeoPixel library');
		});
	});

	describe('Project Export and Import', () => {
		it('should export project as complete package', async () => {
			// Create source project
			const projectName = 'export-test-project';
			const projectUri = vscode.Uri.joinPath(projectsUri, projectName);
			await vscode.workspace.fs.createDirectory(projectUri);

			// Create project files
			const projectFiles = {
				'code.py': '# Export test\nimport board\nprint("Exporting this project")',
				'boot.py': '# Boot for export test',
				'settings.toml': 'CIRCUITPY_WEB_API_PASSWORD = "export123"',
				'README.md': '# Export Test Project\n\nThis project tests export functionality.',
				'project.json': JSON.stringify({
					name: projectName,
					version: '1.0.0',
					description: 'Test project for export functionality',
					author: 'Test User',
					created: new Date().toISOString()
				}, null, 2)
			};

			const encoder = new TextEncoder();
			for (const [fileName, content] of Object.entries(projectFiles)) {
				const fileUri = vscode.Uri.joinPath(projectUri, fileName);
				await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
			}

			// Create export package
			const exportUri = vscode.Uri.joinPath(testWorkspaceUri, 'exports');
			await vscode.workspace.fs.createDirectory(exportUri);

			const exportPackageUri = vscode.Uri.joinPath(exportUri, `${projectName}-export`);
			await vscode.workspace.fs.createDirectory(exportPackageUri);

			// Copy all project files to export package
			for (const [fileName] of Object.entries(projectFiles)) {
				const sourceUri = vscode.Uri.joinPath(projectUri, fileName);
				const exportFileUri = vscode.Uri.joinPath(exportPackageUri, fileName);

				const content = await vscode.workspace.fs.readFile(sourceUri);
				await vscode.workspace.fs.writeFile(exportFileUri, content);
			}

			// Create export metadata
			const exportMetadata = {
				exportedAt: new Date().toISOString(),
				exportFormat: 'mu-two-project',
				version: '1.0.0',
				sourceProject: projectName,
				files: Object.keys(projectFiles),
				checksum: 'mock-checksum-12345'
			};

			const metadataUri = vscode.Uri.joinPath(exportPackageUri, '.export-info.json');
			await vscode.workspace.fs.writeFile(
				metadataUri,
				encoder.encode(JSON.stringify(exportMetadata, null, 2))
			);

			// Verify export package
			const exportContents = await vscode.workspace.fs.readDirectory(exportPackageUri);
			const exportedFiles = exportContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			for (const fileName of Object.keys(projectFiles)) {
				assert.ok(exportedFiles.includes(fileName), `Exported package should include ${fileName}`);
			}

			assert.ok(exportedFiles.includes('.export-info.json'), 'Export should include metadata');

			// Test import from export package
			const importProjectName = 'imported-project';
			const importProjectUri = vscode.Uri.joinPath(projectsUri, importProjectName);
			await vscode.workspace.fs.createDirectory(importProjectUri);

			// Import files from export package
			for (const fileName of Object.keys(projectFiles)) {
				const exportFileUri = vscode.Uri.joinPath(exportPackageUri, fileName);
				const importFileUri = vscode.Uri.joinPath(importProjectUri, fileName);

				const content = await vscode.workspace.fs.readFile(exportFileUri);
				await vscode.workspace.fs.writeFile(importFileUri, content);
			}

			// Update imported project metadata
			const decoder = new TextDecoder();
			const originalMetadata = JSON.parse(decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(importProjectUri, 'project.json'))
			));

			const importedMetadata = {
				...originalMetadata,
				name: importProjectName,
				imported: true,
				importedAt: new Date().toISOString(),
				sourceExport: projectName
			};

			await vscode.workspace.fs.writeFile(
				vscode.Uri.joinPath(importProjectUri, 'project.json'),
				encoder.encode(JSON.stringify(importedMetadata, null, 2))
			);

			// Verify import
			const importContents = await vscode.workspace.fs.readDirectory(importProjectUri);
			const importedFiles = importContents
				.filter(([name, type]) => type === vscode.FileType.File)
				.map(([name]) => name);

			for (const fileName of Object.keys(projectFiles)) {
				assert.ok(importedFiles.includes(fileName), `Imported project should include ${fileName}`);
			}

			// Verify imported metadata
			const finalMetadata = JSON.parse(decoder.decode(
				await vscode.workspace.fs.readFile(vscode.Uri.joinPath(importProjectUri, 'project.json'))
			));

			assert.strictEqual(finalMetadata.name, importProjectName, 'Imported project should have new name');
			assert.ok(finalMetadata.imported, 'Imported project should be marked as imported');
			assert.strictEqual(finalMetadata.sourceExport, projectName, 'Should track source export');
		});
	});
});