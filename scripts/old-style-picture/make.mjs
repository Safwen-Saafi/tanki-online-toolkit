// The command-line version of the old-style picture maker (wizard.mjs is the friendly one, with a menu).
// Makes the old-style picture of an augment that has no old file (one the devs added after they changed the pictures): takes the
// augment's new picture, replaces its background gradient with the one of an old picture that has the colour wanted (--like),
// and saves the result in extension/old_pictures/ and its stable path in extension/data/old_pictures.json.
// After that: npm run build is not needed (no TypeScript changed), just reload the extension.
//
//   node scripts/old-style-picture/make.mjs <picture address> --like <old picture> [--from-file <new.svg>] [--force] [--dry-run]
//   node scripts/old-style-picture/make.mjs --list-colors
//
// No dependencies. See README.md in this folder.
import fs from 'node:fs';
import path from 'node:path';
import * as lib from './lib.mjs';

function fail(message) {
    console.error(`[old-style-picture] ${message}`);
    process.exit(1);
}

function readArguments(argv) {
    const options = { address: null, like: null, fromFile: null, force: false, dryRun: false, listColors: false };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--like') options.like = argv[++index] ?? fail('--like needs an old picture');
        else if (argument === '--from-file') options.fromFile = argv[++index] ?? fail('--from-file needs a file');
        else if (argument === '--force') options.force = true;
        else if (argument === '--dry-run') options.dryRun = true;
        else if (argument === '--list-colors') options.listColors = true;
        else if (argument.startsWith('--')) fail(`unknown option ${argument}`);
        else if (options.address === null) options.address = argument;
        else fail(`unexpected argument ${argument}`);
    }
    return options;
}

async function main() {
    const options = readArguments(process.argv.slice(2));
    if (options.listColors) {
        for (const group of lib.colorGroups()) {
            console.log(`${String(group.count).padStart(4)} pictures  ${group.colors}   e.g. --like ${group.example}`);
        }
        return;
    }
    if (options.address === null) fail('give the new picture address (the game\'s own address, ending in image.svg), or --list-colors');
    if (options.like === null) fail('give --like <an old picture with the background colour wanted> (run --list-colors to see them)');

    const stablePath = lib.stablePathOf(options.address);
    const name = lib.fileNameOf(stablePath);
    const keys = lib.readList();
    if (keys.includes(stablePath) && !options.force) {
        fail(`${stablePath} already has an old picture (${name}); the real old file is kept. Use --force to replace it`);
    }

    const likeFile = lib.resolveOldPicture(options.like);
    const newSvg = options.fromFile !== null ? fs.readFileSync(options.fromFile, 'utf8') : await lib.downloadNewPicture(options.address);
    const result = lib.recolor(newSvg, fs.readFileSync(likeFile, 'utf8'));
    if (options.dryRun) {
        console.log(`[old-style-picture] dry run: would write extension/old_pictures/${name} and add ${stablePath} to the list`);
        return;
    }
    fs.writeFileSync(path.join(lib.PICTURES_DIR, name), result);
    lib.writeList([...keys, stablePath]);
    console.log(`[old-style-picture] wrote extension/old_pictures/${name} and added ${stablePath} to extension/data/old_pictures.json`);
    console.log('[old-style-picture] reload the extension on chrome://extensions and the game to see it');
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
