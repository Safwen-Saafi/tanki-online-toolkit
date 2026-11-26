// The eleven lobby looks' presets (build-plan 26f on), moved out of lobby.ts (audit 2026-11-26, F-85): their types and each look's
// numbers, the owner's final probe presets (blueprint/context/lobby-look-procedure.md says how a look is ported). MAIN world, runs
// before lobby.js, which reads the table from window.__kaspLobbyPresets (without it the lobby keeps the game's own look). The types
// are global (this file is no module), so lobby.ts uses them too; the numbers stay inside this file's own scope.

interface RoadNumbers {
    readonly amount: number;
    readonly reach: number;
    readonly line: number;
    readonly x0: number;
    readonly x1: number;
    readonly feather: number;
    readonly out: number;
    readonly bright: number;
    readonly tone: number;
    readonly fade: number;
    readonly inside: number;
}
// The night lights (the probe's "Night lights" group).
interface NightLights {
    readonly lamps: number;
    readonly reach: number;
    readonly glow: number;
    readonly sunOff: number;
    readonly fixtures: number;
    readonly keyDown: number;
    readonly color: string;
}
// The game-side light and sway (the probe's key, fill, shadow, aniso, lamps, breath, follow and sweep groups). With the picture
// pass the key and fill come from the hour table; these key and fill numbers are then only the light without it.
interface LightNumbers {
    readonly keySide: number;
    readonly keyHeight: number;
    readonly keyStrength: number;
    readonly keyColour: string;
    readonly fillColour: string;
    readonly fillStrength: number;
    readonly shadowSize: number;
    readonly shadowReach: number;
    readonly shadowStrength: number;
    readonly shadowBlur: number;
    readonly sharpness: number;
    readonly lampSpeed: number;
    readonly breathing: number;
    readonly follow: number;
    readonly sweepAmount: number;
    readonly sweepSpeed: number;
}
interface LobbyLook {
    readonly light: LightNumbers;
    readonly time: { readonly hour: number; readonly strength: number; readonly inside: number; readonly sunSide: number };
    readonly door: number;
    // the night lights; null = the probe's night group off (then it is never dark: no night lamps, no night road, no night key
    // light, whatever the hour)
    readonly night: NightLights | null;
    // the probe's "clean walls" (the painted sunlight taken out by day too); 0 = off
    readonly cleanWall: number;
    readonly road: RoadNumbers;
    readonly roadN: RoadNumbers;
    readonly hidden: readonly string[];
    // the overcast (26g1, the probe's "Rainy sky" group); null = off. sky = how grey the sky picture turns, contrast = its cloud
    // contrast, layer = the drifting cloud layer, speed = its drift, tint = the cloud colour, out = how lit the outside stays,
    // beams = how much of the sunbeams is left, dark = how lit the inside stays, lamps = how lit the ring lamp lenses stay
    readonly overcast: {
        readonly sky: number;
        readonly contrast: number;
        readonly layer: number;
        readonly speed: number;
        readonly tint: string;
        readonly out: number;
        readonly beams: number;
        readonly dark: number;
        readonly lamps: number;
    } | null;
    // the normal day's extras (26f3), only by day; null = off
    readonly clouds: { readonly amount: number; readonly cover: number; readonly size: number; readonly speed: number } | null;
    readonly leaves: LeafNumbers | null;
    // the calm city sound, in % of its loudness (0 = off)
    readonly city: number;
    // the night's sounds (26f4d): the night ambience in %, the far dog in % every `every` seconds, how far it is (0 to 1); null = off
    readonly nightSounds: { readonly ambience: number; readonly dogs: number; readonly every: number; readonly far: number } | null;
    // the clear night's extras (26f4a), only when it is dark; null = off
    readonly windows: { readonly amount: number; readonly dense: number; readonly size: number; readonly near: number; readonly far: number; readonly change: number } | null;
    readonly shoot: ShootNumbers | null;
    // the night's street lights (26f4b), only when it is dark; null = off
    readonly streetLamps: {
        readonly count: number;
        readonly start: number;
        readonly gap: number;
        readonly left: number;
        readonly right: number;
        readonly height: number;
        readonly size: number;
        readonly halo: number;
        readonly bright: number;
        readonly color: string;
    } | null;
    readonly red: {
        readonly across: number;
        readonly dist: number;
        readonly height: number;
        readonly size: number;
        readonly halo: number;
        readonly bright: number;
        readonly blink: number;
    } | null;
    // the street lamps' light on the street (needs streetLamps)
    readonly pools: { readonly amount: number; readonly size: number } | null;
    // fireflies over the street and moths round the ring lamps (26f4c), only when it is dark; null = off
    readonly flies: {
        readonly count: number;
        readonly dist: number;
        readonly height: number;
        readonly size: number;
        readonly bright: number;
        readonly speed: number;
        readonly color: string;
    } | null;
    readonly moths: { readonly count: number; readonly size: number; readonly speed: number } | null;
    // the falling rain (26g2, the probe's "Rain" group); null = no rain. drops = how many streaks, speed = how fast they fall,
    // length = streak length, wind = how slanted, width, bright, reach = how far out from the door it rains, splash = how many
    // rings on the street, volume = the hiss in %, color = the rain's colour before the outside's light
    readonly rain: {
        readonly drops: number;
        readonly speed: number;
        readonly length: number;
        readonly wind: number;
        readonly width: number;
        readonly bright: number;
        readonly reach: number;
        readonly splash: number;
        readonly volume: number;
        readonly color: string;
    } | null;
    // the rain's gusts (26g3, the probe's "Gusts" group), only with rain; null = steady rain. every = seconds between gusts (give
    // or take 40 %), heavier = how many more drops at a gust's top, slant = the extra wind, louder = how much louder the rain sounds
    readonly gusts: { readonly every: number; readonly heavier: number; readonly slant: number; readonly louder: number } | null;
    // rain on the roof (26g3): the recording's loudness in %, only with rain (0 = off)
    readonly roof: number;
    // thunder and lightning (26g4, the probe's "Thunder and lightning" group); null = none. every = seconds between strikes (give
    // or take `random` of it), flash = how bright the flashes, bolt = how bright the bolt in the sky, volume = the thunder in %,
    // delay = seconds from the flash to the thunder (26g4b)
    readonly storm: {
        readonly every: number;
        readonly random: number;
        readonly flash: number;
        readonly bolt: number;
        readonly volume: number;
        readonly delay: number;
    } | null;
    // the hangar's lamps flickering when a near thunder starts (26g4b, the probe's "Lamp flicker"); null = none. dark = how deep
    // the dips, length = how long the stutter (seconds), chance = how likely after the loud thunder (less after the others)
    readonly flicker: { readonly dark: number; readonly length: number; readonly chance: number } | null;
    // the lightning shadow (26g4c, the probe's "Lightning shadow"); null = none. While a flash lasts (its pulses held `hold` times
    // longer) the game's own key light swings to come low (`low` degrees up) through the doorway, a new side each strike (up to
    // `spread` degrees), colder and stronger (+ power x 2.5 x the flash), so the tank's real shadow jumps across the floor
    readonly flashShadow: { readonly power: number; readonly low: number; readonly spread: number; readonly hold: number } | null;
    // the drips from the door's top edge (26g5, the probe's "Door drips"), only with rain; null = none. count drops along the edge
    // at height `top`, `out` past the wall line, from `left` to `right` across; speed = how fast they fall, size, bright, splash =
    // the rings where they land
    readonly drips: {
        readonly count: number;
        readonly top: number;
        readonly out: number;
        readonly left: number;
        readonly right: number;
        readonly speed: number;
        readonly bright: number;
        readonly size: number;
        readonly splash: number;
    } | null;
    // the wet floor by the door (26g5, the probe's "Wet floor"); null = dry. amount = how wet, depth = how far in, puddles = how much
    // is standing water, shine = how strongly they mirror, rings = rings in the puddles while it rains
    readonly wet: { readonly amount: number; readonly depth: number; readonly puddles: number; readonly shine: number; readonly rings: number } | null;
    // the plain fog (26h1, the probe's "Fog" group); null = none. density = how thick, start = how far from the eye it begins,
    // height = how low it lies (it thins upward over this), move = how fast it drifts, color = its colour before the outside's light
    readonly fog: { readonly density: number; readonly start: number; readonly height: number; readonly move: number; readonly color: string } | null;
    // the hot sun (the probe's "Hot sun" group; 26h uses only its dust: the foggy night has glare 0 and warmth 0); null = off.
    // glare = the sun's glow added, warmth = how much warmer the light, motes = the specks of dust floating in the hangar
    readonly heat: { readonly glare: number; readonly warmth: number; readonly motes: number } | null;
    // the foggy day's floor fog (26h, the probe's "Floor fog"); null = none. amount, height = its thickness, depth = how far in from
    // the door, speed, lumps, out = how far onto the street, bright
    readonly floorFog: {
        readonly amount: number;
        readonly height: number;
        readonly depth: number;
        readonly speed: number;
        readonly lumps: number;
        readonly out: number;
        readonly bright: number;
    } | null;
    // the fog banks out on the street (26h, the probe's "Fog banks"; the owner's foggy day has them on at amount 0); null = none
    readonly banks: { readonly amount: number; readonly size: number; readonly speed: number; readonly gaps: number; readonly high: number; readonly start: number } | null;
    // the door's light beam (26h, the probe's "Door light beam"), only by day; null = none. down / side = the light's angles in
    // degrees, left / right / top = the door opening, soft = its edge, pool = the lit patch on the floor, dust = the streaks
    readonly beam: {
        readonly amount: number;
        readonly down: number;
        readonly side: number;
        readonly left: number;
        readonly right: number;
        readonly top: number;
        readonly soft: number;
        readonly pool: number;
        readonly dust: number;
        readonly color: string;
    } | null;
    // the foggy night's searchlight (26h, the probe's "Searchlight"), only when it is dark; null = none
    readonly search: {
        readonly across: number;
        readonly dist: number;
        readonly lean: number;
        readonly swing: number;
        readonly speed: number;
        readonly width: number;
        readonly bright: number;
        readonly color: string;
    } | null;
    // the ring lamps' light cones in the fog (26h, the probe's "Lamp cones"), only when it is dark; null = none
    readonly cones: { readonly amount: number; readonly angle: number; readonly reach: number; readonly dust: number; readonly color: string } | null;
    // the very sunny day's extras (26i), only by day; null = none. Heat shimmer: amount, height = how high over the street the hot
    // air wobbles, speed = how fast it rises. Birds: count, height over the street, dist = how far out, size, speed
    readonly shimmer: { readonly amount: number; readonly height: number; readonly speed: number } | null;
    readonly birds: { readonly count: number; readonly height: number; readonly dist: number; readonly size: number; readonly speed: number } | null;
    // the cicadas (26i, the probe's summer sounds), in % of their loudness, only by day (0 = off)
    readonly cicadas: number;
    // the snow (26j, the probe's "Snow"); null = none. flakes = how many fall outside, speed, size, wind, sway = how far each
    // circles as it falls, bright, cover = the snow lying on the ground (0 to 1), reach = how far out it falls, coverBright and
    // coverThick = the lying snow's brightness and thickness, inside = how many flakes are blown into the hangar
    readonly snow: {
        readonly flakes: number;
        readonly speed: number;
        readonly size: number;
        readonly wind: number;
        readonly sway: number;
        readonly bright: number;
        readonly cover: number;
        readonly reach: number;
        readonly coverBright: number;
        readonly coverThick: number;
        readonly inside: number;
    } | null;
    // the snowy look's extras (26j); null / 0 = off. Icicles on the door's top edge (count, top = their height, out = past the
    // wall line, left / right across, length, width, glint); the snow drift inside the door (amount, depth = how far in, left /
    // right, sparkle); the lying snow's sparkle by day; the wind and snowfall sounds in %; the snow gusts (every seconds, strength,
    // length in seconds, sound = how much louder the wind gets); the flakes glowing near the street lamps at night (amount, reach)
    readonly icicles: {
        readonly count: number;
        readonly top: number;
        readonly out: number;
        readonly left: number;
        readonly right: number;
        readonly length: number;
        readonly width: number;
        readonly glint: number;
    } | null;
    readonly snowDrift: { readonly amount: number; readonly depth: number; readonly left: number; readonly right: number; readonly sparkle: number } | null;
    readonly sparkle: number;
    readonly snowSounds: { readonly volume: number; readonly fall: number } | null;
    readonly snowGusts: { readonly every: number; readonly strength: number; readonly length: number; readonly sound: number } | null;
    readonly snowGlow: { readonly amount: number; readonly reach: number } | null;
    // a seasonal outside (26k, the probe's "Seasonal outside"); null = the game's own. season = the hangar's files in hangars/
    // (<season>-object.3ds and its pictures), bright = its brightness, own = how much it keeps its own colours (the time colours
    // touch it only lightly), mix / mixDepth = the hangar floor turning into its ground near the door, and how far in. The game's
    // sky, town and transp2 are hidden while it is on (the probe's automatic hiding).
    // x0 / x1 / feather (owner 2026-11-22): the blend's soft side edges, as the road's door left / right and edge soft; feather 0 = none.
    // line / out / fade / inside / tone (owner 2026-11-22, as the road's slide, cover outside, outside fade, inside bright and hangar
    // colour): fade above 0 carries the blend out over the street and fades it into the season's own ground (0 = it stops 45 past
    // the door line, as before)
    readonly outside: {
        readonly season: string;
        readonly bright: number;
        readonly own: number;
        readonly mix: number;
        readonly mixDepth: number;
        readonly x0: number;
        readonly x1: number;
        readonly feather: number;
        readonly line: number;
        readonly out: number;
        readonly fade: number;
        readonly inside: number;
        readonly tone: number;
    } | null;
    // the Halloween night's extras (26k); null = none. Pumpkins (the Halloween hangar's own, at its places on the floor): glow =
    // their faces and candles, pool = the candle light round them, flicker. Wisps among the trees (count, from near to far out,
    // height, size, bright, speed, colour). Bats over the town (count, height, dist, size, speed; inside > 0.5 = one now and then
    // flies into the hangar, about every `every` seconds). String lights over the door and along the side wall (door / wall on at
    // > 0.5, their heights, sag, gap between bulbs, bright, blink). Webs in the door's top corners (size, amount, top, left, right).
    // Haunt = the lamp flicker by itself about every `every` seconds (needs `flicker`). Spooky sounds in % (owl, wolf, creak),
    // each about every `every` seconds.
    readonly pumpkins: { readonly glow: number; readonly pool: number; readonly flicker: number } | null;
    readonly wisps: {
        readonly count: number;
        readonly near: number;
        readonly far: number;
        readonly height: number;
        readonly size: number;
        readonly bright: number;
        readonly speed: number;
        readonly color: string;
    } | null;
    readonly bats: {
        readonly count: number;
        readonly height: number;
        readonly dist: number;
        readonly size: number;
        readonly speed: number;
        readonly inside: number;
        readonly every: number;
    } | null;
    readonly stringLights: {
        readonly door: number;
        readonly wall: number;
        readonly doorZ: number;
        readonly wallZ: number;
        readonly sag: number;
        readonly gap: number;
        readonly bright: number;
        readonly blink: number;
    } | null;
    readonly webs: { readonly size: number; readonly amount: number; readonly top: number; readonly left: number; readonly right: number } | null;
    readonly haunt: { readonly every: number } | null;
    readonly spooky: { readonly owl: number; readonly wolf: number; readonly creak: number; readonly every: number } | null;
    // the Christmas night's extras (26l); null = none. The tree: one of the Christmas hangar's two (kind > 0.5 = the slimmer Pine,
    // else Pine_Big) moved to (x, y), turned (degrees) and sized, with `count` bulbs on a spiral (lights = their brightness, blink
    // = how fast they twinkle), a star on top and a warm glow (pool) on the floor round it. The gifts round the tree's foot on the
    // camera's side (count, size; they need the tree). The Christmas lights over the door and along the side wall (as the
    // Halloween string lights, in red, green, gold and white).
    readonly tree: {
        readonly kind: number;
        readonly x: number;
        readonly y: number;
        readonly turn: number;
        readonly size: number;
        readonly count: number;
        readonly lights: number;
        readonly blink: number;
        readonly star: number;
        readonly pool: number;
    } | null;
    readonly gifts: { readonly count: number; readonly size: number } | null;
    readonly xmasLights: {
        readonly door: number;
        readonly wall: number;
        readonly doorZ: number;
        readonly wallZ: number;
        readonly sag: number;
        readonly gap: number;
        readonly bright: number;
        readonly blink: number;
    } | null;
    // The Christmas hangar's own fireplace (26l, the probe's v1.88 xmFire, owner 2026-11-22); null = none. Its back stands at (x, y),
    // its front turned (degrees, 0 = into the room from the right wall), sized; logs = the log pile (1 = on the camera's side, -1 =
    // on the door's side, 0 = none), rug (1 = yes); flames (how many), fire (their size), bright (their brightness), sparks (how
    // many); light = its warm light on what is round it, reach = how far that light goes; sound = the crackling fire's loudness in %.
    // The screens it replaces on the right wall are removed by hangar_files.ts (the Christmas look only).
    readonly fireplace: {
        readonly x: number;
        readonly y: number;
        readonly turn: number;
        readonly size: number;
        readonly logs: number;
        readonly rug: number;
        readonly flames: number;
        readonly fire: number;
        readonly bright: number;
        readonly sparks: number;
        readonly light: number;
        readonly reach: number;
        readonly sound: number;
    } | null;
}
interface ShootNumbers {
    readonly every: number;
    readonly bright: number;
    readonly length: number;
    readonly speed: number;
    readonly width: number;
    readonly height: number;
}
interface LeafNumbers {
    readonly count: number;
    readonly dist: number;
    readonly inside: number;
    readonly size: number;
    readonly wind: number;
    readonly gusts: number;
}

