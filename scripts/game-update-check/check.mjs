// The game update check from the command line:
//   node scripts/game-update-check/check.mjs                  the game's bundle of today, downloaded into bundles/
//   node scripts/game-update-check/check.mjs --bundle <file>  a bundle file on the computer
//   --save-good          save the checked bundle as the known-good one, when nothing broke
//   --injector <file>    run another built injector.js instead of extension/js/injector.js
// Runs the extension's built injector on the new bundle and on the known-good one, offline, and says what broke in between.
// Both go through the same injector, so a change in our own code never shows up as a game change.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Plain, compare, currentBundleAddress, fetchBundle, knownGood, reportLines, runOnFile, saveKnownGood, saveReport } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BUILT_INJECTOR = path.join(ROOT, 'extension', 'js', 'injector.js');
// Local only (gitignored): the downloaded bundles and the known-good copy, and every check's report.
const BUNDLES = path.join(HERE, 'bundles');
const REPORTS = path.join(HERE, 'reports');

function argValue(name) {
    const at = process.argv.indexOf(name);
    return at === -1 ? null : process.argv[at + 1] ?? null;
}

async function main() {
    const injector = argValue('--injector') ?? BUILT_INJECTOR;
    if (!fs.existsSync(injector)) {
        throw new Plain(injector === BUILT_INJECTOR ? 'The extension is not built yet: run "npm run build" first.' : `No injector at ${injector}.`);
    }
    let bundleFile = argValue('--bundle');
    if (bundleFile === null) {
        const address = await currentBundleAddress();
        console.log(`The game loads ${address.name} today.`);
        bundleFile = await fetchBundle(BUNDLES, address);
    } else if (!fs.existsSync(bundleFile)) {
        throw new Plain(`No file at ${bundleFile}.`);
    }
    const good = knownGood(BUNDLES);
    const name = path.basename(bundleFile);
    const now = await runOnFile(injector, bundleFile, name);
    const before = good === null ? null : await runOnFile(injector, good.file, good.name);
    const nowText = fs.readFileSync(bundleFile, 'utf8');
    const goodText = good === null ? null : fs.readFileSync(good.file, 'utf8');
    const result = compare({ root: ROOT, now, good: before, nowText, goodText });
    const broken = result.broken;
    const lines = reportLines({ root: ROOT, name, good, result, sameAsGood: goodText === nowText, injector: injector === BUILT_INJECTOR ? null : injector });
    for (const text of lines) console.log(text);
    console.log(`Report saved: ${path.relative(ROOT, saveReport(REPORTS, name, lines))}`);

    if (process.argv.includes('--save-good')) {
        if (broken > 0) {
            console.log('Not saved as known-good: something broke.');
        } else {
            const note = saveKnownGood(BUNDLES, bundleFile);
            console.log(`Saved ${note.name} as the known-good bundle.`);
        }
    }
    return broken === 0 ? 0 : 1;
}

try {
    process.exitCode = await main();
} catch (e) {
    if (!(e instanceof Plain)) throw e;
    console.log(e.message);
    process.exitCode = 1;
}
