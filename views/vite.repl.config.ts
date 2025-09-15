import { defineConfig } from 'vite';
import { resolve } from 'path';

// REPL-specific build configuration
export default defineConfig({
	build: {
		target: 'es2020',
		outDir: resolve(__dirname, '../public/repl'),
		emptyOutDir: false,
		lib: {
			entry: resolve(__dirname, 'webview-repl/src/replWebview.ts'),
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
		extensions: ['.ts', '.js', '.css'],
		alias: {
			'@shared': resolve(__dirname, 'shared'),
		}
	},
	css: {
		
		// Ensure CSS is processed but not inlined
		extract: false
	},
	define: {
		'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
	}
});