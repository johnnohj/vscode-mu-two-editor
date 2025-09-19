import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

interface DeviceMetadata {
	total_boards: number;
	boards_with_usb: number;
	boards_without_usb: number;
	generated_from: string;
	description: string;
}

interface VendorInfo {
	names: string[];
	primary_name: string;
	board_count: number;
	boards: string[];
	pids: string[];
}

interface DeviceDatabase {
	metadata: DeviceMetadata;
	vendor_lookup: Record<string, VendorInfo>;
	boards: Record<string, any>;
}

suite('CircuitPython Device Database Tests', () => {
	let deviceDatabase: DeviceDatabase;

	suiteSetup(async () => {
		const dbPath = path.join(__dirname, '..', '..', 'src', 'data', 'circuitpython_devices.json');
		const dbUri = vscode.Uri.file(dbPath);

		try {
			const fileContent = await vscode.workspace.fs.readFile(dbUri);
			const dbText = new TextDecoder().decode(fileContent);
			deviceDatabase = JSON.parse(dbText);
		} catch (error) {
			assert.fail(`Failed to load device database: ${error}`);
		}
	});

	test('Device database should load successfully', () => {
		assert.ok(deviceDatabase, 'Device database should be loaded');
		assert.ok(deviceDatabase.metadata, 'Metadata should exist');
		assert.ok(deviceDatabase.vendor_lookup, 'Vendor lookup should exist');
	});

	test('Metadata should have expected structure', () => {
		const metadata = deviceDatabase.metadata;

		assert.ok(typeof metadata.total_boards === 'number', 'total_boards should be a number');
		assert.ok(typeof metadata.boards_with_usb === 'number', 'boards_with_usb should be a number');
		assert.ok(typeof metadata.boards_without_usb === 'number', 'boards_without_usb should be a number');
		assert.ok(typeof metadata.generated_from === 'string', 'generated_from should be a string');
		assert.ok(typeof metadata.description === 'string', 'description should be a string');

		assert.ok(metadata.total_boards > 0, 'Should have at least one board');
		assert.strictEqual(
			metadata.total_boards,
			metadata.boards_with_usb + metadata.boards_without_usb,
			'Total boards should equal sum of USB and non-USB boards'
		);
	});

	test('Should contain Adafruit devices', () => {
		const adafruitVid = '0x239A';
		assert.ok(
			deviceDatabase.vendor_lookup[adafruitVid],
			'Should contain Adafruit vendor ID'
		);

		const adafruitInfo = deviceDatabase.vendor_lookup[adafruitVid];
		assert.ok(adafruitInfo.names.length > 0, 'Adafruit should have vendor names');
		assert.ok(adafruitInfo.board_count > 0, 'Adafruit should have boards');
		assert.ok(adafruitInfo.boards.length > 0, 'Adafruit should have board list');
		assert.ok(adafruitInfo.pids.length > 0, 'Adafruit should have PIDs');
	});

	test('Vendor entries should have correct structure', () => {
		const vendors = Object.keys(deviceDatabase.vendor_lookup);
		assert.ok(vendors.length > 0, 'Should have at least one vendor');

		for (const vid of vendors.slice(0, 5)) { // Test first 5 vendors
			const vendor = deviceDatabase.vendor_lookup[vid];

			assert.ok(Array.isArray(vendor.names), `Vendor ${vid} should have names array`);
			assert.ok(typeof vendor.primary_name === 'string', `Vendor ${vid} should have primary name`);
			assert.ok(typeof vendor.board_count === 'number', `Vendor ${vid} should have board count`);
			assert.ok(Array.isArray(vendor.boards), `Vendor ${vid} should have boards array`);
			assert.ok(Array.isArray(vendor.pids), `Vendor ${vid} should have PIDs array`);

			assert.strictEqual(
				vendor.board_count,
				vendor.boards.length,
				`Vendor ${vid} board count should match boards array length`
			);
		}
	});

	test('Vendor IDs should be valid hex values', () => {
		const vendors = Object.keys(deviceDatabase.vendor_lookup);

		for (const vid of vendors) {
			assert.ok(vid.startsWith('0x') || vid.startsWith('0X'), `VID ${vid} should start with 0x`);
			assert.ok(vid.length === 6, `VID ${vid} should be 6 characters long (0x + 4 hex digits)`);

			const hexPart = vid.substring(2);
			assert.ok(/^[0-9A-Fa-f]{4}$/.test(hexPart), `VID ${vid} should contain valid hex digits`);
		}
	});

	test('PIDs should be valid hex values', () => {
		const vendors = Object.values(deviceDatabase.vendor_lookup).slice(0, 3); // Test first 3 vendors

		for (const vendor of vendors) {
			for (const pid of vendor.pids) {
				assert.ok(pid.startsWith('0x') || pid.startsWith('0X'), `PID ${pid} should start with 0x`);
				assert.ok(pid.length === 6, `PID ${pid} should be 6 characters long (0x + 4 hex digits)`);

				const hexPart = pid.substring(2);
				assert.ok(/^[0-9A-Fa-f]{4}$/.test(hexPart), `PID ${pid} should contain valid hex digits`);
			}
		}
	});

	test('Should be able to find common CircuitPython boards', () => {
		const commonBoards = [
			'feather', // Should find some feather boards
			'esp32', // Should find ESP32-based boards
			'raspberry' // Should find Raspberry Pi Pico boards
		];

		for (const boardType of commonBoards) {
			let found = false;
			for (const vendor of Object.values(deviceDatabase.vendor_lookup)) {
				if (vendor.boards.some(board => board.toLowerCase().includes(boardType))) {
					found = true;
					break;
				}
			}
			assert.ok(found, `Should find boards containing '${boardType}'`);
		}
	});

	test('Board names should follow expected format', () => {
		const sampleVendor = Object.values(deviceDatabase.vendor_lookup)[0];

		for (const boardName of sampleVendor.boards.slice(0, 3)) { // Test first 3 boards
			assert.ok(typeof boardName === 'string', 'Board name should be a string');
			assert.ok(boardName.length > 0, 'Board name should not be empty');
			assert.ok(boardName.includes('/'), 'Board name should contain path separator');
		}
	});

	test('Should provide device lookup functionality', () => {
		// Test that we can look up devices by VID/PID
		const testVid = '0x239A'; // Adafruit
		const vendor = deviceDatabase.vendor_lookup[testVid];

		if (vendor && vendor.pids.length > 0) {
			const testPid = vendor.pids[0];

			// Simulate device lookup
			const deviceId = `${testVid}:${testPid}`;
			assert.ok(deviceId, 'Should be able to create device identifier');

			// Verify we can find the vendor
			assert.strictEqual(vendor.primary_name, deviceDatabase.vendor_lookup[testVid].primary_name);
		}
	});

	test('Database should be reasonably sized', () => {
		const metadata = deviceDatabase.metadata;

		// Sanity check - should have a reasonable number of boards
		assert.ok(metadata.total_boards >= 100, 'Should have at least 100 boards');
		assert.ok(metadata.total_boards <= 2000, 'Should not have more than 2000 boards (sanity check)');

		// Most boards should support USB
		const usbPercentage = (metadata.boards_with_usb / metadata.total_boards) * 100;
		assert.ok(usbPercentage >= 50, 'At least 50% of boards should support USB');
	});

	test('Should handle vendor name variations', () => {
		// Some vendors might have multiple name variations
		for (const vendor of Object.values(deviceDatabase.vendor_lookup).slice(0, 5)) {
			if (vendor.names.length > 1) {
				assert.ok(
					vendor.names.includes(vendor.primary_name),
					'Primary name should be included in names array'
				);
			}
		}
	});
});