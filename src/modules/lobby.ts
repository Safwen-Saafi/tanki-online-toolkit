// MAIN-world content script for the lobby (build-plan 26, see blueprint/context/lobby-restyle-research.md). The lobby's 3D is the
// game's own hangar; this file shows it the way the owner tuned it in the lobby probe: his camera "final1" (the tank near and on the
// left, the drag that turns it still working) and the hangar's own light, shadow, ring lamps and sway at the numbers of his final
// "day normal" preset (26a). The injector (src/injector.ts) edits the hangar's per-frame update at start, only while the switch
// kasp_lobby is on, so that the game calls window.__kaspLobby.frame(system) first thing in every lobby frame, and it hands this file
// the game's names once (start), found in the game's own code; nothing here spells a game name.
// On the first frame of each lobby scene the game's own values are recorded before anything is written, and every restore uses
// that record. The look always runs at its full settings, whatever the PC (owner, 2026-11-21: a player with a low frame rate changes
// it himself): the light always applies, the floor sharpness raised to 16, the shadow numbers when the game's own shadows are on (forcing them on failed live, 2026-11-21); there
// is no frame-rate guard. Nothing watches the page: the work happens only inside the game's own lobby frames, plus
// one passive mouse listener for the gentle mouse follow. With the drone flight's edit too (26c, kasp_lobbydrone), the drone flies
// round the tank like an FPV drone and comes to say hello (see the flight section below). Nothing is printed: a game build that breaks a step just stops the look.
(function () {
    'use strict';

    const DEG = Math.PI / 180;
    // The owner's camera "final1" (2026-11-16): near and up / aim in the game's units, orbit and turn in degrees, left and lens in %.
    const POSE = { near: 130, orbit: 26, left: 24, up: 20, aim: -40, turn: 32, lens: 66 } as const;
    const MOUSE_EASE = 0.05;
    // The pass draws only right after a lobby frame (26f1): a game picture this long after the last one is not the lobby's.
    const LOBBY_TICK_MS = 250;

    type Bag = Record<string, unknown>;
    const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null;

    // Each read throws when the game's object is not what this build expects; frame() then stops the look.
    function bag(owner: Bag, name: string): Bag {
        const value = owner[name];
        if (!isBag(value)) throw new Error(name);
        return value;
    }
    function num(owner: Bag, name: string): number {
        const value = owner[name];
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(name);
        return value;
    }
    function invoke(owner: Bag, name: string, args: readonly unknown[]): unknown {
        const method = owner[name];
        if (typeof method !== 'function') throw new Error(name);
        return Reflect.apply(method, owner, args);
    }

    function readVector(vector: Bag, n: KaspLobbyNames): KaspLobbyVector {
        return { x: num(vector, n.x), y: num(vector, n.y), z: num(vector, n.z) };
    }
    function writeVector(vector: Bag, n: KaspLobbyNames, value: KaspLobbyVector): void {
        vector[n.x] = value.x;
        vector[n.y] = value.y;
        vector[n.z] = value.z;
    }
    function readColour(colour: Bag, n: KaspLobbyNames): number[] {
        return [num(colour, n.red), num(colour, n.green), num(colour, n.blue), num(colour, n.alpha)];
    }
    function writeColour(colour: Bag, n: KaspLobbyNames, value: readonly number[]): void {
        invoke(colour, n.colourSet, [value[0], value[1], value[2], value.length > 3 ? value[3] : 1]);
    }
    function fromHex(hex: string): number[] {
        return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    }

    // The camera we write: its point c and look-at t, the direction the tank faces the camera from, and the camera's right side
    // on the ground (for the mouse follow). Worked out once per scene from the record, exactly as the probe's computeCamera.
    interface Want {
        readonly c: KaspLobbyVector;
        readonly t: KaspLobbyVector;
        readonly faceX: number;
        readonly faceY: number;
        readonly phi: number;
        readonly rightX: number;
        readonly rightY: number;
    }

    function computeCamera(game: KaspLobbyRecord): Want {
        const k = POSE.near / 100;
        const B = game.base;
        const c = { x: B.x + (game.cam.x - B.x) * k, y: B.y + (game.cam.y - B.y) * k, z: B.z + (game.cam.z - B.z) * k + POSE.up };
        const t = { x: B.x + (game.target.x - B.x) * k, y: B.y + (game.target.y - B.y) * k, z: B.z + (game.target.z - B.z) * k + POSE.aim };
        const a = POSE.orbit * DEG;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (const p of [c, t]) {
            const px = p.x - B.x;
            const py = p.y - B.y;
            p.x = B.x + px * ca - py * sa;
            p.y = B.y + px * sa + py * ca;
        }
        const faceX = c.x - B.x;
        const faceY = c.y - B.y;
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        const flat = Math.hypot(dx, dy) || 1;
        const side = (POSE.left / 100) * Math.hypot(game.cam.x - B.x, game.cam.y - B.y) * k;
        const rightX = dy / flat;
        const rightY = -dx / flat;
        c.x += rightX * side;
        c.y += rightY * side;
        t.x += rightX * side;
        t.y += rightY * side;
        return { c, t, faceX, faceY, phi: Math.atan2(faceY, faceX), rightX, rightY };
    }

    // The renderer outlives a lobby scene and the game does not set its shadows and sharpness again at a scene's start, so they are
    // recorded the first time a renderer is seen, never after our own writes.
    interface RendererRecord {
        readonly shadowsOn: boolean;
        readonly shadowObject: Bag;
        readonly shadow: readonly number[];
        readonly sharpness: number;
    }
    const rendererRecords = new WeakMap<object, RendererRecord>();

    interface Scene {
        readonly system: Bag;
        readonly renderer: Bag;
        readonly record: KaspLobbyRecord;
        readonly rendererRecord: RendererRecord;
        readonly want: Want;
        // The hangar's own drone place (26c), null without the drone flight.
        readonly droneHome: KaspLobbyVector | null;
    }

    let names: KaspLobbyNames | null = null;
    let scene: Scene | null = null;
    let frames = 0;
    let broken = false;
    let sweepTime = 0;
    let lastFrame = 0;
    const mouse = { x: 0, y: 0, eased: { x: 0, y: 0 } };
    const state: Record<string, unknown> = {};

    // Null while the scene is not ready yet (its platform or camera not made yet): the next frame tries again.
    function bind(system: Bag, n: KaspLobbyNames): Scene | null {
        const platform = system[n.platform];
        const camera = system[n.cameraComponent];
        if (!isBag(platform) || !isBag(camera)) return null;
        const world = invoke(system, n.world, []);
        if (!isBag(world)) return null;
        const renderer = invoke(world, n.renderer, []);
        if (!isBag(renderer)) return null;
        const lighting = bag(renderer, n.lighting);
        const key = bag(lighting, n.key);
        let rendererRecord = rendererRecords.get(renderer);
        if (rendererRecord === undefined) {
            const settings = bag(renderer, n.state);
            const shadowObject = bag(renderer, n.shadow);
            rendererRecord = {
                shadowsOn: settings[n.shadowsOn] === true,
                shadowObject,
                shadow: Object.freeze(n.shadowFields.map((field) => num(shadowObject, field))),
                sharpness: num(settings, n.sharpness),
            };
            rendererRecords.set(renderer, rendererRecord);
        }
        const record: KaspLobbyRecord = Object.freeze({
            cam: readVector(bag(system, n.cam), n),
            target: readVector(bag(system, n.target), n),
            base: readVector(bag(system, n.base), n),
            turn: num(bag(platform, n.rotation), n.z),
            fov: num(camera, n.fov),
            lightDir: readVector(bag(system, n.lightDir), n),
            ambient: Object.freeze(readColour(bag(lighting, n.ambient), n)),
            keyColour: Object.freeze(readColour(bag(key, n.keyColour), n)),
            keyStrength: num(key, n.keyStrength),
            lampSpeed: num(system, n.lampSpeed),
            shadowsOn: rendererRecord.shadowsOn,
            shadow: rendererRecord.shadow,
            sharpness: rendererRecord.sharpness,
        });
        const droneHome = n.drone === undefined ? null : Object.freeze(readVector(bag(system, n.drone.home), n));
        return { system, renderer, record, rendererRecord, want: computeCamera(record), droneHome };
    }

    // Once per scene: the platform turned to face the camera plus the owner's turn (the player's drag turns it from there), and the
    // renderer's shadow and sharpness (the full settings). The shadows are switched on as the probe does (its applyShadow), even when
    // the player has them off in the game (owner, 2026-11-21: the looks always run at full settings); the game's own switch keeps
    // them off where the graphics card cannot. Without the switch's name the game's own setting is kept.
    function firstWrites(s: Scene, n: KaspLobbyNames): void {
        bag(bag(s.system, n.platform), n.rotation)[n.z] = Math.atan2(-s.want.faceX, s.want.faceY) + POSE.turn * DEG;
        const r = s.rendererRecord;
        if (n.setShadows !== undefined && !r.shadowsOn) invoke(s.renderer, n.setShadows, [true]);
        const shadowsNow = bag(s.renderer, n.state)[n.shadowsOn] === true;
        if (shadowsNow) {
            const o = r.shadow;
            s.renderer[n.shadow] = invoke(r.shadowObject, n.shadowCopy, [
                look.light.shadowSize,
                o[1] * look.light.shadowReach,
                o[2] * look.light.shadowReach,
                look.light.shadowStrength,
                o[4],
                o[5] * look.light.shadowBlur,
                o[6],
                o[7],
                o[8],
            ]);
        }
        // Raised to the owner's 16 whatever the game's own (his call, 2026-11-21).
        setSharpness(s, n, look.light.sharpness);
        state.shadows = shadowsNow ? look.light.shadowStrength : 'off (the graphics card cannot)';
        state.sharpness = num(bag(s.renderer, n.state), n.sharpness);
    }

    function setSharpness(s: Scene, n: KaspLobbyNames, value: number): void {
        if (num(bag(s.renderer, n.state), n.sharpness) !== value) invoke(s.renderer, n.setSharpness, [value]);
    }

    // Every frame, before the game's own camera, light and lamp code in the same update reads these.
    function writeLook(s: Scene, n: KaspLobbyNames): void {
        const w = s.want;
        mouse.eased.x += (mouse.x - mouse.eased.x) * MOUSE_EASE;
        mouse.eased.y += (mouse.y - mouse.eased.y) * MOUSE_EASE;
        // The game puts the camera at our point plus its own breathing, so ours adds the part of the breathing it does not have.
        const wobble = readVector(bag(s.system, n.wobble), n);
        const more = look.light.breathing - 1;
        const follow = look.light.follow;
        writeVector(bag(s.system, n.cam), n, {
            x: w.c.x + w.rightX * mouse.eased.x * follow + more * wobble.x,
            y: w.c.y + w.rightY * mouse.eased.x * follow + more * wobble.y,
            z: w.c.z - mouse.eased.y * follow * 0.5 + more * wobble.z,
        });
        writeVector(bag(s.system, n.target), n, w.t);
        bag(s.system, n.cameraComponent)[n.fov] = s.record.fov * (POSE.lens / 100);
        // With the picture pass's look the key and fill come from the hour table (26f1). Without it: the key light comes from keySide
        // degrees round from the camera's side and keyHeight degrees up, swinging slowly; the game copies the system's light direction
        // into its key light every frame.
        if (!writeTimeLights(s, n)) {
            const side = look.light.keySide + Math.sin(sweepTime * look.light.sweepSpeed) * look.light.sweepAmount;
            const az = w.phi + side * DEG;
            const el = look.light.keyHeight * DEG;
            writeVector(bag(s.system, n.lightDir), n, { x: -Math.cos(az) * Math.cos(el), y: -Math.sin(az) * Math.cos(el), z: -Math.sin(el) });
            const lighting = bag(s.renderer, n.lighting);
            const key = bag(lighting, n.key);
            writeColour(bag(key, n.keyColour), n, fromHex(look.light.keyColour));
            key[n.keyStrength] = look.light.keyStrength;
            writeColour(bag(lighting, n.ambient), n, [...fromHex(look.light.fillColour).map((part) => part * look.light.fillStrength), 1]);
        }
        flashLight(s, n);
        s.system[n.lampSpeed] = look.light.lampSpeed;
    }

    // The lightning shadow (26g4c, the probe's flashLight): while a flash lasts (its pulses held longer), the game's key light swings
    // to come low through the doorway, a little to one side, stronger and cold, so the tank's real shadow jumps across the floor. It is
    // laid over the light written just before it in the same tick, so the normal light comes back by itself when the flash ends.
    function flashLight(s: Scene, n: KaspLobbyNames): void {
        const K = look.flashShadow;
        const Sm = look.storm;
        const box = passScene?.box;
        if (K === null || Sm === null || box === undefined || STORM.pulses.length === 0) return;
        const dt = (performance.now() - STORM.t0) / 1000;
        const hold = Math.max(0.2, K.hold);
        let fl = 0;
        for (const q of STORM.pulses) if (dt >= q.t) fl += q.a * Math.exp(-(dt - q.t) / (q.tau * hold));
        fl = Math.min(1.4, fl) * Sm.flash;
        if (!(fl > 0.002)) return;
        const a = Math.atan2(box.o[1], box.o[0]) + STORM.side * DEG;
        const el = K.low * DEG;
        const to = [-Math.cos(a) * Math.cos(el), -Math.sin(a) * Math.cos(el), -Math.sin(el)];
        const dirBag = bag(s.system, n.lightDir);
        const d = readVector(dirBag, n);
        const w = Math.min(1, fl * 3);
        const v = [lerp(d.x, to[0], w), lerp(d.y, to[1], w), lerp(d.z, to[2], w)];
        const len = Math.hypot(v[0], v[1], v[2]) || 1;
        writeVector(dirBag, n, { x: v[0] / len, y: v[1] / len, z: v[2] / len });
        const key = bag(bag(s.renderer, n.lighting), n.key);
        const colour = bag(key, n.keyColour);
        writeColour(colour, n, lerp3(readColour(colour, n), [0.78, 0.84, 1], w));
        key[n.keyStrength] = num(key, n.keyStrength) + K.power * 2.5 * Math.min(1.2, fl);
    }

    // Everything back to the recorded values; each line on its own, so one that fails does not keep the others.
    function restore(s: Scene, n: KaspLobbyNames): void {
        const g = s.record;
        const steps: Array<() => void> = [
            () => writeVector(bag(s.system, n.cam), n, g.cam),
            () => writeVector(bag(s.system, n.target), n, g.target),
            () => {
                bag(s.system, n.cameraComponent)[n.fov] = g.fov;
            },
            () => {
                bag(bag(s.system, n.platform), n.rotation)[n.z] = g.turn;
            },
            () => writeVector(bag(s.system, n.lightDir), n, g.lightDir),
            () => {
                const key = bag(bag(s.renderer, n.lighting), n.key);
                writeColour(bag(key, n.keyColour), n, g.keyColour);
                key[n.keyStrength] = g.keyStrength;
            },
            () => writeColour(bag(bag(s.renderer, n.lighting), n.ambient), n, g.ambient),
            () => {
                s.system[n.lampSpeed] = g.lampSpeed;
            },
            () => {
                s.renderer[n.shadow] = s.rendererRecord.shadowObject;
            },
            () => {
                if (n.setShadows !== undefined && !s.rendererRecord.shadowsOn) invoke(s.renderer, n.setShadows, [false]);
            },
            () => setSharpness(s, n, s.rendererRecord.sharpness),
            () => restoreDrone(s, n),
            () => {
                unwrapFrame();
                showHidden();
            },
        ];
        for (const step of steps) {
            try {
                step();
            } catch {
                // that line stays as it is
            }
        }
    }

    function frame(system: unknown): void {
        frames++;
        const n = names;
        if (n === null || broken || !isBag(system)) return;
        const now = performance.now();
        lobbyTickAt = now;
        try {
            if (scene === null || scene.system !== system) {
                const next = bind(system, n);
                if (next === null) return;
                scene = next;
                flight = null;
                lastFrame = now;
                firstWrites(next, n);
                startPass(next, n);
            }
            const gap = now - lastFrame;
            lastFrame = now;
            const dt = Math.min(0.05, gap / 1000);
            sweepTime += dt;
            if (now - partsCheckAt > 1000) {
                partsCheckAt = now;
                checkParts(scene, n);
            }
            writeLook(scene, n);
            flyDrone(scene, n, now, dt);
        } catch {
            broken = true;
            if (scene !== null) restore(scene, n);
        }
    }

    // ---- the picture pass and the looks (26f1 day normal, 26f2 night normal), ported from the probe (v1.87) ----
    // After the game has drawn its lobby picture, our pass (lobby_pass.ts) draws over it with the game's own depth. The game draws the
    // whole picture in one call of its renderer; that call is wrapped on the lobby's renderer object only (never the class: other
    // renderers are untouched), and the pass runs right after the game's own picture, only for the lobby world's camera and only in a
    // tick where the lobby's own frame came through. The look is the owner's final "day normal" (report of 2026-11-20 14:13) without
    // its three extras: the time of day at 13:00 (the hangar's key and fill light from the hour table, its colours over the picture),
    // the doorway blend, the hangar floor carried into the road outside, and the lamp halo (transp1) hidden. The night is the owner's
    // final "night normal" (report of 2026-11-20 15:21) without its extras: 23:00, the hangar's painted sunlight taken out of its walls
    // and floor (stage 0b, clean walls), the ring lamps lighting the tank and the floor (stage 1c) with the key light turned down from
    // them, the stars and the moon, the night floor into the road, the sunbeams and halo hidden. Each look is the probe's preset in its
    // group shape (merged over the probe's defaults); the player picks one in the settings (kasp_lobby_look, read at start).
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
        readonly outside: { readonly season: string; readonly bright: number; readonly own: number; readonly mix: number; readonly mixDepth: number } | null;
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
        storm: { every: 20, random: 0.3, flash: 1.35, bolt: 1, volume: 80, delay: 1.8 },
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
        roadN: { amount: 1.5, reach: 1650, line: 700, x0: -1110, x1: 780, feather: 360, out: 0, bright: 1.15, tone: 0.1, fade: 1500, inside: 1 },
        // the night's wider, shinier wet floor
        wet: { amount: 1, depth: 660, puddles: 0.55, shine: 1.6, rings: 1.25 },
    };
    // The owner's final "day very sunny" (probe v1.64 DAY_SUNNY, report of 2026-11-20 11:13; its own key light and lamp speed of v1.68):
    // the normal day with the hot sun (glare, warmth, dust in the light), door blend 3, its road, the heat shimmer, four birds, the
    // summer sounds (the city loop at 100 % and the cicadas at 65 %); no white clouds or leaves; only transp1 hidden, the game's own floor.
    const DAY_SUNNY: LobbyLook = {
        ...DAY_NORMAL,
        light: { ...DAY_NORMAL.light, keySide: -44, keyHeight: 31, keyStrength: 1.95, keyColour: '#ffe9cf', lampSpeed: 0.38 },
        door: 3,
        road: { amount: 0.55, reach: 1175, line: 0, x0: -930, x1: 670, feather: 160, out: 45, bright: 1.05, tone: 0, fade: 0, inside: 1 },
        clouds: null,
        leaves: null,
        city: 100,
        heat: { glare: 3, warmth: 1.5, motes: 3450 },
        shimmer: { amount: 1.2, height: 120, speed: 1 },
        birds: { count: 4, height: 760, dist: 4200, size: 2, speed: 1 },
        cicadas: 65,
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
    // The owner's final Halloween (probe v1.79 HALLOWEEN, report of 2026-11-20 18:53 without its lightning and thunder, which the
    // owner dropped): the probe's clear night (its own numbers) with the Halloween outside, the night colour reaching fully inside, the
    // Halloween lamps off, no ground fog (on at 0), the night ambience (dog every 45 s) and a little wind, the lamp flicker every
    // 20 s, the pumpkins, wisps, bats (one inside every ~30 s), string lights, webs and spooky sounds; no town windows, street lamps,
    // red light, shooting stars, fireflies or moths.
    const HALLOWEEN: LobbyLook = {
        ...NIGHT_NORMAL,
        time: { hour: 23, strength: 1, inside: 1.5, sunSide: 0 },
        outside: { season: 'halloween2024', bright: 1, own: 0.75, mix: 1, mixDepth: 700 },
        night: { lamps: 0.95, reach: 0.6, glow: 0, sunOff: 1, fixtures: 0, keyDown: 1, color: '#f9ec9a' },
        door: 1,
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
        stringLights: { door: 1, wall: 1, doorZ: 610, wallZ: 600, sag: 49, gap: 110, bright: 1.7, blink: 1.25 },
        webs: { size: 235, amount: 0.4, top: 600, left: -940, right: 690 },
        haunt: { every: 20 },
        spooky: { owl: 80, wolf: 70, creak: 60, every: 25 },
    };
    // The owner's final Christmas (probe v1.87 CHRISTMAS, report of 2026-11-20 21:36, "only one preset for Christmas"): the probe's
    // snowy night at hour 24 (inside 0.8, moon side 180) with the New Year outside brighter (2.1, keeps its look 0.8, blend reach 500),
    // warm lamps with the Halloween lamps at 0.6, heavy snow with wind (less on the ground, thinner), 33 shorter icicles, gusts every
    // 10 s, the wind louder; the tree with 96 bulbs, its star and glow, 9 gifts, the Christmas lights. No fog, drift, glints, grey sky,
    // flake glow, street lamps, red light, town windows or lamp light on the street.
    const CHRISTMAS: LobbyLook = {
        ...NIGHT_SNOWY,
        outside: { season: 'newyear2025', bright: 2.1, own: 0.8, mix: 1, mixDepth: 500 },
        time: { hour: 24, strength: 1, inside: 0.8, sunSide: 180 },
        night: { lamps: 0.95, reach: 0.75, glow: 0, sunOff: 1, fixtures: 0.6, keyDown: 1, color: '#ffd9a8' },
        door: 0.1,
        overcast: null,
        fog: null,
        floorFog: null,
        banks: null,
        snow: { flakes: 18000, speed: 1.4, size: 1.4, wind: 1, sway: 1.25, bright: 1.2, cover: 0.35, reach: 2600, coverBright: 1.4, coverThick: 0.5, inside: 50 },
        icicles: { count: 33, top: 590, out: 25, left: -1000, right: 780, length: 190, width: 2, glint: 0.95 },
        snowDrift: null,
        sparkle: 0,
        snowGusts: { every: 10, strength: 1.25, length: 3, sound: 2.15 },
        snowSounds: { volume: 164, fall: 80 },
        snowGlow: null,
        streetLamps: null,
        red: null,
        windows: null,
        pools: null,
        tree: { kind: 0, x: -1030, y: -1370, turn: 65, size: 1.4, count: 96, lights: 4, blink: 2.2, star: 2.5, pool: 4 },
        gifts: { count: 9, size: 0.9 },
        xmasLights: { door: 1, wall: 1, doorZ: 625, wallZ: 610, sag: 49, gap: 65, bright: 4, blink: 3.15 },
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
    // The owner's final "night foggy" (probe v1.60 NIGHT_FOGGY, report of 2026-11-20 10:35): the foggy day at 23:00 with its own
    // thicker, almost still fog, the walls not cleaned, transp2 kept, the street lamps, the red light and the night sounds. The night
    // lights are the probe's own (as the day normal's), not the clear night's later report. Its searchlight, lamp cones and floating dust.
    const NIGHT_FOGGY: LobbyLook = {
        ...DAY_FOGGY,
        time: { hour: 23, strength: 1, inside: 0.7, sunSide: 0 },
        cleanWall: 0,
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
        'day-normal': DAY_NORMAL,
        'day-sunny': DAY_SUNNY,
        'day-snowy': DAY_SNOWY,
        'night-snowy': NIGHT_SNOWY,
        halloween: HALLOWEEN,
        christmas: CHRISTMAS,
        'night-normal': NIGHT_NORMAL,
        'day-rainy': DAY_RAINY,
        'night-rainy': NIGHT_RAINY,
        'day-foggy': DAY_FOGGY,
        'night-foggy': NIGHT_FOGGY,
    };
    const lookName: KaspLobbyLookName = (() => {
        let saved: string | null = null;
        try {
            saved = localStorage.getItem('kasp_lobby_look');
        } catch {
            // no saved choice
        }
        const list = window.__kaspLobbyLooks;
        // without the list (its file did not run) the day, the game's own first look
        return (list?.find((l) => l.value === saved) ?? list?.[0])?.value ?? 'day-normal';
    })();
    const look: LobbyLook = LOOKS[lookName];
    // How dark it is at the look's hour (0 by day, 1 at night): the hangar's painted sunbeams left, turned round.
    const nightAmount = (): number => (look.night === null ? 0 : Math.max(0, Math.min(1, 1 - timeState(look.time.hour).beams)));

    // The time of day: a colour table by hour, read between its rows (the probe's DAY_TABLE). inn = the hangar's colour, hor / zen =
    // the outside's colour at the horizon / looking up (all multiply the game's daytime picture), key / keyS = the sun (or moon) light
    // on the tank, fill / fillS = the general light, stars, sun = the glow's colour and glow = its strength, beams = how much of the
    // hangar's painted sunlight rays is left (0 at night).
    interface Hour {
        readonly h: number;
        readonly inn: readonly number[];
        readonly hor: readonly number[];
        readonly zen: readonly number[];
        readonly key: readonly number[];
        readonly keyS: number;
        readonly fill: readonly number[];
        readonly fillS: number;
        readonly stars: number;
        readonly sun: readonly number[];
        readonly glow: number;
        readonly beams: number;
    }
    type Row = [number[], number[], number[], string, number, string, number, number, string, number, number];
    const T = (h: number, [inn, hor, zen, key, keyS, fill, fillS, stars, sun, glow, beams]: Row): Hour => ({
        h, inn, hor, zen, key: fromHex(key), keyS, fill: fromHex(fill), fillS, stars, sun: fromHex(sun), glow, beams,
    });
    const NIGHT: Row = [[0.62, 0.64, 0.78], [0.16, 0.18, 0.3], [0.07, 0.08, 0.17], '#b4c0ff', 1.15, '#8892b8', 0.85, 1, '#9fb4ff', 0.25, 0];
    const DAY_TABLE: readonly Hour[] = [
        T(0, NIGHT),
        T(5, NIGHT),
        T(6, [[0.86, 0.8, 0.82], [1.0, 0.66, 0.55], [0.38, 0.4, 0.62], '#ffbe96', 1.25, '#a6a3c0', 0.85, 0.15, '#ffb070', 1.0, 0.45]),
        T(7.5, [[0.95, 0.92, 0.9], [1.0, 0.88, 0.78], [0.78, 0.84, 0.98], '#ffe0bf', 1.35, '#b4bfd4', 0.85, 0, '#ffd8a0', 0.6, 0.85]),
        T(9, [[1.0, 0.99, 0.96], [1.0, 0.97, 0.92], [0.95, 0.98, 1.0], '#fff0dc', 1.45, '#bcc8dc', 0.9, 0, '#fff0d0', 0.45, 1]),
        T(13, [[1, 1, 1], [1, 1, 1], [1, 1, 1], '#ffffff', 1.5, '#c8d2e0', 0.9, 0, '#ffffff', 0.35, 1]),
        T(16.5, [[1.0, 0.96, 0.9], [1.0, 0.95, 0.86], [0.95, 0.95, 0.98], '#ffe6c4', 1.45, '#c0c4d0', 0.9, 0, '#ffe0b0', 0.45, 1]),
        T(18.5, [[0.92, 0.78, 0.68], [1.0, 0.55, 0.32], [0.45, 0.36, 0.55], '#ffa05e', 1.4, '#b0949c', 0.85, 0, '#ff8a3c', 1.2, 0.6]),
        T(19.5, [[0.74, 0.68, 0.78], [0.55, 0.38, 0.5], [0.16, 0.16, 0.33], '#b8a4e0', 1.2, '#8c8cb0', 0.85, 0.35, '#ff7050', 0.5, 0.2]),
        T(20.5, [[0.66, 0.66, 0.8], [0.3, 0.27, 0.42], [0.1, 0.11, 0.24], '#b0bcff', 1.15, '#8890b6', 0.85, 0.7, '#a0b0ff', 0.25, 0]),
        T(22, NIGHT),
        T(24, NIGHT),
    ];
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const lerp3 = (a: readonly number[], b: readonly number[], t: number): number[] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    function timeState(hour: number): Hour {
        const h = ((hour % 24) + 24) % 24;
        let i = 0;
        while (i < DAY_TABLE.length - 2 && DAY_TABLE[i + 1].h <= h) i++;
        const a = DAY_TABLE[i];
        const b = DAY_TABLE[i + 1];
        const t = (h - a.h) / Math.max(0.0001, b.h - a.h);
        return {
            h,
            inn: lerp3(a.inn, b.inn, t), hor: lerp3(a.hor, b.hor, t), zen: lerp3(a.zen, b.zen, t), key: lerp3(a.key, b.key, t),
            keyS: lerp(a.keyS, b.keyS, t), fill: lerp3(a.fill, b.fill, t), fillS: lerp(a.fillS, b.fillS, t), stars: lerp(a.stars, b.stars, t),
            sun: lerp3(a.sun, b.sun, t), glow: lerp(a.glow, b.glow, t), beams: lerp(a.beams, b.beams, t),
        };
    }
    // The sun crosses the sky beyond the hangar's opening from about 6:00 to 19:00; at night a moon stands higher, a little to one side.
    function sunDirection(hour: number, box: KaspLobbyBox, sunSide: number): number[] {
        const h = ((hour % 24) + 24) % 24;
        const base = Math.atan2(box.o[1], box.o[0]);
        let el: number;
        let az: number;
        const side = sunSide * DEG;
        if (h >= 5.75 && h <= 19.75) {
            const t = (h - 6) / 13;
            el = Math.max(-0.05, Math.sin(Math.PI * Math.min(1, Math.max(0, t)))) * 60 * DEG;
            az = base + side + (t - 0.5) * 70 * DEG;
        } else {
            el = 30 * DEG;
            az = base + side + 20 * DEG;
        }
        return [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
    }

    // The hangar's own parts in the scene (the scene draws its own objects, not the hangar resource's): found by name under the
    // world's scene root, three levels down, the tank's hull and turret left out.
    interface Part {
        readonly name: string;
        readonly node: Bag;
    }
    function readParts(s: Scene, n: KaspLobbyNames, p: KaspLobbyPassNames): Part[] {
        const world = invoke(s.system, n.world, []);
        if (!isBag(world)) return [];
        const parts: Part[] = [];
        const kidsOf = (node: Bag): Bag[] => {
            const list = node[p.children];
            if (!isBag(list)) return [];
            const count = invoke(list, p.size, []);
            const out: Bag[] = [];
            if (typeof count === 'number') for (let k = 0; k < count; k++) {
                const kid = invoke(list, p.at, [k]);
                if (isBag(kid)) out.push(kid);
            }
            return out;
        };
        const walk = (node: Bag, depth: number): void => {
            for (const kid of kidsOf(node)) {
                const name = kid[p.nodeName];
                if (typeof name === 'string' && typeof kid[p.setShown] === 'function') parts.push({ name, node: kid });
                if (depth < 3 && !(typeof name === 'string' && /^(hull|turret)$/i.test(name))) walk(kid, depth + 1);
            }
        };
        walk(bag(world, p.root), 0);
        return parts;
    }
    interface Bounds {
        readonly minX: number;
        readonly minY: number;
        readonly minZ: number;
        readonly maxX: number;
        readonly maxY: number;
        readonly maxZ: number;
    }
    // The room and the town as the owner's reports measured them, for a build where the live bounds cannot be read.
    const ROOM_FALLBACK: Bounds = { minX: -1430, minY: -1902, minZ: -23, maxX: 1220, maxY: 1163, maxZ: 1478 };
    const TOWN_FALLBACK: Bounds = { minX: -4773, minY: -11618, minZ: -1517, maxX: 2086, maxY: -1874, maxZ: 2406 };
    const SKY_FALLBACK: Bounds = { minX: -7045, minY: -15416, minZ: -1414, maxX: 2890, maxY: -9680, maxZ: 6662 };
    function boundsOf(parts: readonly Part[], name: string, n: KaspLobbyNames, p: KaspLobbyPassNames): Bounds | null {
        const part = parts.find((q) => q.name === name);
        if (part === undefined) return null;
        try {
            const at = readVector(bag(part.node, p.position), n);
            const b = invoke(part.node, p.bounds, []);
            if (!isBag(b)) return null;
            return {
                minX: num(b, p.boxMin[0]) + at.x, minY: num(b, p.boxMin[1]) + at.y, minZ: num(b, p.boxMin[2]) + at.z,
                maxX: num(b, p.boxMax[0]) + at.x, maxY: num(b, p.boxMax[1]) + at.y, maxZ: num(b, p.boxMax[2]) + at.z,
            };
        } catch {
            return null;
        }
    }
    // The street side: the side of the room the town reaches out of the most (the probe's rainBox).
    function streetBox(parts: readonly Part[], n: KaspLobbyNames, p: KaspLobbyPassNames): KaspLobbyBox {
        const room = boundsOf(parts, 'room0', n, p) ?? ROOM_FALLBACK;
        const town = boundsOf(parts, 'bg0', n, p) ?? TOWN_FALLBACK;
        const sky = boundsOf(parts, 'Sky0', n, p) ?? SKY_FALLBACK;
        const floor = boundsOf(parts, 'floor0', n, p);
        const sides = [
            { side: '+x', o: [1, 0] as const, l: [0, 1] as const, wall: room.maxX, far: town.maxX, near: sky.minX, u: [town.minY, town.maxY] as const },
            { side: '-x', o: [-1, 0] as const, l: [0, -1] as const, wall: -room.minX, far: -town.minX, near: -sky.maxX, u: [-town.maxY, -town.minY] as const },
            { side: '+y', o: [0, 1] as const, l: [-1, 0] as const, wall: room.maxY, far: town.maxY, near: sky.minY, u: [-town.maxX, -town.minX] as const },
            { side: '-y', o: [0, -1] as const, l: [1, 0] as const, wall: -room.minY, far: -town.minY, near: -sky.maxY, u: [town.minX, town.maxX] as const },
        ];
        const best = sides.reduce((a, c) => (c.far - c.wall > a.far - a.wall ? c : a));
        return {
            o: best.o,
            l: best.l,
            wall: best.wall,
            groundZ: room.minZ,
            skyZ: town.maxZ,
            skyNear: best.near,
            skyLow: room.maxZ,
            floorZ: floor ? floor.maxZ : 0,
            u: best.u,
            far: best.far,
            z: [town.minZ, room.maxZ + 2500],
            room: { minX: room.minX, maxX: room.maxX, minY: room.minY, maxY: room.maxY },
            roomMin: [room.minX + 120, room.minY + 120, room.minZ + 80],
            roomMax: [room.maxX - 120, room.maxY - 120, room.maxZ - 150],
        };
    }

    interface PassScene {
        readonly parts: readonly Part[];
        readonly box: KaspLobbyBox;
        readonly offset: [number, number, number];
        readonly hidden: readonly Part[];
        // the sunbeams faded by the overcast (26g1), with their own see-through amount to give back
        readonly faded: ReadonlyArray<{ readonly part: Part; readonly was: number }>;
    }
    let passScene: PassScene | null = null;
    let passBroken = false;
    let passFrames = 0;
    let lobbyTickAt = 0;
    let partsCheckAt = 0;
    // Once a second while the lobby is drawn: the pass starts on the lobby's first frame, sometimes before the game has put all of the
    // hangar's parts in its scene, so a part added later (a sunbeam, the lamps' halo) would never be hidden or faded. If the parts
    // changed, the pass starts again (it first gives back what it hid); otherwise every part the look hides is hidden again, in case
    // the game showed it again.
    function checkParts(s: Scene, n: KaspLobbyNames): void {
        const p = n.pass;
        const ps = passScene;
        if (p === undefined || ps === null || passBroken) return;
        try {
            const now = readParts(s, n, p);
            const known = new Set(ps.parts.map((q) => q.node));
            const same = now.length === ps.parts.length && now.every((q) => known.has(q.node));
            if (!same) {
                startPass(s, n);
                return;
            }
            for (const part of ps.hidden) invoke(part.node, p.setShown, [false]);
        } catch {
            // the parts stay as they are
        }
    }
    let gpu: KaspLobbyGpu | null = null;
    let gpuGl: WebGL2RenderingContext | null = null;
    // The renderer object whose frame call is wrapped, the game's own call, and whether it was the object's own property.
    let wrapped: { readonly renderer: Bag; readonly name: string; readonly base: unknown; readonly own: boolean } | null = null;
    let standard: KaspLobbyStandard | null = null;
    let standardState: 'none' | 'loading' | 'failed' = 'none';

    // Once per scene: the parts, the street box, the hangar's place, the hidden parts, the wrap.
    function startPass(s: Scene, n: KaspLobbyNames): void {
        const p = n.pass;
        if (p === undefined || passBroken || window.__kaspLobbyPass === undefined) return;
        try {
            showHidden();
            const parts = readParts(s, n, p);
            const room = parts.find((q) => q.name === 'room0');
            let offset: [number, number, number] = [0, 0, 0];
            if (room !== undefined) {
                const at = readVector(bag(room.node, p.position), n);
                offset = [at.x, at.y, at.z];
            }
            const beams = sunbeams(parts, p);
            const hidden = [...parts.filter((q) => hiddenNames().includes(q.name)), ...beams.hide];
            passScene = { parts, box: streetBox(parts, n, p), offset, hidden, faded: beams.faded };
            for (const part of hidden) invoke(part.node, p.setShown, [false]);
            for (const { part } of beams.faded) invoke(part.node, p.alpha?.set ?? '', [beams.want]);
            wrapFrame(s.renderer, p);
        } catch {
            stopPass();
        }
    }

    // The parts the look hides, and with a seasonal outside the game's sky, town and transp2 too (its own sky and ground replace them;
    // the probe's automatic hiding, whether or not the season's files have arrived yet).
    const hiddenNames = (): readonly string[] => (look.outside !== null ? [...look.hidden, 'Sky0', 'bg0', 'transp2'] : look.hidden);
    // The sunbeams (the probe's applyBeams): the light rays and the see-through parts but the lamp halo (transp1, hidden by every
    // look) at the look's hour times the overcast's share. Below 0.03 they are hidden; otherwise faded by their see-through amount
    // (or, without its setter, hidden below 0.3); a part already as wanted, or hidden by the look, is left alone.
    const isSunbeam = (name: string): boolean => /^light/i.test(name) || (/^transp/i.test(name) && !/^transp1$/i.test(name));
    function sunbeams(parts: readonly Part[], p: KaspLobbyPassNames): { want: number; hide: Part[]; faded: Array<{ part: Part; was: number }> } {
        const want = timeState(look.time.hour).beams * (look.overcast?.beams ?? 1);
        const hide: Part[] = [];
        const faded: Array<{ part: Part; was: number }> = [];
        for (const part of parts) {
            if (!isSunbeam(part.name) || hiddenNames().includes(part.name)) continue;
            if (want < 0.03 || (p.alpha === undefined && want < 0.3)) {
                hide.push(part);
                continue;
            }
            if (p.alpha === undefined) continue;
            const was = num(part.node, p.alpha.field);
            if (Math.abs(was - want) >= 0.01) faded.push({ part, was });
        }
        return { want, hide, faded };
    }

    function wrapFrame(renderer: Bag, p: KaspLobbyPassNames): void {
        if (wrapped !== null && wrapped.renderer === renderer) return;
        unwrapFrame();
        const base = renderer[p.frame];
        if (typeof base !== 'function') throw new Error(p.frame);
        const own = Object.prototype.hasOwnProperty.call(renderer, p.frame);
        renderer[p.frame] = function (this: unknown, ...args: unknown[]): unknown {
            const out: unknown = Reflect.apply(base, this, args);
            afterPicture(args[1]);
            return out;
        };
        wrapped = { renderer, name: p.frame, base, own };
    }
    function unwrapFrame(): void {
        const w = wrapped;
        wrapped = null;
        if (w === null) return;
        try {
            if (w.own) w.renderer[w.name] = w.base;
            else delete w.renderer[w.name];
        } catch {
            // a frozen object keeps our wrapper, which then does nothing (passBroken)
        }
    }
    function showHidden(): void {
        const p = names?.pass;
        const ps = passScene;
        if (p === undefined || ps === null) return;
        for (const part of ps.hidden) {
            try {
                invoke(part.node, p.setShown, [true]);
            } catch {
                // that part stays as it is
            }
        }
        for (const { part, was } of ps.faded) {
            try {
                invoke(part.node, p.alpha?.set ?? '', [was]);
            } catch {
                // that part stays as it is
            }
        }
    }
    // The pass off for the rest of the page's life: the game's frame call and the hidden parts put back.
    function stopPass(): void {
        passBroken = true;
        unwrapFrame();
        showHidden();
        passScene = null;
        try {
            gpu?.dispose();
        } catch {
            // the context may be gone
        }
        gpu = null;
    }

    // The night factor pictures (26f2), made once in the page after the hangar model is read, only for a look that uses them.
    let nightPics: ReadonlyMap<string, ImageBitmap> | null = null;
    let nightState: 'none' | 'making' | 'failed' = 'none';
    let nightAsset: KaspLobbyAsset | null = null;
    let nightMs = 0;
    function nightAssetOf(std: KaspLobbyStandard): KaspLobbyAsset | null {
        if (nightAsset !== null) return nightAsset;
        const api = window.__kaspLobbyPass;
        const wanted = look.cleanWall > 0 || (look.night !== null && nightAmount() > 0.01 && look.night.sunOff > 0);
        if (!wanted || api === undefined || nightState !== 'none') return null;
        nightState = 'making';
        const started = performance.now();
        api.nightPictures(std.std).then(
            (made) => {
                nightPics = made;
                nightMs = Math.round(performance.now() - started);
                nightAsset = { ...std.std, nightPics: made };
            },
            () => {
                nightState = 'failed';
            },
        );
        return null;
    }

    // The overcast's pictures (26g1), only for a look with the overcast: the ring lamp lenses' factor picture (made after the hangar
    // model, at each start) and the game's sky mesh with its picture greyed (made once and saved).
    let lensAsset: KaspLobbyAsset | null = null;
    let lensState: 'none' | 'making' | 'failed' = 'none';
    function lensAssetOf(std: KaspLobbyStandard): KaspLobbyAsset | null {
        if (lensAsset !== null) return lensAsset;
        const O = look.overcast;
        const api = window.__kaspLobbyPass;
        if (O === null || O.lamps >= 1 || api === undefined || lensState !== 'none') return null;
        lensState = 'making';
        api.lensPictures(std.std).then(
            (made) => {
                lensAsset = { ...std.std, lensPics: made };
            },
            () => {
                lensState = 'failed';
            },
        );
        return null;
    }
    let skyAsset: KaspLobbyAsset | null = null;
    let skyState: 'none' | 'making' | 'failed' = 'none';
    let skyMs = 0;
    function ensureSky(): void {
        const O = look.overcast;
        if (O === null || O.sky <= 0 || skyAsset !== null || skyState !== 'none') return;
        const folder = document.documentElement.getAttribute('data-kasp-hangar-folder');
        const api = window.__kaspLobbyPass;
        if (folder === null || !/^https:\/\/[^/]*tankionline\.com\//.test(folder) || api === undefined) return;
        skyState = 'making';
        const started = performance.now();
        api.loadSky(folder, { amount: O.sky, contrast: O.contrast, tint: fromHex(O.tint) }).then(
            (got) => {
                skyAsset = got;
                skyMs = Math.round(performance.now() - started);
            },
            () => {
                skyState = 'failed';
            },
        );
    }

    // The game's own hangar model read once, as soon as hangar_files.ts has seen its folder (loadEarly), or at the first lobby frame.
    // The Halloween lamps (26f4c), read once from the extension's hangars/ folder after the hangar model (for the lamp spots).
    let fixtures: KaspLobbyAsset | null = null;
    let fixturesState: 'none' | 'loading' | 'failed' = 'none';
    function ensureFixtures(std: KaspLobbyStandard): void {
        if (fixtures !== null || fixturesState !== 'none' || look.night === null || look.night.fixtures <= 0) return;
        const base = document.documentElement.getAttribute('data-kasp-hangar-base');
        const api = window.__kaspLobbyPass;
        if (base === null || api === undefined) return;
        fixturesState = 'loading';
        api.loadFixtures(base, std.lamps).then(
            (got) => {
                fixtures = got;
                fixturesState = 'none';
            },
            () => {
                fixturesState = 'failed';
            },
        );
    }

    function ensureStandard(): void {
        if (standard !== null || standardState !== 'none') return;
        const folder = document.documentElement.getAttribute('data-kasp-hangar-folder');
        const api = window.__kaspLobbyPass;
        if (folder === null || !/^https:\/\/[^/]*tankionline\.com\//.test(folder) || api === undefined) return;
        standardState = 'loading';
        api.loadStandard(folder).then(
            (got) => {
                standard = got;
                standardState = 'none';
                // the night pictures at once (from the saved store after the first start), not at the next lobby frame
                nightAssetOf(got);
                lensAssetOf(got);
                if (nightAmount() > 0.01) ensureFixtures(got);
            },
            () => {
                standardState = 'failed';
            },
        );
    }

    // Everything the look draws with starts loading as soon as hangar_files.ts has seen the hangar's folder, while the game is still
    // loading, not at the lobby's first frame: the hangar model (then the night pictures, the lens picture and the Halloween lamps
    // when the look uses them) and the grey sky. Most of it is read from the saved store, so the look is usually whole from its first
    // frame. With the lobby switched off hangar_files.ts sets no folder, so nothing is loaded.
    // A seasonal outside and the Halloween pumpkins (26k), read once from the extension's hangars/ folder (loadEarly, so the look is
    // whole from its first frame); a failure leaves that piece out.
    let season: KaspLobbySeason | null = null;
    let seasonState: 'none' | 'loading' | 'failed' = 'none';
    let pumpkinSet: KaspLobbyPumpkins | null = null;
    let pumpkinState: 'none' | 'loading' | 'failed' = 'none';
    // the Christmas trees (26l), the same way
    let treeSet: KaspLobbyTrees | null = null;
    let treeState: 'none' | 'loading' | 'failed' = 'none';
    function ensureSeasonal(): void {
        const base = document.documentElement.getAttribute('data-kasp-hangar-base');
        const api = window.__kaspLobbyPass;
        if (base === null || api === undefined) return;
        const O = look.outside;
        if (O !== null && season === null && seasonState === 'none') {
            seasonState = 'loading';
            api.loadSeason(base, O.season).then(
                (got) => {
                    season = got;
                    seasonState = 'none';
                },
                () => {
                    seasonState = 'failed';
                },
            );
        }
        if (look.pumpkins !== null && pumpkinSet === null && pumpkinState === 'none') {
            pumpkinState = 'loading';
            api.loadPumpkins(base).then(
                (got) => {
                    pumpkinSet = got;
                    pumpkinState = 'none';
                },
                () => {
                    pumpkinState = 'failed';
                },
            );
        }
        if (look.tree !== null && treeSet === null && treeState === 'none') {
            treeState = 'loading';
            api.loadTrees(base).then(
                (got) => {
                    treeSet = got;
                    treeState = 'none';
                },
                () => {
                    treeState = 'failed';
                },
            );
        }
    }
    function loadEarly(): void {
        ensureStandard();
        ensureSky();
        ensureSeasonal();
    }
    if (document.documentElement.hasAttribute('data-kasp-hangar-folder')) loadEarly();
    else {
        const seen = new MutationObserver(() => {
            if (!document.documentElement.hasAttribute('data-kasp-hangar-folder')) return;
            seen.disconnect();
            loadEarly();
        });
        seen.observe(document.documentElement, { attributes: true, attributeFilter: ['data-kasp-hangar-folder'] });
    }

    // The game's key and fill light from the hour table (the sun or the moon); true when written. Without the pass's names the light
    // stays 26a's.
    function writeTimeLights(s: Scene, n: KaspLobbyNames): boolean {
        const ps = passScene;
        if (ps === null || passBroken) return false;
        const L = look;
        const st = timeState(L.time.hour);
        const d = sunDirection(L.time.hour, ps.box, L.time.sunSide);
        const el = Math.max(10 * DEG, Math.asin(Math.max(-1, Math.min(1, d[2]))));
        const flat = Math.hypot(d[0], d[1]) || 1;
        let dir = [-(d[0] / flat) * Math.cos(el), -(d[1] / flat) * Math.cos(el), -Math.sin(el)];
        let key = st.key;
        // at night the lamps over the tank are the light: the key light turns to come straight down in the lamp colour
        const N = L.night;
        const down = N === null ? 0 : Math.max(0, Math.min(1, 1 - st.beams)) * N.keyDown;
        if (N !== null && down > 0) {
            const g = s.record.lightDir;
            dir = [lerp(dir[0], g.x, down), lerp(dir[1], g.y, down), lerp(dir[2], g.z, down)];
            const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
            dir = dir.map((v) => v / len);
            key = lerp3(st.key, fromHex(N.color), down);
        }
        writeVector(bag(s.system, n.lightDir), n, { x: dir[0], y: dir[1], z: dir[2] });
        const lighting = bag(s.renderer, n.lighting);
        const keyLight = bag(lighting, n.key);
        writeColour(bag(keyLight, n.keyColour), n, key);
        keyLight[n.keyStrength] = st.keyS;
        writeColour(bag(lighting, n.ambient), n, [st.fill[0] * st.fillS, st.fill[1] * st.fillS, st.fill[2] * st.fillS, 1]);
        return true;
    }

    // The stars brighter than the probe's hour table (owner, 2026-11-21: "increase the stars numbers and their glow").
    const STAR_BOOST = 1.4;

    // ---- the shooting star (26f4a), the probe's meteorStep (v1.69) ----
    // One at a time, about every `every` seconds (the first one 4 s after the lobby shows). The sky seen through the door is a thin
    // strip just above the far hills, so each star flies across the doorway and a little more (1200 to either side of the door's middle,
    // seen from the camera) at `height` degrees up, dropping a little, in 2 to 3 seconds. Directions in the door's frame: across, up.
    const MET: { next: number; t0: number; dur: number; a: number[] | null; b: number[] | null } = { next: 0, t0: 0, dur: 0, a: null, b: null };
    function meteorStep(nowMs: number, box: KaspLobbyBox, cam: readonly number[], M: ShootNumbers): KaspLobbyNightExtras['meteor'] {
        const every = Math.max(3, M.every) * 1000;
        if (!MET.next) MET.next = nowMs + Math.min(4000, every);
        if (nowMs >= MET.t0 + MET.dur && nowMs >= MET.next) {
            const azAt = (across: number): number => {
                const dx = box.o[0] * box.wall + box.l[0] * across - cam[0];
                const dy = box.o[1] * box.wall + box.l[1] * across - cam[1];
                return Math.atan2(dx * box.l[0] + dy * box.l[1], dx * box.o[0] + dy * box.o[1]);
            };
            const L = azAt(-1200);
            const R = azAt(1200);
            const side = Math.random() < 0.5 ? -1 : 1;
            const from = side < 0 ? R : L;
            const to = side < 0 ? L : R;
            const el = ((M.height + Math.random() * 0.4) * Math.PI) / 180;
            MET.a = [from + (to - from) * Math.random() * 0.15, el];
            MET.b = [to - (to - from) * Math.random() * 0.15, el - ((0.15 + Math.random() * 0.25) * Math.PI) / 180];
            MET.t0 = nowMs;
            MET.dur = (2000 + Math.random() * 1000) / Math.max(0.05, M.speed);
            MET.next = nowMs + every * (0.6 + Math.random() * 0.8);
        }
        if (MET.a === null || MET.b === null || nowMs >= MET.t0 + MET.dur) return null;
        const t = (nowMs - MET.t0) / MET.dur;
        return {
            a: MET.a,
            b: MET.b,
            t,
            length: M.length,
            width: 0.0011 * Math.max(0.3, M.width),
            bright: M.bright * Math.min(1, t / 0.15) * (1 - Math.max(0, (t - 0.7) / 0.3)),
        };
    }

    // ---- the normal day's leaves (26f3), the probe's leaf simulation (v1.66) ----
    // Each leaf is simulated every frame. The wind blows along the street with gusts that travel down it (a gust reaches the leaves upwind
    // first) and a little turbulence. A leaf lying on the street stays put in a light wind, slides and skitters when the wind is strong
    // enough for it (each leaf needs a different push), and a strong gust lifts it or flips it over. In the air it is pulled toward the
    // wind's speed (harder when it faces the wind), falls slowly when flat and faster when edge-on, rocks to and fro and tumbles; it lands,
    // settles flat on either side and slides to a stop. Leaves blown out at the downwind end come back at the upwind end. Street
    // coordinates: lat = across (the wind's way), out = away from the door.
    interface Leaf {
        lat: number;
        out: number;
        z: number;
        vl: number;
        vo: number;
        vz: number;
        yaw: number;
        pitch: number;
        roll: number;
        wy: number;
        wp: number;
        wr: number;
        ground: boolean;
        need: number;
        size: number;
        type: number;
        hue: number;
        phase: number;
    }
    const LEAF_MAX = 64;
    const LEAVES: { list: Leaf[]; last: number; key: string } = { list: [], last: 0, key: '' };
    const leafWind = (t: number, lat: number, out: number, K: LeafNumbers): { lat: number; out: number; up: number; gust: number } => {
        const base = 230 * K.wind;
        const f = t * 0.9 - lat / 700;
        const g = Math.max(0, Math.sin(f * 0.35) * 0.65 + Math.sin(f * 0.83 + 1.3) * 0.45 + Math.sin(f * 0.17 + 4) * 0.3);
        const gust = g * g * 520 * K.gusts * Math.max(0.3, K.wind);
        const turb = 70 * K.wind * Math.sin(t * 1.7 + lat / 95) * Math.sin(t * 0.93 + out / 140);
        return {
            lat: base + gust + turb,
            out: 0.18 * base * Math.sin(t * 0.37 + lat / 650) + 50 * K.wind * Math.sin(t * 1.3 + lat / 120 + out / 80),
            up: (gust * 0.35 + 40 * K.wind) * Math.sin(t * 2.1 + lat / 160 + out / 110),
            gust: g * g,
        };
    };
    function newLeaf(K: LeafNumbers, box: KaspLobbyBox, lat: number, inAir: boolean): Leaf {
        const r = Math.random;
        return {
            lat,
            out: box.wall - K.inside * 0.6 + r() * Math.max(100, K.dist + K.inside * 0.6),
            z: box.groundZ + 3 + (inAir ? 40 + r() * 200 : 0),
            vl: 0,
            vo: 0,
            vz: 0,
            yaw: r() * Math.PI * 2,
            pitch: r() < 0.5 ? 0 : Math.PI, // which side up
            roll: (r() - 0.5) * 0.3,
            wy: 0,
            wp: 0,
            wr: 0,
            ground: !inAir,
            need: 160 + r() * 200, // how much wind it takes to move this leaf on the street
            size: 0.7 + r() * 0.6,
            type: Math.floor(r() * 3),
            hue: r(),
            phase: r() * 10,
        };
    }
    function leavesStep(nowMs: number, box: KaspLobbyBox, K: LeafNumbers): { n: number; P: Float32Array; A: Float32Array; B: Float32Array } {
        const n = Math.max(0, Math.min(LEAF_MAX, Math.round(K.count)));
        const left = Math.max(box.u[0], -1700);
        const right = Math.min(box.u[1], 1500);
        const street = box.groundZ + 3;
        const floor = (box.floorZ || 0) + 2;
        const groundAt = (out: number): number => (out < box.wall ? floor : street);
        const key = n + '|' + Math.round(K.dist) + '|' + Math.round(K.inside);
        if (LEAVES.key !== key) {
            LEAVES.key = key;
            LEAVES.list = [];
            for (let i = 0; i < n; i++) LEAVES.list.push(newLeaf(K, box, left + Math.random() * (right - left), Math.random() < 0.15));
            LEAVES.last = 0;
        }
        const dt = LEAVES.last ? Math.min(0.05, Math.max(0, (nowMs - LEAVES.last) / 1000)) : 0;
        LEAVES.last = nowMs;
        const t = nowMs / 1000;
        const r = Math.random;
        const maxOut = box.wall + K.dist;
        const minOut = box.wall - K.inside;
        for (const L of LEAVES.list) {
            const ground = groundAt(L.out);
            // inside the hangar the wind is weaker (sheltered), fading in from the door
            const shelter = Math.max(0.25, Math.min(1, 1 - (box.wall - L.out) / Math.max(1, K.inside * 1.3)));
            const W0 = leafWind(t, L.lat, L.out, K);
            const W = { lat: W0.lat * shelter, out: W0.out * shelter, up: W0.up * shelter, gust: W0.gust };
            if (L.ground) {
                const w = Math.hypot(W.lat, W.out);
                if (w > L.need) {
                    // skitter: pulled along at a part of the wind's speed, jerky (the street is rough), turning a little
                    const k = Math.min(1, 2.5 * dt);
                    const share = 0.25 + 0.25 * Math.min(1, (w - L.need) / 300);
                    L.vl += (W.lat * share - L.vl) * k + (r() - 0.5) * 600 * dt;
                    L.vo += (W.out * share - L.vo) * k;
                    L.wy += ((r() - 0.5) * 6 - L.wy) * Math.min(1, 2 * dt);
                    if (r() < dt * 1.2 * Math.max(0, (w - L.need) / 250)) {
                        // a strong gust lifts it
                        L.ground = false;
                        L.vz = 60 + r() * 140 + W.gust * 200;
                        L.wp = (r() - 0.5) * 10;
                        L.wr = (r() - 0.5) * 8;
                    } else if (r() < dt * 0.25 * Math.min(2, (w - L.need) / 200)) {
                        // or it flips over
                        L.ground = false;
                        L.vz = 40 + r() * 50;
                        L.wp = (r() < 0.5 ? -1 : 1) * (8 + r() * 6);
                    }
                } else {
                    const fr = Math.exp(-5 * dt);
                    L.vl *= fr;
                    L.vo *= fr;
                    L.wy *= fr;
                }
                if (L.ground) L.z = ground;
            } else {
                // in the air: how the leaf lies decides how hard the wind pushes it and how slowly it falls
                const flat = Math.abs(Math.cos(L.pitch) * Math.cos(L.roll)); // 1 = broad side down, 0 = edge-on
                const kH = 1.2 + 0.9 * (2 - flat);
                const kV = 1.5 + 8 * flat;
                L.vl += (W.lat - L.vl) * Math.min(1, kH * dt);
                L.vo += (W.out - L.vo) * Math.min(1, kH * dt);
                L.vz += -980 * dt + (W.up - L.vz) * Math.min(1, kV * dt);
                // the falling leaf's rocking: it glides to one side, then the other
                L.vl += Math.sin(t * 3.1 + L.phase) * 220 * flat * dt;
                L.vo += Math.cos(t * 2.7 + L.phase) * 160 * flat * dt;
                // tumbling, driven by the air rushing past, slowly damped
                const rel = Math.hypot(W.lat - L.vl, W.out - L.vo, W.up - L.vz);
                L.wp += ((r() - 0.5) * rel * 0.12 - L.wp * 0.8) * dt + Math.sin(t * 4 + L.phase) * 12 * flat * dt;
                L.wr += ((r() - 0.5) * rel * 0.08 - L.wr * 0.8) * dt;
                L.wy += ((r() - 0.5) * 2 - L.wy * 0.5) * dt;
                L.pitch += L.wp * dt;
                L.roll += L.wr * dt;
            }
            L.yaw += L.wy * dt;
            L.lat += L.vl * dt;
            L.out += L.vo * dt;
            L.z += L.vz * dt;
            if (!L.ground && L.z <= ground) {
                // landing: a small bounce if it came down fast, else it settles flat on whichever side is nearer
                L.z = ground;
                if (L.vz < -160) {
                    L.vz *= -0.2;
                    L.wp *= 0.5;
                } else {
                    L.ground = true;
                    L.vz = 0;
                    L.pitch = Math.round(L.pitch / Math.PI) * Math.PI;
                    L.roll = (r() - 0.5) * 0.25;
                    L.wp = L.wr = 0;
                }
            }
            if (L.out < minOut) {
                L.out = minOut;
                L.vo = Math.abs(L.vo) * 0.3;
            }
            if (L.out > maxOut) L.vo -= (L.out - maxOut) * 20 * dt;
            if (L.z > ground + 900) L.vz = Math.min(L.vz, 0);
            if (L.ground) L.z = groundAt(L.out);
            if (L.lat > right + 100 || L.lat < left - 100) Object.assign(L, newLeaf(K, box, L.lat > right ? left - 80 : right + 80, r() < 0.3));
        }
        // to the GPU: place and size, the leaf's two axes (length, width) in the world with its kind, and its colour
        const P = new Float32Array(LEAF_MAX * 4);
        const A = new Float32Array(LEAF_MAX * 4);
        const B = new Float32Array(LEAF_MAX * 4);
        const o = box.o;
        const l = box.l;
        const toWorld = (vl: number, vo: number): number[] => [l[0] * vl + o[0] * vo, l[1] * vl + o[1] * vo];
        LEAVES.list.forEach((L, i) => {
            const cy = Math.cos(L.yaw);
            const sy = Math.sin(L.yaw);
            const cp = Math.cos(L.pitch);
            const sp = Math.sin(L.pitch);
            const cr = Math.cos(L.roll);
            const sr = Math.sin(L.roll);
            // rotation = turn (yaw) * nose up or down (roll) * over on its length (pitch); a = length axis, b = width axis, in (lat, out, up)
            const a = [cr * cy, cr * sy, -sr];
            const b = [sp * sr * cy - cp * sy, sp * sr * sy + cp * cy, sp * cr];
            const pw = toWorld(L.lat, L.out);
            const aw = toWorld(a[0], a[1]);
            const bw = toWorld(b[0], b[1]);
            P.set([pw[0], pw[1], L.z, L.size], i * 4);
            A.set([aw[0], aw[1], a[2], L.type], i * 4);
            B.set([bw[0], bw[1], b[2], L.hue], i * 4);
        });
        return { n: LEAVES.list.length, P, A, B };
    }

    // ---- the rain's gusts (26g3), the probe's gustNow ----
    // One gust at a time: it rises (1.5 to 3 s), holds (1.5 to 5 s) and falls (2.5 to 5 s), up to a peak of 0.6 to 1; the first one
    // 3 s after the rain starts, the next about `every` seconds after the last one ends (give or take 40 %). A little unrest all the
    // time, so the rain is never perfectly even. level = 0 calm to 1 at the top of a strong gust. drift = the rain's sideways travel
    // added up frame by frame from the wind of that moment, so the drops never jump when the wind changes; last = the frame it was
    // last added up at (0 = not running). It runs only while the lobby's frames are drawn.
    const GUST: {
        g: { readonly t0: number; readonly rise: number; readonly hold: number; readonly fall: number; readonly peak: number } | null;
        next: number;
        level: number;
        drift: number;
        last: number;
        soundAt: number;
    } = { g: null, next: 0, level: 0, drift: 0, last: 0, soundAt: 0 };
    const ease = (t: number): number => {
        const x = Math.max(0, Math.min(1, t));
        return x * x * (3 - 2 * x);
    };
    function gustNow(now: number): number {
        const K = look.gusts;
        if (K === null || look.rain === null) {
            GUST.g = null;
            GUST.next = 0;
            GUST.level = 0;
            return 0;
        }
        if (GUST.next === 0) GUST.next = now + 3000;
        if (GUST.g === null && now >= GUST.next) {
            GUST.g = {
                t0: now,
                rise: 1.5 + Math.random() * 1.5,
                hold: 1.5 + Math.random() * 3.5,
                fall: 2.5 + Math.random() * 2.5,
                peak: 0.6 + 0.4 * Math.random(),
            };
        }
        let v = 0;
        if (GUST.g !== null) {
            const g = GUST.g;
            const t = (now - g.t0) / 1000;
            if (t < g.rise) v = ease(t / g.rise);
            else if (t < g.rise + g.hold) v = 1;
            else if (t < g.rise + g.hold + g.fall) v = 1 - ease((t - g.rise - g.hold) / g.fall);
            else {
                GUST.g = null;
                GUST.next = now + K.every * 1000 * (0.6 + 0.8 * Math.random());
            }
            v *= g.peak;
        }
        v += 0.08 * Math.sin(now * 0.0011) * Math.sin(now * 0.00037 + 1.3);
        GUST.level = Math.max(0, Math.min(1, v));
        return GUST.level;
    }

    // ---- the snow's wind (26j), the probe's SNOWG and snowGustNow ----
    // drift = the snow's sideways travel added up frame by frame (the wind, a slow breeze, the gusts), so the flakes move exactly as
    // fast as the wind says and never jump when it changes; one gust at a time (rise, hold, fall), the next about `every` seconds later
    // (the first 5 s after the snowy lobby shows); level 0 = calm, 1 = the top of a strong gust. Only while the lobby is drawn.
    const SNOWG: {
        drift: number;
        last: number;
        level: number;
        g: { t0: number; rise: number; hold: number; fall: number; peak: number } | null;
        next: number;
        soundAt: number;
    } = { drift: 0, last: 0, level: 0, g: null, next: 0, soundAt: 0 };
    function snowGustNow(now: number): number {
        const K = look.snowGusts;
        if (K === null || look.snow === null) {
            SNOWG.g = null;
            SNOWG.next = 0;
            SNOWG.level = 0;
            return 0;
        }
        if (SNOWG.next === 0) SNOWG.next = now + 5000;
        if (SNOWG.g === null && now >= SNOWG.next) {
            SNOWG.g = {
                t0: now,
                rise: 1 + Math.random() * 1.5,
                hold: K.length * (0.6 + 0.8 * Math.random()),
                fall: 2 + Math.random() * 2,
                peak: 0.7 + 0.3 * Math.random(),
            };
        }
        let v = 0;
        if (SNOWG.g !== null) {
            const g = SNOWG.g;
            const t = (now - g.t0) / 1000;
            if (t < g.rise) v = ease(t / g.rise);
            else if (t < g.rise + g.hold) v = 1 - 0.15 * Math.abs(Math.sin(t * 3.1));
            else if (t < g.rise + g.hold + g.fall) v = 1 - ease((t - g.rise - g.hold) / g.fall);
            else {
                SNOWG.g = null;
                SNOWG.next = now + K.every * 1000 * (0.6 + 0.8 * Math.random());
            }
            v *= g.peak;
        }
        SNOWG.level = Math.max(0, Math.min(1, v));
        return SNOWG.level;
    }

    // ---- the Halloween night (26k) ----
    // Now and then one bat flies in through the door, circles under the ceiling and flies out (the probe's batStep: a smooth curve
    // through set points, 6 to 9 s; the first 6 s after the look shows, then about every `every` seconds, a random side each time).
    const BAT = { t0: 0, dur: 0, next: 0, side: 1 };
    function batStep(now: number, box: KaspLobbyBox, off: readonly number[]): number[] | null {
        const K = look.bats;
        if (K === null || !(K.inside > 0.5)) {
            BAT.next = 0;
            return null;
        }
        if (BAT.next === 0) BAT.next = now + 6000;
        if (now >= BAT.t0 + BAT.dur && now >= BAT.next) {
            BAT.t0 = now;
            BAT.dur = 6000 + Math.random() * 3000;
            BAT.next = now + K.every * 1000 * (0.6 + 0.8 * Math.random());
            BAT.side = Math.random() < 0.5 ? -1 : 1;
        }
        if (BAT.t0 === 0 || now >= BAT.t0 + BAT.dur) return null;
        const s = (now - BAT.t0) / BAT.dur;
        const o = box.o;
        const l = box.l;
        const w = box.wall;
        const sd = BAT.side;
        const C = [
            [w + 1800, -600 * sd, 820],
            [w + 300, -200 * sd, 600],
            [w - 150, -100 * sd, 520],
            [w - 1000, 400 * sd, 820],
            [w - 1700, -200 * sd, 950],
            [w - 900, -700 * sd, 760],
            [w - 100, 250 * sd, 540],
            [w + 400, 450 * sd, 620],
            [w + 1900, 800 * sd, 860],
        ].map(([a, b, z]) => [o[0] * a + l[0] * b, o[1] * a + l[1] * b, z]);
        const seg = s * (C.length - 3);
        const i = Math.min(C.length - 4, Math.floor(seg));
        const u = seg - i;
        const cr = (p0: number, p1: number, p2: number, p3: number): number =>
            0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
        return [0, 1, 2].map((k) => cr(C[i][k], C[i + 1][k], C[i + 2][k], C[i + 3][k]) + off[k]);
    }
    // Haunted lamps: now and then the hangar's light stutters (the lamp flicker, without a thunder; the first 8 s after the look shows).
    const HAUNT = { next: 0 };
    // Spooky sounds (the probe's hwSoundsTick): an owl, a far wolf and a creak (credits in HALLOWEEN-SOUNDS-CREDITS.txt), each played
    // about every `every` seconds (the creak half as often; the first 4 s to `every` s in), to one side, at % x 0.06 / its loudness.
    const SPOOKY_FILES: Readonly<Record<'owl' | 'wolf' | 'creak', string>> = { owl: 'halloween-owl.mp3', wolf: 'halloween-wolf.mp3', creak: 'halloween-creak.mp3' };
    const SPOOKY: {
        ctx: AudioContext | null;
        state: 'none' | 'loading' | 'ready';
        bufs: Map<'owl' | 'wolf' | 'creak', { readonly buf: AudioBuffer; readonly norm: number }>;
        next: Map<string, number>;
        // until when the last one is still playing (with a short gap after it)
        busy: number;
    } = { ctx: null, state: 'none', bufs: new Map(), next: new Map(), busy: 0 };
    function spookyTick(nowMs: number): void {
        const K = look.spooky;
        const ctx = sound.ctx;
        if (K === null || !soundWanted()) {
            SPOOKY.next.clear();
            SPOOKY.busy = 0;
            return;
        }
        if (ctx === null) return;
        if (SPOOKY.ctx !== ctx) {
            SPOOKY.ctx = ctx;
            SPOOKY.state = 'none';
            SPOOKY.bufs.clear();
        }
        if (SPOOKY.state === 'none') {
            const base = document.documentElement.getAttribute('data-kasp-hangar-base');
            if (base === null) return;
            SPOOKY.state = 'loading';
            const keys: ReadonlyArray<'owl' | 'wolf' | 'creak'> = ['owl', 'wolf', 'creak'];
            Promise.all(
                keys.map((k) =>
                    loadBuffer(ctx, base, SPOOKY_FILES[k]).then(
                        (buf) => {
                            const d = buf.getChannelData(0);
                            let sum = 0;
                            for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
                            SPOOKY.bufs.set(k, { buf, norm: Math.min(8, 0.06 / Math.max(1e-4, Math.sqrt(sum / d.length))) });
                        },
                        () => {
                            // a missing one is left out
                        },
                    ),
                ),
            ).then(() => {
                SPOOKY.state = 'ready';
            });
            return;
        }
        if (SPOOKY.state !== 'ready' || ctx.state !== 'running') return;
        for (const [k, one] of SPOOKY.bufs) {
            if (!(K[k] > 0)) continue;
            const at = SPOOKY.next.get(k);
            if (at === undefined) {
                SPOOKY.next.set(k, nowMs + (4 + Math.random() * K.every) * 1000);
                continue;
            }
            if (nowMs < at) continue;
            // never two at once (owner 2026-11-21: the wolf and the creak sometimes came together): one that is due while another
            // still plays waits until it has ended, plus 1.5 to 3.5 s
            if (nowMs < SPOOKY.busy) {
                SPOOKY.next.set(k, SPOOKY.busy + Math.random() * 2000);
                continue;
            }
            SPOOKY.busy = nowMs + one.buf.duration * 1000 + 1500;
            SPOOKY.next.set(k, nowMs + K.every * 1000 * (0.7 + 0.9 * Math.random()) * (k === 'creak' ? 1.5 : 1));
            const src = ctx.createBufferSource();
            const g = ctx.createGain();
            const pan = ctx.createStereoPanner();
            src.buffer = one.buf;
            g.gain.value = (K[k] / 100) * one.norm;
            pan.pan.value = (Math.random() * 2 - 1) * 0.7;
            src.connect(g);
            g.connect(pan);
            pan.connect(ctx.destination);
            src.start();
        }
    }

    // ---- thunder and lightning (26g4), the probe's STORM, strike and makeBolt ----
    // A strike every `every` seconds (give or take `random` of it; the first 4 s after the stormy lobby shows): 2 to 4 flash pulses
    // (the first the strongest, each dying away fast) and a new bolt picture. door = where the doorway is seen from the camera
    // (across, in radians), so the bolt is put where the sky is seen; bolt = the last bolt picture (null until one is made); strikes =
    // how many so far. strike() is the one place a strike starts. It runs only while the lobby's frames are drawn.
    const STORM: {
        next: number;
        t0: number;
        pulses: Array<{ readonly t: number; readonly a: number; readonly tau: number }>;
        door: number;
        bolt: ImageBitmap | null;
        strikes: number;
        // the last thunder recording played (26g4b), so they take turns
        seq: number;
        // the side the lightning shadow comes from, degrees, new every strike (26g4c)
        side: number;
    } = { next: 0, t0: 0, pulses: [], door: 0, bolt: null, strikes: 0, seq: -1, side: 0 };
    // The bolt: a jagged line with branches and a glow, in a picture whose columns are directions across the door (+-0.6 rad) and
    // rows heights; one bolt (two 30 % of the time), the first straight towards the doorway, the others a little to the side.
    function makeBolt(): OffscreenCanvas {
        const W = 512;
        const H = 512;
        const c = new OffscreenCanvas(W, H);
        const g = c.getContext('2d');
        if (g === null) throw new Error('bolt canvas');
        g.fillStyle = '#000';
        g.fillRect(0, 0, W, H);
        const seg = (x0: number, y0: number, x1: number, y1: number, disp: number, out: number[][], depth: number): void => {
            if (depth === 0 || disp < 1.5) {
                out.push([x1, y1]);
                return;
            }
            const mx = (x0 + x1) / 2 + (Math.random() - 0.5) * disp;
            const my = (y0 + y1) / 2 + (Math.random() - 0.5) * disp * 0.4;
            seg(x0, y0, mx, my, disp / 2, out, depth - 1);
            seg(mx, my, x1, y1, disp / 2, out, depth - 1);
        };
        const draw = (pts: number[][], w: number, a: number): void => {
            g.beginPath();
            g.moveTo(pts[0][0], pts[0][1]);
            for (const q of pts.slice(1)) g.lineTo(q[0], q[1]);
            g.lineWidth = w;
            g.strokeStyle = 'rgba(255,255,255,' + a + ')';
            g.stroke();
        };
        g.lineJoin = 'round';
        g.lineCap = 'round';
        const nb = Math.random() < 0.3 ? 2 : 1;
        for (let n = 0; n < nb; n++) {
            const az = STORM.door + (n === 0 ? (Math.random() - 0.5) * 0.1 : (Math.random() < 0.5 ? -1 : 1) * (0.08 + 0.06 * Math.random()));
            const x0 = W * Math.min(0.94, Math.max(0.06, az / 1.2 + 0.5));
            const main: number[][] = [[x0, 0]];
            seg(x0, 0, x0 + (Math.random() - 0.5) * 60, H, 70, main, 7);
            g.shadowColor = '#fff';
            g.shadowBlur = 16;
            draw(main, n === 0 ? 4.5 : 3, 1);
            g.shadowBlur = 0;
            draw(main, 10, 0.14);
            const nBranch = n === 0 ? 2 : 1;
            for (let k = 0; k < nBranch; k++) {
                const i = Math.floor(main.length * (0.15 + 0.45 * Math.random()));
                const b: number[][] = [main[i]];
                const dx = (Math.random() < 0.5 ? -1 : 1) * (20 + 40 * Math.random());
                seg(main[i][0], main[i][1], main[i][0] + dx, main[i][1] + 50 + 70 * Math.random(), 25, b, 5);
                g.shadowBlur = 10;
                g.shadowColor = '#fff';
                draw(b, 1.8, 0.8);
                g.shadowBlur = 0;
                draw(b, 6, 0.1);
            }
        }
        return c;
    }
    // One strike: the flash pulses and a new bolt picture (a picture that cannot be made leaves only the bolt out).
    function strike(): void {
        const n = 2 + Math.floor(Math.random() * 3);
        const pulses: Array<{ t: number; a: number; tau: number }> = [];
        let t = 0;
        for (let i = 0; i < n; i++) {
            pulses.push({ t, a: i === 0 ? 1 : 0.35 + 0.55 * Math.random(), tau: 0.05 + 0.06 * Math.random() });
            t += 0.06 + 0.16 * Math.random();
        }
        STORM.t0 = performance.now();
        STORM.pulses = pulses;
        STORM.strikes++;
        STORM.side = (Math.random() * 2 - 1) * (look.flashShadow?.spread ?? 0);
        try {
            createImageBitmap(makeBolt()).then(
                (bmp) => {
                    STORM.bolt?.close();
                    STORM.bolt = bmp;
                },
                () => {},
            );
        } catch {
            // no bolt this time
        }
        // the thunder (26g4b): the next recording in turn, the nearer the sooner after the flash
        const K = look.storm;
        if (K === null) return;
        STORM.seq = (STORM.seq + 1) % THUNDERS.length;
        const idx = STORM.seq;
        const delay = Math.max(0.2, K.delay * THUNDERS[idx].delayK * (0.8 + 0.4 * Math.random()));
        window.setTimeout(() => {
            playThunder(idx);
            maybeFlicker(THUNDERS[idx].level);
        }, delay * 1000);
    }
    // The lamp flicker (26g4b, the probe's FLICK, startFlicker, flickerNow, maybeFlicker): a list of [time, brightness] steps played
    // from t0, dips and partial recoveries, then back up to 1 over half a second. null = no flicker.
    const FLICK: { t0: number; steps: Array<readonly [number, number]> | null; end: number } = { t0: 0, steps: null, end: 0 };
    function startFlicker(lvl: number): void {
        const K = look.flicker;
        if (K === null) return;
        const steps: Array<readonly [number, number]> = [];
        let t = 0;
        const end = K.length * (0.75 + 0.5 * Math.random());
        while (t < end) {
            steps.push([t, 1 - K.dark * (0.55 + 0.45 * Math.random()) * lvl]);
            t += 0.03 + 0.11 * Math.random();
            steps.push([t, 0.75 + 0.25 * Math.random()]);
            t += 0.03 + 0.16 * Math.random();
        }
        steps.push([t, 1 - K.dark * 0.35 * lvl]);
        FLICK.t0 = performance.now();
        FLICK.steps = steps;
        FLICK.end = t;
    }
    // how bright the hangar's inside is now (1 = as it is)
    function flickerNow(now: number): number {
        const steps = FLICK.steps;
        if (steps === null) return 1;
        const t = (now - FLICK.t0) / 1000;
        const last = steps[steps.length - 1][1];
        if (t >= FLICK.end + 0.5) {
            FLICK.steps = null;
            return 1;
        }
        if (t >= FLICK.end) return lerp(last, 1, (t - FLICK.end) / 0.5);
        let v = 1;
        for (const [at, x] of steps) {
            if (at <= t) v = x;
            else break;
        }
        return v;
    }
    // a thunder just started: the nearer it is (its recording's level), the likelier the lamps flicker
    function maybeFlicker(lvl: number): void {
        const K = look.flicker;
        if (K === null || K.dark <= 0) return;
        if (Math.random() < K.chance * Math.max(0, Math.min(1, (lvl - 0.4) / 0.6))) startFlicker(lvl);
    }
    // The strike timer and how bright the flash is now (0 = none, at most 1.4 x the look's flash).
    function stormNow(now: number): number {
        const K = look.storm;
        if (K === null) {
            STORM.next = 0;
            return 0;
        }
        if (STORM.next === 0) STORM.next = now + 4000;
        if (now >= STORM.next) {
            strike();
            STORM.next = now + K.every * 1000 * (1 + (Math.random() * 2 - 1) * K.random);
        }
        let flash = 0;
        const dt = (now - STORM.t0) / 1000;
        for (const q of STORM.pulses) if (dt >= q.t) flash += q.a * Math.exp(-(dt - q.t) / q.tau);
        return Math.min(1.4, flash) * K.flash;
    }

    // ---- the lobby's sounds: the calm city by day (26f3), the night ambience and the far dog at night (26f4d), from the probe ----
    // Only while the lobby is drawn. Each loop recording is cut into a seamless loop (its last 1.5 s faded into its start, equal power)
    // and played at its target loudness (divided by the file's own loudness) times the look's %, by day or at night. The far dog: one
    // of the two bark groups in its recording, muffled by distance, to one side, a slightly different dog each time, through an outdoor
    // echo, about every `every` seconds (give or take 20 %; the first 3 to 7 s after the night sounds start). The rain's hiss (26g2) is
    // made in the page, no file. Browsers start no sound before a click or a key on the page, so everything waits for the first one.
    // Any failure leaves that sound silent.
    interface SoundLoop {
        readonly file: string;
        readonly target: number;
        // seconds cut from the recording's start before it is made into a loop (the cicada file clicks at 0.5 s)
        readonly skip: number;
        readonly level: () => number;
    }
    const SOUND_LOOPS: Readonly<Record<string, SoundLoop>> = {
        city: { file: 'day-city.mp3', target: 0.015, skip: 0, level: () => (look.city / 100) * (1 - nightAmount()) },
        // the very sunny day's cicadas (26i; credit in DAY-SOUNDS-CREDITS.txt), quieter than the city
        cicada: { file: 'day-cicada.mp3', target: 0.008, skip: 1.2, level: () => (look.cicadas / 100) * (1 - nightAmount()) },
        night: {
            file: 'night-ambience.mp3',
            target: 0.015,
            skip: 0,
            level: () => (look.nightSounds === null ? 0 : look.nightSounds.ambience / 100) * nightAmount(),
        },
        // rain on the roof (26g3): a real recording of rain drumming on a roof heard from inside (credit in RAIN-ROOF-CREDITS.txt);
        // its gain is set with the rain's sounds (rainGains), louder with the gusts
        // the snowy looks' wind and falling snow (26j; credits in SNOW-SOUNDS-CREDITS.txt), by day and at night; the wind louder in
        // a snow gust (set with snowGains, a few times a second)
        wind: {
            file: 'snow-wind.mp3',
            target: 0.02,
            skip: 0,
            level: () =>
                look.snowSounds === null ? 0 : (look.snowSounds.volume / 100) * (look.snowGusts !== null ? 1 + look.snowGusts.sound * SNOWG.level : 1),
        },
        snowfall: { file: 'snow-fall.mp3', target: 0.012, skip: 0, level: () => (look.snowSounds === null ? 0 : look.snowSounds.fall / 100) },
        roof: { file: 'rain-roof.webm', target: 0.14, skip: 0, level: () => (look.rain === null ? 0 : look.roof / 100) },
    };
    // the barks in the recording: [start, end] in seconds (two bark groups, each with its short tail)
    const DOG = { file: 'night-dog-far.mp3', barks: [[0.6, 3.0], [4.3, 6.6]] as ReadonlyArray<readonly [number, number]> };
    const sound: {
        ctx: AudioContext | null;
        state: 'none' | 'loading' | 'ready' | 'failed';
        loops: Map<string, { readonly gain: GainNode; readonly norm: number }>;
        dog: { readonly buf: AudioBuffer; readonly norm: number } | null;
        dogBus: GainNode | null;
        rain: GainNode | null;
        next: number;
        barks: number;
    } = { ctx: null, state: 'none', loops: new Map(), dog: null, dogBus: null, rain: null, next: 0, barks: 0 };
    // The rain's hiss (the probe's rainSound, its numbers): 4 seconds of pink-ish noise per channel (its own seed, so the same every
    // time) with about 180 short ticks a second like drops, its last 0.1 s faded into its start (a seamless loop), brought to one
    // loudness, then a high-pass at 200 Hz and a low-pass at 4500 Hz, as if heard from inside the hangar. Its gain starts at 0.
    function rainHiss(ctx: AudioContext): GainNode {
        const rate = ctx.sampleRate;
        const secs = 4;
        const n = Math.round(rate * secs);
        const lap = Math.round(rate * 0.1);
        const buffer = ctx.createBuffer(2, n, rate);
        for (let ch = 0; ch < 2; ch++) {
            let seed = 0x2545f491 + ch * 7919;
            const rnd = (): number => {
                seed ^= seed << 13;
                seed ^= seed >>> 17;
                seed ^= seed << 5;
                return (seed >>> 0) / 4294967296;
            };
            const raw = new Float32Array(n + lap);
            let b0 = 0;
            let b1 = 0;
            let b2 = 0;
            for (let i = 0; i < raw.length; i++) {
                const w = rnd() * 2 - 1;
                b0 = 0.99765 * b0 + w * 0.099046;
                b1 = 0.963 * b1 + w * 0.2965164;
                b2 = 0.57 * b2 + w * 1.0526913;
                raw[i] = b0 + b1 + b2 + w * 0.1848;
            }
            for (let k = 0; k < secs * 180; k++) {
                const at = Math.floor(rnd() * raw.length);
                const amp = 0.6 + 3 * rnd() ** 3;
                const len = Math.round(rate * (0.002 + 0.005 * rnd()));
                for (let j = 0; j < len && at + j < raw.length; j++) raw[at + j] += (rnd() * 2 - 1) * amp * Math.exp(-j / (len / 4));
            }
            const out = buffer.getChannelData(ch);
            for (let i = 0; i < n; i++) out[i] = raw[i];
            for (let i = 0; i < lap; i++) {
                const t = i / lap;
                out[i] = raw[n + i] * Math.cos((t * Math.PI) / 2) + raw[i] * Math.sin((t * Math.PI) / 2);
            }
            let sum = 0;
            for (let i = 0; i < n; i++) sum += out[i] * out[i];
            const scale = 0.12 / Math.sqrt(sum / n || 1);
            for (let i = 0; i < n; i++) out[i] *= scale;
        }
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 200;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 4500;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(hp);
        hp.connect(lp);
        lp.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        return gain;
    }
    const wantedLoops = (): string[] =>
        Object.keys(SOUND_LOOPS).filter((k) =>
            k === 'city'
                ? look.city > 0
                : k === 'cicada'
                  ? look.cicadas > 0
                  : k === 'roof'
                    ? look.rain !== null && look.roof > 0
                    : k === 'wind' || k === 'snowfall'
                      ? look.snowSounds !== null
                      : look.nightSounds !== null,
        );
    function loadBuffer(ctx: AudioContext, base: string, file: string): Promise<AudioBuffer> {
        return fetch(base + file)
            .then((r) => {
                if (!r.ok) throw new Error(file + ' ' + r.status);
                return r.arrayBuffer();
            })
            .then((data) => ctx.decodeAudioData(data));
    }
    function loadSounds(ctx: AudioContext): void {
        if (look.rain !== null && look.rain.volume > 0) {
            try {
                sound.rain = rainHiss(ctx);
            } catch {
                sound.rain = null;
            }
        }
        const base = document.documentElement.getAttribute('data-kasp-hangar-base');
        if (base === null) {
            sound.state = 'failed';
            return;
        }
        if (look.storm !== null && look.storm.volume > 0) loadThunder(ctx, base);
        sound.state = 'loading';
        const loops = wantedLoops().map((key) =>
            loadBuffer(ctx, base, SOUND_LOOPS[key].file).then((buf) => {
                const rate = buf.sampleRate;
                const from = Math.min(Math.round(SOUND_LOOPS[key].skip * rate), Math.floor(buf.length / 4));
                const len = buf.length - from;
                const lap = Math.min(Math.round(rate * 1.5), Math.floor(len / 3));
                const n = len - lap;
                const out = ctx.createBuffer(buf.numberOfChannels, n, rate);
                let sum = 0;
                for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                    const src = buf.getChannelData(ch);
                    const dst = out.getChannelData(ch);
                    for (let i = 0; i < n; i++) dst[i] = src[from + i];
                    for (let i = 0; i < lap; i++) {
                        const t = i / lap;
                        dst[i] = src[from + n + i] * Math.cos((t * Math.PI) / 2) + src[from + i] * Math.sin((t * Math.PI) / 2);
                    }
                    for (let i = 0; i < n; i++) sum += dst[i] * dst[i];
                }
                const node = ctx.createBufferSource();
                node.buffer = out;
                node.loop = true;
                const gain = ctx.createGain();
                gain.gain.value = 0;
                node.connect(gain);
                gain.connect(ctx.destination);
                node.start();
                sound.loops.set(key, { gain, norm: SOUND_LOOPS[key].target / Math.sqrt(sum / (n * buf.numberOfChannels) || 1) });
            }),
        );
        const dog =
            look.nightSounds !== null && look.nightSounds.dogs > 0
                ? loadBuffer(ctx, base, DOG.file).then((buf) => {
                      // loudness of the barks themselves (not the quiet street between them), so every bark plays at about the same level
                      const rate = buf.sampleRate;
                      const d = buf.getChannelData(0);
                      let sum = 0;
                      let cnt = 0;
                      for (const [a, b] of DOG.barks) for (let i = Math.floor(a * rate); i < Math.min(d.length, b * rate); i++) {
                          sum += d[i] * d[i];
                          cnt++;
                      }
                      sound.dog = { buf, norm: 0.08 / Math.sqrt(sum / (cnt || 1) || 1e-6) };
                      // the dogs' way out: straight, plus an outdoor echo (a delay that repeats softly, darker each time)
                      const bus = ctx.createGain();
                      const echo = ctx.createDelay(1);
                      const back = ctx.createGain();
                      const dark = ctx.createBiquadFilter();
                      const wet = ctx.createGain();
                      echo.delayTime.value = 0.32;
                      back.gain.value = 0.32;
                      dark.type = 'lowpass';
                      dark.frequency.value = 1300;
                      wet.gain.value = 0.45;
                      bus.connect(ctx.destination);
                      bus.connect(echo);
                      echo.connect(dark);
                      dark.connect(back);
                      back.connect(echo);
                      dark.connect(wet);
                      wet.connect(ctx.destination);
                      sound.dogBus = bus;
                  })
                : Promise.resolve();
        Promise.all([...loops, dog]).then(
            () => {
                sound.state = 'ready';
                applySounds();
            },
            () => {
                sound.state = 'failed';
            },
        );
    }
    // The thunder (26g4b, the probe's THUNDERS): three real recordings (credits in THUNDER-CREDITS.txt), played in turn, soft and far,
    // medium, loud and near. start / dur = the part played (seconds), level = how loud against the others, delayK = how long after the
    // flash (x the look's delay), fade = the fade out at its end. Each is decoded once; its loudness from its peak in that part. A file
    // that cannot be loaded leaves the thunder silent (the lightning and the flicker go on).
    const THUNDERS: ReadonlyArray<{ readonly file: string; readonly start: number; readonly dur: number; readonly level: number; readonly delayK: number; readonly fade: number }> = [
        { file: 'thunder-soft.ogg', start: 0.8, dur: 8, level: 0.5, delayK: 1.8, fade: 2 },
        { file: 'thunder-medium.ogg', start: 10, dur: 14, level: 0.8, delayK: 1, fade: 3 },
        { file: 'thunder-loud.ogg', start: 3.2, dur: 14, level: 1, delayK: 0.55, fade: 3 },
    ];
    const thunder: { state: 'none' | 'loading' | 'ready' | 'failed'; bufs: Array<{ readonly buf: AudioBuffer; readonly norm: number }>; played: number } = {
        state: 'none',
        bufs: [],
        played: 0,
    };
    function loadThunder(ctx: AudioContext, base: string): void {
        thunder.state = 'loading';
        Promise.all(
            THUNDERS.map((t) =>
                loadBuffer(ctx, base, t.file).then((buf) => {
                    const d = buf.getChannelData(0);
                    const r0 = Math.floor(t.start * buf.sampleRate);
                    const r1 = Math.min(d.length, Math.floor((t.start + t.dur) * buf.sampleRate));
                    let pk = 0;
                    for (let i = r0; i < r1; i++) pk = Math.max(pk, Math.abs(d[i]));
                    return { buf, norm: 0.9 / (pk || 1) };
                }),
            ),
        ).then(
            (bufs) => {
                thunder.bufs = bufs;
                thunder.state = 'ready';
            },
            () => {
                thunder.state = 'failed';
            },
        );
    }
    // One thunder (the probe's thunderSample): its part at the look's % x its level x its loudness, held, then faded out; only while
    // the lobby is drawn.
    function playThunder(idx: number): void {
        const ctx = sound.ctx;
        const K = look.storm;
        const T = THUNDERS[idx];
        const B = thunder.bufs[idx];
        if (ctx === null || K === null || B === undefined || !soundWanted()) return;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const src = ctx.createBufferSource();
        src.buffer = B.buf;
        const gain = ctx.createGain();
        const now = ctx.currentTime;
        const v = (K.volume / 100) * T.level * B.norm;
        gain.gain.setValueAtTime(v, now);
        gain.gain.setValueAtTime(v, now + T.dur - T.fade);
        gain.gain.linearRampToValueAtTime(0.0001, now + T.dur);
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(now, T.start, T.dur);
        thunder.played++;
    }
    // one bark: a part of the recording, faded in and out, muffled by distance, to one side
    function playBark(side: number): void {
        const ctx = sound.ctx;
        const D = sound.dog;
        const F = look.nightSounds;
        if (ctx === null || D === null || sound.dogBus === null || F === null) return;
        const [a, b] = DOG.barks[Math.floor(Math.random() * DOG.barks.length)];
        const far = Math.max(0, Math.min(1, F.far + (Math.random() - 0.5) * 0.3));
        const t0 = ctx.currentTime;
        const dur = b - a;
        const src = ctx.createBufferSource();
        src.buffer = D.buf;
        src.playbackRate.value = 0.94 + Math.random() * 0.12; // a slightly different dog each time
        const g = ctx.createGain();
        const level = (F.dogs / 100) * D.norm * (1 - 0.55 * far) * nightAmount();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(level, t0 + 0.03);
        g.gain.setValueAtTime(level, t0 + Math.max(0.05, dur - 0.15));
        g.gain.linearRampToValueAtTime(0, t0 + dur);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 4500 - 3700 * far;
        const pan = ctx.createStereoPanner();
        pan.pan.value = side;
        src.connect(lp);
        lp.connect(g);
        g.connect(pan);
        pan.connect(sound.dogBus);
        src.start(t0, a, dur);
        sound.barks++;
    }
    // Whether the lobby's sounds should play: the lobby is drawn and nothing stopped it.
    const soundWanted = (): boolean => !broken && !passBroken && passScene !== null && performance.now() - lobbyTickAt < 1000;
    // The rain's sounds, louder with the gust of this moment (26g3; the probe's applyRainSound and applyRoof): the hiss at its % x 0.6,
    // the roof at its % x the recording's loudness, both eased over 0.4 s. Also sent
    // from the frame every 120 ms while gusts blow, so they swell smoothly with each gust.
    function rainGains(want: boolean): void {
        const ctx = sound.ctx;
        if (ctx === null) return;
        const R = look.rain;
        const swell = 1 + (look.gusts !== null ? look.gusts.louder * GUST.level : 0);
        if (sound.rain !== null) sound.rain.gain.setTargetAtTime(want && R !== null ? (R.volume / 100) * 0.6 * swell : 0, ctx.currentTime, 0.4);
        const roof = sound.loops.get('roof');
        if (roof !== undefined) roof.gain.gain.setTargetAtTime(want ? SOUND_LOOPS.roof.level() * roof.norm * swell : 0, ctx.currentTime, 0.4);
    }
    // The snow's wind loop to its level now (26j): called a few times a second while the snow gusts, as the probe's applyDaySounds.
    function snowGains(want: boolean): void {
        const ctx = sound.ctx;
        const lp = sound.loops.get('wind');
        if (ctx === null || lp === undefined) return;
        lp.gain.gain.setTargetAtTime(want ? SOUND_LOOPS.wind.level() * lp.norm : 0, ctx.currentTime, 0.8);
    }
    // Every half second: each loop fades to its level while the lobby is drawn and nothing stopped it, else to silence; the far dog.
    function applySounds(): void {
        const ctx = sound.ctx;
        const want = soundWanted();
        if (want && ctx === null && sound.state === 'none' && unlocked) {
            try {
                const made = new AudioContext();
                sound.ctx = made;
                loadSounds(made);
            } catch {
                sound.state = 'failed';
            }
            return;
        }
        if (ctx === null) return;
        if (want && ctx.state === 'suspended') ctx.resume().catch(() => {});
        for (const [key, lp] of sound.loops) {
            if (key !== 'roof') lp.gain.gain.setTargetAtTime(want ? SOUND_LOOPS[key].level() * lp.norm : 0, ctx.currentTime, 0.8);
        }
        rainGains(want);
        const F = look.nightSounds;
        const now = performance.now();
        if (!want || F === null || !(F.dogs > 0) || sound.state !== 'ready' || nightAmount() <= 0.02) {
            sound.next = 0;
            return;
        }
        if (sound.next === 0) {
            sound.next = now + 3000 + Math.random() * 4000;
            return;
        }
        if (now < sound.next) return;
        playBark((Math.random() < 0.5 ? -1 : 1) * (0.35 + Math.random() * 0.5));
        sound.next = now + F.every * 1000 * (0.8 + 0.4 * Math.random());
    }
    let unlocked = false;
    if (wantedLoops().length > 0 || (look.rain !== null && look.rain.volume > 0)) {
        const unlock = (): void => {
            unlocked = true;
            window.removeEventListener('pointerdown', unlock, true);
            window.removeEventListener('keydown', unlock, true);
            applySounds();
        };
        window.addEventListener('pointerdown', unlock, true);
        window.addEventListener('keydown', unlock, true);
        window.setInterval(applySounds, 500);
    }

    // One frame of the pass (the probe's buildFrame, the groups of the day normal look).
    function buildFrame(vp: Float32Array, pos: KaspLobbyVector, ps: PassScene): KaspLobbyPassFrame {
        const L = look;
        const box = ps.box;
        const mix1 = (v: readonly number[], k: number): number[] => v.map((x) => lerp(1, x, k));
        const hour = L.time.hour;
        const st = timeState(hour);
        const s = L.time.strength;
        let inn = mix1(st.inn, s * L.time.inside);
        let hor = mix1(st.hor, s);
        let zen = mix1(st.zen, s);
        // the hot sun (26h; its colour and glow are 0 on the foggy night, only its dust shows): the light warmer
        const H = L.heat;
        if (H !== null) {
            const w = H.warmth;
            const warm = [1, 1 - 0.05 * w, 1 - 0.16 * w];
            hor = hor.map((x, i) => x * warm[i]);
            zen = zen.map((x, i) => x * lerp(1, warm[i], 0.6));
            inn = inn.map((x, i) => x * lerp(1, warm[i], 0.5));
        }
        // a seasonal outside carries its own time of day (26k): our colours touch it only lightly
        ensureSeasonal();
        const OS = L.outside;
        const seasonOn = OS !== null && season !== null;
        if (OS !== null && season !== null) {
            const keep = Math.max(0, Math.min(1, OS.own));
            hor = hor.map((x) => lerp(x, 1, keep));
            zen = zen.map((x) => lerp(x, 1, keep));
        }
        // the overcast: the whole outside (town, sky, road) darker, the inside darker and a little cooler
        const O = L.overcast;
        if (O !== null) {
            const cool = [0.94, 0.97, 1.04];
            hor = hor.map((x) => x * O.out);
            zen = zen.map((x) => x * O.out);
            inn = inn.map((x, i) => x * O.dark * cool[i]);
        }
        // the lamp flicker (26g4b): the hangar's inside dims and stutters (the tank too), and the night lamps' light with it
        const fk = L.flicker !== null ? flickerNow(performance.now()) : 1;
        if (fk < 1) inn = inn.map((x) => x * fk);
        const night = nightAmount();
        const outLight = [0, 1, 2].map((i) => (hor[i] * 2 + zen[i]) / 3); // how lit the outside is, for colours drawn over it
        const lightOf = (c: readonly number[], m: number): number[] => c.map((x, i) => x * Math.max(m, outLight[i]));
        // the floor into the road: the day numbers by day, the night numbers at night
        const rd: RoadNumbers = L.road;
        const rn = L.roadN;
        const mixN = (k: keyof RoadNumbers): number => lerp(rd[k], rn[k], night);
        const roadAmount = rd.amount * (1 - night) + rn.amount * night;
        const graded = [inn, hor, zen].some((c) => c.some((x) => Math.abs(x - 1) > 0.002));
        const glow = st.glow * s + (H !== null ? 0.9 * H.glare : 0);
        const nowMs = performance.now();
        // the lightning (26g4): where the doorway is seen from the camera (for the next bolt), then the strike timer and the flash
        {
            const dx = box.o[0] * box.wall - box.l[0] * 50 - pos.x;
            const dy = box.o[1] * box.wall - box.l[1] * 50 - pos.y;
            STORM.door = Math.atan2(dx * box.l[0] + dy * box.l[1], dx * box.o[0] + dy * box.o[1]);
        }
        const flash = stormNow(nowMs);
        const Sm = L.storm;
        const Fg = L.fog;
        const atmosOn = O !== null || glow > 0.01 || st.stars * s > 0.01 || flash > 0.003 || Fg !== null || (L.snow !== null && L.snow.cover > 0);
        const door = Math.max(0.02, L.door);
        ensureStandard();
        ensureSky();
        const std = standard;
        const nightAsset = std === null ? null : nightAssetOf(std);
        const lenses = std === null ? null : lensAssetOf(std);
        const time = (nowMs % 3600000) / 1000;
        const R = L.rain;
        // the gusts (26g3): the wind of this moment (the extra slant with the wind's own sign), the sideways travel added up from it
        // (from wind x time at the first frame, each frame's time capped at 0.1 s so a pause never makes the drops jump)
        const K = R !== null ? L.gusts : null;
        const gust = gustNow(nowMs);
        const windNow = R === null ? 0 : R.wind + (K !== null ? K.slant * gust * (R.wind < 0 ? -1 : 1) : 0);
        if (R !== null && K !== null) {
            if (GUST.last === 0) GUST.drift = R.wind * time;
            else GUST.drift += windNow * Math.min(0.1, Math.max(0, (nowMs - GUST.last) / 1000));
            GUST.last = nowMs;
            if (nowMs - GUST.soundAt > 120) {
                GUST.soundAt = nowMs;
                rainGains(soundWanted());
            }
        } else GUST.last = 0;
        // the snow's wind of this moment (26j): the wind, a slow breeze (never below a third of it), and the snow gusts; the wind
        // sound follows the gusts a few times a second
        const sg = snowGustNow(nowMs);
        const N = L.snow;
        const SG = L.snowGusts;
        if (N !== null) {
            const t = nowMs / 1000;
            const breeze = 1 + 0.5 * Math.sin(t * 0.23) * Math.sin(t * 0.071 + 1.3);
            const dir = N.wind < 0 ? -1 : 1;
            const speed = N.wind * 120 * breeze + (SG !== null ? dir * sg * SG.strength * 900 : 0);
            if (SNOWG.last !== 0) SNOWG.drift += speed * Math.min(0.1, Math.max(0, (nowMs - SNOWG.last) / 1000));
            SNOWG.last = nowMs;
            if (SG !== null && nowMs - SNOWG.soundAt > 150) {
                SNOWG.soundAt = nowMs;
                snowGains(soundWanted());
            }
        } else SNOWG.last = 0;
        // the Halloween night (26k): the haunted lamps and the spooky sounds
        if (L.haunt !== null && L.flicker !== null) {
            if (HAUNT.next === 0) HAUNT.next = nowMs + 8000;
            if (nowMs >= HAUNT.next) {
                startFlicker(0.8 + 0.2 * Math.random());
                HAUNT.next = nowMs + L.haunt.every * 1000 * (0.6 + 0.8 * Math.random());
            }
        } else HAUNT.next = 0;
        spookyTick(nowMs);
        return {
            vp,
            cam: [pos.x, pos.y, pos.z],
            time,
            box,
            doorIn: (seasonOn ? 60 : 900) * door,
            doorOut: 350 * door,
            offset: ps.offset,
            // a seasonal outside (26k), drawn into the picture and depth in place of the game's sky and town
            outside: OS !== null && season !== null ? { asset: season.asset, bright: OS.bright } : null,
            // the floor blend near the door: the season's ground (26k), or else, without a seasonal outside, the road
            floorMix:
                OS !== null && season !== null && std !== null && OS.mix > 0
                    ? {
                          ground: season.ground,
                          std: std.std,
                          amount: OS.mix,
                          depth: OS.mixDepth,
                          bright: OS.bright,
                          tone: 0,
                          fade: 0,
                          inside: 1,
                          wall: box.wall,
                          outR: 45,
                          lim: [0, 0, -1],
                      }
                    : OS === null && std !== null && roadAmount > 0.01
                    ? {
                          ground: std.ground,
                          std: std.std,
                          amount: roadAmount,
                          depth: mixN('reach'),
                          bright: mixN('bright'),
                          tone: mixN('tone'),
                          fade: mixN('fade'),
                          inside: mixN('inside'),
                          wall: box.wall + mixN('line'),
                          outR: mixN('out'),
                          lim: [mixN('x0'), mixN('x1'), Math.max(1, mixN('feather'))],
                      }
                    : null,
            grade: graded ? { inn, hor, zen } : null,
            desun:
                ((L.night !== null && night > 0.01 && L.night.sunOff > 0) || L.cleanWall > 0) && nightAsset !== null
                    ? { asset: nightAsset, amount: Math.max(night * (L.night?.sunOff ?? 0), L.cleanWall) }
                    : null,
            lensOff: O !== null && O.lamps < 1 && lenses !== null ? { asset: lenses, amount: 1 - O.lamps } : null,
            sky: O !== null && O.sky > 0 && skyAsset !== null ? { asset: skyAsset } : null,
            // the bolt in the grey sky while the flash lasts (26g4)
            boltSky:
                Sm !== null && Sm.bolt > 0 && flash > 0.003 && skyAsset !== null && STORM.bolt !== null
                    ? { asset: skyAsset, pic: STORM.bolt, top: 0.2 }
                    : null,
            fixtures:
                L.night !== null && night > 0.01 && L.night.fixtures > 0 && std !== null
                    ? ((NL) => {
                          ensureFixtures(std);
                          return fixtures === null ? null : { asset: fixtures, alpha: Math.min(1, night * NL.fixtures), cones: night * NL.fixtures };
                      })(L.night)
                    : null,
            lamps:
                L.night !== null && night > 0.01 && std !== null && std.lamps.length > 0 && L.night.lamps > 0
                    ? { list: std.lamps, power: night * L.night.lamps * fk, reach: 420 * L.night.reach, glow: night * L.night.glow, color: fromHex(L.night.color) }
                    : null,
            nightx:
                night > 0.01 && (L.streetLamps !== null || L.search !== null || L.cones !== null || L.red !== null)
                    ? (() => {
                          const t = performance.now() / 1000;
                          const Lm = L.streetLamps;
                          const Rd = L.red;
                          const Sl = L.search;
                          const Cn = L.cones;
                          const at = (sOut: number, side: number, z: number): number[] => [box.o[0] * sOut + box.l[0] * side, box.o[1] * sOut + box.l[1] * side, z];
                          const blink = Rd !== null ? Math.pow(Math.max(0, Math.sin((t / Math.max(0.2, Rd.blink)) * Math.PI * 2)), 0.6) : 0;
                          return {
                              fog: Fg !== null ? Fg.density : 0,
                              fogStart: Fg !== null ? Fg.start : 0,
                              fogCol: Fg !== null ? lightOf(fromHex(Fg.color), 0.12) : [0, 0, 0],
                              lamps:
                                  Lm !== null
                                      ? {
                                            count: Math.max(0, Math.round(Lm.count)),
                                            start: box.wall + Lm.start,
                                            gap: Math.max(100, Lm.gap),
                                            left: Lm.left,
                                            right: Lm.right,
                                            height: Lm.height,
                                            size: 140 * Lm.size,
                                            halo: Lm.halo,
                                            bright: Lm.bright * night,
                                            color: fromHex(Lm.color),
                                            postCol: [0.05, 0.05, 0.06].map((x, i) => x * Math.max(0.3, outLight[i]) * 2),
                                        }
                                      : null,
                              red:
                                  Rd !== null
                                      ? {
                                            pos: [
                                                box.o[0] * (box.wall + Rd.dist) + box.l[0] * Rd.across,
                                                box.o[1] * (box.wall + Rd.dist) + box.l[1] * Rd.across,
                                                Rd.height,
                                            ],
                                            size: 220 * Rd.size,
                                            halo: Rd.halo,
                                            bright: Rd.bright * night * blink,
                                        }
                                      : null,
                              // the searchlight leans across the street (sideways), swinging toward and away from the hangar
                              search:
                                  Sl !== null
                                      ? (() => {
                                            const swing = ((Sl.swing * Math.PI) / 180) * Math.sin(t * Sl.speed * 0.6);
                                            const lean = (Sl.lean * Math.PI) / 180;
                                            const dirH = [
                                                box.l[0] * Math.cos(swing) - box.o[0] * Math.sin(swing),
                                                box.l[1] * Math.cos(swing) - box.o[1] * Math.sin(swing),
                                            ];
                                            return {
                                                amount: Sl.bright * night,
                                                width: Sl.width,
                                                origin: at(box.wall + Sl.dist, Sl.across, box.groundZ),
                                                dir: [dirH[0] * Math.sin(lean), dirH[1] * Math.sin(lean), Math.cos(lean)],
                                                color: fromHex(Sl.color),
                                            };
                                        })()
                                      : null,
                              cones:
                                  Cn !== null && std !== null && std.lamps.length > 0
                                      ? { amount: Cn.amount * night, lamps: std.lamps, angle: Cn.angle, reach: 420 * Cn.reach, dust: Cn.dust, color: fromHex(Cn.color) }
                                      : null,
                          };
                      })()
                    : null,
            // the clear night's extras: only with one of them, as the probe (the rainy night has none, so it draws no stars on the
            // painted sky behind the town); the stars on that painted sky sit under the overcast's cloud layer like the real sky's
            ncx:
                night > 0.01 && (L.windows !== null || L.shoot !== null || (L.pools !== null && L.streetLamps !== null) || L.flies !== null || L.moths !== null)
                    ? (() => {
                          const met = L.shoot === null ? null : meteorStep(performance.now(), box, [pos.x, pos.y, pos.z], L.shoot);
                          return {
                              hor,
                              zen,
                              stars: st.stars * s * STAR_BOOST * (O !== null ? Math.max(0, 1 - O.layer) : 1),
                              windows:
                                  L.windows !== null && L.windows.amount > 0
                                      ? { ...L.windows, amount: L.windows.amount * night }
                                      : null,
                              meteor: met === null ? null : { ...met, bright: met.bright * night },
                              flies:
                                  L.flies !== null && L.flies.count > 0
                                      ? {
                                            n: Math.round(L.flies.count),
                                            near: box.wall + 150,
                                            far: box.wall + L.flies.dist,
                                            span: [Math.max(box.u[0], -2200), Math.min(box.u[1], 2000)],
                                            height: L.flies.height,
                                            size: L.flies.size,
                                            speed: L.flies.speed,
                                            bright: L.flies.bright * night,
                                            color: fromHex(L.flies.color),
                                        }
                                      : null,
                              moths:
                                  L.moths !== null && L.moths.count > 0 && std !== null && std.lamps.length > 0
                                      ? {
                                            lamps: std.lamps,
                                            perLamp: Math.round(L.moths.count),
                                            size: L.moths.size,
                                            speed: L.moths.speed,
                                            alpha: night,
                                            color: fromHex(L.night?.color ?? '#ffffff').map((x) => x * 0.9),
                                        }
                                      : null,
                              pools:
                                  L.pools !== null && L.streetLamps !== null && L.streetLamps.count > 0 && L.pools.amount > 0
                                      ? {
                                            amount: L.pools.amount * night,
                                            r: 260 * L.pools.size,
                                            n: Math.min(24, Math.round(L.streetLamps.count) * 2),
                                            start: box.wall + L.streetLamps.start,
                                            gap: Math.max(100, L.streetLamps.gap),
                                            sides: [L.streetLamps.left, L.streetLamps.right],
                                            h: L.streetLamps.height,
                                            color: fromHex(L.streetLamps.color),
                                        }
                                      : null,
                          };
                      })()
                    : null,
            ndx:
                night < 0.99 && (L.clouds !== null || L.leaves !== null)
                    ? {
                          clouds:
                              L.clouds !== null
                                  ? {
                                        amount: L.clouds.amount * (1 - night),
                                        cover: L.clouds.cover,
                                        size: L.clouds.size,
                                        speed: L.clouds.speed,
                                        color: lightOf([1, 1, 1], 0.4),
                                        shade: lightOf([0.62, 0.68, 0.78], 0.4),
                                    }
                                  : null,
                          leaves:
                              L.leaves !== null && L.leaves.count > 0
                                  ? {
                                        ...leavesStep(performance.now(), box, L.leaves),
                                        size: L.leaves.size,
                                        ground: box.groundZ + 3,
                                        floor: (box.floorZ || 0) + 2,
                                        light: lightOf([1, 1, 1], 0.4),
                                        sun: sunDirection(hour, box, L.time.sunSide),
                                    }
                                  : null,
                      }
                    : null,
            atmos: atmosOn
                ? {
                      stars: st.stars * s * STAR_BOOST,
                      glow,
                      sunDir: sunDirection(hour, box, L.time.sunSide),
                      sunCol: st.sun,
                      fog: Fg !== null ? Fg.density : 0,
                      fogStart: Fg !== null ? Fg.start : 0,
                      fogHeight: Fg !== null ? Fg.height : 1,
                      fogMove: Fg !== null ? Fg.move : 0,
                      fogCol: Fg !== null ? lightOf(fromHex(Fg.color), 0.12) : [0, 0, 0],
                      cover: N !== null ? N.cover : 0,
                      spark: L.sparkle > 0 ? L.sparkle * (1 - night) : 0,
                      coverCol: lightOf([0.93, 0.95, 0.98], 0.18).map((x) => x * (N !== null ? N.coverBright : 1)),
                      coverThick: N !== null ? N.coverThick : 1,
                      groundZ: box.groundZ,
                      skyZ: box.skyZ,
                      // the lightning's flash (26g4), cold blue-white
                      flash,
                      bolt: Sm !== null ? Sm.bolt : 0,
                      flashCol: [0.78, 0.84, 1],
                      // the overcast's drifting cloud layer over the sky
                      cloud: O !== null ? O.layer : 0,
                      cloudK: O !== null ? O.contrast : 0,
                      cloudSpeed: O !== null ? O.speed : 0,
                      // the probe's cloud colour, also lit by the hour's sky colour (owner, 2026-11-21: the upper sky stayed grey on
                      // the rainy night, as in the probe; 1 at noon, so the rainy day is the probe's)
                      cloudCol:
                          O !== null
                              ? fromHex(O.tint).map((x, i) => x * Math.min(1.2, O.out + 0.15) * lerp(1, st.zen[i], s))
                              : [0.5, 0.5, 0.5],
                  }
                : null,
            // the wet floor by the door (26g5): its sky colour for mirrored rays that leave the screen, lit like the outside
            wet:
                L.wet !== null && L.wet.amount > 0
                    ? {
                          amount: L.wet.amount,
                          depth: L.wet.depth,
                          puddles: L.wet.puddles,
                          shine: L.wet.shine,
                          rings: R !== null ? L.wet.rings : 0,
                          floorZ: box.floorZ,
                          lim: [(L.drips?.left ?? -1000) - 60, (L.drips?.right ?? 780) + 60, Math.max(1, mixN('feather'))],
                          sky: (O !== null ? fromHex(O.tint) : [0.72, 0.8, 0.9]).map((x, i) => x * Math.max(0.15, outLight[i]) * 1.15),
                          flash,
                      }
                    : null,
            // the door drips (26g5): from the door's top edge, falling faster and faster, a ring where each lands; in the rain's colour
            drips:
                L.drips !== null && L.drips.count > 0 && R !== null
                    ? {
                          n: Math.round(L.drips.count),
                          top: L.drips.top,
                          at: box.wall + L.drips.out,
                          span: [L.drips.left, L.drips.right],
                          g: 980 * L.drips.speed * L.drips.speed,
                          width: L.drips.size,
                          bright: L.drips.bright,
                          splash: L.drips.splash,
                          wind: windNow,
                          ground: box.floorZ,
                          color: lightOf(fromHex(R.color), 0.3),
                      }
                    : null,
            // the rain (26g2): with gusts (26g3) more drops are drawn and only the first `dens` part of them shows (the rest fade in
            // at the top of a gust); without them every drop shows and the sideways travel is wind x time
            rain:
                R !== null
                    ? {
                          drops: Math.max(0, Math.round(R.drops * (K !== null ? 1 + K.heavier : 1))),
                          dens: K !== null ? (1 + K.heavier * gust) / (1 + K.heavier) : 1,
                          drift: K !== null ? GUST.drift : R.wind * time,
                          speed: R.speed,
                          length: R.length,
                          wind: windNow,
                          width: R.width,
                          bright: R.bright,
                          reachEnd: Math.min(box.far, box.wall + R.reach),
                          splash: R.splash,
                          color: lightOf(fromHex(R.color), 0.3),
                      }
                    : null,
            // the foggy day's extras (26h): floor fog, fog banks, the door's light beam (one pass after the fog); also on at night for
            // the searchlight and the lamps' cones, which it draws
            fogx:
                L.floorFog !== null || L.banks !== null || L.beam !== null || (night > 0.01 && (L.search !== null || L.cones !== null))
                    ? (() => {
                          const Fl = L.floorFog;
                          const Bk = L.banks;
                          const Bm = L.beam;
                          const fc = fromHex(Fg !== null ? Fg.color : '#c3cad3');
                          const dn = Bm !== null ? (Bm.down * Math.PI) / 180 : 0;
                          const sd = Bm !== null ? (Bm.side * Math.PI) / 180 : 0;
                          const o = box.o;
                          const l = box.l;
                          const beamDir = [
                              (-o[0] * Math.cos(sd) + l[0] * Math.sin(sd)) * Math.cos(dn),
                              (-o[1] * Math.cos(sd) + l[1] * Math.sin(sd)) * Math.cos(dn),
                              -Math.sin(dn),
                          ];
                          const day = 1 - night;
                          return {
                              floor: Fl !== null ? Fl.amount : 0,
                              floorH: Fl !== null ? Fl.height : 0,
                              floorDepth: Fl !== null ? Fl.depth : 0,
                              floorSpeed: Fl !== null ? Fl.speed : 0,
                              floorLumps: Fl !== null ? Fl.lumps : 0,
                              floorOut: Fl !== null ? Fl.out : 0,
                              floorIn: fc.map((x, i) => x * inn[i] * (Fl !== null ? Fl.bright : 1)),
                              floorOutCol: lightOf(fc, 0.12).map((x) => x * (Fl !== null ? Fl.bright : 1)),
                              banks: Bk !== null ? Bk.amount : 0,
                              bankSize: Math.max(50, Bk !== null ? Bk.size : 0),
                              bankSpeed: Bk !== null ? Bk.speed : 0,
                              bankGaps: Bk !== null ? Bk.gaps : 0,
                              bankHigh: Bk !== null ? Bk.high : 0,
                              bankStart: Bk !== null ? Bk.start : 0,
                              bankCol: lightOf(fc, 0.12),
                              far: Math.min(box.far, box.wall + 9000),
                              beam: Bm !== null && day > 0.01 ? Bm.amount : 0,
                              pool: Bm !== null && day > 0.01 ? Bm.pool : 0,
                              dust: Bm !== null ? Bm.dust : 0,
                              soft: Math.max(1, Bm !== null ? Bm.soft : 0),
                              beamCol: fromHex(Bm !== null ? Bm.color : '#fff1d6').map((x, i) => x * day * Math.min(1.3, outLight[i])),
                              beamDir,
                              door: Bm !== null ? [Bm.left, Bm.right, Bm.top] : [0, 0, 0],
                          };
                      })()
                    : null,
            // the Christmas night's extras (26l): the tree with its bulbs, star and glow, the gifts, the Christmas lights
            xm:
                L.tree !== null || L.xmasLights !== null || L.gifts !== null
                    ? (() => {
                          const o = box.o;
                          const l = box.l;
                          const off = ps.offset;
                          const at = (sOut: number, side: number, z: number): number[] => [o[0] * sOut + l[0] * side, o[1] * sOut + l[1] * side, z];
                          const hash = (i: number): number => {
                              const x = Math.sin(i * 12.9898) * 43758.5453;
                              return x - Math.floor(x);
                          };
                          const T = L.tree;
                          const TR = treeSet;
                          const out: { -readonly [K in keyof NonNullable<KaspLobbyPassFrame['xm']>]: NonNullable<KaspLobbyPassFrame['xm']>[K] } = {
                              tree: null,
                              treeBulbs: null,
                              star: null,
                              pool: null,
                              gifts: null,
                              lights: null,
                          };
                          // the tree: one of the Christmas hangar's two trees, moved to (x, y), turned and sized; its bulbs on a spiral round it
                          if (T !== null && TR !== null) {
                              const k = T.kind > 0.5 ? 'pine' : 'pineBig';
                              const bd = TR.bounds[k];
                              const ang = (T.turn * Math.PI) / 180;
                              const cs = Math.cos(ang);
                              const sn = Math.sin(ang);
                              const sz = T.size;
                              const cx = (bd.lo[0] + bd.hi[0]) / 2;
                              const cy = (bd.lo[1] + bd.hi[1]) / 2;
                              out.tree = {
                                  asset: {
                                      ...TR[k],
                                      xr: [cs, sn, -sn, cs],
                                      xs: sz,
                                      xt: [T.x - (cs * cx - sn * cy) * sz, T.y - (sn * cx + cs * cy) * sz, -bd.lo[2] * sz],
                                  },
                              };
                              const Ht = (bd.hi[2] - bd.lo[2]) * sz;
                              const R = (Math.max(bd.hi[0] - bd.lo[0], bd.hi[1] - bd.lo[1]) / 2) * sz * 0.85;
                              const n = Math.min(96, Math.round(T.count));
                              const pts = new Float32Array(96 * 4);
                              for (let i = 0; i < n; i++) {
                                  const h = 0.06 + 0.84 * (i / Math.max(1, n - 1));
                                  const a2 = h * Math.PI * 2 * 6 + i * 0.7;
                                  const r = R * (1 - h) * 0.92;
                                  pts.set([T.x + Math.cos(a2) * r + off[0], T.y + Math.sin(a2) * r + off[1], h * Ht + off[2], (i % 4) + hash(i) * 0.999], i * 4);
                              }
                              out.treeBulbs = { pts, n, bright: T.lights * night, blink: T.blink };
                              if (T.star > 0) {
                                  const sp = new Float32Array(96 * 4);
                                  sp.set([T.x + off[0], T.y + off[1], Ht + 18 * sz + off[2], 0.3], 0);
                                  out.star = { pts: sp, n: 1, bright: T.star * night, blink: 0 };
                              }
                              if (T.pool > 0) {
                                  const pp = new Float32Array(128);
                                  pp.set([T.x + off[0], T.y + off[1], Ht * 0.3 + off[2], 0.85 + 0.15 * Math.sin(nowMs / 130)], 0);
                                  out.pool = { pts: pp, r: R * 1.6, amount: T.pool * night, dim: Math.max(0.06, (inn[0] + inn[1] + inn[2]) / 3) };
                              }
                              // the gifts round the tree's foot, on the side that faces the camera
                              const Gf = L.gifts;
                              if (Gf !== null && Gf.count > 0) {
                                  const g = new Float32Array(12 * 4);
                                  const gs = new Float32Array(12 * 4);
                                  const n2 = Math.min(12, Math.round(Gf.count));
                                  const toCam = Math.atan2(pos.y - T.y, pos.x - T.x);
                                  for (let i = 0; i < n2; i++) {
                                      const a3 = toCam + (i / Math.max(1, n2 - 1) - 0.5) * 2.2 + (hash(i + 40) - 0.5) * 0.3;
                                      const rr = R * (0.55 + 0.35 * hash(i + 7));
                                      const w = (45 + 40 * hash(i + 3)) * Gf.size;
                                      const d = (45 + 40 * hash(i + 5)) * Gf.size;
                                      const ht = (35 + 45 * hash(i + 9)) * Gf.size;
                                      g.set([T.x + Math.cos(a3) * rr + off[0], T.y + Math.sin(a3) * rr + off[1], off[2], hash(i + 11) * 3], i * 4);
                                      gs.set([w, d, ht, i % 5], i * 4);
                                  }
                                  out.gifts = { g, s: gs, n: n2 };
                              }
                          }
                          // Christmas lights: strings over the door and along the side wall, red, green, gold and white by turns
                          const Lt = L.xmasLights;
                          if (Lt !== null && night > 0.01) {
                              const pts: number[][] = [];
                              const string = (A: number[], B: number[], sag: number): void => {
                                  const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
                                  const n = Math.max(2, Math.floor(len / Math.max(30, Lt.gap)));
                                  for (let i = 0; i <= n && pts.length < 96; i++) {
                                      const q = i / n;
                                      const hook = ((q * len) / 450) % 1;
                                      pts.push([
                                          A[0] + (B[0] - A[0]) * q,
                                          A[1] + (B[1] - A[1]) * q,
                                          A[2] + (B[2] - A[2]) * q - sag * 4 * hook * (1 - hook),
                                          (pts.length % 4) + hash(pts.length + 50) * 0.999,
                                      ]);
                                  }
                              };
                              if (Lt.door > 0.5) string(at(box.wall - 130, -1000, Lt.doorZ), at(box.wall - 130, 780, Lt.doorZ), Lt.sag);
                              if (Lt.wall > 0.5) {
                                  const Rm = box.room;
                                  const latMin = Math.min(
                                      ...[
                                          [Rm.minX, Rm.minY],
                                          [Rm.minX, Rm.maxY],
                                          [Rm.maxX, Rm.minY],
                                          [Rm.maxX, Rm.maxY],
                                      ].map((c) => c[0] * l[0] + c[1] * l[1]),
                                  );
                                  string(at(box.wall - 60, latMin + 60, Lt.wallZ), at(box.wall - 2600, latMin + 60, Lt.wallZ), Lt.sag);
                              }
                              const arr = new Float32Array(96 * 4);
                              pts.forEach((q, i) => arr.set([q[0] + off[0], q[1] + off[1], q[2] + off[2], q[3]], i * 4));
                              out.lights = { pts: arr, n: pts.length, bright: Lt.bright * night, blink: Lt.blink };
                          }
                          return out;
                      })()
                    : null,
            // the Halloween night's extras (26k): pumpkins, string lights, webs, wisps, bats
            hw:
                L.pumpkins !== null || L.wisps !== null || L.bats !== null || L.stringLights !== null || L.webs !== null
                    ? (() => {
                          const t = nowMs / 1000;
                          const o = box.o;
                          const l = box.l;
                          const off = ps.offset;
                          const at = (sOut: number, side: number, z: number): number[] => [o[0] * sOut + l[0] * side, o[1] * sOut + l[1] * side, z];
                          const Pk = L.pumpkins;
                          const pk = Pk !== null ? pumpkinSet : null;
                          let pumpkins: NonNullable<KaspLobbyPassFrame['hw']>['pumpkins'] = null;
                          if (Pk !== null && pk !== null) {
                              const n = Math.min(32, pk.candles.length);
                              const candles = new Float32Array(32 * 4);
                              const glowPts = new Float32Array(96 * 4);
                              for (let i = 0; i < n; i++) {
                                  const c = pk.candles[i];
                                  const ph = (i * 0.6180339) % 1;
                                  const k = 1 - Pk.flicker * 0.35 * (0.5 - 0.5 * Math.sin(t * 11 + ph * 18.8) * Math.sin(t * 7.3 + ph * 6.28));
                                  candles.set([c[0] + off[0], c[1] + off[1], c[2] + off[2], k], i * 4);
                                  glowPts.set([c[0] + off[0], c[1] + off[1], c[2] + off[2], ph], i * 4);
                              }
                              pumpkins = {
                                  asset: pk.asset,
                                  n,
                                  candles,
                                  glowPts,
                                  glow: Pk.glow * night,
                                  faces: 1 - Pk.flicker * 0.3 * (0.5 - 0.5 * Math.sin(t * 9.1)),
                                  pool: Pk.pool * night,
                                  dim: Math.max(0.06, (inn[0] + inn[1] + inn[2]) / 3),
                              };
                          }
                          const Wp = L.wisps;
                          const Bt = L.bats;
                          const Lt = L.stringLights;
                          const Wb = L.webs;
                          let lights: NonNullable<KaspLobbyPassFrame['hw']>['lights'] = null;
                          if (Lt !== null && night > 0.01) {
                              const pts: number[][] = [];
                              const hash = (i: number): number => {
                                  const x = Math.sin(i * 12.9898) * 43758.5453;
                                  return x - Math.floor(x);
                              };
                              const string = (A: number[], B: number[], sag: number): void => {
                                  const len = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
                                  const n = Math.max(2, Math.floor(len / Math.max(30, Lt.gap)));
                                  for (let i = 0; i <= n && pts.length < 96; i++) {
                                      const q = i / n;
                                      const hook = ((q * len) / 450) % 1;
                                      pts.push([
                                          A[0] + (B[0] - A[0]) * q,
                                          A[1] + (B[1] - A[1]) * q,
                                          A[2] + (B[2] - A[2]) * q - sag * 4 * hook * (1 - hook),
                                          (pts.length % 2) + hash(pts.length) * 0.999,
                                      ]);
                                  }
                              };
                              if (Lt.door > 0.5) string(at(box.wall - 130, -1000, Lt.doorZ), at(box.wall - 130, 780, Lt.doorZ), Lt.sag);
                              if (Lt.wall > 0.5) {
                                  const Rm = box.room;
                                  const latMin = Math.min(
                                      ...[
                                          [Rm.minX, Rm.minY],
                                          [Rm.minX, Rm.maxY],
                                          [Rm.maxX, Rm.minY],
                                          [Rm.maxX, Rm.maxY],
                                      ].map((c) => c[0] * l[0] + c[1] * l[1]),
                                  );
                                  string(at(box.wall - 60, latMin + 60, Lt.wallZ), at(box.wall - 2600, latMin + 60, Lt.wallZ), Lt.sag);
                              }
                              const arr = new Float32Array(96 * 4);
                              pts.forEach((q, i) => arr.set([q[0] + off[0], q[1] + off[1], q[2] + off[2], q[3]], i * 4));
                              lights = { pts: arr, n: pts.length, bright: Lt.bright * night, blink: Lt.blink };
                          }
                          let webs: NonNullable<KaspLobbyPassFrame['hw']>['webs'] = null;
                          if (Wb !== null && Wb.amount > 0) {
                              const w = new Float32Array(8 * 4);
                              const c1 = at(box.wall - 20, Wb.left, Wb.top);
                              const c2 = at(box.wall - 20, Wb.right, Wb.top);
                              w.set([c1[0] + off[0], c1[1] + off[1], c1[2] + off[2], 1], 0);
                              w.set([c2[0] + off[0], c2[1] + off[1], c2[2] + off[2], -1], 4);
                              webs = { w, n: 2, size: Wb.size, amount: Wb.amount, col: [0.78, 0.8, 0.84].map((x, i) => x * Math.max(0.3, inn[i] * 1.2)) };
                          }
                          return {
                              pumpkins,
                              lights,
                              webs,
                              wisps:
                                  Wp !== null && Wp.count > 0 && night > 0.01
                                      ? {
                                            n: Math.round(Wp.count),
                                            near: box.wall + Wp.near,
                                            far: box.wall + Wp.far,
                                            span: [Math.max(box.u[0], -2500), Math.min(box.u[1], 2200)],
                                            height: Wp.height,
                                            size: Wp.size,
                                            speed: Wp.speed,
                                            bright: Wp.bright * night,
                                            color: fromHex(Wp.color),
                                        }
                                      : null,
                              bats:
                                  Bt !== null && Bt.count > 0
                                      ? {
                                            n: Math.round(Bt.count),
                                            near: box.wall + Bt.dist * 0.7,
                                            far: box.wall + Bt.dist * 1.5,
                                            low: Bt.height * 0.75,
                                            high: Bt.height * 1.25,
                                            size: Bt.size,
                                            speed: Bt.speed,
                                            haze: [0.1, 0.1, 0.14].map((x, i) => x + 0.25 * Math.max(0, outLight[i])),
                                            one: batStep(nowMs, box, off),
                                        }
                                      : null,
                          };
                      })()
                    : null,
            // the snow (26j): outside, with the flakes near the street lamps lit by them at night, and blown into the hangar
            snow:
                N !== null
                    ? {
                          flakes: Math.max(0, Math.round(N.flakes)),
                          speed: N.speed,
                          size: N.size,
                          wind: N.wind,
                          drift: SNOWG.drift,
                          glow:
                              L.snowGlow !== null && L.streetLamps !== null && L.streetLamps.count > 0 && nightAmount() > 0.01
                                  ? {
                                        n: Math.min(24, Math.round(L.streetLamps.count) * 2),
                                        start: box.wall + L.streetLamps.start,
                                        gap: Math.max(100, L.streetLamps.gap),
                                        sides: [L.streetLamps.left, L.streetLamps.right],
                                        z: box.groundZ + L.streetLamps.height,
                                        r: 260 * L.snowGlow.reach,
                                        amount: L.snowGlow.amount * nightAmount(),
                                        color: fromHex(L.streetLamps.color).map((x) => x * 0.9),
                                    }
                                  : null,
                          gust: SG !== null ? SNOWG.level * SG.strength : 0,
                          sway: N.sway,
                          bright: N.bright,
                          reach: N.reach,
                          color: lightOf([0.96, 0.97, 1], 0.3),
                      }
                    : null,
            snowIn:
                N !== null && N.inside > 0
                    ? {
                          n: Math.round(N.inside),
                          speed: N.speed,
                          size: N.size,
                          wind: N.wind,
                          sway: N.sway,
                          bright: N.bright,
                          color: [0.96, 0.97, 1].map((x, i) => x * inn[i]),
                      }
                    : null,
            // the snowy day's extras (26j): the icicles on the door's top edge, the snow drift on the floor inside the door
            swx:
                L.icicles !== null || L.snowDrift !== null
                    ? (() => {
                          const Ic = L.icicles;
                          const Dr = L.snowDrift;
                          return {
                              ice:
                                  Ic !== null && Ic.count > 0
                                      ? {
                                            n: Math.round(Ic.count),
                                            top: Ic.top,
                                            at: box.wall + Ic.out,
                                            span: [Ic.left, Ic.right],
                                            len: Ic.length,
                                            width: Ic.width,
                                            glint: Ic.glint,
                                            color: lightOf([0.5, 0.74, 1], 0.4),
                                        }
                                      : null,
                              drift:
                                  Dr !== null && Dr.amount > 0
                                      ? {
                                            amount: Dr.amount,
                                            depth: Dr.depth,
                                            lim: [Dr.left - 60, Dr.right + 60, 150],
                                            floorZ: box.floorZ,
                                            spark: Dr.sparkle,
                                            gust: SG !== null ? SNOWG.level * Math.min(1.5, SG.strength) : 0,
                                            color: [0.95, 0.97, 1].map((x, i) => x * inn[i] * 1.1),
                                        }
                                      : null,
                          };
                      })()
                    : null,
            // the very sunny day's extras (26i), only by day: the heat shimmer and the birds (in the fog's colour when there is fog)
            sunx:
                night < 0.99 && (L.shimmer !== null || L.birds !== null)
                    ? (() => {
                          const day = 1 - night;
                          const Sh = L.shimmer;
                          const Bd = L.birds;
                          return {
                              shimmer: Sh !== null ? { amount: Sh.amount * day, height: Sh.height, speed: Sh.speed } : null,
                              birds:
                                  Bd !== null && Bd.count > 0
                                      ? {
                                            n: Math.round(Bd.count),
                                            near: box.wall + Bd.dist * 0.7,
                                            far: box.wall + Bd.dist * 1.5,
                                            low: Bd.height * 0.75,
                                            high: Bd.height * 1.25,
                                            size: Bd.size,
                                            speed: Bd.speed,
                                            haze: (Fg !== null ? fromHex(Fg.color) : [0.75, 0.82, 0.92]).map((x, i) => x * Math.max(0.3, outLight[i])),
                                        }
                                      : null,
                          };
                      })()
                    : null,
            // the dust floating in the hangar's light (26h, the hot sun's motes)
            motes: H !== null ? { n: Math.max(0, Math.round(H.motes)), bright: 1, color: [1, 0.86, 0.6].map((x, i) => x * inn[i]) } : null,
        };
    }

    // Right after the game's own picture: our pass, for the lobby world's camera only, in a tick where the lobby frame came through.
    function afterPicture(camera: unknown): void {
        const n = names;
        const s = scene;
        const ps = passScene;
        const api = window.__kaspLobbyPass;
        if (n === null || n.pass === undefined || s === null || ps === null || api === undefined || passBroken || broken) return;
        if (performance.now() - lobbyTickAt > LOBBY_TICK_MS) return;
        const p = n.pass;
        try {
            const world = invoke(s.system, n.world, []);
            if (!isBag(world) || camera !== world[p.worldCamera] || !isBag(camera)) return;
            const gl = bag(s.renderer, p.glHolder)[p.glContext];
            if (!(gl instanceof WebGL2RenderingContext)) throw new Error(p.glContext);
            const vp = camera[p.viewProjection];
            if (!(vp instanceof Float32Array) || vp.length !== 16) throw new Error(p.viewProjection);
            const pos = readVector(bag(camera, p.position), n);
            if (gpu === null || gpuGl !== gl) {
                gpu?.dispose();
                gpu = api.make(gl);
                gpuGl = gl;
            }
            gpu.draw(buildFrame(vp, pos, ps));
            passFrames++;
        } catch {
            stopPass();
        }
    }

    // ---- the drone's flight (26c), ported from the probe's flight (v1.87), at its default numbers ----
    // The flight is a smooth curve, like an FPV drone: a "carrot" runs along a Hermite curve through the waypoints at a speed that
    // rises and falls gently (slower into sharp corners and tight bends, braking in time to stop where it must), and the drone
    // follows the carrot like a critically damped spring. Its heading eases after the curve's direction with a limited turn rate
    // and turn acceleration; it leans into the curve. Waypoints are relative to the camera; every 20 s or so a greeting comes to
    // one of three screen spots in turn, where the drone turns and tilts its nose up to the player's eye. Each lobby frame (26a's
    // frame) writes the hangar's drone place; the drone system copies it in its own update, and its end-of-update call (drone)
    // writes the turn, the lean and the tilt, after the game's own, and keeps the player from grabbing the drone.
    const FLIGHT = {
        speed: 1.2,
        size: 1,
        greet: 20,
        turn: 180,
        bank: 1.6,
        facing: 0,
        ceiling: 400,
        smooth: 0.35,
        spots: [
            [0.15, 0.24],
            [0.3, 0.76],
            [0.76, 0.28],
        ],
        helloDist: 360,
        droneSize: 50,
        lookUp: 1,
    } as const;
    // A drone of another place (the garage's) is not the lobby's: the live one stays this close to the place we write.
    const DRONE_NEAR = 120;

    interface Vec {
        x: number;
        y: number;
        z: number;
    }
    type Look = 'scan' | 'tank' | 'camera';
    interface PointCommon {
        readonly dwell: number;
        readonly look?: Look;
        readonly speed?: number;
    }
    // r = to the right of the screen, d = toward the camera, h = above the tank base.
    interface TourPoint extends PointCommon {
        readonly kind: 'tour';
        readonly r: number;
        readonly d: number;
        readonly h: number;
    }
    // A point of the screen (0..1 across, 0..1 down) at the distance fwd in front of the camera.
    interface ScreenPoint extends PointCommon {
        readonly kind: 'screen';
        readonly sx: number;
        readonly sy: number;
        readonly fwd: number;
    }
    interface WorldPoint extends PointCommon {
        readonly kind: 'world';
        readonly x: number;
        readonly y: number;
        readonly z: number;
        readonly detour: true;
    }
    type Waypoint = TourPoint | ScreenPoint | WorldPoint;
    type PathPoint = { readonly fixed: Vec } | { readonly wp: Waypoint };

    const TOUR: readonly TourPoint[] = [
        { kind: 'tour', r: 520, d: 120, h: 330, dwell: 0.3 },
        { kind: 'tour', r: 380, d: -300, h: 360, dwell: 0.3 },
        { kind: 'tour', r: -120, d: -420, h: 320, dwell: 0.9, look: 'scan' },
        { kind: 'tour', r: -520, d: 60, h: 300, dwell: 0.3 },
        { kind: 'tour', r: -280, d: 300, h: 260, dwell: 0.5 },
        { kind: 'tour', r: 40, d: 60, h: 390, dwell: 1.6, look: 'tank' },
        { kind: 'tour', r: 340, d: 340, h: 240, dwell: 0.4 },
    ];

    interface Flight {
        state: 'fly' | 'hover';
        pos: Vec;
        vel: Vec;
        yaw: number;
        yawRate: number;
        roll: number;
        pitch: number;
        queue: Waypoint[];
        hoverStart: number;
        dwell: number;
        scanBase: number;
        greetTimer: number;
        lastTour: number;
        lastSpot: number;
        helloSpot: number;
        u: number;
        vCarrot: number;
        prevPt: PathPoint;
        prevPrevPt: PathPoint;
        startDir: Vec | null;
        pendingAdvance: boolean;
        carrot: Vec | null;
        carrotDir: Vec | null;
        off: Vec;
    }

    const wrapAngle = (a: number): number => {
        let v = a;
        while (v > Math.PI) v -= 2 * Math.PI;
        while (v < -Math.PI) v += 2 * Math.PI;
        return v;
    };
    // The drone's front is +y at turn 0.
    const headingOf = (dx: number, dy: number): number => Math.atan2(-dx, dy);
    const sub3 = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
    const norm3 = (v: Vec): Vec => {
        const l = Math.hypot(v.x, v.y, v.z) || 1;
        return { x: v.x / l, y: v.y / l, z: v.z / l };
    };
    const scale3 = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k, z: v.z * k });
    const dot3 = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z;
    // Itself well inside [lo, hi]; within k of a limit squeezed smoothly toward it, never reaching it: no kink in the path.
    const softClamp = (v: number, lo: number, hi: number, k: number): number =>
        v < lo + k ? lo + k - k * Math.tanh((lo + k - v) / k) : v > hi - k ? hi - k + k * Math.tanh((v - (hi - k)) / k) : v;

    let flight: Flight | null = null;
    let droneBroken = false;
    let droneFrames = 0;
    // The last drone system seen, and each one's own turn and lean before ours.
    let lastDrone: Bag | null = null;
    const droneTurns = new WeakMap<object, KaspLobbyVector>();

    const lens = (s: Scene, n: KaspLobbyNames): number => num(bag(s.system, n.cameraComponent), n.fov);
    const aspect = (): number => window.innerWidth / Math.max(1, window.innerHeight);
    // Where the player's eye really is: the camera point we write plus the game's own breathing.
    function eye(s: Scene, n: KaspLobbyNames): Vec {
        const c = readVector(bag(s.system, n.cam), n);
        const w = readVector(bag(s.system, n.wobble), n);
        return { x: c.x + w.x, y: c.y + w.y, z: c.z + w.z };
    }

    function waypointWorld(s: Scene, n: KaspLobbyNames, w: Waypoint): Vec {
        const B = s.record.base;
        if (w.kind === 'world') return { x: w.x, y: w.y, z: Math.min(w.z, B.z + FLIGHT.ceiling - 20) };
        if (w.kind === 'screen') {
            const c = s.want.c;
            const t = s.want.t;
            let fx = t.x - c.x;
            let fy = t.y - c.y;
            let fz = t.z - c.z;
            const fl = Math.hypot(fx, fy, fz) || 1;
            fx /= fl;
            fy /= fl;
            fz /= fl;
            const rx = s.want.rightX;
            const ry = s.want.rightY;
            const ux = ry * fz;
            const uy = -rx * fz;
            const uz = rx * fy - ry * fx;
            const th = Math.tan(lens(s, n) / 2);
            const rr = (2 * w.sx - 1) * w.fwd * th * aspect();
            const uu = (1 - 2 * w.sy) * w.fwd * th;
            const zRaw = c.z + fz * w.fwd + uz * uu;
            return {
                x: c.x + fx * w.fwd + rx * rr + ux * uu,
                y: c.y + fy * w.fwd + ry * rr + uy * uu,
                z: Math.max(B.z + 70, Math.min(zRaw, B.z + FLIGHT.ceiling - 20)),
            };
        }
        let ax = s.want.c.x - B.x;
        let ay = s.want.c.y - B.y;
        const al = Math.hypot(ax, ay) || 1;
        ax /= al;
        ay /= al;
        const sc = FLIGHT.size;
        return {
            x: B.x + (s.want.rightX * w.r + ax * w.d) * sc,
            y: B.y + (s.want.rightY * w.r + ay * w.d) * sc,
            z: B.z + Math.min(w.h, FLIGHT.ceiling - 20),
        };
    }
    const ptWorld = (s: Scene, n: KaspLobbyNames, pt: PathPoint): Vec => ('fixed' in pt ? pt.fixed : waypointWorld(s, n, pt.wp));

    // Keeps a point inside what the camera sees: not closer than 260 units, and not nearer an edge of the screen than the drone's own
    // size plus 5 %, the camera as the player sees it (our point plus the game's breathing, looking at the look-at point).
    function keepInView(s: Scene, n: KaspLobbyNames, p: Vec): Vec {
        const c = eye(s, n);
        const t = readVector(bag(s.system, n.target), n);
        let fx = t.x - c.x;
        let fy = t.y - c.y;
        let fz = t.z - c.z;
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl;
        fy /= fl;
        fz /= fl;
        const flat = Math.hypot(t.x - c.x, t.y - c.y) || 1;
        const rx = (t.y - c.y) / flat;
        const ry = -(t.x - c.x) / flat;
        const ux = ry * fz;
        const uy = -rx * fz;
        const uz = rx * fy - ry * fx;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dz = p.z - c.z;
        const depth = softClamp(dx * fx + dy * fy + dz * fz, 260, 1e6, 140);
        const xr = dx * rx + dy * ry;
        const yu = dx * ux + dy * uy + dz * uz;
        const th = Math.tan(lens(s, n) / 2);
        const asp = aspect();
        const hy = Math.min(0.4, FLIGHT.droneSize / (depth * th) / 2);
        const hx = Math.min(0.4, hy / asp);
        const mx = 0.05 + hx;
        const my = 0.05 + hy;
        const sx = softClamp(0.5 + xr / (depth * th * asp) / 2, mx, 1 - mx, 0.1);
        const sy = softClamp(0.5 - yu / (depth * th) / 2, my, 1 - my, 0.1);
        const rr = (2 * sx - 1) * depth * th * asp;
        const uu = (1 - 2 * sy) * depth * th;
        return { x: c.x + fx * depth + rx * rr + ux * uu, y: c.y + fy * depth + ry * rr + uy * uu, z: c.z + fz * depth + uz * uu };
    }

    // The director keeps at least three waypoints ahead, a few tour points in a random order, never the same one twice in a row.
    function refill(f: Flight): void {
        while (f.queue.length < 3) {
            const pool = TOUR.map((_, i) => i).filter((i) => i !== f.lastTour);
            const count = 3 + Math.floor(Math.random() * 2);
            for (let k = 0; k < count && pool.length > 0; k++) {
                const i = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
                f.queue.push(TOUR[i]);
                f.lastTour = i;
            }
        }
    }

    // A leg whose straight line would pass through the tank (close to its axis and low) gets a waypoint that goes round it.
    function maybeDetour(s: Scene, n: KaspLobbyNames, f: Flight): void {
        const w0 = f.queue[0];
        if (w0 === undefined || (w0.kind === 'world' && w0.detour)) return;
        const a = ptWorld(s, n, f.prevPt);
        const b = waypointWorld(s, n, w0);
        const B = s.record.base;
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const l2 = abx * abx + aby * aby || 1;
        const tt = Math.max(0, Math.min(1, ((B.x - a.x) * abx + (B.y - a.y) * aby) / l2));
        const cx = a.x + abx * tt;
        const cy = a.y + aby * tt;
        const cz = a.z + (b.z - a.z) * tt;
        const dx = cx - B.x;
        const dy = cy - B.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 340 && cz < B.z + 400) {
            let ox: number;
            let oy: number;
            if (dist > 20) {
                ox = dx / dist;
                oy = dy / dist;
            } else {
                const l = Math.hypot(abx, aby) || 1;
                ox = -aby / l;
                oy = abx / l;
            }
            f.queue.unshift({ kind: 'world', x: B.x + ox * 440, y: B.y + oy * 440, z: Math.max(cz, B.z + 300), dwell: 0, detour: true });
        }
    }

    // The greeting: out in front of the camera, then close to the screen, looking at the player; spots 1, 2, 3 in strict turn.
    function greetPath(f: Flight): Waypoint[] {
        const i = (f.lastSpot + 1) % FLIGHT.spots.length;
        f.lastSpot = i;
        f.helloSpot = i + 1;
        const [sx, sy] = FLIGHT.spots[i];
        return [
            { kind: 'screen', sx, sy, fwd: FLIGHT.helloDist * 2, dwell: 0 },
            { kind: 'screen', sx, sy, fwd: FLIGHT.helloDist, dwell: 3.2, look: 'camera', speed: 0.7 },
        ];
    }

    function startFlight(s: Scene, n: KaspLobbyNames, home: KaspLobbyVector): Flight {
        const turn = lastDrone === null ? undefined : droneTurns.get(lastDrone);
        const pos = { x: home.x, y: home.y, z: home.z };
        const f: Flight = {
            state: 'fly',
            pos,
            vel: { x: 0, y: 0, z: 0 },
            yaw: turn === undefined ? 0 : turn.z,
            yawRate: 0,
            roll: 0,
            pitch: 0,
            queue: [],
            hoverStart: 0,
            dwell: 0,
            scanBase: 0,
            greetTimer: Math.min(8, FLIGHT.greet),
            lastTour: -1,
            lastSpot: -1,
            helloSpot: 0,
            u: 0,
            vCarrot: 0,
            prevPt: { fixed: { ...pos } },
            prevPrevPt: { fixed: { ...pos } },
            startDir: null,
            pendingAdvance: false,
            carrot: null,
            carrotDir: null,
            off: { x: 0, y: 0, z: 0 },
        };
        refill(f);
        maybeDetour(s, n, f);
        return f;
    }

    // The waypoint just reached becomes the start of the next leg; a greeting jumps the queue when it is due.
    function advance(s: Scene, n: KaspLobbyNames, f: Flight): void {
        const arrivedDir = f.carrotDir === null ? null : { ...f.carrotDir };
        f.prevPrevPt = f.prevPt;
        const reached = f.queue.shift();
        if (reached !== undefined) f.prevPt = { wp: reached };
        if (FLIGHT.greet > 0 && f.greetTimer <= 0) {
            f.queue = greetPath(f);
            f.greetTimer = FLIGHT.greet * (0.8 + Math.random() * 0.4);
        }
        refill(f);
        maybeDetour(s, n, f);
        f.u = 0;
        // The old direction carries through (a smooth join), unless the path turns back on itself: then the leg starts straight.
        f.startDir = null;
        if (arrivedDir !== null) {
            const chordDir = norm3(sub3(waypointWorld(s, n, f.queue[0]), ptWorld(s, n, f.prevPt)));
            if (dot3(arrivedDir, chordDir) > -0.2) f.startDir = arrivedDir;
        }
    }

    function hermite(u: number, P1: Vec, P2: Vec, m1: Vec, m2: Vec): { readonly p: Vec; readonly d: Vec; readonly dd: Vec } {
        const u2 = u * u;
        const u3 = u2 * u;
        const mix = (a: number, b: number, c: number, d: number): Vec => ({
            x: a * P1.x + b * m1.x + c * P2.x + d * m2.x,
            y: a * P1.y + b * m1.y + c * P2.y + d * m2.y,
            z: a * P1.z + b * m1.z + c * P2.z + d * m2.z,
        });
        return {
            p: mix(2 * u3 - 3 * u2 + 1, u3 - 2 * u2 + u, -2 * u3 + 3 * u2, u3 - u2),
            d: mix(6 * u2 - 6 * u, 3 * u2 - 4 * u + 1, -6 * u2 + 6 * u, 3 * u2 - 2 * u),
            dd: mix(12 * u - 6, 6 * u - 4, -12 * u + 6, 6 * u - 2),
        };
    }

    // One step of the flight; writes the hangar's drone place.
    function flightStep(s: Scene, n: KaspLobbyNames, d: KaspLobbyDroneNames, f: Flight, now: number, dt: number): void {
        const B = s.record.base;
        f.greetTimer -= dt;
        if (f.pendingAdvance) {
            f.pendingAdvance = false;
            advance(s, n, f);
        }
        const vc = 380 * FLIGHT.speed;
        const aAcc = 420 * FLIGHT.speed;
        const aDec = 520 * FLIGHT.speed;
        const maxYaw = FLIGHT.turn * DEG;
        const tau = Math.max(0.15, FLIGHT.smooth);
        const cur = f.queue[0];
        const nxt: Waypoint | undefined = f.queue[1];
        let nearTank = 0;
        if (f.carrot !== null) {
            const br = Math.hypot(f.carrot.x - B.x, f.carrot.y - B.y);
            const zf = Math.max(0, Math.min(1, (Math.min(B.z + 380, B.z + FLIGHT.ceiling - 60) - f.carrot.z) / 60));
            if (br < 360) nearTank = ((360 - br) / 360) * zf;
        }
        const P1 = ptWorld(s, n, f.prevPt);
        const P0 = ptWorld(s, n, f.prevPrevPt);
        const P2 = waypointWorld(s, n, cur);
        const P3 = nxt === undefined ? { x: 2 * P2.x - P1.x, y: 2 * P2.y - P1.y, z: 2 * P2.z - P1.z } : waypointWorld(s, n, nxt);
        const chord = sub3(P2, P1);
        const segLen = Math.max(30, Math.hypot(chord.x, chord.y, chord.z));
        const stop = cur.dwell > 0 || nxt === undefined;
        // The curve's directions: continuous through the waypoints it passes, straight into one it stops at; a zero direction
        // (the path comes back to where it started) falls back to the chord.
        const chordDir = norm3(chord);
        const safeDir = (v: Vec): Vec => {
            const l = Math.hypot(v.x, v.y, v.z);
            return l > 1 ? { x: v.x / l, y: v.y / l, z: v.z / l } : chordDir;
        };
        const m1 = scale3(f.startDir ?? safeDir(sub3(P2, P0)), segLen * 0.55);
        const m2 = stop ? scale3(chordDir, segLen * 0.35) : scale3(safeDir(sub3(P3, P1)), segLen * 0.55);
        if (f.state === 'fly') {
            const sharp = stop ? 1 : (1 - dot3(norm3(chord), norm3(sub3(P3, P2)))) / 2;
            const vSeg = vc * (cur.speed ?? 1) * (1 - 0.5 * nearTank);
            const vEnd = stop ? 0 : vSeg * (1 - 0.55 * sharp);
            const L = (1 - f.u) * segLen * 1.08;
            let vTarget = Math.min(vSeg, Math.sqrt(vEnd * vEnd + 2 * aDec * Math.max(0, L - 4)));
            // Slow for tight bends, looking ahead along the curve (sideways push kept to a comfortable value).
            let vCurve = 1e9;
            for (const ahead of [0, 0.07, 0.14]) {
                const h = hermite(Math.min(1, f.u + ahead), P1, P2, m1, m2);
                const v = h.d;
                const c = h.dd;
                const cx = v.y * c.z - v.z * c.y;
                const cy = v.z * c.x - v.x * c.z;
                const cz = v.x * c.y - v.y * c.x;
                const kappa = Math.hypot(cx, cy, cz) / Math.pow(Math.max(1, Math.hypot(v.x, v.y, v.z)), 3);
                vCurve = Math.min(vCurve, Math.sqrt((800 * FLIGHT.speed) / Math.max(kappa, 1e-5)));
            }
            vTarget = Math.min(vTarget, Math.max(90 * FLIGHT.speed, vCurve));
            const a = vTarget > f.vCarrot ? aAcc : aDec;
            f.vCarrot += Math.max(-a * dt, Math.min(a * dt, vTarget - f.vCarrot));
            const d0 = hermite(f.u, P1, P2, m1, m2).d;
            f.u += Math.min(0.2, (f.vCarrot * dt) / Math.max(20, Math.hypot(d0.x, d0.y, d0.z)));
            if (f.u >= 1 || (stop && L < 10 && f.vCarrot < 30)) {
                if (stop) {
                    f.state = 'hover';
                    f.u = 1;
                    f.vCarrot = 0;
                    f.hoverStart = now;
                    f.dwell = cur.dwell * 1000;
                    f.scanBase = f.yaw;
                } else {
                    f.pendingAdvance = true;
                }
            }
        } else if (now - f.hoverStart >= f.dwell) {
            f.pendingAdvance = true;
            f.state = 'fly';
        }
        // Where the drone is drawn to: the carrot (or the waypoint it hovers at), kept in view, clear of the tank, under the ceiling.
        const tpRaw = f.state === 'hover' ? P2 : hermite(Math.min(1, f.u), P1, P2, m1, m2).p;
        const tv = keepInView(s, n, tpRaw);
        f.carrot = { ...tv };
        const cap = B.z + FLIGHT.ceiling;
        const hx = tv.x - B.x;
        const hy = tv.y - B.y;
        const hr = Math.hypot(hx, hy);
        // The push away from the tank is an offset that eases in and out (never a sudden shove).
        const zFade = Math.max(0, Math.min(1, (Math.min(B.z + 380, cap - 60) - tv.z) / 60));
        let wox = 0;
        let woy = 0;
        let woz = 0;
        if (hr < 360 && zFade > 0) {
            const push = ((360 - hr) / 360) * zFade;
            wox = (hx / (hr || 1)) * 230 * push;
            woy = (hy / (hr || 1)) * 230 * push;
            woz = 270 * push;
        }
        const ke = 1 - Math.exp(-dt / 0.33);
        f.off.x += (wox - f.off.x) * ke;
        f.off.y += (woy - f.off.y) * ke;
        f.off.z += (woz - f.off.z) * ke;
        const tx = tv.x + f.off.x;
        const ty = tv.y + f.off.y;
        let tz = tv.z + f.off.z;
        if (tz > cap - 60) tz = cap - 60 + 60 * Math.tanh((tz - (cap - 60)) / 60);
        if (tz < B.z + 70) tz = B.z + 70;
        // The body: a critically damped spring after the target (smooth by construction).
        const w = 2 / tau;
        f.vel.x += (w * w * (tx - f.pos.x) - 2 * w * f.vel.x) * dt;
        f.vel.y += (w * w * (ty - f.pos.y) - 2 * w * f.vel.y) * dt;
        f.vel.z += (w * w * (tz - f.pos.z) - 2 * w * f.vel.z) * dt;
        f.pos.x += f.vel.x * dt;
        f.pos.y += f.vel.y * dt;
        f.pos.z += f.vel.z * dt;
        if (f.pos.z > cap) {
            f.pos.z = cap;
            if (f.vel.z > 0) f.vel.z = 0;
        }
        // The body itself also stays in view (it trails its target a little): a gentle pull back in.
        {
            const pv = keepInView(s, n, f.pos);
            const k = Math.min(1, 10 * dt);
            f.pos.x += (pv.x - f.pos.x) * k;
            f.pos.y += (pv.y - f.pos.y) * k;
            f.pos.z += (pv.z - f.pos.z) * k;
        }
        // The heading: the curve's direction while flying, what the waypoint says while hovering.
        let yawWant = f.yaw;
        f.carrotDir = null;
        if (f.state === 'fly') {
            const t = hermite(Math.min(1, f.u), P1, P2, m1, m2).d;
            yawWant = headingOf(t.x, t.y);
            f.carrotDir = norm3(t);
            // Arriving at a hello: turn toward the player over the last 40 % of the way, so it faces the screen when it stops.
            if (cur.look === 'camera' && f.u > 0.6) {
                const k = Math.min(1, (f.u - 0.6) / 0.4);
                const e0 = eye(s, n);
                yawWant += wrapAngle(headingOf(e0.x - f.pos.x, e0.y - f.pos.y) - yawWant) * k;
            }
        } else if (cur.look === 'camera') {
            const e1 = eye(s, n);
            yawWant = headingOf(e1.x - f.pos.x, e1.y - f.pos.y);
        } else if (cur.look === 'tank') {
            yawWant = headingOf(B.x - f.pos.x, B.y - f.pos.y);
        } else if (cur.look === 'scan') {
            yawWant = f.scanBase + 0.6 * Math.sin(((now - f.hoverStart) / 1000) * 2.2);
        }
        const err = wrapAngle(yawWant - f.yaw);
        const rateWant = Math.max(-maxYaw, Math.min(maxYaw, err / tau));
        const yawAcc = (4.5 * 0.35) / tau;
        const dr = rateWant - f.yawRate;
        f.yawRate += Math.max(-yawAcc * dt, Math.min(yawAcc * dt, dr));
        f.yaw += f.yawRate * dt;
        // Lean into the curve: speed times turn rate is the sideways push, filtered so the lean eases in and out.
        const spd = Math.hypot(f.vel.x, f.vel.y);
        const rollWant = Math.max(-0.4, Math.min(0.4, ((spd * f.yawRate) / 1100) * FLIGHT.bank));
        f.roll += (rollWant - f.roll) * (1 - Math.exp(-dt / 0.18));
        // The tilt: a drone below the player's eye tilts its nose up to look at it.
        let lookK = 0;
        if (f.state === 'hover' && cur.look === 'camera') lookK = 1;
        else if (f.state === 'fly' && cur.look === 'camera' && f.u > 0.6) lookK = Math.min(1, (f.u - 0.6) / 0.4);
        const e2 = eye(s, n);
        const elev = Math.atan2(e2.z - f.pos.z, Math.hypot(e2.x - f.pos.x, e2.y - f.pos.y));
        const pitchWant = Math.max(-0.7, Math.min(0.7, elev * lookK * FLIGHT.lookUp));
        f.pitch += (pitchWant - f.pitch) * (1 - Math.exp(-dt / 0.3));
        writeVector(bag(s.system, d.home), n, f.pos);
    }

    // The drone back to the game's own hover: the hangar's drone place and the last drone's turn and lean.
    function restoreDrone(s: Scene, n: KaspLobbyNames): void {
        const d = n.drone;
        if (d === undefined || s.droneHome === null) return;
        try {
            writeVector(bag(s.system, d.home), n, s.droneHome);
        } catch {
            // that line stays as it is
        }
        try {
            const turn = lastDrone === null ? undefined : droneTurns.get(lastDrone);
            if (lastDrone !== null && turn !== undefined) {
                const rotation = bag(bag(lastDrone, d.mesh), n.rotation);
                rotation[n.y] = turn.y;
                rotation[n.z] = turn.z;
            }
        } catch {
            // that line stays as it is
        }
    }

    function stopDrone(s: Scene, n: KaspLobbyNames): void {
        droneBroken = true;
        restoreDrone(s, n);
        flight = null;
    }

    // Each lobby frame, after the camera and light: one step of the flight.
    function flyDrone(s: Scene, n: KaspLobbyNames, now: number, dt: number): void {
        const d = n.drone;
        if (d === undefined || droneBroken || s.droneHome === null) return;
        try {
            if (flight === null) flight = startFlight(s, n, s.droneHome);
            flightStep(s, n, d, flight, now, dt);
        } catch {
            stopDrone(s, n);
        }
    }

    // Called by the game's drone system at the end of its own update: our turn, lean and tilt over the game's, and no grabbing.
    function drone(system: unknown): void {
        droneFrames++;
        const n = names;
        const d = n === null ? undefined : n.drone;
        const s = scene;
        const f = flight;
        if (n === null || d === undefined || s === null || f === null || broken || droneBroken || !isBag(system)) return;
        try {
            const place = readVector(bag(system, d.place), n);
            if (Math.hypot(place.x - f.pos.x, place.y - f.pos.y, place.z - f.pos.z) > DRONE_NEAR) return;
            const rotation = bag(bag(system, d.mesh), n.rotation);
            if (!droneTurns.has(system)) droneTurns.set(system, readVector(rotation, n));
            lastDrone = system;
            system[d.grabbed] = false;
            rotation[n.z] = f.yaw + FLIGHT.facing * DEG;
            rotation[n.y] = f.roll;
            rotation[n.x] = num(rotation, n.x) + f.pitch;
        } catch {
            stopDrone(s, n);
        }
    }

    // Called by hangar_files.ts as soon as the game has asked for its hangar (during the loading screen): the hangar model and the
    // night pictures are read then, so they are ready when the lobby first shows (they were started by the first lobby picture).
    function prepare(): void {
        if (names === null || names.pass === undefined || passBroken) return;
        ensureStandard();
        ensureSky();
    }

    function start(found: KaspLobbyNames): void {
        if (names !== null) return;
        names = Object.freeze({ ...found, shadowFields: Object.freeze([...found.shadowFields]) });
        window.addEventListener(
            'mousemove',
            (event) => {
                mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
                mouse.y = (event.clientY / window.innerHeight) * 2 - 1;
            },
            { passive: true },
        );
    }

    window.__kaspLobby = {
        start,
        prepare,
        frame,
        drone,
        get frames() {
            return frames;
        },
        get game() {
            return scene === null ? null : scene.record;
        },
        get state() {
            return Object.freeze({
                ...state,
                bound: scene !== null,
                broken,
                droneFrames,
                droneBroken,
                flight: flight === null ? null : flight.state,
                helloSpot: flight === null ? 0 : flight.helloSpot,
                passFrames,
                passBroken,
                passParts: passScene === null ? 0 : passScene.parts.length,
                hangarModel: standard !== null ? 'ready' : standardState,
                look: lookName,
                nightPictures: nightPics !== null ? `ready in ${nightMs} ms` : nightState,
                lensPictures: lensAsset !== null ? 'ready' : lensState,
                greySky: skyAsset !== null ? `ready in ${skyMs} ms` : skyState,
                sounds: sound.state,
                soundLevels: Object.fromEntries([...sound.loops].map(([k, v]) => [k, v.gain.gain.value])),
                rainHiss: sound.rain === null ? null : sound.rain.gain.value,
                strikes: STORM.strikes,
                boltPicture: STORM.bolt !== null,
                thunder: thunder.state,
                thunders: thunder.played,
                barks: sound.barks,
            });
        },
    };
})();
