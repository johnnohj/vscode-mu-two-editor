/**
 * Utility functions for webview operations
 */

/**
 * Generate a cryptographically secure nonce for webview security
 * Used in Content Security Policy headers to prevent XSS attacks
 * @returns A random nonce string
 */
export function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

/**
 * Create a Content Security Policy string for webviews
 * @param nonce The nonce to use for script and style sources
 * @param additionalSources Additional allowed sources
 * @returns CSP header string
 */
export function createContentSecurityPolicy(nonce: string, additionalSources: string[] = []): string {
	const basePolicy = [
		`default-src 'none'`,
		`script-src 'nonce-${nonce}'`,
		`style-src 'unsafe-inline'`,
		`img-src data: https:`,
		`font-src data:`,
		`worker-src 'self' blob:`
	];

	if (additionalSources.length > 0) {
		basePolicy.push(...additionalSources);
	}

	return basePolicy.join('; ') + ';';
}