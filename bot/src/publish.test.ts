import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SCHEMA_VERSION, fileNameFor, type Augment, type AugmentsFile, type ItemAugments, type Language } from './contract.js';
import { diffItems, parseAugmentsFile, publishAll, readPublished } from './publish.js';

function makeFile(language: Language, generatedAt: string, perItem = 10, tweak = ''): AugmentsFile {
    const items: Record<string, ItemAugments> = {};
    for (let item = 0; item < 12; item++) {
        const byName: Record<string, Augment> = {};
        for (let index = 0; index < perItem; index++) {
            const name = `item${item} augment ${index}`;
            byName[name] = { name, advantages: [`${name} advantage${tweak}`], disadvantages: [] };
        }
        items[`item${item}`] = byName;
    }
    return { schemaVersion: SCHEMA_VERSION, language, generatedAt, items };
}

function setup(): { out: string; published: string } {
    const root = mkdtempSync(join(tmpdir(), 'augments-bot-'));
    const out = join(root, 'out');
    const published = join(root, 'published');
    mkdirSync(out);
    return { out, published };
}

function writeOut(out: string, file: AugmentsFile): void {
    writeFileSync(join(out, fileNameFor(file.language)), `${JSON.stringify(file, null, 2)}\n`);
}

const both: readonly Language[] = ['EN', 'RU'];

test('first publish writes both files', () => {
    const { out, published } = setup();
    writeOut(out, makeFile('EN', '2026-10-01T05:00:00Z'));
    writeOut(out, makeFile('RU', '2026-10-01T05:00:00Z'));
    const results = publishAll(out, published, both);
    assert.deepEqual(results.map((result) => result.action), ['written', 'written']);
    assert.notEqual(readPublished(published, 'EN'), null);
    assert.notEqual(readPublished(published, 'RU'), null);
});

test('a second run with the same content writes nothing', () => {
    const { out, published } = setup();
    writeOut(out, makeFile('EN', '2026-10-01T05:00:00Z'));
    writeOut(out, makeFile('RU', '2026-10-01T05:00:00Z'));
    publishAll(out, published, both);
    const before = readFileSync(join(published, 'augments.en.json'), 'utf8');

    writeOut(out, makeFile('EN', '2026-10-02T05:00:00Z'));
    writeOut(out, makeFile('RU', '2026-10-02T05:00:00Z'));
    const results = publishAll(out, published, both);
    assert.deepEqual(results.map((result) => result.action), ['unchanged', 'unchanged']);
    assert.equal(readFileSync(join(published, 'augments.en.json'), 'utf8'), before);
});

test('a change in one language updates only that language', () => {
    const { out, published } = setup();
    writeOut(out, makeFile('EN', '2026-10-01T05:00:00Z'));
    writeOut(out, makeFile('RU', '2026-10-01T05:00:00Z'));
    publishAll(out, published, both);
    const ruBefore = readFileSync(join(published, 'augments.ru.json'), 'utf8');

    writeOut(out, makeFile('EN', '2026-10-02T05:00:00Z', 10, ' (patched)'));
    writeOut(out, makeFile('RU', '2026-10-02T05:00:00Z'));
    const results = publishAll(out, published, both);
    assert.deepEqual(results.map((result) => result.action), ['written', 'unchanged']);
    assert.equal(readFileSync(join(published, 'augments.ru.json'), 'utf8'), ruBefore);
    assert.equal(readPublished(published, 'EN')?.generatedAt, '2026-10-02T05:00:00Z');
    assert.ok(results[0]?.lines[0]?.includes('changed'));
});

test('a shrunken file is rejected and the published one is kept', () => {
    const { out, published } = setup();
    writeOut(out, makeFile('EN', '2026-10-01T05:00:00Z'));
    publishAll(out, published, ['EN']);
    const before = readFileSync(join(published, 'augments.en.json'), 'utf8');

    writeOut(out, makeFile('EN', '2026-10-02T05:00:00Z', 5));
    const [result] = publishAll(out, published, ['EN']);
    assert.equal(result?.action, 'rejected');
    assert.equal(readFileSync(join(published, 'augments.en.json'), 'utf8'), before);
});

test('a language with no new file is reported, not published', () => {
    const { out, published } = setup();
    writeOut(out, makeFile('EN', '2026-10-01T05:00:00Z'));
    const results = publishAll(out, published, both);
    assert.deepEqual(results.map((result) => result.action), ['written', 'no-new-file']);
});

test('diffItems names added, removed and changed augments per item', () => {
    const before = makeFile('EN', 'a', 3);
    const kept = before.items['item0']?.['item0 augment 1'];
    assert.ok(kept);
    const items: Record<string, ItemAugments> = { ...before.items };
    items['item0'] = {
        'item0 augment 0': { name: 'item0 augment 0', advantages: ['different'], disadvantages: [] },
        'item0 augment 1': kept,
        brand: { name: 'brand', advantages: [], disadvantages: [] },
    };
    const lines = diffItems(before, { ...before, items });
    assert.deepEqual(lines, ['item0: added brand; removed item0 augment 2; changed item0 augment 0']);
});

test('parseAugmentsFile rejects junk and a wrong language', () => {
    assert.equal(parseAugmentsFile('nope', 'EN'), null);
    assert.equal(parseAugmentsFile({ schemaVersion: 1, language: 'RU', generatedAt: 'x', items: {} }, 'EN'), null);
    assert.equal(parseAugmentsFile({ schemaVersion: 2, language: 'EN', generatedAt: 'x', items: {} }, 'EN'), null);
    assert.notEqual(parseAugmentsFile({ schemaVersion: 1, language: 'EN', generatedAt: 'x', items: {} }, 'EN'), null);
});

test('readPublished returns null for a missing or corrupt file', () => {
    const { published } = setup();
    assert.equal(readPublished(published, 'EN'), null);
    mkdirSync(published);
    writeFileSync(join(published, 'augments.en.json'), '{ not json');
    assert.equal(readPublished(published, 'EN'), null);
});
