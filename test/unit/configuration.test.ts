import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Configuration Tests', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('Default configuration values should be correct', () => {
		const config = vscode.workspace.getConfiguration('muTwo');

		assert.strictEqual(
			config.get('history.defaultLoadLimit'),
			50,
			'Default history load limit should be 50'
		);

		assert.strictEqual(
			config.get('serial.globalPermission'),
			false,
			'Serial global permission should default to false'
		);

		assert.strictEqual(
			config.get('autoDownloadGuides'),
			true,
			'Auto download guides should default to true'
		);

		assert.strictEqual(
			config.get('serialMonitor.enableCooperation'),
			true,
			'Serial monitor cooperation should default to true'
		);

		assert.strictEqual(
			config.get('serialMonitor.autoSwitchOnConflict'),
			false,
			'Auto switch on conflict should default to false'
		);

		assert.strictEqual(
			config.get('blinka.defaultExecutionMode'),
			'auto-select',
			'Default execution mode should be auto-select'
		);

		assert.strictEqual(
			config.get('blinka.enableProfiling'),
			true,
			'Blinka profiling should default to true'
		);

		assert.strictEqual(
			config.get('blinka.executionTimeout'),
			30000,
			'Execution timeout should default to 30000ms'
		);

		assert.strictEqual(
			config.get('blinka.autoShowComparison'),
			true,
			'Auto show comparison should default to true'
		);
	});

	test('Configuration should be updateable', async () => {
		const config = vscode.workspace.getConfiguration('muTwo');

		await config.update('history.defaultLoadLimit', 100, vscode.ConfigurationTarget.Global);
		assert.strictEqual(config.get('history.defaultLoadLimit'), 100);

		await config.update('serial.globalPermission', true, vscode.ConfigurationTarget.Global);
		assert.strictEqual(config.get('serial.globalPermission'), true);

		// Reset to defaults
		await config.update('history.defaultLoadLimit', undefined, vscode.ConfigurationTarget.Global);
		await config.update('serial.globalPermission', undefined, vscode.ConfigurationTarget.Global);
	});

	test('Debug configuration should have correct properties', () => {
		const config = vscode.workspace.getConfiguration('muTwo.debug');

		assert.strictEqual(
			config.get('enableTransactionLogging'),
			true,
			'Transaction logging should be enabled by default'
		);

		assert.strictEqual(
			config.get('enableInteractiveDebugging'),
			true,
			'Interactive debugging should be enabled by default'
		);

		assert.strictEqual(
			config.get('enableStateMonitoring'),
			true,
			'State monitoring should be enabled by default'
		);

		const monitoredInterfaces = config.get('monitoredInterfaces') as string[];
		assert.ok(Array.isArray(monitoredInterfaces), 'Monitored interfaces should be an array');
		assert.ok(monitoredInterfaces.includes('i2c'), 'Should monitor I2C by default');
		assert.ok(monitoredInterfaces.includes('spi'), 'Should monitor SPI by default');
		assert.ok(monitoredInterfaces.includes('gpio'), 'Should monitor GPIO by default');
	});

	test('PyScript configuration should have correct properties', () => {
		const config = vscode.workspace.getConfiguration('muTwo.pyscript');

		assert.strictEqual(
			config.get('executionMode'),
			'auto',
			'PyScript execution mode should default to auto'
		);

		assert.strictEqual(
			config.get('autoLoadWorkspace'),
			true,
			'Auto load workspace should be enabled by default'
		);

		assert.strictEqual(
			config.get('watchFileChanges'),
			true,
			'Watch file changes should be enabled by default'
		);
	});

	test('Visualization configuration should have correct properties', () => {
		const config = vscode.workspace.getConfiguration('muTwo.debug.visualization');

		assert.strictEqual(
			config.get('showTimeline'),
			true,
			'Timeline should be shown by default'
		);

		assert.strictEqual(
			config.get('showHardwareState'),
			true,
			'Hardware state should be shown by default'
		);

		assert.strictEqual(
			config.get('showMemoryChart'),
			true,
			'Memory chart should be shown by default'
		);

		assert.strictEqual(
			config.get('refreshInterval'),
			2000,
			'Refresh interval should be 2000ms by default'
		);

		assert.strictEqual(
			config.get('maxTransactions'),
			1000,
			'Max transactions should be 1000 by default'
		);
	});
});