import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

// Multi-entry build configuration for both webviews
export default defineConfig({
	plugins: [
		preact({
			// Disable prerendering for webview context
			prerender: {
				enabled: false,
			},
		}),
	],
	worker: {
		format: 'es'
	},
	build: {
		target: 'es2020',
		// Build both webviews in a single pass
		rollupOptions: {
			input: {
				// REPL webview entry
				'repl': resolve(__dirname, 'webview-repl/src/replWebview.ts'),
				// Editor webview entry  
				'editor': resolve(__dirname, 'webview-editor/index.html'),
			},
			external: ['vscode'],
			output: [
				// REPL output (to public/index.js)
				{
					entryFileNames: (chunkInfo) => {
						return chunkInfo.name === 'repl' ? '../public/index.js' : '../public/editor/[name].js';
					},
					chunkFileNames: '../public/[name].js',
					assetFileNames: '../public/[name].[ext]',
					dir: __dirname,
					format: 'iife',
					globals: {
						vscode: 'vscode'
					},
					// Only apply to REPL bundle
					manualChunks: (id) => {
						if (id.includes('webview-repl')) {
							return 'repl';
						}
					}
				},
				// Editor output (to public/editor/)
				{
					entryFileNames: (chunkInfo) => {
						return chunkInfo.name === 'editor' ? '../public/editor/index.js' : '../public/editor/[name].js';
					},
					chunkFileNames: '../public/editor/[name].js', 
					assetFileNames: '../public/editor/[name].[ext]',
					dir: __dirname,
					format: 'es',
					// Only apply to Editor bundle
					manualChunks: (id) => {
						if (id.includes('webview-editor')) {
							return 'editor';
						}
					}
				}
			]
		},
		sourcemap: true,
		minify: false,
		// Generate relative paths for webview compatibility
		assetsInlineLimit: 0,
	},
	base: './',
	resolve: {
		extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
		alias: {
			'@shared': resolve(__dirname, 'shared'),
			'@repl': resolve(__dirname, 'webview-repl'),
			'@editor': resolve(__dirname, 'webview-editor'),
		}
	},
	css: {
		// Process CSS but don't inline for REPL compatibility
		extract: false,
		modules: {
			// Enable CSS modules for .module.css files
			localsConvention: 'camelCase'
		}
	},
	define: {
		'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
		// Ensure process.env is available if needed
		'process.env': {}
	}
});