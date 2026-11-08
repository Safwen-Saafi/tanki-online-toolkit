// TEST ONLY (chat translation test), rewritten before the feature is built. The injector posts each player's battle chat
// message (kasp:chat); the game's own chat line is left as it is. This asks Google for the English text and, when the
// message was in another language, shows it in a box of its own under the kill feed, in a copy of the game's chat line:
// rank picture, [clan] name in the sender's side colour, then "[RU->EN] text". A message with letters of another script
// than English shows three moving dots at once, until the translation comes. The box shows only in a running round, sits
// in the game's battle area, and starts empty in each battle.
(function () {
    'use strict';

    const LOG = '[KI-test][chat-test]';
    const TARGET = 'en';
    const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t';
    const TIMEOUT_MS = 4000;
    const TEXT_MAX = 1000;
    // Like the game's chat: up to 8 lines, all shown until 10 seconds after the last one, or while the chat input is open.
    const MAX_LINES = 8;
    const SHOW_MS = 10000;
    const CACHE_MAX = 200;
    const BOX_ID = 'kasp-chat-translations';
    // The game's chat colours: an ally's name, an enemy's name, and the text of a message to all.
    const ALLY_COLOUR = '#33bbff';
    const ENEMY_COLOUR = '#ff6666';
    const TEXT_COLOUR = '#ffffff';
    const PICTURE_HOST = /(^|\.)tankionline\.com$/;
    // A letter of another script than Latin: such a message is surely not English, so its dots show at once.
    const OTHER_SCRIPT = /(?!\p{Script=Latin})\p{L}/u;
    const CHAT_INPUT = '[class*="BattleChatComponentStyle-input"]';
    const BATTLE_SELECTOR = '.BattleComponentStyle-canvasContainer';

    const STYLE = `
#${BOX_ID} {
    position: fixed;
    top: 44vh;
    right: 2vw;
    width: 18vw;
    pointer-events: none;
    font: bold 15px/23px 'Open Sans', sans-serif;
    color: ${TEXT_COLOUR};
    text-shadow: 0 0 5px #000, 0 0 5px #000;
}
#${BOX_ID}[hidden], #${BOX_ID} [hidden] {
    display: none;
}
#${BOX_ID} .kasp-chat-line {
    position: relative;
    padding-left: 26px;
    text-align: left;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
#${BOX_ID} .kasp-chat-rank {
    position: absolute;
    left: 0;
    top: 0;
    width: 24px;
    height: 24px;
}
#${BOX_ID} .kasp-chat-dots i {
    display: inline-block;
    width: 5px;
    height: 5px;
    margin: 0 2px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 3px #000;
    vertical-align: middle;
    animation: kasp-chat-dot 1s ease-in-out infinite;
}
#${BOX_ID} .kasp-chat-dots i:nth-child(2) {
    animation-delay: 0.15s;
}
#${BOX_ID} .kasp-chat-dots i:nth-child(3) {
    animation-delay: 0.3s;
}
@keyframes kasp-chat-dot {
    0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-3px); }
}`;

    interface ChatMessage {
        readonly uid: string;
        readonly clanTag: string | null;
        readonly ally: boolean;
        readonly team: boolean;
        readonly rankPicture: string | null;
        readonly text: string;
    }

    interface Translation {
        readonly from: string;
        readonly text: string;
    }

    interface Line {
        readonly line: HTMLDivElement;
        readonly text: HTMLSpanElement;
    }

    function asPicture(value: unknown): string | null {
        if (typeof value !== 'string' || value.length > 300) return null;
        try {
            const url = new URL(value);
            return url.protocol === 'https:' && PICTURE_HOST.test(url.hostname) ? url.href : null;
        } catch {
            return null;
        }
    }

    function readMessage(data: unknown): ChatMessage | null {
        if (!data || typeof data !== 'object') return null;
        const record = data as Record<string, unknown>;
        if (record.type !== 'kasp:chat' || !record.detail || typeof record.detail !== 'object') return null;
        const d = record.detail as Record<string, unknown>;
        if (typeof d.uid !== 'string' || d.uid.length > 50) return null;
        if (d.clanTag !== null && (typeof d.clanTag !== 'string' || d.clanTag.length > 20)) return null;
        if (typeof d.ally !== 'boolean' || typeof d.team !== 'boolean') return null;
        if (typeof d.text !== 'string' || d.text.trim() === '' || d.text.length > TEXT_MAX) return null;
        return { uid: d.uid, clanTag: d.clanTag, ally: d.ally, team: d.team, rankPicture: asPicture(d.rankPicture), text: d.text };
    }

    // Google's answer, or null when the message is already in the target language or did not change.
    async function askGoogle(text: string): Promise<Translation | null> {
        const url = `${TRANSLATE_URL}&tl=${TARGET}&q=${encodeURIComponent(text)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed: unknown = await res.json();
        if (!Array.isArray(parsed) || !Array.isArray(parsed[0]) || typeof parsed[2] !== 'string') throw new Error('unexpected answer');
        const pieces: unknown[] = parsed[0];
        const translated = pieces.map((p) => (Array.isArray(p) && typeof p[0] === 'string' ? p[0] : '')).join('').trim();
        const from = parsed[2].toLowerCase();
        if (from === TARGET || translated === '' || translated.toLowerCase() === text.trim().toLowerCase()) return null;
        return { from, text: translated };
    }

    // The same text is asked once (chat spam repeats); a failed answer is forgotten so it can be asked again.
    const cache = new Map<string, Promise<Translation | null>>();

    function translate(text: string): Promise<Translation | null> {
        const known = cache.get(text);
        if (known !== undefined) return known;
        const asked = askGoogle(text);
        asked.catch(() => cache.delete(text));
        cache.set(text, asked);
        if (cache.size > CACHE_MAX) {
            const oldest = cache.keys().next();
            if (!oldest.done) cache.delete(oldest.value);
        }
        return asked;
    }

    let box: HTMLDivElement | null = null;
    let hideTimer = 0;
    let inputOpen = false;
    let lastChange = 0;
    // False while the game's round is not running: in the lobby, before the round starts and on the results screen
    // (kasp:battle-time). It stays true if that message never comes, so the box still works when that hook is lost.
    let roundRunning = true;
    let placeLogged = false;

    function addStyle(): void {
        if (document.getElementById(`${BOX_ID}-style`) !== null) return;
        const style = document.createElement('style');
        style.id = `${BOX_ID}-style`;
        style.textContent = STYLE;
        (document.head || document.documentElement).appendChild(style);
    }

    function describe(element: Element | null): string {
        if (element === null) return 'nothing';
        const style = getComputedStyle(element);
        return `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join('')} (position ${style.position}, z-index ${style.zIndex})`;
    }

    // The box sits right after the game's battle canvas, at the canvas's own z-index, so what the game shows over its canvas
    // (menus, the TAB table) should cover the box too, and the box goes away with the battle: a new battle area gets a new,
    // empty box. Null when no battle is on screen.
    function getBox(): HTMLDivElement | null {
        const battle = document.querySelector(BATTLE_SELECTOR);
        if (battle === null) return null;
        if (box !== null && box.isConnected && battle.contains(box)) return box;
        box?.remove();
        addStyle();
        const created = document.createElement('div');
        created.id = BOX_ID;
        created.hidden = true;
        const canvas = battle.querySelector('canvas');
        if (canvas !== null) {
            const z = getComputedStyle(canvas).zIndex;
            if (z !== 'auto') created.style.zIndex = z;
            canvas.after(created);
        } else {
            battle.appendChild(created);
        }
        if (!placeLogged) {
            placeLogged = true;
            console.log(`${LOG} box placed after ${describe(canvas)}, inside ${describe(created.parentElement)}, battle area ${describe(battle)}`);
        }
        box = created;
        return created;
    }

    // Shows the box while the round runs, a line is shown, and the chat input is open or the last change is less than SHOW_MS
    // old, as the game does with its chat. changed is true when a shown line was just added, filled or removed.
    function showBox(changed: boolean): void {
        if (changed) lastChange = Date.now();
        window.clearTimeout(hideTimer);
        if (box === null || !box.isConnected) return;
        const shown = box;
        const left = lastChange + SHOW_MS - Date.now();
        const hasLine = shown.querySelector('.kasp-chat-line:not([hidden])') !== null;
        shown.hidden = !roundRunning || !hasLine || (!inputOpen && left <= 0);
        if (!shown.hidden && !inputOpen) hideTimer = window.setTimeout(() => (shown.hidden = true), left);
    }

    // Keeps the last MAX_LINES lines that are shown (a line still waiting for its answer, hidden, does not count).
    function trimLines(target: HTMLDivElement): void {
        const shown = [...target.querySelectorAll<HTMLDivElement>('.kasp-chat-line:not([hidden])')];
        for (let k = 0; k < shown.length - MAX_LINES; k++) shown[k].remove();
    }

    function makeLine(message: ChatMessage): Line {
        const line = document.createElement('div');
        line.className = 'kasp-chat-line';
        const sideColour = message.ally ? ALLY_COLOUR : ENEMY_COLOUR;
        if (message.rankPicture !== null) {
            const rank = document.createElement('img');
            rank.className = 'kasp-chat-rank';
            rank.alt = '';
            rank.addEventListener('error', () => rank.remove());
            rank.src = message.rankPicture;
            line.appendChild(rank);
        }
        const name = document.createElement('span');
        name.style.color = sideColour;
        name.textContent = `${message.clanTag === null ? '' : `[${message.clanTag}] `}${message.uid}: `;
        const text = document.createElement('span');
        text.style.color = message.team ? sideColour : TEXT_COLOUR;
        line.append(name, text);
        return { line, text };
    }

    function dots(): HTMLSpanElement {
        const span = document.createElement('span');
        span.className = 'kasp-chat-dots';
        span.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
        return span;
    }

    function onMessage(message: ChatMessage): void {
        const target = getBox();
        if (target === null) return;
        // The line takes its place at once, so lines stay in the order the messages came; it is hidden until the answer
        // unless the message is surely in another language, then it shows its dots.
        const { line, text } = makeLine(message);
        const sure = OTHER_SCRIPT.test(message.text);
        line.hidden = !sure;
        if (sure) text.appendChild(dots());
        target.appendChild(line);
        if (sure) {
            trimLines(target);
            showBox(true);
        }
        translate(message.text)
            .then((result) => {
                // The battle may have ended, or the line been pushed out, while Google was answering.
                if (!line.isConnected) return;
                if (result === null) {
                    console.log(`${LOG} kept: "${message.text}"`);
                    line.remove();
                    showBox(sure);
                    return;
                }
                const mark = `[${result.from.toUpperCase()}->${TARGET.toUpperCase()}]`;
                console.log(`${LOG} translated: "${message.text}" -> ${mark} ${result.text}`);
                text.textContent = `${mark} ${result.text}`;
                line.hidden = false;
                trimLines(target);
                showBox(true);
            })
            .catch((e: unknown) => {
                console.warn(`${LOG} Google failed, no translation: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
                if (!line.isConnected) return;
                line.remove();
                showBox(sure);
            });
    }

    interface BattleTime {
        readonly remaining: number;
        readonly roundStarted: boolean;
        readonly battleLoaded: boolean;
    }

    function readBattleTime(data: unknown): BattleTime | null {
        if (!data || typeof data !== 'object') return null;
        const record = data as Record<string, unknown>;
        if (record.type !== 'kasp:battle-time' || !record.detail || typeof record.detail !== 'object') return null;
        const d = record.detail as Record<string, unknown>;
        if (typeof d.remaining !== 'number' || typeof d.roundStarted !== 'boolean' || typeof d.battleLoaded !== 'boolean') return null;
        return { remaining: d.remaining, roundStarted: d.roundStarted, battleLoaded: d.battleLoaded };
    }

    // The game says remaining -1 when the player joins a battle and battleLoaded false when the player leaves: both start
    // the box over, so a new battle never shows the last one's lines.
    function onBattleTime(time: BattleTime): void {
        if (!time.battleLoaded || time.remaining === -1) box?.replaceChildren();
        roundRunning = time.battleLoaded && time.roundStarted;
        showBox(false);
    }

    function isChatInput(target: EventTarget | null): boolean {
        return target instanceof HTMLInputElement && target.closest(CHAT_INPUT) !== null;
    }

    document.addEventListener(
        'focusin',
        (event: FocusEvent) => {
            if (!isChatInput(event.target)) return;
            inputOpen = true;
            showBox(false);
        },
        true,
    );
    document.addEventListener(
        'focusout',
        (event: FocusEvent) => {
            if (!isChatInput(event.target)) return;
            inputOpen = false;
            showBox(false);
        },
        true,
    );

    window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window) return;
        const message = readMessage(event.data);
        if (message !== null) {
            onMessage(message);
            return;
        }
        const time = readBattleTime(event.data);
        if (time !== null) onBattleTime(time);
    });

    console.log(`${LOG} test build loaded, translations show under the kill feed`);
})();
