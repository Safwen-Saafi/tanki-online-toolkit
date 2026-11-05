// Isolated-world content script for the extension's tab in the game's settings screen. The tab itself is drawn by the game:
// src/injector.ts adds it to the game's own tab list, bar and panel tables (the settings-tab hook), and for our tab the game
// draws its panel box empty. This script puts our panel in that box while our tab is the open one, and takes it out when
// another tab opens. It never removes or moves anything the game made.
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
    // The game's own line between two sections of a panel.
    const DIVIDER_CLASS = 'SettingsComponentStyle-borderLineOption';
    // The value that turns a feature off, the same rule every module reads: only this exact text is off, no key is on.
    const OFF = '0';

    type SwitchGroup = 'sounds' | 'garage';

    interface SwitchEntry {
        // The localStorage key the feature's module reads.
        key: string;
        label: Record<KaspLanguageCode, string>;
        group: SwitchGroup;
        // True when the module applies a change at once; false when it applies after a reload.
        live: boolean;
    }

    const GROUPS: ReadonlyArray<{ id: SwitchGroup; heading: Record<KaspLanguageCode, string> }> = [
        { id: 'sounds', heading: { EN: 'Sounds', RU: 'Звуки' } },
        { id: 'garage', heading: { EN: 'Garage', RU: 'Гараж' } },
    ];

    const SWITCHES: readonly SwitchEntry[] = [
        { key: 'kasp_killsounds', group: 'sounds', live: true, label: { EN: 'Kill and death sounds', RU: 'Звуки убийств и смертей' } },
        { key: 'kasp_grenadesounds', group: 'sounds', live: true, label: { EN: 'Grenade throw sound', RU: 'Звук броска гранаты' } },
        { key: 'kasp_battlemusic', group: 'sounds', live: true, label: { EN: 'End of battle music', RU: 'Музыка в конце битвы' } },
        {
            key: 'kasp_weaponsounds',
            group: 'sounds',
            live: false,
            label: { EN: 'Weapon sounds (Magnum, Striker, Gauss)', RU: 'Звуки оружия (Магнум, Страйкер, Гаусс)' },
        },
        {
            key: 'kasp_augments',
            group: 'garage',
            live: false,
            label: { EN: 'Augment info and hidden cards', RU: 'Описания устройств и скрытые карточки' },
        },
        { key: 'kasp_old_pictures', group: 'garage', live: false, label: { EN: 'Old augment pictures', RU: 'Старые картинки устройств' } },
    ];

    const RESET_LABEL: Record<KaspLanguageCode, string> = { EN: 'reset all', RU: 'сбросить всё' };

    // A storage that cannot be read counts as on, like in every module.
    function isOn(key: string): boolean {
        try {
            return localStorage.getItem(key) !== OFF;
        } catch {
            return true;
        }
    }

    // Off writes "0", on removes the key. False when the browser refused, so the switch stays where it was.
    function save(key: string, on: boolean): boolean {
        try {
            if (on) localStorage.removeItem(key);
            else localStorage.setItem(key, OFF);
            return true;
        } catch (error: unknown) {
            console.warn(`${LOG} could not save ${key}:`, error instanceof Error ? error.message : error);
            return false;
        }
    }

    function element(tag: string, className: string, text?: string): HTMLElement {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // Space and Enter do what a click does, as on a real switch or button.
    function onPress(node: HTMLElement, action: () => void): void {
        node.tabIndex = 0;
        node.addEventListener('click', action);
        node.addEventListener('keydown', (event) => {
            if (event.key !== ' ' && event.key !== 'Enter') return;
            event.preventDefault();
            action();
        });
    }

    // One switch, drawn like the game's own.
    function setSwitch(row: HTMLElement, on: boolean): void {
        row.classList.toggle(SWITCH_ON, on);
        row.setAttribute('aria-checked', String(on));
    }

    // A switch shows what is saved when the panel is made, and a flip is saved at once.
    function makeSwitch(entry: SwitchEntry, language: KaspLanguageCode): HTMLElement {
        const row = element('div', `CheckBoxComponentStyle-oneSetting ${SWITCH_MARK}`);
        row.setAttribute('role', 'switch');
        const box = element('div', 'CheckBoxStyle-checkbox');
        box.appendChild(element('span', 'kasp-pill'));
        const labelBox = element('div', 'kasp-label-box');
        labelBox.appendChild(element('span', 'kasp-label', entry.label[language]));
        row.append(box, labelBox);
        setSwitch(row, isOn(entry.key));
        onPress(row, () => {
            const on = !row.classList.contains(SWITCH_ON);
            if (save(entry.key, on)) setSwitch(row, on);
        });
        return row;
    }

    // Our panel, in the classes the game's own panels use inside the box: one section per group, the game's line between two
    // sections and none above the first, then RESET ALL. It is made each time our tab opens, so it always shows what is saved.
    function makePanel(): HTMLElement {
        const language = window.kaspLanguage?.get() ?? 'EN';
        const panel = element('div', `${PANEL_MARK} SettingsComponentStyle-scrollingMenu SettingsComponentStyle-settingsBlockOptions`);
        const rows: Array<[SwitchEntry, HTMLElement]> = [];

        GROUPS.forEach((group, index) => {
            if (index > 0) panel.appendChild(element('div', DIVIDER_CLASS));
            const section = document.createElement('div');
            section.appendChild(element('p', HEADING_CLASS, group.heading[language]));
            const form = element('div', FORM_CLASS);
            for (const entry of SWITCHES) {
                if (entry.group !== group.id) continue;
                const row = makeSwitch(entry, language);
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
        reset.appendChild(element('span', '', RESET_LABEL[language]));
        onPress(reset, () => {
            for (const [entry, row] of rows) {
                save(entry.key, true);
                setSwitch(row, isOn(entry.key));
            }
        });
        resetBox.appendChild(reset);

        panel.appendChild(resetBox);
        return panel;
    }

    // A live list, so the check that runs on every page change stays cheap when settings are closed.
    const roots = document.getElementsByClassName(ROOT_CLASS);

    function sync(): void {
        const root = roots[0];
        if (root === undefined) return;
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
        console.log(`${LOG} ready`);
    }

    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
})();