(function () {
    'use strict';

    const DAY_NORMAL: LobbyLook = {
        // the owner's final "day normal" (probe v1.68, report of 2026-11-20 14:13); the night normal keeps it
        light: {
            keySide: -105,
            keyHeight: 40,
            keyStrength: 1.95,
            keyColour: '#ffe9cf',
            fillColour: '#9fb4d6',
            fillStrength: 0.7,
            shadowSize: 2048,
            shadowReach: 0.55,
            shadowStrength: 0.75,
            shadowBlur: 0.4,
            sharpness: 16,
            lampSpeed: 0.52,
            breathing: 1.5,
            follow: 40,
            sweepAmount: 5,
            sweepSpeed: 0.25,
        },
        time: { hour: 13, strength: 1, inside: 0.7, sunSide: 0 },
        door: 1,
        night: { lamps: 0.35, reach: 0.85, glow: 0, sunOff: 1, fixtures: 1, keyDown: 1, color: '#fff3e0' },
        cleanWall: 0,
        road: { amount: 0.55, reach: 1175, line: 0, x0: -860, x1: 700, feather: 160, out: 45, bright: 1, tone: 0, fade: 0, inside: 1 },
        roadN: { amount: 1.5, reach: 1650, line: 700, x0: -1110, x1: 780, feather: 360, out: 0, bright: 1.15, tone: 0.1, fade: 1500, inside: 1 },
        hidden: ['transp1'],
        overcast: null,
        clouds: { amount: 0.9, cover: 0.6, size: 1, speed: 1 },
        leaves: { count: 44, dist: 2150, inside: 0, size: 4, wind: 2.9, gusts: 0.95 },
        city: 70,
        nightSounds: null,
        windows: null,
        shoot: null,
        streetLamps: null,
        red: null,
        pools: null,
        flies: null,
        moths: null,
        rain: null,
        gusts: null,
        roof: 0,
        storm: null,
        flicker: null,
        flashShadow: null,
        drips: null,
        wet: null,
        fog: null,
        heat: null,
        floorFog: null,
        banks: null,
        beam: null,
        search: null,
        cones: null,
        shimmer: null,
        birds: null,
        cicadas: 0,
        snow: null,
        icicles: null,
        snowDrift: null,
        sparkle: 0,
        snowSounds: null,
        snowGusts: null,
        snowGlow: null,
        outside: null,
        pumpkins: null,
        wisps: null,
        bats: null,
        stringLights: null,
        webs: null,
        haunt: null,
        spooky: null,
        tree: null,
        gifts: null,
        xmasLights: null,
        fireplace: null,
    };
    const NIGHT_NORMAL: LobbyLook = {
        ...DAY_NORMAL,
        time: { hour: 23, strength: 1, inside: 0.7, sunSide: 0 },
        // the night lights: the owner's light panel report (lobby-night-lights.json, 2026-11-21 15:01)
        night: { lamps: 1.25, reach: 0.55, glow: 0, sunOff: 1, fixtures: 0.95, keyDown: 1, color: '#fff8cc' },
        cleanWall: 1,
        hidden: ['light0', 'light1', 'light2', 'transp1', 'transp2'],
        clouds: null,
        leaves: null,
        city: 0,
        nightSounds: { ambience: 135, dogs: 60, every: 30, far: 0.6 },
        windows: { amount: 0.65, dense: 0.68, size: 1, near: 3700, far: 8200, change: 0 },
        shoot: { every: 21, bright: 1.6, length: 0.35, speed: 1.25, width: 1.05, height: 1 },
        streetLamps: { count: 3, start: 1325, gap: 500, left: -1210, right: 1040, height: 320, size: 1.35, halo: 1, bright: 2.1, color: '#ffd06b' },
        red: { across: -500, dist: 4000, height: 400, size: 1, halo: 1.8, bright: 1, blink: 1.6 },
        pools: { amount: 3, size: 1.6 },
        flies: { count: 120, dist: 3100, height: 305, size: 1.2, bright: 3.25, speed: 2.2, color: '#d4ff6a' },
        moths: { count: 3, size: 1.1, speed: 0.25 },
    };
    // The Day look itself: the owner's review panel report of 2026-11-22 over the day normal. Only this look: the other looks built on
    // DAY_NORMAL keep its numbers (sun side 43, shadow map 4096 and reach 0.4, door blend 0.1, the road wider and softer, more and
    // faster clouds, 49 leaves, the city at 84 %).
    const DAY_LOOK: LobbyLook = {
        ...DAY_NORMAL,
        light: { ...DAY_NORMAL.light, shadowSize: 4096, shadowReach: 0.4 },
        time: { hour: 13, strength: 1, inside: 0.7, sunSide: 43 },
        door: 0.1,
        road: { amount: 0.75, reach: 1175, line: 0, x0: -1000, x1: 700, feather: 400, out: 0, bright: 1, tone: 0, fade: 0, inside: 0.85 },
        clouds: { amount: 1, cover: 0.45, size: 0.85, speed: 4.75 },
        leaves: { count: 49, dist: 2150, inside: 0, size: 4, wind: 2.9, gusts: 0.95 },
        city: 84,
    };
    // The Night look itself: the owner's review panel report of 2026-11-22 over the night normal. Only this look: Halloween, built on
    // NIGHT_NORMAL, keeps its numbers (midnight, shadow map 4096, reach 0.7 and strength 0.55, lamp spin 0.38, door blend 0.1, a
    // brighter floor pool, a new night road, more and bigger lit windows, a shooting star every 5 s, new street lamps and red light,
    // brighter fireflies).
    const NIGHT_LOOK: LobbyLook = {
        ...NIGHT_NORMAL,
        light: { ...NIGHT_NORMAL.light, shadowSize: 4096, shadowReach: 0.7, shadowStrength: 0.55, lampSpeed: 0.38 },
        time: { hour: 24, strength: 1, inside: 0.7, sunSide: 0 },
        door: 0.1,
        // the owner's second report of 2026-11-22: floor pool 1.05, light from the lamps 0.5; the street lamps higher, smaller, dimmer
        night: { lamps: 1.05, reach: 0.55, glow: 0, sunOff: 1, fixtures: 1, keyDown: 0.5, color: '#fff8cc' },
        roadN: { amount: 3, reach: 1325, line: 45, x0: -1190, x1: 900, feather: 400, out: 0, bright: 1.15, tone: 0.15, fade: 3000, inside: 1.05 },
        windows: { amount: 0.95, dense: 1, size: 2.25, near: 3600, far: 8200, change: 0 },
        shoot: { every: 5, bright: 1.6, length: 0.44, speed: 1.35, width: 1.35, height: 1.6 },
        streetLamps: { count: 3, start: 1225, gap: 350, left: -1140, right: 1020, height: 580, size: 1, halo: 2, bright: 1.7, color: '#ffd06b' },
        red: { across: -600, dist: 4000, height: 270, size: 0.5, halo: 1.8, bright: 0.95, blink: 1.6 },
        flies: { count: 120, dist: 3100, height: 305, size: 1.2, bright: 3.65, speed: 2.2, color: '#d4ff6a' },
    };
    // The owner's final "day rainy" (probe v1.52 DAY_RAINY, report of 2026-11-19 21:33; its base look of 2026-11-18 20:59), every group
    // it has on (the others are off in it): noon, the grey sky, the darker inside and outside, clean walls, the rain (26g2), its gusts
    // and roof (26g3), the lightning, thunder, flicker and lightning shadow (26g4), the drips and the wet floor (26g5).
    const DAY_RAINY: LobbyLook = {
        ...DAY_NORMAL,
        light: {
            keySide: -132,
            keyHeight: 42,
            keyStrength: 2,
            keyColour: '#ffe9cf',
            fillColour: '#9fb4d6',
            fillStrength: 0.5,
            shadowSize: 2048,
            shadowReach: 0.35,
            shadowStrength: 0.65,
            shadowBlur: 0.3,
            sharpness: 16,
            lampSpeed: 1,
            breathing: 0.65,
            follow: 80,
            sweepAmount: 0,
            sweepSpeed: 1.3,
        },
        time: { hour: 12, strength: 1, inside: 1, sunSide: 1 },
        door: 0.1,
        // the probe's night group is off on the rainy day
        night: null,
        cleanWall: 1,
        road: { amount: 3, reach: 1575, line: 640, x0: -1030, x1: 810, feather: 400, out: 1000, bright: 0.9, tone: 0, fade: 3000, inside: 1 },
        // every sunbeam part hidden (owner, 2026-11-21: "remove all of the god rays from the day and night rainy"; the probe kept
        // transp2 at the overcast's 0.15 by day), and the ring lamps' halo
        hidden: ['light0', 'light1', 'light2', 'transp1', 'transp2'],
        overcast: { sky: 0.95, contrast: 1, layer: 1, speed: 0.7, tint: '#838991', out: 0.45, beams: 0.15, dark: 0.55, lamps: 0 },
        clouds: null,
        leaves: null,
        city: 0,
        // the owner's rain numbers and gusts (the same in the night rainy)
        rain: { drops: 14500, speed: 1.05, length: 1.1, wind: 0.35, width: 1.4, bright: 1.25, reach: 4700, splash: 1, volume: 100, color: '#cfd8e2' },
        gusts: { every: 14, heavier: 0.8, slant: 0.7, louder: 0.6 },
        roof: 80,
        storm: { every: 20, random: 0.3, flash: 1.35, bolt: 1, volume: 100, delay: 1.8 },
        flicker: { dark: 0.65, length: 1.3, chance: 1 },
        flashShadow: { power: 1.5, low: 16, spread: 30, hold: 2.5 },
        drips: { count: 90, top: 1330, out: 25, left: -1000, right: 780, speed: 1, bright: 1.9, size: 1.8, splash: 1.8 },
        wet: { amount: 1, depth: 470, puddles: 0.6, shine: 1, rings: 1 },
    };
    // The owner's final "night rainy" (probe v1.71 NIGHT_RAINY, report of 2026-11-20 15:57): the rainy day at 23:00 with the night
    // lamps, the night road and a wider, shinier wet floor.
    const NIGHT_RAINY: LobbyLook = {
        ...DAY_RAINY,
        time: { hour: 23, strength: 1, inside: 0, sunSide: -1 },
        night: { lamps: 1.4, reach: 0.8, glow: 0, sunOff: 1, fixtures: 0.4, keyDown: 1, color: '#fff3e0' },
        // the owner's review panel report of 2026-11-22: shadow map 4096, a stronger, wider night road, a darker grey rain
        light: { ...DAY_RAINY.light, shadowSize: 4096 },
        roadN: { amount: 3, reach: 1650, line: 700, x0: -1110, x1: 900, feather: 400, out: 0, bright: 1.15, tone: 0.1, fade: 1500, inside: 1.25 },
        rain: { drops: 14500, speed: 1.05, length: 1.1, wind: 0.35, width: 1.4, bright: 1.25, reach: 4700, splash: 1, volume: 100, color: '#97999b' },
        // the night's wider, shinier wet floor
        wet: { amount: 1, depth: 660, puddles: 0.55, shine: 1.6, rings: 1.25 },
    };
    // The Day, rainy look itself: the owner's review panel report of 2026-11-22 over the rainy day. Only this look: the rainy night,
    // built on DAY_RAINY, keeps its numbers (shadow map 4096, reach 0.4, lamp spin 0.74, a shorter, softer road, the sky fully grey with
    // faster clouds, sunbeams 1 (every sunbeam part stays hidden, so no god rays come back), the ring lamp lenses half lit, more drops).
    const DAY_RAINY_LOOK: LobbyLook = {
        ...DAY_RAINY,
        light: { ...DAY_RAINY.light, shadowSize: 4096, shadowReach: 0.4, lampSpeed: 0.74 },
        road: { ...DAY_RAINY.road, amount: 2.35, reach: 1350 },
        overcast: { sky: 1, contrast: 1, layer: 1, speed: 2.4, tint: '#838991', out: 0.45, beams: 1, dark: 0.55, lamps: 0.5 },
        rain: { drops: 15500, speed: 1.05, length: 1.1, wind: 0.35, width: 1.4, bright: 1.25, reach: 4700, splash: 1, volume: 100, color: '#cfd8e2' },
    };
    // The owner's final "day very sunny" (probe v1.64 DAY_SUNNY, report of 2026-11-20 11:13; its own key light and lamp speed of v1.68):
    // the normal day with the hot sun (glare, warmth, dust in the light), door blend 3, its road, the heat shimmer, four birds, the
    // summer sounds (the city loop at 100 % and the cicadas at 65 %); no white clouds or leaves; only transp1 hidden, the game's own floor.
    // The owner's review panel report of 2026-11-22 ("very sunny is done"): sun side 90, shadow map 4096 and reach 0.45, door blend
    // 0.1, a new floor into the road, the shimmer up to 600, the cicadas at 90 %.
    const DAY_SUNNY: LobbyLook = {
        ...DAY_NORMAL,
        light: { ...DAY_NORMAL.light, keySide: -44, keyHeight: 31, keyStrength: 1.95, keyColour: '#ffe9cf', lampSpeed: 0.38, shadowSize: 4096, shadowReach: 0.45 },
        time: { hour: 13, strength: 1, inside: 0.7, sunSide: 90 },
        door: 0.1,
        road: { amount: 1.1, reach: 575, line: 30, x0: -980, x1: 670, feather: 140, out: 1000, bright: 1, tone: 0, fade: 3000, inside: 0.95 },
        clouds: null,
        leaves: null,
        city: 100,
        heat: { glare: 3, warmth: 1.5, motes: 3450 },
        shimmer: { amount: 1.2, height: 600, speed: 1 },
        birds: { count: 4, height: 760, dist: 4200, size: 2, speed: 1 },
        cicadas: 90,
    };
    // The owner's final "day snowy" (probe v1.74 DAY_SNOWY, report of 2026-11-20 17:13): noon with a soft, cool light, the falling
    // snow and the snow lying on the street (with its sparkle), a little fog and floor fog, a light grey sky, clean walls, the icicles,
    // the drift inside the door, the snow gusts and the wind and snowfall sounds; the sunbeams hidden.
    const DAY_SNOWY: LobbyLook = {
        ...DAY_NORMAL,
        light: {
            ...DAY_NORMAL.light,
            keySide: -105,
            keyHeight: 38,
            keyStrength: 1.5,
            keyColour: '#fff1e0',
            fillColour: '#cfe0f5',
            fillStrength: 1,
            shadowStrength: 0.45,
            shadowSize: 2048,
            shadowReach: 0.55,
            shadowBlur: 0.7,
        },
        time: { hour: 12, strength: 1, inside: 0.85, sunSide: 0 },
        cleanWall: 1,
        road: { ...DAY_NORMAL.road, inside: 1.2 },
        hidden: ['light0', 'light1', 'light2'],
        overcast: { sky: 0.95, contrast: 0.7, layer: 0.6, speed: 0.5, tint: '#c9d0d9', out: 0.85, beams: 0.2, dark: 0.9, lamps: 1 },
        clouds: null,
        leaves: null,
        city: 0,
        fog: { density: 0.55, start: 900, height: 140, move: 0.3, color: '#dfe6ef' },
        floorFog: { amount: 0.6, height: 60, depth: 700, speed: 1, lumps: 0.8, out: 1000, bright: 1 },
        snow: { flakes: 30000, speed: 1.3, size: 1.2, wind: 0.05, sway: 1.25, bright: 1, cover: 0.4, reach: 2600, coverBright: 1, coverThick: 1, inside: 100 },
        icicles: { count: 68, top: 590, out: 25, left: -1000, right: 780, length: 240, width: 2, glint: 1 },
        snowDrift: { amount: 0.35, depth: 610, left: -890, right: 600, sparkle: 0.1 },
        sparkle: 0.25,
        snowSounds: { volume: 100, fall: 80 },
        snowGusts: { every: 10, strength: 1.25, length: 3, sound: 2.15 },
    };
    // The Day, snowy look itself: the owner's review panel report of 2026-11-22 over the snowy day. Only this look: the snowy night
    // and Christmas, built on DAY_SNOWY, keep its numbers (sun side -1, shadow map 4096, reach 0.35, softness 0.2, a new brighter
    // road, the fog from the eye on and drifting faster, the floor fog further onto the street, thicker lying snow and more flakes
    // inside, icicles a little higher and thinner, the snow glints at 1.15).
    const DAY_SNOWY_LOOK: LobbyLook = {
        ...DAY_SNOWY,
        time: { hour: 12, strength: 1, inside: 0.85, sunSide: -1 },
        light: { ...DAY_SNOWY.light, shadowSize: 4096, shadowReach: 0.35, shadowBlur: 0.2 },
        road: { amount: 0.55, reach: 825, line: 230, x0: -770, x1: 740, feather: 400, out: 0, bright: 3, tone: 0, fade: 0, inside: 2.5 },
        fog: { density: 0.55, start: 0, height: 100, move: 2.65, color: '#dfe6ef' },
        floorFog: { amount: 0.6, height: 60, depth: 700, speed: 1, lumps: 0.6, out: 2675, bright: 1 },
        snow: { flakes: 30000, speed: 1.3, size: 1.2, wind: 0.05, sway: 1.25, bright: 1, cover: 0.4, reach: 2500, coverBright: 1, coverThick: 3, inside: 200 },
        icicles: { count: 68, top: 595, out: 25, left: -1000, right: 780, length: 240, width: 1.9, glint: 1 },
        sparkle: 1.15,
    };
    // The owner's final "night snowy" (probe v1.75 NIGHT_SNOWY, report of 2026-11-20 17:25): the snowy day at 23:00, less snow on
    // the ground, door blend 0.1, a darker, warm-tinted sky, the probe's clear-night lights, street lamps, red light and lit windows,
    // the lamps' light on the street, the flakes glowing near the street lamps, the wind louder; no drift or sparkle. The probe's own
    // numbers throughout (owner 2026-11-21: "always follow the same numbers as in the probe"), not our Night look's later retune.
    const NIGHT_SNOWY: LobbyLook = {
        ...DAY_SNOWY,
        time: { hour: 23, strength: 1, inside: 0.25, sunSide: 90 },
        snow: { flakes: 30000, speed: 1.3, size: 1.2, wind: 0.05, sway: 1.25, bright: 1, cover: 0.35, reach: 2600, coverBright: 1, coverThick: 1, inside: 100 },
        door: 0.1,
        night: { lamps: 0.95, reach: 0.75, glow: 0, sunOff: 1, fixtures: 0, keyDown: 0.55, color: '#f9ec9a' },
        hidden: ['light0', 'light1', 'light2', 'transp1', 'transp2'],
        overcast: { sky: 0.95, contrast: 0.6, layer: 0.5, speed: 0.5, tint: '#8f7b6b', out: 0.6, beams: 0, dark: 0.8, lamps: 1 },
        snowDrift: null,
        sparkle: 0,
        snowSounds: { volume: 164, fall: 80 },
        streetLamps: { count: 3, start: 1325, gap: 500, left: -1210, right: 1040, height: 320, size: 1.35, halo: 1, bright: 2.1, color: '#ffd06b' },
        red: { across: -500, dist: 4000, height: 400, size: 1, halo: 1.8, bright: 1, blink: 1.6 },
        windows: { amount: 0.65, dense: 0.68, size: 1, near: 3700, far: 8200, change: 0 },
        pools: { amount: 3.5, size: 1.6 },
        snowGlow: { amount: 3.5, reach: 1.1 },
    };
    // The Night, snowy look itself: the owner's review panel report of 2026-11-22 over the snowy night. Only this look: Christmas,
    // built on NIGHT_SNOWY, keeps its numbers (the moon from the other side, shadow map 4096, a softer floor pool, a new night road,
    // the fog higher and thinner, the floor fog at 0, faster, brighter snow reaching further, thicker lying snow, new icicles, less
    // flake glow, brighter, changing windows, four street lamps, a smaller lamp light on the street, the red light moved).
    const NIGHT_SNOWY_LOOK: LobbyLook = {
        ...NIGHT_SNOWY,
        time: { hour: 23, strength: 1, inside: 0.25, sunSide: 180 },
        light: { ...NIGHT_SNOWY.light, shadowSize: 4096, shadowReach: 0.4, shadowStrength: 0.55, shadowBlur: 0.4 },
        night: { lamps: 0.4, reach: 0.75, glow: 0, sunOff: 1, fixtures: 1, keyDown: 1, color: '#fffce5' },
        roadN: { amount: 1.55, reach: 1625, line: 55, x0: -1180, x1: 900, feather: 400, out: 0, bright: 1.4, tone: 0.15, fade: 3000, inside: 1.05 },
        overcast: { sky: 0.95, contrast: 0.6, layer: 0.45, speed: 0.9, tint: '#8f7b6b', out: 0.6, beams: 0, dark: 0.8, lamps: 1 },
        fog: { density: 0.35, start: 900, height: 1200, move: 3, color: '#dfe6ef' },
        floorFog: { amount: 0, height: 60, depth: 700, speed: 1, lumps: 0.8, out: 1000, bright: 1 },
        snow: { flakes: 23500, speed: 1.6, size: 1.2, wind: 0.05, sway: 1.25, bright: 1.2, cover: 0.35, reach: 5100, coverBright: 1, coverThick: 3, inside: 50 },
        icicles: { count: 71, top: 615, out: -5, left: -1000, right: 780, length: 240, width: 2, glint: 0.55 },
        snowGlow: { amount: 1.25, reach: 1.1 },
        windows: { amount: 3, dense: 0.86, size: 1.4, near: 2500, far: 16000, change: 5 },
        streetLamps: { count: 4, start: 1150, gap: 375, left: -1210, right: 1040, height: 460, size: 1.35, halo: 0.7, bright: 2.3, color: '#ffd06b' },
        pools: { amount: 3.5, size: 0.45 },
        red: { across: -725, dist: 4000, height: 400, size: 1, halo: 1.8, bright: 1, blink: 1.6 },
    };
    // The owner's final Halloween (probe v1.79 HALLOWEEN, report of 2026-11-20 18:53 without its lightning and thunder, which the
    // owner dropped): the probe's clear night (its own numbers) with the Halloween outside, the night colour reaching fully inside, the
    // Halloween lamps off, no ground fog (on at 0), the night ambience (dog every 45 s) and a little wind, the lamp flicker every
    // 20 s, the pumpkins, wisps, bats (one inside every ~30 s), string lights, webs and spooky sounds; no town windows, street lamps,
    // red light, shooting stars, fireflies or moths.
    const HALLOWEEN: LobbyLook = {
        ...NIGHT_NORMAL,
        time: { hour: 23, strength: 1, inside: 1.5, sunSide: 0 },
        // the owner's review panel report of 2026-11-22: shadow map 4096, door blend 0.1, a brighter outside whose floor blend runs
        // 1000 past a line slid 100 out (it covers the hard cut 40 past the door: no zig-zag line) with soft sides, closer, brighter,
        // faster string lights, smaller webs
        light: { ...NIGHT_NORMAL.light, shadowSize: 4096 },
        // (the owner's second report of the same day: blend reach 1150, edge soft 30, slide 170)
        outside: { season: 'halloween2024', bright: 1.25, own: 0.85, mix: 1, mixDepth: 1150, x0: -890, x1: 900, feather: 30, line: 170, out: 1000, fade: 0, inside: 1, tone: 0 },
        night: { lamps: 0.95, reach: 0.6, glow: 0, sunOff: 1, fixtures: 0, keyDown: 1, color: '#f9ec9a' },
        door: 0.1,
        cleanWall: 1,
        windows: null,
        shoot: null,
        flies: null,
        moths: null,
        pools: null,
        streetLamps: null,
        red: null,
        nightSounds: { ambience: 100, dogs: 40, every: 45, far: 0.8 },
        snowSounds: { volume: 60, fall: 0 },
        fog: null,
        floorFog: { amount: 0, height: 40, depth: 975, speed: 0.5, lumps: 1, out: 0, bright: 0.6 },
        storm: null,
        flicker: { dark: 0.6, length: 1.1, chance: 1 },
        pumpkins: { glow: 1, pool: 1, flicker: 1 },
        wisps: { count: 24, near: 900, far: 3800, height: 220, size: 1.6, bright: 1.4, speed: 0.5, color: '#9fe8d0' },
        bats: { count: 6, height: 700, dist: 3000, size: 1.6, speed: 1.2, inside: 1, every: 30 },
        stringLights: { door: 1, wall: 1, doorZ: 640, wallZ: 600, sag: 49, gap: 50, bright: 2.5, blink: 1.8 },
        webs: { size: 155, amount: 0.4, top: 600, left: -940, right: 690 },
        haunt: { every: 20 },
        // the door creak taken out (owner 2026-11-22)
        spooky: { owl: 80, wolf: 70, creak: 0, every: 25 },
    };
    // The owner's final Christmas (probe v1.87 CHRISTMAS, report of 2026-11-20 21:36, "only one preset for Christmas"): the probe's
    // snowy night at hour 24 (inside 0.8, moon side 180) with the New Year outside brighter (2.1, keeps its look 0.8, blend reach 500),
    // warm lamps with the Halloween lamps at 0.6, heavy snow with wind (less on the ground, thinner), 33 shorter icicles, gusts every
    // 10 s, the wind louder; the tree with 96 bulbs, its star and glow, 9 gifts, the Christmas lights. No fog, drift, glints, grey sky,
    // flake glow, street lamps, red light, town windows or lamp light on the street.
    const CHRISTMAS: LobbyLook = {
        ...NIGHT_SNOWY,
        // the owner's review panel report of 2026-11-22: the inside lit fully by the night colour, shadow map 4096 and stronger, softer
        // warmer lamps, the outside dimmer keeping its own look with its blend carried out over the street and faded (no cut line),
        // faster, dimmer snow reaching further, thinner lying snow, 49 icicles, the tree moved and bigger, the fireplace retuned
        light: { ...NIGHT_SNOWY.light, shadowSize: 4096, shadowReach: 0.4, shadowStrength: 0.9, shadowBlur: 0.4 },
        outside: { season: 'newyear2025', bright: 1.4, own: 1, mix: 1, mixDepth: 775, x0: -1030, x1: 830, feather: 400, line: -30, out: 1000, fade: 3000, inside: 1, tone: 0 },
        time: { hour: 24, strength: 1, inside: 1, sunSide: 180 },
        night: { lamps: 0.3, reach: 1, glow: 0, sunOff: 1, fixtures: 1, keyDown: 1, color: '#ffe2bd' },
        door: 0.1,
        overcast: null,
        fog: null,
        floorFog: null,
        banks: null,
        snow: { flakes: 21000, speed: 1.85, size: 1.4, wind: 1, sway: 1.25, bright: 0.75, cover: 0.35, reach: 5400, coverBright: 1.4, coverThick: 0.2, inside: 50 },
        icicles: { count: 49, top: 590, out: 25, left: -1000, right: 780, length: 190, width: 2, glint: 0.95 },
        snowDrift: null,
        sparkle: 0,
        snowGusts: { every: 10, strength: 1.25, length: 3, sound: 2.15 },
        snowSounds: { volume: 164, fall: 80 },
        snowGlow: null,
        streetLamps: null,
        red: null,
        windows: null,
        pools: null,
        tree: { kind: 0, x: -1090, y: -1520, turn: 65, size: 1.5, count: 96, lights: 4, blink: 2.2, star: 2.5, pool: 4 },
        gifts: { count: 9, size: 0.9 },
        xmasLights: { door: 1, wall: 1, doorZ: 625, wallZ: 610, sag: 49, gap: 65, bright: 4, blink: 3.15 },
        // the fireplace (owner 2026-11-22: "on the right wall"), where the screens stood, tuned live in the review panel
        fireplace: { x: -1310, y: -867, turn: 0, size: 1.04, logs: 1, rug: 1, flames: 7, fire: 1.85, bright: 1.25, sparks: 24, light: 1, reach: 1200, sound: 100 },
    };
    // The owner's final "day foggy" (probe v1.56 DAY_FOGGY, report of 2026-11-20 09:43): the very sunny look (its key light, lamp speed,
    // door blend and road, written out here; the sunny look itself is 26i) with the heat off, the moving low fog, clean walls and every
    // sunbeam part hidden; the floor fog, the door beam and the fog banks (on at the owner's 0, so they draw nothing).
    const DAY_FOGGY: LobbyLook = {
        ...DAY_NORMAL,
        light: { ...DAY_NORMAL.light, keySide: -44, keyHeight: 31, keyStrength: 1.95, keyColour: '#ffe9cf', lampSpeed: 0.38 },
        door: 3,
        cleanWall: 1,
        road: { amount: 0.55, reach: 1175, line: 0, x0: -930, x1: 670, feather: 160, out: 45, bright: 1.05, tone: 0, fade: 0, inside: 1 },
        hidden: ['light0', 'light1', 'light2', 'transp1', 'transp2'],
        clouds: null,
        leaves: null,
        city: 0,
        fog: { density: 1.6, start: 1550, height: 100, move: 3, color: '#c3cad3' },
        floorFog: { amount: 0.9, height: 95, depth: 900, speed: 2, lumps: 1, out: 1375, bright: 1 },
        banks: { amount: 0, size: 2450, speed: 1, gaps: 0.9, high: 250, start: 600 },
        beam: { amount: 1, down: 5, side: 12, left: -1000, right: 1000, top: 300, soft: 10, pool: 0.5, dust: 0.6, color: '#fff1d6' },
    };
    // The Day, foggy look itself: the owner's review panel report of 2026-11-22 over the foggy day. Only this look: the foggy night,
    // built on DAY_FOGGY, keeps its numbers (shadow map 4096, no shadows, still lamps, a stronger, shorter road, thinner fog, a
    // lumpier, thinner floor fog, no fog banks, the door beam stronger and turned to the other side).
    const DAY_FOGGY_LOOK: LobbyLook = {
        ...DAY_FOGGY,
        light: { ...DAY_FOGGY.light, shadowSize: 4096, shadowReach: 0.25, shadowStrength: 0, shadowBlur: 0, lampSpeed: 0 },
        road: { ...DAY_FOGGY.road, amount: 1.55, reach: 725 },
        fog: { density: 0.9, start: 1550, height: 100, move: 3, color: '#c3cad3' },
        floorFog: { amount: 0.95, height: 80, depth: 900, speed: 2, lumps: 0.7, out: 1375, bright: 1 },
        banks: null,
        beam: { amount: 1.1, down: 5, side: -9, left: -940, right: 1000, top: 300, soft: 10, pool: 0.5, dust: 0.6, color: '#fff1d6' },
    };
    // The owner's final "night foggy" (probe v1.60 NIGHT_FOGGY, report of 2026-11-20 10:35): the foggy day at 23:00 with its own
    // thicker, almost still fog, the walls not cleaned, transp2 kept, the street lamps, the red light and the night sounds. The night
    // lights are the probe's own (as the day normal's), not the clear night's later report. Its searchlight, lamp cones and floating dust.
    const NIGHT_FOGGY: LobbyLook = {
        ...DAY_FOGGY,
        time: { hour: 23, strength: 1, inside: 0.7, sunSide: 0 },
        // the owner's review panel report of 2026-11-22: shadow map 4096, reach 0.4, softness 0.5, door blend 1.55, softer night
        // lights reaching further, clean walls, a new night road
        light: { ...DAY_FOGGY.light, shadowSize: 4096, shadowReach: 0.4, shadowBlur: 0.5 },
        door: 1.55,
        night: { lamps: 0.4, reach: 0.95, glow: 0, sunOff: 1, fixtures: 1, keyDown: 0.75, color: '#fff3e0' },
        roadN: { amount: 1.1, reach: 1175, line: 55, x0: -1170, x1: 900, feather: 400, out: 0, bright: 1.15, tone: 0.1, fade: 1500, inside: 1.05 },
        cleanWall: 1,
        hidden: ['light0', 'light1', 'light2', 'transp1'],
        // the owner's fog panel report of 2026-11-21 21:44 (fog, street lamps, searchlight, cones, dust)
        fog: { density: 1, start: 0, height: 100, move: 0.05, color: '#c3cad3' },
        streetLamps: { count: 6, start: 1575, gap: 900, left: -1250, right: 1050, height: 430, size: 1, halo: 1, bright: 1, color: '#ffd06b' },
        red: { across: -500, dist: 4000, height: 400, size: 1, halo: 1.8, bright: 1, blink: 1.6 },
        nightSounds: { ambience: 100, dogs: 60, every: 30, far: 0.6 },
        // the hot sun at glare 0 and warmth 0: only its 800 specks of dust
        heat: { glare: 0, warmth: 0, motes: 800 },
        floorFog: null,
        banks: null,
        beam: null,
        search: { across: -950, dist: 3700, lean: 25, swing: 24, speed: 2, width: 1.05, bright: 0.45, color: '#dfe9ff' },
        cones: { amount: 0.3, angle: 28, reach: 0.85, dust: 1, color: '#fef3e1' },
    };
    // The data of every look in the shared list (lobby_looks.ts): the build fails if a listed look has none. The saved choice
    // (kasp_lobby_look) is used when it is in the list; otherwise the list's first look.
    const LOOKS: Readonly<Record<KaspLobbyLookName, LobbyLook>> = {
        'day-normal': DAY_LOOK,
        'day-sunny': DAY_SUNNY,
        'day-snowy': DAY_SNOWY_LOOK,
        'night-snowy': NIGHT_SNOWY_LOOK,
        halloween: HALLOWEEN,
        christmas: CHRISTMAS,
        'night-normal': NIGHT_LOOK,
        'day-rainy': DAY_RAINY_LOOK,
        'night-rainy': NIGHT_RAINY,
        'day-foggy': DAY_FOGGY_LOOK,
        'night-foggy': NIGHT_FOGGY,
    };
    window.__kaspLobbyPresets = LOOKS;
})();
