import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCHEMA_VERSION, type Augment, type AugmentsFile, type ItemAugments } from './contract.js';
import { validateFile } from './validate.js';

function augment(name: string): Augment {
    return { name, advantages: [`${name} advantage`], disadvantages: [] };
}

function makeFile(counts: Record<string, number>): AugmentsFile {
    const items: Record<string, ItemAugments> = {};
    for (const [item, count] of Object.entries(counts)) {
        const byName: Record<string, Augment> = {};
        for (let index = 0; index < count; index++) {
            const name = `${item} augment ${index}`;
            byName[name] = augment(name);
        }
        items[item] = byName;
    }
    return { schemaVersion: SCHEMA_VERSION, language: 'EN', generatedAt: '2026-10-01T05:30:00Z', items };
}

const bigCounts = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`item${index}`, 10]));

test('a healthy first-run file passes', () => {
    assert.deepEqual(validateFile(makeFile(bigCounts), null), []);
});

test('first run: too few items or augments fails the floor', () => {
    const problems = validateFile(makeFile({ firebird: 5, freeze: 5 }), null);
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /only 2 items/);
    assert.match(problems[1] ?? '', /only 10 augments/);
});

test('an item with no augments fails', () => {
    const problems = validateFile(makeFile({ ...bigCounts, empty: 0 }), null);
    assert.ok(problems.some((problem) => problem === 'item "empty" has no augments'));
});

test('an empty augment name fails', () => {
    const file = makeFile(bigCounts);
    const broken: AugmentsFile = { ...file, items: { ...file.items, item0: { '': augment('') } } };
    const problems = validateFile(broken, null);
    assert.ok(problems.some((problem) => problem.includes('empty name')));
});

test('a key that does not match the augment name fails', () => {
    const file = makeFile(bigCounts);
    const broken: AugmentsFile = { ...file, items: { ...file.items, item0: { wrong: augment('right') } } };
    assert.ok(validateFile(broken, null).some((problem) => problem.includes('does not match name')));
});

test('an empty advantage line fails', () => {
    const file = makeFile(bigCounts);
    const bad: Augment = { name: 'x', advantages: ['  '], disadvantages: [] };
    const broken: AugmentsFile = { ...file, items: { ...file.items, item0: { x: bad } } };
    assert.ok(validateFile(broken, null).some((problem) => problem.includes('empty line')));
});

test('against a published file: a small change passes', () => {
    const published = makeFile(bigCounts);
    const next = makeFile({ ...bigCounts, item0: 9 });
    assert.deepEqual(validateFile(next, published), []);
});

test('against a published file: a drop of more than 10% fails', () => {
    const published = makeFile(bigCounts);
    const next = makeFile(Object.fromEntries(Object.keys(bigCounts).map((item) => [item, 8])));
    const problems = validateFile(next, published);
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /fell from 120 to 96/);
});

test('against a published file: a vanished item fails', () => {
    const published = makeFile(bigCounts);
    const { item11: _removed, ...rest } = bigCounts;
    const next = makeFile({ ...rest, item0: 20 });
    const problems = validateFile(next, published);
    assert.ok(problems.some((problem) => problem.includes('item "item11" is published but missing')));
});

test('with a published file the first-run floor does not apply', () => {
    const published = makeFile({ firebird: 5 });
    assert.deepEqual(validateFile(makeFile({ firebird: 5 }), published), []);
});
