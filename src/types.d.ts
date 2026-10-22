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
interface KaspGrenadeThrowMessage {
    readonly type: "kasp:grenade-throw";
}

// One of the owner's sound files and the resource numbers of the game's sound files (four numbers joined with "/", for
// example "0/16723/73/223") that decode it instead of their own data.
interface KaspSoundReplacement {
    readonly data: ArrayBuffer;
    readonly numbers: string[];
}

// Posted once by src/modules/magnum_sound.ts to src/injector.ts: the files to decode in place of game sound files, and
// the resource numbers to decode as silence. Until it arrives the injector touches no sound.
interface KaspSoundSwapMessage {
    readonly type: "kasp:sound-swap";
    readonly replacements: KaspSoundReplacement[];
    readonly silence: string[];
}

// extension/data/magnum.json: for each file in extension/sounds/, the resource numbers it replaces, and the numbers to
// silence.
interface MagnumSoundGroup {
    readonly file: string;
    readonly numbers: readonly string[];
}

interface MagnumSoundConfig {
    readonly replace: readonly MagnumSoundGroup[];
    readonly silence: readonly string[];
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
    __kaspSendGrenadeThrow?: () => void;
    kaspLanguage?: KaspLanguage;
    kaspGarageTab?: KaspGarageTabReader;
}
