export interface HubEntry {
    readonly item: string;
    readonly title: string;
}

// EN hubs transclude main-namespace pages ({{:Augments/Firebird}}); RU hubs transclude
// template-namespace pages ({{Устройства/Огнемёт}}), which are fetched as "Template:...".
const SWITCHER = /\{\{AugmentSwitcher\|item=(\w+)\|augments=\{\{(:?)([^}|]+)\}\}\}\}/g;

export function parseHub(wikitext: string): HubEntry[] {
    const entries: HubEntry[] = [];
    const seen = new Set<string>();
    for (const match of wikitext.matchAll(SWITCHER)) {
        const [, rawItem, colon, rawTitle] = match;
        if (rawItem === undefined || colon === undefined || rawTitle === undefined) continue;
        const item = rawItem.toLowerCase();
        if (seen.has(item)) continue;
        seen.add(item);
        const name = rawTitle.trim();
        entries.push({ item, title: colon === ':' ? name : `Template:${name}` });
    }
    return entries;
}
