// The shared part of the old-style picture tools (make.mjs on the command line, wizard.mjs in a terminal window).
// A picture's drawing is the same in the old and the new style; only the background gradient differs. So an old-style picture
// is the new picture with its background gradient replaced by the gradient of an old picture that has the colour wanted.
// Nothing here prints or exits: a problem is thrown as an Error with a plain message. No dependencies (Node 18 or later).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PICTURES_DIR = path.join(ROOT, 'extension', 'old_pictures');
export const LIST_FILE = path.join(ROOT, 'extension', 'data', 'old_pictures.json');
// The rule for which addresses count, what a stable path is and how it becomes a file name (GAME_HOST, STABLE_PATH, fileNameOf) is
// also written in src/injector.ts (oldStablePath, oldAddress) and src/modules/old_pictures.ts (stablePath, fileOf). Scripts share
// no imports, so change all three together, or a file saved here is never found by the extension.
const GAME_HOST = /(^|\.)tankionline\.com$/;
const STABLE_PATH = /^(?:\/\d{1,12}){2,}\/image\.svg$/;
const GRADIENT = /<(radialGradient|linearGradient)\b[^>]*>[\s\S]*?<\/\1>/g;
const STOP_COLOR = /stop-color="([^"]+)"/gi;

// The old backgrounds an augment can have, each with one real old picture that has it (a file in extension/old_pictures).
// Found from the 515 old files and the wiki's augment kinds. The exotic augments are left out on purpose.
export const STYLES = [
    { id: 'standard', name: 'Standard, red (crystal augments too)', file: '605-137574-135-23.svg' },
    { id: 'camper', name: 'Camper and Adrenaline', file: '625-153144-76-330.svg' },
    { id: 'pulsar', name: 'Pulsar', file: '605-137574-144-142.svg' },
    { id: 'fire', name: 'Fire effect', file: '605-115404-373-360.svg' },
    { id: 'freeze', name: 'Freeze effect', file: '605-115404-364-322.svg' },
    { id: 'shock', name: 'Shock and stun effect', file: '605-115405-1-317.svg' },
    { id: 'emp', name: 'EMP and magnetic effect', file: '605-115404-367-60.svg' },
    { id: 'toxic', name: 'Armor-piercing and toxic', file: '605-115405-65-227.svg' },
    { id: 'jamming', name: 'Jamming', file: '605-115405-32-201.svg' },
    { id: 'hull', name: 'Hull augments', file: '607-52626-264-207.svg' },
    { id: 'lightweight', name: 'Lightweight Construction', file: '605-115404-152-21.svg' },
    { id: 'heavyweight', name: 'Heavyweight Construction', file: '605-115404-147-265.svg' },
];

// Says whether an address is a game picture address. The reason starts with a verb, so "<address> <reason>" reads as a sentence.
export function checkAddress(address) {
    let url;
    try {
        url = new URL(address);
    } catch {
        return { ok: false, reason: 'is not an address' };
    }
    if (url.protocol !== 'https:') return { ok: false, reason: 'is not an https address' };
    if (!GAME_HOST.test(url.hostname)) return { ok: false, reason: 'is not on tankionline.com' };
    const parts = url.pathname.split('/').filter((part) => part !== '');
    if (parts[parts.length - 1] !== 'image.svg') return { ok: false, reason: 'does not end in image.svg' };
    parts.splice(parts.length - 2, 1);
    const stablePath = '/' + parts.join('/');
    if (!STABLE_PATH.test(stablePath)) return { ok: false, reason: 'has no stable path (expected /number/number/.../image.svg)' };
    return { ok: true, stablePath, name: fileNameOf(stablePath) };
}

// The stable path of a game address: the path without the version folder just before image.svg.
export function stablePathOf(address) {
    const found = checkAddress(address);
    if (!found.ok) throw new Error(`"${address}" ${found.reason}`);
    return found.stablePath;
}

// The file name of a stable path: no first slash, no /image.svg, the other slashes turned into dashes.
export function fileNameOf(stablePath) {
    return stablePath.slice(1, -'/image.svg'.length).replace(/\//g, '-') + '.svg';
}

export function pictureFile(stablePath) {
    return path.join(PICTURES_DIR, fileNameOf(stablePath));
}

export function colorsOf(gradient) {
    return [...gradient.matchAll(STOP_COLOR)].map((match) => (match[1] ?? '').toUpperCase());
}

// The gradients that paint the background: the ones with a colour other than white (the others only fade white).
export function backgroundGradients(svg) {
    return [...svg.matchAll(GRADIENT)].filter((match) => colorsOf(match[0]).some((color) => color !== 'WHITE'));
}

function idOf(gradient) {
    const match = /\bid="([^"]+)"/.exec(gradient);
    return match === null ? null : match[1];
}

