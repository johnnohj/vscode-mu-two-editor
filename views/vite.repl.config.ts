import { defineConfig } from 'vite';
import { resolve } from 'path';
import preact from '@preact/preset-vite';

// REPL-specific build configuration with Preact support
export default defineConfig({
	plugins: [preact()],
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
		extensions: ['.tsx', '.ts', '.js', '.css'],
		alias: {
			'@shared': resolve(__dirname, 'shared'),
			'react': 'preact/compat',
			'react-dom': 'preact/compat'
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