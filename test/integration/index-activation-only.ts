import * as path from 'path';
import Mocha from 'mocha';

export function run(): Promise<void> {
	// Create the mocha test with TDD interface
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 120000
	});

	const testsRoot = __dirname;

	return new Promise((resolve, reject) => {
		// CRITICAL: Set up TDD globals (suite, test, suiteSetup, etc.)
		mocha.suite.emit('pre-require', global, null, mocha);

		// ALSO expose BDD aliases for mixed test files
		(global as any).describe = (global as any).suite;
		(global as any).it = (global as any).test;
		(global as any).context = (global as any).suite;
		(global as any).specify = (global as any).test;
		(global as any).beforeEach = (global as any).setup;
		(global as any).afterEach = (global as any).teardown;

		// Load ONLY the activation test
		try {
			require(path.resolve(testsRoot, 'activation-setup.test.js'));

			// Run the tests
			mocha.run(failures => {
				if (failures > 0) {
					reject(new Error(`${failures} tests failed.`));
				} else {
					resolve();
				}
			});
		} catch (err) {
			console.error(err);
			reject(err);
		}
	});
}
