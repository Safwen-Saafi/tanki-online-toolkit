export type Language = 'EN' | 'RU';

export const SCHEMA_VERSION = 2;

// The wiki's rank word for an augment (rare, epic, legendary, exotic at the time of writing). Any lowercase word is
// published, so a new rank never stops the daily run; the extension picks a neutral look for one it does not know.
export const RARITY_PATTERN = /^[a-z]{1,20}$/;

// The status effect icons the wiki puts inside augment text, by wiki file name (lowercase, without the size
// prefix and the extension), and the key the text carries for them as {key}. The extension draws its own icon
// for each key. Several wiki names can share one key.
export const EFFECT_ICONS: Readonly<Record<string, string>> = {
    icon_freeze: 'freeze',
    icon_freezing1: 'freeze',
    icon_heat: 'burning',
    icon_emp: 'emp',
    icon_jammer: 'jammer',
    icon_stun: 'stun',
    ap_status: 'armor_piercing',
    icon_ap: 'armor_piercing',
    // The Russian wiki names its icons differently.
    icon_freezing: 'freeze',
    icon_heat1: 'burning',
    icon_emp1: 'emp',
    icon_stun1: 'stun',
    icon_breaking_through: 'armor_piercing',
    icon_breaking_through1: 'armor_piercing',
};

// Icons that carry no effect (the small "i" beside a hover note); dropped without a warning.
export const IGNORED_ICONS: readonly string[] = ['icon_info'];

export interface Augment {
    readonly name: string;
    readonly advantages: readonly string[];
    readonly disadvantages: readonly string[];
    // Added in schema version 2; null when the wiki page gives none.
    readonly rarity: string | null;
}

export type ItemAugments = Readonly<Record<string, Augment>>;

// The published file. The extension's augments module reads these names, so they are load-bearing.
export interface AugmentsFile {
    readonly schemaVersion: typeof SCHEMA_VERSION;
    readonly language: Language;
    readonly generatedAt: string;
    readonly items: Readonly<Record<string, ItemAugments>>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
