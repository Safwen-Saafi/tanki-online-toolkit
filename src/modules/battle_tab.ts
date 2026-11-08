// Isolated-world content script for the battle tab's coloured protections (build-plan 18c). The colours are a stylesheet
// (extension/styles/battle_tab.css), which the manifest always loads, so this script only switches it: while its switch is
// off, it puts the attribute data-kasp-plain-protections on the page's root element, and every colour rule applies only
// without it, so the game's own icons show.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_protectioncolours';
    const PLAIN_ATTRIBUTE = 'data-kasp-plain-protections';

    function apply(on: boolean): void {
        document.documentElement.toggleAttribute(PLAIN_ATTRIBUTE, !on);
    }

    // The user's switch, set in the extension's settings tab: read at start, and the switch service (src/modules/switches.ts)
    // calls back with every change, so it applies at once. Without the service the switch counts as on.
    apply(window.kaspSwitches?.isOn(SWITCH_KEY) ?? true);
    window.kaspSwitches?.onChange(SWITCH_KEY, apply);
})();
