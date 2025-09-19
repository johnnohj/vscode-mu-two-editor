import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/unit/**/*.js',
	version: 'insiders',
	workspaceFolder: './test/fixtures/test-workspace',
	mocha: {
		ui: 'bdd',
		color: true,
		timeout: 20000,
		reporter: 'spec'
	}
});