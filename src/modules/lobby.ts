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
// one passive mouse listener for the gentle mouse follow. Nothing is printed: a game build that breaks a step just stops the look.
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
        return { system, renderer, record, rendererRecord, want: computeCamera(record) };
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
            sweepTime += Math.min(0.05, gap / 1000);
            writeLook(scene, n);
        } catch {
            broken = true;
            if (scene !== null) restore(scene, n);
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
        get frames() {
            return frames;
        },
        get game() {
            return scene === null ? null : scene.record;
        },
        get state() {
            return Object.freeze({ ...state, bound: scene !== null, broken });
        },
        get guard() {
            return tripped;
        },
    };
})();
