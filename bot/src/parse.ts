import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import { isTag, isText, type AnyNode, type Element } from 'domhandler';
import { EFFECT_ICONS, IGNORED_ICONS, RARITY_PATTERN, type Augment } from './contract.js';

export interface ParseResult {
    readonly augments: Augment[];
    readonly warnings: string[];
}

export function normalizeText(text: string): string {
    return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// "Icon_Freeze.png" or "30px-Icon_Freeze.png" in an image address becomes "icon_freeze".
function iconKey(src: string): string {
    let file = src.split('/').pop() ?? '';
    try {
        file = decodeURIComponent(file);
    } catch {
        // a broken escape keeps the raw name, which then simply matches nothing
    }
    return file.toLowerCase().replace(/^\d+px-/, '').replace(/\.[a-z0-9]+$/, '');
}

// The wiki links the effect's name right after its icon (and draws links green), so that name travels inside
// the marker as {key|Name}. An effect named in plain text after its icon (the Russian pages) stays plain text.
function linkedNameAfter($: cheerio.CheerioAPI, icon: Cheerio<AnyNode>): string {
    let next = icon.get(0)?.next ?? null;
    const gap: AnyNode[] = [];
    while (next !== null && isText(next) && next.data.trim() === '') {
        gap.push(next);
        next = next.next;
    }
    if (next === null || !isTag(next) || next.name !== 'a') return '';
    const name = normalizeText($(next).text()).replace(/[{}|]/g, '');
    // The marker stands for the icon and the name, so the space between them must not stay behind.
    $(next).remove();
    for (const node of gap) $(node).remove();
    return name;
}

// The bullet's own text, with each known effect icon turned into {key} or {key|Name} and every other image dropped.
function ownText($: cheerio.CheerioAPI, item: Cheerio<Element>, unknownIcons: Set<string>): string {
    const copy = item.clone();
    copy.children('ul').remove();
    copy.find('img').each((_, image) => {
        const key = iconKey($(image).attr('src') ?? '');
        const effect = EFFECT_ICONS[key];
        // The image sits inside a file wrapper; the wrapper is what stands next to the link.
        const wrapper = $(image).closest('span[typeof="mw:File"]');
        const target = wrapper.length > 0 ? wrapper : $(image);
        if (effect === undefined) {
            if (!IGNORED_ICONS.includes(key)) unknownIcons.add(key);
            target.remove();
            return;
        }
        const name = linkedNameAfter($, target);
        target.replaceWith(name === '' ? ` {${effect}} ` : `{${effect}|${name}}`);
    });
    return normalizeText(copy.text());
}

// A bullet with sub-bullets (for example "applies these status effects:" followed by a
// list) becomes one string, so every list stays a plain array of lines.
function lineText($: cheerio.CheerioAPI, item: Cheerio<Element>, unknownIcons: Set<string>): string {
    const own = ownText($, item, unknownIcons);
    const subLines = item
        .children('ul')
        .children('li')
        .toArray()
        .map((child) => lineText($, $(child), unknownIcons))
        .filter((line) => line !== '');
    if (subLines.length === 0) return own;
    const joined = subLines.join('; ');
    if (own === '') return joined;
    return own.endsWith(':') ? `${own} ${joined}` : `${own}: ${joined}`;
}

function readList($: cheerio.CheerioAPI, card: Cheerio<Element>, selector: string, unknownIcons: Set<string>): string[] {
    return card
        .find(selector)
        .toArray()
        .map((item) => lineText($, $(item), unknownIcons))
        .filter((line) => line !== '');
}

function readRarity(card: Cheerio<Element>, name: string, warnings: string[]): string | null {
    const raw = (card.attr('data-rarity') ?? '').trim().toLowerCase();
    if (raw === '') return null;
    if (!RARITY_PATTERN.test(raw)) {
        warnings.push(`"${name}" has an unusable rarity "${raw}", published without one`);
        return null;
    }
    return raw;
}

export function parsePage(html: string): ParseResult {
    const $ = cheerio.load(html);
    const augments: Augment[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();
    const unknownIcons = new Set<string>();

    $('.device-container').each((index, element) => {
        const card = $(element);
        const name = normalizeText(card.find('.device-header .name').first().text());
        if (name === '') {
            warnings.push(`augment #${index + 1} on the page has no name and was skipped`);
            return;
        }
        if (seen.has(name)) {
            warnings.push(`duplicate augment name "${name}" ignored (kept the first)`);
            return;
        }
        seen.add(name);
        augments.push({
            name,
            advantages: readList($, card, '.device-stats:not(.negative) > ul > li', unknownIcons),
            disadvantages: readList($, card, '.device-stats.negative > ul > li', unknownIcons),
            rarity: readRarity(card, name, warnings),
        });
    });

    for (const key of unknownIcons) warnings.push(`unknown icon "${key}" in the text was dropped`);
    return { augments, warnings };
}
