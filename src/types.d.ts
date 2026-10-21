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

// extension/data/killsounds.json: for each kind of sound, a count (as text) -> the file in extension/sounds/, or null for none.
interface KillSoundsConfig {
    // The player's first kill of a battle, under the count "1".
    readonly first: Readonly<Record<string, string | null>>;
    readonly multi: Readonly<Record<string, string | null>>;
    readonly streak: Readonly<Record<string, string | null>>;
    readonly death: Readonly<Record<string, string | null>>;
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
    kaspLanguage?: KaspLanguage;
    kaspGarageTab?: KaspGarageTabReader;
}
