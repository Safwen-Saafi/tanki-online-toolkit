// Isolated-world content script for the game's debug info line (UID, TYPE, VER, UPD, SRV and the battery, in the screen corner).
// The line is hidden by a stylesheet (extension/styles/debug_line.css), which the manifest always loads, so this script only
// switches it: while its switch is off, it puts the attribute data-kasp-show-debug-line on the page's root element, and the
// stylesheet's rule applies only without it. It runs at document_start, before the game draws anything, so the line never shows first.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_debugline';
    const SHOW_ATTRIBUTE = 'data-kasp-show-debug-line';

    function apply(on: boolean): void {
        document.documentElement.toggleAttribute(SHOW_ATTRIBUTE, !on);
    }

    // The user's switch, set in the extension's settings tab: read at start, and the switch service (src/modules/switches.ts)
    // calls back with every change, so it applies at once. Without the service the switch counts as on.
    apply(window.kaspSwitches?.isOn(SWITCH_KEY) ?? true);
    window.kaspSwitches?.onChange(SWITCH_KEY, apply);
})();
