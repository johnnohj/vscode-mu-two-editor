import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		label: 'integration',
		files: 'out/test/integration/**/*.test.js',
		version: 'insiders',
		workspaceFolder: './test/fixtures/test-workspace',
		// Install required extensions for tests
		extensionDevelopmentPath: '.',
		extensions: [
			'ms-python.python'
		],
		mocha: {
			ui: 'bdd',
			color: true,
			timeout: 120000,
			reporter: 'spec'
		}
	}
]);