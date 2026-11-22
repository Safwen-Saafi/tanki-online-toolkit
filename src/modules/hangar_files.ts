// MAIN-world content script for the lobby's hangar files (build-plan 26e, see blueprint/context/lobby-restyle-research.md). The
// lobby's hangar is one folder on the game's file server: meta.info (the list of its files), object.3ds (the model) and webp
// pictures, all read with window.fetch. While the lobby look is on (kasp_lobby), this wraps window.fetch and answers three of those
// files; every other request goes out untouched. The folder is found by its contents (a list with gar1.webp, race1.webp and
// object.3ds), not by its address, so a new game build's address still matches; its address is put on <html>
// (data-kasp-hangar-folder) for the later lobby parts, next to the extension's own hangars/ address (data-kasp-hangar-base, set by
// hangar_files_base.ts). Read once at start, so a change applies at the next start:
// - The model (object.3ds): the robot arm hanging from the round rail over the tank is removed, and the rail ring is made visible
//   from outside (see modelWithoutArm).
// - The floor (flr1.webp): cleaned of its painted window sunlight and shadow bands (see plainFloorPicture) for every look but the two
//   sunlit ones (kasp_lobby_look; no key is day normal, which keeps the game's own floor). About 2 s of work while the lobby loads.
// - The wall (gar1.webp), only when kasp_lobbybanners is 1: the Birthday hangar's four wall banners painted on; the two pictures
//   share one layout, so each banner lands on the same wall spot.
// - Christmas only (kasp_lobby_look christmas), to make room for the Christmas hangar's fireplace on the right wall: the three screens
//   there, their stand and their cables are removed from the model too, and their shadows painted on the wall picture are cleaned
//   off (see wallWithoutShadows).
// Whatever fails, the game gets its own file. Nothing is printed.
(function () {
    'use strict';

    // The lobby look (kasp_lobby_look, from the shared list in lobby_looks.ts; no key or an unknown one is the list's first look):
    // a `sunlit` look keeps the game's own floor, with the sunlight painted in it; every other look has the cleaned floor (the owner
    // tuned them on it: the kaspFloor line of his final reports, 2026-11-19 and 20).
    // The Birthday banners on the shared wall picture (4096 x 4096 pixels): each a pennant, x0 to x1 across, hanging from y0, its
    // sides ending at y1 and its point at y2. Measured on birthday16-gar1.webp; brighter by GAIN, as the Birthday hangar is lit darker.
    const BANNERS: ReadonlyArray<readonly [number, number, number, number, number]> = [
        [172, 1606, 387, 1923, 1983],
        [680, 1603, 892, 1916, 1973],
        [1442, 1603, 1655, 1906, 1961],
        [1738, 1603, 1953, 1906, 1961],
    ];
    const GAIN = 1.6;
    // The robot arm (with its claw) hanging from the round rail over the tank. It is 31 loose pieces inside the room model (room0),
    // sharing one material with the rail ring. A piece is removed only when ALL of its faces have their centre in this box: the ring
    // passes through the box too, but it is one piece that reaches far outside it, so it stays whole.
    const ARM_MIN = [-320, 215, 255], ARM_MAX = [-140, 370, 515];
    // Careful side: some of those 31 pieces are not the arm but the rail ring's own parts (its end sleeve, the lip and collar round its
    // end), and removing them makes the ring look cut. So any piece with even one corner in the ring's zone is kept, whatever it is
    // (3 pieces, 82 faces; a bit of the arm's mount may stay): 295 to 345 from the room's middle line (sideways), 398 to 460 high.
    const RING_RADIUS_MIN = 295, RING_RADIUS_MAX = 345, RING_Z_MIN = 398, RING_Z_MAX = 460;
    // Christmas: the three screens on the right wall (x -1370), their stand and their three cables, 19 loose pieces of room0. A piece is
    // removed when ALL of its corners lie inside one of these boxes (checked on the game's model: exactly those 19, nothing else; the
    // cable rail along the wall, its end boxes and the cabinet further along stay).
    const SCREEN_BOXES: ReadonlyArray<readonly [readonly number[], readonly number[]]> = [
        [[-1377, -1700, -5], [-1270, -640, 620]],
        [[-1366, -760, 240], [-1338, -40, 620]],
    ];
    // Where their painted shadows lie: each point moves this far along the wall and up for every unit it stands out from the wall (the
    // light comes almost straight at the wall; fitted to the painted shadows).
    const SHADOW_SHIFT = [-0.05, -0.15];

    const read = (key: string): string | null => {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    };
    if (read('kasp_lobby') === '0' || typeof window.fetch !== 'function') return;
    const banners = read('kasp_lobbybanners') === '1';
    const savedLook = read('kasp_lobby_look');
    const lookEntry = window.__kaspLobbyLooks?.find((l) => l.value === savedLook) ?? window.__kaspLobbyLooks?.[0];
    // without the list (its file did not run) the game's own floor, as the day
    const cleanFloor = lookEntry !== undefined && !lookEntry.sunlit;
    const christmas = lookEntry?.value === 'christmas';

    const originalFetch = window.fetch;
    // The hangar's folder on the game's server, once its meta.info was seen.
    let folder: string | null = null;
    // The painted wall picture, made once (the game and the lobby probe may both ask for it).
    let painted: Promise<{ blob: Blob; type: string }> | null = null;
    // The plain floor picture, made once.
    let plainFloor: Promise<{ blob: Blob; type: string }> | null = null;

    const base = (): string | null => {
        const value = document.documentElement.getAttribute('data-kasp-hangar-base');
        return value !== null && /^chrome-extension:\/\/[a-p]{32}\/hangars\/$/.test(value) ? value : null;
    };
    const plain = (address: string): string => address.split('?')[0];
    const call = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        Reflect.apply(originalFetch, window, [input, init]) as Promise<Response>;

    async function answerMetaInfo(address: string, init?: RequestInit): Promise<Response> {
        const real = await call(address, init);
        if (!real.ok || folder !== null) return real;
        let names: string[] = [];
        try {
            const list: unknown = await real.clone().json();
            if (Array.isArray(list)) names = list.map((item) => (item && typeof item.name === 'string' ? item.name : ''));
        } catch {
            return real;
        }
        if (!names.includes('gar1.webp') || !names.includes('race1.webp') || !names.includes('object.3ds')) return real;
        folder = plain(address).slice(0, -'/meta.info'.length);
        document.documentElement.setAttribute('data-kasp-hangar-folder', folder);
        // the lobby reads the hangar now, during the loading screen, so its night pictures are ready when the lobby shows
        try {
            window.__kaspLobby?.prepare();
        } catch {
            // read at the first lobby picture instead
        }
        return real;
    }

    // The standard wall picture made for the look: (Christmas) the removed screens' shadows cleaned off, then (kasp_lobbybanners) the
    // Birthday banners painted on. The game's own picture if anything fails.
    async function wallPicture(address: string, init?: RequestInit): Promise<Response> {
        const real = await call(address, init);
        if (!real.ok || typeof OffscreenCanvas === 'undefined') return real;
        try {
            const options: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
            const wall = await createImageBitmap(await real.clone().blob(), options);
            const canvas = new OffscreenCanvas(wall.width, wall.height);
            const g = canvas.getContext('2d', { willReadFrequently: true });
            if (g === null) return real;
            g.drawImage(wall, 0, 0);
            if (christmas && folder !== null) {
                const model = await call(folder + '/object.3ds');
                if (!model.ok || !wallWithoutShadows(g, wall.width, wall.height, await model.arrayBuffer())) return real;
            }
            if (banners) {
                const ours = base();
                if (ours === null) return real;
                const birthday = await call(ours + 'birthday16-gar1.webp');
                if (!birthday.ok) return real;
                const source = await createImageBitmap(await birthday.blob(), options);
                const sx = wall.width / 4096, sy = wall.height / 4096;
                g.filter = `brightness(${GAIN})`;
                for (const [x0, y0, x1, y1, y2] of BANNERS) {
                    g.save();
                    g.beginPath();
                    g.moveTo(x0 * sx, y0 * sy);
                    g.lineTo(x1 * sx, y0 * sy);
                    g.lineTo(x1 * sx, y1 * sy);
                    g.lineTo(((x0 + x1) / 2) * sx, y2 * sy);
                    g.lineTo(x0 * sx, y1 * sy);
                    g.closePath();
                    g.clip();
                    g.drawImage(source, 0, 0, wall.width, wall.height);
                    g.restore();
                }
                g.filter = 'none';
                source.close();
            }
            const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 });
            wall.close();
            return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/webp', [MADE_HEADER]: '1' } });
        } catch {
            // the game keeps its own file
            return real;
        }
    }

    // room0 of a model file: its points, faces (three corners each) and picture places; null if it cannot be read
    function readRoom(buffer: ArrayBuffer): { points: Float32Array; faces: Uint16Array; uvs: Float32Array } | null {
        const view = new DataView(buffer), bytes = new Uint8Array(buffer);
        let found: { points: Float32Array; faces: Uint16Array; uvs: Float32Array } | null = null;
        const mesh = (start: number, end: number): void => {
            let points: Float32Array | null = null, faces: Uint16Array | null = null, uvs: Float32Array | null = null;
            for (let at = start; at + 6 <= end;) {
                const id = view.getUint16(at, true), length = view.getUint32(at + 2, true), body = at + 6;
                if (length < 6 || at + length > end) break;
                if (id === 0x4110) {
                    const n = view.getUint16(body, true);
                    points = new Float32Array(n * 3);
                    for (let i = 0; i < n * 3; i++) points[i] = view.getFloat32(body + 2 + i * 4, true);
                } else if (id === 0x4140) {
                    const n = view.getUint16(body, true);
                    uvs = new Float32Array(n * 2);
                    for (let i = 0; i < n * 2; i++) uvs[i] = view.getFloat32(body + 2 + i * 4, true);
                } else if (id === 0x4120) {
                    const n = view.getUint16(body, true);
                    faces = new Uint16Array(n * 3);
                    for (let f = 0; f < n; f++) for (let k = 0; k < 3; k++) faces[f * 3 + k] = view.getUint16(body + 2 + f * 8 + k * 2, true);
                }
                at += length;
            }
            if (points !== null && faces !== null && uvs !== null) found = { points, faces, uvs };
        };
        const walk = (start: number, end: number): void => {
            for (let at = start; at + 6 <= end;) {
                const id = view.getUint16(at, true), length = view.getUint32(at + 2, true), body = at + 6;
                if (length < 6 || at + length > end) break;
                if (id === 0x4d4d || id === 0x3d3d) walk(body, at + length);
                else if (id === 0x4000) {
                    let nameEnd = body;
                    while (nameEnd < bytes.length && bytes[nameEnd] !== 0) nameEnd++;
                    if (String.fromCharCode(...bytes.subarray(body, nameEnd)) === 'room0') {
                        for (let inner = nameEnd + 1; inner + 6 <= at + length;) {
                            const innerId = view.getUint16(inner, true), innerLength = view.getUint32(inner + 2, true);
                            if (innerLength < 6 || inner + innerLength > at + length) break;
                            if (innerId === 0x4100) mesh(inner + 6, inner + innerLength);
                            inner += innerLength;
                        }
                    }
                }
                at += length;
            }
        };
        walk(0, buffer.byteLength);
        return found;
    }

    // The loose piece of every face: vertices at the same place welded, faces that share one joined.
    function pieceOfFaces(points: Float32Array, corner: (f: number, k: number) => number, faceCount: number): Int32Array {
        const place = new Map<string, number>(), welded = new Int32Array(points.length / 3);
        for (let i = 0; i < welded.length; i++) {
            const key = `${Math.round(points[i * 3] * 10)},${Math.round(points[i * 3 + 1] * 10)},${Math.round(points[i * 3 + 2] * 10)}`;
            let found = place.get(key);
            if (found === undefined) {
                found = place.size;
                place.set(key, found);
            }
            welded[i] = found;
        }
        const parent = Array.from({ length: place.size }, (_, i) => i);
        const root = (x: number): number => {
            while (parent[x] !== x) {
                parent[x] = parent[parent[x]];
                x = parent[x];
            }
            return x;
        };
        for (let f = 0; f < faceCount; f++) {
            const a = root(welded[corner(f, 0)]);
            parent[root(welded[corner(f, 1)])] = a;
            parent[root(welded[corner(f, 2)])] = a;
        }
        const out = new Int32Array(faceCount);
        for (let f = 0; f < faceCount; f++) out[f] = root(welded[corner(f, 0)]);
        return out;
    }

    // The faces of the screens' pieces (every corner of the piece inside one of SCREEN_BOXES).
    function screenFaces(points: Float32Array, corner: (f: number, k: number) => number, faceCount: number): number[] {
        const piece = pieceOfFaces(points, corner, faceCount);
        const lo = new Map<number, number[]>(), hi = new Map<number, number[]>();
        for (let f = 0; f < faceCount; f++) {
            const p = piece[f];
            const l = lo.get(p) ?? [Infinity, Infinity, Infinity], h = hi.get(p) ?? [-Infinity, -Infinity, -Infinity];
            for (let k = 0; k < 3; k++)
                for (let a = 0; a < 3; a++) {
                    const v = points[corner(f, k) * 3 + a];
                    l[a] = Math.min(l[a], v);
                    h[a] = Math.max(h[a], v);
                }
            lo.set(p, l);
            hi.set(p, h);
        }
        const inside = (p: number): boolean => {
            const l = lo.get(p), h = hi.get(p);
            return l !== undefined && h !== undefined && SCREEN_BOXES.some(([a, b]) => l.every((v, i) => v >= a[i]) && h.every((v, i) => v <= b[i]));
        };
        const out: number[] = [];
        for (let f = 0; f < faceCount; f++) if (inside(piece[f])) out.push(f);
        return out;
    }

    // Christmas: cleans the removed screens' painted shadows off the wall picture (drawn on g, W x H). Each face of those pieces is
    // moved onto the wall behind them along the light (SHADOW_SHIFT), and through the wall's own picture places onto the picture: that
    // outline is where their shadows are; cleanShadows does the rest. False if the wall or the pieces cannot be found.
    function wallWithoutShadows(g: OffscreenCanvasRenderingContext2D, W: number, H: number, model: ArrayBuffer): boolean {
        const room = readRoom(model);
        if (room === null) return false;
        const { points, faces, uvs } = room, faceCount = faces.length / 3;
        const corner = (f: number, k: number): number => faces[f * 3 + k];
        const removed = screenFaces(points, corner, faceCount);
        if (removed.length === 0) return false;
        // the wall face behind them: the largest face facing along x near their back (some of their corners reach a little into the
        // wall) that contains their middle seen along x, not one of their own faces
        const gone = new Set(removed);
        let minX = Infinity, cy = 0, cz = 0, n = 0;
        for (const f of removed)
            for (let k = 0; k < 3; k++) {
                const v = corner(f, k) * 3;
                minX = Math.min(minX, points[v]);
                cy += points[v + 1];
                cz += points[v + 2];
                n++;
            }
        cy /= n;
        cz /= n;
        let wall: { x: number; m: number[]; area: number } | null = null;
        for (let f = 0; f < faceCount; f++) {
            if (gone.has(f)) continue;
            const P = [0, 1, 2].map((k) => corner(f, k) * 3);
            const xs = P.map((v) => points[v]);
            if (Math.max(...xs) - Math.min(...xs) > 0.5 || xs[0] < minX - 50 || xs[0] > minX + 20) continue;
            const [y0, z0, y1, z1, y2, z2] = [points[P[0] + 1], points[P[0] + 2], points[P[1] + 1], points[P[1] + 2], points[P[2] + 1], points[P[2] + 2]];
            const det = (y1 - y0) * (z2 - z0) - (y2 - y0) * (z1 - z0);
            if (Math.abs(det) < 1) continue;
            const b1 = ((cy - y0) * (z2 - z0) - (y2 - y0) * (cz - z0)) / det, b2 = ((y1 - y0) * (cz - z0) - (cy - y0) * (z1 - z0)) / det;
            if (b1 < 0 || b2 < 0 || b1 + b2 > 1) continue;
            if (wall !== null && Math.abs(det) <= wall.area) continue;
            // the picture place as a straight function of (y, z) on this face: u = m0 + m1 y + m2 z, v = m3 + m4 y + m5 z
            const T = [0, 1, 2].map((k) => corner(f, k) * 2);
            const solve = (q0: number, q1: number, q2: number): number[] => {
                const a = ((q1 - q0) * (z2 - z0) - (q2 - q0) * (z1 - z0)) / det, b = ((q2 - q0) * (y1 - y0) - (q1 - q0) * (y2 - y0)) / det;
                return [q0 - a * y0 - b * z0, a, b];
            };
            wall = { x: xs[0], m: [...solve(uvs[T[0]], uvs[T[1]], uvs[T[2]]), ...solve(uvs[T[0] + 1], uvs[T[1] + 1], uvs[T[2] + 1])], area: Math.abs(det) };
        }
        if (wall === null) return false;
        const { x: wallX, m } = wall;
        const at = (v: number): [number, number] => {
            const d = Math.abs(points[v] - wallX), y = points[v + 1] + d * SHADOW_SHIFT[0], z = points[v + 2] + d * SHADOW_SHIFT[1];
            return [(m[0] + m[1] * y + m[2] * z) * W, (1 - (m[3] + m[4] * y + m[5] * z)) * H];
        };
        const shapes = removed.map((f) => [0, 1, 2].map((k) => at(corner(f, k) * 3)));
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of shapes)
            for (const [x, y] of s) {
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                x1 = Math.max(x1, x);
                y1 = Math.max(y1, y);
            }
        const MARGIN = 80;
        x0 = Math.max(0, Math.floor(x0 - MARGIN));
        y0 = Math.max(0, Math.floor(y0 - MARGIN));
        x1 = Math.min(W, Math.ceil(x1 + MARGIN));
        y1 = Math.min(H, Math.ceil(y1 + MARGIN));
        const cw = x1 - x0, ch = y1 - y0;
        if (cw < 8 || ch < 8 || cw * ch > 4e6) return false;
        const maskCanvas = new OffscreenCanvas(cw, ch);
        const mg = maskCanvas.getContext('2d', { willReadFrequently: true });
        if (mg === null) return false;
        mg.fillStyle = '#000';
        mg.fillRect(0, 0, cw, ch);
        mg.fillStyle = '#fff';
        for (const s of shapes) {
            mg.beginPath();
            mg.moveTo(s[0][0] - x0, s[0][1] - y0);
            mg.lineTo(s[1][0] - x0, s[1][1] - y0);
            mg.lineTo(s[2][0] - x0, s[2][1] - y0);
            mg.closePath();
            mg.fill();
        }
        const maskPx = mg.getImageData(0, 0, cw, ch).data, mask = new Float32Array(cw * ch);
        for (let i = 0; i < mask.length; i++) mask[i] = maskPx[i * 4] / 255;
        const image = g.getImageData(x0, y0, cw, ch);
        cleanShadows(image.data, cw, ch, mask);
        g.putImageData(image, x0, y0);
        return true;
    }

    // Takes painted shadows out of a picture (px, W x H, changed in place; mask = 0..1, the shadows' outline). Near the outline (grown a
    // little), a pixel counts as shadowed by how much darker it is than the lit wall round it; there it takes the lit wall's colour
    // (from just outside the shadow, spread smoothly into wide shadows) times its own fine detail (the bricks and cracks seen through
    // the shadow), kept only well inside a shadow so its rim leaves no outline.
    function cleanShadows(px: Uint8ClampedArray, W: number, H: number, mask: Float32Array): void {
        const N = W * H;
        const ext = (src: Float32Array, r: number, isMax: boolean): Float32Array => {
            const f = isMax ? Math.max : Math.min, tmp = new Float32Array(N), out = new Float32Array(N);
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) {
                    let v = src[y * W + x];
                    for (let d = -r; d <= r; d++) v = f(v, src[y * W + Math.min(W - 1, Math.max(0, x + d))]);
                    tmp[y * W + x] = v;
                }
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) {
                    let v = tmp[y * W + x];
                    for (let d = -r; d <= r; d++) v = f(v, tmp[Math.min(H - 1, Math.max(0, y + d)) * W + x]);
                    out[y * W + x] = v;
                }
            return out;
        };
        const blur = (src: Float32Array, r: number): Float32Array => blurred(src, W, H, r);
        const lum = new Float32Array(N), bin = new Float32Array(N);
        for (let i = 0; i < N; i++) {
            lum[i] = 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
            bin[i] = mask[i] > 0.3 ? 1 : 0;
        }
        // where a shadow may be (its soft edge included); outside it is plain lit wall
        const zone = ext(bin, 6, true), lit = new Float32Array(N);
        for (let i = 0; i < N; i++) lit[i] = zone[i] > 0.5 ? 0 : 1;
        // the lit wall's colour round each place: the narrowest look-around that finds enough lit wall
        const E = [new Float32Array(N), new Float32Array(N), new Float32Array(N)], got = new Uint8Array(N);
        for (const r of [4, 8, 16, 32, 64]) {
            const lw = blur(lit, r);
            const cs = [0, 1, 2].map((c) => {
                const a = new Float32Array(N);
                for (let i = 0; i < N; i++) a[i] = px[i * 4 + c] * lit[i];
                return blur(a, r);
            });
            for (let i = 0; i < N; i++)
                if (!got[i] && zone[i] > 0.5 && lw[i] > 0.2) {
                    for (let c = 0; c < 3; c++) E[c][i] = cs[c][i] / lw[i];
                    got[i] = 1;
                }
        }
        const neighbours = (i: number): number[] => {
            const x = i % W, y = (i / W) | 0;
            return [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        };
        // the middles of wide shadows, out of reach: filled in from round them, ring by ring
        const inZone: number[] = [];
        for (let i = 0; i < N; i++) if (zone[i] > 0.5) inZone.push(i);
        let open = inZone.filter((i) => !got[i]);
        while (open.length) {
            const next: number[] = [], fill: Array<[number, number[]]> = [];
            for (const i of open) {
                let n = 0;
                const sum = [0, 0, 0];
                for (const j of neighbours(i))
                    if (j >= 0 && (got[j] || zone[j] <= 0.5)) {
                        for (let c = 0; c < 3; c++) sum[c] += got[j] ? E[c][j] : px[j * 4 + c];
                        n++;
                    }
                if (n) fill.push([i, sum.map((v) => v / n)]);
                else next.push(i);
            }
            if (!fill.length) break;
            for (const [i, col] of fill) {
                for (let c = 0; c < 3; c++) E[c][i] = col[c];
                got[i] = 1;
            }
            open = next;
        }
        // smoothed inside the zone, so the fill has no seams (each place's neighbours in the zone listed once)
        const near = new Int32Array(inZone.length * 4).fill(-1);
        inZone.forEach((i, q) => neighbours(i).forEach((j, k) => {
            if (j >= 0 && zone[j] > 0.5) near[q * 4 + k] = j;
        }));
        for (let it = 0; it < 60; it++)
            for (let q = 0; q < inZone.length; q++) {
                const i = inZone[q];
                for (let c = 0; c < 3; c++) {
                    const Ec = E[c];
                    let s = Ec[i] * 2, n = 2;
                    for (let k = 0; k < 4; k++) {
                        const j = near[q * 4 + k];
                        if (j >= 0) {
                            s += Ec[j];
                            n++;
                        }
                    }
                    Ec[i] = s / n;
                }
            }
        // how shadowed each pixel is: by how much darker its neighbourhood is than the lit wall round it
        const lumS = blur(lum, 2), w = new Float32Array(N);
        for (const i of inZone) {
            const e = 0.3 * E[0][i] + 0.59 * E[1][i] + 0.11 * E[2][i];
            w[i] = Math.max(0, Math.min(1, (1 - lumS[i] / Math.max(e, 1) - 0.08) / 0.22));
        }
        // widened by two pixels, so the shadows' thin dark rims go too; well inside a shadow (shadow all round within 3 pixels) the
        // fine detail is kept: the pixel's brightness against the shadowed brightness round it
        const ws = blur(ext(w, 2, true), 1), core = ext(w, 3, false);
        const sh = new Float32Array(N);
        for (let i = 0; i < N; i++) sh[i] = lum[i] * core[i];
        const shB = blur(sh, 3), shwB = blur(core, 3);
        for (const i of inZone) {
            const k = ws[i];
            if (k < 0.01) continue;
            const local = shwB[i] > 0.05 ? shB[i] / shwB[i] : lumS[i];
            const deep = Math.max(0, Math.min(1, (core[i] - 0.6) / 0.4));
            const d = 1 + (Math.max(0.6, Math.min(1.4, lum[i] / Math.max(local, 2))) - 1) * deep;
            for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(Math.min(255, px[i * 4 + c] * (1 - k) + E[c][i] * d * k));
        }
    }

    // The standard floor picture cleaned (the "sun11" floor, owner 2026-11-18): the sunlight painted in it (the window patches, their
    // glow, the right aisle) is replaced by the shade round it, then its light is flattened (the window shadow bands go; fine detail
    // such as cracks and the painted orange lines, and the very wide shading toward the walls, stay). Made once, as the picture loads,
    // so it is the floor for every time of day. The same two steps as the lobby probe's night floor (removeSun, flattenPicture).
    // The game's own picture if anything fails.
    const SUN = { thin: 2, gap: 4, soft: 2, warm: [0.018, 0.04], margin: 4, feather: 3, fill: [8, 20, 48, 110], dark: [0.6, 0.9], relax: 400, ridge: [0.03, 0.07] };
    const smooth = (a: number, b: number, x: number): number => {
        const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
        return t * t * (3 - 2 * t);
    };
    // average over a square of radius r (rows then columns), edges repeated
    const blurred = (src: Float32Array, w: number, h: number, r: number): Float32Array => {
        const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            let s = 0;
            for (let x = -r; x <= r; x++) s += src[y * w + Math.min(w - 1, Math.max(0, x))];
            for (let x = 0; x < w; x++) {
                tmp[y * w + x] = s / (2 * r + 1);
                s += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
            }
        }
        for (let x = 0; x < w; x++) {
            let s = 0;
            for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
            for (let y = 0; y < h; y++) {
                out[y * w + x] = s / (2 * r + 1);
                s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
            }
        }
        return out;
    };
    // bilinear read of a grid at a fractional place
    const sampled = (a: Float32Array, w: number, h: number, fx: number, fy: number): number => {
        const x0 = Math.max(0, Math.min(w - 1, Math.floor(fx))), y0 = Math.max(0, Math.min(h - 1, Math.floor(fy)));
        const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
        const tx = Math.max(0, Math.min(1, fx - x0)), ty = Math.max(0, Math.min(1, fy - y0));
        return (a[y0 * w + x0] * (1 - tx) + a[y0 * w + x1] * tx) * (1 - ty) + (a[y1 * w + x0] * (1 - tx) + a[y1 * w + x1] * tx) * ty;
    };

    function removeSun(px: Uint8ClampedArray, W: number, H: number): void {
        const o = SUN, Q = 4, w = Math.ceil(W / Q), h = Math.ceil(H / Q);
        const bg = [px[(W - 1) * 4], px[(W - 1) * 4 + 1], px[(W - 1) * 4 + 2]];
        const C = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)], N = new Float32Array(w * h);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) <= 10) continue;
                const k = ((y / Q) | 0) * w + ((x / Q) | 0);
                C[0][k] += px[i];
                C[1][k] += px[i + 1];
                C[2][k] += px[i + 2];
                N[k]++;
            }
        }
        for (let k = 0; k < w * h; k++) {
            if (N[k] > 0) {
                for (let c = 0; c < 3; c++) C[c][k] /= N[k];
                N[k] /= Q * Q;
            }
        }
        const box = (src: Float32Array, r: number): Float32Array => blurred(src, w, h, r);
        // running min / max over a square (rows then columns)
        const ext = (src: Float32Array, r: number, isMax: boolean): Float32Array => {
            const f = isMax ? Math.max : Math.min, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let v = src[y * w + x];
                    for (let d = -r; d <= r; d++) v = f(v, src[y * w + Math.min(w - 1, Math.max(0, x + d))]);
                    tmp[y * w + x] = v;
                }
            }
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    let v = tmp[y * w + x];
                    for (let d = -r; d <= r; d++) v = f(v, tmp[Math.min(h - 1, Math.max(0, y + d)) * w + x]);
                    out[y * w + x] = v;
                }
            }
            return out;
        };
        // warmth of the quarter-size picture; the gutters (no content) count as cool
        const warm = new Float32Array(w * h);
        for (let k = 0; k < w * h; k++) warm[k] = N[k] > 0.2 ? (C[0][k] - C[2][k]) / 255 : -1;
        const opened = ext(ext(warm, o.thin, false), o.thin, true), closed = ext(ext(opened, o.gap, true), o.gap, false);
        const grown = box(closed, o.soft), m = new Float32Array(w * h);
        for (let k = 0; k < w * h; k++) m[k] = N[k] > 0.2 ? smooth(o.warm[0], o.warm[1], grown[k]) : 0;
        const lumOf = (k: number): number => 0.3 * C[0][k] + 0.59 * C[1][k] + 0.11 * C[2][k];
        // the colour of the shade round each cell: pulled in from the cells that are not sunlit, narrowest look-around that finds enough
        const pull = (keep: Float32Array): Float32Array[] => {
            const fill = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)], got = new Float32Array(w * h);
            for (const r of o.fill) {
                const kb = box(keep, r);
                const cb = C.map((a) => {
                    const t = new Float32Array(w * h);
                    for (let k = 0; k < w * h; k++) t[k] = a[k] * keep[k];
                    return box(t, r);
                });
                for (let k = 0; k < w * h; k++) {
                    if (got[k] < 1 && kb[k] > 0.12) {
                        const take = 1 - got[k];
                        for (let c = 0; c < 3; c++) fill[c][k] += take * (cb[c][k] / kb[k]);
                        got[k] = 1;
                    }
                }
            }
            return fill;
        };
        const keep1 = new Float32Array(w * h), wide = ext(m, o.margin, true);
        for (let k = 0; k < w * h; k++) keep1[k] = wide[k] < 0.02 && N[k] > 0.2 ? 1 : 0;
        const first = pull(keep1), keep2 = new Float32Array(w * h);
        for (let k = 0; k < w * h; k++) {
            const ref = 0.3 * first[0][k] + 0.59 * first[1][k] + 0.11 * first[2][k];
            keep2[k] = keep1[k] * (ref > 1 ? smooth(o.dark[0], o.dark[1], lumOf(k) / ref) : 1);
        }
        const fill = pull(keep2);
        // relaxed: the unknown cells take the average of their neighbours again and again, so the fill grows smoothly out of the edge
        const unknown: number[] = [];
        for (let k = 0; k < w * h; k++) if (N[k] > 0.2 && keep2[k] < 0.5) unknown.push(k);
        for (let it = 0; it < o.relax; it++) {
            for (const k of unknown) {
                const x = k % w, y = (k / w) | 0;
                let n = 0, a0 = 0, a1 = 0, a2 = 0;
                const add = (j: number): void => {
                    if (N[j] > 0.2) {
                        a0 += fill[0][j];
                        a1 += fill[1][j];
                        a2 += fill[2][j];
                        n++;
                    }
                };
                if (x > 0) add(k - 1);
                if (x < w - 1) add(k + 1);
                if (y > 0) add(k - w);
                if (y < h - 1) add(k + w);
                if (n) {
                    fill[0][k] = a0 / n;
                    fill[1][k] = a1 / n;
                    fill[2][k] = a2 / n;
                }
            }
        }
        const mf = box(box(wide, o.feather), o.feather);
        // the fill never goes above what is there (the painted footprints of the crates stay plain shadows, not warm ones)
        const scaleCell = new Float32Array(w * h);
        for (let k = 0; k < w * h; k++) scaleCell[k] = N[k] > 0.2 ? Math.min(1, C[0][k] / Math.max(fill[0][k], 1), C[1][k] / Math.max(fill[1][k], 1), C[2][k] / Math.max(fill[2][k], 1)) : 1;
        const scale = box(scaleCell, 2);
        const orig = new Uint8ClampedArray(px);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) <= 10) continue;
                const fx = (x + 0.5) / Q - 0.5, fy = (y + 0.5) / Q - 0.5, k = sampled(mf, w, h, fx, fy);
                // the painted orange lines are thin warm ridges (warmer than both sides, 10 pixels either way): they stay
                const warmAt = (xx: number): number => {
                    const j = (y * W + Math.max(0, Math.min(W - 1, xx))) * 4;
                    return (orig[j] - orig[j + 2]) / 255;
                };
                const ridge = warmAt(x) - Math.max(warmAt(x - 10), warmAt(x + 10));
                const kk = k * (1 - smooth(o.ridge[0], o.ridge[1], ridge));
                if (kk < 0.01) continue;
                for (let c = 0; c < 3; c++) px[i + c] = Math.round(px[i + c] * (1 - kk) + sampled(fill[c], w, h, fx, fy) * sampled(scale, w, h, fx, fy) * kk);
            }
        }
    }

    // flattens the floor's light: keeps the fine detail per colour (smaller than about FINE pixels) and the very wide shading, removes
    // everything in between (the window shadow bands)
    function flattenPicture(px: Uint8ClampedArray, W: number, H: number): void {
        const FINE = 24, WIDE = 48, bg = [px[(W - 1) * 4], px[(W - 1) * 4 + 1], px[(W - 1) * 4 + 2]];
        const chan = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)], cw = new Float32Array(W * H);
        for (let j = 0; j < W * H; j++) {
            const i = j * 4;
            if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) <= 10) continue;
            cw[j] = 1;
            for (let c = 0; c < 3; c++) chan[c][j] = px[i + c] / 255;
        }
        const lbs = chan.map((a) => blurred(blurred(a, W, H, FINE), W, H, FINE)), cb = blurred(blurred(cw, W, H, FINE), W, H, FINE);
        const Q = 4, w = Math.ceil(W / Q), h = Math.ceil(H / Q);
        const sums = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)], N = new Float32Array(w * h);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const j = y * W + x;
                if (!cw[j]) continue;
                const i = j * 4, k = ((y / Q) | 0) * w + ((x / Q) | 0);
                for (let c = 0; c < 3; c++) sums[c][k] += px[i + c];
                N[k]++;
            }
        }
        const soft = (a: Float32Array): Float32Array => blurred(blurred(a, w, h, WIDE), w, h, WIDE);
        const S3 = sums.map(soft), Ns = soft(N);
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const j = y * W + x;
                if (!cw[j]) continue;
                const fx = (x + 0.5) / Q - 0.5, fy = (y + 0.5) / Q - 0.5, n = Math.max(sampled(Ns, w, h, fx, fy), 1e-3), i = j * 4;
                for (let c = 0; c < 3; c++) {
                    const local = lbs[c][j] / Math.max(cb[j], 1e-3), detail = Math.max(0.3, Math.min(2.5, chan[c][j] / Math.max(local, 0.02)));
                    px[i + c] = Math.max(0, Math.min(255, Math.round((sampled(S3[c], w, h, fx, fy) / n) * detail)));
                }
            }
        }
    }

    async function plainFloorPicture(address: string, init?: RequestInit): Promise<Response> {
        const real = await call(address, init);
        if (!real.ok || typeof OffscreenCanvas === 'undefined') return real;
        try {
            const bitmap = await createImageBitmap(await real.clone().blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const g = canvas.getContext('2d', { willReadFrequently: true });
            if (g === null) return real;
            g.drawImage(bitmap, 0, 0);
            const image = g.getImageData(0, 0, bitmap.width, bitmap.height);
            removeSun(image.data, bitmap.width, bitmap.height);
            flattenPicture(image.data, bitmap.width, bitmap.height);
            for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
            g.putImageData(image, 0, 0);
            const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.95 });
            bitmap.close();
            return new Response(blob, { status: 200, headers: { 'Content-Type': 'image/webp', [MADE_HEADER]: '1' } });
        } catch {
            // the game keeps its own file
            return real;
        }
    }

    // The hangar model with the robot arm gone and the rail ring made visible from outside. Two changes to room0, nothing else moves:
    // 1. The arm: every loose piece (vertices welded at the same place, faces that share one joined) lying wholly inside the arm's box,
    //    except pieces in the ring zone, gets three equal corners (drawn as nothing).
    // 2. The ring: its faces are one-sided (the game does not draw a face seen from behind), made to be seen from inside the ring, so
    //    from outside it (the probe's orbit) the near half of the ring vanished. Every face of every piece in the ring zone gets a
    //    twin with the corners in the other order, in the same material, so the ring shows from both sides. This grows the face list,
    //    so the chunk lengths above it are patched.
    // 3. Christmas only: the screens on the right wall, their stand and their cables (SCREEN_BOXES) collapsed like the arm.
    // The game's own model if anything fails.
    async function modelWithoutArm(address: string, init?: RequestInit): Promise<Response> {
        const real = await call(address, init);
        if (!real.ok) return real;
        try {
            const buffer = await real.clone().arrayBuffer();
            const view = new DataView(buffer), bytes = new Uint8Array(buffer);
            // Reads room0's mesh; collapses the arm's faces in place; returns the rebuilt face chunk when the ring needs twins.
            const room = (mesh: number, meshEnd: number): { at: number; length: number; chunk: Uint8Array } | null => {
                let verts: Float32Array | null = null;
                for (let at = mesh; at + 6 <= meshEnd;) {
                    const id = view.getUint16(at, true), length = view.getUint32(at + 2, true), body = at + 6;
                    if (length < 6 || at + length > meshEnd) break;
                    if (id === 0x4110) {
                        const n = view.getUint16(body, true);
                        verts = new Float32Array(n * 3);
                        for (let i = 0; i < n * 3; i++) verts[i] = view.getFloat32(body + 2 + i * 4, true);
                    } else if (id === 0x4120 && verts !== null) {
                        const points = verts;
                        const faceCount = view.getUint16(body, true);
                        const corner = (f: number, k: number): number => view.getUint16(body + 2 + f * 8 + k * 2, true);
                        const pieceOf = pieceOfFaces(points, corner, faceCount);
                        // Christmas: the screens, their stand and cables, collapsed the same way (read before any face changes)
                        const screens = christmas ? screenFaces(points, corner, faceCount) : [];
                        const total = new Map<number, number>(), inside = new Map<number, number>(), insideBox: boolean[] = [];
                        const onRing = new Map<number, boolean>();
                        for (let f = 0; f < faceCount; f++) {
                            const piece = pieceOf[f];
                            for (let k = 0; k < 3; k++) {
                                const v = corner(f, k) * 3, radius = Math.hypot(points[v], points[v + 1]), z = points[v + 2];
                                const here = radius >= RING_RADIUS_MIN && radius <= RING_RADIUS_MAX && z >= RING_Z_MIN && z <= RING_Z_MAX;
                                onRing.set(piece, (onRing.get(piece) ?? false) || here);
                            }
                        }
                        for (let f = 0; f < faceCount; f++) {
                            const centre = [0, 1, 2].map((a) => (points[corner(f, 0) * 3 + a] + points[corner(f, 1) * 3 + a] + points[corner(f, 2) * 3 + a]) / 3);
                            const inBox = centre.every((v, a) => v >= ARM_MIN[a] && v <= ARM_MAX[a]);
                            const piece = pieceOf[f];
                            insideBox.push(inBox);
                            total.set(piece, (total.get(piece) ?? 0) + 1);
                            if (inBox) inside.set(piece, (inside.get(piece) ?? 0) + 1);
                        }
                        for (const f of screens) {
                            const first = corner(f, 0);
                            view.setUint16(body + 2 + f * 8 + 2, first, true);
                            view.setUint16(body + 2 + f * 8 + 4, first, true);
                        }
                        const twins: number[] = [];
                        for (let f = 0; f < faceCount; f++) {
                            const piece = pieceOf[f];
                            if (onRing.get(piece) === true) {
                                twins.push(f);
                                continue;
                            }
                            if (!insideBox[f] || inside.get(piece) !== total.get(piece)) continue;
                            const first = corner(f, 0);
                            view.setUint16(body + 2 + f * 8 + 2, first, true);
                            view.setUint16(body + 2 + f * 8 + 4, first, true);
                        }
                        if (twins.length === 0 || faceCount + twins.length > 65535) return null;
                        // the new face chunk: the old faces, the twins, then the sub-chunks (material groups and smoothing) widened to match
                        const faceEnd = body + 2 + faceCount * 8, chunkEnd = at + length;
                        const newIndex = new Map<number, number>();
                        twins.forEach((f, i) => newIndex.set(f, faceCount + i));
                        const parts: Uint8Array[] = [];
                        const head = new Uint8Array(8), headView = new DataView(head.buffer);
                        headView.setUint16(0, 0x4120, true);
                        headView.setUint16(6, faceCount + twins.length, true);
                        parts.push(head, bytes.slice(body + 2, faceEnd));
                        const extra = new Uint8Array(twins.length * 8), extraView = new DataView(extra.buffer);
                        twins.forEach((f, i) => {
                            extraView.setUint16(i * 8, corner(f, 0), true);
                            extraView.setUint16(i * 8 + 2, corner(f, 2), true);
                            extraView.setUint16(i * 8 + 4, corner(f, 1), true);
                            extraView.setUint16(i * 8 + 6, view.getUint16(body + 2 + f * 8 + 6, true), true);
                        });
                        parts.push(extra);
                        for (let sub = faceEnd; sub + 6 <= chunkEnd;) {
                            const subId = view.getUint16(sub, true), subLength = view.getUint32(sub + 2, true);
                            if (subLength < 6 || sub + subLength > chunkEnd) return null;
                            if (subId === 0x4130) {
                                let nameEnd = sub + 6;
                                while (nameEnd < sub + subLength && bytes[nameEnd] !== 0) nameEnd++;
                                const count = view.getUint16(nameEnd + 1, true), listAt = nameEnd + 3;
                                const added: number[] = [];
                                for (let i = 0; i < count; i++) {
                                    const twin = newIndex.get(view.getUint16(listAt + i * 2, true));
                                    if (twin !== undefined) added.push(twin);
                                }
                                const group = new Uint8Array(nameEnd + 3 - sub + (count + added.length) * 2), groupView = new DataView(group.buffer);
                                group.set(bytes.subarray(sub, nameEnd + 1));
                                groupView.setUint16(0, 0x4130, true);
                                groupView.setUint32(2, group.length, true);
                                groupView.setUint16(nameEnd + 1 - sub, count + added.length, true);
                                group.set(bytes.subarray(listAt, listAt + count * 2), nameEnd + 3 - sub);
                                added.forEach((value, i) => groupView.setUint16(nameEnd + 3 - sub + (count + i) * 2, value, true));
                                parts.push(group);
                            } else if (subId === 0x4150 && subLength === 6 + faceCount * 4) {
                                const smooth = new Uint8Array(subLength + twins.length * 4);
                                smooth.set(bytes.subarray(sub, sub + subLength));
                                new DataView(smooth.buffer).setUint32(2, smooth.length, true);
                                twins.forEach((f, i) => smooth.set(bytes.subarray(sub + 6 + f * 4, sub + 10 + f * 4), subLength + i * 4));
                                parts.push(smooth);
                            } else {
                                parts.push(bytes.slice(sub, sub + subLength));
                            }
                            sub += subLength;
                        }
                        const size = parts.reduce((sum, part) => sum + part.length, 0), chunk = new Uint8Array(size);
                        let offset = 0;
                        for (const part of parts) {
                            chunk.set(part, offset);
                            offset += part.length;
                        }
                        new DataView(chunk.buffer).setUint32(2, size, true);
                        return { at, length, chunk };
                    }
                    at += length;
                }
                return null;
            };
            // Finds room0 and the chain of chunks above its mesh (their lengths must grow with the face list).
            let rebuilt: { at: number; length: number; chunk: Uint8Array } | null = null;
            let chain: number[] = [];
            const walk = (start: number, end: number, above: number[]): void => {
                for (let at = start; at + 6 <= end;) {
                    const id = view.getUint16(at, true), length = view.getUint32(at + 2, true), body = at + 6;
                    if (length < 6 || at + length > end) break;
                    if (id === 0x4d4d || id === 0x3d3d) walk(body, at + length, [...above, at]);
                    else if (id === 0x4000) {
                        let nameEnd = body;
                        while (nameEnd < bytes.length && bytes[nameEnd] !== 0) nameEnd++;
                        if (String.fromCharCode(...bytes.subarray(body, nameEnd)) === 'room0') {
                            for (let inner = nameEnd + 1; inner + 6 <= at + length;) {
                                const innerId = view.getUint16(inner, true), innerLength = view.getUint32(inner + 2, true);
                                if (innerLength < 6 || inner + innerLength > at + length) break;
                                if (innerId === 0x4100) {
                                    const result = room(inner + 6, inner + innerLength);
                                    if (result !== null) {
                                        rebuilt = result;
                                        chain = [...above, at, inner];
                                    }
                                }
                                inner += innerLength;
                            }
                        }
                    }
                    at += length;
                }
            };
            walk(0, buffer.byteLength, []);
            let output: ArrayBuffer = buffer;
            if (rebuilt !== null) {
                const { at, length, chunk } = rebuilt as { at: number; length: number; chunk: Uint8Array };
                const joined = new Uint8Array(bytes.length - length + chunk.length);
                joined.set(bytes.subarray(0, at), 0);
                joined.set(chunk, at);
                joined.set(bytes.subarray(at + length), at + chunk.length);
                const joinedView = new DataView(joined.buffer);
                for (const header of chain) joinedView.setUint32(header + 2, joinedView.getUint32(header + 2, true) + chunk.length - length, true);
                output = joined.buffer;
            }
            return new Response(output, { status: 200, headers: { 'Content-Type': real.headers.get('Content-Type') ?? 'application/octet-stream', [MADE_HEADER]: '1' } });
        } catch {
            // the game keeps its own file
            return real;
        }
    }
    let armless: Promise<ArrayBuffer> | null = null;

    // ---- the made files, saved (26f2, owner 2026-11-21: "for all of the hangar lobby textures, without exception") ----
    // Every file the lobby makes from the game's hangar (the model without the arm, the cleaned floor, the wall with the banners, the
    // night pictures of lobby_pass.ts, and those of the later looks) is saved in this site's IndexedDB the first time it is made, and
    // read from there on the next starts, so it is made once. A key is the made file's name, the hangar folder's address (a game
    // update that changes the hangar puts its files at a new address, so they are made again by themselves) and MADE_VERSION (raised
    // when a way of making changes). Saving a file deletes the files of any other folder or version, so nothing piles up. Anything
    // that fails (no storage, a private window, a full disk) just makes the file as before.
    // 2: the night wall reads its light on the plain wall only; 3: its cleaned spots matched to the never-lit wall (2026-11-22)
    const MADE_VERSION = 3;
    const MADE_DB = 'kasp-lobby-made';
    const MADE_STORE = 'made';
    // A made response carries this header, so a file the making gave up on (the game's own, unchanged) is never saved.
    const MADE_HEADER = 'X-Kasp-Made';
    let madeDb: Promise<IDBDatabase | null> | null = null;
    function openMade(): Promise<IDBDatabase | null> {
        madeDb ??= new Promise((resolve) => {
            try {
                const req = indexedDB.open(MADE_DB, 1);
                req.onupgradeneeded = () => req.result.createObjectStore(MADE_STORE);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
        return madeDb;
    }
    const madePrefix = (): string | null => (folder === null ? null : `${MADE_VERSION}|${folder}|`);
    async function readMade(key: string): Promise<Blob | null> {
        const db = await openMade();
        if (db === null) return null;
        return new Promise((resolve) => {
            try {
                const req = db.transaction(MADE_STORE, 'readonly').objectStore(MADE_STORE).get(key);
                req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
                req.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    }
    async function writeMade(key: string, prefix: string, blob: Blob): Promise<void> {
        const db = await openMade();
        if (db === null) return;
        try {
            const store = db.transaction(MADE_STORE, 'readwrite').objectStore(MADE_STORE);
            const keys = store.getAllKeys();
            keys.onsuccess = () => {
                for (const old of keys.result) if (typeof old === 'string' && !old.startsWith(prefix)) store.delete(old);
                store.put(blob, key);
            };
        } catch {
            // not saved: made again next time
        }
    }
    // The saved file for name, or make it (null = could not be made) and save it.
    async function saved(name: string, make: () => Promise<Blob | null>): Promise<Blob | null> {
        const prefix = madePrefix();
        if (prefix === null) return make();
        const key = prefix + name;
        const known = await readMade(key);
        if (known !== null) return known;
        const blob = await make();
        if (blob !== null) void writeMade(key, prefix, blob);
        return blob;
    }
    // A hangar file answered from the saved copy, or made by run (a response marked with MADE_HEADER) and saved.
    async function savedResponse(name: string, type: string, run: () => Promise<Response>): Promise<{ blob: Blob; type: string }> {
        let fallback: { blob: Blob; type: string } | null = null;
        const blob = await saved(name, async () => {
            const r = await run();
            const b = await r.blob();
            if (r.headers.get(MADE_HEADER) === '1') return b;
            fallback = { blob: b, type: r.headers.get('Content-Type') ?? type };
            return null;
        });
        return blob !== null ? { blob, type } : fallback ?? { blob: new Blob(), type };
    }

    // The two floor steps and the saved store, shared with lobby_pass.ts, which makes the night pictures with them (26f2).
    // the wall picture's own changes, in the saved names of anything made from it
    const wallTag = `${christmas ? '-xmas' : ''}${banners ? '-banners' : ''}`;
    window.__kaspHangarPictures = { removeSun, flattenPicture, saved, floorCleaned: cleanFloor, wallTag };

    window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        try {
            const address = typeof input === 'string' ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : '';
            if (folder === null && /^https:\/\/[^/]*tankionline\.com\/.*\/meta\.info(\?|$)/.test(address)) return answerMetaInfo(address, init);
            if (wallTag !== '' && folder !== null && plain(address) === folder + '/gar1.webp') {
                painted ??= savedResponse(`gar1${wallTag}.webp`, 'image/webp', () => wallPicture(address, init));
                return painted.then(({ blob, type }) => new Response(blob, { status: 200, headers: { 'Content-Type': type } }));
            }
            if (cleanFloor && folder !== null && plain(address) === folder + '/flr1.webp') {
                plainFloor ??= savedResponse('flr1-clean.webp', 'image/webp', () => plainFloorPicture(address, init));
                return plainFloor.then(({ blob, type }) => new Response(blob, { status: 200, headers: { 'Content-Type': type } }));
            }
            if (folder !== null && plain(address) === folder + '/object.3ds') {
                armless ??= savedResponse(christmas ? 'object-armless-xmas.3ds' : 'object-armless.3ds', 'application/octet-stream', () => modelWithoutArm(address, init)).then((r) => r.blob.arrayBuffer());
                return armless.then((b) => new Response(b.slice(0), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }));
            }
        } catch {
            // the game's own request goes out
        }
        return Reflect.apply(originalFetch, this, [input, init]) as Promise<Response>;
    };
})();
