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
import { Plain, classNameIn, currentBundleAddress, fetchBundle, hookName, knownGood, ourClassNames, runInjector, saveKnownGood, sourceHooks, syntaxProblem } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BUILT_INJECTOR = path.join(ROOT, 'extension', 'js', 'injector.js');
const INJECTOR_SOURCE = path.join(ROOT, 'src', 'injector.ts');
// Local only (gitignored): the downloaded bundles and the known-good copy.
const BUNDLES = path.join(HERE, 'bundles');
const BLIND_SPOT =
    'This check reads code only. It cannot see page layout, how things look, the game\'s card data, the hangar files or sounds, so look at the game too.';

function argValue(name) {
    const at = process.argv.indexOf(name);
    return at === -1 ? null : process.argv[at + 1] ?? null;
}

// The bundle's real name is passed on: the injector only takes a tag whose address holds "/static/js/main.".
async function runOn(injector, file, name) {
    const run = await runInjector(injector, fs.readFileSync(file, 'utf8'), name);
    if (run.failed !== null) throw new Plain(`The check itself failed on ${name} (not the game): ${run.failed}`);
    return run;
}

function list(lines) {
    for (const line of lines) console.log(`   - ${line}`);
}

// Prints the report and returns how many things broke.
function report(now, good, nowText, goodText) {
    let broken = 0;
    const nowNames = new Set(now.hooked.map(hookName));

    // 1. Hooks: against the known-good run, or against every hook in our source when there is none yet.
    const expected = good !== null ? good.hooked.map(hookName) : sourceHooks(INJECTOR_SOURCE);
    const missing = expected.filter((name) => !nowNames.has(name));
    console.log(`\n1. Hooks: ${now.hooked.length} went in.`);
    if (missing.length === 0) {
        console.log(good !== null ? '   None missing: every hook that went in on the known-good bundle went in now.' : '   None missing: every hook in src/injector.ts went in.');
    } else {
        console.log(good !== null ? '   Went in on the known-good bundle, MISSING now:' : '   In src/injector.ts, MISSING now:');
        list(missing);
        broken += missing.length;
    }
    if (good !== null) {
        const neverIn = sourceHooks(INJECTOR_SOURCE).filter((name) => !nowNames.has(name) && !good.hooked.some((h) => hookName(h) === name));
        if (neverIn.length > 0) {
            console.log('   Missing on both bundles (not a game change, but worth a look):');
            list(neverIn);
        }
        for (const hook of now.hooked) {
            const before = good.hooked.find((h) => hookName(h) === hookName(hook));
            if (before !== undefined && before !== hook) console.log(`   ${hookName(hook)}: "${before.slice(hookName(before).length).trim()}" before, "${hook.slice(hookName(hook).length).trim()}" now.`);
        }
    }

    // 2. Warnings and errors the injector printed on the new bundle and not on the known-good one.
    const seen = new Set(good !== null ? [...good.warnings, ...good.errors] : []);
    const fresh = [...now.warnings, ...now.errors].filter((line) => !seen.has(line));
    console.log(`\n2. Warnings: ${fresh.length === 0 ? 'none new.' : `${fresh.length} new:`}`);
    list(fresh);
    broken += fresh.length;

    // 3. The patched bundle is still code the browser can read.
    const problem = syntaxProblem(now.patchedCode);
    console.log(`\n3. Valid code: ${problem === null ? 'the patched bundle parses.' : 'the patched bundle does NOT parse:'}`);
    if (problem !== null) {
        list(problem.split('\n'));
        broken += 1;
    }

    // 4. The game class names our code and stylesheets use: gone from the new bundle while the known-good one had them (or,
    // with no known-good yet, not in the new bundle at all).
    const names = ourClassNames(ROOT);
    const gone = names.filter((name) => !classNameIn(nowText, name) && (goodText === null || classNameIn(goodText, name)));
    console.log(`
4. Class names: ${names.length} used by our code and styles, ${gone.length === 0 ? 'none gone.' : `${gone.length} gone:`}`);
    list(gone);
    broken += gone.length;
    if (goodText !== null) {
        const neverIn = names.filter((name) => !classNameIn(nowText, name) && !classNameIn(goodText, name));
        if (neverIn.length > 0) {
            console.log('   Not in either bundle (not a game change, but worth a look):');
            list(neverIn);
        }
    }
    return broken;
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
    if (good === null) {
        console.log(`Checking ${path.basename(bundleFile)}. No known-good bundle is saved yet, so it is checked against the hooks in src/injector.ts.`);
    } else {
        console.log(`Checking ${path.basename(bundleFile)} against the known-good ${good.name} (saved ${good.savedAt.slice(0, 10)}).`);
        if (fs.readFileSync(good.file).equals(fs.readFileSync(bundleFile))) console.log('The game has not changed since the known-good bundle.');
    }
    if (injector !== BUILT_INJECTOR) console.log(`Injector: ${injector}`);

    const now = await runOn(injector, bundleFile, path.basename(bundleFile));
    const before = good === null ? null : await runOn(injector, good.file, good.name);
    const broken = report(now, before, fs.readFileSync(bundleFile, 'utf8'), good === null ? null : fs.readFileSync(good.file, 'utf8'));

    console.log(`\n${broken === 0 ? 'Nothing broke that this check can see.' : `${broken} thing${broken === 1 ? '' : 's'} broke.`}`);
    console.log(BLIND_SPOT);

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
