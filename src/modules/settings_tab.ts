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
    // The panel's content for 17a: test switches that only flip on screen. 17b replaces them with the real list.
    const TEST_HEADING = 'Test switches';
    const TEST_SWITCHES = ['Test switch one', 'Test switch two', 'Test switch three'];
    const RESET_LABEL = 'reset all';

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

    // One switch, drawn like the game's own. Not saved anywhere yet: 17b gives it a key and a place to keep it.
    function setSwitch(row: HTMLElement, on: boolean): void {
        row.classList.toggle(SWITCH_ON, on);
        row.setAttribute('aria-checked', String(on));
    }

    function makeSwitch(label: string): HTMLElement {
        const row = element('div', `CheckBoxComponentStyle-oneSetting ${SWITCH_MARK}`);
        row.setAttribute('role', 'switch');
        const box = element('div', 'CheckBoxStyle-checkbox');
        box.appendChild(element('span', 'kasp-pill'));
        const labelBox = element('div', 'kasp-label-box');
        labelBox.appendChild(element('span', 'kasp-label', label));
        row.append(box, labelBox);
        setSwitch(row, true);
        onPress(row, () => setSwitch(row, !row.classList.contains(SWITCH_ON)));
        return row;
    }

    // Our panel, in the classes the game's own panels use inside the box. No divider above the first heading: the game draws
    // dividers only between sections.
    function makePanel(): HTMLElement {
        const panel = element('div', `${PANEL_MARK} SettingsComponentStyle-scrollingMenu SettingsComponentStyle-settingsBlockOptions`);
        const switches = TEST_SWITCHES.map(makeSwitch);

        const section = document.createElement('div');
        section.appendChild(element('p', 'SettingsComponentStyle-textHeadlineOptions', TEST_HEADING));
        const form = element('div', 'GameSettingsStyle-containerFormOptions');
        form.append(...switches);
        section.appendChild(form);

        const resetBox = element('div', 'SettingsButtonsComponentStyle-containerGroupButton');
        const reset = element('div', 'kasp-reset');
        reset.setAttribute('role', 'button');
        reset.appendChild(element('span', '', RESET_LABEL));
        onPress(reset, () => switches.forEach((row) => setSwitch(row, true)));
        resetBox.appendChild(reset);

        panel.append(section, resetBox);
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
