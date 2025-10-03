import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		target: 'node16',
		outDir: 'dist',
		emptyOutDir: true,
		lib: {
			entry: resolve(__dirname, 'src/extension.ts'),
			name: 'extension',
			formats: ['cjs'],
			fileName: () => 'extension.js'
		},
		commonjsOptions: {
			ignoreDynamicRequires: false,
			transformMixedEsModules: true
		},
		rollupOptions: {
			external: [
				// VS Code API
				'vscode',
				// Node.js built-ins
				'child_process',
				'events',
				'fs',
				'path',
				'util',
				'os',
				// Extension dependencies
				'@serialport/parser-readline',
				'@vscode/debugadapter',
				'@vscode/debugprotocol',
				'@xterm/addon-fit',
				'@xterm/addon-serialize',
				'@xterm/headless',
				'@xterm/xterm',
				'cors',
				'express',
				'serialport',
				'vscode-jsonrpc',
				'vscode-languageclient',
				'vscode-languageserver',
				'vscode-languageserver-textdocument'
			],
			output: {
				globals: {
					vscode: 'vscode'
				}
			}
		},
		minify: false,
		sourcemap: true
	},
	resolve: {
		extensions: ['.ts', '.js']
	},
	define: {
		'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
		// Ensure process global is available
		'global': 'globalThis'
	},
	// Ensure Node.js environment
	ssr: {
		target: 'node',
		noExternal: false
	}
});