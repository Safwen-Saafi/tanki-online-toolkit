// MAIN-world content script for the lobby (build-plan 26, see blueprint/context/lobby-restyle-research.md). The lobby's 3D is the
// game's own hangar; this file shows it the way the owner tuned it in the lobby probe: his camera "final1" (the tank near and on the
// left, the drag that turns it still working) and the hangar's own light, shadow, ring lamps and sway at the numbers of his final
// "day normal" preset (26a). The injector (src/injector.ts) edits the hangar's per-frame update at start, only while the switch
// kasp_lobby is on, so that the game calls window.__kaspLobby.frame(system) first thing in every lobby frame, and it hands this file
// the game's names once (start), found in the game's own code; nothing here spells a game name.
// On the first frame of each lobby scene the game's own values are recorded before anything is written, and every restore uses
// that record. A slow PC keeps the game's own look (owner's rule): the light is free and always applies, the shadow numbers only
// when the game's own shadows are on, the floor sharpness raised to 16 (the owner's call); and if the lobby draws fewer than 40 frames a
// second over 3 seconds, everything goes back to the recorded values for the rest of the page's life, and sessionStorage
// kasp_lobby_guard tells the settings tab. Nothing watches the page: the work happens only inside the game's own lobby frames, plus
// one passive mouse listener for the gentle mouse follow. With the drone flight's edit too (26c, kasp_lobbydrone), the drone flies
// round the tank like an FPV drone and comes to say hello (see the flight section below). Nothing is printed: a game build that breaks a step just stops the look.
(function () {
    'use strict';

    const GUARD_KEY = 'kasp_lobby_guard';
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
    const MIN_FPS = 40;
    const GUARD_WINDOW_MS = 3000;
    // The first seconds of a lobby scene (the hangar loading in) are not measured.
    const GUARD_GRACE_MS = 2000;
    // A longer gap between two frames is a pause (the tab hidden), not a slow picture: the measure starts again.
    const PAUSE_MS = 1000;
    const MOUSE_EASE = 0.05;

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
    let tripped = false;
    let broken = false;
    let sweepTime = 0;
    let lastFrame = 0;
    let windowStart = 0;
    let windowFrames = 0;
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
    // renderer's shadow and sharpness by the slow-PC rules.
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
        // Raised to the owner's 16 whatever the game's own (his call, 2026-11-21); the guard puts the game's own back.
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
        // The key light comes from keySide degrees round from the camera's side and keyHeight degrees up, swinging slowly; the game
        // copies the system's light direction into its key light every frame.
        const side = LOOK.keySide + Math.sin(sweepTime * LOOK.sweepSpeed) * LOOK.sweepAmount;
        const az = w.phi + side * DEG;
        const el = LOOK.keyHeight * DEG;
        writeVector(bag(s.system, n.lightDir), n, { x: -Math.cos(az) * Math.cos(el), y: -Math.sin(az) * Math.cos(el), z: -Math.sin(el) });
        const lighting = bag(s.renderer, n.lighting);
        const key = bag(lighting, n.key);
        writeColour(bag(key, n.keyColour), n, fromHex(LOOK.keyColour));
        key[n.keyStrength] = LOOK.keyStrength;
        writeColour(bag(lighting, n.ambient), n, [...fromHex(LOOK.fillColour).map((part) => part * LOOK.fillStrength), 1]);
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
        ];
        for (const step of steps) {
            try {
                step();
            } catch {
                // that line stays as it is
            }
        }
    }

    // True when the last full measuring window was too slow.
    function tooSlow(now: number): boolean {
        if (now < windowStart) return false;
        windowFrames++;
        const span = now - windowStart;
        if (span < GUARD_WINDOW_MS) return false;
        const fps = (windowFrames * 1000) / span;
        state.fps = Math.round(fps);
        windowStart = now;
        windowFrames = 0;
        return fps < MIN_FPS;
    }

    function trip(): void {
        tripped = true;
        try {
            sessionStorage.setItem(GUARD_KEY, '1');
        } catch {
            // the tab just does not say it
        }
    }

    function frame(system: unknown): void {
        frames++;
        const n = names;
        if (n === null || tripped || broken || !isBag(system)) return;
        const now = performance.now();
        try {
            if (scene === null || scene.system !== system) {
                const next = bind(system, n);
                if (next === null) return;
                scene = next;
                flight = null;
                lastFrame = now;
                windowStart = now + GUARD_GRACE_MS;
                windowFrames = 0;
                firstWrites(next, n);
            }
            const gap = now - lastFrame;
            if (gap > PAUSE_MS) {
                windowStart = now;
                windowFrames = 0;
            }
            lastFrame = now;
            if (tooSlow(now)) {
                restore(scene, n);
                trip();
                return;
            }
            const dt = Math.min(0.05, gap / 1000);
            sweepTime += dt;
            writeLook(scene, n);
            flyDrone(scene, n, now, dt);
        } catch {
            broken = true;
            if (scene !== null) restore(scene, n);
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
        if (n === null || d === undefined || s === null || f === null || tripped || broken || droneBroken || !isBag(system)) return;
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

    function start(found: KaspLobbyNames): void {
        if (names !== null) return;
        names = Object.freeze({ ...found, shadowFields: Object.freeze([...found.shadowFields]) });
        // A new page is a new start: the guard's note is only about this page.
        try {
            sessionStorage.removeItem(GUARD_KEY);
        } catch {
            // nothing to clear
        }
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
            });
        },
        get guard() {
            return tripped;
        },
    };
})();
