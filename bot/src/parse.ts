import * as cheerio from 'cheerio';
import type { Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import type { Augment } from './contract.js';

export interface ParseResult {
    readonly augments: Augment[];
    readonly warnings: string[];
}

export function normalizeText(text: string): string {
    return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

// A bullet with sub-bullets (for example "applies these status effects:" followed by a
// list) becomes one string, so every list stays a plain array of lines.
function lineText($: cheerio.CheerioAPI, item: Cheerio<Element>): string {
    const own = normalizeText(item.clone().children('ul').remove().end().text());
    const subLines = item
        .children('ul')
        .children('li')
        .toArray()
        .map((child) => lineText($, $(child)))
        .filter((line) => line !== '');
    if (subLines.length === 0) return own;
    const joined = subLines.join('; ');
    if (own === '') return joined;
    return own.endsWith(':') ? `${own} ${joined}` : `${own}: ${joined}`;
}

function readList($: cheerio.CheerioAPI, card: Cheerio<Element>, selector: string): string[] {
    return card
        .find(selector)
        .toArray()
        .map((item) => lineText($, $(item)))
        .filter((line) => line !== '');
}

export function parsePage(html: string): ParseResult {
    const $ = cheerio.load(html);
    const augments: Augment[] = [];
    const warnings: string[] = [];
    const seen = new Set<string>();

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
            advantages: readList($, card, '.device-stats:not(.negative) > ul > li'),
            disadvantages: readList($, card, '.device-stats.negative > ul > li'),
        });
    });

    return { augments, warnings };
}
