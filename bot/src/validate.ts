import { countAugments, type AugmentsFile } from './contract.js';

export const FIRST_RUN_MIN_ITEMS = 10;
export const FIRST_RUN_MIN_AUGMENTS = 100;
export const MIN_KEPT_FRACTION = 0.9;

function checkShape(file: AugmentsFile, problems: string[]): void {
    for (const [item, augments] of Object.entries(file.items)) {
        const names = Object.keys(augments);
        if (names.length === 0) problems.push(`item "${item}" has no augments`);
        for (const [key, augment] of Object.entries(augments)) {
            if (augment.name.trim() === '') problems.push(`item "${item}" has an augment with an empty name`);
            if (augment.name !== key) problems.push(`item "${item}": key "${key}" does not match name "${augment.name}"`);
            for (const line of [...augment.advantages, ...augment.disadvantages]) {
                if (line.trim() === '') problems.push(`"${augment.name}" (${item}) has an empty line`);
            }
        }
    }
}

function checkAgainstPublished(file: AugmentsFile, published: AugmentsFile, problems: string[]): void {
    for (const item of Object.keys(published.items)) {
        if (!(item in file.items)) problems.push(`item "${item}" is published but missing from the new file`);
    }
    const before = countAugments(published);
    const after = countAugments(file);
    if (after < before * MIN_KEPT_FRACTION) {
        problems.push(
            `augment count fell from ${before} to ${after} (more than ${Math.round((1 - MIN_KEPT_FRACTION) * 100)}%)`,
        );
    }
}

function checkFirstRunFloor(file: AugmentsFile, problems: string[]): void {
    const items = Object.keys(file.items).length;
    const augments = countAugments(file);
    if (items < FIRST_RUN_MIN_ITEMS) problems.push(`only ${items} items (first run needs at least ${FIRST_RUN_MIN_ITEMS})`);
    if (augments < FIRST_RUN_MIN_AUGMENTS) {
        problems.push(`only ${augments} augments (first run needs at least ${FIRST_RUN_MIN_AUGMENTS})`);
    }
}

// An empty result means the file is safe to publish.
export function validateFile(file: AugmentsFile, published: AugmentsFile | null): string[] {
    const problems: string[] = [];
    checkShape(file, problems);
    if (published === null) {
        checkFirstRunFloor(file, problems);
    } else {
        checkAgainstPublished(file, published, problems);
    }
    return problems;
}
