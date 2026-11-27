// The game update check's menu (start.cmd opens it): a few numbered choices, each one a run of check.mjs, so the menu and the
// command line always give the same report. Before a check it builds the extension, so the injector checked is the current one.
// Never commits. No dependencies (Node 18 or later).
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CHECK = path.join(HERE, 'check.mjs');

// The build and the check never read the keyboard: only the menu does.
const OUTPUT_ONLY = ['ignore', 'inherit', 'inherit'];

// What choice 3 saves: the arguments of the last check (none for the live game, --bundle <file> for a file), or null.
let lastChecked = null;

function build() {
    console.log('\nBuilding the extension (npm run build)...');
    // npm is a .cmd file on Windows, which only runs through a shell.
    const run = spawnSync('npm run build', { cwd: ROOT, stdio: OUTPUT_ONLY, shell: true });
    if (run.status !== 0) console.log('The build failed, so the check would test an old injector. Fix the build first.');
    return run.status === 0;
}

function check(args) {
    console.log('');
    spawnSync(process.execPath, [CHECK, ...args], { cwd: ROOT, stdio: OUTPUT_ONLY });
}

// A dragged-in file arrives in quotes; those are taken off.
function cleanPath(text) {
    return text.trim().replace(/^"(.*)"$/, '$1');
}

async function main() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Ctrl+C or the end of the input closes the menu instead of leaving it waiting for an answer that never comes.
    let closed = false;
    const ended = new Promise((resolve) => rl.once('close', () => {
        closed = true;
        resolve(null);
    }));
    const ask = (text) => (closed ? Promise.resolve(null) : Promise.race([rl.question(text), ended]));
    for (;;) {
        console.log('\n=== Game update check ===');
        console.log('1  Check the live game now');
        console.log('2  Check a bundle file (main.<hash>.js)');
        console.log(`3  Save the last checked bundle as known-good${lastChecked === null ? ' (check one first)' : ''}`);
        console.log('0  Quit');
        const answer = await ask('> ');
        if (answer === null) break;
        const choice = answer.trim();
        if (choice === '0') break;
        if (choice === '1') {
            if (!build()) continue;
            lastChecked = [];
            check(lastChecked);
        } else if (choice === '2') {
            const answer = await ask('Path of the bundle file (or drag it here): ');
            if (answer === null) break;
            const file = cleanPath(answer);
            if (file === '') continue;
            if (!build()) continue;
            lastChecked = ['--bundle', file];
            check(lastChecked);
        } else if (choice === '3') {
            if (lastChecked === null) {
                console.log('Check a bundle first (1 or 2).');
                continue;
            }
            // Checked again with the same injector: it is saved only when nothing broke.
            check([...lastChecked, '--save-good']);
        } else {
            if (choice !== '') console.log('Type 1, 2, 3 or 0.');
        }
    }
    rl.close();
}

await main();
