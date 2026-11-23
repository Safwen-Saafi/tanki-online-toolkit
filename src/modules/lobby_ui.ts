// MAIN-world content script (build-plan 26d1): the lobby's 8 battle mode tiles, and the mark on <html> (data-kasp-lobby-ui) that lets
// lobby_ui.css move the game's own lobby parts to the right side in glass; both only with the "Lobby buttons" switch on (kasp_lobbyui,
// read once at start). Nothing here runs until the player clicks a tile or rolls the wheel over their row: the tiles are put on the page once, and
// the stylesheet (lobby_ui.css) alone shows them only while the game's lobby PLAY is on the page, greys them while the game is
// searching, and gives each its icon (bundled in extension/lobby/) and its name in the game's language.
// A click starts the mode the way the game's own Modes screen does, without any screen: the injector adds window.__kaspModeStart to
// the game's code, which gives the game's store the game's own "search for this mode" action, the same one its Modes card sends (the
// game then sends its usual request; we send nothing ourselves). Only if that is not in this game build, or cannot start it, the click
// takes the game's own way instead, pressing its buttons with the in-between screens drawn invisible: the game's PLAY, then the Modes
// card of its PLAY screen (Quick battle straight from the PLAY screen), then the mode's own card, ending on the game's matchmaking wait.
// Each card is found by the game's own data on it (the mode's name in the game's code, such as SGE_ONLY), else by its written title in
// English or Russian. The waiting lasts only from the click to the matchmaking wait (at most a few seconds per screen), then stops.
(function () {
    'use strict';

    // The game's classes (its bundle main.01433a16.js and the PLAY screen as other tools have found it, 2026-11-22).
    const PLAY_BOX = 'MainScreenComponentStyle-playButtonContainer';
    const PLAY_OFF = 'MainScreenComponentStyle-disabledButtonPlay';
    const CARD_SELECTOR = '[class*="commonStyleBlock"], .blockCard';
    const WAIT_SELECTOR = '[class*="MatchmakingWaitComponentStyle-"]';
    const STEP_MS = 5000;
    // React's own keys on the game's elements (the newer name first).
    const FIBER_KEYS = ['__reactFiber$', '__reactInternalInstance$'];

    type Key = 'qb' | 'tdm' | 'cp' | 'ctf' | 'sge' | 'jg' | 'rgb' | 'asl';
    interface Target {
        // the game's own names for it (its code's mode lists), then its written titles (English, Russian)
        readonly data: readonly string[];
        readonly titles: readonly string[];
    }
    const MODES: Readonly<Record<Key, Target>> = {
        qb: { data: ['QUICK_BATTLE'], titles: ['QUICK BATTLE', 'БЫСТРЫЙ БОЙ'] },
        tdm: { data: ['TDM_ONLY', 'TDM'], titles: ['TEAM DEATHMATCH', 'КОМАНДНЫЙ БОЙ'] },
        cp: { data: ['CP_ONLY', 'CP'], titles: ['CONTROL POINTS', 'КОНТРОЛЬ ТОЧЕК'] },
        ctf: { data: ['CTF_ONLY', 'CTF'], titles: ['CAPTURE THE FLAG', 'ЗАХВАТ ФЛАГА'] },
        sge: { data: ['SGE_ONLY', 'SGE'], titles: ['SIEGE', 'ОСАДА'] },
        jg: { data: ['JGR_ONLY', 'JGR'], titles: ['JUGGERNAUT', 'ДЖАГГЕРНАУТ'] },
        rgb: { data: ['RUGBY_ONLY', 'RUGBY'], titles: ['RUGBY', 'РЕГБИ'] },
        asl: { data: ['AS_ONLY', 'AS'], titles: ['ASSAULT', 'ШТУРМ'] },
    };
    const KEYS = Object.keys(MODES) as Key[];
    // The PLAY screen's Modes card.
    const MODES_CARD: Target = { data: ['MODES', 'ALL_MODES'], titles: ['MODES', 'РЕЖИМЫ'] };

    type Bag = Record<string, unknown>;
    const isBag = (v: unknown): v is Bag => typeof v === 'object' && v !== null;

    // The game's own enum names in the props of the components that draw one card: from the card's element up to the next element
    // (the card's own components only, not the list above it that knows every mode). An enum value is an object with a name in capitals
    // and a number (its place in the list).
    function dataNames(card: Element): Set<string> {
        const names = new Set<string>();
        const own: Bag = card as unknown as Bag;
        const fiberKey = Object.keys(own).find((k) => FIBER_KEYS.some((prefix) => k.startsWith(prefix)));
        if (fiberKey === undefined) return names;
        const host = own[fiberKey];
        let fiber: unknown = isBag(host) ? host.return : null;
        let seen = 0;
        const look = (v: unknown, depth: number): void => {
            if (!isBag(v) || seen > 300) return;
            seen++;
            const fields = Object.keys(v);
            if (fields.length <= 6) {
                const word = fields.map((k) => v[k]).find((x): x is string => typeof x === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(x));
                if (word !== undefined && fields.some((k) => typeof v[k] === 'number')) names.add(word);
            }
            if (depth < 3) for (const k of fields) if (k !== 'children' && k !== 'ref') look(v[k], depth + 1);
        };
        for (let step = 0; step < 8 && isBag(fiber); step++) {
            if (fiber.stateNode instanceof Element) break;
            look(fiber.memoizedProps, 0);
            fiber = fiber.return;
        }
        return names;
    }

    interface Found {
        readonly card: HTMLElement;
        // how it was found (kept for a future check)
        readonly by: 'data' | 'title';
    }
    function find(target: Target): Found | null {
        const cards = [...document.querySelectorAll<HTMLElement>(CARD_SELECTOR)];
        const byData = cards.filter((c) => {
            const names = dataNames(c);
            return target.data.some((n) => names.has(n));
        });
        if (byData.length === 1) return { card: byData[0], by: 'data' };
        const byTitle = cards.filter((c) => {
            const title = (c.querySelector('h2')?.textContent ?? '').trim().toUpperCase();
            return target.titles.includes(title);
        });
        return byTitle.length === 1 ? { card: byTitle[0], by: 'title' } : null;
    }

    // A press like a hand's: the click, then the mouse down and up (some of the game's buttons answer those).
    function press(el: HTMLElement): void {
        el.click();
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    }

    // Waits, frame by frame, up to STEP_MS for get() to give something; only while a tile's way into its mode runs.
    function waitFor<T>(get: () => T | null): Promise<T | null> {
        const end = performance.now() + STEP_MS;
        return new Promise((done) => {
            const tick = (): void => {
                const got = get();
                if (got !== null) done(got);
                else if (performance.now() > end) done(null);
                else requestAnimationFrame(tick);
            };
            tick();
        });
    }

    // While a tile takes the game's way into its mode: the mark that draws the game's PLAY and Modes screens invisible (lobby_ui.css),
    // and an invisible sheet that keeps the player's own clicks off them. A note says where it stopped, if it did.
    const TRIP_MARK = 'data-kasp-mode-trip';
    // held from the trip's start until the game has faded its 3D picture back in after it (about half a second; lobby_ui.css)
    const CALM_MARK = 'data-kasp-mode-calm';
    const CALM_AFTER_MS = 900;
    let calmTimer = 0;
    const block = document.createElement('div');
    block.className = 'kasp-mode-block';
    const note = document.createElement('div');
    note.className = 'kasp-mode-note';

    function showNote(text: string): void {
        note.textContent = text;
        document.body.append(note);
        window.setTimeout(() => note.remove(), 3000);
    }

    let busy = false;
    async function go(key: Key): Promise<void> {
        const playBox = document.getElementsByClassName(PLAY_BOX)[0];
        if (busy || !(playBox instanceof HTMLElement) || document.getElementsByClassName(PLAY_OFF).length > 0) return;
        // First the direct start (owner, 2026-11-23: nothing may flash): the game's own "search for this mode" action, the one its Modes
        // screen sends, given to the game's store through the injector's hook (window.__kaspModeStart). No screen opens: only the
        // game's searching banner appears. If the hook is not in this game build, or cannot start it, the game's screens below are taken.
        const start = window.__kaspModeStart;
        if (start !== undefined) {
            let started = false;
            try {
                started = start(MODES[key].data);
            } catch {
                started = false;
            }
            if (!started) console.warn('[KI-test][lobby-ui] the direct start could not start', key, '- taking the game screens');
            if (started) {
                busy = true;
                const searching = await waitFor(() => document.querySelector(WAIT_SELECTOR));
                busy = false;
                if (searching === null) showNote(`${MODES[key].titles[0]}: the game did not start the search`);
                return;
            }
        }
        busy = true;
        window.clearTimeout(calmTimer);
        document.documentElement.setAttribute(CALM_MARK, '');
        document.documentElement.setAttribute(TRIP_MARK, '');
        document.body.append(block);
        let failed: string | null = null;
        try {
            press(playBox);
            if (key === 'qb') {
                const quick = await waitFor(() => find(MODES.qb));
                if (quick === null) failed = 'the Quick battle card';
                else press(quick.card);
            } else {
                const modes = await waitFor(() => find(MODES_CARD));
                if (modes === null) failed = 'the Modes card';
                else {
                    press(modes.card);
                    const mode = await waitFor(() => find(MODES[key]));
                    if (mode === null) failed = 'the mode on the Modes screen';
                    else press(mode.card);
                }
            }
            if (failed === null && (await waitFor(() => document.querySelector(WAIT_SELECTOR))) === null) failed = 'the matchmaking wait';
        } catch {
            failed = 'an error';
        }
        // Where it stopped, in plain words, before the game's screen is left as it is (a mode the game does not offer right now, say).
        document.documentElement.removeAttribute(TRIP_MARK);
        block.remove();
        busy = false;
        calmTimer = window.setTimeout(() => document.documentElement.removeAttribute(CALM_MARK), CALM_AFTER_MS);
        if (failed !== null) showNote(`${MODES[key].titles[0]}: did not reach ${failed}`);
    }

    // The battle pass percentage in the Challenges box's title (owner 2026-11-23): the stars so far (the left number of the game's
    // "201/205") out of the 300 that complete every battle pass, in whole percent rounded down (100 only at 300), 100 from 300 on,
    // written on <html> as --kasp-lu-pass for lobby_ui.css. Woken only when the game draws its stars: lobby_ui.css gives them a 1 ms
    // animation, and its start is the one event this listens for.
    const STARS = /(\d+)\s*\/\s*\d+/;
    // How full the game's XP line is (0 to 1): its filled part (its ::after) against the line itself, by width or by a sideways scale.
    function rankProgress(numbers: Element): number {
        const line = numbers.closest('.UserInfoContainerStyle-containerProgressMainScreen')?.children[1];
        if (!(line instanceof HTMLElement)) return 1;
        const whole = line.getBoundingClientRect().width;
        const fill = getComputedStyle(line, '::after');
        const scale = /^matrix\(([-\d.e]+),/.exec(fill.transform);
        if (scale !== null) return Math.max(0, Math.min(1, Number(scale[1])));
        const part = parseFloat(fill.width);
        if (whole > 0 && Number.isFinite(part)) return Math.max(0, Math.min(1, part / whole));
        return 1;
    }

    function onStars(event: AnimationEvent): void {
        // The top bar's rank ring (26d2): the progress from the current rank's start to the next rank (owner 2026-11-23). The game's own
        // green line under the name shows exactly that (its filled part), so it is measured, each time the game draws the XP numbers:
        // --kasp-lu-xp (0 to 1) on <html>. The line stays in the page, unseen (lobby_ui.css). Without a line (the top rank): full.
        if (event.animationName === 'kasp-lu-xp-seen' && event.target instanceof Element) {
            document.documentElement.style.setProperty('--kasp-lu-xp', String(rankProgress(event.target)));
            return;
        }
        if (event.animationName !== 'kasp-lu-stars-seen' || !(event.target instanceof Element)) return;
        // The same moment the game draws its lobby again (back from a battle, say): the mode row was hidden with it, which takes it back
        // to its first tile, and its arrows follow.
        rowEdges?.();
        const hit = STARS.exec(event.target.textContent ?? '');
        if (hit === null) return;
        document.documentElement.style.setProperty('--kasp-lu-pass', String(Math.min(100, Math.floor((Number(hit[1]) * 100) / 300))));
    }

    // The 8 modes (owner 2026-11-23, his idea 2, the one kept) in one row under PLAY, four seen at a time, gliding sideways under the mouse wheel
    // with the garage's own glide (showroom_glide.ts, the Augments, Skins and Shot colour lists: each notch adds its step to a goal and
    // every frame the row covers part of the way, the same feel at any frame rate; the same numbers, copied because that file runs in
    // the extension's own world and this one in the page's). Two arrows at the row's ends glide it one tile. The row is our own box:
    // its wheel listener is on it alone, and nothing runs while it is still.
    const EASE = 0.2;
    const LINE = 40;
    function rowGlide(row: HTMLElement): { by(delta: number): void; edges(): void } {
        let goal = 0;
        let position = 0;
        let frame = 0;
        let lastTime = 0;
        const end = (): number => Math.max(0, row.scrollWidth - row.clientWidth);
        // the marks that hide an arrow with nothing more on its side, and those of a side where a tile is cut by the row's edge, which
        // fades that side (lobby_ui.css); measured on the row's own 8 tiles, at each step of its scroll
        const edges = (): void => {
            row.toggleAttribute('data-at-start', row.scrollLeft <= 1);
            row.toggleAttribute('data-at-end', row.scrollLeft >= end() - 1);
            const box = row.getBoundingClientRect();
            let left = false;
            let right = false;
            for (const tile of row.children) {
                const r = tile.getBoundingClientRect();
                if (r.left < box.left - 1 && r.right > box.left + 1) left = true;
                if (r.left < box.right - 1 && r.right > box.right + 1) right = true;
            }
            row.toggleAttribute('data-cut-left', left);
            row.toggleAttribute('data-cut-right', right);
        };
        const step = (time: number): void => {
            frame = 0;
            const elapsed = lastTime ? Math.min(time - lastTime, 50) : 16.7;
            lastTime = time;
            position += (goal - position) * (1 - Math.pow(1 - EASE, elapsed / 16.7));
            if (Math.abs(goal - position) < 0.5) position = goal;
            row.scrollLeft = position;
            if (position !== goal) frame = requestAnimationFrame(step);
            else lastTime = 0;
        };
        const by = (delta: number): void => {
            // start from where the row really is
            if (!frame) position = goal = row.scrollLeft;
            goal = Math.max(0, Math.min(end(), goal + delta));
            if (!frame) frame = requestAnimationFrame(step);
        };
        row.addEventListener('wheel', (event) => {
            if (event.ctrlKey) return;
            const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? row.clientWidth : 1;
            const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            event.preventDefault();
            event.stopPropagation();
            by(delta * unit);
        }, { passive: false });
        row.addEventListener('scroll', edges, { passive: true });
        return { by, edges };
    }

    // The tiles: put on the page once; lobby_ui.css shows them only with the lobby's PLAY.
    function addTiles(): void {
        const box = document.createElement('div');
        box.className = 'kasp-modes';
        for (const key of KEYS) {
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'kasp-mode';
            tile.dataset.mode = key;
            tile.append(document.createElement('i'), document.createElement('span'));
            tile.addEventListener('click', () => void go(key));
            box.append(tile);
        }
        document.body.append(box);
        document.addEventListener('animationstart', onStars);
        box.setAttribute('data-at-start', '');
        const glide = rowGlide(box);
        for (const way of [-1, 1]) {
            const arrow = document.createElement('button');
            arrow.type = 'button';
            arrow.className = 'kasp-modes-arrow';
            arrow.dataset.way = String(way);
            arrow.addEventListener('click', () => {
                // one tile and the gap after it
                const tile = box.firstElementChild;
                const gap = parseFloat(getComputedStyle(box).columnGap) || 0;
                if (tile !== null) glide.by(way * (tile.getBoundingClientRect().width + gap));
            });
            document.body.append(arrow);
        }
        // for onStars: when the game draws its lobby again (back from a battle, say) the row is back at its first tile
        rowEdges = glide.edges;
    }
    let rowEdges: (() => void) | null = null;
    let on = true;
    try {
        on = localStorage.getItem('kasp_lobbyui') !== '0';
    } catch {
        // the switch's default: on
    }
    if (!on) return;
    document.documentElement.setAttribute('data-kasp-lobby-ui', '');
    if (document.body !== null) addTiles();
    else document.addEventListener('DOMContentLoaded', addTiles, { once: true });
})();
