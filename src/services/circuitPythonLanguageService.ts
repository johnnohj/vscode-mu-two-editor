import * as vscode from 'vscode';
import { getLogger } from '../utils/unifiedLogger';

/**
 * CircuitPython Language Service
 *
 * Works alongside the Python extension to provide CircuitPython-specific
 * language features while filtering out unsupported Python functionality.
 */
export class CircuitPythonLanguageService {
	private logger = getLogger();
	private disposables: vscode.Disposable[] = [];
	private diagnosticCollection: vscode.DiagnosticCollection;

	// CircuitPython built-in modules (available without import)
	private readonly CIRCUITPYTHON_BUILTINS = new Set([
		'board', 'microcontroller', 'supervisor', 'gc', 'sys'
	]);

	// Available CircuitPython modules
	private readonly CIRCUITPYTHON_MODULES = new Set([
		'analogio', 'audiobusio', 'audiocore', 'audiomixer', 'audiomp3',
		'audiopwmio', 'bitbangio', 'board', 'busio', 'digitalio',
		'displayio', 'gamepad', 'i2cperipheral', 'math', 'microcontroller',
		'multiterminal', 'neopixel_write', 'os', 'pulseio', 'pwmio',
		'random', 'rotaryio', 'storage', 'struct', 'supervisor', 'time',
		'touchio', 'ulab', 'usb_cdc', 'usb_hid', 'usb_midi', 'vectorio'
	]);

	// CircuitPython subset libraries (limited versions of Python stdlib)
	private readonly CIRCUITPYTHON_SUBSET_MODULES = new Set([
		'asyncio',    // Limited async support
		'json',       // Basic JSON encode/decode
		'ssl',        // Basic SSL/TLS support
		'socket',     // Limited socket support (mainly for networking libraries)
		're',         // Basic regex support
		'collections', // Limited collections (namedtuple, OrderedDict)
		'binascii',   // Binary/ASCII conversions
		'hashlib',    // Basic hashing (limited algorithms)
		'errno',      // System error codes
		'io',         // Basic I/O operations
		'zlib'        // Data compression
	]);

	// CircuitPython Bundle Libraries (adafruit-circuitpython-* packages)
	private readonly CIRCUITPYTHON_BUNDLE_LIBRARIES = new Set([
		// Core/Foundation
		'adafruit_bus_device', 'adafruit_register',

		// Sensors - Motion & Environmental
		'adafruit_bno055', 'adafruit_bme280', 'adafruit_bmp280', 'adafruit_mpu6050',
		'adafruit_lis3dh', 'adafruit_lsm6ds', 'adafruit_dps310', 'adafruit_bmp3xx',
		'adafruit_sht31d', 'adafruit_si7021', 'adafruit_sgp30', 'adafruit_ccs811',
		'adafruit_tsl2591', 'adafruit_veml7700', 'adafruit_apds9960', 'adafruit_vcnl4010',

		// Displays
		'adafruit_ssd1306', 'adafruit_st7789', 'adafruit_ili9341', 'adafruit_st7735r',
		'adafruit_hd44780', 'adafruit_ht16k33', 'adafruit_max7219', 'adafruit_is31fl3731',
		'adafruit_epd', 'adafruit_sharp_display', 'adafruit_st7565',

		// Motors & Servos
		'adafruit_motor', 'adafruit_servokit', 'adafruit_motorkit', 'adafruit_crickit',
		'adafruit_pca9685', 'adafruit_drv2605',

		// Communication & Connectivity
		'adafruit_esp32spi', 'adafruit_requests', 'adafruit_minimqtt', 'adafruit_bluefruit_connect',
		'adafruit_ble', 'adafruit_airlift', 'adafruit_wiznet5k', 'adafruit_ntp',

		// Audio
		'adafruit_vs1053', 'adafruit_max98357', 'adafruit_waveform', 'adafruit_midi',

		// LEDs & Animation
		'adafruit_neopixel', 'adafruit_dotstar', 'adafruit_fancyled', 'adafruit_led_animation',
		'adafruit_pixelbuf', 'adafruit_ws2801',

		// Input Devices
		'adafruit_mcp230xx', 'adafruit_mpr121', 'adafruit_cap1188', 'adafruit_rotary_encoder',
		'adafruit_debouncer', 'adafruit_matrixkeypad',

		// Real-Time Clock
		'adafruit_ds1307', 'adafruit_ds3231', 'adafruit_pcf8523',

		// Memory & Storage
		'adafruit_sd', 'adafruit_fram', 'adafruit_at24c32',

		// Power Management
		'adafruit_max1704x', 'adafruit_lc709203f', 'adafruit_ina219', 'adafruit_ina260',

		// GPS & Navigation
		'adafruit_gps', 'adafruit_l3gd20',

		// Specialty Libraries
		'adafruit_thermal_printer', 'adafruit_fingerprint', 'adafruit_rfm9x', 'adafruit_rfm69',
		'adafruit_pn532', 'adafruit_mfrc522', 'adafruit_datetime', 'adafruit_logging'
	]);

