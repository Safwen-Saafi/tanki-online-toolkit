export type Language = 'EN' | 'RU';

export const SCHEMA_VERSION = 1;

export interface Augment {
    readonly name: string;
    readonly advantages: readonly string[];
    readonly disadvantages: readonly string[];
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

export function countAugments(file: AugmentsFile): number {
    return Object.values(file.items).reduce((total, item) => total + Object.keys(item).length, 0);
}
