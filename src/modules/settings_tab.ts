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

    type SwitchGroup = 'kills' | 'grenade' | 'weapons' | 'music' | 'garage';

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
        { id: 'garage', heading: { EN: 'Garage', RU: 'Гараж' } },
    ];

    // Shown in this order inside each group.
    const SWITCHES: readonly SwitchEntry[] = [
        { key: 'kasp_killsounds', group: 'kills', live: true, label: { EN: 'Kill streaks and multi-kills', RU: 'Серии и мультиубийства' } },
        { key: 'kasp_deathsounds', group: 'kills', live: true, label: { EN: 'Death taunts', RU: 'Насмешки при смерти' } },
        { key: 'kasp_grenadesounds', group: 'grenade', live: true, label: { EN: 'Grenade throw', RU: 'Бросок гранаты' } },
        { key: 'kasp_grenadekillsound', group: 'grenade', live: true, label: { EN: 'Grenade kill', RU: 'Убийство гранатой' } },
        { key: 'kasp_weaponsounds', group: 'weapons', live: false, label: { EN: 'Magnum, Striker and Gauss', RU: 'Магнум, Страйкер и Гаусс' } },
        { key: 'kasp_battlemusic', group: 'music', live: true, label: { EN: 'End of battle music', RU: 'Музыка в конце битвы' } },
        {
            key: 'kasp_augments',
            group: 'garage',
            live: false,
            label: { EN: 'Augment info and hidden cards', RU: 'Описания устройств и скрытые карточки' },
        },
        { key: 'kasp_old_pictures', group: 'garage', live: false, label: { EN: 'Old augment pictures', RU: 'Старые картинки устройств' } },
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

    // Our panel, in the classes the game's own panels use inside the box: the legend, one section per group, the game's line
    // between two sections and none above the first, then the notice and RESET ALL. It is made each time our tab opens, so it
    // always shows what is saved.
    function makePanel(): HTMLElement {
        const language = window.kaspLanguage?.get() ?? 'EN';
        const panel = element('div', `${PANEL_MARK} SettingsComponentStyle-scrollingMenu SettingsComponentStyle-settingsBlockOptions`);
        const rows: Array<[SwitchEntry, HTMLElement]> = [];

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
            const form = element('div', FORM_CLASS);
            for (const entry of SWITCHES) {
                if (entry.group !== group.id) continue;
                const row = makeSwitch(entry, language, refreshNotice);
                rows.push([entry, row]);
                form.appendChild(row);
            }
            section.appendChild(form);
            panel.appendChild(section);
        });

        // RESET ALL removes every key, so every switch is on; a key the browser refused to remove keeps its switch off.
        const resetBox = element('div', 'SettingsButtonsComponentStyle-containerGroupButton');
        const reset = element('div', 'kasp-reset');
        reset.setAttribute('role', 'button');
        reset.appendChild(element('span', '', TEXT.reset[language]));
        onPress(reset, () => {
            for (const [entry, row] of rows) {
                save(entry.key, true);
                setSwitch(row, isOn(entry.key));
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
