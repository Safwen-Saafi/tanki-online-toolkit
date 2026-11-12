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
    // The two places the game adds its settings screen to, as a direct child (probe, 2026-11-10): the app's root element in the
    // lobby and the garage, and the battle canvas's box in a battle (itself inside the app's root).
    const APP_ROOT_ID = 'app-root';
    const BATTLE_CANVAS_CLASS = 'BattleComponentStyle-canvasContainer';
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

    type SwitchGroup = 'kills' | 'grenade' | 'weapons' | 'music' | 'battle' | 'chat' | 'garage' | 'shop' | 'interface' | 'colour' | 'tabColours' | 'loading';

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
        { id: 'shop', heading: { EN: 'Shop', RU: 'Магазин' } },
        { id: 'interface', heading: { EN: 'Interface', RU: 'Интерфейс' } },
        // No switch: its row of colour circles (THEME_COLOURS).
        { id: 'colour', heading: { EN: 'Game colour', RU: 'Цвет игры' } },
        // Its switch, then its four colour squares (TAB_COLOURS).
        { id: 'tabColours', heading: { EN: 'Battle tab colours', RU: 'Цвета таблицы боя' } },
        // No switch: its two picture rows (LOADING_PICTURES).
        { id: 'loading', heading: { EN: 'Loading screens', RU: 'Экраны загрузки' } },
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
        // Read by the injector when the game starts: the daily offer's click buys without the success dialog (a change needs a reload).
        { key: 'kasp_shopquickbuy', group: 'shop', live: false, label: { EN: 'Daily offer quick buying', RU: 'Быстрая покупка ежедневного предложения' } },
        { key: 'kasp_debugline', group: 'interface', live: true, label: { EN: 'Hide debug info line', RU: 'Скрыть строку отладки' } },
        // Read by the injector when the game starts, so a change applies at the next start, with no reload when settings close.
        { key: 'kasp_skipstart', group: 'interface', live: true, label: { EN: 'Skip the start screen', RU: 'Пропускать стартовый экран' } },
        // On: the battle tab takes the four colours below, whatever the game colour (battle_tab.ts, styles/battle_tab.css).
        { key: 'kasp_tabcolours', group: 'tabColours', live: true, label: { EN: 'Own colours', RU: 'Свои цвета' } },
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

    // The fallbacks are also written in chat_translation.ts (DEFAULT_TARGET and BUTTON_DEFAULTS), whose copy decides what happens
    // when nothing is saved. Change both together.
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

    // The game colour (build-plan 22), one circle each. The colour work is the injector's: it reads THEME_KEY when the game starts
    // and writes the colour into the game's code, so a new colour applies at the next start (the game restarts when the settings
    // close). The names are also in injector.ts (THEMES); change both together. Blue is the game's own look and is saved as no key.
    const THEME_KEY = 'kasp_theme';
    const THEME_FALLBACK = 'blue';
    const THEME_COLOURS: ReadonlyArray<{ value: string; label: Record<KaspLanguageCode, string> }> = [
        { value: 'blue', label: { EN: "Blue (the game's own)", RU: 'Синий (как в игре)' } },
        { value: 'pink', label: { EN: 'Pink', RU: 'Розовый' } },
        { value: 'purple', label: { EN: 'Purple', RU: 'Фиолетовый' } },
        { value: 'crimson', label: { EN: 'Crimson', RU: 'Багровый' } },
        { value: 'teal', label: { EN: 'Teal', RU: 'Бирюзовый' } },
        { value: 'bronze', label: { EN: 'Bronze', RU: 'Бронзовый' } },
    ];
    const COLOUR_CHOSEN = 'kasp-chosen';

    // The battle tab's own colours (owner, 2026-11-11), each picked freely and saved as #rrggbb. The fallbacks are the game's own
    // colours, also written in styles/battle_tab.css; change both together. Choosing the fallback, or pressing the colour's Default
    // button (owner, 2026-11-12), removes the key.
    const TAB_COLOURS: ReadonlyArray<{ key: string; fallback: string; label: Record<KaspLanguageCode, string> }> = [
        { key: 'kasp_tabcolour_bg', fallback: '#001926', label: { EN: 'Background', RU: 'Фон' } },
        { key: 'kasp_tabcolour_allies', fallback: '#00d4ff', label: { EN: "Allies' rows", RU: 'Строки союзников' } },
        { key: 'kasp_tabcolour_enemies', fallback: '#fe6666', label: { EN: "Enemies' rows", RU: 'Строки противников' } },
        { key: 'kasp_tabcolour_box', fallback: '#1d3650', label: { EN: 'Augment info box', RU: 'Окно описания устройства' } },
    ];
    const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

    // The player's own pictures for the game's loading screens and its entrance frame (build-plan 23). The picture work and the drawing are
    // src/modules/loading_screens.ts's: it reads the keys once when the page starts, so a new or removed picture applies at the next
    // start (the game reloads when the settings close, like the game colour). The keys are also written there; change both together.
    const LOADING_PICTURES: ReadonlyArray<{ key: string; label: Record<KaspLanguageCode, string>; hint: Record<KaspLanguageCode, string> }> = [
        {
            key: 'kasp_loadpic_battle',
            label: { EN: 'Battle loading picture', RU: 'Картинка загрузки боя' },
            hint: { EN: 'Behind the tips while a battle loads', RU: 'Под подсказками, пока загружается бой' },
        },
        {
            key: 'kasp_loadpic_plain',
            label: { EN: 'Plain loading screen', RU: 'Простой экран загрузки' },
            hint: { EN: 'Behind "Loading" when the lobby changes screen and when the game opens', RU: 'Под надписью «Загрузка» при смене экрана лобби и при запуске игры' },
        },
        {
            key: 'kasp_loadpic_start',
            label: { EN: 'Start and login screens', RU: 'Стартовый экран и вход' },
            hint: { EN: 'Behind "Press any button to start" and the login and sign-up screens', RU: 'Под надписью «Нажмите любую кнопку» и на экранах входа и регистрации' },
        },
    ];

    // The mark after the label of a switch that applies after a reload, and in the legend that explains it.
    const RELOAD_MARK = '↻';
    const NOTICE_SHOWN = 'kasp-waiting';

    const TEXT: Record<
        'reset' | 'defaultColour' | 'afterReload' | 'reloadsOnClose' | 'notice' | 'choosePicture' | 'gameOwn' | 'making' | 'notImage' | 'tooBig' | 'noRoom',
        Record<KaspLanguageCode, string>
    > = {
        reset: { EN: 'reset all', RU: 'сбросить всё' },
        defaultColour: { EN: 'Default', RU: 'Сбросить' },
        afterReload: { EN: 'Applies after a reload', RU: 'Применится после перезагрузки' },
        reloadsOnClose: { EN: 'The game reloads by itself when you close settings', RU: 'Игра перезагрузится сама, когда вы закроете настройки' },
        notice: { EN: 'The game will reload when you close settings', RU: 'Игра перезагрузится, когда вы закроете настройки' },
        choosePicture: { EN: 'Choose picture', RU: 'Выбрать картинку' },
        gameOwn: { EN: "The game's own", RU: 'Как в игре' },
        making: { EN: 'Making the picture...', RU: 'Готовлю картинку...' },
        notImage: { EN: 'The browser cannot open this file as a picture.', RU: 'Браузер не может открыть этот файл как картинку.' },
        tooBig: { EN: 'This picture is too big. Pick a smaller one.', RU: 'Эта картинка слишком большая. Выберите поменьше.' },
        noRoom: {
            EN: 'The browser has no room left to save it. Pick a smaller picture or remove the other one.',
            RU: 'В браузере не осталось места, чтобы сохранить её. Выберите картинку поменьше или уберите другую.',
        },
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

    // The game colour is written into the game's code when it starts (injector.ts), so a new colour waits for the next start too.
    const themeAtStart = window.kaspSwitches?.getChoice(THEME_KEY) ?? null;

    // The loading pictures are read when the page starts (loading_screens.ts), so a change waits for the next start too.
    const picturesAtStart = new Map(LOADING_PICTURES.map((entry) => [entry.key, window.kaspSwitches?.getChoice(entry.key) ?? null]));

    // True when closing settings will reload: a reload switch, or the game colour, differs from how it was at start, so flipping
    // one off and on again waits for nothing.
    function reloadWaiting(): boolean {
        for (const [key, on] of atStart) if (isOn(key) !== on) return true;
        for (const [key, value] of picturesAtStart) if ((window.kaspSwitches?.getChoice(key) ?? null) !== value) return true;
        return (window.kaspSwitches?.getChoice(THEME_KEY) ?? null) !== themeAtStart;
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

    // The row of colour circles: the saved colour has the ring, and a click saves another (a value the row does not know shows Blue,
    // as the injector reads it). Nothing is repainted now: the injector reads the key when the game starts, so the ↻ notice shows and
    // the game reloads when the settings close.
    function makePalette(title: string, language: KaspLanguageCode, onChange: () => void): Choice {
        const node = element('div', 'kasp-palette');
        node.setAttribute('role', 'radiogroup');
        node.setAttribute('aria-label', title);
        const circles = new Map<string, HTMLElement>();
        const refresh = (): void => {
            const saved = window.kaspSwitches?.getChoice(THEME_KEY) ?? null;
            const current = THEME_COLOURS.some((colour) => colour.value === saved) ? saved : THEME_FALLBACK;
            for (const [value, circle] of circles) {
                circle.classList.toggle(COLOUR_CHOSEN, value === current);
                circle.setAttribute('aria-checked', String(value === current));
            }
        };
        for (const colour of THEME_COLOURS) {
            const circle = element('div', 'kasp-colour');
            circle.dataset['kaspColour'] = colour.value;
            circle.setAttribute('role', 'radio');
            circle.setAttribute('aria-label', colour.label[language]);
            circle.title = colour.label[language];
            onPress(circle, () => {
                if (!(window.kaspSwitches?.setChoice(THEME_KEY, colour.value === THEME_FALLBACK ? null : colour.value) ?? false)) return;
                refresh();
                onChange();
            });
            circles.set(colour.value, circle);
            node.appendChild(circle);
        }
        refresh();
        return { node, refresh };
    }

    // One colour of the battle tab: its name, as the game titles a dropdown, a square that opens the browser's colour picker, and
    // a Default button that gives the game's own colour back (greyed while it is already that). The battle tab follows while the
    // player moves in the picker (battle_tab.ts applies every change at once). The button sits outside the label, so pressing it
    // does not open the picker.
    function makePicker(entry: { key: string; fallback: string; label: Record<KaspLanguageCode, string> }, language: KaspLanguageCode): Choice {
        const node = element('div', 'kasp-choice kasp-pick');
        const label = element('label', 'kasp-pick-label');
        const input = document.createElement('input');
        input.type = 'color';
        input.className = 'kasp-pick-input';
        input.setAttribute('aria-label', entry.label[language]);
        label.append(element('h3', 'kasp-choice-title', entry.label[language]), input);
        const back = element('div', 'kasp-pick-default', TEXT.defaultColour[language]);
        back.setAttribute('role', 'button');
        back.setAttribute('aria-label', `${TEXT.defaultColour[language]}: ${entry.label[language]}`);
        node.append(label, back);
        const showDefault = (value: string): void => {
            const atDefault = value === entry.fallback;
            back.classList.toggle('kasp-at-default', atDefault);
            back.setAttribute('aria-disabled', String(atDefault));
        };
        const refresh = (): void => {
            const saved = window.kaspSwitches?.getChoice(entry.key) ?? null;
            input.value = saved !== null && HEX_COLOUR.test(saved) ? saved.toLowerCase() : entry.fallback;
            showDefault(input.value);
        };
        input.addEventListener('input', () => {
            const value = input.value.toLowerCase();
            window.kaspSwitches?.setChoice(entry.key, value === entry.fallback ? null : value);
            showDefault(value);
        });
        onPress(back, () => {
            if (input.value.toLowerCase() === entry.fallback) return;
            if (!(window.kaspSwitches?.setChoice(entry.key, null) ?? false)) return;
            refresh();
        });
        refresh();
        return { node, refresh };
    }

    // One loading screen's picture: its name and a line saying where it shows, a preview of the saved picture (or "The game's own"),
    // a Choose picture button that opens the file picker, and a Default button that removes the picture (greyed while there is none).
    // The file is shrunk by loading_screens.ts; a message line under the row says why a file was not taken. A new picture applies at
    // the next start, so changed (the notice's check) runs after every saved change.
    function makeLoadingPicture(
        entry: { key: string; label: Record<KaspLanguageCode, string>; hint: Record<KaspLanguageCode, string> },
        language: KaspLanguageCode,
        changed: () => void,
    ): Choice {
        const node = element('div', 'kasp-choice kasp-loadpic');
        const preview = element('div', 'kasp-loadpic-preview');
        const picture = document.createElement('img');
        picture.className = 'kasp-loadpic-image';
        picture.alt = '';
        const none = element('span', 'kasp-loadpic-none', TEXT.gameOwn[language]);
        preview.append(picture, none);
        const choose = element('div', 'kasp-pick-default kasp-loadpic-choose', TEXT.choosePicture[language]);
        choose.setAttribute('role', 'button');
        choose.setAttribute('aria-label', `${TEXT.choosePicture[language]}: ${entry.label[language]}`);
        const back = element('div', 'kasp-pick-default', TEXT.defaultColour[language]);
        back.setAttribute('role', 'button');
        back.setAttribute('aria-label', `${TEXT.defaultColour[language]}: ${entry.label[language]}`);
        const buttons = element('div', 'kasp-loadpic-buttons');
        buttons.append(choose, back);
        const row = element('div', 'kasp-loadpic-row');
        row.append(preview, buttons);
        const message = element('p', 'kasp-loadpic-message');
        message.setAttribute('role', 'status');
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.hidden = true;
        node.append(element('h3', 'kasp-choice-title', entry.label[language]), element('p', 'kasp-loadpic-hint', entry.hint[language]), row, message, input);

        const refresh = (): void => {
            const value = window.kaspSwitches?.getChoice(entry.key) ?? null;
            const has = value !== null && (window.kaspLoadingScreens?.isPicture(value) ?? false);
            if (has) picture.src = value;
            else picture.removeAttribute('src');
            preview.classList.toggle('kasp-loadpic-has', has);
            back.classList.toggle('kasp-at-default', !has);
            back.setAttribute('aria-disabled', String(!has));
            message.textContent = '';
        };
        const take = async (file: File): Promise<void> => {
            const maker = window.kaspLoadingScreens;
            if (maker === undefined) return;
            message.textContent = TEXT.making[language];
            const made = await maker.fromFile(file);
            if (!made.ok) {
                message.textContent = TEXT[made.reason][language];
                return;
            }
            if (!(window.kaspSwitches?.setChoice(entry.key, made.value) ?? false)) {
                message.textContent = TEXT.noRoom[language];
                return;
            }
            refresh();
            changed();
        };
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            input.value = '';
            if (file !== undefined) void take(file);
        });
        onPress(choose, () => input.click());
        onPress(back, () => {
            if (back.classList.contains('kasp-at-default')) return;
            if (!(window.kaspSwitches?.setChoice(entry.key, null) ?? false)) return;
            refresh();
            changed();
        });
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
        let palette: Choice | null = null;
        const pickers: Array<[string, Choice]> = [];
        const loadings: Array<[string, Choice]> = [];

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
            const heading = element('p', HEADING_CLASS, group.heading[language]);
            // The game colour and the loading pictures apply after a restart, like the switches with the same mark.
            if (group.id === 'colour' || group.id === 'loading') heading.append(' ', makeMark());
            section.appendChild(heading);
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
            if (group.id === 'tabColours') {
                for (const entry of TAB_COLOURS) {
                    const picker = makePicker(entry, language);
                    pickers.push([entry.key, picker]);
                    section.appendChild(picker.node);
                }
            }
            if (group.id === 'loading') {
                for (const entry of LOADING_PICTURES) {
                    const picture = makeLoadingPicture(entry, language, refreshNotice);
                    loadings.push([entry.key, picture]);
                    section.appendChild(picture.node);
                }
            }
            if (group.id === 'colour') {
                palette = makePalette(group.heading[language], language, refreshNotice);
                section.appendChild(palette.node);
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
            window.kaspSwitches?.setChoice(THEME_KEY, null);
            palette?.refresh();
            for (const [key, picker] of pickers) {
                window.kaspSwitches?.setChoice(key, null);
                picker.refresh();
            }
            for (const [key, picture] of loadings) {
                window.kaspSwitches?.setChoice(key, null);
                picture.refresh();
            }
            refreshNotice();
        });
        resetBox.append(notice, reset);

        panel.appendChild(resetBox);
        return panel;
    }

    // A live list, so a check reads the page again only after it changed.
    const roots = document.getElementsByClassName(ROOT_CLASS);
    let settingsOpen = false;

    function setOpen(open: boolean): void {
        if (open === settingsOpen) return;
        settingsOpen = open;
        watch();
    }

    function sync(): void {
        const root = roots[0];
        if (root === undefined) {
            // Settings just closed, in the garage or in a battle (a reload puts the player back in the same battle): every
            // change saved since the page started applies together, in one reload.
            if (settingsOpen && reloadWaiting()) window.location.reload();
            setOpen(false);
            return;
        }
        setOpen(true);
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

    function adds(record: MutationRecord, className: string): boolean {
        for (const node of record.addedNodes) {
            if (node instanceof Element && (node.classList.contains(className) || node.getElementsByClassName(className)[0] !== undefined)) return true;
        }
        return false;
    }

    // While settings are closed, only the two places the settings screen is added to are watched, and only their own children, so
    // a battle's many changes deeper in the page wake nothing. While settings are open, or before the app's root exists, or if a
    // game update renames it, the whole page is watched, so tab switches inside the screen are seen and nothing is missed.
    let watchingPlaces = false;

    function watch(): void {
        observer.disconnect();
        const appRoot = document.getElementById(APP_ROOT_ID);
        watchingPlaces = !settingsOpen && appRoot !== null;
        if (appRoot === null || !watchingPlaces) {
            observer.observe(document.documentElement, { childList: true, subtree: true });
            return;
        }
        observer.observe(appRoot, { childList: true });
        const battle = appRoot.getElementsByClassName(BATTLE_CANVAS_CLASS)[0];
        if (battle !== undefined) observer.observe(battle, { childList: true });
    }

    // The callback runs right after the game changes the page and before the screen is drawn, so our panel goes in, and comes
    // out, in the same frame as the game's change: nothing flashes. While settings are closed only what was added is looked at
    // (the settings screen opens by being added to the page).
    const observer = new MutationObserver((records) => {
        if (watchingPlaces) {
            // A battle started: its canvas's box is the second place.
            if (records.some((record) => adds(record, BATTLE_CANVAS_CLASS))) watch();
        } else if (!settingsOpen && document.getElementById(APP_ROOT_ID) !== null) {
            watch();
        }
        if (settingsOpen || records.some((record) => adds(record, ROOT_CLASS))) sync();
    });

    function start(): void {
        watch();
        // A safety net for a battle canvas added deeper than the app's root's own children.
        window.kaspBattle?.onChange(() => {
            if (!settingsOpen) watch();
        });
        sync();
        if (window.kaspSwitches === undefined) console.warn(`${LOG} the switch service is missing, no switch can be saved`);
        console.log(`${LOG} ready`);
    }


    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
