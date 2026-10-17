export type Language = 'EN' | 'RU';

export const SCHEMA_VERSION = 2;

// The wiki's rank word for an augment (rare, epic, legendary, exotic at the time of writing). Any lowercase word is
// published, so a new rank never stops the daily run; the extension picks a neutral look for one it does not know.
export const RARITY_PATTERN = /^[a-z]{1,20}$/;

export interface Augment {
    readonly name: string;
    readonly advantages: readonly string[];
    readonly disadvantages: readonly string[];
    // Added in schema version 2; null when the wiki page gives none.
    readonly rarity: string | null;
}

export type ItemAugments = Readonly<Record<string, Augment>>;

// The published file. The later extension feature reads these names, so they are load-bearing.
export interface AugmentsFile {
    readonly schemaVersion: typeof SCHEMA_VERSION;
    readonly language: Language;
    readonly generatedAt: string;
    readonly items: Readonly<Record<string, ItemAugments>>;
}

export function fileNameFor(language: Language): string {
    return `augments.${language.toLowerCase()}.json`;
}

// How many augments carry each rank; "none" counts the ones without a rank.
export function rarityCounts(file: AugmentsFile): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of Object.values(file.items)) {
        for (const augment of Object.values(item)) {
            const key = augment.rarity ?? 'none';
            counts[key] = (counts[key] ?? 0) + 1;
        }
    }
    return counts;
}

export function countAugments(file: AugmentsFile): number {
    return Object.values(file.items).reduce((total, item) => total + Object.keys(item).length, 0);
}
