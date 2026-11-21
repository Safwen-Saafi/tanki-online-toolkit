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
    // The owner's final "day normal" preset (probe v1.68, report of 2026-11-20 14:13), the game-side groups only.
    const LOOK = {
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
    } as const;
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
    // renderer's shadow and sharpness (the full settings).
    function firstWrites(s: Scene, n: KaspLobbyNames): void {
        bag(bag(s.system, n.platform), n.rotation)[n.z] = Math.atan2(-s.want.faceX, s.want.faceY) + POSE.turn * DEG;
        const r = s.rendererRecord;
        if (r.shadowsOn) {
            const o = r.shadow;
            s.renderer[n.shadow] = invoke(r.shadowObject, n.shadowCopy, [
                LOOK.shadowSize,
                o[1] * LOOK.shadowReach,
                o[2] * LOOK.shadowReach,
                LOOK.shadowStrength,
                o[4],
                o[5] * LOOK.shadowBlur,
                o[6],
                o[7],
                o[8],
            ]);
        }
        // Raised to the owner's 16 whatever the game's own (his call, 2026-11-21).
        setSharpness(s, n, LOOK.sharpness);
        state.shadows = r.shadowsOn ? LOOK.shadowStrength : 'the game\'s own (off)';
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
        const more = LOOK.breathing - 1;
        const follow = LOOK.follow;
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
            const side = LOOK.keySide + Math.sin(sweepTime * LOOK.sweepSpeed) * LOOK.sweepAmount;
            const az = w.phi + side * DEG;
            const el = LOOK.keyHeight * DEG;
            writeVector(bag(s.system, n.lightDir), n, { x: -Math.cos(az) * Math.cos(el), y: -Math.sin(az) * Math.cos(el), z: -Math.sin(el) });
            const lighting = bag(s.renderer, n.lighting);
            const key = bag(lighting, n.key);
            writeColour(bag(key, n.keyColour), n, fromHex(LOOK.keyColour));
            key[n.keyStrength] = LOOK.keyStrength;
            writeColour(bag(lighting, n.ambient), n, [...fromHex(LOOK.fillColour).map((part) => part * LOOK.fillStrength), 1]);
        }
        s.system[n.lampSpeed] = LOOK.lampSpeed;
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
    interface LobbyLook {
        readonly time: { readonly hour: number; readonly strength: number; readonly inside: number; readonly sunSide: number };
        readonly door: number;
        readonly night: NightLights;
        // the probe's "clean walls" (the painted sunlight taken out by day too); 0 = off
        readonly cleanWall: number;
        readonly road: RoadNumbers;
        readonly roadN: RoadNumbers;
        readonly hidden: readonly string[];
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
        time: { hour: 13, strength: 1, inside: 0.7, sunSide: 0 },
        door: 1,
        night: { lamps: 0.35, reach: 0.85, glow: 0, sunOff: 1, fixtures: 1, keyDown: 1, color: '#fff3e0' },
        cleanWall: 0,
        road: { amount: 0.55, reach: 1175, line: 0, x0: -860, x1: 700, feather: 160, out: 45, bright: 1, tone: 0, fade: 0, inside: 1 },
        roadN: { amount: 1.5, reach: 1650, line: 700, x0: -1110, x1: 780, feather: 360, out: 0, bright: 1.15, tone: 0.1, fade: 1500, inside: 1 },
        hidden: ['transp1'],
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
    // The looks built so far (the settings tab's list and hangar_files.ts use the same values); any other value is the day.
    const LOOKS: Readonly<Record<string, LobbyLook>> = { 'day-normal': DAY_NORMAL, 'night-normal': NIGHT_NORMAL };
    const lookName: string = (() => {
        try {
            const v = localStorage.getItem('kasp_lobby_look') ?? '';
            return LOOKS[v] !== undefined ? v : 'day-normal';
        } catch {
            return 'day-normal';
        }
    })();
    const look: LobbyLook = LOOKS[lookName];
    // How dark it is at the look's hour (0 by day, 1 at night): the hangar's painted sunbeams left, turned round.
    const nightAmount = (): number => Math.max(0, Math.min(1, 1 - timeState(look.time.hour).beams));

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
        return { o: best.o, l: best.l, wall: best.wall, groundZ: room.minZ, skyZ: town.maxZ, skyNear: best.near, skyLow: room.maxZ, floorZ: floor ? floor.maxZ : 0, u: best.u };
    }

    interface PassScene {
        readonly parts: readonly Part[];
        readonly box: KaspLobbyBox;
        readonly offset: [number, number, number];
        readonly hidden: readonly Part[];
    }
    let passScene: PassScene | null = null;
    let passBroken = false;
    let passFrames = 0;
    let lobbyTickAt = 0;
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
            const hidden = parts.filter((q) => look.hidden.includes(q.name));
            for (const part of hidden) invoke(part.node, p.setShown, [false]);
            passScene = { parts, box: streetBox(parts, n, p), offset, hidden };
            wrapFrame(s.renderer, p);
        } catch {
            stopPass();
        }
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
        const wanted = look.cleanWall > 0 || (nightAmount() > 0.01 && look.night.sunOff > 0);
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

    // The game's own hangar model read once, as soon as hangar_files.ts has seen its folder.
    // The Halloween lamps (26f4c), read once from the extension's hangars/ folder after the hangar model (for the lamp spots).
    let fixtures: KaspLobbyAsset | null = null;
    let fixturesState: 'none' | 'loading' | 'failed' = 'none';
    function ensureFixtures(std: KaspLobbyStandard): void {
        if (fixtures !== null || fixturesState !== 'none' || look.night.fixtures <= 0) return;
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
            },
            () => {
                standardState = 'failed';
            },
        );
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
        const down = Math.max(0, Math.min(1, 1 - st.beams)) * L.night.keyDown;
        if (down > 0) {
            const g = s.record.lightDir;
            dir = [lerp(dir[0], g.x, down), lerp(dir[1], g.y, down), lerp(dir[2], g.z, down)];
            const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
            dir = dir.map((v) => v / len);
            key = lerp3(st.key, fromHex(L.night.color), down);
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

    // ---- the lobby's sounds: the calm city by day (26f3), the night ambience and the far dog at night (26f4d), from the probe ----
    // Only while the lobby is drawn. Each loop recording is cut into a seamless loop (its last 1.5 s faded into its start, equal power)
    // and played at its target loudness (divided by the file's own loudness) times the look's %, by day or at night. The far dog: one
    // of the two bark groups in its recording, muffled by distance, to one side, a slightly different dog each time, through an outdoor
    // echo, about every `every` seconds (give or take 20 %; the first 3 to 7 s after the night sounds start). Browsers start no sound
    // before a click or a key on the page, so everything waits for the first one. Any failure leaves that sound silent.
    interface SoundLoop {
        readonly file: string;
        readonly target: number;
        readonly level: () => number;
    }
    const SOUND_LOOPS: Readonly<Record<string, SoundLoop>> = {
        city: { file: 'day-city.mp3', target: 0.015, level: () => (look.city / 100) * (1 - nightAmount()) },
        night: {
            file: 'night-ambience.mp3',
            target: 0.015,
            level: () => (look.nightSounds === null ? 0 : look.nightSounds.ambience / 100) * nightAmount(),
        },
    };
    // the barks in the recording: [start, end] in seconds (two bark groups, each with its short tail)
    const DOG = { file: 'night-dog-far.mp3', barks: [[0.6, 3.0], [4.3, 6.6]] as ReadonlyArray<readonly [number, number]> };
    const sound: {
        ctx: AudioContext | null;
        state: 'none' | 'loading' | 'ready' | 'failed';
        loops: Map<string, { readonly gain: GainNode; readonly norm: number }>;
        dog: { readonly buf: AudioBuffer; readonly norm: number } | null;
        dogBus: GainNode | null;
        next: number;
        barks: number;
    } = { ctx: null, state: 'none', loops: new Map(), dog: null, dogBus: null, next: 0, barks: 0 };
    const wantedLoops = (): string[] => Object.keys(SOUND_LOOPS).filter((k) => (k === 'city' ? look.city > 0 : look.nightSounds !== null));
    function loadBuffer(ctx: AudioContext, base: string, file: string): Promise<AudioBuffer> {
        return fetch(base + file)
            .then((r) => {
                if (!r.ok) throw new Error(file + ' ' + r.status);
                return r.arrayBuffer();
            })
            .then((data) => ctx.decodeAudioData(data));
    }
    function loadSounds(ctx: AudioContext): void {
        const base = document.documentElement.getAttribute('data-kasp-hangar-base');
        if (base === null) {
            sound.state = 'failed';
            return;
        }
        sound.state = 'loading';
        const loops = wantedLoops().map((key) =>
            loadBuffer(ctx, base, SOUND_LOOPS[key].file).then((buf) => {
                const rate = buf.sampleRate;
                const len = buf.length;
                const lap = Math.min(Math.round(rate * 1.5), Math.floor(len / 3));
                const n = len - lap;
                const out = ctx.createBuffer(buf.numberOfChannels, n, rate);
                let sum = 0;
                for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                    const src = buf.getChannelData(ch);
                    const dst = out.getChannelData(ch);
                    for (let i = 0; i < n; i++) dst[i] = src[i];
                    for (let i = 0; i < lap; i++) {
                        const t = i / lap;
                        dst[i] = src[n + i] * Math.cos((t * Math.PI) / 2) + src[i] * Math.sin((t * Math.PI) / 2);
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
    // Every half second: each loop fades to its level while the lobby is drawn and nothing stopped it, else to silence; the far dog.
    function applySounds(): void {
        const ctx = sound.ctx;
        const want = !broken && !passBroken && passScene !== null && performance.now() - lobbyTickAt < 1000;
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
        for (const [key, lp] of sound.loops) lp.gain.gain.setTargetAtTime(want ? SOUND_LOOPS[key].level() * lp.norm : 0, ctx.currentTime, 0.8);
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
    if (wantedLoops().length > 0) {
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
        const inn = mix1(st.inn, s * L.time.inside);
        const hor = mix1(st.hor, s);
        const zen = mix1(st.zen, s);
        const night = nightAmount();
        const outLight = [0, 1, 2].map((i) => (hor[i] * 2 + zen[i]) / 3); // how lit the outside is, for colours drawn over it
        const lightOf = (c: readonly number[], m: number): number[] => c.map((x, i) => x * Math.max(m, outLight[i]));
        // the floor into the road: the day numbers by day, the night numbers at night
        const rd: RoadNumbers = L.road;
        const rn = L.roadN;
        const mixN = (k: keyof RoadNumbers): number => lerp(rd[k], rn[k], night);
        const roadAmount = rd.amount * (1 - night) + rn.amount * night;
        const graded = [inn, hor, zen].some((c) => c.some((x) => Math.abs(x - 1) > 0.002));
        const glow = st.glow * s;
        const atmosOn = glow > 0.01 || st.stars * s > 0.01;
        const door = Math.max(0.02, L.door);
        ensureStandard();
        const std = standard;
        const nightAsset = std === null ? null : nightAssetOf(std);
        return {
            vp,
            cam: [pos.x, pos.y, pos.z],
            time: (performance.now() % 3600000) / 1000,
            box,
            doorIn: 900 * door,
            doorOut: 350 * door,
            offset: ps.offset,
            floorMix:
                std !== null && roadAmount > 0.01
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
                ((night > 0.01 && L.night.sunOff > 0) || L.cleanWall > 0) && nightAsset !== null
                    ? { asset: nightAsset, amount: Math.max(night * L.night.sunOff, L.cleanWall) }
                    : null,
            fixtures:
                night > 0.01 && L.night.fixtures > 0 && std !== null
                    ? (() => {
                          ensureFixtures(std);
                          return fixtures === null ? null : { asset: fixtures, alpha: Math.min(1, night * L.night.fixtures), cones: night * L.night.fixtures };
                      })()
                    : null,
            lamps:
                night > 0.01 && std !== null && std.lamps.length > 0 && L.night.lamps > 0
                    ? { list: std.lamps, power: night * L.night.lamps, reach: 420 * L.night.reach, glow: night * L.night.glow, color: fromHex(L.night.color) }
                    : null,
            nightx:
                night > 0.01 && (L.streetLamps !== null || L.red !== null)
                    ? (() => {
                          const t = performance.now() / 1000;
                          const Lm = L.streetLamps;
                          const Rd = L.red;
                          const blink = Rd !== null ? Math.pow(Math.max(0, Math.sin((t / Math.max(0.2, Rd.blink)) * Math.PI * 2)), 0.6) : 0;
                          return {
                              fog: 0,
                              fogStart: 0,
                              fogCol: [0, 0, 0],
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
                          };
                      })()
                    : null,
            ncx:
                night > 0.01 && (L.windows !== null || L.shoot !== null || L.pools !== null || L.flies !== null || L.moths !== null || st.stars * s > 0.01)
                    ? (() => {
                          const met = L.shoot === null ? null : meteorStep(performance.now(), box, [pos.x, pos.y, pos.z], L.shoot);
                          return {
                              hor,
                              zen,
                              stars: st.stars * s * STAR_BOOST,
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
                                            color: fromHex(L.night.color).map((x) => x * 0.9),
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
                      fog: 0, fogStart: 0, fogHeight: 1, fogMove: 0, fogCol: [0, 0, 0],
                      cover: 0, spark: 0, coverCol: [0, 0, 0], coverThick: 1,
                      groundZ: box.groundZ,
                      skyZ: box.skyZ,
                      flash: 0, bolt: 0, flashCol: [1, 1, 1],
                      cloud: 0, cloudK: 0, cloudSpeed: 0, cloudCol: [0.5, 0.5, 0.5],
                  }
                : null,
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
                sounds: sound.state,
                soundLevels: Object.fromEntries([...sound.loops].map(([k, v]) => [k, v.gain.gain.value])),
                barks: sound.barks,
            });
        },
    };
})();
