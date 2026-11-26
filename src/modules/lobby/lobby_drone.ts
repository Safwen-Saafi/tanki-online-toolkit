// The lobby drone's flight (26c) and its roast bubble (26d step 11), moved out of lobby.ts (audit 2026-11-26, F-85). MAIN world, runs
// before lobby.js. This file only defines window.__kaspLobbyDroneMaker: lobby.ts calls it once with what the flight needs from it (its
// helpers to read and write the game's objects, and its live names, scene and broken state) and gets back the calls it makes: one
// flight step per lobby frame, the drone system's end-of-update call, putting the drone back, forgetting the flight when the scene
// changes, where the drone is, and the numbers for the console checks. Without this file the drone keeps the game's own hover.
window.__kaspLobbyDroneMaker = function (env: KaspLobbyDroneEnv): KaspLobbyDroneApi {
    'use strict';

    type Bag = Record<string, unknown>;
    type Scene = KaspLobbyDroneScene;
    const { DEG, isBag, bag, num, readVector, writeVector, wrapAngle } = env;

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
            // spot 2 (owner 2026-11-26): far enough right for a full roast bubble on its left (from 39 % on a 16:9 screen), low enough
            // for that bubble to pass under the news / chat / friends bar
            [0.4, 0.8],
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
    // home = the escort (26d step 9): at the game's own drone place, turned as the game has it
    type Look = 'scan' | 'tank' | 'camera' | 'home';
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
        // a speaking hello spot (26d step 11): kept left of the lobby's right column, see clearOfColumn
        readonly clear?: true;
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
        // flying to or hovering at the escort place (26d step 9)
        escort: boolean;
        // the line the drone says at the hello it is on (26d step 11), null at a silent one
        roast: string | null;
    }

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

    // A speaking hello spot's place across the screen, moved left when the lobby's right column (with "Lobby buttons" on) would reach
    // the drone: on a squarer screen than 16:9 the column starts further left. Pure maths on the window's size, nothing measured: the
    // column's left edge is the window's width less 59.85 of the page's em (lobby_ui.css: --kasp-lu-right + --kasp-lu-width), the
    // page's em being 14.637 px per 988 px of the window's height; the drone keeps its half size and 1 % of the width from it.
    function clearOfColumn(sx: number, fwd: number, th: number): number {
        if (!document.documentElement.hasAttribute('data-kasp-lobby-ui')) return sx;
        const asp = aspect();
        const half = ((FLIGHT.droneSize / (fwd * th)) / 2) * 0.9;
        return Math.min(sx, 1 - (59.853 * (14.637 / 988) + half) / asp - 0.01);
    }

    function waypointWorld(s: Scene, n: KaspLobbyNames, w: Waypoint): Vec {
        const B = s.record.base;
        if (w.kind === 'world') return { x: w.x, y: w.y, z: w.look === 'home' ? w.z : Math.min(w.z, B.z + FLIGHT.ceiling - 20) };
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
            const rr = (2 * (w.clear === true ? clearOfColumn(w.sx, w.fwd, th) : w.sx) - 1) * w.fwd * th * aspect();
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
    // The camera as the player sees it: its eye (our point plus the game's breathing), forward, right and up, and the lens.
    function viewOf(s: Scene, n: KaspLobbyNames): { c: Vec; f: Vec; r: Vec; u: Vec; th: number; asp: number } {
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
        return {
            c,
            f: { x: fx, y: fy, z: fz },
            r: { x: rx, y: ry, z: 0 },
            u: { x: ry * fz, y: -rx * fz, z: rx * fy - ry * fx },
            th: Math.tan(lens(s, n) / 2),
            asp: aspect(),
        };
    }

    function keepInView(s: Scene, n: KaspLobbyNames, p: Vec): Vec {
        const v = viewOf(s, n);
        const { c, th, asp } = v;
        const { x: fx, y: fy, z: fz } = v.f;
        const { x: rx, y: ry } = v.r;
        const { x: ux, y: uy, z: uz } = v.u;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        const dz = p.z - c.z;
        const depth = softClamp(dx * fx + dy * fy + dz * fz, 260, 1e6, 140);
        const xr = dx * rx + dy * ry;
        const yu = dx * ux + dy * uy + dz * uz;
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

    // The greeting: out in front of the camera, then close to the screen, looking at the player; spots 1, 2, 3 in strict turn. At a
    // speaking spot (26d step 11) it picks its line now and hovers long enough to read it.
    function greetPath(f: Flight): Waypoint[] {
        const i = (f.lastSpot + 1) % FLIGHT.spots.length;
        f.lastSpot = i;
        f.helloSpot = i + 1;
        const [sx, sy] = FLIGHT.spots[i];
        f.roast = ROAST.spots.includes(i) && roastOn() ? nextRoast() : null;
        const dwell = f.roast === null ? 3.2 : Math.max(ROAST.minHold, ROAST.baseHold + f.roast.length * ROAST.perLetter);
        return [
            { kind: 'screen', sx, sy, fwd: FLIGHT.helloDist * 2, dwell: 0, clear: true },
            { kind: 'screen', sx, sy, fwd: FLIGHT.helloDist, dwell, look: 'camera', speed: 0.7, clear: true },
        ];
    }

    // ---- the roast bubble (26d step 11, owner 2026-11-25: look A "Comic" of blueprint/reference/lobby-ideas/drone-bubble.html) ----
    // While the drone hovers at hello spot 1 or 2 looking at the player, a comic bubble of ours (a page element over the 3D, no game
    // code) says one line. Owner 2026-11-26 (the pop lagged while the bubble measured the page and followed the drone each frame): nothing
    // on the page is measured and nothing follows. When the drone stops, the drone's place on the screen is worked out once from the
    // camera's numbers (pure maths, no page read) and written with the text and spot in one go; lobby.css does the rest by data-spot:
    // spot 1 on the drone's right, spot 2 on its left (on the right it went under the column's tiles), as wide as the room allows,
    // popping out of its tail and shrinking back into it. Spot 3 (behind the right column) stays silent. lobby.css hides it off the
    // lobby or under an open news, chat or friends window, and a timer takes it away if the lobby frames stop meanwhile.
    const ROAST = {
        // FLIGHT.spots indexes that speak
        spots: [0, 1] as readonly number[],
        // the hover at a speaking spot: base + per letter, at least min (seconds)
        baseHold: 1.6,
        perLetter: 0.055,
        minHold: 3.5,
    } as const;
    // The lines live in drone_roasts.ts (window.__kaspDroneRoasts), each in English and Russian. A shuffled order, drawn from the
    // end: no line twice before all were said. null when that file did not run (the drone stays silent).
    let roastDeck: number[] = [];
    function nextRoast(): string | null {
        const lines = window.__kaspDroneRoasts;
        if (lines === undefined || lines.length === 0) return null;
        if (roastDeck.length === 0) {
            roastDeck = lines.map((_, i) => i);
            for (let i = roastDeck.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [roastDeck[i], roastDeck[j]] = [roastDeck[j], roastDeck[i]];
            }
        }
        const line = lines[roastDeck.pop() ?? 0] ?? lines[0];
        return line[roastLanguage()];
    }
    // The game's language at this hello: the one language.ts settled on and wrote on <html> (that file runs in the extension's world,
    // out of reach here); English until it is there.
    const roastLanguage = (): KaspLanguageCode => (document.documentElement.getAttribute('data-kasp-language') === 'RU' ? 'RU' : 'EN');
    // the switch, read at each hello (absent or '1' = on)
    function roastOn(): boolean {
        if (roastBroken) return false;
        try {
            return localStorage.getItem('kasp_droneroast') !== '0';
        } catch {
            return true;
        }
    }

    let roastEl: HTMLDivElement | null = null;
    let roastShowing = false;
    let roastBroken = false;
    let roastTimer = 0;
    let roastOutTimer = 0;

    // Where the drone is on the screen (pixels) and its half size there, from the camera's numbers alone (the same view as
    // keepInView); null behind the camera.
    function roastAt(s: Scene, n: KaspLobbyNames, p: Vec): { x: number; y: number; r: number } | null {
        const v = viewOf(s, n);
        const dx = p.x - v.c.x;
        const dy = p.y - v.c.y;
        const dz = p.z - v.c.z;
        const depth = dx * v.f.x + dy * v.f.y + dz * v.f.z;
        if (depth < 1) return null;
        const xr = dx * v.r.x + dy * v.r.y;
        const yu = dx * v.u.x + dy * v.u.y + dz * v.u.z;
        const H = window.innerHeight;
        return {
            x: (0.5 + xr / (depth * v.th * v.asp) / 2) * window.innerWidth,
            y: (0.5 - yu / (depth * v.th) / 2) * H,
            r: (FLIGHT.droneSize / (depth * v.th) / 2) * H * 0.9,
        };
    }

    // Shows the line at hello spot `spot` (1 or 2), its tail at the drone (x, y), r its half size: one write, nothing measured.
    function showRoast(text: string, spot: number, x: number, y: number, r: number, hold: number): void {
        if (roastEl === null) {
            roastEl = document.createElement('div');
            roastEl.className = 'kasp-roast';
            document.body.appendChild(roastEl);
        }
        clearTimeout(roastOutTimer);
        const el = roastEl;
        el.textContent = text;
        el.dataset.spot = String(spot);
        el.style.setProperty('--kasp-roast-x', `${Math.round(x)}px`);
        el.style.setProperty('--kasp-roast-y', `${Math.round(y)}px`);
        el.style.setProperty('--kasp-roast-gap', `${Math.round(r)}px`);
        el.dataset.state = 'in';
        roastShowing = true;
        // if the lobby frames stop during the hello (another screen, a battle), the bubble still goes
        clearTimeout(roastTimer);
        roastTimer = window.setTimeout(hideRoast, hold * 1000 + 1500);
    }

    // Shrinks the bubble back into its tail, then takes it off.
    function hideRoast(): void {
        clearTimeout(roastTimer);
        roastShowing = false;
        const el = roastEl;
        if (el === null || el.dataset.state !== 'in') return;
        el.dataset.state = 'out';
        roastOutTimer = window.setTimeout(() => {
            if (el.dataset.state === 'out') el.dataset.state = '';
        }, 260);
    }

    // Each lobby frame, after the flight step: the bubble goes on when the drone has stopped at a speaking hello and off when it
    // leaves (or the hello is cut short by the search's escort). A fault here stops only the roasts, never the drone.
    function roastStep(s: Scene, n: KaspLobbyNames, f: Flight): void {
        if (roastBroken) return;
        try {
            const cur = f.queue[0];
            const speaking = f.roast !== null && f.state === 'hover' && !f.escort && cur !== undefined && cur.look === 'camera';
            if (!speaking) {
                if (roastShowing) {
                    hideRoast();
                    f.roast = null;
                }
                return;
            }
            if (roastShowing) return;
            const at = roastAt(s, n, f.pos);
            if (at !== null) showRoast(f.roast ?? '', f.helloSpot, at.x, at.y, at.r, f.dwell / 1000);
        } catch {
            roastBroken = true;
            try {
                hideRoast();
            } catch {
                // the bubble stays hidden by its timer
            }
        }
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
            escort: false,
            roast: null,
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
        // no greeting while it escorts the tank (26d step 9: a waypoint on the way there must not let one jump the queue)
        if (FLIGHT.greet > 0 && f.greetTimer <= 0 && !f.escort) {
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
        // Where the drone is drawn to: the carrot (or the waypoint it hovers at), kept in view, clear of the tank, under the ceiling;
        // at the game's own drone place (the escort, 26d step 9) exactly there, none of those rules.
        const atHome = f.state === 'hover' && cur.look === 'home';
        const tpRaw = f.state === 'hover' ? P2 : hermite(Math.min(1, f.u), P1, P2, m1, m2).p;
        const tv = atHome ? tpRaw : keepInView(s, n, tpRaw);
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
        if (!atHome && hr < 360 && zFade > 0) {
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
        if (!atHome && tz > cap - 60) tz = cap - 60 + 60 * Math.tanh((tz - (cap - 60)) / 60);
        if (!atHome && tz < B.z + 70) tz = B.z + 70;
        // The body: a critically damped spring after the target (smooth by construction).
        const w = 2 / tau;
        f.vel.x += (w * w * (tx - f.pos.x) - 2 * w * f.vel.x) * dt;
        f.vel.y += (w * w * (ty - f.pos.y) - 2 * w * f.vel.y) * dt;
        f.vel.z += (w * w * (tz - f.pos.z) - 2 * w * f.vel.z) * dt;
        f.pos.x += f.vel.x * dt;
        f.pos.y += f.vel.y * dt;
        f.pos.z += f.vel.z * dt;
        if (!atHome && f.pos.z > cap) {
            f.pos.z = cap;
            if (f.vel.z > 0) f.vel.z = 0;
        }
        // The body itself also stays in view (it trails its target a little): a gentle pull back in.
        if (!atHome) {
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
        } else if (cur.look === 'home') {
            const own = lastDrone === null ? undefined : droneTurns.get(lastDrone);
            if (own !== undefined) yawWant = own.z - FLIGHT.facing * DEG;
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
        roastStep(s, n, f);
    }

    // The drone back to the game's own hover: the hangar's drone place and the last drone's turn and lean.
    function restoreDrone(s: Scene, n: KaspLobbyNames): void {
        try {
            hideRoast();
        } catch {
            // the bubble goes by its timer
        }
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

    // The drone escort (26d step 9): while the game searches, the drone leaves its tour (and its greetings) and flies back to the
    // game's own drone place, its vanilla spot, and holds still there turned as the game has it, until the search ends (owner
    // 2026-11-24: first a place beside the tank, then "back to its original vanilla spot"); then the tour goes on. Its dwell is
    // ended by hand when the search ends.
    const ESCORT_GREET_S = 8;
    const escortPoint = (home: KaspLobbyVector): WorldPoint => ({ kind: 'world', x: home.x, y: home.y, z: home.z, dwell: 1e6, look: 'home', detour: true });
    const isEscort = (w: Waypoint | undefined): boolean => w !== undefined && w.look === 'home';

    // A new way from where the carrot is now (a smooth join: the drone's body follows the carrot like a spring).
    function retarget(s: Scene, n: KaspLobbyNames, f: Flight, queue: Waypoint[]): void {
        f.prevPrevPt = f.prevPt;
        f.prevPt = { fixed: { ...(f.carrot ?? f.pos) } };
        f.startDir = f.state === 'fly' && f.carrotDir !== null ? { ...f.carrotDir } : null;
        f.queue = queue;
        refill(f);
        maybeDetour(s, n, f);
        f.state = 'fly';
        f.u = 0;
        f.pendingAdvance = false;
    }

    function escortStep(s: Scene, n: KaspLobbyNames, f: Flight): void {
        const S = window.__kaspSearch;
        const want = S !== undefined && S.on && S.drone;
        if (want === f.escort) return;
        f.escort = want;
        if (want) {
            if (s.droneHome !== null) retarget(s, n, f, [escortPoint(s.droneHome)]);
            return;
        }
        f.greetTimer = Math.max(f.greetTimer, ESCORT_GREET_S);
        if (!f.queue.some(isEscort)) return;
        // hovering there: its dwell ends now and the tour goes on; still on the way: a new way into the tour
        if (isEscort(f.queue[0]) && f.state === 'hover') f.dwell = 0;
        else retarget(s, n, f, []);
    }

    // Each lobby frame, after the camera and light: one step of the flight.
    function flyDrone(s: Scene, n: KaspLobbyNames, now: number, dt: number): void {
        const d = n.drone;
        if (d === undefined || droneBroken || s.droneHome === null) return;
        try {
            if (flight === null) flight = startFlight(s, n, s.droneHome);
            escortStep(s, n, flight);
            flightStep(s, n, d, flight, now, dt);
        } catch {
            stopDrone(s, n);
        }
    }

    // Called by the game's drone system at the end of its own update: our turn, lean and tilt over the game's, and no grabbing.
    function drone(system: unknown): void {
        droneFrames++;
        const n = env.names();
        const d = n === null ? undefined : n.drone;
        const s = env.scene();
        const f = flight;
        if (n === null || d === undefined || s === null || f === null || env.broken() || droneBroken || !isBag(system)) return;
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

    return {
        fly: flyDrone,
        drone,
        restore: restoreDrone,
        reset: (): void => {
            flight = null;
        },
        position: (): KaspLobbyVector | null => (flight === null ? null : flight.pos),
        debug: () => ({
            droneFrames,
            droneBroken,
            flight: flight === null ? null : flight.state,
            helloSpot: flight === null ? 0 : flight.helloSpot,
            roast: roastBroken ? 'broken' : roastShowing ? 'showing' : flight !== null && flight.roast !== null ? 'next hello' : 'quiet',
        }),
    };
};
