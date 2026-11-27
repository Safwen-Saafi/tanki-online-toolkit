// The game update check's full-screen interface (start.cmd opens it), in the look of the old-style picture maker (the shared
// terminal kit, scripts/tui.mjs). Home shows where things stand; a check builds the extension, gets the game's bundle, runs the
// injector on it and on the good copy and shows the report, each part opening to its full list; Game files lists the downloaded
// bundles to check, keep as the good copy or delete. The report itself comes from lib.mjs, the same as check.mjs prints.
// Arrow keys and Enter always work; the mouse works in terminals that report it (Windows Terminal does).
// Never commits. No dependencies (Node 18 or later).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    c,
    bigTitle,
    configure,
    draw,
    expand,
    finalNotes,
    firstRows,
    header,
    leaveScreen,
    line,
    menu,
    next,
    notice,
    openFile,
    quit,
    startInput,
} from '../tui.mjs';
import {
    Plain,
    classNameUsers,
    compare,
    currentBundleAddress,
    fetchBundle,
    filesUnder,
    knownGood,
    reportLines,
    runOnFile,
    saveKnownGood,
    saveReport,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const INJECTOR = path.join(ROOT, 'extension', 'js', 'injector.js');
// Local only (gitignored): the downloaded bundles and the good copy, and every check's report (for the coding agent to read).
const BUNDLES = path.join(HERE, 'bundles');
const REPORTS = path.join(HERE, 'reports');
const BUNDLE_NAME = /^main\.[\w.-]+\.js$/;
const BLIND_SPOT = 'Code only: it cannot see layout, looks, card data, hangar files or sounds. Look at the game too.';

configure({
    title: 'GAME UPDATE CHECK',
    label: 'Twizzy Toolkit',
    compact: ' TWIZZY TOOLKIT  ·  game update check',
    stepLine: (_step, title) => `${c.title}${title}${c.reset}`,
    help: `${c.blue}↑↓${c.grey} choose  ·  ${c.good}Enter${c.grey} confirm  ·  ${c.grey}or click  ·  ${c.bad}Ctrl+C${c.grey} quits${c.reset}`,
    stopped: 'Stopped. Nothing was saved unless the screen said so.',
    inputEnded: 'The input ended.',
});

// ---- where things stand ----

// The bundle the game loads today: looked up at start, by "Look up the game again" and by every live check (null with no
// internet). Only the play page is read for it, never the bundle.
let gameToday = null;
let gameTodayNote = 'not looked up yet';

function clock() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function setGameToday(address) {
    gameToday = address;
    gameTodayNote = `${address.name}  ${c.grey}looked up ${clock()}${c.reset}`;
}

async function lookUpGameToday() {
    try {
        setGameToday(await currentBundleAddress());
    } catch (e) {
        gameToday = null;
        gameTodayNote = `${e instanceof Plain ? 'unknown (could not reach the play page)' : 'unknown'}  ${c.grey}tried ${clock()}${c.reset}`;
    }
}

function megabytes(bytes) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

function day(date) {
    return date.toISOString().slice(0, 10);
}

// Whether the built injector is older than any source file: the check builds anyway, this only says why it will take longer.
function buildState() {
    if (!fs.existsSync(INJECTOR)) return `${c.warn}not built yet${c.reset} (it is built before each check)`;
    const built = fs.statSync(INJECTOR).mtimeMs;
    const newest = Math.max(...filesUnder(path.join(ROOT, 'src'), '.ts').map((file) => fs.statSync(file).mtimeMs));
    return newest > built ? `${c.warn}older than the source${c.reset} (it is built before each check)` : `${c.good}up to date${c.reset}`;
}

// The downloaded bundles, newest first: { name, file, size, time }.
function gameFiles() {
    if (!fs.existsSync(BUNDLES)) return [];
    return fs
        .readdirSync(BUNDLES)
        .filter((name) => BUNDLE_NAME.test(name))
        .map((name) => {
            const file = path.join(BUNDLES, name);
            const stat = fs.statSync(file);
            return { name, file, size: stat.size, time: stat.mtime };
        })
        .sort((a, b) => b.time - a.time);
}

function statusLines() {
    const good = knownGood(BUNDLES);
    const files = gameFiles();
    const total = files.reduce((sum, file) => sum + file.size, 0);
    return [
        line('', `${c.grey}Game today   ${c.reset}${gameTodayNote}`),
        line('', `${c.grey}Good copy    ${c.reset}${good === null ? `${c.warn}none yet${c.reset} (save one after a check where nothing broke)` : `${good.name}  ${c.grey}saved ${good.savedAt.slice(0, 10)}${c.reset}`}`),
        line('', `${c.grey}Extension    ${c.reset}${buildState()}`),
        line('', `${c.grey}Game files   ${c.reset}${files.length} downloaded${files.length > 0 ? ` (${megabytes(total)})` : ''}`),
        '',
    ];
}

// ---- the working screen ----

const MARK = { wait: `${c.grey}·${c.reset}`, run: `${c.warn}…${c.reset}`, done: `${c.good}✓${c.reset}`, fail: `${c.bad}✗${c.reset}` };

// A list of jobs drawn with their marks; set(at, state, note) redraws it.
function progress(title, labels) {
    const jobs = labels.map((label) => ({ label, state: 'wait', note: '' }));
    const show = () => {
        const rows = expand([...header(0, title), ...jobs.map((job) => line('', `${MARK[job.state]} ${job.label}${job.note === '' ? '' : `  ${c.grey}${job.note}${c.reset}`}`)), ''], 2);
        draw(rows);
    };
    show();
    return {
        set(at, state, note = '') {
            const job = jobs[at];
            if (job === undefined) return;
            job.state = state;
            job.note = note;
            show();
        },
    };
}

// Lets the screen draw before a long job that blocks Node (the build, a run of the injector).
const breathe = () => new Promise((resolve) => setImmediate(resolve));

function build() {
    // npm is a .cmd file on Windows, which only runs through a shell. Its output is kept for when it fails.
    const run = spawnSync('npm run build', { cwd: ROOT, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (run.status === 0) return null;
    const text = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').filter((row) => row.trim() !== '');
    return text.slice(-8);
}

// Builds, gets the bundle (the live game's when no file is given), runs the injector on it and on the good copy, and compares.
// Returns { file, name, good, result, sameAsGood } or null when a job failed (its screen was shown).
async function runCheck(file) {
    const labels = ['Build the extension', file === null ? 'Find and download the game\'s bundle' : 'Read the game file', 'Run the extension on it', 'Run the extension on the good copy', 'Compare'];
    const screen = progress(file === null ? 'Checking the live game' : `Checking ${path.basename(file)}`, labels);
    let at = 0;
    try {
        screen.set(0, 'run');
        await breathe();
        const failedBuild = build();
        if (failedBuild !== null) {
            screen.set(0, 'fail', 'the build failed');
            await notice([...header(0, 'The build failed'), line('', 'The check would test an old injector, so it stops here. The build said:'), ...failedBuild.map((row) => line(c.bad, `  ${row}`)), ''], 'Back');
            return null;
        }
        screen.set(0, 'done');

        at = 1;
        screen.set(1, 'run');
        let bundleFile = file;
        if (bundleFile === null) {
            const address = await currentBundleAddress();
            setGameToday(address);
            screen.set(1, 'run', `${address.name}, about 10 MB`);
            bundleFile = await fetchBundle(BUNDLES, address);
        } else if (!fs.existsSync(bundleFile)) {
            throw new Plain(`No file at ${bundleFile}.`);
        } else if (!BUNDLE_NAME.test(path.basename(bundleFile))) {
            throw new Plain(`${path.basename(bundleFile)} is not named like a game bundle (main.<hash>.js), so the extension would not take it.`);
        }
        const name = path.basename(bundleFile);
        screen.set(1, 'done', name);

        at = 2;
        screen.set(2, 'run');
        await breathe();
        const now = await runOnFile(INJECTOR, bundleFile, name);
        screen.set(2, 'done', `${now.hooked.length} hooks went in`);

        at = 3;
        const good = knownGood(BUNDLES);
        let before = null;
        if (good === null) {
            screen.set(3, 'done', 'no good copy yet: compared with the hooks in src/injector.ts');
        } else {
            screen.set(3, 'run', good.name);
            await breathe();
            before = await runOnFile(INJECTOR, good.file, good.name);
            screen.set(3, 'done', good.name);
        }

        at = 4;
        screen.set(4, 'run');
        await breathe();
        const nowText = fs.readFileSync(bundleFile, 'utf8');
        const goodText = good === null ? null : fs.readFileSync(good.file, 'utf8');
        const result = compare({ root: ROOT, now, good: before, nowText, goodText });
        const sameAsGood = goodText !== null && goodText === nowText;
        const report = saveReport(REPORTS, name, reportLines({ root: ROOT, name, good, result, sameAsGood }));
        screen.set(4, 'done');
        return { file: bundleFile, name, good, result, sameAsGood, report };
    } catch (e) {
        if (!(e instanceof Plain)) throw e;
        screen.set(at, 'fail');
        await notice([...header(0, 'The check could not finish'), line(c.bad, e.message), ''], 'Back');
        return null;
    }
}

// ---- the report ----

function verdictRows(broken) {
    if (broken === 0) return bigTitle('NOTHING BROKE', [c.good, c.good]);
    return bigTitle(`${broken} THING${broken === 1 ? '' : 'S'} BROKE`, [c.bad, c.bad]);
}

const tick = (ok) => (ok ? `${c.good}✓${c.reset}` : `${c.bad}✗${c.reset}`);

function partItems(result, hasGood) {
    const { hooks, warnings, code, classNames } = result;
    return [
        {
            label: `${tick(hooks.missing.length === 0)} Hooks        ${hooks.count} went in, ${hooks.missing.length === 0 ? 'none missing' : `${hooks.missing.length} missing`}`,
            detail: () => {
                const rows = [];
                if (hooks.missing.length === 0) {
                    rows.push(line(c.good, hasGood ? 'Every hook that went in on the good copy went in now.' : 'Every hook in src/injector.ts went in.'));
                } else {
                    rows.push(line('', hasGood ? 'Went in on the good copy, MISSING now:' : 'In src/injector.ts, MISSING now:'));
                    rows.push(...hooks.missing.map((name) => line(c.bad, `  ✗ ${name}`)));
                }
                if (hooks.neverIn.length > 0) {
                    rows.push('', line(c.warn, 'Missing on both (not a game change, but worth a look):'), ...hooks.neverIn.map((name) => line(c.warn, `  · ${name}`)));
                }
                if (hooks.changed.length > 0) {
                    rows.push('', line(c.grey, 'Changed counts:'), ...hooks.changed.map((ch) => line('', `  ${ch.name}: ${ch.before} before, ${ch.now} now`)));
                }
                return rows;
            },
        },
        {
            label: `${tick(warnings.length === 0)} Warnings     ${warnings.length === 0 ? 'none new' : `${warnings.length} new`}`,
            detail: () =>
                warnings.length === 0 ? [line(c.good, 'The extension warned about nothing new.')] : warnings.map((text) => line(c.bad, `  ✗ ${text}`)),
        },
        {
            label: `${tick(code === null)} Valid code   ${code === null ? 'the changed game code parses' : 'the changed game code does NOT parse'}`,
            detail: () =>
                code === null
                    ? [line(c.good, 'The game code with the extension\'s changes in it still parses (node --check).')]
                    : [line('', 'node --check said:'), ...code.split('\n').map((text) => line(c.bad, `  ${text}`))],
        },
        {
            label: `${tick(classNames.gone.length === 0)} Class names  ${classNames.count} used, ${classNames.gone.length === 0 ? 'none gone' : `${classNames.gone.length} gone`}`,
            detail: () => {
                const rows = [];
                if (classNames.gone.length === 0) rows.push(line(c.good, `All ${classNames.count} game class names our code and styles use are still in the game.`));
                for (const name of classNames.gone) {
                    rows.push(line(c.bad, `  ✗ ${name}`));
                    for (const user of classNameUsers(ROOT, name)) rows.push(line(c.grey, `      used in ${user.file}:${user.line}`));
                }
                if (classNames.neverIn.length > 0) {
                    rows.push('', line(c.warn, 'In neither game file (not a game change, but worth a look):'), ...classNames.neverIn.map((name) => line(c.warn, `  · ${name}`)));
                }
                return rows;
            },
        },
    ];
}

async function showPart(title, rows) {
    const room = Math.max(5, (process.stdout.rows ?? 30) - 14);
    await notice([...header(0, title), ...firstRows(rows, room, (hidden) => `... and ${hidden} more (the command line check.mjs prints them all)`), ''], 'Back to the report');
}

async function showReport(check) {
    const { name, good, result, sameAsGood, report } = check;
    const hasGood = good !== null;
    const parts = partItems(result, hasGood);
    let saved = false;
    let start = 0;
    for (;;) {
        const lines = [
            ...header(0, `Report: ${name}`),
            line(c.grey, hasGood ? `Compared with the good copy ${good.name} (saved ${good.savedAt.slice(0, 10)}).` : 'No good copy yet: compared with the hooks in src/injector.ts.'),
            ...(sameAsGood ? [line(c.grey, 'The game has not changed since the good copy.')] : []),
            '',
            ...verdictRows(result.broken),
            '',
        ];
        const items = parts.map((part) => ({ label: part.label }));
        const canSave = result.broken === 0 && !sameAsGood && !saved;
        const openAt = items.length;
        items.push({ label: 'Open the report file' });
        const saveAt = canSave ? items.length : -1;
        if (canSave) items.push({ label: `${c.good}Keep ${name} as the good copy${c.reset}` });
        items.push({ label: 'Back to the start' });
        const footer = [`Report saved: ${path.relative(ROOT, report)}`, BLIND_SPOT, ...(saved ? [`Saved ${name} as the good copy.`] : [])];
        const chosen = await menu({ lines, items, footer, start });
        start = chosen;
        if (chosen < parts.length) {
            await showPart(`${name}: ${['Hooks', 'Warnings', 'Valid code', 'Class names'][chosen]}`, parts[chosen].detail());
        } else if (chosen === openAt) {
            openFile(report);
        } else if (chosen === saveAt) {
            saveKnownGood(BUNDLES, check.file);
            finalNotes.push(`Saved ${name} as the good copy.`);
            saved = true;
            // The save line goes away, so the cursor lands on "Back to the start".
            start = openAt + 1;
        } else return;
    }
}

async function checkAndReport(file) {
    const check = await runCheck(file);
    if (check !== null) await showReport(check);
}

// ---- typing a path ----

// One line of text typed, pasted or dragged in; Enter on an empty line goes back (null).
async function askText(title, lines, prompt) {
    let text = '';
    for (;;) {
        const rows = expand([...header(0, title), ...lines, ''], 3);
        rows.push(`${c.accent}❯${c.reset} ${prompt}${c.title}${text}${c.reset}`);
        rows.push(line(c.grey, 'Enter confirms  ·  Enter on an empty line goes back'));
        draw(rows);
        const event = await next();
        if (event.type === 'char') text += event.ch;
        else if (event.type === 'paste') text += event.text.replace(/[\r\n]+/g, ' ');
        else if (event.type === 'key' && event.name === 'backspace') text = text.slice(0, -1);
        else if (event.type === 'key' && event.name === 'clear-line') text = '';
        else if (event.type === 'key' && event.name === 'enter') {
            // A dragged-in file arrives in quotes; those are taken off.
            const clean = text.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
            return clean === '' ? null : clean;
        }
    }
}

function fileLabel(file, good) {
    const marks = [];
    if (gameToday !== null && file.name === gameToday.name) marks.push(`${c.blue}game today${c.reset}`);
    if (good !== null && file.name === good.name) marks.push(`${c.good}good copy${c.reset}`);
    return `${file.name.padEnd(20)}  ${megabytes(file.size).padStart(8)}  ${day(file.time)}${marks.length > 0 ? `  ${marks.join(' · ')}` : ''}`;
}

async function checkAFile() {
    const files = gameFiles();
    const good = knownGood(BUNDLES);
    const items = [...files.map((file) => ({ label: fileLabel(file, good) })), { label: 'Type, paste or drag a path...' }, { label: 'Back' }];
    const chosen = await menu({ lines: [...header(0, 'Check a game file'), line('', 'Pick a downloaded game file, or give the path of another main.<hash>.js file.'), ''], items });
    if (chosen < files.length) return checkAndReport(files[chosen]?.file ?? null);
    if (chosen === files.length) {
        const typed = await askText('Check a game file', [line('', 'The path of a main.<hash>.js file (drag the file into this window to type its path).')], 'Path: ');
        if (typed !== null) await checkAndReport(path.resolve(typed));
    }
}

// ---- game files ----

async function oneFile(file) {
    for (;;) {
        const good = knownGood(BUNDLES);
        const isGood = good !== null && good.name === file.name;
        const lines = [
            ...header(0, file.name),
            line('', fileLabel(file, good)),
            ...(isGood ? [line(c.grey, 'This is the good copy. Deleting this file keeps the good copy (it is a separate copy, known-good.js).')] : []),
            '',
        ];
        const chosen = await menu({ lines, items: [{ label: 'Check this file' }, { label: 'Delete this file' }, { label: 'Back' }] });
        if (chosen === 0) {
            await checkAndReport(file.file);
            return;
        }
        if (chosen === 1) {
            const sure = await menu({
                lines: [
                    ...header(0, `Delete ${file.name}?`),
                    line('', `${file.name} (${megabytes(file.size)}) is removed from this computer.`),
                    line(c.grey, 'It can be downloaded again while the game still serves it.'),
                    '',
                ],
                items: [{ label: 'No, keep it' }, { label: `${c.bad}Yes, delete it${c.reset}` }],
            });
            if (sure === 1) {
                fs.rmSync(file.file, { force: true });
                return;
            }
            continue;
        }
        return;
    }
}

async function gameFilesScreen() {
    for (;;) {
        const files = gameFiles();
        const good = knownGood(BUNDLES);
        const lines = [
            ...header(0, 'Game files'),
            line('', files.length === 0 ? 'No game files downloaded yet. "Check the live game" downloads today\'s.' : `${files.length} downloaded, kept in scripts/game-update-check/bundles (never committed).`),
            line(c.grey, 'To make one the good copy, check it: the report offers it when nothing broke.'),
            '',
        ];
        const items = [...files.map((file) => ({ label: fileLabel(file, good) })), { label: 'Back' }];
        const chosen = await menu({ lines, items });
        const file = files[chosen];
        if (file === undefined) return;
        await oneFile(file);
    }
}

// ---- reports ----

// The saved reports, newest first (their names start with the date and time).
function reportFiles() {
    if (!fs.existsSync(REPORTS)) return [];
    return fs.readdirSync(REPORTS).filter((name) => name.endsWith('.txt')).sort().reverse();
}

async function reportsScreen() {
    const files = reportFiles();
    const shown = files.slice(0, 12);
    const lines = [
        ...header(0, 'Reports'),
        line('', files.length === 0 ? 'No reports yet: every check saves one.' : `${files.length} saved in scripts/game-update-check/reports (never committed).`),
        line(c.grey, 'Every check saves its report here, so the coding agent can read it. Enter opens one.'),
        ...(files.length > shown.length ? [line(c.grey, `The newest ${shown.length} are listed.`)] : []),
        '',
    ];
    for (;;) {
        const chosen = await menu({ lines, items: [...shown.map((name) => ({ label: name.replace(/\.txt$/, '') })), { label: 'Back' }] });
        const name = shown[chosen];
        if (name === undefined) return;
        openFile(path.join(REPORTS, name));
    }
}

// ---- help ----

async function help() {
    await notice(
        [
            ...header(0, 'Help'),
            line(c.title, 'What it does'),
            line('', 'It puts the extension\'s changes into the game\'s code the way Chrome does, but offline.'),
            line('', 'It does that on the new game code and on the good copy, then says what is different:'),
            line('', `  ${c.accent}1${c.reset} Hooks: changes that went in on the good copy and are missing now.`),
            line('', `  ${c.accent}2${c.reset} Warnings: what the extension complained about that is new.`),
            line('', `  ${c.accent}3${c.reset} Valid code: whether the changed game code still parses.`),
            line('', `  ${c.accent}4${c.reset} Class names: game class names our code and styles use that are gone.`),
            '',
            line(c.title, 'What it cannot see'),
            line('', 'It reads code only: not the page layout, the looks, the card data, the hangar files or sounds.'),
            line('', '"Nothing broke" means the changes still go in, not that everything works.'),
            line('', 'So look at the game too.'),
            '',
            line(c.title, 'From a terminal'),
            line('', `  ${c.blue}node scripts/game-update-check/check.mjs${c.reset}                   today's game`),
            line('', `  ${c.blue}... --bundle <file>${c.reset}  a game file   ${c.blue}--save-good${c.reset}  keep it when nothing broke`),
            line('', `  ${c.blue}... --injector <file>${c.reset}  check another built injector.js (an old one, to test)`),
            '',
            line(c.title, 'Reports'),
            line('', 'Every check saves its report in scripts/game-update-check/reports. To get a break fixed, tell'),
            line('', 'the coding agent: "read the latest report in scripts/game-update-check/reports and fix it".'),
            '',
        ],
        'Back',
    );
}

// ---- home ----

async function home() {
    let start = 0;
    for (;;) {
        const lines = [...header(0, 'What a game update broke, before you play'), ...statusLines()];
        const items = [
            { label: 'Check the live game' },
            { label: 'Check a game file' },
            { label: 'Look up the game again' },
            { label: 'Game files' },
            { label: 'Reports' },
            { label: 'Help' },
            { label: 'Quit' },
        ];
        const chosen = await menu({ lines, items, footer: [BLIND_SPOT], start });
        start = chosen;
        if (chosen === 0) await checkAndReport(null);
        else if (chosen === 1) await checkAFile();
        else if (chosen === 2) {
            draw(expand([...header(0, 'Looking up the game\'s bundle...'), ''], 0));
            await lookUpGameToday();
        } else if (chosen === 3) await gameFilesScreen();
        else if (chosen === 4) await reportsScreen();
        else if (chosen === 5) await help();
        else await quit('Bye.');
    }
}

async function main() {
    startInput();
    draw(expand([...header(0, 'Looking up the game\'s bundle...'), ''], 0));
    await lookUpGameToday();
    await home();
}

main().catch((error) => {
    leaveScreen();
    console.error(`[game-update-check] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    process.stdin.pause();
});