	// Python modules NOT available in CircuitPython
	private readonly UNSUPPORTED_MODULES = new Set([
		'threading', 'multiprocessing', 'subprocess', 'urllib',
		'http', 'email', 'pickle', 'sqlite3', 'tkinter',
		'concurrent', 'queue', 'selectors', 'hmac',
		'secrets', 'uuid', 'ipaddress', 'wave', 'csv', 'configparser',
		'logging', 'argparse', 'pathlib', 'tempfile', 'shutil', 'glob',
		'fnmatch', 'linecache', 'textwrap', 'unicodedata', 'stringprep',
		'readline', 'rlcompleter', 'pprint', 'reprlib', 'enum', 'types',
		'copy', 'pprint', 'weakref', 'contextlib', 'heapq',
		'bisect', 'array', 'sched', 'mutex', 'datetime', 'calendar',
		'statistics', 'fractions', 'decimal', 'numbers', 'cmath',
		'itertools', 'functools', 'operator', 'keyword', 'pkgutil',
		'modulefinder', 'runpy', 'importlib', 'sys', 'builtins', 'warnings',
		'dataclasses', 'abc', 'atexit', 'traceback', 'dis',
		'pickletools', 'platform', 'ctypes', 'winreg', 'winsound',
		'posix', 'pwd', 'spwd', 'grp', 'crypt', 'termios', 'tty',
		'pty', 'fcntl', 'pipes', 'resource', 'nis', 'syslog'
	]);

	// CircuitPython-specific functions/features
	private readonly CIRCUITPYTHON_FEATURES = {
		// board module pins and features
		board: [
			'LED', 'NEOPIXEL', 'BUTTON', 'SWITCH',
			'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7',
			'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13',
			'SCL', 'SDA', 'MOSI', 'MISO', 'SCK', 'CS',
			'TX', 'RX', 'CTS', 'RTS',
			'I2C', 'SPI', 'UART'
		],
		// digitalio module
		digitalio: [
			'DigitalInOut', 'Direction', 'DriveMode', 'Pull'
		],
		// analogio module
		analogio: [
			'AnalogIn', 'AnalogOut'
		],
		// pwmio module
		pwmio: [
			'PWMOut'
		],
		// busio module
		busio: [
			'I2C', 'SPI', 'UART'
		],
		// time module (CircuitPython version)
		time: [
			'sleep', 'monotonic', 'time', 'struct_time', 'mktime', 'localtime'
		]
	};

	constructor(private context: vscode.ExtensionContext) {
		this.diagnosticCollection = vscode.languages.createDiagnosticCollection('circuitpython');
		this.context.subscriptions.push(this.diagnosticCollection);
	}

