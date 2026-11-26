// Isolated-world content script for the chat translation (build-plan 19, see blueprint/context/chat-translation.md). The
// injector posts each player's battle chat message (kasp:chat); the game's own chat line is left as it is. This asks Google
// (its free translate address, no key) for the text in the language chosen in
// the extension's settings tab (English by default) and, when the message was in another language, shows it in a box of its
// own under the kill feed, in a copy of the game's chat line: rank picture, [clan] name in the sender's side colour, then
// "[RU->EN] text". A message with letters of another script than the chosen language's shows three moving dots at once,
// until the translation comes. The box shows only in a running round, sits in the game's battle area, and starts empty in
// each battle. The settings tab's switch turns it all off at once: nothing is sent to Google while it is off. The player's own
// messages are not shown in the box.
// The player's own messages: while the game's chat box is open, three buttons beside it (or Alt+1, Alt+2, Alt+3) put the
// typed text into the language chosen for that button, in the chat box itself; the game sends whatever is in the box when the
// player presses Enter, as always. The same button again gives the typed text back. Only the text of a pressed button goes to
// Google. A translation longer than the game's limit, or a failed one, leaves the text as typed and the button flashes red.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_chattranslate';
    const LANGUAGE_KEY = 'kasp_chatlanguage';
    // The default languages (this one and BUTTON_DEFAULTS) are also each dropdown's fallback in CHOICES in settings_tab.ts:
    // choosing a default saves no key, so this copy decides what happens. Change both together.
    const DEFAULT_TARGET = 'en';
    // A Google language code, such as en or zh-CN; a saved value of another shape is ignored.
    const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
    const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t';
    const TIMEOUT_MS = 4000;
    const TEXT_MAX = 1000;
    // Like the game's chat: up to 8 lines, all shown until 10 seconds after the last one, or while the chat input is open.
    const MAX_LINES = 8;
    const SHOW_MS = 10000;
    const CACHE_MAX = 200;
    // The box and the buttons get their look from extension/styles/chat_translation.css, by these ids.
    const BOX_ID = 'kasp-chat-translations';
    // The game's chat colours: an ally's name, an enemy's name, and the text of a message to all.
    const ALLY_COLOUR = '#33bbff';
    const ENEMY_COLOUR = '#ff6666';
    const TEXT_COLOUR = '#ffffff';
    const PICTURE_HOST = /(^|\.)tankionline\.com$/;
    // The letters of a target language's own script: a message with any other letter is surely in another language, so its
    // dots show at once. Latin for every target not named here.
    const SCRIPTS: Readonly<Record<string, RegExp>> = {
        ru: /\p{Script=Cyrillic}/u,
        uk: /\p{Script=Cyrillic}/u,
        bg: /\p{Script=Cyrillic}/u,
        ar: /\p{Script=Arabic}/u,
        'zh-CN': /\p{Script=Han}/u,
        ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
        ko: /[\p{Script=Hangul}\p{Script=Han}]/u,
    };
    const LATIN = /\p{Script=Latin}/u;
    const LETTERS = /\p{L}/gu;
    const CHAT_INPUT = '[class*="BattleChatComponentStyle-input"]';
    const BATTLE_SELECTOR = '.BattleComponentStyle-canvasContainer';
    // The game's chat row (the chat box and the button after it), and the bordered box around the text field.
    const CHAT_ROW = '.BattleChatComponentStyle-container';
    const CHAT_FIELD_BOX = '[class*="BattleChatComponentStyle-inputContainer"]';
    const BUTTONS_KEY = 'kasp_chatbuttons';
    // The settings tab's dropdown for each button, and the language it has when nothing is saved.
    const BUTTON_KEYS = ['kasp_chatbutton1', 'kasp_chatbutton2', 'kasp_chatbutton3'] as const;
    const BUTTON_DEFAULTS = ['ru', 'en', 'pt'] as const;
    const BUTTONS_ID = 'kasp-chat-buttons';
    // The game's own limit (its chat code): a longer message is not sent, and its text turns red in the chat box.
    const SEND_MAX = 170;
    const FAIL_MS = 1500;

    // The two messages this module reads, in their shared shapes from src/types.d.ts, so a renamed field breaks the build here
    // instead of making the module drop every message.
    type ChatMessage = KaspChatMessage['detail'];
    type BattleTime = KaspBattleTimeMessage['detail'];

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
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:chat') return null;
        const detail = (data as { detail?: unknown }).detail;
        if (!detail || typeof detail !== 'object') return null;
        const d = detail as Partial<Record<keyof ChatMessage, unknown>>;
        if (typeof d.uid !== 'string' || d.uid.length > 50) return null;
        if (d.clanTag !== null && (typeof d.clanTag !== 'string' || d.clanTag.length > 20)) return null;
        if (typeof d.ally !== 'boolean' || typeof d.own !== 'boolean' || typeof d.team !== 'boolean') return null;
        if (typeof d.text !== 'string' || d.text.trim() === '' || d.text.length > TEXT_MAX) return null;
        return { uid: d.uid, clanTag: d.clanTag, ally: d.ally, own: d.own, team: d.team, rankPicture: asPicture(d.rankPicture), text: d.text };
    }

    function surelyForeign(text: string, to: string): boolean {
        const own = SCRIPTS[to] ?? LATIN;
        for (const letter of text.matchAll(LETTERS)) if (!own.test(letter[0])) return true;
        return false;
    }

    // The code as the line's mark shows it: EN, or ZH for zh-CN.
    function short(code: string): string {
        return code.split('-')[0].toUpperCase();
    }

    // Google's answer, or null when the message is already in the target language or did not change.
    async function askGoogle(text: string, to: string): Promise<Translation | null> {
        const url = `${TRANSLATE_URL}&tl=${encodeURIComponent(to)}&q=${encodeURIComponent(text)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed: unknown = await res.json();
        if (!Array.isArray(parsed) || !Array.isArray(parsed[0]) || typeof parsed[2] !== 'string') throw new Error('unexpected answer');
        const pieces: unknown[] = parsed[0];
        const translated = pieces.map((p) => (Array.isArray(p) && typeof p[0] === 'string' ? p[0] : '')).join('').trim();
        const from = parsed[2].toLowerCase();
        if (from === to.toLowerCase() || translated === '' || translated.toLowerCase() === text.trim().toLowerCase()) return null;
        return { from, text: translated };
    }

    // The same text is asked once per target language (chat spam repeats); a failed answer is forgotten so it can be asked again.
    const cache = new Map<string, Promise<Translation | null>>();

    function translate(text: string, to: string): Promise<Translation | null> {
        const key = `${to}\n${text}`;
        const known = cache.get(key);
        if (known !== undefined) return known;
        const asked = askGoogle(text, to);
        asked.catch(() => cache.delete(key));
        cache.set(key, asked);
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

    // The box sits right after the game's battle canvas, at the canvas's own z-index, so what the game shows over its canvas
    // (menus, the TAB table) should cover the box too, and the box goes away with the battle: a new battle area gets a new,
    // empty box. Null when no battle is on screen.
    function getBox(): HTMLDivElement | null {
        const battle = document.querySelector(BATTLE_SELECTOR);
        if (battle === null) return null;
        if (box !== null && box.isConnected && battle.contains(box)) return box;
        box?.remove();
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

    // A language chosen in the settings tab (a saved Google code), or the fallback when nothing valid is saved.
    function readCode(value: string | null, fallback: string): string {
        return value !== null && LANGUAGE_CODE.test(value) ? value : fallback;
    }

    // The settings tab's switch and dropdown, read through the switch service; both apply at once.
    let enabled = window.kaspSwitches?.isOn(SWITCH_KEY) ?? true;
    let language = readCode(window.kaspSwitches?.getChoice(LANGUAGE_KEY) ?? null, DEFAULT_TARGET);

    function onMessage(message: ChatMessage): void {
        if (!enabled || message.own) return;
        const target = getBox();
        if (target === null) return;
        const to = language;
        // The line takes its place at once, so lines stay in the order the messages came; it is hidden until the answer
        // unless the message is surely in another language, then it shows its dots.
        const { line, text } = makeLine(message);
        const sure = surelyForeign(message.text, to);
        line.hidden = !sure;
        if (sure) text.appendChild(dots());
        target.appendChild(line);
        if (sure) {
            trimLines(target);
            showBox(true);
        }
        translate(message.text, to)
            .then((result) => {
                // The battle may have ended, or the line been pushed out, while Google was answering.
                if (!line.isConnected) return;
                // null: already in the chosen language, or Google gave the same text back, so there is nothing to show.
                if (result === null) {
                    line.remove();
                    showBox(sure);
                    return;
                }
                text.textContent = `[${short(result.from)}->${short(to)}] ${result.text}`;
                line.hidden = false;
                trimLines(target);
                showBox(true);
            })
            .catch(() => {
                // Google failed or took too long: the message stays untranslated.
                if (!line.isConnected) return;
                line.remove();
                showBox(sure);
            });
    }

    function readBattleTime(data: unknown): BattleTime | null {
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:battle-time') return null;
        const detail = (data as { detail?: unknown }).detail;
        if (!detail || typeof detail !== 'object') return null;
        const d = detail as Partial<Record<keyof BattleTime, unknown>>;
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

    // The translation buttons beside the game's chat box, for the player's own messages.
    interface Translated {
        readonly original: string;
        readonly translated: string;
        readonly button: number;
    }

    let buttonsOn = window.kaspSwitches?.isOn(BUTTONS_KEY) ?? true;
    const buttonLanguages: string[] = BUTTON_KEYS.map((key, index) => readCode(window.kaspSwitches?.getChoice(key) ?? null, BUTTON_DEFAULTS[index]));
    let bar: HTMLDivElement | null = null;
    let field: HTMLInputElement | null = null;
    // The last translation a button put in the chat box; it counts while the box still shows it.
    let done: Translated | null = null;
    // The button waiting for Google, and the number of the last question, so an old answer is dropped.
    let waiting: number | null = null;
    let question = 0;
    // True while this script changes the chat box itself, so the change is not taken for the player's typing.
    let putting = false;
    const failTimers = [0, 0, 0];

    // Puts the text in the game's chat box the way the game reads it: the game sends the box's value when Enter is pressed
    // (proven 2026-11-08: the text put in was sent exactly as it was, and the box kept the focus).
    function put(input: HTMLInputElement, text: string): void {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        putting = true;
        try {
            if (setter === undefined) input.value = text;
            else setter.call(input, text);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        } finally {
            putting = false;
        }
        input.setSelectionRange(text.length, text.length);
    }

    function paint(): void {
        if (bar === null) return;
        Array.from(bar.children).forEach((button, index) => {
            button.classList.toggle('kasp-waiting', waiting === index);
            button.classList.toggle('kasp-active', done !== null && done.button === index && field !== null && field.value === done.translated);
        });
    }

    function fail(index: number): void {
        const button = bar?.children[index];
        if (button === undefined) return;
        button.classList.add('kasp-failed');
        window.clearTimeout(failTimers[index]);
        failTimers[index] = window.setTimeout(() => button.classList.remove('kasp-failed'), FAIL_MS);
    }

    function press(index: number): void {
        const input = field;
        if (input === null || !input.isConnected || waiting !== null) return;
        const showing = input.value;
        const last = done !== null && showing === done.translated ? done : null;
        // The same button again, on its own translation, gives the typed text back.
        if (last !== null && last.button === index) {
            put(input, last.original);
            done = null;
            paint();
            return;
        }
        // Another button, on a translation, translates the typed text, not the translation.
        const original = last !== null ? last.original : showing;
        if (original.trim() === '') return;
        const to = buttonLanguages[index];
        const asked = ++question;
        waiting = index;
        paint();
        translate(original, to)
            .then((result) => {
                if (asked !== question) return;
                waiting = null;
                // The chat closed, or its text changed, while Google was answering: the answer is dropped.
                if (field !== input || input.value !== showing) {
                    paint();
                    return;
                }
                // null: the typed text is already in that language, so it is the text that goes.
                const text = result === null ? original : result.text;
                // Longer than the game's limit: the game would not send it, so the typed text stays.
                if (text.length > SEND_MAX) {
                    paint();
                    fail(index);
                    return;
                }
                put(input, text);
                done = { original, translated: text, button: index };
                paint();
            })
            .catch(() => {
                // Google failed or took too long: the typed text stays.
                if (asked !== question) return;
                waiting = null;
                paint();
                fail(index);
            });
    }

    function makeButton(index: number): HTMLDivElement {
        const code = buttonLanguages[index];
        const button = document.createElement('div');
        button.className = 'kasp-chat-button';
        button.title = `Alt+${index + 1}`;
        const top = document.createElement('div');
        top.className = 'kasp-chat-button-top';
        const flag = document.createElement('img');
        flag.alt = '';
        flag.addEventListener('error', () => flag.remove());
        flag.src = chrome.runtime.getURL(`flags/${code}.webp`);
        const name = document.createElement('span');
        name.className = 'kasp-chat-button-code';
        name.textContent = short(code);
        top.append(flag, name, dots());
        const key = document.createElement('span');
        key.className = 'kasp-chat-button-key';
        key.textContent = `Alt+${index + 1}`;
        button.append(top, key);
        // The button never takes the focus, so the chat stays open, and the game never sees the press.
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup'] as const) {
            button.addEventListener(type, (event) => {
                event.preventDefault();
                event.stopPropagation();
            });
        }
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            press(index);
        });
        return button;
    }

    // Right after the game's chat row (its chat box and the button after it), as tall as the chat box and level with it.
    function place(): void {
        if (bar === null || field === null) return;
        const row = (field.closest(CHAT_ROW) ?? field).getBoundingClientRect();
        const fieldBox = (field.closest(CHAT_FIELD_BOX) ?? field).getBoundingClientRect();
        bar.style.left = `calc(${row.right}px + 0.6rem)`;
        bar.style.top = `${fieldBox.top}px`;
        bar.style.height = `${fieldBox.height}px`;
    }

    function showButtons(input: HTMLInputElement): void {
        field = input;
        done = null;
        bar?.remove();
        bar = null;
        if (!buttonsOn) return;
        bar = document.createElement('div');
        bar.id = BUTTONS_ID;
        bar.append(...BUTTON_KEYS.map((_key, index) => makeButton(index)));
        document.body.appendChild(bar);
        place();
        paint();
    }

    function hideButtons(): void {
        bar?.remove();
        bar = null;
        field = null;
        done = null;
        waiting = null;
        question++;
    }

    function isChatInput(target: EventTarget | null): target is HTMLInputElement {
        return target instanceof HTMLInputElement && target.closest(CHAT_INPUT) !== null;
    }

    document.addEventListener(
        'focusin',
        (event: FocusEvent) => {
            if (!isChatInput(event.target)) return;
            inputOpen = true;
            showBox(false);
            showButtons(event.target);
        },
        true,
    );
    document.addEventListener(
        'focusout',
        (event: FocusEvent) => {
            if (!isChatInput(event.target)) return;
            inputOpen = false;
            showBox(false);
            hideButtons();
        },
        true,
    );
    // The player typing: a question still waiting is dropped, and a button's translation stops counting once the text changes.
    document.addEventListener(
        'input',
        (event: Event) => {
            if (putting || event.target !== field) return;
            if (waiting !== null) {
                waiting = null;
                question++;
            }
            paint();
        },
        true,
    );
    // Alt+1, Alt+2, Alt+3 press the buttons while the chat box is open (the game does nothing with them there, proven
    // 2026-11-08). With the buttons off, the keys go to the game as always.
    window.addEventListener(
        'keydown',
        (event: KeyboardEvent) => {
            if (bar === null || field === null || document.activeElement !== field || !event.altKey) return;
            const index = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code);
            if (index < 0) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            press(index);
        },
        true,
    );
    window.addEventListener('resize', place);

    window.kaspMessages?.on('kasp:chat', (data) => {
        const message = readMessage(data);
        if (message !== null) onMessage(message);
    });
    window.kaspMessages?.on('kasp:battle-time', (data) => {
        const time = readBattleTime(data);
        if (time !== null) onBattleTime(time);
    });

    // Off empties the box at once; a new language applies from the next message, and the lines already shown stay.
    window.kaspSwitches?.onChange(SWITCH_KEY, (on) => {
        enabled = on;
        if (!on) box?.replaceChildren();
        showBox(false);
    });
    window.kaspSwitches?.onChoice(LANGUAGE_KEY, (value) => {
        language = readCode(value, DEFAULT_TARGET);
    });
    // Settings and the chat box are never open together, so a change shows the next time the chat opens.
    window.kaspSwitches?.onChange(BUTTONS_KEY, (on) => {
        buttonsOn = on;
        if (!on) {
            bar?.remove();
            bar = null;
        }
    });
    BUTTON_KEYS.forEach((key, index) => {
        window.kaspSwitches?.onChoice(key, (value) => {
            buttonLanguages[index] = readCode(value, BUTTON_DEFAULTS[index]);
        });
    });
})();
