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
    // The reload time the game's event carries, in milliseconds (the game's own number is in seconds), 0 when it could not be read.
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
// mounted one, for sound files that several turrets share (the injector rewrites the game's decoded sound for them). Every group
// names the weapon it belongs to (a plain item name, such as "magnum"), whose switch in the extension's settings tab is
// kasp_weaponsounds_<weapon>.
interface WeaponSoundGroup {
    readonly file: string;
    readonly numbers: readonly string[];
    readonly weapon: string;
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

// Posted by src/injector.ts for each player's battle chat message, for src/modules/chat_translation.ts. ally is the sender's
// side relative to the local player, own is true for the player's own message, team is true for a team only message, and
// rankPicture is the address of the game's small picture of the sender's rank (null when it was not found).
interface KaspChatMessage {
    readonly type: "kasp:chat";
    readonly detail: {
        readonly uid: string;
        readonly clanTag: string | null;
        readonly ally: boolean;
        readonly own: boolean;
        readonly team: boolean;
        readonly rankPicture: string | null;
        readonly text: string;
    };
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

// What injector.ts reads off a card of the Augments row from the game's own React data and writes onto the card as
// data-kasp-card (JSON): the augment's name, the game's rank word (RARE, EPIC, LEGENDARY, SPECIAL), whether the player
// cannot see it yet (the "?" cards) and, for those, the address of the item's own picture on the game's server. The category
// (DEVICE for an augment, SKIN for a skin) tells one tab's cards from another's, since the row still holds the old tab's cards
// for a moment after the tab changes (a colour's is SKIN too, so the two tabs are told apart another way). The selected hidden skin
// or colour also carries the address of the bigger picture the left panel shows for it (null for any other card, or when the
// game's data for it was not found).
interface KaspGameCard {
    readonly name: string;
    readonly category: string | null;
    readonly rarity: string;
    readonly unknown: boolean;
    readonly picture: string | null;
    readonly preview: string | null;
}

// Posted once by src/modules/old_pictures.ts to src/injector.ts: the address of the folder of bundled old augment pictures and the
// stable path of each one that has a file in it (a picture's address without its version folder, for example
// /634/112237/40/362/image.svg). Until it arrives, and unless it checks out, the injector swaps no picture.
interface KaspOldPicturesMessage {
    readonly type: "kasp:old-pictures";
    readonly base: string;
    readonly keys: string[];
}

// Published by src/modules/old_pictures.ts. swap(address) is the address of the old picture for a game picture's address, or the
// address itself when there is none, or before the list is loaded, or when the module is off. keyOf(address) is a picture's
// stable path, whether it is the game's address or the bundled file that stands for it, and any other address comes back as it is.
// markFailed(address) is for a game address whose old picture did not load: swap gives the game's own from then on.
interface KaspOldPictures {
    readonly swap: (address: string) => string;
    readonly keyOf: (address: string) => string;
    readonly markFailed: (address: string) => void;
}

// Published by src/modules/switches.ts, the one place that knows how a feature's switch is saved (off is the exact text 0 under its
// localStorage key, on is no key). isOn(key) reads the saved value; set(key, on) saves it (only the settings tab calls it) and is
// false when the browser refused; onChange(key, action) leaves an action that set calls with the new value when that switch really
// changes, which is how a live module learns of a change with no loop and no page event. A choice (such as the chat's target
// language) is the same with a text: getChoice(key) is the saved text, or null for the module's default; setChoice(key, null)
// goes back to that default; onChoice(key, action) is called with the new value when it really changes.
interface KaspSwitches {
    readonly isOn: (key: string) => boolean;
    readonly set: (key: string, on: boolean) => boolean;
    readonly onChange: (key: string, action: (on: boolean) => void) => void;
    readonly getChoice: (key: string) => string | null;
    readonly setChoice: (key: string, value: string | null) => boolean;
    readonly onChoice: (key: string, action: (value: string | null) => void) => void;
}

// Published by src/modules/loading_screens.ts (build-plan 23). fromFile makes the saved picture of a loading screen from the
// player's file: "notImage" when the browser cannot open it, "tooBig" when it is over 25 MB or still too long as text at the lowest
// quality. isPicture says whether a saved value is an image address the module would draw.
type KaspLoadingPicture =
    | { readonly ok: true; readonly value: string }
    | { readonly ok: false; readonly reason: 'notImage' | 'tooBig' };

interface KaspLoadingScreens {
    readonly fromFile: (file: Blob) => Promise<KaspLoadingPicture>;
    readonly isPicture: (value: string | null) => boolean;
}

// Published by src/modules/messages.ts, the one message listener of the isolated world. on(type, action) calls the action with
// every message of that type posted from this window (an object, not yet checked beyond its type).
interface KaspMessages {
    readonly on: (type: string, action: (data: Readonly<Record<string, unknown>>) => void) => void;
}

// Published by src/modules/battle.ts, the one place that checks whether a battle is on screen. isOn() is the last answer;
// onChange(action) is called with the new value only when it changes.
interface KaspBattle {
    readonly isOn: () => boolean;
    readonly onChange: (action: (on: boolean) => void) => void;
}

// Defined by src/modules/showroom.ts (MAIN world, build-plan 25) and called only by the 3D tank code the injector edits, once per
// frame. camera(tankHeight, photo) (photo: the game's photo mode is on) gives the lens (fov, radians), the distance, camera height and look height (game units), the angle
// (radians) and the sideways pan to add, or null outside the garage (the game's own camera); drone() gives the move from the game's
// drone place (game units) and whether the Drones tab is open, or null when no garage camera ran this frame. One object each, reused.
interface KaspShowroomCamera {
    fov: number;
    distance: number;
    height: number;
    look: number;
    angle: number;
    side: number;
}

interface KaspShowroomDrone {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    shown: boolean;
}

// The game's field names the Grenades screen's camera needs (25f1), read from the bundle by the injector: the tank model's turret
// and grenade parts, a part's turn and place, and the three axes of a place. Passed to camera() with the tank model itself, only
// when the injector's grenade part went in.
interface KaspShowroomParts {
    readonly turret: string;
    readonly grenade: string;
    readonly turn: string;
    readonly place: string;
    readonly x: string;
    readonly y: string;
    readonly z: string;
    // The injector also keeps the tank shown on the Supplies screen (25f4).
    readonly supplies: boolean;
}

interface KaspShowroom {
    // Called by the injector once its garage edits went in: makes the floor and its calm copy.
    readonly start: () => void;
    readonly camera: (tankHeight: number, photo: boolean, model?: unknown, parts?: KaspShowroomParts) => KaspShowroomCamera | null;
    readonly drone: () => KaspShowroomDrone | null;
}

// The game's own names the lobby needs (build-plan 26), found by src/injector.ts in the game's code at start and handed to
// src/modules/lobby.ts once, so lobby.ts never spells a game name. Load-bearing: later lobby parts add their names here.
interface KaspLobbyNames {
    // The hangar system: its camera point, look-at point, tank base, platform node, camera component, breathing offset, the
    // light direction it copies into the key light every frame, and the ring lamps' turn speed.
    readonly cam: string;
    readonly target: string;
    readonly base: string;
    readonly platform: string;
    readonly cameraComponent: string;
    readonly wobble: string;
    readonly lightDir: string;
    readonly lampSpeed: string;
    // A vector's parts, a node's rotation (a vector), a camera component's lens (radians).
    readonly x: string;
    readonly y: string;
    readonly z: string;
    readonly rotation: string;
    readonly fov: string;
    // Methods: the system's world, the world's renderer.
    readonly world: string;
    readonly renderer: string;
    // The renderer's lighting: the ambient (fill) colour, the key light, its colour and strength.
    readonly lighting: string;
    readonly ambient: string;
    readonly key: string;
    readonly keyColour: string;
    readonly keyStrength: string;
    // A colour's setter (r, g, b, a, 0 to 1) and its four parts.
    readonly colourSet: string;
    readonly red: string;
    readonly green: string;
    readonly blue: string;
    readonly alpha: string;
    // The renderer's settings state, its shadows flag and texture sharpness, and the sharpness setter.
    readonly state: string;
    readonly shadowsOn: string;
    readonly sharpness: string;
    readonly setSharpness: string;
    // The renderer's shadow settings, the copy-with-changes method and its nine fields in the copy's order.
    readonly shadow: string;
    readonly shadowCopy: string;
    readonly shadowFields: readonly string[];
    // Only while the drone flight's edit went in too (26c).
    readonly drone?: KaspLobbyDroneNames;
    // Only while every name of the picture pass was found (26f1).
    readonly pass?: KaspLobbyPassNames;
}

// The picture pass's names (build-plan 26f1): the renderer's frame call, its GL wrapper field and the wrapper's raw context, the
// camera's view-projection matrix, the world's scene root and camera, a scene node's name, show switch and children (with the
// list's size and item calls), a mesh's bounds call and the box's corner fields, a node's place.
interface KaspLobbyPassNames {
    readonly frame: string;
    readonly glHolder: string;
    readonly glContext: string;
    readonly viewProjection: string;
    readonly root: string;
    readonly worldCamera: string;
    readonly nodeName: string;
    readonly setShown: string;
    readonly children: string;
    readonly size: string;
    readonly at: string;
    readonly bounds: string;
    readonly boxMin: readonly string[];
    readonly boxMax: readonly string[];
    readonly position: string;
}

// The drone's names (build-plan 26c): the hangar's drone place (the point the drone system copies every frame), and the drone
// system's own place, its pressed and grabbed flags (a press on the drone grabs it and a drag turns it) and its mesh.
interface KaspLobbyDroneNames {
    readonly home: string;
    readonly place: string;
    readonly pressed: string;
    readonly grabbed: string;
    readonly mesh: string;
}

// The game's own values in the lobby, recorded before anything is written (build-plan 26a).
interface KaspLobbyVector {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

interface KaspLobbyRecord {
    readonly cam: KaspLobbyVector;
    readonly target: KaspLobbyVector;
    readonly base: KaspLobbyVector;
    readonly turn: number;
    readonly fov: number;
    readonly lightDir: KaspLobbyVector;
    readonly ambient: readonly number[];
    readonly keyColour: readonly number[];
    readonly keyStrength: number;
    readonly lampSpeed: number;
    readonly shadowsOn: boolean;
    readonly shadow: readonly number[];
    readonly sharpness: number;
}

// The lobby's picture pass (build-plan 26f, src/modules/lobby_pass.ts), driven by src/modules/lobby.ts.
// A triangle list of one object and one material of a hangar model, with its picture's file name and address; mode 2 = see-through,
// 1 = cut out, 0 = solid.
interface KaspLobbyBatch {
    readonly name: string;
    readonly pic: string;
    readonly url: string;
    readonly pos: Float32Array;
    readonly uv: Float32Array;
    readonly mode: number;
}

// Pieces of a hangar model and their pictures; back / fwd = how far inside and outside the door a ground's top view reaches.
interface KaspLobbyAsset {
    readonly key: string;
    readonly batches: readonly KaspLobbyBatch[];
    readonly pics: ReadonlyMap<string, ImageBitmap>;
    readonly back?: number;
    readonly fwd?: number;
    // The night factor pictures by picture name (26f2), once made.
    readonly nightPics?: ReadonlyMap<string, ImageBitmap>;
}

// The game's own hangar: its room and floor, and the road's flat ground just outside the door.
interface KaspLobbyStandard {
    readonly std: KaspLobbyAsset;
    readonly ground: KaspLobbyAsset;
    // A point just under each ring lamp's lens (26f2).
    readonly lamps: ReadonlyArray<readonly number[]>;
}

// The street side of the hangar: o = outward from the door, l = sideways, wall = the door line along o, the ground, the top of the
// town (sky above it), where the sky backdrop begins along o (skyNear) and the room's top (skyLow).
interface KaspLobbyBox {
    readonly o: readonly [number, number];
    readonly l: readonly [number, number];
    readonly wall: number;
    readonly groundZ: number;
    readonly skyZ: number;
    readonly skyNear: number;
    readonly skyLow: number;
    readonly floorZ: number;
}

// Stage 1a: the hangar floor drawn again with the outside's ground mirrored in through the door line.
interface KaspLobbyFloorMix {
    readonly ground: KaspLobbyAsset;
    readonly std: KaspLobbyAsset;
    readonly amount: number;
    readonly depth: number;
    readonly bright: number;
    readonly tone: number;
    readonly fade: number;
    readonly inside: number;
    readonly wall: number;
    readonly outR: number;
    readonly lim: readonly [number, number, number];
}

// Stage 2: the atmosphere laid over the picture (the sun's glow, and with their looks fog, snow on the ground, stars, clouds, flash).
interface KaspLobbyAtmos {
    readonly stars: number;
    readonly glow: number;
    readonly sunDir: readonly number[];
    readonly sunCol: readonly number[];
    readonly fog: number;
    readonly fogStart: number;
    readonly fogHeight: number;
    readonly fogMove: number;
    readonly fogCol: readonly number[];
    readonly cover: number;
    readonly spark: number;
    readonly coverCol: readonly number[];
    readonly coverThick: number;
    readonly groundZ: number;
    readonly skyZ: number;
    readonly flash: number;
    readonly bolt: number;
    readonly flashCol: readonly number[];
    readonly cloud: number;
    readonly cloudK: number;
    readonly cloudSpeed: number;
    readonly cloudCol: readonly number[];
}

// Everything one frame of the pass reads (the probe's buildFrame result); a later part adds its stage's field.
interface KaspLobbyPassFrame {
    readonly vp: Float32Array;
    readonly cam: readonly [number, number, number];
    readonly time: number;
    readonly box: KaspLobbyBox;
    readonly doorIn: number;
    readonly doorOut: number;
    readonly offset: readonly [number, number, number];
    readonly grade: { readonly inn: readonly number[]; readonly hor: readonly number[]; readonly zen: readonly number[] } | null;
    readonly atmos: KaspLobbyAtmos | null;
    readonly floorMix: KaspLobbyFloorMix | null;
    // Stage 0b (26f2): the hangar's walls and floor multiplied by their night factor pictures.
    readonly desun: { readonly asset: KaspLobbyAsset; readonly amount: number } | null;
    // Stage 1c (26f2): the ring lamps' light.
    readonly lamps: { readonly list: ReadonlyArray<readonly number[]>; readonly power: number; readonly reach: number; readonly glow: number; readonly color: readonly number[] } | null;
}

// One pass per GL context; draw throws when a stage breaks (the game's GL state is put back first).
interface KaspLobbyGpu {
    readonly draw: (frame: KaspLobbyPassFrame) => void;
    readonly dispose: () => void;
}

interface KaspLobbyPassApi {
    readonly make: (gl: WebGL2RenderingContext) => KaspLobbyGpu;
    readonly loadStandard: (folder: string) => Promise<KaspLobbyStandard>;
    readonly nightPictures: (asset: KaspLobbyAsset) => Promise<ReadonlyMap<string, ImageBitmap>>;
}

// MAIN world, defined by src/modules/hangar_files.ts (26e): its two floor steps, used by lobby_pass.ts for the night floor (26f2).
interface KaspHangarPictures {
    readonly removeSun: (px: Uint8ClampedArray, W: number, H: number) => void;
    readonly flattenPicture: (px: Uint8ClampedArray, W: number, H: number) => void;
    // The saved store of made files: the saved one for name, or make it and save it (null = could not be made).
    readonly saved: (name: string, make: () => Promise<Blob | null>) => Promise<Blob | null>;
    // Whether the floor picture the game gets is the cleaned one (the look's choice).
    readonly floorCleaned: boolean;
}

// MAIN world, defined by src/modules/lobby.ts (build-plan 26a). The injector calls start once its lobby edit went in; the game's
// hangar system calls frame first thing in every lobby frame.
interface KaspLobby {
    readonly start: (names: KaspLobbyNames) => void;
    readonly frame: (system: unknown) => void;
    // Called by hangar_files.ts once the game has asked for its hangar (26f2): the model and the night pictures are read at once.
    readonly prepare: () => void;
    // Called by the game's drone system as the last thing of its own update (26c).
    readonly drone: (system: unknown) => void;
    // Read-only, for the owner's console checks.
    readonly frames: number;
    readonly game: KaspLobbyRecord | null;
    readonly state: Readonly<Record<string, unknown>>;
    readonly guard: boolean;
}

interface Window {
    __kaspLobby?: KaspLobby;
    __kaspLobbyPass?: KaspLobbyPassApi;
    __kaspHangarPictures?: KaspHangarPictures;
    __kaspShowroom?: KaspShowroom;
    __kaspShowroomParts?: KaspShowroomParts;
    __kaspSendAction?: (className: string, obj: unknown) => void;
    __kaspSendKill?: (className: string, obj: unknown) => void;
    __kaspSendBattleTime?: (className: string, obj: unknown) => void;
    __kaspSendGrenadeThrow?: (reload?: unknown) => void;
    __kaspSendTankInfo?: (className: string, obj: unknown) => void;
    __kaspSendUserId?: (obj: unknown, idProp: string) => void;
    __kaspSendGarageItem?: (obj: unknown, idProp: string, nameProp: string, categoryProp: string, mountedProp: string) => void;
    // MAIN world only (src/injector.ts): the category the game keeps as the open settings tab when it is the extension's tab,
    // and the function the patched settings tab list calls to add that tab.
    __kaspSettingsTab?: Record<string, unknown>;
    __kaspSettingsTabAdd?: (items: unknown[], make: (key: unknown) => unknown, keyField: string, categoryField: string) => unknown[];
    // MAIN world only: the address of the change column's header picture, read by the game's header code (build-plan 18a).
    __kaspChangeHeader?: string;
    // MAIN world only: called by the game's chat code with each message it adds, and the team message class (build-plan 19).
    __kaspChat?: (event: unknown, teamClass: unknown) => void;
    // MAIN world only (build-plan 24): the time (ms) until which the next shop success dialog is skipped, set by the patched showcase
    // card click and used up by the dialog's mount; and the two functions the patched dialog calls when it draws and when it mounts.
    __kaspShopSkipUntil?: number;
    __kaspShopHide?: (dialog: object) => boolean;
    __kaspShopMounted?: (dialog: object, close: () => void) => void;
    // MAIN world only, defined by src/modules/shop_quick_buy.ts: called by each showcase card the game mounts (adds the Buy all button),
    // and, with the injector's skipped dialog, the signal that a purchase of a running Buy all went through.
    __kaspShopCard?: () => void;
    // Called by each showcase card the game unmounts (takes the Buy all button out, the game reuses its grid for the other shop tabs).
    __kaspShopCardGone?: () => void;
    __kaspShopDialogShown?: () => void;
    kaspLanguage?: KaspLanguage;
    kaspGarageTab?: KaspGarageTabReader;
    kaspOldPictures?: KaspOldPictures;
    kaspSwitches?: KaspSwitches;
    kaspLoadingScreens?: KaspLoadingScreens;
    kaspMessages?: KaspMessages;
    kaspBattle?: KaspBattle;
}
