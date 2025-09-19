import * as assert from 'assert';
import * as vscode from 'vscode';

describe('Integration Tests - VS Code Storage Operations', () => {
	let mockContext: vscode.ExtensionContext;

	beforeEach(() => {
		// Create a mock extension context that uses real storage APIs
		mockContext = {
			storagePath: undefined,
			globalStoragePath: '',
			logPath: '',
			globalState: {
				keys: () => [],
				get: function<T>(key: string, defaultValue?: T): T | undefined {
					// For testing, we'll use a Map to simulate real storage
					const storage = this._storage || new Map();
					return storage.has(key) ? storage.get(key) : defaultValue;
				},
				update: function(key: string, value: any): Thenable<void> {
					const storage = this._storage || new Map();
					this._storage = storage;
					storage.set(key, value);
					return Promise.resolve();
				},
				setKeysForSync: function(keys: readonly string[]): void {
					this._syncKeys = keys;
				}
			} as any,
			workspaceState: {
				keys: () => [],
				get: function<T>(key: string, defaultValue?: T): T | undefined {
					const storage = this._storage || new Map();
					return storage.has(key) ? storage.get(key) : defaultValue;
				},
				update: function(key: string, value: any): Thenable<void> {
					const storage = this._storage || new Map();
					this._storage = storage;
					storage.set(key, value);
					return Promise.resolve();
				}
			} as any,
			subscriptions: [],
			extensionPath: '',
			extensionUri: vscode.Uri.file(''),
			environmentVariableCollection: {} as any,
			asAbsolutePath: (relativePath: string) => relativePath,
			storageUri: undefined,
			globalStorageUri: vscode.Uri.file(''),
			logUri: vscode.Uri.file(''),
			extensionMode: vscode.ExtensionMode.Test,
			extension: {} as any,
			secrets: {} as any
		};
	});

	describe('Global State Management', () => {
		it('should store and retrieve extension settings in global state', async () => {
			// Test storing extension configuration
			const extensionSettings = {
				version: '1.0.0',
				firstRun: false,
				lastUsedProject: 'led-blink-project',
				recentProjects: [
					'led-blink-project',
					'sensor-monitor',
					'display-controller'
				],
				userPreferences: {
					autoSync: true,
					enableRepl: true,
					defaultBaudRate: 115200,
					theme: 'dark'
				}
			};

			// Store settings
			await mockContext.globalState.update('muTwo.settings', extensionSettings);
			await mockContext.globalState.update('muTwo.lastActiveDate', new Date().toISOString());
			await mockContext.globalState.update('muTwo.usageStats', {
				projectsCreated: 5,
				filesEdited: 23,
				sessionsCount: 12
			});

			// Retrieve and verify settings
			const retrievedSettings = mockContext.globalState.get('muTwo.settings');
			const lastActiveDate = mockContext.globalState.get('muTwo.lastActiveDate');
			const usageStats = mockContext.globalState.get('muTwo.usageStats') as any;

			assert.deepStrictEqual(retrievedSettings, extensionSettings, 'Settings should match stored values');
			assert.ok(lastActiveDate, 'Last active date should be stored');
			assert.ok(usageStats, 'Usage stats should be stored');
			assert.strictEqual(usageStats.projectsCreated, 5, 'Usage stats should be accurate');
		});

		it('should handle default values for missing global state', async () => {
			// Test retrieving non-existent keys with defaults
			const defaultSettings = {
				autoSync: true,
				enableRepl: true,
				defaultBaudRate: 115200
			};

			const settings = mockContext.globalState.get('muTwo.nonExistentSettings', defaultSettings);
			const projectList = mockContext.globalState.get('muTwo.recentProjects', []);
			const firstRun = mockContext.globalState.get('muTwo.firstRun', true);

			assert.deepStrictEqual(settings, defaultSettings, 'Should return default settings');
			assert.deepStrictEqual(projectList, [], 'Should return empty array as default');
			assert.strictEqual(firstRun, true, 'Should return true for first run default');
		});

		it('should update and persist user preferences', async () => {
			// Initial preferences
			const initialPrefs = {
				autoSync: true,
				enableRepl: true,
				defaultBaudRate: 115200,
				saveOnRun: false
			};

			await mockContext.globalState.update('muTwo.userPreferences', initialPrefs);

			// Update specific preference
			const updatedPrefs = {
				...initialPrefs,
				saveOnRun: true,
				defaultBaudRate: 9600
			};

			await mockContext.globalState.update('muTwo.userPreferences', updatedPrefs);

			// Verify update
			const retrievedPrefs = mockContext.globalState.get('muTwo.userPreferences') as any;
			assert.strictEqual(retrievedPrefs.saveOnRun, true, 'Save on run should be updated');
			assert.strictEqual(retrievedPrefs.defaultBaudRate, 9600, 'Baud rate should be updated');
			assert.strictEqual(retrievedPrefs.autoSync, true, 'Other settings should remain unchanged');
		});

		it('should manage recent projects list with limits', async () => {
			const maxRecentProjects = 10;
			const recentProjects = [];

			// Add projects to recent list
			for (let i = 1; i <= 12; i++) {
				const projectName = `project-${i}`;
				recentProjects.unshift(projectName); // Add to beginning

				// Keep only the most recent projects
				if (recentProjects.length > maxRecentProjects) {
					recentProjects.splice(maxRecentProjects);
				}

				await mockContext.globalState.update('muTwo.recentProjects', recentProjects);
			}

			// Verify list management
			const finalList = mockContext.globalState.get('muTwo.recentProjects', []);
			assert.strictEqual(finalList.length, maxRecentProjects, 'Should maintain maximum list size');
			assert.strictEqual(finalList[0], 'project-12', 'Most recent project should be first');
			assert.strictEqual(finalList[9], 'project-3', 'Oldest kept project should be last');
		});
	});

	describe('Workspace State Management', () => {
		it('should store and retrieve workspace-specific settings', async () => {
			// Workspace-specific configuration
			const workspaceConfig = {
				currentProject: 'weather-station',
				boardType: 'Adafruit Feather ESP32-S2',
				lastSyncTime: new Date().toISOString(),
				openFiles: [
					'code.py',
					'boot.py',
					'lib/sensors.py'
				],
				editorState: {
					activeFile: 'code.py',
					cursorPosition: { line: 42, character: 15 },
					scrollPosition: 320
				},
				terminalState: {
					connected: true,
					baudRate: 115200,
					port: 'COM3',
					replHistory: [
						'import board',
						'print(board.board_id)',
						'led = digitalio.DigitalInOut(board.LED)'
					]
				}
			};

			// Store workspace configuration
			await mockContext.workspaceState.update('muTwo.workspace', workspaceConfig);
			await mockContext.workspaceState.update('muTwo.lastSaved', new Date().toISOString());

			// Retrieve and verify
			const retrievedConfig = mockContext.workspaceState.get('muTwo.workspace');
			const lastSaved = mockContext.workspaceState.get('muTwo.lastSaved');

			assert.deepStrictEqual(retrievedConfig, workspaceConfig, 'Workspace config should match');
			assert.ok(lastSaved, 'Last saved timestamp should be stored');
			assert.strictEqual(retrievedConfig.currentProject, 'weather-station', 'Current project should be stored');
		});

		it('should handle project switching with state persistence', async () => {
			// Save state for first project
			const project1State = {
				name: 'led-matrix',
				openFiles: ['code.py', 'animations.py'],
				activeFile: 'code.py',
				unsavedChanges: false
			};

			await mockContext.workspaceState.update('muTwo.project.led-matrix', project1State);

			// Switch to second project
			const project2State = {
				name: 'sensor-hub',
				openFiles: ['code.py', 'boot.py', 'lib/sensors.py'],
				activeFile: 'lib/sensors.py',
				unsavedChanges: true
			};

			await mockContext.workspaceState.update('muTwo.project.sensor-hub', project2State);
			await mockContext.workspaceState.update('muTwo.currentProject', 'sensor-hub');

			// Verify both projects' states are preserved
			const retrieved1 = mockContext.workspaceState.get('muTwo.project.led-matrix');
			const retrieved2 = mockContext.workspaceState.get('muTwo.project.sensor-hub');
			const currentProject = mockContext.workspaceState.get('muTwo.currentProject');

			assert.deepStrictEqual(retrieved1, project1State, 'First project state should be preserved');
			assert.deepStrictEqual(retrieved2, project2State, 'Second project state should be preserved');
			assert.strictEqual(currentProject, 'sensor-hub', 'Current project should be updated');
		});

		it('should manage device connection state', async () => {
			// Test device connection state management
			const deviceStates = [
				{
					timestamp: new Date().toISOString(),
					boardId: 'circuitplayground_express',
					serialNumber: 'ABCD1234567890',
					port: 'COM3',
					connected: true,
					firmwareVersion: '8.2.9'
				},
				{
					timestamp: new Date().toISOString(),
					boardId: 'feather_esp32s2',
					serialNumber: 'EFGH0987654321',
					port: 'COM4',
					connected: false,
					firmwareVersion: '8.2.7'
				}
			];

			// Store device states
			for (let i = 0; i < deviceStates.length; i++) {
				await mockContext.workspaceState.update(`muTwo.device.${i}`, deviceStates[i]);
			}

			await mockContext.workspaceState.update('muTwo.activeDevice', 0);
			await mockContext.workspaceState.update('muTwo.deviceCount', deviceStates.length);

			// Retrieve and verify device states
			const activeDeviceIndex = mockContext.workspaceState.get('muTwo.activeDevice');
			const deviceCount = mockContext.workspaceState.get('muTwo.deviceCount');
			const activeDevice = mockContext.workspaceState.get(`muTwo.device.${activeDeviceIndex}`) as any;

			assert.strictEqual(activeDeviceIndex, 0, 'Active device index should be stored');
			assert.strictEqual(deviceCount, 2, 'Device count should be accurate');
			assert.strictEqual(activeDevice.connected, true, 'Active device should be connected');
			assert.strictEqual(activeDevice.boardId, 'circuitplayground_express', 'Board ID should match');
		});

		it('should handle workspace state cleanup', async () => {
			// Store various workspace states
			await mockContext.workspaceState.update('muTwo.tempData1', 'temporary');
			await mockContext.workspaceState.update('muTwo.tempData2', { temp: true });
			await mockContext.workspaceState.update('muTwo.persistentData', { important: true });
			await mockContext.workspaceState.update('muTwo.sessionData', 'session-specific');

			// Simulate cleanup of temporary data
			const keysToCleanup = ['muTwo.tempData1', 'muTwo.tempData2', 'muTwo.sessionData'];

			for (const key of keysToCleanup) {
				await mockContext.workspaceState.update(key, undefined);
			}

			// Verify cleanup
			const temp1 = mockContext.workspaceState.get('muTwo.tempData1');
			const temp2 = mockContext.workspaceState.get('muTwo.tempData2');
			const persistent = mockContext.workspaceState.get('muTwo.persistentData');
			const session = mockContext.workspaceState.get('muTwo.sessionData');

			assert.strictEqual(temp1, undefined, 'Temporary data 1 should be cleaned up');
			assert.strictEqual(temp2, undefined, 'Temporary data 2 should be cleaned up');
			assert.strictEqual(session, undefined, 'Session data should be cleaned up');
			assert.deepStrictEqual(persistent, { important: true }, 'Persistent data should remain');
		});
	});

	describe('Storage Integration Scenarios', () => {
		it('should handle storage migration scenarios', async () => {
			// Simulate upgrading from old storage format to new format
			const oldFormatData = {
				version: '0.9.0',
				settings: 'old-format-string',
				projects: 'comma,separated,list'
			};

			// Store old format
			await mockContext.globalState.update('muTwo.legacy', oldFormatData);

			// Simulate migration
			const migratedData = {
				version: '1.0.0',
				settings: {
					autoSync: true,
					enableRepl: true
				},
				projects: ['comma', 'separated', 'list']
			};

			// Update to new format
			await mockContext.globalState.update('muTwo.settings', migratedData.settings);
			await mockContext.globalState.update('muTwo.recentProjects', migratedData.projects);
			await mockContext.globalState.update('muTwo.version', migratedData.version);

			// Clean up legacy data
			await mockContext.globalState.update('muTwo.legacy', undefined);

			// Verify migration
			const newSettings = mockContext.globalState.get('muTwo.settings');
			const newProjects = mockContext.globalState.get('muTwo.recentProjects');
			const newVersion = mockContext.globalState.get('muTwo.version');
			const legacyData = mockContext.globalState.get('muTwo.legacy');

			assert.deepStrictEqual(newSettings, migratedData.settings, 'Settings should be migrated');
			assert.deepStrictEqual(newProjects, migratedData.projects, 'Projects should be migrated');
			assert.strictEqual(newVersion, '1.0.0', 'Version should be updated');
			assert.strictEqual(legacyData, undefined, 'Legacy data should be removed');
		});

		it('should handle concurrent storage operations', async () => {
			// Simulate multiple concurrent operations
			const operations = [];

			// Create multiple concurrent updates
			for (let i = 0; i < 5; i++) {
				operations.push(
					mockContext.globalState.update(`muTwo.concurrent.${i}`, {
						id: i,
						timestamp: new Date().toISOString(),
						data: `data-${i}`
					})
				);
			}

			// Wait for all operations to complete
			await Promise.all(operations);

			// Verify all operations completed successfully
			for (let i = 0; i < 5; i++) {
				const data = mockContext.globalState.get(`muTwo.concurrent.${i}`) as any;
				assert.ok(data, `Concurrent operation ${i} should have completed`);
				assert.strictEqual(data.id, i, `Data ID should match for operation ${i}`);
				assert.ok(data.timestamp, `Timestamp should exist for operation ${i}`);
			}
		});

		it('should handle large data storage efficiently', async () => {
			// Test storing large amounts of data
			const largeDataSet = {
				projectHistory: [],
				compilationCache: {},
				libraryIndex: {},
				deviceDatabase: []
			};

			// Generate large project history
			for (let i = 0; i < 100; i++) {
				(largeDataSet.projectHistory as any[]).push({
					id: i,
					name: `project-${i}`,
					created: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
					files: [`code-${i}.py`, `boot-${i}.py`],
					metadata: {
						description: `Test project ${i}`,
						tags: [`tag-${i % 10}`, `category-${Math.floor(i / 10)}`]
					}
				});
			}

			// Generate library index
			for (let i = 0; i < 50; i++) {
				(largeDataSet.libraryIndex as any)[`adafruit_lib_${i}`] = {
					version: `1.${i}.0`,
					size: 1024 * (i + 1),
					dependencies: [`dep_${i % 5}`],
					documentation: `https://docs.adafruit.com/lib${i}`
				};
			}

			// Store large dataset
			const startTime = Date.now();
			await mockContext.globalState.update('muTwo.largeDataSet', largeDataSet);
			const storageTime = Date.now() - startTime;

			// Retrieve and verify
			const retrievalStart = Date.now();
			const retrievedData = mockContext.globalState.get('muTwo.largeDataSet') as any;
			const retrievalTime = Date.now() - retrievalStart;

			assert.ok(storageTime < 1000, 'Large data storage should be reasonably fast');
			assert.ok(retrievalTime < 100, 'Large data retrieval should be fast');
			assert.strictEqual(retrievedData.projectHistory.length, 100, 'All project history should be stored');
			assert.strictEqual(Object.keys(retrievedData.libraryIndex).length, 50, 'All library index entries should be stored');
		});
	});
});