import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
	// Create the mocha test with TDD interface
	const mocha = new Mocha({
		ui: 'tdd',
		color: true,
		timeout: 120000
	});

	const testsRoot = __dirname;

	return new Promise((resolve, reject) => {
		glob('*.test.js', { cwd: testsRoot }).then((files) => {
			// CRITICAL: Set up TDD globals (suite, test, suiteSetup, etc.)
			mocha.suite.emit('pre-require', global, null, mocha);

			// ALSO expose BDD aliases for mixed test files
			// Some tests use suite/test (TDD), others use describe/it (BDD)
			(global as any).describe = (global as any).suite;
			(global as any).it = (global as any).test;
			(global as any).context = (global as any).suite;
			(global as any).specify = (global as any).test;
			(global as any).beforeEach = (global as any).setup;
			(global as any).afterEach = (global as any).teardown;

			// Now require test files - they can use either TDD or BDD syntax
			files.forEach(f => {
				require(path.resolve(testsRoot, f));
			});

			try {
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
		}).catch(reject);
	});
}
