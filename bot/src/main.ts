import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFile } from './build.js';
import { countAugments, fileNameFor } from './contract.js';
import { parseHub, type HubEntry } from './discover.js';
import { parsePage } from './parse.js';
import { publishAll } from './publish.js';
import { validateFile } from './validate.js';
import { SITES, WikiSession, type WikiSite } from './wiki.js';

const OUT_DIR = new URL('../out/', import.meta.url);

async function discoverSite(site: WikiSite): Promise<HubEntry[]> {
    const session = await WikiSession.open(site);
    try {
        const entries = parseHub(await session.fetchRaw(site.hubTitle));
        if (entries.length === 0) {
            throw new Error(`${site.language} hub "${site.hubTitle}" lists no augment pages; its layout may have changed`);
        }
        return entries;
    } finally {
        await session.close();
    }
}

async function printPage(languageArg: string, item: string): Promise<number> {
    const site = SITES.find((candidate) => candidate.language === languageArg.toUpperCase());
    if (site === undefined) {
        console.error(`unknown language "${languageArg}" (use en or ru)`);
        return 1;
    }
    const session = await WikiSession.open(site);
    try {
        const entries = parseHub(await session.fetchRaw(site.hubTitle));
        const entry = entries.find((candidate) => candidate.item === item.toLowerCase());
        if (entry === undefined) {
            console.error(`no item "${item}" on the ${site.language} hub`);
            return 1;
        }
        const { augments, warnings } = parsePage(await session.fetchParsedHtml(entry.title));
        console.log(`${site.language} ${entry.item}: ${augments.length} augments`);
        for (const augment of augments) {
            console.log(`  ${augment.name}  (+${augment.advantages.length} / -${augment.disadvantages.length})`);
        }
        for (const warning of warnings) console.warn(`  warning: ${warning}`);
        return 0;
    } finally {
        await session.close();
    }
}

// Writes bot/out/augments.<lang>.json for every language that builds and validates.
// A language that fails is reported and left unwritten; the exit code is non-zero if any failed.
async function scrapeAll(): Promise<number> {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const site of SITES) rmSync(new URL(fileNameFor(site.language), OUT_DIR), { force: true });

    let failed = false;
    for (const site of SITES) {
        try {
            const { file, warnings } = await buildFile(site);
            const problems = validateFile(file, null);
            const perItem = Object.entries(file.items).map(([item, augments]) => `${item}:${Object.keys(augments).length}`);
            console.log(`${site.language}: ${Object.keys(file.items).length} items, ${countAugments(file)} augments`);
            console.log(`  ${perItem.join(' ')}`);
            for (const warning of warnings) console.warn(`  warning: ${warning}`);
            if (problems.length > 0) {
                failed = true;
                for (const problem of problems) console.error(`  INVALID: ${problem}`);
                continue;
            }
            writeFileSync(new URL(fileNameFor(site.language), OUT_DIR), `${JSON.stringify(file, null, 2)}\n`);
            console.log(`  wrote out/${fileNameFor(site.language)}`);
        } catch (error) {
            failed = true;
            console.error(`${site.language}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return failed ? 1 : 0;
}

// Copies each validated out/ file into publishedDir, only when its content changed.
function runPublish(publishedDir: string): number {
    const languages = SITES.map((site) => site.language);
    const results = publishAll(fileURLToPath(OUT_DIR), resolve(publishedDir), languages);
    for (const result of results) {
        console.log(`${result.language}: ${result.action}`);
        for (const line of result.lines) console.log(`  ${line}`);
    }
    return results.some((result) => result.action === 'rejected') ? 1 : 0;
}

async function main(args: readonly string[]): Promise<number> {
    const publishAt = args.indexOf('--publish');
    if (publishAt !== -1) {
        const dir = args[publishAt + 1];
        if (dir === undefined) {
            console.error('usage: npm run scrape -- --publish <published-dir>');
            return 1;
        }
        return runPublish(dir);
    }
    const pageAt = args.indexOf('--page');
    if (pageAt !== -1) {
        const [language, item] = args.slice(pageAt + 1);
        if (language === undefined || item === undefined) {
            console.error('usage: npm run scrape -- --page <en|ru> <item>');
            return 1;
        }
        return printPage(language, item);
    }
    if (args.includes('--discover')) {
        for (const site of SITES) {
            const entries = await discoverSite(site);
            console.log(`${site.language}: ${entries.length} items`);
            for (const entry of entries) console.log(`  ${entry.item} -> ${entry.title}`);
        }
        return 0;
    }
    if (args.length === 0) return scrapeAll();
    console.error('usage: npm run scrape [-- --discover | --page <en|ru> <item> | --publish <published-dir>]');
    return 1;
}

try {
    process.exitCode = await main(process.argv.slice(2));
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