// The colours of an svg's one background gradient, or null when it does not have exactly one.
export function backgroundColors(svg) {
    const found = backgroundGradients(svg);
    return found.length === 1 ? colorsOf(found[0][0]) : null;
}

// Every old picture grouped by its background colours, most common first, with one example file each.
export function colorGroups() {
    const groups = new Map();
    for (const name of fs.readdirSync(PICTURES_DIR).filter((file) => file.endsWith('.svg')).sort()) {
        const colors = backgroundColors(fs.readFileSync(path.join(PICTURES_DIR, name), 'utf8'));
        const key = colors === null ? '(not one background gradient)' : colors.join(' ');
        const group = groups.get(key) ?? { colors: key, count: 0, example: name };
        group.count++;
        groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
}

// What a picture of the game must not hold, since the file goes into the extension: a script, a foreignObject, an event handler,
// a link to another site, a data address, or a reference to anything but a shape inside the same file (href="#...").
const UNSAFE_SVG = [
    [/<\s*script\b/i, 'a script'],
    [/<\s*foreignObject\b/i, 'a foreignObject'],
    [/[\s"'/]on[a-z]+\s*=/i, 'an event handler'],
    [/javascript:/i, 'a javascript: address'],
    [/data:/i, 'a data: address'],
    [/https?:\/\/(?!www\.w3\.org\/)/i, 'a link to another site'],
    [/href\s*=\s*["'](?!#)/i, 'a reference to something outside the file'],
];

// Returns what is wrong with an svg's text as a plain phrase, or null when it holds none of the above.
export function unsafeContent(svg) {
    for (const [pattern, what] of UNSAFE_SVG) if (pattern.test(svg)) return what;
    return null;
}

// The new picture with its background gradient replaced by the donor's, keeping the new picture's own gradient id so
// the shapes that point at it still do.
export function recolor(newSvg, donorSvg) {
    const target = backgroundGradients(newSvg);
    if (target.length !== 1) throw new Error(`the new picture has ${target.length} background gradients, expected one; nothing written`);
    const donor = backgroundGradients(donorSvg);
    if (donor.length !== 1) throw new Error(`the old picture to copy from has ${donor.length} background gradients, expected one; nothing written`);
    const targetId = idOf(target[0][0]);
    const donorId = idOf(donor[0][0]);
    if (targetId === null || donorId === null) throw new Error('a background gradient has no id; nothing written');
    const replacement = donor[0][0].split(donorId).join(targetId);
    const result = newSvg.replace(target[0][0], () => replacement);
    if (!result.includes('<svg')) throw new Error('the result is not an SVG; nothing written');
    const unsafe = unsafeContent(result);
    if (unsafe !== null) throw new Error(`the picture holds ${unsafe}, which a game picture never does; nothing written`);
    return result;
}

export function readList() {
    const value = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
    if (typeof value !== 'object' || value === null || !Array.isArray(value.keys)) throw new Error(`${LIST_FILE} is not a list of keys`);
    return value.keys;
}

// Same format as the file in the repo: two spaces, Windows line ends, keys sorted.
export function writeList(keys) {
    const text = JSON.stringify({ keys: [...new Set(keys)].sort() }, null, 2).replace(/\n/g, '\r\n') + '\r\n';
    fs.writeFileSync(LIST_FILE, text);
}

// The new picture, from the game's server (it wants the game's page as the referer).
export async function downloadNewPicture(address) {
    const response = await fetch(address, { headers: { Referer: 'https://tankionline.com/' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`the game's server answered ${response.status} for ${address}`);
    return response.text();
}

// A file name in extension/old_pictures, or its stable path, as the file of an old picture.
export function resolveOldPicture(like) {
    const name = STABLE_PATH.test(like) ? fileNameOf(like) : path.basename(like);
    const file = path.join(PICTURES_DIR, name);
    if (!fs.existsSync(file)) throw new Error(`${like} is not one of the old pictures in extension/old_pictures (run --list-colors to see examples)`);
    return file;
}
