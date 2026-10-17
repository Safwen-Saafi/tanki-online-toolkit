import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleFile } from './build.js';
import { countAugments, fileNameFor, rarityCounts } from './contract.js';

test('assembleFile keys each augment by its name, in page order', () => {
    const file = assembleFile(
        'RU',
        [
            { item: 'firebird', augments: [{ name: 'Адреналин', advantages: ['a'], disadvantages: [], rarity: 'rare' }] },
            { item: 'hulls', augments: [{ name: 'B', advantages: [], disadvantages: ['d'], rarity: null }] },
        ],
        '2026-10-01T05:30:00Z',
    );
    assert.equal(file.schemaVersion, 2);
    assert.equal(file.language, 'RU');
    assert.equal(file.generatedAt, '2026-10-01T05:30:00Z');
    assert.deepEqual(Object.keys(file.items), ['firebird', 'hulls']);
    assert.deepEqual(file.items['firebird']?.['Адреналин'], { name: 'Адреналин', advantages: ['a'], disadvantages: [], rarity: 'rare' });
    assert.equal(countAugments(file), 2);
});

test('file names follow the language', () => {
    assert.equal(fileNameFor('EN'), 'augments.en.json');
    assert.equal(fileNameFor('RU'), 'augments.ru.json');
});

test('rarityCounts counts each rank and the augments without one', () => {
    const file = assembleFile(
        'EN',
        [
            {
                item: 'vulcan',
                augments: [
                    { name: 'A', advantages: [], disadvantages: [], rarity: 'rare' },
                    { name: 'B', advantages: [], disadvantages: [], rarity: 'rare' },
                    { name: 'C', advantages: [], disadvantages: [], rarity: 'exotic' },
                    { name: 'D', advantages: [], disadvantages: [], rarity: null },
                ],
            },
        ],
        '2026-10-01T05:30:00Z',
    );
    assert.deepEqual(rarityCounts(file), { rare: 2, exotic: 1, none: 1 });
});
