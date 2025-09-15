import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

// Editor-specific build configuration
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
		outDir: '../public/editor/',
		emptyOutDir: true,
		// Ensure assets are bundled properly for webview
		assetsDir: 'assets',
		// Generate relative paths for webview compatibility
		assetsInlineLimit: 0,
		rollupOptions: {
			input: resolve(__dirname, 'webview-editor/index.html'),
			output: {
				// Ensure consistent naming for webview
				entryFileNames: 'index.js',
				chunkFileNames: '[name].js',
				assetFileNames: '[name].[ext]'
			}
		}
	},
	base: './',
	resolve: {
		extensions: ['.ts', '.tsx', '.js', '.jsx', '.css'],
		alias: {
			'@shared': resolve(__dirname, 'shared'),
		}
	},
	css: {
		modules: {
			// Enable CSS modules for .module.css files
			localsConvention: 'camelCase'
		}
	},
	// Configure for webview compatibility
	define: {
		// Ensure process.env is available if needed
		'process.env': {}
	}
});