	/**
	 * Register CircuitPython language providers for mutwo:// scheme files
	 */
	public registerLanguageProviders(): void {
		const circuitPythonSelector: vscode.DocumentSelector = {
			language: 'python',
			scheme: 'mutwo'
		};

		// Completion provider - enhances Python completions with CircuitPython specifics
		const completionProvider = vscode.languages.registerCompletionItemProvider(
			circuitPythonSelector,
			{
				provideCompletionItems: (document, position, token, context) => {
					return this.provideCircuitPythonCompletions(document, position, token, context);
				}
			},
			'.', '(' // Trigger characters
		);

		// Hover provider - CircuitPython-specific documentation
		const hoverProvider = vscode.languages.registerHoverProvider(
			circuitPythonSelector,
			{
				provideHover: (document, position, token) => {
					return this.provideCircuitPythonHover(document, position, token);
				}
			}
		);

		// Code action provider - suggest CircuitPython alternatives
		const codeActionProvider = vscode.languages.registerCodeActionsProvider(
			circuitPythonSelector,
			{
				provideCodeActions: (document, range, context, token) => {
					return this.provideCircuitPythonCodeActions(document, range, context, token);
				}
			}
		);

		// Diagnostic provider - warn about unsupported features
		const documentChangeWatcher = vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.languageId === 'python' && event.document.uri.scheme === 'mutwo') {
				this.validateCircuitPythonCode(event.document);
			}
		});

		const documentOpenWatcher = vscode.workspace.onDidOpenTextDocument(document => {
			if (document.languageId === 'python' && document.uri.scheme === 'mutwo') {
				this.validateCircuitPythonCode(document);
			}
		});

		this.disposables.push(
			completionProvider,
			hoverProvider,
			codeActionProvider,
			documentChangeWatcher,
			documentOpenWatcher
		);

		this.logger.info('EXTENSION', 'CircuitPython language service providers registered');
	}

	/**
	 * Provide CircuitPython-enhanced completions
	 */
	private async provideCircuitPythonCompletions(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[]> {
		const completions: vscode.CompletionItem[] = [];
		const lineText = document.lineAt(position.line).text;
		const linePrefix = lineText.substring(0, position.character);

		// Handle module.attribute completions
		const moduleMatch = linePrefix.match(/(\w+)\.$/);
		if (moduleMatch) {
			const moduleName = moduleMatch[1];
			const features = this.CIRCUITPYTHON_FEATURES[moduleName as keyof typeof this.CIRCUITPYTHON_FEATURES];

			if (features) {
				features.forEach(feature => {
					const completion = new vscode.CompletionItem(feature, vscode.CompletionItemKind.Property);
					completion.detail = `CircuitPython ${moduleName}.${feature}`;
					completion.documentation = new vscode.MarkdownString(
						`CircuitPython feature: \`${moduleName}.${feature}\``
					);
					completions.push(completion);
				});
			}
		}

		// Handle import completions
		if (linePrefix.match(/^\s*(import\s+|from\s+)\w*$/)) {
			// Built-in CircuitPython modules
			this.CIRCUITPYTHON_MODULES.forEach(module => {
				const completion = new vscode.CompletionItem(module, vscode.CompletionItemKind.Module);
				completion.detail = 'CircuitPython built-in module';
				completion.documentation = new vscode.MarkdownString(
					`**${module}** - CircuitPython built-in module`
				);
				completion.insertText = module;
				completions.push(completion);
			});

			// CircuitPython Bundle libraries
			this.CIRCUITPYTHON_BUNDLE_LIBRARIES.forEach(library => {
				const completion = new vscode.CompletionItem(library, vscode.CompletionItemKind.Module);
				completion.detail = 'CircuitPython Bundle library';

				// Add category-based descriptions
				let description = 'CircuitPython Bundle library';
				if (library.includes('bme280') || library.includes('bmp280') || library.includes('sht31')) {
					description = 'Environmental sensor library (temperature, humidity, pressure)';
				} else if (library.includes('ssd1306') || library.includes('st7789') || library.includes('ili9341')) {
					description = 'Display driver library';
				} else if (library.includes('motor') || library.includes('servo') || library.includes('pca9685')) {
					description = 'Motor/servo control library';
				} else if (library.includes('neopixel') || library.includes('dotstar') || library.includes('led')) {
					description = 'LED control and animation library';
				} else if (library.includes('esp32spi') || library.includes('requests') || library.includes('mqtt')) {
					description = 'Networking and connectivity library';
				}

				completion.documentation = new vscode.MarkdownString(
					`**${library}** - ${description}`
				);
				completion.insertText = library;
				completions.push(completion);
			});

			// CircuitPython subset modules (limited versions of standard library)
			this.CIRCUITPYTHON_SUBSET_MODULES.forEach(module => {
				const completion = new vscode.CompletionItem(module, vscode.CompletionItemKind.Module);
				completion.detail = 'CircuitPython subset module';

				const warnings: Record<string, string> = {
					'asyncio': 'Limited async support - not all CPython features available',
					'json': 'Basic JSON support - limited compared to CPython',
					'socket': 'Limited socket support - mainly for networking libraries',
					'ssl': 'Basic SSL/TLS support - limited cipher suites',
					're': 'Basic regex - subset of CPython regex features',
					'collections': 'Limited collections - namedtuple, OrderedDict only'
				};

				completion.documentation = new vscode.MarkdownString(
					`**${module}** - CircuitPython subset module\n\n⚠️ ${warnings[module] || 'Limited implementation compared to CPython'}`
				);
				completion.insertText = module;
				completions.push(completion);
			});
		}

		// Common CircuitPython patterns
		if (linePrefix.trim().length === 0 || linePrefix.endsWith('\n')) {
			const patterns = [
				// Basic patterns
				{
					label: 'Digital Pin Setup',
					insertText: 'import board\nimport digitalio\n\npin = digitalio.DigitalInOut(board.${1:D13})\npin.direction = digitalio.Direction.${2:OUTPUT}',
					detail: 'CircuitPython digital pin template'
				},
				{
					label: 'Analog Read Setup',
					insertText: 'import board\nimport analogio\n\nanalog_pin = analogio.AnalogIn(board.${1:A0})\nvalue = analog_pin.value',
					detail: 'CircuitPython analog input template'
				},
				{
					label: 'PWM Setup',
					insertText: 'import board\nimport pwmio\n\npwm = pwmio.PWMOut(board.${1:D13})\npwm.duty_cycle = ${2:32768}  # 50%',
					detail: 'CircuitPython PWM output template'
				},
				// Bundle library patterns
				{
					label: 'NeoPixel Setup',
					insertText: 'import board\nimport neopixel\n\npixels = neopixel.NeoPixel(board.${1:NEOPIXEL}, ${2:10})\npixels[0] = (${3:255}, ${4:0}, ${5:0})  # Red\npixels.show()',
					detail: 'NeoPixel LED control template'
				},
				{
					label: 'SSD1306 OLED Display',
					insertText: 'import board\nimport busio\nimport adafruit_ssd1306\n\ni2c = busio.I2C(board.SCL, board.SDA)\ndisplay = adafruit_ssd1306.SSD1306_I2C(${1:128}, ${2:64}, i2c)\n\ndisplay.text("${3:Hello World}", 0, 0, 1)\ndisplay.show()',
					detail: 'OLED display setup template'
				},
				{
					label: 'BME280 Environmental Sensor',
					insertText: 'import board\nimport busio\nimport adafruit_bme280\n\ni2c = busio.I2C(board.SCL, board.SDA)\nbme280 = adafruit_bme280.Adafruit_BME280_I2C(i2c)\n\nprint(f"Temperature: {bme280.temperature:.1f}°C")\nprint(f"Humidity: {bme280.relative_humidity:.1f}%")\nprint(f"Pressure: {bme280.pressure:.1f} hPa")',
					detail: 'Environmental sensor template'
				},
				{
					label: 'Servo Motor Control',
					insertText: 'import board\nimport pwmio\nfrom adafruit_motor import servo\n\npwm = pwmio.PWMOut(board.${1:A2}, frequency=50)\nservo_motor = servo.Servo(pwm)\n\nservo_motor.angle = ${2:90}  # Set angle (0-180)',
					detail: 'Servo motor control template'
				},
				{
					label: 'WiFi Connection (ESP32)',
					insertText: 'import board\nimport busio\nfrom adafruit_esp32spi import adafruit_esp32spi\nimport adafruit_esp32spi.adafruit_esp32spi_requests as requests\n\nspi = busio.SPI(board.SCK, board.MOSI, board.MISO)\nesp = adafruit_esp32spi.ESP_SPIcontrol(spi, board.${1:D13}, board.${2:D11}, board.${3:D12})\n\nrequests.set_socket(esp, esp)\nesp.connect_AP("${4:SSID}", "${5:PASSWORD}")',
					detail: 'WiFi connection template'
				}
			];

			patterns.forEach(pattern => {
				const completion = new vscode.CompletionItem(pattern.label, vscode.CompletionItemKind.Snippet);
				completion.insertText = new vscode.SnippetString(pattern.insertText);
				completion.detail = pattern.detail;
				completion.documentation = new vscode.MarkdownString('CircuitPython code template');
				completions.push(completion);
			});
		}

		return completions;
	}

	/**
	 * Provide CircuitPython-specific hover information
	 */
	private async provideCircuitPythonHover(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken
	): Promise<vscode.Hover | undefined> {
		const range = document.getWordRangeAtPosition(position);
		if (!range) return undefined;

		const word = document.getText(range);
		const line = document.lineAt(position.line).text;

		// Check for module.attribute pattern
		const beforeWord = line.substring(0, range.start.character);
		const moduleMatch = beforeWord.match(/(\w+)\.$/);

		if (moduleMatch) {
			const moduleName = moduleMatch[1];
			const features = this.CIRCUITPYTHON_FEATURES[moduleName as keyof typeof this.CIRCUITPYTHON_FEATURES];

			if (features?.includes(word)) {
				const documentation = this.getCircuitPythonDocumentation(moduleName, word);
				if (documentation) {
					return new vscode.Hover(new vscode.MarkdownString(documentation), range);
				}
			}
		}

		// Check for CircuitPython modules
		if (this.CIRCUITPYTHON_MODULES.has(word)) {
			const documentation = this.getModuleDocumentation(word);
			return new vscode.Hover(new vscode.MarkdownString(documentation), range);
		}

		// Check for CircuitPython Bundle libraries
		if (this.CIRCUITPYTHON_BUNDLE_LIBRARIES.has(word)) {
			const documentation = this.getBundleLibraryDocumentation(word);
			return new vscode.Hover(new vscode.MarkdownString(documentation), range);
		}

		// Check for CircuitPython subset modules
		if (this.CIRCUITPYTHON_SUBSET_MODULES.has(word)) {
			const documentation = this.getSubsetModuleDocumentation(word);
			return new vscode.Hover(new vscode.MarkdownString(documentation), range);
		}

		// Check for unsupported Python modules
		if (this.UNSUPPORTED_MODULES.has(word)) {
			const warning = `⚠️ **${word}** is not available in CircuitPython\n\nThis Python module is not supported in CircuitPython. Consider using CircuitPython alternatives.`;
			return new vscode.Hover(new vscode.MarkdownString(warning), range);
		}

		return undefined;
	}

	/**
	 * Provide code actions for CircuitPython
	 */
	private async provideCircuitPythonCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): Promise<vscode.CodeAction[]> {
		const actions: vscode.CodeAction[] = [];

		// Check for unsupported module imports
		const diagnostics = context.diagnostics.filter(
			diag => diag.source === 'circuitpython' && diag.code === 'unsupported-module'
		);

		for (const diagnostic of diagnostics) {
			const action = new vscode.CodeAction(
				'Remove unsupported import',
				vscode.CodeActionKind.QuickFix
			);
			action.diagnostics = [diagnostic];
			action.edit = new vscode.WorkspaceEdit();
			action.edit.delete(document.uri, diagnostic.range);
			actions.push(action);
		}

		return actions;
	}

	/**
	 * Validate CircuitPython code and provide diagnostics
	 */
	private validateCircuitPythonCode(document: vscode.TextDocument): void {
		const diagnostics: vscode.Diagnostic[] = [];
		const text = document.getText();
		const lines = text.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Check for unsupported module imports
			const importMatch = line.match(/^\s*(?:import\s+|from\s+)(\w+)/);
			if (importMatch) {
				const moduleName = importMatch[1];
				if (this.UNSUPPORTED_MODULES.has(moduleName)) {
					const startPos = line.indexOf(moduleName);
					const range = new vscode.Range(i, startPos, i, startPos + moduleName.length);

					const diagnostic = new vscode.Diagnostic(
						range,
						`Module '${moduleName}' is not available in CircuitPython`,
						vscode.DiagnosticSeverity.Warning
					);
					diagnostic.source = 'circuitpython';
					diagnostic.code = 'unsupported-module';
					diagnostics.push(diagnostic);
				}
			}

			// Check for common Python patterns not available in CircuitPython
			const unsupportedPatterns = [
				{ pattern: /threading\./, message: 'Threading is not supported in CircuitPython' },
				{ pattern: /multiprocessing\./, message: 'Multiprocessing is not supported in CircuitPython' },
				{ pattern: /subprocess\./, message: 'Subprocess is not supported in CircuitPython' },
				{ pattern: /socket\./, message: 'Socket programming is limited in CircuitPython' },
				{ pattern: /open\s*\([^)]*[\'"]w[\'"]/, message: 'File writing may be restricted in CircuitPython' }
			];

			for (const { pattern, message } of unsupportedPatterns) {
				const match = line.match(pattern);
				if (match) {
					const startPos = line.indexOf(match[0]);
					const range = new vscode.Range(i, startPos, i, startPos + match[0].length);

					const diagnostic = new vscode.Diagnostic(
						range,
						message,
						vscode.DiagnosticSeverity.Warning
					);
					diagnostic.source = 'circuitpython';
					diagnostic.code = 'unsupported-feature';
					diagnostics.push(diagnostic);
				}
			}
		}

		this.diagnosticCollection.set(document.uri, diagnostics);
	}

	/**
	 * Get CircuitPython-specific documentation
	 */
	private getCircuitPythonDocumentation(module: string, feature: string): string | undefined {
		const docs: Record<string, Record<string, string>> = {
			board: {
				LED: '**board.LED** - Built-in LED pin\n\nThe built-in LED on the board, typically connected to pin D13.',
				A0: '**board.A0** - Analog pin A0\n\nAnalog input pin A0, can be used with `analogio.AnalogIn`.',
				D13: '**board.D13** - Digital pin D13\n\nDigital I/O pin D13, often connected to the built-in LED.',
				SDA: '**board.SDA** - I2C Data line\n\nI2C Serial Data line for I2C communication.',
				SCL: '**board.SCL** - I2C Clock line\n\nI2C Serial Clock line for I2C communication.'
			},
			digitalio: {
				DigitalInOut: '**digitalio.DigitalInOut** - Digital I/O control\n\nProvides digital input/output functionality for pins.',
				Direction: '**digitalio.Direction** - Pin direction\n\nSpecifies pin direction: `INPUT` or `OUTPUT`.',
				Pull: '**digitalio.Pull** - Internal pull resistor\n\nInternal pull resistor: `UP`, `DOWN`, or `None`.'
			},
			time: {
				sleep: '**time.sleep(seconds)** - Sleep/delay\n\nPause execution for the specified number of seconds.',
				monotonic: '**time.monotonic()** - Monotonic time\n\nReturns a monotonically increasing time value in seconds.'
			}
		};

		return docs[module]?.[feature];
	}

	/**
	 * Get module documentation
	 */
	private getModuleDocumentation(module: string): string {
		const docs: Record<string, string> = {
			board: '**board** - Board-specific pin definitions\n\nProvides access to microcontroller pins by their board labels.',
			digitalio: '**digitalio** - Digital I/O control\n\nClasses for digital input and output pin control.',
			analogio: '**analogio** - Analog I/O control\n\nClasses for analog input and output operations.',
			pwmio: '**pwmio** - PWM (Pulse Width Modulation)\n\nProvides PWM output functionality.',
			busio: '**busio** - Bus protocol support\n\nSupport for I2C, SPI, and UART communication protocols.',
			time: '**time** - Time-related functions\n\nTime and delay functions for CircuitPython.',
			microcontroller: '**microcontroller** - Microcontroller specifics\n\nAccess to microcontroller-specific features and pins.'
		};

		return docs[module] || `**${module}** - CircuitPython module`;
	}

	/**
	 * Get CircuitPython Bundle library documentation
	 */
	private getBundleLibraryDocumentation(library: string): string {
		const docs: Record<string, string> = {
			// Sensors
			'adafruit_bme280': '**adafruit_bme280** - BME280 Environmental Sensor\n\nRead temperature, humidity, and barometric pressure from BME280 sensors over I2C or SPI.',
			'adafruit_bmp280': '**adafruit_bmp280** - BMP280 Pressure Sensor\n\nRead temperature and barometric pressure from BMP280 sensors.',
			'adafruit_bno055': '**adafruit_bno055** - BNO055 9-DOF Sensor\n\nAccess accelerometer, gyroscope, magnetometer, and orientation data from BNO055 sensors.',
			'adafruit_mpu6050': '**adafruit_mpu6050** - MPU6050 6-DOF Sensor\n\nRead accelerometer and gyroscope data from MPU6050 sensors.',
			'adafruit_lis3dh': '**adafruit_lis3dh** - LIS3DH Accelerometer\n\n3-axis accelerometer with tap detection and activity monitoring.',

			// Displays
			'adafruit_ssd1306': '**adafruit_ssd1306** - SSD1306 OLED Display\n\nDriver for monochrome OLED displays using the SSD1306 controller.',
			'adafruit_st7789': '**adafruit_st7789** - ST7789 Color TFT Display\n\nDriver for color TFT LCD displays using the ST7789 controller.',
			'adafruit_ili9341': '**adafruit_ili9341** - ILI9341 Color TFT Display\n\nDriver for 2.4" and 2.8" color TFT displays with touchscreen.',
			'adafruit_ht16k33': '**adafruit_ht16k33** - HT16K33 LED Matrix\n\nDriver for LED matrices and 7-segment displays.',

			// Motors & Servos
			'adafruit_motor': '**adafruit_motor** - Motor Control\n\nControl DC motors, stepper motors, and servo motors.',
			'adafruit_servokit': '**adafruit_servokit** - ServoKit\n\nControl up to 16 servos with the PCA9685-based ServoKit.',
			'adafruit_pca9685': '**adafruit_pca9685** - PCA9685 PWM Driver\n\n16-channel PWM driver for controlling servos and LEDs.',

			// LEDs
			'adafruit_neopixel': '**adafruit_neopixel** - NeoPixel LEDs\n\nControl WS2812/NeoPixel addressable RGB LEDs.',
			'adafruit_dotstar': '**adafruit_dotstar** - DotStar LEDs\n\nControl APA102/DotStar addressable RGB LEDs.',
			'adafruit_fancyled': '**adafruit_fancyled** - FancyLED\n\nAdvanced LED color manipulation and effects.',
			'adafruit_led_animation': '**adafruit_led_animation** - LED Animations\n\nPre-built animations for NeoPixel and DotStar LEDs.',

			// Communication
			'adafruit_esp32spi': '**adafruit_esp32spi** - ESP32 WiFi\n\nUse ESP32 as a WiFi co-processor for internet connectivity.',
			'adafruit_requests': '**adafruit_requests** - HTTP Requests\n\nMake HTTP requests similar to Python\'s requests library.',
			'adafruit_minimqtt': '**adafruit_minimqtt** - MQTT Client\n\nLightweight MQTT client for IoT messaging.',
			'adafruit_ble': '**adafruit_ble** - Bluetooth Low Energy\n\nBluetooth Low Energy (BLE) communication library.',

			// Real-Time Clock
			'adafruit_ds3231': '**adafruit_ds3231** - DS3231 RTC\n\nPrecision real-time clock with temperature sensor.',
			'adafruit_ds1307': '**adafruit_ds1307** - DS1307 RTC\n\nBasic real-time clock module.',

			// Power Management
			'adafruit_ina219': '**adafruit_ina219** - INA219 Power Monitor\n\nMonitor current, voltage, and power consumption.',
			'adafruit_max1704x': '**adafruit_max1704x** - Battery Monitor\n\nLiPo battery fuel gauge and monitor.',

			// Input Devices
			'adafruit_mpr121': '**adafruit_mpr121** - MPR121 Capacitive Touch\n\n12-channel capacitive touch sensor.',
			'adafruit_rotary_encoder': '**adafruit_rotary_encoder** - Rotary Encoder\n\nRead rotary encoder position and button state.',
			'adafruit_debouncer': '**adafruit_debouncer** - Button Debouncer\n\nDebounce digital inputs like buttons and switches.',

			// Core Libraries
			'adafruit_bus_device': '**adafruit_bus_device** - Bus Device\n\nCore library for I2C and SPI device communication.',
			'adafruit_register': '**adafruit_register** - Register\n\nCore library for device register manipulation.'
		};

		// Provide generic documentation if specific docs not available
		if (docs[library]) {
			return docs[library];
		}

		// Generate category-based documentation
		let category = 'CircuitPython Bundle library';
		if (library.includes('bme') || library.includes('bmp') || library.includes('sht') || library.includes('si70')) {
			category = 'Environmental sensor library';
		} else if (library.includes('ssd') || library.includes('st77') || library.includes('ili') || library.includes('epd')) {
			category = 'Display driver library';
		} else if (library.includes('motor') || library.includes('servo') || library.includes('pca9685')) {
			category = 'Motor/servo control library';
		} else if (library.includes('neopixel') || library.includes('dotstar') || library.includes('led')) {
			category = 'LED control library';
		} else if (library.includes('esp32') || library.includes('requests') || library.includes('mqtt') || library.includes('ble')) {
			category = 'Communication/networking library';
		}

		return `**${library}** - ${category}\n\nPart of the Adafruit CircuitPython Bundle. Install via the bundle or pip.`;
	}

	/**
	 * Get CircuitPython subset module documentation
	 */
	private getSubsetModuleDocumentation(module: string): string {
		const docs: Record<string, string> = {
			'asyncio': '**asyncio** - CircuitPython Async Support\n\n⚠️ **Limited Implementation**\n\nCircuitPython provides basic async/await support but with significant limitations:\n\n- No `asyncio.run()` - use `asyncio.create_task()`\n- Limited task management\n- No event loop control\n- Fewer coroutine utilities\n\n**Available**: `create_task()`, `sleep()`, basic `async`/`await`\n**Not Available**: `run()`, `gather()`, `wait()`, complex event loops',

			'json': '**json** - CircuitPython JSON Support\n\n⚠️ **Basic Implementation**\n\nCircuitPython provides basic JSON encoding/decoding:\n\n**Available**: `loads()`, `dumps()`\n**Limited**: Error handling, custom encoders\n**Not Available**: `load()`, `dump()`, JSONEncoder classes\n\nExample:\n```python\nimport json\ndata = {"sensor": "bme280", "temp": 25.5}\njson_str = json.dumps(data)\nparsed = json.loads(json_str)\n```',

			'socket': '**socket** - CircuitPython Socket Support\n\n⚠️ **Limited Implementation**\n\nBasic socket support primarily for networking libraries:\n\n**Available**: Basic TCP sockets via networking libraries\n**Limited**: Direct socket programming\n**Recommended**: Use `adafruit_requests` or `adafruit_esp32spi` instead\n\nMost users should use higher-level networking libraries rather than direct socket programming.',

			're': '**re** - CircuitPython Regex Support\n\n⚠️ **Subset Implementation**\n\nBasic regular expression support:\n\n**Available**: `match()`, `search()`, `sub()`, basic patterns\n**Limited**: Complex regex features, flags, groups\n**Not Available**: Compiled patterns, advanced features\n\nExample:\n```python\nimport re\nif re.match(r"temp_\\d+", "temp_25"):\n    print("Temperature sensor found")\n```',

			'ssl': '**ssl** - CircuitPython SSL/TLS Support\n\n⚠️ **Basic Implementation**\n\nBasic SSL/TLS support for secure connections:\n\n**Available**: Basic SSL context, HTTPS connections\n**Limited**: Cipher suites, certificate validation\n**Usage**: Primarily through networking libraries\n\nMost users access SSL through `adafruit_requests` with HTTPS URLs.',

			'collections': '**collections** - CircuitPython Collections\n\n⚠️ **Limited Implementation**\n\nSubset of Python collections:\n\n**Available**: `namedtuple()`, `OrderedDict`\n**Not Available**: `deque`, `Counter`, `defaultdict`, `ChainMap`\n\nExample:\n```python\nfrom collections import namedtuple, OrderedDict\nPoint = namedtuple("Point", ["x", "y"])\np = Point(1, 2)\n```',

			'binascii': '**binascii** - Binary/ASCII Conversions\n\nConvert between binary and ASCII representations:\n\n**Available**: `hexlify()`, `unhexlify()`, `b2a_base64()`, `a2b_base64()`\n\nUseful for encoding sensor data or network communications.',

			'hashlib': '**hashlib** - CircuitPython Hashing\n\n⚠️ **Limited Algorithms**\n\nBasic cryptographic hashing:\n\n**Available**: SHA256, MD5 (limited algorithms)\n**Not Available**: Full range of CPython hash algorithms\n\nExample:\n```python\nimport hashlib\nhash_obj = hashlib.sha256()\nhash_obj.update(b"sensor_data")\ndigest = hash_obj.hexdigest()\n```'
		};

		return docs[module] || `**${module}** - CircuitPython subset module\n\n⚠️ Limited implementation compared to CPython. Check CircuitPython documentation for available features.`;
	}

	/**
	 * Dispose all resources
	 */
	public dispose(): void {
		this.disposables.forEach(disposable => disposable.dispose());
		this.diagnosticCollection.dispose();
	}
}