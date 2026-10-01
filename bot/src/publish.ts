import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMA_VERSION, fileNameFor, type Augment, type AugmentsFile, type ItemAugments, type Language } from './contract.js';
import { validateFile } from './validate.js';

export type PublishAction = 'written' | 'unchanged' | 'rejected' | 'no-new-file';

export interface PublishResult {
    readonly language: Language;
    readonly action: PublishAction;
    readonly lines: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function readAugment(value: unknown): Augment | null {
    if (!isRecord(value) || typeof value['name'] !== 'string') return null;
    const advantages = value['advantages'];
    const disadvantages = value['disadvantages'];
    if (!isStringArray(advantages) || !isStringArray(disadvantages)) return null;
    return { name: value['name'], advantages, disadvantages };
}

// Turns untrusted JSON read from disk into an AugmentsFile, or null if it is not one.
export function parseAugmentsFile(value: unknown, language: Language): AugmentsFile | null {
    if (!isRecord(value) || value['schemaVersion'] !== SCHEMA_VERSION || value['language'] !== language) return null;
    const generatedAt = value['generatedAt'];
    const rawItems = value['items'];
    if (typeof generatedAt !== 'string' || !isRecord(rawItems)) return null;

    const items: Record<string, ItemAugments> = {};
    for (const [item, rawAugments] of Object.entries(rawItems)) {
        if (!isRecord(rawAugments)) return null;
        const byName: Record<string, Augment> = {};
        for (const [name, rawAugment] of Object.entries(rawAugments)) {
            const augment = readAugment(rawAugment);
            if (augment === null) return null;
            byName[name] = augment;
        }
        items[item] = byName;
    }
    return { schemaVersion: SCHEMA_VERSION, language, generatedAt, items };
}

export function readPublished(dir: string, language: Language): AugmentsFile | null {
    const path = join(dir, fileNameFor(language));
    if (!existsSync(path)) return null;
    try {
        return parseAugmentsFile(JSON.parse(readFileSync(path, 'utf8')), language);
    } catch {
        return null;
    }
}

export function sameItems(a: AugmentsFile, b: AugmentsFile): boolean {
    return JSON.stringify(a.items) === JSON.stringify(b.items);
}

function sameAugment(a: Augment, b: Augment): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

// One line per item that differs, naming the augments that were added, removed or changed.
export function diffItems(before: AugmentsFile | null, after: AugmentsFile): string[] {
    const lines: string[] = [];
    const items = new Set([...Object.keys(before?.items ?? {}), ...Object.keys(after.items)]);
    for (const item of items) {
        const old = before?.items[item] ?? {};
        const next = after.items[item] ?? {};
        const added = Object.keys(next).filter((name) => !(name in old));
        const removed = Object.keys(old).filter((name) => !(name in next));
        const changed = Object.keys(next).filter((name) => {
            const previous = old[name];
            const current = next[name];
            return previous !== undefined && current !== undefined && !sameAugment(previous, current);
        });
        const parts: string[] = [];
        if (added.length > 0) parts.push(`added ${added.join(', ')}`);
        if (removed.length > 0) parts.push(`removed ${removed.join(', ')}`);
        if (changed.length > 0) parts.push(`changed ${changed.join(', ')}`);
        if (parts.length > 0) lines.push(`${item}: ${parts.join('; ')}`);
    }
    return lines;
}

function publishLanguage(language: Language, outDir: string, publishedDir: string): PublishResult {
    const newPath = join(outDir, fileNameFor(language));
    if (!existsSync(newPath)) {
        return { language, action: 'no-new-file', lines: [`no ${fileNameFor(language)} was produced, nothing to publish`] };
    }
    const next = parseAugmentsFile(JSON.parse(readFileSync(newPath, 'utf8')), language);
    if (next === null) {
        return { language, action: 'rejected', lines: [`${newPath} is not a valid augments file`] };
    }

    const published = readPublished(publishedDir, language);
    const problems = validateFile(next, published);
    if (problems.length > 0) {
        return { language, action: 'rejected', lines: problems.map((problem) => `INVALID: ${problem}`) };
    }
    if (published !== null && sameItems(published, next)) {
        return { language, action: 'unchanged', lines: ['content is the same as the published file'] };
    }

    mkdirSync(publishedDir, { recursive: true });
    writeFileSync(join(publishedDir, fileNameFor(language)), `${JSON.stringify(next, null, 2)}\n`);
    const changes = diffItems(published, next);
    return { language, action: 'written', lines: published === null ? ['first publish'] : changes };
}

export function publishAll(outDir: string, publishedDir: string, languages: readonly Language[]): PublishResult[] {
    return languages.map((language) => publishLanguage(language, outDir, publishedDir));
}
