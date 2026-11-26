// MAIN-world content script (build-plan 26d1): the lobby's 8 battle mode tiles, and the mark on <html> (data-kasp-lobby-ui) that lets
// lobby_ui.css move the game's own lobby parts to the right side in glass; both only with the "Lobby buttons" switch on (kasp_lobbyui,
// read once at start). Nothing here watches the page on a clock: the tiles are put on the page once, and the stylesheet (lobby_ui.css)
// alone shows them only while the game's lobby PLAY is on the page (never greyed: a click while the game searches does nothing), and
// gives each its icon (bundled in extension/lobby/) and its name in the game's language. The code runs on the player's clicks, wheel and
// keys, at the stylesheet's 1 ms marker animations, and, only while the chat or the friends list is open, on that list's own changes
// (one MutationObserver each, on that list alone; a closed list gets no changes, and its observer is replaced when the list is drawn
// again).
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
        jg: { data: ['TJR_ONLY', 'TJR'], titles: ['TEAM JUGGERNAUT', 'КОМАНДНЫЙ ДЖАГГЕРНАУТ'] },
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

    // Where a tile's way into its mode stopped, in the game's language (written on <html> by language.ts; English until it is there).
    const NOTES = {
        search: { EN: 'the game did not start the search', RU: 'игра не начала поиск' },
        quick: { EN: 'did not reach the Quick battle card', RU: 'не удалось открыть карточку быстрого боя' },
        modes: { EN: 'did not reach the Modes card', RU: 'не удалось открыть карточку режимов' },
        mode: { EN: 'did not reach the mode on the Modes screen', RU: 'не удалось найти режим на экране режимов' },
        wait: { EN: 'did not reach the matchmaking wait', RU: 'не удалось начать поиск боя' },
        error: { EN: 'stopped on an error', RU: 'остановлено из-за ошибки' },
    } as const;
    function modeNote(key: Key, why: keyof typeof NOTES): string {
        const ru = document.documentElement.getAttribute('data-kasp-language') === 'RU';
        return `${MODES[key].titles[ru ? 1 : 0]}: ${NOTES[why][ru ? 'RU' : 'EN']}`;
    }

    function showNote(text: string): void {
        note.textContent = text;
        document.body.append(note);
        window.setTimeout(() => note.remove(), 3000);
    }

    // A tile's way that stopped half way leaves no half-open screen (independent review 2026-11-26): while the game's screens are still
    // drawn unseen, its own back arrow is pressed until the lobby's PLAY is back, at most three screens deep; a search that started
    // after all is left as it is.
    const BACK = 'BreadcrumbsComponentStyle-backButton';
    async function backToLobby(): Promise<void> {
        for (let i = 0; i < 3 && document.getElementsByClassName(PLAY_BOX).length === 0; i++) {
            if (document.querySelector(WAIT_SELECTOR) !== null) return;
            const back = document.getElementsByClassName(BACK)[0];
            if (!(back instanceof HTMLElement)) return;
            press(back);
            await waitFor(() => document.getElementsByClassName(PLAY_BOX)[0] ?? null);
        }
    }

    let busy = false;
    async function go(key: Key): Promise<void> {
        const playBox = document.getElementsByClassName(PLAY_BOX)[0];
        if (busy || !(playBox instanceof HTMLElement) || document.getElementsByClassName(PLAY_OFF).length > 0) return;
        lastTile = { key, at: performance.now() };
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
            if (started) {
                busy = true;
                const searching = await waitFor(() => document.querySelector(WAIT_SELECTOR));
                busy = false;
                if (searching === null) showNote(modeNote(key, 'search'));
                return;
            }
        }
        busy = true;
        window.clearTimeout(calmTimer);
        document.documentElement.setAttribute(CALM_MARK, '');
        document.documentElement.setAttribute(TRIP_MARK, '');
        document.body.append(block);
        let failed: keyof typeof NOTES | null = null;
        try {
            press(playBox);
            if (key === 'qb') {
                const quick = await waitFor(() => find(MODES.qb));
                if (quick === null) failed = 'quick';
                else press(quick.card);
            } else {
                const modes = await waitFor(() => find(MODES_CARD));
                if (modes === null) failed = 'modes';
                else {
                    press(modes.card);
                    const mode = await waitFor(() => find(MODES[key]));
                    if (mode === null) failed = 'mode';
                    else press(mode.card);
                }
            }
            if (failed === null && (await waitFor(() => document.querySelector(WAIT_SELECTOR))) === null) failed = 'wait';
        } catch {
            failed = 'error';
        }
        // Stopped half way (a mode the game does not offer right now, say): back to the lobby first, still unseen, so no half-open
        // screen is left; then where it stopped, in plain words.
        if (failed !== null) {
            try {
                await backToLobby();
            } catch {
                // the game's screen stays as it is
            }
        }
        document.documentElement.removeAttribute(TRIP_MARK);
        block.remove();
        busy = false;
        calmTimer = window.setTimeout(() => document.documentElement.removeAttribute(CALM_MARK), CALM_AFTER_MS);
        if (failed !== null) showNote(modeNote(key, failed));
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

    // The chat's tanker faces (owner 2026-11-23, idea A of lobby-ideas/ui-chat.html): the game has no pictures of its players, so each
    // gets a small tanker head drawn from their name: helmet, skin, background, eyes, mouth, emblem and an extra (a headset, goggles or
    // cheeks) each picked by a hash of the name, so the same name always gives the same face. Made once per name, kept as an address.
    const HELMETS: readonly (readonly [string, string])[] = [['#6f8f2f', '#4f6a1f'], ['#c8a85a', '#9c8040'], ['#7c8894', '#5a646e'],
        ['#b8423a', '#8a2e28'], ['#3d6aa8', '#2b4c7c'], ['#d9a92a', '#a87e14'], ['#4c8a6e', '#326150'], ['#8a5ab0', '#653f85']];
    const SKINS = ['#f6c9a0', '#eab58c', '#d79a6e', '#b97a52', '#f2d3b8'];
    const BACKS = ['#17324a', '#1d3b2c', '#3a2a1a', '#2c1f3d', '#123a3e', '#3a1c22'];
    const EYES = [
        '<circle cx="25" cy="38" r="3" fill="#1b1b1b"/><circle cx="39" cy="38" r="3" fill="#1b1b1b"/><circle cx="26" cy="37" r="1" fill="#fff"/><circle cx="40" cy="37" r="1" fill="#fff"/>',
        '<path d="M21 38q4-5 8 0M35 38q4-5 8 0" stroke="#1b1b1b" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
        '<path d="M21 35l7 3M43 35l-7 3" stroke="#1b1b1b" stroke-width="2.6" stroke-linecap="round"/><circle cx="25" cy="39.5" r="2.4" fill="#1b1b1b"/><circle cx="39" cy="39.5" r="2.4" fill="#1b1b1b"/>',
        '<rect x="18" y="34" width="12" height="7" rx="3" fill="#111"/><rect x="34" y="34" width="12" height="7" rx="3" fill="#111"/><path d="M30 36h4" stroke="#111" stroke-width="2"/><path d="M20 36h5" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>',
        '<path d="M22 38h6M36 38h6" stroke="#1b1b1b" stroke-width="2.6" stroke-linecap="round"/>',
    ];
    const MOUTHS = [
        '<path d="M26 47q6 5 12 0" stroke="#5a2414" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
        '<path d="M25 46q7 9 14 0z" fill="#5a2414"/><path d="M27 47h10" stroke="#fff" stroke-width="2"/>',
        '<path d="M27 48h10" stroke="#5a2414" stroke-width="2.4" stroke-linecap="round"/>',
        '<ellipse cx="32" cy="48" rx="3" ry="3.6" fill="#5a2414"/>',
    ];
    const EXTRAS = [
        '',
        '<path d="M13 37q-1-4 2-6" stroke="#222" stroke-width="3" fill="none"/><rect x="9" y="34" width="6" height="10" rx="3" fill="#2a2a2a"/><path d="M12 44q2 7 12 6" stroke="#2a2a2a" stroke-width="2" fill="none"/><circle cx="24" cy="50" r="2" fill="#2a2a2a"/>',
        '<rect x="19" y="21" width="26" height="7" rx="3.5" fill="#2a2a2a"/><circle cx="26" cy="24.5" r="4" fill="#7fd6ff" stroke="#2a2a2a" stroke-width="1.6"/><circle cx="38" cy="24.5" r="4" fill="#7fd6ff" stroke="#2a2a2a" stroke-width="1.6"/>',
        '<circle cx="20" cy="44" r="3" fill="#ff7b7b" opacity=".45"/><circle cx="44" cy="44" r="3" fill="#ff7b7b" opacity=".45"/>',
    ];
    const EMBLEMS = [
        '<path d="M32 13l1.8 3.7 4 .5-3 2.8.8 4-3.6-2-3.6 2 .8-4-3-2.8 4-.5z" fill="#ffd84a"/>',
        '<circle cx="32" cy="18" r="3.4" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.8"/>',
        '<path d="M28 16h8M28 20h8" stroke="#fff" stroke-opacity=".6" stroke-width="1.8"/>',
    ];
    const faces = new Map<string, string>();

    function nameHash(name: string): number {
        let h = 2166136261;
        for (const c of name) {
            h ^= c.codePointAt(0) ?? 0;
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    function faceOf(name: string): string {
        const known = faces.get(name);
        if (known !== undefined) return known;
        const h = nameHash(name);
        const [helmet, rim] = HELMETS[h % HELMETS.length];
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            + `<rect width="64" height="64" fill="${BACKS[(h >>> 6) % BACKS.length]}"/>`
            + `<ellipse cx="32" cy="41" rx="17" ry="16" fill="${SKINS[(h >>> 3) % SKINS.length]}"/>`
            + `<path d="M12 33q0-23 20-23t20 23z" fill="${helmet}"/><path d="M10 31h44a3 3 0 0 1 0 6H10a3 3 0 0 1 0-6z" fill="${rim}"/>`
            + EMBLEMS[(h >>> 18) % EMBLEMS.length] + EYES[(h >>> 9) % EYES.length] + MOUTHS[(h >>> 12) % MOUTHS.length]
            + EXTRAS[(h >>> 15) % EXTRAS.length] + '</svg>';
        const url = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
        faces.set(name, url);
        return url;
    }

    // The chat's rows, marked for lobby_ui.css: who sent each, from the game's own label (its words are the clan tag, the name and a
    // separator after it; the clan tag is left out of the face, so a new clan keeps the face), whether it is the player's own (the game
    // makes every other name clickable, so the player's own has no hand pointer), whether it is to someone (a second label), and the
    // runs of one sender (rows next to each other in the list; a date line or a notice between them ends a run).
    // When (owner 2026-11-23: the bubbles flashed, and a channel switch stuttered): a row's own tiny animation woke the marking one
    // frame after the browser had drawn the row unmarked (on the left, no face, its name, the wrong gaps), and each row's cursor was
    // read right after the row before it was marked, so the browser worked out the chat's styles again once per row. Now the game's
    // list is watched while the chat is open (only its rows being added or taken off; the list's own tiny animation, once per opened
    // chat, starts the watch and the next one ends the old): the marks go on in the same moment the game adds the rows, before anything
    // is drawn, every new row read first and all marked after, so the styles are worked out once.
    const CHAT_ROW = 'ChatComponentStyle-messageRow';
    const CHAT_LABEL = 'ChatComponentStyle-chatUserLabel';
    let chatWatch: MutationObserver | null = null;

    function markChat(list: HTMLElement): void {
        // read: each new row's sender and whether it is the player's own
        const fresh: { row: HTMLElement; name: string; me: boolean; to: boolean }[] = [];
        for (const child of list.children) {
            if (!(child instanceof HTMLElement) || !child.classList.contains(CHAT_ROW) || child.dataset.kaspChatWho !== undefined) continue;
            const labels = child.getElementsByClassName(CHAT_LABEL);
            const first = labels[0];
            if (!(first instanceof HTMLElement)) continue;
            const name = (first.textContent ?? '').trim().replace(/[\s:\u2013\u2014]+$/u, '').replace(/^\[[^\]]*\]\s*/u, '');
            if (name === '') continue;
            fresh.push({ row: child, name, me: getComputedStyle(first).cursor !== 'pointer', to: labels.length > 1 });
        }
        // write: the marks, then the runs over the whole list
        for (const { row, name, me, to } of fresh) {
            row.dataset.kaspChatWho = me ? '\u0000me' : name;
            row.toggleAttribute('data-kasp-chat-me', me);
            row.toggleAttribute('data-kasp-chat-to', to);
            if (!me) row.style.setProperty('--kasp-face', faceOf(name));
        }
        let prev: HTMLElement | null = null;
        for (const child of list.children) {
            const row = child instanceof HTMLElement && child.classList.contains(CHAT_ROW) ? child : null;
            const who = row?.dataset.kaspChatWho;
            const same = row !== null && prev !== null && who !== undefined && who === prev.dataset.kaspChatWho;
            row?.toggleAttribute('data-kasp-chat-cont', same);
            prev?.toggleAttribute('data-kasp-chat-more', same);
            prev = row;
        }
        prev?.toggleAttribute('data-kasp-chat-more', false);
    }

    function watchChat(list: HTMLElement): void {
        chatWatch?.disconnect();
        chatWatch = new MutationObserver(() => {
            if (list.isConnected) markChat(list);
            else {
                chatWatch?.disconnect();
                chatWatch = null;
            }
        });
        chatWatch.observe(list, { childList: true });
        markChat(list);
    }

    // The friends' rows in the dock (owner 2026-11-25): the game writes an online friend's state as one line, "ONLINE" or
    // "ONLINE (IN GROUP)" in the game's language, in the same class either way, and the stylesheet shows only the group part. So each
    // row's line gets the word in its brackets as data-kasp-group (or none). The rows are marked when the list is drawn (the list's
    // 1 ms animation, lobby_ui.css) and again whenever the game changes the list or a row's words (a friend joins a group), only
    // while the list is on the page; our own attribute is not watched, so marking never wakes the watcher.
    let friendsWatch: MutationObserver | null = null;

    function markFriends(list: HTMLElement): void {
        for (const line of Array.from(list.getElementsByClassName('FriendListComponentStyle-greenTextOnline'))) {
            const group = /\(([^)]*)\)/.exec(line.textContent ?? '')?.[1]?.trim();
            if (group) {
                if (line.getAttribute('data-kasp-group') !== group) line.setAttribute('data-kasp-group', group);
            } else if (line.hasAttribute('data-kasp-group')) {
                line.removeAttribute('data-kasp-group');
            }
        }
    }

    function watchFriends(list: HTMLElement): void {
        friendsWatch?.disconnect();
        friendsWatch = new MutationObserver(() => {
            if (list.isConnected) markFriends(list);
            else {
                friendsWatch?.disconnect();
                friendsWatch = null;
            }
        });
        friendsWatch.observe(list, { childList: true, subtree: true, characterData: true });
        markFriends(list);
    }

    // The news list and the chat's messages glide under the mouse wheel like the garage's Augments, Skins and Shot colour lists (owner
    // 2026-11-23; showroom_glide.ts, the same numbers and the same way, copied: that file runs in the extension's own world and only
    // with the Showroom garage switch). A notch adds its step to a goal and every frame the list covers part of the way, the same feel
    // at any frame rate. The browser's own step is stopped, which needs a listener that is not passive, so it goes on each list box
    // only, the first time the mouse comes over it; nothing runs while a list is still. A press on a list (the scroll bar, a drag)
    // stops the glide; so does any other move of the list meanwhile (the game's jump to a new message at the chat's foot), so that
    // move wins.
    // Not the friends list (owner 2026-11-25: its scrolling felt heavy): the glide moves a list on the page's main thread, the one the
    // lobby's 3D hangar keeps busy every frame, so its steps came late; the browser's own scrolling, smooth by itself and run apart
    // from that thread, is left to it.
    const DOCK_LISTS = '.NewsComponentStyle-newsContainer, .ChatComponentStyle-messagesContainer';
    const hookedDockLists = new WeakSet<Element>();
    let listBox: HTMLElement | null = null;
    let listGoal = 0;
    let listPosition = 0;
    let listSet = 0;
    let listFrame = 0;
    let listTime = 0;

    function listStop(): void {
        if (listFrame) cancelAnimationFrame(listFrame);
        listFrame = 0;
        listTime = 0;
    }

    function listStep(time: number): void {
        listFrame = 0;
        if (listBox === null || !listBox.isConnected || Math.abs(listBox.scrollTop - listSet) > 1) {
            listTime = 0;
            return;
        }
        const elapsed = listTime ? Math.min(time - listTime, 50) : 16.7;
        listTime = time;
        listPosition += (listGoal - listPosition) * (1 - Math.pow(1 - EASE, elapsed / 16.7));
        if (Math.abs(listGoal - listPosition) < 0.5) listPosition = listGoal;
        listBox.scrollTop = listPosition;
        listSet = listBox.scrollTop;
        if (listPosition !== listGoal) listFrame = requestAnimationFrame(listStep);
        else listTime = 0;
    }

    function onDockListWheel(event: WheelEvent): void {
        const list = event.currentTarget;
        if (event.ctrlKey || !(list instanceof HTMLElement) || list.scrollHeight <= list.clientHeight + 1) return;
        event.preventDefault();
        const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? list.clientHeight : 1;
        // start from where the list really is (after the scroll bar, a drag or the game's jump)
        if (list !== listBox || !listFrame) {
            listBox = list;
            listPosition = listGoal = listSet = list.scrollTop;
        }
        listGoal = Math.max(0, Math.min(list.scrollHeight - list.clientHeight, listGoal + event.deltaY * unit));
        if (!listFrame) listFrame = requestAnimationFrame(listStep);
    }

    function onDockListOver(event: PointerEvent): void {
        const list = event.target instanceof Element ? event.target.closest(DOCK_LISTS) : null;
        if (list !== null && !hookedDockLists.has(list)) {
            hookedDockLists.add(list);
            list.addEventListener('wheel', onDockListWheel as EventListener, { passive: false });
        }
    }

    function onDockListPress(event: PointerEvent): void {
        if (listFrame && event.target instanceof Element && event.target.closest(DOCK_LISTS)) listStop();
    }

    // The battle search capsule (26d step 8, owner 2026-11-24): centred between the back arrow and the rubies and crystals column of the
    // top bar. Everything in that span is a fixed size of the stylesheet except the column's width, which grows with the numbers, so it
    // is measured here, in em, into --kasp-tb-money-w on <html>. When: only at a tiny animation's start, of the column itself (each time
    // a screen's bar is drawn) and of the search box (its card or capsule appearing, leaving the lobby included), so nothing runs between.
    // The lobby's column is the same as the other bars' (the same pieces and sizes, probe 9: 160.1 px both), so measured in the lobby it
    // already gives the next screen's place, shown on the loading screen in between.
    const MONEY = '.BreadcrumbsComponentStyle-rightButtonsContainer > div:has(> .HeaderCommonStyle-icons):not(.UserScoreComponentStyle-coinsContainer), .UserScoreComponentStyle-blockRightPanel > div:has(.HeaderCommonStyle-icons)';
    const MONEY_MOMENTS = new Set(['kasp-lu-money-seen', 'kasp-search-card-in', 'kasp-search-pill-in']);

    function measureMoney(): void {
        const column = document.querySelector(MONEY);
        if (column === null) return;
        const width = column.getBoundingClientRect().width;
        const em = parseFloat(getComputedStyle(document.documentElement).fontSize);
        if (width > 0 && em > 0) document.documentElement.style.setProperty('--kasp-tb-money-w', `${(width / em).toFixed(3)}em`);
    }

    // The searched mode, named on <html> for the card's big faded icon (data-kasp-search-mode, lobby_ui.css), each time the search
    // card or capsule appears: by the game's own data on the search box, else by its written name (the longest of our titles in it,
    // so SOLO JUGGERNAUT is the juggernaut), else the tile clicked last, if it was clicked just before. None found: no icon.
    const SEARCH_MODE = 'data-kasp-search-mode';
    const TILE_MS = 15000;
    let lastTile: { readonly key: Key; readonly at: number } | null = null;
    function markMode(box: Element): void {
        const names = dataNames(box);
        let key = KEYS.find((k) => MODES[k].data.some((n) => names.has(n)));
        if (key === undefined) {
            const label = (box.getElementsByClassName('MatchmakingWaitComponentStyle-battleModeLabel')[0]?.textContent ?? '').toUpperCase();
            let best = 0;
            for (const k of KEYS) {
                for (const title of MODES[k].titles) {
                    if (title.length > best && label.includes(title)) {
                        key = k;
                        best = title.length;
                    }
                }
            }
        }
        if (key === undefined && lastTile !== null && performance.now() - lastTile.at < TILE_MS) key = lastTile.key;
        if (key === undefined) document.documentElement.removeAttribute(SEARCH_MODE);
        else document.documentElement.setAttribute(SEARCH_MODE, key);
    }

    function onStars(event: AnimationEvent): void {
        if (MONEY_MOMENTS.has(event.animationName)) {
            measureMoney();
            if (event.animationName !== 'kasp-lu-money-seen' && event.target instanceof Element) markMode(event.target);
            return;
        }
        if (event.animationName === 'kasp-chat-list-seen' && event.target instanceof HTMLElement) {
            watchChat(event.target);
            return;
        }
        if (event.animationName === 'kasp-friends-list-seen' && event.target instanceof HTMLElement) {
            watchFriends(event.target);
            return;
        }
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

    // The news and the chat share one dock over the bottom left bar (26d3, owner 2026-11-23; lobby_ui.css places and dresses the game's
    // own two windows). The game has nothing that goes from one to the other: its sheet round the open one takes every press off it, so
    // the other's footer button needs a second press. Two tabs of ours sit on the dock's top (the stylesheet shows them only while one
    // is open and lights the open one). A press on the other tab presses the game's own footer button of the other, then closes the
    // open one the way a press off it does (its own close sheet); both are the game's plain click handlers, read from its code. The new
    // one comes first, so the dock is never empty; the swap mark makes it stand in place at once with only its insides fading in.
    // Friends is the third (owner 2026-11-25): not a window but one of the game's screens, drawn over the lobby since src/injector.ts
    // patchFriendsOverLobby (the lobby and its 3D hangar stay). Its box is the game's -container holding the garage's tab bar and the
    // friends list or the requests; it has no close sheet, so it is closed through its own back button (its top bar is hidden by
    // the stylesheet, a press on the hidden button still runs the game's handler), and a press off it is caught below.
    const FRIENDS_BOX = '.-container:has(> .GarageMenuComponentStyle-garageMenuContainer):has([class*="FriendListComponentStyle-"], [class*="FriendRequestComponentStyle-"])';
    const DOCK = {
        news: { window: 'NewsComponentStyle-newsWindow', close: 'NewsComponentStyle-closeArea', button: 'FooterComponentStyle-newsButton' },
        chat: { window: 'ChatComponentStyle-chatWindow', close: 'ChatComponentStyle-closeArea', button: 'FooterComponentStyle-chatButton' },
        friends: { window: '', close: '', button: 'FooterComponentStyle-friendButton' },
    } as const;
    type DockKey = keyof typeof DOCK;
    const DOCK_KEYS = Object.keys(DOCK) as DockKey[];
    const SWAP_MARK = 'data-kasp-dock-swap';
    const SWAP_MS = 600;
    let swapTimer = 0;
    // our own presses on the game's close sheets, let through by the closing below
    let passing = false;

    // The garage's tab bar is on the page only with the friends screen or the garage open: without it the page-wide :has() search is
    // skipped (audit 2026-11-26: it ran on every click, every mouse shot in a battle included).
    const tabBars = document.getElementsByClassName('GarageMenuComponentStyle-garageMenuContainer');
    // ... and only over the lobby (its PLAY on the page): the clan page has the same tab bar and the friends screens' classes, and a
    // press there was taken for a press off the friends dock (owner 2026-11-26, the dock tabs showed on the clan page)
    const playBoxes = document.getElementsByClassName(PLAY_BOX);
    const friendsBox = (): Element | null => (tabBars.length === 0 || playBoxes.length === 0 ? null : document.querySelector(FRIENDS_BOX));
    const isOpen = (key: DockKey): boolean => (key === 'friends' ? friendsBox() !== null : document.getElementsByClassName(DOCK[key].window).length > 0);
    // what closes it: the close sheet, or for friends its back button
    function closerOf(key: DockKey): HTMLElement | null {
        const el = key === 'friends' ? friendsBox()?.querySelector('.BreadcrumbsComponentStyle-backButton') : document.getElementsByClassName(DOCK[key].close)[0];
        return el instanceof HTMLElement ? el : null;
    }

    function passClick(el: HTMLElement): void {
        passing = true;
        try {
            el.click();
        } finally {
            passing = false;
        }
    }

    function swapTo(key: DockKey): void {
        if (closing !== null || isOpen(key)) return;
        const open = DOCK_KEYS.find((k) => k !== key && isOpen(k));
        const close = open === undefined ? null : closerOf(open);
        const button = document.getElementsByClassName(DOCK[key].button)[0];
        if (close === null || !(button instanceof HTMLElement)) return;
        window.clearTimeout(swapTimer);
        document.documentElement.setAttribute(SWAP_MARK, '');
        swapTimer = window.setTimeout(() => document.documentElement.removeAttribute(SWAP_MARK), SWAP_MS);
        passClick(button);
        passClick(close);
    }

    // The closing animation (owner 2026-11-23: it only had one for opening). The game takes a window off the page the moment it closes,
    // so the two ways the player closes one are held back for the animation's length, then let through: a press on its close sheet (a
    // press anywhere off the dock) and Esc (the game's back key, which calls the same close). Both listeners only look whether the
    // event is one of those two while a dock window is open, and return at once otherwise. The mark stays until the game has taken the
    // window off (checked each frame, at most a second): taken off sooner, the window would play its opening again for a moment.
    const CLOSING_MARK = 'data-kasp-dock-closing';
    // the prototype's closing length (lobby_ui.css)
    const CLOSE_MS = 500;
    const GONE_WAIT_MS = 1000;
    let closing: DockKey | null = null;

    function closeAnimated(key: DockKey, sheet: HTMLElement): void {
        closing = key;
        window.clearTimeout(swapTimer);
        document.documentElement.removeAttribute(SWAP_MARK);
        document.documentElement.setAttribute(CLOSING_MARK, '');
        window.setTimeout(() => {
            passClick(sheet);
            const end = performance.now() + GONE_WAIT_MS;
            const done = (): void => {
                if (isOpen(key) && performance.now() < end) {
                    requestAnimationFrame(done);
                    return;
                }
                document.documentElement.removeAttribute(CLOSING_MARK);
                closing = null;
            };
            requestAnimationFrame(done);
        }, CLOSE_MS);
    }

    function onDockClick(event: MouseEvent): void {
        if (passing || !(event.target instanceof Element)) return;
        const target = event.target;
        const key = DOCK_KEYS.find((k) => k !== 'friends' && target.classList.contains(DOCK[k].close));
        if (key !== undefined) {
            event.stopImmediatePropagation();
            event.preventDefault();
            if (closing === null && target instanceof HTMLElement) closeAnimated(key, target);
            return;
        }
        // friends has no close sheet: a press off it (not in its box, not on our tabs, not in a pop-up of the game) closes it the same
        // way and goes no further, as the news' and chat's sheets take every press off them
        const box = friendsBox();
        if (box === null || box.contains(target) || target.closest('.kasp-dock-tabs, #modal-root') !== null) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        const back = closerOf('friends');
        if (closing === null && back !== null) closeAnimated('friends', back);
    }

    function onDockKey(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || passing) return;
        // the chat lies over the news (the game's layers), so it is the one Esc closes first
        const key = (['chat', 'news', 'friends'] as const).find(isOpen);
        if (key === undefined) return;
        const sheet = closerOf(key);
        if (sheet === null) return;
        event.stopImmediatePropagation();
        event.preventDefault();
        if (closing === null) closeAnimated(key, sheet);
    }

    function addDockTabs(): void {
        const tabs = document.createElement('div');
        tabs.className = 'kasp-dock-tabs';
        for (const name of DOCK_KEYS) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'kasp-dock-tab';
            tab.dataset.tab = name;
            tab.addEventListener('click', () => swapTo(name));
            tabs.append(tab);
        }
        document.body.append(tabs);
    }

    let on = true;
    try {
        on = localStorage.getItem('kasp_lobbyui') !== '0';
    } catch {
        // the switch's default: on
    }
    if (!on) return;
    document.documentElement.setAttribute('data-kasp-lobby-ui', '');
    // in the capture phase on the page's top, so they come before the game's own (its click handling sits lower, on its root; its keys
    // are added after this script)
    document.addEventListener('click', onDockClick, true);
    window.addEventListener('keydown', onDockKey, true);
    // the news and chat lists' glide: hooked on each list the first time the mouse comes over it; a press on a list stops its glide
    window.addEventListener('pointerover', onDockListOver, { capture: true, passive: true });
    window.addEventListener('pointerdown', onDockListPress, { capture: true, passive: true });
    const addOurs = (): void => {
        addTiles();
        addDockTabs();
    };
    if (document.body !== null) addOurs();
    else document.addEventListener('DOMContentLoaded', addOurs, { once: true });
})();
