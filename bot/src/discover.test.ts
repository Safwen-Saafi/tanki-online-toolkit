import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseHub } from './discover.js';

function fixture(name: string): string {
    return readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');
}

test('EN hub: 18 items, main-namespace titles', () => {
    const entries = parseHub(fixture('hub-en.txt'));
    assert.equal(entries.length, 18);
    assert.deepEqual(entries[0], { item: 'firebird', title: 'Augments/Firebird' });
    assert.deepEqual(entries[17], { item: 'hulls', title: 'Augments/Hulls' });
});

test('RU hub: 18 items, template-namespace titles', () => {
    const entries = parseHub(fixture('hub-ru.txt'));
    assert.equal(entries.length, 18);
    assert.deepEqual(entries[0], { item: 'firebird', title: 'Template:Устройства/Огнемёт' });
    assert.deepEqual(entries[17], { item: 'hulls', title: 'Template:Устройства для корпусов' });
});

test('EN and RU hubs use the same item slugs in the same order', () => {
    const en = parseHub(fixture('hub-en.txt')).map((entry) => entry.item);
    const ru = parseHub(fixture('hub-ru.txt')).map((entry) => entry.item);
    assert.deepEqual(en, ru);
});

test('a repeated item slug keeps the first entry', () => {
    const text = [
        '{{AugmentSwitcher|item=tesla|augments={{:Augments/Tesla}}}}',
        '{{AugmentSwitcher|item=tesla|augments={{:Augments/Other}}}}',
    ].join('\n');
    assert.deepEqual(parseHub(text), [{ item: 'tesla', title: 'Augments/Tesla' }]);
});

test('a hub with no switchers gives no entries', () => {
    assert.deepEqual(parseHub('just some text'), []);
});
