// The game update check from the command line:
//   node scripts/game-update-check/check.mjs                  the game's bundle of today, downloaded into bundles/
//   node scripts/game-update-check/check.mjs --bundle <file>  a bundle file on the computer
//   add --save-good to save the checked bundle as the known-good one, when it passed
// Runs the extension's built injector on the bundle offline and prints which changes went in and what it warned about.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plain, currentBundleAddress, fetchBundle, knownGood, runInjector, saveKnownGood } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const INJECTOR = path.join(ROOT, 'extension', 'js', 'injector.js');
// Local only (gitignored): the downloaded bundles and the known-good copy.
const BUNDLES = path.join(HERE, 'bundles');

function argValue(name) {
    const at = process.argv.indexOf(name);
    return at === -1 ? null : process.argv[at + 1] ?? null;
}

async function main() {
    if (!fs.existsSync(INJECTOR)) throw new Plain('The extension is not built yet: run "npm run build" first.');
    let bundleFile = argValue('--bundle');
    if (bundleFile === null) {
        const address = await currentBundleAddress();
        console.log(`The game loads ${address.name} today.`);
        bundleFile = await fetchBundle(BUNDLES, address);
    } else if (!fs.existsSync(bundleFile)) {
        throw new Plain(`No file at ${bundleFile}.`);
    }
    const good = knownGood(BUNDLES);
    console.log(good === null ? 'No known-good bundle saved yet.' : `Known-good bundle: ${good.name} (saved ${good.savedAt.slice(0, 10)}).`);

    const run = await runInjector(INJECTOR, fs.readFileSync(bundleFile, 'utf8'), path.basename(bundleFile));
    if (run.failed !== null) throw new Plain(`The check itself failed (not the game): ${run.failed}`);
    console.log(`Hooks that went in (${run.hooked.length}):`);
    for (const hook of run.hooked) console.log(`  ${hook}`);
    console.log(`Warnings (${run.warnings.length}):`);
    for (const line of run.warnings) console.log(`  ${line}`);
    console.log(`Errors (${run.errors.length}):`);
    for (const line of run.errors) console.log(`  ${line}`);
    const passed = run.warnings.length + run.errors.length === 0;

    if (process.argv.includes('--save-good')) {
        if (!passed) {
            console.log('Not saved as known-good: this bundle has warnings or errors.');
        } else {
            const note = saveKnownGood(BUNDLES, bundleFile);
            console.log(`Saved ${note.name} as the known-good bundle.`);
        }
    }
    return passed ? 0 : 1;
}

try {
    process.exitCode = await main();
} catch (e) {
    if (!(e instanceof Plain)) throw e;
    console.log(e.message);
    process.exitCode = 1;
}
