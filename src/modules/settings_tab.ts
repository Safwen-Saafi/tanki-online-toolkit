// Isolated-world content script for the extension's tab in the game's settings screen. The tab itself is drawn by the game:
// src/injector.ts adds it to the game's own tab list, bar and panel tables (the settings-tab hook), and for our tab the game
// draws its panel box empty. This script puts our panel in that box while our tab is the open one, and takes it out when
// another tab opens. It never removes or moves anything the game made. A switch whose module applies it only at start-up is
// marked; when settings close and one of those differs from how it was when the page started, the page reloads, once.
// See blueprint/context/settings-tab.md (the game's settings screen, what was proven on it).
(function () {
    'use strict';

    const LOG = '[KI-test][settings_tab]';
    const ROOT_CLASS = 'SettingsComponentStyle-blockContentOptions';
    const BOX_CLASS = 'SettingsComponentStyle-containerBlock';
    const ACTIVE_TAB_SELECTOR = 'ul > .SettingsMenuComponentStyle-activeItemOptions';
    // The name the injector gives our tab; the same in both game languages. The page's text is drawn in capitals by CSS.
    const TAB_LABEL = 'twizzy extension';
    const PANEL_MARK = 'kasp-panel';
    const SWITCH_MARK = 'kasp-row';
    const SWITCH_ON = 'kasp-on';
    const HEADING_CLASS = 'SettingsComponentStyle-textHeadlineOptions';
    const FORM_CLASS = 'GameSettingsStyle-containerFormOptions';
    // The game's own line between two sections of a panel. The game puts it alone in a block of its own, and the line gets its
    // height from that block: on its own it is 0 pixels tall (both measured on the Graphics tab, 2026-11-07).
    const DIVIDER_CLASS = 'SettingsComponentStyle-borderLineOption';
    const DIVIDER_BLOCK_CLASS = 'SettingsComponentStyle-commonBlock';

    type SwitchGroup = 'kills' | 'grenade' | 'weapons' | 'music' | 'battle' | 'chat' | 'garage';

    interface SwitchEntry {
        // The localStorage key the feature's module reads.
        key: string;
        label: Record<KaspLanguageCode, string>;
        group: SwitchGroup;
        // True when the module applies a change at once; false when it applies after a reload.
        live: boolean;
    }

    const GROUPS: ReadonlyArray<{ id: SwitchGroup; heading: Record<KaspLanguageCode, string> }> = [
        { id: 'kills', heading: { EN: 'Kill and death sounds', RU: 'Звуки убийств и смертей' } },
        { id: 'grenade', heading: { EN: 'Grenade sounds', RU: 'Звуки гранаты' } },
        { id: 'weapons', heading: { EN: 'Weapon sounds', RU: 'Звуки оружия' } },
        { id: 'music', heading: { EN: 'Music', RU: 'Музыка' } },
        { id: 'battle', heading: { EN: 'Battle tab', RU: 'Таблица боя' } },
        { id: 'chat', heading: { EN: 'Chat', RU: 'Чат' } },
        { id: 'garage', heading: { EN: 'Garage', RU: 'Гараж' } },
    ];

    // Shown in this order inside each group.
    const SWITCHES: readonly SwitchEntry[] = [
        { key: 'kasp_killsounds', group: 'kills', live: true, label: { EN: 'Kill streaks and multi-kills', RU: 'Серии и мультиубийства' } },
        { key: 'kasp_deathsounds', group: 'kills', live: true, label: { EN: 'Death taunts', RU: 'Насмешки при смерти' } },
        { key: 'kasp_grenadesounds', group: 'grenade', live: true, label: { EN: 'Grenade throw', RU: 'Бросок гранаты' } },
        { key: 'kasp_grenadekillsound', group: 'grenade', live: true, label: { EN: 'Grenade kill', RU: 'Убийство гранатой' } },
        // One per weapon in extension/data/weapon_sounds.json; the key ends with the group's "weapon".
        { key: 'kasp_weaponsounds_magnum', group: 'weapons', live: false, label: { EN: 'Magnum', RU: 'Магнум' } },
        { key: 'kasp_weaponsounds_striker', group: 'weapons', live: false, label: { EN: 'Striker', RU: 'Страйкер' } },
        { key: 'kasp_weaponsounds_gauss', group: 'weapons', live: false, label: { EN: 'Gauss', RU: 'Гаусс' } },
        { key: 'kasp_battlemusic', group: 'music', live: true, label: { EN: 'End of battle music', RU: 'Музыка в конце битвы' } },
        { key: 'kasp_protectioncolours', group: 'battle', live: true, label: { EN: 'Coloured modules', RU: 'Цветные модули' } },
        { key: 'kasp_turretcolours', group: 'battle', live: true, label: { EN: 'Coloured turret icons', RU: 'Цветные значки пушек' } },
        { key: 'kasp_battleaugments', group: 'battle', live: true, label: { EN: 'Augment info', RU: 'Описания устройств' } },
        { key: 'kasp_chattranslate', group: 'chat', live: true, label: { EN: 'Translate chat', RU: 'Переводить чат' } },
        { key: 'kasp_chatbuttons', group: 'chat', live: true, label: { EN: 'Translation buttons in my chat', RU: 'Кнопки перевода в моём чате' } },
        {
            key: 'kasp_augments',
            group: 'garage',
            live: false,
            label: { EN: 'Augment info', RU: 'Описания устройств' },
        },
        { key: 'kasp_hiddencards', group: 'garage', live: false, label: { EN: 'Hidden cards', RU: 'Скрытые карточки' } },
        { key: 'kasp_old_pictures', group: 'garage', live: false, label: { EN: 'Old augment pictures', RU: 'Старые картинки устройств' } },
        { key: 'kasp_garageskins', group: 'garage', live: true, label: { EN: 'Equipped skins in the garage', RU: 'Надетые скины в гараже' } },
        { key: 'kasp_narrowcards', group: 'garage', live: true, label: { EN: 'Narrower garage cards', RU: 'Узкие карточки в гараже' } },
    ];

    interface ChoiceOption {
        readonly value: string;
        readonly label: string;
        // A small picture before the label (a file of the extension), as the game's Language dropdown shows its flags.
        readonly picture?: string;
    }

    // A dropdown, shown right under the switch whose key is after. Its module reads it through the switch service, which saves the
    // value under key.
    interface ChoiceEntry {
        key: string;
        after: string;
        title: Record<KaspLanguageCode, string>;
        // The value shown when nothing is saved; choosing it removes the key.
        fallback: string;
        options: readonly ChoiceOption[];
    }

    // Google's codes for the languages chat can be translated to, each named in its own language, as the game names its own, with
    // its flag in extension/flags/<code>.webp: the game's own pictures for the game's languages (English is the UK flag and
    // Portuguese Brazil's, as in the game), and the others made in the same style and size (Arabic is Saudi Arabia's flag).
    const CHAT_LANGUAGES: readonly ChoiceOption[] = (
        [
            ['en', 'English, EN'],
            ['ru', 'Русский, RU'],
            ['uk', 'Українська, UK'],
            ['pl', 'Polski, PL'],
            ['de', 'Deutsch, DE'],
            ['fr', 'Français, FR'],
            ['es', 'Español, ES'],
            ['pt', 'Português, PT'],
            ['it', 'Italiano, IT'],
            ['tr', 'Türkçe, TR'],
            ['ar', 'العربية, AR'],
            ['bg', 'Български, BG'],
            ['cs', 'Čeština, CS'],
            ['ro', 'Română, RO'],
            ['hu', 'Magyar, HU'],
            ['nl', 'Nederlands, NL'],
            ['zh-CN', '中文, ZH'],
            ['ja', '日本語, JA'],
            ['ko', '한국어, KO'],
        ] as const
    ).map(([value, label]) => ({ value, label, picture: `flags/${value}.webp` }));

    const CHOICES: readonly ChoiceEntry[] = [
        { key: 'kasp_chatlanguage', after: 'kasp_chattranslate', title: { EN: 'Translate to', RU: 'Переводить на' }, fallback: 'en', options: CHAT_LANGUAGES },
        // The three buttons shown beside the chat box while the player types (Alt+1, Alt+2, Alt+3).
        ...(['ru', 'en', 'pt'] as const).map((fallback, index) => ({
            key: `kasp_chatbutton${index + 1}`,
            after: 'kasp_chatbuttons',
            title: { EN: `Button ${index + 1} (Alt+${index + 1})`, RU: `Кнопка ${index + 1} (Alt+${index + 1})` },
            fallback,
            options: CHAT_LANGUAGES,
        })),
    ];

    // The mark after the label of a switch that applies after a reload, and in the legend that explains it.
    const RELOAD_MARK = '↻';
    const NOTICE_SHOWN = 'kasp-waiting';

    const TEXT: Record<'reset' | 'afterReload' | 'reloadsOnClose' | 'notice', Record<KaspLanguageCode, string>> = {
        reset: { EN: 'reset all', RU: 'сбросить всё' },
        afterReload: { EN: 'Applies after a reload', RU: 'Применится после перезагрузки' },
        reloadsOnClose: { EN: 'The game reloads by itself when you close settings', RU: 'Игра перезагрузится сама, когда вы закроете настройки' },
        notice: { EN: 'The game will reload when you close settings', RU: 'Игра перезагрузится, когда вы закроете настройки' },
    };

    // Through the switch service (src/modules/switches.ts), which knows how a switch is saved and tells the live modules of a
    // change. Without it every switch shows on and nothing can be saved.
    function isOn(key: string): boolean {
        return window.kaspSwitches?.isOn(key) ?? true;
    }

    // False when it was not saved, so the switch stays where it was.
    function save(key: string, on: boolean): boolean {
        return window.kaspSwitches?.set(key, on) ?? false;
    }

    // How each reload switch was when the page started, which is when its module read it.
    const atStart = new Map(SWITCHES.filter((entry) => !entry.live).map((entry) => [entry.key, isOn(entry.key)]));

    // True when closing settings will reload: a reload switch differs from how it was at start, so flipping one off and on
    // again waits for nothing.
    function reloadWaiting(): boolean {
        for (const [key, on] of atStart) if (isOn(key) !== on) return true;
        return false;
    }

    function element(tag: string, className: string, text?: string): HTMLElement {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // Space and Enter do what a click does, as on a real switch or button.
    function onKeys(node: HTMLElement, action: () => void): void {
        node.tabIndex = 0;
        node.addEventListener('keydown', (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            action();
        });
    }

    function onPress(node: HTMLElement, action: () => void): void {
        node.addEventListener('click', action);
        onKeys(node, action);
    }

    // One switch, drawn like the game's own.
    function setSwitch(row: HTMLElement, on: boolean): void {
        row.classList.toggle(SWITCH_ON, on);
        row.setAttribute('aria-checked', String(on));
    }

    // The ↻ mark. After a label it is read out as its meaning; next to text that already says it, it is not read at all.
    function makeMark(meaning?: string): HTMLElement {
        const mark = element('span', 'kasp-mark', RELOAD_MARK);
        if (meaning === undefined) {
            mark.setAttribute('aria-hidden', 'true');
        } else {
            mark.setAttribute('role', 'img');
            mark.setAttribute('aria-label', meaning);
        }
        return mark;
    }

    // A switch shows what is saved when the panel is made, and a flip is saved at once; changed runs after every saved flip.
    function makeSwitch(entry: SwitchEntry, language: KaspLanguageCode, changed: () => void): HTMLElement {
        const row = element('div', `CheckBoxComponentStyle-oneSetting ${SWITCH_MARK}`);
        row.setAttribute('role', 'switch');
        const box = element('div', 'CheckBoxStyle-checkbox');
        box.appendChild(element('span', 'kasp-pill'));
        const labelBox = element('div', 'kasp-label-box');
        const label = element('span', 'kasp-label', entry.label[language]);
        if (!entry.live) label.appendChild(makeMark(TEXT.afterReload[language]));
        labelBox.appendChild(label);
        row.append(box, labelBox);
        setSwitch(row, isOn(entry.key));
        const flip = (): void => {
            const on = !row.classList.contains(SWITCH_ON);
            if (!save(entry.key, on)) return;
            setSwitch(row, on);
            changed();
        };
        // As in the game's rows, only the pill and the text box take the click; the row only takes the keys, for its focus.
        box.addEventListener('click', flip);
        labelBox.addEventListener('click', flip);
        onKeys(row, flip);
        return row;
    }

    interface Choice {
        readonly node: HTMLElement;
        // Shows what is saved again (after RESET ALL).
        readonly refresh: () => void;
    }

    // A choice's picture; one that does not load is hidden, and the label stays.
    function makePicture(): HTMLImageElement {
        const picture = document.createElement('img');
        picture.className = 'kasp-dropdown-picture';
        picture.alt = '';
        picture.addEventListener('error', () => (picture.hidden = true));
        return picture;
    }

    function showPicture(picture: HTMLImageElement, file: string | undefined): void {
        picture.hidden = file === undefined;
        if (file !== undefined) picture.src = chrome.runtime.getURL(file);
    }

    function saved(entry: ChoiceEntry): ChoiceOption {
        const value = window.kaspSwitches?.getChoice(entry.key) ?? null;
        return entry.options.find((option) => option.value === value) ?? entry.options.find((option) => option.value === entry.fallback) ?? entry.options[0];
    }

    // A dropdown drawn like the game's own (its Language choice on the Game tab, measured 2026-11-08): the title, then a box with
    // the chosen value and an arrow. A click on the box opens the list under it; a click on a value saves it and closes the list;
    // a click anywhere else, or Escape, closes it.
    function makeChoice(entry: ChoiceEntry, language: KaspLanguageCode): Choice {
        const node = element('div', 'kasp-choice');
        const dropdown = element('div', 'kasp-dropdown');
        const control = element('div', 'kasp-dropdown-control');
        control.setAttribute('role', 'button');
        control.setAttribute('aria-haspopup', 'listbox');
        control.setAttribute('aria-label', entry.title[language]);
        const shownPicture = makePicture();
        const shown = element('span', 'kasp-dropdown-text');
        const valueBox = element('div', 'kasp-dropdown-value');
        valueBox.append(shownPicture, shown);
        control.append(valueBox, element('span', 'kasp-dropdown-arrow'));
        const menu = element('div', 'kasp-dropdown-menu');
        menu.setAttribute('role', 'listbox');
        dropdown.append(control, menu);
        node.append(element('h3', 'kasp-choice-title', entry.title[language]), dropdown);

        const items = new Map<string, HTMLElement>();
        const refresh = (): void => {
            const current = saved(entry);
            shown.textContent = current.label;
            showPicture(shownPicture, current.picture);
            for (const [value, item] of items) item.setAttribute('aria-selected', String(value === current.value));
        };

        const onOutside = (event: Event): void => {
            if (event.target instanceof Node && dropdown.contains(event.target)) return;
            close();
        };
        function close(): void {
            menu.hidden = true;
            control.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', onOutside, true);
        }
        function open(): void {
            menu.hidden = false;
            control.setAttribute('aria-expanded', 'true');
            document.addEventListener('pointerdown', onOutside, true);
            // The chosen value is in view when the list opens.
            const chosen = items.get(saved(entry).value);
            if (chosen !== undefined && chosen.offsetTop + chosen.offsetHeight > menu.clientHeight) {
                menu.scrollTop = chosen.offsetTop + chosen.offsetHeight - menu.clientHeight;
            }
        }

        for (const option of entry.options) {
            const item = element('div', 'kasp-dropdown-item');
            item.setAttribute('role', 'option');
            const picture = makePicture();
            showPicture(picture, option.picture);
            item.append(picture, element('span', 'kasp-dropdown-text', option.label));
            onPress(item, () => {
                // The fallback is saved as no key, so it stays the default if the default ever changes.
                if (!(window.kaspSwitches?.setChoice(entry.key, option.value === entry.fallback ? null : option.value) ?? false)) return;
                refresh();
                close();
                control.focus();
            });
            items.set(option.value, item);
            menu.appendChild(item);
        }
        onPress(control, () => (menu.hidden ? open() : close()));
        dropdown.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || menu.hidden) return;
            event.preventDefault();
            event.stopPropagation();
            close();
            control.focus();
        });
        close();
        refresh();
        return { node, refresh };
    }

    // Our panel, in the classes the game's own panels use inside the box: the legend, one section per group, the game's line
    // between two sections and none above the first, then the notice and RESET ALL. It is made each time our tab opens, so it
    // always shows what is saved.
    function makePanel(): HTMLElement {
        const language = window.kaspLanguage?.get() ?? 'EN';
        const panel = element('div', `${PANEL_MARK} SettingsComponentStyle-scrollingMenu SettingsComponentStyle-settingsBlockOptions`);
        const rows: Array<[SwitchEntry, HTMLElement]> = [];
        const choices: Array<[ChoiceEntry, Choice]> = [];

        const legend = element('p', 'kasp-legend');
        legend.append(makeMark(), ` ${TEXT.afterReload[language]}. ${TEXT.reloadsOnClose[language]}.`);
        panel.appendChild(legend);

        // Shown while closing settings will reload; it keeps its place when hidden, so nothing moves.
        const notice = element('span', 'kasp-notice');
        notice.setAttribute('role', 'status');
        notice.append(makeMark(), ` ${TEXT.notice[language]}`);
        const refreshNotice = (): void => {
            notice.classList.toggle(NOTICE_SHOWN, reloadWaiting());
        };
        refreshNotice();

        GROUPS.forEach((group, index) => {
            if (index > 0) {
                const divider = element('div', DIVIDER_BLOCK_CLASS);
                divider.appendChild(element('div', DIVIDER_CLASS));
                panel.appendChild(divider);
            }
            const section = document.createElement('div');
            section.appendChild(element('p', HEADING_CLASS, group.heading[language]));
            // The switches sit in the game's form box; a switch's dropdowns go right under it, outside that box, and the next
            // switches start a new one.
            let form: HTMLElement | null = null;
            for (const entry of SWITCHES) {
                if (entry.group !== group.id) continue;
                const row = makeSwitch(entry, language, refreshNotice);
                rows.push([entry, row]);
                if (form === null) {
                    form = element('div', FORM_CLASS);
                    section.appendChild(form);
                }
                form.appendChild(row);
                for (const choiceEntry of CHOICES) {
                    if (choiceEntry.after !== entry.key) continue;
                    const choice = makeChoice(choiceEntry, language);
                    choices.push([choiceEntry, choice]);
                    section.appendChild(choice.node);
                    form = null;
                }
            }
            panel.appendChild(section);
        });

        // RESET ALL removes every key, so every switch is on and every dropdown shows its default; a key the browser refused to
        // remove keeps what it had.
        const resetBox = element('div', 'SettingsButtonsComponentStyle-containerGroupButton');
        const reset = element('div', 'kasp-reset');
        reset.setAttribute('role', 'button');
        reset.appendChild(element('span', '', TEXT.reset[language]));
        onPress(reset, () => {
            for (const [entry, row] of rows) {
                save(entry.key, true);
                setSwitch(row, isOn(entry.key));
            }
            for (const [entry, choice] of choices) {
                window.kaspSwitches?.setChoice(entry.key, null);
                choice.refresh();
            }
            refreshNotice();
        });
        resetBox.append(notice, reset);

        panel.appendChild(resetBox);
        return panel;
    }

    // A live list, so the check that runs on every page change stays cheap when settings are closed.
    const roots = document.getElementsByClassName(ROOT_CLASS);
    let settingsOpen = false;

    function sync(): void {
        const root = roots[0];
        if (root === undefined) {
            // Settings just closed, in the garage or in a battle (a reload puts the player back in the same battle): every
            // change saved since the page started applies together, in one reload.
            if (settingsOpen && reloadWaiting()) window.location.reload();
            settingsOpen = false;
            return;
        }
        settingsOpen = true;
        const box = Array.from(root.children).find((child) => child.classList.contains(BOX_CLASS));
        if (box === undefined) return;
        const active = root.querySelector(ACTIVE_TAB_SELECTOR);
        const oursOpen = (active?.textContent ?? '').trim().toLowerCase() === TAB_LABEL;
        const panel = Array.from(box.children).find((child) => child.classList.contains(PANEL_MARK));
        if (oursOpen) {
            // The game's box is empty for our tab; anything of the game's in it means it has not finished switching yet.
            if (panel === undefined && box.children.length === 0) box.appendChild(makePanel());
        } else if (panel !== undefined) {
            panel.remove();
        }
    }

    // The callback runs right after the game changes the page and before the screen is drawn, so our panel goes in, and comes
    // out, in the same frame as the game's change: nothing flashes.
    const observer = new MutationObserver(sync);

    function start(): void {
        observer.observe(document.documentElement, { childList: true, subtree: true });
        sync();
        if (window.kaspSwitches === undefined) console.warn(`${LOG} the switch service is missing, no switch can be saved`);
        console.log(`${LOG} ready`);
    }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
