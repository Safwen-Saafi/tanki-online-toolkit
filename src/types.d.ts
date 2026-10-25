interface SkinsDatabase {
    readonly names: Readonly<Record<string, string>>;
    readonly defaults: Readonly<Record<string, string>>;
}

type KaspLanguageCode = "EN" | "RU";

// The augment file the Augments bot publishes (bot/src/contract.ts). The names are load-bearing.
interface Augment {
    readonly name: string;
    readonly advantages: readonly string[];
    readonly disadvantages: readonly string[];
    // The wiki's rank word (rare, epic, legendary, exotic); null in a version 1 file or when the wiki gives none.
    readonly rarity: string | null;
}

interface AugmentsFile {
    readonly schemaVersion: 1 | 2;
    readonly language: KaspLanguageCode;
    readonly generatedAt: string;
    // item slug (a turret, or "hulls") -> augment name -> augment
    readonly items: Readonly<Record<string, Readonly<Record<string, Augment>>>>;
}

interface KaspUserActionMessage {
    readonly type: "kasp:useraction";
    readonly detail: string[];
}

// One kill of the game's kill feed, posted by src/injector.ts. userId is a decimal string because the game's ids go
// beyond 2^53. teamRelation is relative to the local player (ALLY or ENEMY); kind is the game's action type (KILL, SUICIDE...).
interface KaspKillPlayer {
    readonly userId: string;
    readonly uid: string;
    readonly clanTag: string | null;
    readonly teamRelation: string;
}

interface KaspKillEvent {
    readonly killer: KaspKillPlayer;
    readonly victim: KaspKillPlayer;
    readonly damageType: string;
    readonly critical: boolean;
    readonly kind: string;
}

interface KaspKillMessage {
    readonly type: "kasp:kill";
    readonly detail: KaspKillEvent;
}

// The battle's time, posted by src/injector.ts from the game's BattleStatistics when remaining, roundStarted or
// battleLoaded changes. remaining is the seconds left at the moment the player joined (it stays the same in later
// copies, and is -1 before a battle is loaded); roundStarted is false while the battle is not running (or has ended).
interface KaspBattleTimeMessage {
    readonly type: "kasp:battle-time";
    readonly detail: {
        readonly remaining: number;
        readonly roundStarted: boolean;
        readonly battleLoaded: boolean;
    };
}

// Posted by src/injector.ts each time the player's own grenade starts its reload, which is when the player threw it.
// Posted by src/injector.ts when the game says which turret is mounted: at load, and at every change in the garage.
// name is the game's own text for the item (in the game's language), id its number.
interface KaspMountedMessage {
    readonly type: "kasp:mounted";
    // the game's text for the item in the garage; empty when the item comes from the battle, which gives only ids
    readonly name: string;
    readonly id: string;
    // the id of the turret before its upgrades, from the battle
    readonly baseId?: string;
}

// Posted once by src/modules/weapon_sounds.ts: the owner's files for sounds that depend on the mounted turret (the lock sounds).
// src/injector.ts writes each into the game's own decoded sound while the turret is the one named.
interface KaspLateSoundGroup {
    readonly turret: string;
    readonly data: ArrayBuffer;
    readonly numbers: string[];
}

interface KaspLateSoundsMessage {
    readonly type: "kasp:late-sounds";
    readonly groups: KaspLateSoundGroup[];
}

// Posted by src/modules/weapon_sounds.ts whenever the mounted turret, as a plain item name ("gauss"), changes; "" when unknown.
interface KaspTurretMessage {
    readonly type: "kasp:turret";
    readonly turret: string;
}

// Posted by src/modules/weapon_sounds.ts once it is listening: src/injector.ts then says again the last kasp:mounted.
interface KaspMountedRequestMessage {
    readonly type: "kasp:mounted-request";
}

interface KaspGrenadeThrowMessage {
    readonly type: "kasp:grenade-throw";
    // The reload time the game's event carries, in the game's time unit (milliseconds), 0 when it could not be read.
    readonly reloadMs: number;
}

// One of the owner's sound files and the resource numbers of the game's sound files (four numbers joined with "/", for
// example "0/16723/73/223") that decode it instead of their own data.
interface KaspSoundReplacement {
    readonly data: ArrayBuffer;
    readonly numbers: string[];
}

// Posted once by src/modules/weapon_sounds.ts to src/injector.ts: the files to decode in place of game sound files. Until
// it arrives the injector touches no sound.
interface KaspSoundSwapMessage {
    readonly type: "kasp:sound-swap";
    readonly replacements: KaspSoundReplacement[];
}

// extension/data/weapon_sounds.json: for each file in extension/sounds/, the resource numbers it replaces. A group with a turret (an item name from skins.json, such as "gauss") is used only while that turret is the
// mounted one, for sound files that several turrets share (the injector rewrites the game's decoded sound for them).
interface WeaponSoundGroup {
    readonly file: string;
    readonly numbers: readonly string[];
    readonly turret?: string;
}

interface WeaponSoundConfig {
    readonly replace: readonly WeaponSoundGroup[];
    // for each turret (a plain item name) the ids the game gives it in a battle (the ones the garage's item carries)
    readonly turrets?: Readonly<Record<string, readonly string[]>>;
}

// WeakRef is not in the ES2020 library the project is built against, and every browser that runs the extension has it.
declare class WeakRef<T extends object> {
    constructor(target: T);
    deref(): T | undefined;
}

// extension/data/killsounds.json: for each kind of sound, a count (as text) -> a file in extension/sounds/, a list of
// files (they take turns), or { files, chance } where chance (0 to 1) is how often anything plays; null for none.
type KillSoundEntry =
    | string
    | readonly string[]
    | { readonly files: string | readonly string[]; readonly chance?: number }
    | null;

interface KillSoundsConfig {
    // The player's first kill of a battle, under the count "1".
    readonly first: Readonly<Record<string, KillSoundEntry>>;
    readonly multi: Readonly<Record<string, KillSoundEntry>>;
    readonly streak: Readonly<Record<string, KillSoundEntry>>;
    readonly death: Readonly<Record<string, KillSoundEntry>>;
    // A kill with a grenade, under the count "1". It beats every other kill sound.
    readonly grenade: Readonly<Record<string, KillSoundEntry>>;
}

// Published by src/modules/language.ts. get() is EN until the language is found; whenKnown resolves once with the
// settled language (a language change reloads the page, so it does not change after that).
interface KaspLanguage {
    readonly get: () => KaspLanguageCode;
    readonly whenKnown: Promise<KaspLanguageCode>;
}

type KaspGarageTab = "augments" | "skins" | "shot-color";

// Published by src/modules/garage_tab.ts; read() is null when no item tab menu is on screen.
interface KaspGarageTabReader {
    readonly read: () => KaspGarageTab | null;
}

interface Window {
    __kaspSendAction?: (className: string, obj: unknown) => void;
    __kaspSendKill?: (className: string, obj: unknown) => void;
    __kaspSendBattleTime?: (className: string, obj: unknown) => void;
    __kaspSendGrenadeThrow?: (reload?: unknown) => void;
    __kaspSendTankInfo?: (className: string, obj: unknown) => void;
    __kaspSendUserId?: (obj: unknown, idProp: string) => void;
    __kaspSendGarageItem?: (obj: unknown, idProp: string, nameProp: string, categoryProp: string, mountedProp: string) => void;
    kaspLanguage?: KaspLanguage;
    kaspGarageTab?: KaspGarageTabReader;
}
