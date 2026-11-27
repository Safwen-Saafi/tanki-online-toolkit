// Isolated-world content script for the chat translation (build-plan 19, reworked by 28, see blueprint/context/chat-translation.md).
// Other players' messages: the injector posts each one (kasp:chat) while Translate chat is on; this asks Google (its free
// translate address, no key) for the text in the language chosen in the extension's settings tab (English by default) and
// answers by number (kasp:chat-answer). The injector writes the translation into the game's own chat line as "[RU] text" and
// the game redraws its chat. The ` key, in a battle and while nothing is being typed, switches every line between the original
// and the translation; the choice is kept for the next battles. The settings (the switch, the language and that choice) go to
// the injector at start and on every change (kasp:chat-settings); switched off, nothing is sent to Google and every line gets
// its original back.
// The player's own messages: while the game's chat box is open, three buttons beside it (or Alt+1, Alt+2, Alt+3) put the
// typed text into the language chosen for that button, in the chat box itself; the game sends whatever is in the box when the
// player presses Enter, as always. The same button again gives the typed text back. Only the text of a pressed button goes to
// Google. A translation longer than the game's limit, or a failed one, leaves the text as typed and the button flashes red.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_chattranslate';
    const LANGUAGE_KEY = 'kasp_chatlanguage';
    // "1" while the ` key shows the original texts; no key for the translations.
    const ORIGINAL_KEY = 'kasp_chatoriginal';
    // The default languages (this one and BUTTON_DEFAULTS) are also each dropdown's fallback in CHOICES in settings_tab.ts:
    // choosing a default saves no key, so this copy decides what happens. Change both together.
    const DEFAULT_TARGET = 'en';
    // A Google language code, such as en or zh-CN; a saved value of another shape is ignored.
    const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Z]{2})?$/;
    const TRANSLATE_URL = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t';
    const TIMEOUT_MS = 4000;
    const TEXT_MAX = 1000;
    const CACHE_MAX = 200;
    // The key that switches the lines, by its place on the keyboard (under Esc), so it is the same key on every layout.
    const VIEW_KEY = 'Backquote';
    const CHAT_INPUT = '[class*="BattleChatComponentStyle-input"]';
    // The game's chat row (the chat box and the button after it), and the bordered box around the text field.
    const CHAT_ROW = '.BattleChatComponentStyle-container';
    const CHAT_FIELD_BOX = '[class*="BattleChatComponentStyle-inputContainer"]';
    const BUTTONS_KEY = 'kasp_chatbuttons';
    // The settings tab's dropdown for each button, and the language it has when nothing is saved.
    const BUTTON_KEYS = ['kasp_chatbutton1', 'kasp_chatbutton2', 'kasp_chatbutton3'] as const;
    const BUTTON_DEFAULTS = ['ru', 'en', 'pt'] as const;
    // The buttons get their look from extension/styles/chat_translation.css, by this id.
    const BUTTONS_ID = 'kasp-chat-buttons';
    // The game's own limit (its chat code): a longer message is not sent, and its text turns red in the chat box.
    const SEND_MAX = 170;
    const FAIL_MS = 1500;
    // The gap between the buttons and the chat row (or the chat box, when the buttons sit above it).
    const BUTTONS_GAP = '0.6rem';

    // The message this module reads, in its shared shape from src/types.d.ts, so a renamed field breaks the build here instead
    // of making the module drop every message.
    type ChatMessage = KaspChatMessage['detail'];

    interface Translation {
        readonly from: string;
        readonly text: string;
    }

    function readMessage(data: unknown): ChatMessage | null {
        if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== 'kasp:chat') return null;
        const detail = (data as { detail?: unknown }).detail;
        if (!detail || typeof detail !== 'object') return null;
        const d = detail as Partial<Record<keyof ChatMessage, unknown>>;
        if (typeof d.id !== 'number' || !Number.isSafeInteger(d.id) || d.id < 1) return null;
        if (typeof d.text !== 'string' || d.text.trim() === '' || d.text.length > TEXT_MAX) return null;
        return { id: d.id, text: d.text };
    }

    // The code as a button shows it: EN, or ZH for zh-CN.
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
    let original = window.kaspSwitches?.getChoice(ORIGINAL_KEY) === '1';

    function sendSettings(): void {
        const message: KaspChatSettingsMessage = { type: 'kasp:chat-settings', translate: enabled, language, original };
        window.postMessage(message, window.location.origin);
    }

    function answer(id: number, result: Translation | null): void {
        const message: KaspChatAnswerMessage = { type: 'kasp:chat-answer', id, text: result?.text ?? null, from: result?.from ?? '' };
        window.postMessage(message, window.location.origin);
    }

    // Every message gets an answer, so a line showing its dots always gets its translation or its original back.
    function onMessage(message: ChatMessage): void {
        if (!enabled) return;
        translate(message.text, language)
            .then((result) => answer(message.id, result))
            .catch(() => answer(message.id, null));
    }

    // The ` key in a battle, while nothing is being typed (the chat box then types the character as always). The key is not
    // taken from the game, so an action the player gave that key in the game's controls still happens.
    function isTyping(): boolean {
        const focused = document.activeElement;
        return focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement || (focused instanceof HTMLElement && focused.isContentEditable);
    }

    window.addEventListener(
        'keydown',
        (event: KeyboardEvent) => {
            if (event.code !== VIEW_KEY || event.repeat || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
            if (!enabled || window.kaspBattle?.isOn() !== true || isTyping()) return;
            // saved through the switch service, whose onChoice below sends the new view
            window.kaspSwitches?.setChoice(ORIGINAL_KEY, original ? null : '1');
        },
        true,
    );

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
        const typed = last !== null ? last.original : showing;
        if (typed.trim() === '') return;
        const to = buttonLanguages[index];
        const asked = ++question;
        waiting = index;
        paint();
        translate(typed, to)
            .then((result) => {
                if (asked !== question) return;
                waiting = null;
                // The chat closed, or its text changed, while Google was answering: the answer is dropped.
                if (field !== input || input.value !== showing) {
                    paint();
                    return;
                }
                // null: the typed text is already in that language, so it is the text that goes.
                const text = result === null ? typed : result.text;
                // Longer than the game's limit: the game would not send it, so the typed text stays.
                if (text.length > SEND_MAX) {
                    paint();
                    fail(index);
                    return;
                }
                put(input, text);
                done = { original: typed, translated: text, button: index };
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

    // Right after the game's chat row (its chat box and the button after it), as tall as the chat box and level with it. When
    // the window is too narrow for that, above the chat box, starting at its left edge.
    function place(): void {
        if (bar === null || field === null) return;
        const row = (field.closest(CHAT_ROW) ?? field).getBoundingClientRect();
        const fieldBox = (field.closest(CHAT_FIELD_BOX) ?? field).getBoundingClientRect();
        bar.style.height = `${fieldBox.height}px`;
        bar.style.left = `calc(${row.right}px + ${BUTTONS_GAP})`;
        bar.style.top = `${fieldBox.top}px`;
        if (bar.getBoundingClientRect().right <= window.innerWidth) return;
        bar.style.left = `${fieldBox.left}px`;
        bar.style.top = `calc(${fieldBox.top - fieldBox.height}px - ${BUTTONS_GAP})`;
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
            if (isChatInput(event.target)) showButtons(event.target);
        },
        true,
    );
    document.addEventListener(
        'focusout',
        (event: FocusEvent) => {
            if (isChatInput(event.target)) hideButtons();
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
    // The injector asks when it starts after this script.
    window.kaspMessages?.on('kasp:chat-settings-request', sendSettings);

    // Each change goes to the injector at once, which writes the lines again and redraws the game's chat.
    window.kaspSwitches?.onChange(SWITCH_KEY, (on) => {
        enabled = on;
        sendSettings();
    });
    window.kaspSwitches?.onChoice(LANGUAGE_KEY, (value) => {
        language = readCode(value, DEFAULT_TARGET);
        sendSettings();
    });
    window.kaspSwitches?.onChoice(ORIGINAL_KEY, (value) => {
        original = value === '1';
        sendSettings();
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
    sendSettings();
})();
