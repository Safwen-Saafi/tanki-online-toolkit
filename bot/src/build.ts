import { SCHEMA_VERSION, type Augment, type AugmentsFile, type ItemAugments, type Language } from './contract.js';
import { parseHub } from './discover.js';
import { parsePage } from './parse.js';
import { WikiSession, type WikiSite } from './wiki.js';

export interface ParsedPage {
    readonly item: string;
    readonly augments: readonly Augment[];
}

export function assembleFile(language: Language, pages: readonly ParsedPage[], generatedAt: string): AugmentsFile {
    const items: Record<string, ItemAugments> = {};
    for (const page of pages) {
        const byName: Record<string, Augment> = {};
        for (const augment of page.augments) byName[augment.name] = augment;
        items[page.item] = byName;
    }
    return { schemaVersion: SCHEMA_VERSION, language, generatedAt, items };
}

export interface BuildOutcome {
    readonly file: AugmentsFile;
    readonly warnings: string[];
}

export async function buildFile(site: WikiSite): Promise<BuildOutcome> {
    const session = await WikiSession.open(site);
    try {
        const entries = parseHub(await session.fetchRaw(site.hubTitle));
        if (entries.length === 0) {
            throw new Error(`${site.language} hub "${site.hubTitle}" lists no augment pages; its layout may have changed`);
        }
        const pages: ParsedPage[] = [];
        const warnings: string[] = [];
        for (const entry of entries) {
            const parsed = parsePage(await session.fetchParsedHtml(entry.title));
            pages.push({ item: entry.item, augments: parsed.augments });
            for (const warning of parsed.warnings) warnings.push(`${entry.item}: ${warning}`);
        }
        const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        return { file: assembleFile(site.language, pages, generatedAt), warnings };
    } finally {
        await session.close();
    }
}
