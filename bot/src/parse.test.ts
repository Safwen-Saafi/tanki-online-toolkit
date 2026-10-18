import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parsePage } from './parse.js';

function fixture(name: string): string {
    return readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');
}

test('a normal augment: name, one advantage, two disadvantages', () => {
    const { augments, warnings } = parsePage(fixture('page-firebird-en.html'));
    const adrenaline = augments.find((augment) => augment.name === 'Adrenaline');
    assert.deepEqual(warnings, []);
    assert.ok(adrenaline);
    assert.deepEqual(adrenaline.advantages, ['Regular and critical damage: +25%']);
    assert.equal(adrenaline.disadvantages.length, 2);
    assert.equal(adrenaline.disadvantages[0], 'Damage bonus only activates when health is ≤35%');
});

test('nested sub-bullets are joined into their parent line', () => {
    const { augments } = parsePage(fixture('page-firebird-en.html'));
    const pulsar = augments.find((augment) => augment.name === 'Pulsar');
    assert.ok(pulsar);
    const first = pulsar.advantages[0];
    assert.ok(first);
    assert.match(first, /^Hitting an enemy with a critical shot will apply the following status effects: \{jammer\|Jammer\}: 3 sec; /);
    assert.match(first, /\{emp\|Electromagnetic Pulse\}: 1 sec; \{stun\|Stun\}: 0\.4 sec/);
    assert.equal(first.includes('\n'), false);
});

test('an augment with no disadvantages gives an empty list', () => {
    const { augments } = parsePage(fixture('page-hulls-en.html'));
    assert.equal(augments.length, 1);
    assert.equal(augments[0]?.name, 'Heat Resistance');
    assert.deepEqual(augments[0]?.disadvantages, []);
    assert.deepEqual(augments[0]?.advantages, [
        'Damage taken from {burning|Burning}: -50%',
        'Heating rate: -50%',
    ]);
});

test('the RU page parses the same way', () => {
    const { augments } = parsePage(fixture('page-firebird-ru.html'));
    assert.equal(augments.length, 1);
    assert.equal(augments[0]?.name, 'Адреналин');
    assert.equal(augments[0]?.advantages[0], 'Стандартный и критический урон: пушки ближнего боя: +25%');
});

test('a repeated name keeps the first and warns', () => {
    const html = fixture('page-hulls-en.html') + fixture('page-hulls-en.html');
    const { augments, warnings } = parsePage(html);
    assert.equal(augments.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? '', /duplicate augment name "Heat Resistance"/);
});

test('an unnamed container is skipped with a warning', () => {
    const { augments, warnings } = parsePage('<div class="device-container"><div class="device-header"></div></div>');
    assert.deepEqual(augments, []);
    assert.equal(warnings.length, 1);
});

test('html with no containers gives nothing', () => {
    assert.deepEqual(parsePage('<p>hello</p>'), { augments: [], warnings: [] });
});

test('each augment carries the rank of its block, in both languages', () => {
    const firebird = parsePage(fixture('page-firebird-en.html')).augments;
    assert.equal(firebird.find((augment) => augment.name === 'Adrenaline')?.rarity, 'rare');
    assert.equal(firebird.find((augment) => augment.name === 'Pulsar')?.rarity, 'legendary');
    assert.equal(parsePage(fixture('page-firebird-ru.html')).augments[0]?.rarity, 'rare');
    assert.equal(parsePage(fixture('page-hulls-en.html')).augments[0]?.rarity, 'rare');
});

test('a new rank word is published as it is', () => {
    const html = '<div class="device-container" data-rarity=" Exotic "><div class="device-header"><span class="name">Phoenix</span></div></div>';
    const { augments, warnings } = parsePage(html);
    assert.equal(augments[0]?.rarity, 'exotic');
    assert.deepEqual(warnings, []);
});

test('a missing rank gives null, an unusable one gives null and a warning', () => {
    const header = '<div class="device-header"><span class="name">A</span></div></div>';
    assert.equal(parsePage(`<div class="device-container">${header}`).augments[0]?.rarity, null);
    const odd = parsePage(`<div class="device-container" data-rarity="rare; drop table">${header}`);
    assert.equal(odd.augments[0]?.rarity, null);
    assert.equal(odd.warnings.length, 1);
    assert.match(odd.warnings[0] ?? '', /unusable rarity/);
});

test('a known effect icon becomes a {key} marker, in both languages', () => {
    const english = parsePage(fixture('page-firebird-en.html')).augments;
    const adrenaline = english.find((augment) => augment.name === 'Adrenaline');
    assert.equal(adrenaline?.disadvantages[1], 'Effect is disabled when the tank has the {freeze|Freezing} status effect.');
    const pulsar = english.find((augment) => augment.name === 'Pulsar');
    assert.match(pulsar?.advantages[0] ?? '', /\{armor_piercing\|Armor-Piercing\}: 1\.5 sec$/);
    const russian = parsePage(fixture('page-firebird-ru.html')).augments[0];
    assert.equal(russian?.disadvantages[1], 'Эффект деактивируется при попадании под воздействие статус-эффекта {freeze} «Заморозка»');
});

test('the info icon is dropped quietly and an unknown icon is dropped with one warning', () => {
    const card = (icons: string): string =>
        `<div class="device-container" data-rarity="rare"><div class="device-header"><span class="name">A</span></div><div class="device-stats"><ul><li>Value ${icons} here</li></ul></div></div>`;
    const info = parsePage(card('<img src="/images/en/e/e2/Icon_info.png">'));
    assert.deepEqual(info.warnings, []);
    assert.equal(info.augments[0]?.advantages[0], 'Value here');
    const unknown = parsePage(card('<img src="/images/x/20px-Icon_Mystery.png"><img src="/images/x/Icon_Mystery.png">'));
    assert.equal(unknown.augments[0]?.advantages[0], 'Value here');
    assert.deepEqual(unknown.warnings, ['unknown icon "icon_mystery" in the text was dropped']);
});

test('the name linked right after an icon rides in the marker, a plain name after it does not', () => {
    const icon = '<span typeof="mw:File"><span><img src="/images/en/thumb/0/0a/Icon_Freeze.png/30px-Icon_Freeze.png"></span></span>';
    const card = (body: string): string =>
        `<div class="device-container" data-rarity="rare"><div class="device-header"><span class="name">A</span></div><div class="device-stats"><ul><li>${body}</li></ul></div></div>`;
    const linked = parsePage(card(`Has the ${icon} <a href="/Freezing" title="Freezing">Freezing</a> effect and <a href="/x">a link</a>.`));
    assert.equal(linked.augments[0]?.advantages[0], 'Has the {freeze|Freezing} effect and a link.');
    const plain = parsePage(card(`Has the ${icon} «Заморозка» effect.`));
    assert.equal(plain.augments[0]?.advantages[0], 'Has the {freeze} «Заморозка» effect.');
    const odd = parsePage(card(`Has the ${icon}<a href="/x">Fre{e}|ze</a> effect.`));
    assert.equal(odd.augments[0]?.advantages[0], 'Has the {freeze|Freeze} effect.');
});
