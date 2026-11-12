// Isolated-world content script for the battle tab's coloured icons (build-plan 18c, split in two by 18e) and the battle tab's own
// colours (build-plan 22). The colours are a stylesheet (extension/styles/battle_tab.css), which the manifest always loads, so this
// script only switches it and hands it the player's colours: while an icon switch is off, it puts that switch's attribute on the
// page's root element, and its colour rules apply only without it, so the game's own icons show; while "Own colours" is on, it
// marks the root element and writes the four picked colours as variables there.
(function () {
    'use strict';

    // The switch key, and the attribute that turns its colour rules off: the protection icons and their marker, then the
    // players' turret icons.
    const SWITCHES = [
        { key: 'kasp_protectioncolours', plain: 'data-kasp-plain-protections' },
        { key: 'kasp_turretcolours', plain: 'data-kasp-plain-turrets' },
    ] as const;

    // The user's switches, set in the extension's settings tab: read at start, and the switch service (src/modules/switches.ts)
    // calls back with every change, so it applies at once. Without the service every switch counts as on.
    for (const { key, plain } of SWITCHES) {
        const apply = (on: boolean): void => {
            document.documentElement.toggleAttribute(plain, !on);
        };
        apply(window.kaspSwitches?.isOn(key) ?? true);
        window.kaspSwitches?.onChange(key, apply);
    }

    // The battle tab's own colours (owner, 2026-11-11): while the switch is on, the root element carries data-kasp-tab-colours and
    // the stylesheet gives the Tab screen these colours; each saved one is written as a variable on the root element, and one
    // not saved, or not a #rrggbb colour, leaves the stylesheet's fallback (the game's own). Only on a change: nothing watches.
    const TAB_SWITCH = 'kasp_tabcolours';
    const TAB_COLOURS = [
        { key: 'kasp_tabcolour_bg', variable: '--kasp-tab-bg' },
        { key: 'kasp_tabcolour_allies', variable: '--kasp-tab-allies' },
        { key: 'kasp_tabcolour_enemies', variable: '--kasp-tab-enemies' },
        { key: 'kasp_tabcolour_box', variable: '--kasp-tab-box' },
    ] as const;
    const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

    const ownColours = (on: boolean): void => {
        document.documentElement.toggleAttribute('data-kasp-tab-colours', on);
    };
    ownColours(window.kaspSwitches?.isOn(TAB_SWITCH) ?? true);
    window.kaspSwitches?.onChange(TAB_SWITCH, ownColours);
    for (const { key, variable } of TAB_COLOURS) {
        const apply = (value: string | null): void => {
            const style = document.documentElement.style;
            if (value !== null && HEX_COLOUR.test(value)) style.setProperty(variable, value);
            else style.removeProperty(variable);
        };
        apply(window.kaspSwitches?.getChoice(key) ?? null);
        window.kaspSwitches?.onChoice(key, apply);
    }
})();
