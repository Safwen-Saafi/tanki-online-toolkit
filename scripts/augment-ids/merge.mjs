// Merges the files saved by capture.js (augment-ids-EN.json, augment-ids-RU.json) into extension/data/augment_ids.json, the list the
// extension uses to name the augments in the battle tab (build-plan 18d). Every line of a capture is checked first; a capture with a
// bad line is refused and nothing is written. Prints what is new or changed. Never commits.
//
//   node scripts/augment-ids/merge.mjs <capture.json> [<capture.json> ...] [--dry-run]
//
// No dependencies. See README.md in this folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIST = path.join(ROOT, 'extension', 'data', 'augment_ids.json');
const LANGUAGES = ['EN', 'RU'];
const NUMBER = /^\d{1,20}$/;
const MAX_NAME = 200;
// The game's number of each turret (the item its augments belong to), read from the game script on 2026-11-08; the battle tab's
// turret colours use the same numbers (extension/styles/battle_tab.css). Any other item is a hull, and every hull's augments are
// under "hulls" in the augment data.
const TURRETS = {
    '920009630983': 'firebird', '920009631074': 'freeze', '920009630913': 'isida', '921009714084': 'tesla',
    '920009631046': 'hammer', '920009630997': 'twins', '920009631088': 'ricochet', '920009630969': 'smoky',
    '920009630990': 'striker', '920009631144': 'vulcan', '920009631123': 'thunder', '1931009780251': 'tsunami',
    '931009771122': 'scorpion', '920009631011': 'railgun', '920009630976': 'magnum', '920009631151': 'gauss',
    '920009631158': 'shaft',
};
const ITEMS = new Set([...Object.values(TURRETS), 'hulls']);

function fail(message) {
    console.error(`[augment-ids] ${message}`);
    process.exit(1);
}

function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isName(value) {
    return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_NAME && !/[\u0000-\u001f]/.test(value);
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return fail(`${file} cannot be read as JSON: ${e instanceof Error ? e.message : e}`);
    }
}

function readCapture(file) {
    const data = readJson(file);
    if (!isRecord(data) || data.kind !== 'kasp-augment-capture') fail(`${file} is not a file saved by capture.js`);
    if (!LANGUAGES.includes(data.language)) fail(`${file}: the language must be EN or RU`);
    if (!isRecord(data.devices)) fail(`${file}: no augments in it`);
    const devices = Object.entries(data.devices);
    if (devices.length === 0) fail(`${file}: no augments in it`);
    for (const [id, value] of devices) {
        if (!NUMBER.test(id) || !Array.isArray(value) || value.length !== 2 || !NUMBER.test(String(value[0])) || !isName(value[1])) {
            fail(`${file}: the line for ${JSON.stringify(id)} is not a number, an item number and a name; nothing was written`);
        }
    }
    return { file, language: data.language, devices };
}

function readList() {
    if (!fs.existsSync(LIST)) return { schemaVersion: 1, augments: {} };
    const data = readJson(LIST);
    if (!isRecord(data) || data.schemaVersion !== 1 || !isRecord(data.augments)) fail(`${LIST} is not a list this script wrote`);
    return data;
}

function byNumber(a, b) {
    const x = BigInt(a), y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

function main() {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const files = argv.filter((a) => a !== '--dry-run');
    if (files.length === 0) fail('give the capture files: node scripts/augment-ids/merge.mjs <augment-ids-EN.json> <augment-ids-RU.json>');
    const captures = files.map(readCapture);
    const list = readList();
    const augments = { ...list.augments };

    for (const capture of captures) {
        let added = 0, named = 0, renamed = 0, same = 0, moved = 0;
        const hulls = new Set();
        for (const [id, [itemNumber, name]] of capture.devices) {
            const item = TURRETS[String(itemNumber)] ?? 'hulls';
            if (item === 'hulls') hulls.add(String(itemNumber));
            const entry = isRecord(augments[id]) ? { ...augments[id] } : {};
            if (entry.item === undefined) added++;
            else if (entry.item !== item) moved++;
            if (entry[capture.language] === undefined) named++;
            else if (entry[capture.language] !== name) renamed++;
            else same++;
            entry.item = item;
            entry[capture.language] = name;
            augments[id] = entry;
        }
        const captured = new Set(capture.devices.map(([id]) => id));
        const missing = Object.keys(augments).filter((id) => !captured.has(id)).length;
        console.log(`[augment-ids] ${path.basename(capture.file)} (${capture.language}): ${capture.devices.length} augments, ${added} new, `
            + `${named} ${capture.language} names added, ${renamed} renamed, ${moved} moved to another item, ${same} unchanged; `
            + `${hulls.size} hull items; ${missing} in the list but not in this capture`);
    }

    for (const [id, entry] of Object.entries(augments)) {
        if (!ITEMS.has(entry.item)) fail(`the list line ${id} has the unknown item ${JSON.stringify(entry.item)}`);
        for (const language of LANGUAGES) {
            if (entry[language] !== undefined && !isName(entry[language])) fail(`the list line ${id} has a bad ${language} name`);
        }
    }
    const lacking = LANGUAGES.map((language) => `${Object.values(augments).filter((e) => e[language] === undefined).length} without ${language}`);
    const sorted = Object.fromEntries(Object.keys(augments).sort(byNumber).map((id) => [id, augments[id]]));
    const text = `${JSON.stringify({ schemaVersion: 1, augments: sorted }, null, 2)}\n`;
    if (fs.existsSync(LIST) && fs.readFileSync(LIST, 'utf8') === text) {
        console.log(`[augment-ids] nothing new: ${Object.keys(sorted).length} augments (${lacking.join(', ')})`);
        return;
    }
    if (dryRun) {
        console.log(`[augment-ids] dry run, nothing written: the list would hold ${Object.keys(sorted).length} augments (${lacking.join(', ')})`);
        return;
    }
    fs.writeFileSync(LIST, text);
    console.log(`[augment-ids] written ${path.relative(ROOT, LIST)}: ${Object.keys(sorted).length} augments (${lacking.join(', ')})`);
}

main();
