import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

describe('Integration Tests - Workspace Folder Creation and Management', () => {
	let testBaseUri: vscode.Uri;
	let tempDir: string;

	beforeEach(async () => {
		// Create base temporary directory for all workspace tests
		tempDir = path.join(os.tmpdir(), 'mu-two-workspace-test-' + Date.now());
		testBaseUri = vscode.Uri.file(tempDir);
		await vscode.workspace.fs.createDirectory(testBaseUri);
	});

	afterEach(async () => {
		// Clean up workspace and close editors
		try {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
			await vscode.workspace.fs.delete(testBaseUri, { recursive: true });
		} catch (error) {
			console.warn('Failed to clean up workspace test files:', error);
		}
	});

	describe('Mu Two Workspace Structure Creation', () => {
		it('should create complete Mu Two workspace structure', async () => {
			const workspaceName = 'test-mu-workspace';
			const workspaceUri = vscode.Uri.joinPath(testBaseUri, workspaceName);

			// Define required Mu Two workspace structure
			const requiredStructure = [
				'projects',              // User projects directory
				'ctpy-device',          // CircuitPython device mount point
				'ctpy-device/current',  // Current device files
				'.vscode',              // VS Code configuration
				'.backup',              // Backup files
				'templates',            // Project templates
				'lib',                  // Shared libraries
				'assets'                // Shared assets
			];

			// Create workspace root
			await vscode.workspace.fs.createDirectory(workspaceUri);

			// Create all required directories
			for (const dir of requiredStructure) {
				const dirUri = vscode.Uri.joinPath(workspaceUri, dir);
				await vscode.workspace.fs.createDirectory(dirUri);

				// Verify directory creation
				const stats = await vscode.workspace.fs.stat(dirUri);
				assert.strictEqual(stats.type, vscode.FileType.Directory, `${dir} should be a directory`);
			}

			// Create VS Code workspace configuration
			const workspaceConfigUri = vscode.Uri.joinPath(workspaceUri, `${workspaceName}.code-workspace`);
			const workspaceConfig = {
				folders: [
					{
						name: "Mu Two Projects",
						path: "./projects"
					},
					{
						name: "CircuitPython Device",
						path: "./ctpy-device"
					}
				],
				settings: {
					"python.defaultInterpreterPath": "./venv/bin/python",
					"muTwo.autoSync": true,
					"muTwo.enableRepl": true,
					"muTwo.defaultBaudRate": 115200,
					"muTwo.saveOnRun": true,
					"files.associations": {
						"*.py": "python",
						"boot.py": "python",
						"code.py": "python",
						"settings.toml": "toml"
					},
					"files.exclude": {
						"**/.backup": true,
						"**/.*": false,
						".vscode": false
					}
				},
				extensions: {
					recommendations: [
						"ms-python.python",
						"ms-python.pylint",
						"charliermarsh.ruff"
					]
				}
			};

			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(
				workspaceConfigUri,
				encoder.encode(JSON.stringify(workspaceConfig, null, 2))
			);

			// Create VS Code settings
			const settingsUri = vscode.Uri.joinPath(workspaceUri, '.vscode', 'settings.json');
			const vscodeSettings = {
				"python.analysis.extraPaths": ["./lib"],
				"python.analysis.include": ["./projects/**", "./lib/**"],
				"muTwo.workspaceVersion": "1.0.0",
				"muTwo.circuitPythonPath": "./ctpy-device/current",
				"muTwo.projectsPath": "./projects",
				"muTwo.backupPath": "./.backup"
			};

			await vscode.workspace.fs.writeFile(
				settingsUri,
				encoder.encode(JSON.stringify(vscodeSettings, null, 2))
			);

			// Verify complete workspace structure
			const workspaceContents = await vscode.workspace.fs.readDirectory(workspaceUri);
			const directories = workspaceContents
				.filter(([name, type]) => type === vscode.FileType.Directory)
				.map(([name]) => name);

			for (const requiredDir of requiredStructure.filter(d => !d.includes('/'))) {
				assert.ok(directories.includes(requiredDir), `${requiredDir} directory should exist`);
			}

			// Verify workspace configuration file
			const configStats = await vscode.workspace.fs.stat(workspaceConfigUri);
			assert.strictEqual(configStats.type, vscode.FileType.File, 'Workspace config should be a file');

			// Verify settings file
			const settingsStats = await vscode.workspace.fs.stat(settingsUri);
			assert.strictEqual(settingsStats.type, vscode.FileType.File, 'VS Code settings should be a file');

			// Verify configuration content
			const decoder = new TextDecoder();
			const configContent = JSON.parse(
				decoder.decode(await vscode.workspace.fs.readFile(workspaceConfigUri))
			);

			assert.strictEqual(configContent.folders.length, 2, 'Should have 2 workspace folders');
			assert.strictEqual(configContent.folders[0].name, 'Mu Two Projects', 'First folder should be projects');
			assert.strictEqual(configContent.folders[1].name, 'CircuitPython Device', 'Second folder should be device');
			assert.ok(configContent.settings['muTwo.autoSync'], 'Auto sync should be enabled');
		});

		it('should create multi-root workspace with proper folder configuration', async () => {
			const workspaceName = 'multi-root-test';
			const workspaceUri = vscode.Uri.joinPath(testBaseUri, workspaceName);

			// Create workspace structure
			await vscode.workspace.fs.createDirectory(workspaceUri);

			const folders = [
				{ name: 'projects', displayName: 'CircuitPython Projects' },
				{ name: 'ctpy-device', displayName: 'Device Files' },
				{ name: 'libraries', displayName: 'Shared Libraries' },
				{ name: 'documentation', displayName: 'Project Documentation' }
			];

			// Create all folders
			for (const folder of folders) {
				const folderUri = vscode.Uri.joinPath(workspaceUri, folder.name);
				await vscode.workspace.fs.createDirectory(folderUri);

				// Add some content to make folders meaningful
				if (folder.name === 'projects') {
					await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folderUri, 'example-project'));
					const exampleFile = vscode.Uri.joinPath(folderUri, 'example-project', 'code.py');
					const encoder = new TextEncoder();
					await vscode.workspace.fs.writeFile(
						exampleFile,
						encoder.encode('# Example CircuitPython project\nimport board\nprint("Hello!")')
					);
				} else if (folder.name === 'libraries') {
					const libFile = vscode.Uri.joinPath(folderUri, 'example_lib.py');
					const encoder = new TextEncoder();
					await vscode.workspace.fs.writeFile(
						libFile,
						encoder.encode('# Example library\ndef helper_function():\n    return "Helper"')
					);
				}
			}

			// Create multi-root workspace configuration
			const multiRootConfig = {
				folders: folders.map(folder => ({
					name: folder.displayName,
					path: `./${folder.name}`
				})),
				settings: {
					"muTwo.multiRootMode": true,
					"muTwo.syncAllFolders": false,
					"muTwo.primaryProjectFolder": "CircuitPython Projects"
				}
			};

			const configUri = vscode.Uri.joinPath(workspaceUri, `${workspaceName}.code-workspace`);
			const encoder = new TextEncoder();
			await vscode.workspace.fs.writeFile(
				configUri,
				encoder.encode(JSON.stringify(multiRootConfig, null, 2))
			);

			// Verify multi-root structure
			const config = JSON.parse(
				new TextDecoder().decode(await vscode.workspace.fs.readFile(configUri))
			);

			assert.strictEqual(config.folders.length, folders.length, 'Should have all configured folders');

			for (let i = 0; i < folders.length; i++) {
				assert.strictEqual(config.folders[i].name, folders[i].displayName,
					`Folder ${i} should have correct display name`);
				assert.strictEqual(config.folders[i].path, `./${folders[i].name}`,
					`Folder ${i} should have correct path`);
			}

			assert.ok(config.settings['muTwo.multiRootMode'], 'Multi-root mode should be enabled');
		});

		it('should handle workspace templates and initialization', async () => {
			const templates = [
				{
					name: 'basic-circuitpython',
					description: 'Basic CircuitPython workspace',
					structure: {
						'projects/hello-world': {
							'code.py': '# Hello World\nimport board\nprint("Hello, CircuitPython!")',
							'boot.py': '# Boot configuration',
							'settings.toml': 'CIRCUITPY_WEB_API_PASSWORD = "hello123"'
						},
						'lib': {},
						'templates/basic': {
							'code.py': '# Basic template\nimport board\n# Your code here'
						}
					}
				},
				{
					name: 'sensor-project',
					description: 'Sensor reading workspace',
					structure: {
						'projects/temperature-monitor': {
							'code.py': '# Temperature monitoring\nimport board\nimport analogio\nimport time\n\nsensor = analogio.AnalogIn(board.A0)\n\nwhile True:\n    temp = (sensor.value * 3.3 / 65536) * 100\n    print(f"Temperature: {temp:.1f}°C")\n    time.sleep(5)',
							'lib/temperature.py': '# Temperature utilities\ndef celsius_to_fahrenheit(c):\n    return c * 9/5 + 32'
						}
					}
				}
			];

			for (const template of templates) {
				const workspaceUri = vscode.Uri.joinPath(testBaseUri, template.name);
				await vscode.workspace.fs.createDirectory(workspaceUri);

				// Create template structure
				await createStructureFromTemplate(workspaceUri, template.structure);

				// Verify template was created correctly
				await verifyTemplateStructure(workspaceUri, template.structure);

				// Create workspace metadata
				const metadataUri = vscode.Uri.joinPath(workspaceUri, '.mu-workspace.json');
				const metadata = {
					name: template.name,
					description: template.description,
					created: new Date().toISOString(),
					version: '1.0.0',
					type: 'circuitpython-workspace'
				};

				const encoder = new TextEncoder();
				await vscode.workspace.fs.writeFile(
					metadataUri,
					encoder.encode(JSON.stringify(metadata, null, 2))
				);

				// Verify metadata
				const metadataStats = await vscode.workspace.fs.stat(metadataUri);
				assert.strictEqual(metadataStats.type, vscode.FileType.File, 'Metadata file should exist');

				const savedMetadata = JSON.parse(
					new TextDecoder().decode(await vscode.workspace.fs.readFile(metadataUri))
				);
				assert.strictEqual(savedMetadata.name, template.name, 'Metadata should have correct name');
				assert.strictEqual(savedMetadata.type, 'circuitpython-workspace', 'Should be CircuitPython workspace type');
			}
		});
	});

	describe('Workspace Validation and Health Checks', () => {
		it('should validate workspace integrity', async () => {
			const workspaceUri = vscode.Uri.joinPath(testBaseUri, 'validation-test');

			// Create incomplete workspace (missing some required folders)
			await vscode.workspace.fs.createDirectory(workspaceUri);
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceUri, 'projects'));
			// Deliberately omit 'ctpy-device' folder

			// Define validation rules
			const requiredFolders = ['projects', 'ctpy-device'];
			const optionalFolders = ['.vscode', '.backup', 'templates'];
			const requiredFiles = ['.mu-workspace.json'];

			const validation = {
				missing: [],
				present: [],
				issues: []
			};

			// Check required folders
			for (const folder of requiredFolders) {
				try {
					const folderUri = vscode.Uri.joinPath(workspaceUri, folder);
					const stats = await vscode.workspace.fs.stat(folderUri);
					if (stats.type === vscode.FileType.Directory) {
						(validation.present as string[]).push(folder);
					}
				} catch {
					(validation.missing as string[]).push(folder);
					(validation.issues as string[]).push(`Required folder '${folder}' is missing`);
				}
			}

			// Check optional folders
			for (const folder of optionalFolders) {
				try {
					const folderUri = vscode.Uri.joinPath(workspaceUri, folder);
					await vscode.workspace.fs.stat(folderUri);
					(validation.present as string[]).push(folder);
				} catch {
					// Optional folders can be missing
				}
			}

			// Check required files
			for (const file of requiredFiles) {
				try {
					const fileUri = vscode.Uri.joinPath(workspaceUri, file);
					await vscode.workspace.fs.stat(fileUri);
					(validation.present as string[]).push(file);
				} catch {
					(validation.missing as string[]).push(file);
					(validation.issues as string[]).push(`Required file '${file}' is missing`);
				}
			}

			// Verify validation results
			assert.ok(validation.missing.length > 0, 'Should detect missing required elements');
			assert.ok(validation.issues.length > 0, 'Should report validation issues');
			assert.ok(validation.present.includes('projects'), 'Should detect present folders');

			// Fix validation issues
			for (const missingFolder of (validation.missing as string[]).filter(m => requiredFolders.includes(m))) {
				const folderUri = vscode.Uri.joinPath(workspaceUri, missingFolder);
				await vscode.workspace.fs.createDirectory(folderUri);
			}

			// Create missing files
			if (validation.missing.includes('.mu-workspace.json')) {
				const metadataUri = vscode.Uri.joinPath(workspaceUri, '.mu-workspace.json');
				const metadata = {
					name: 'validation-test',
					created: new Date().toISOString(),
					version: '1.0.0'
				};
				const encoder = new TextEncoder();
				await vscode.workspace.fs.writeFile(
					metadataUri,
					encoder.encode(JSON.stringify(metadata, null, 2))
				);
			}

			// Re-validate
			const revalidation = { missing: [], issues: [] };
			for (const folder of requiredFolders) {
				try {
					const folderUri = vscode.Uri.joinPath(workspaceUri, folder);
					const stats = await vscode.workspace.fs.stat(folderUri);
					if (stats.type !== vscode.FileType.Directory) {
						revalidation.issues.push(`${folder} is not a directory`);
					}
				} catch {
					revalidation.missing.push(folder);
				}
			}

			assert.strictEqual(revalidation.missing.length, 0, 'All required folders should now exist');
			assert.strictEqual(revalidation.issues.length, 0, 'Should have no validation issues after fix');
		});

		it('should perform workspace health checks', async () => {
			const workspaceUri = vscode.Uri.joinPath(testBaseUri, 'health-check-test');

			// Create workspace with potential health issues
			await vscode.workspace.fs.createDirectory(workspaceUri);
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceUri, 'projects'));
			await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(workspaceUri, 'ctpy-device'));

			// Create some test projects with various conditions
			const projects = [
				{
					name: 'healthy-project',
					files: {
						'code.py': '# Healthy project\nimport board\nprint("OK")',
						'boot.py': '# Boot OK'
					}
				},
				{
					name: 'large-project',
					files: {
						'code.py': '# Large file\n' + 'print("line")\n'.repeat(10000), // Very large file
						'data.bin': Buffer.alloc(1024 * 1024).toString() // 1MB file
					}
				}
			];

			const encoder = new TextEncoder();
			for (const project of projects) {
				const projectUri = vscode.Uri.joinPath(workspaceUri, 'projects', project.name);
				await vscode.workspace.fs.createDirectory(projectUri);

				for (const [fileName, content] of Object.entries(project.files)) {
					const fileUri = vscode.Uri.joinPath(projectUri, fileName);
					await vscode.workspace.fs.writeFile(fileUri, encoder.encode(content));
				}
			}

			// Perform health checks
			const healthCheck = {
				totalProjects: 0,
				totalFiles: 0,
				totalSize: 0,
				largeFiles: [],
				issues: [],
				warnings: []
			};

			// Count projects
			const projectsUri = vscode.Uri.joinPath(workspaceUri, 'projects');
			const projectsList = await vscode.workspace.fs.readDirectory(projectsUri);
			healthCheck.totalProjects = projectsList.filter(([name, type]) =>
				type === vscode.FileType.Directory).length;

			// Analyze each project
			for (const [projectName, type] of projectsList) {
				if (type === vscode.FileType.Directory) {
					const projectUri = vscode.Uri.joinPath(projectsUri, projectName);
					const projectFiles = await vscode.workspace.fs.readDirectory(projectUri);

					for (const [fileName, fileType] of projectFiles) {
						if (fileType === vscode.FileType.File) {
							healthCheck.totalFiles++;

							const fileUri = vscode.Uri.joinPath(projectUri, fileName);
							const stats = await vscode.workspace.fs.stat(fileUri);
							healthCheck.totalSize += stats.size;

							// Check for large files (> 100KB)
							if (stats.size > 100 * 1024) {
								(healthCheck.largeFiles as any[]).push({
									project: projectName,
									file: fileName,
									size: stats.size
								});
								(healthCheck.warnings as string[]).push(
									`Large file detected: ${projectName}/${fileName} (${Math.round(stats.size / 1024)}KB)`
								);
							}

							// Check for missing main files
							if (projectName === 'healthy-project' && fileName === 'code.py') {
								try {
									const content = new TextDecoder().decode(
										await vscode.workspace.fs.readFile(fileUri)
									);
									if (!content.includes('import board')) {
										(healthCheck.issues as string[]).push(
											`Project ${projectName} may not be a valid CircuitPython project`
										);
									}
								} catch {
									(healthCheck.issues as string[]).push(`Cannot read file ${projectName}/${fileName}`);
								}
							}
						}
					}
				}
			}

			// Verify health check results
			assert.strictEqual(healthCheck.totalProjects, 2, 'Should count all projects');
			assert.ok(healthCheck.totalFiles > 0, 'Should count files');
			assert.ok(healthCheck.totalSize > 0, 'Should calculate total size');
			assert.ok(healthCheck.largeFiles.length > 0, 'Should detect large files');
			assert.ok(healthCheck.warnings.length > 0, 'Should generate warnings for large files');

			// Generate health report
			const healthReport = {
				timestamp: new Date().toISOString(),
				summary: {
					projects: healthCheck.totalProjects,
					files: healthCheck.totalFiles,
					totalSizeKB: Math.round(healthCheck.totalSize / 1024)
				},
				issues: healthCheck.issues,
				warnings: healthCheck.warnings,
				recommendations: [
					healthCheck.largeFiles.length > 0 ? 'Consider optimizing large files' : null,
					'Regular workspace cleanup recommended'
				].filter(Boolean)
			};

			// Save health report
			const reportUri = vscode.Uri.joinPath(workspaceUri, '.workspace-health.json');
			await vscode.workspace.fs.writeFile(
				reportUri,
				encoder.encode(JSON.stringify(healthReport, null, 2))
			);

			// Verify report creation
			const reportStats = await vscode.workspace.fs.stat(reportUri);
			assert.strictEqual(reportStats.type, vscode.FileType.File, 'Health report should be created');

			const savedReport = JSON.parse(
				new TextDecoder().decode(await vscode.workspace.fs.readFile(reportUri))
			);
			assert.strictEqual(savedReport.summary.projects, 2, 'Report should show correct project count');
		});
	});

	// Helper functions
	async function createStructureFromTemplate(baseUri: vscode.Uri, structure: any): Promise<void> {
		const encoder = new TextEncoder();

		for (const [path, content] of Object.entries(structure)) {
			const fullPath = vscode.Uri.joinPath(baseUri, path);

			if (typeof content === 'object' && content !== null) {
				// It's a directory
				await vscode.workspace.fs.createDirectory(fullPath);
				await createStructureFromTemplate(fullPath, content);
			} else if (typeof content === 'string') {
				// It's a file
				const dirPath = vscode.Uri.joinPath(fullPath, '..');
				try {
					await vscode.workspace.fs.createDirectory(dirPath);
				} catch {
					// Directory might already exist
				}
				await vscode.workspace.fs.writeFile(fullPath, encoder.encode(content));
			}
		}
	}

	async function verifyTemplateStructure(baseUri: vscode.Uri, structure: any): Promise<void> {
		for (const [path, content] of Object.entries(structure)) {
			const fullPath = vscode.Uri.joinPath(baseUri, path);
			const stats = await vscode.workspace.fs.stat(fullPath);

			if (typeof content === 'object' && content !== null) {
				assert.strictEqual(stats.type, vscode.FileType.Directory,
					`${path} should be a directory`);
				await verifyTemplateStructure(fullPath, content);
			} else if (typeof content === 'string') {
				assert.strictEqual(stats.type, vscode.FileType.File,
					`${path} should be a file`);

				const fileContent = new TextDecoder().decode(
					await vscode.workspace.fs.readFile(fullPath)
				);
				assert.ok(fileContent.includes(content.split('\n')[0]),
					`${path} should contain expected content`);
			}
		}
	}
});