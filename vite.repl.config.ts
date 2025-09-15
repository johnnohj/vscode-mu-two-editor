import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		target: 'es2020',
		outDir: resolve(__dirname, 'public'),
		emptyOutDir: false,
		lib: {
			entry: resolve(__dirname, 'webview/src/replWebview.ts'),
			name: 'replWebview',
			formats: ['iife'],
			fileName: () => 'index.js'
		},
		rollupOptions: {
			external: ['vscode'],
			output: {
				globals: {
					vscode: 'vscode'
				}
			}
		},
		sourcemap: true,
		minify: false
	},
	resolve: {
		extensions: ['.ts', '.js', '.css']
	},
	css: {
		// Ensure CSS is processed but not inlined
		// The CSS will be loaded separately by the webview
		extract: false
	},
	define: {
		'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
	}
});