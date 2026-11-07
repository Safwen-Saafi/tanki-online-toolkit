// Isolated-world content script for the narrower garage cards. The cards are made narrower by a stylesheet
// (extension/styles/garage_cards.css), which the manifest always loads, so this script only switches it: while its switch is
// off, it puts the attribute data-kasp-wide-cards on the page's root element, and every rule of that stylesheet applies only
// without it. It runs at document_start, before the garage is drawn, so the cards never show at the other width first.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_narrowcards';
    const WIDE_ATTRIBUTE = 'data-kasp-wide-cards';

    function apply(on: boolean): void {
        document.documentElement.toggleAttribute(WIDE_ATTRIBUTE, !on);
    }

    // The user's switch, set in the extension's settings tab: read at start, and the switch service (src/modules/switches.ts)
    // calls back with every change, so it applies at once. Without the service the switch counts as on.
    apply(window.kaspSwitches?.isOn(SWITCH_KEY) ?? true);
    window.kaspSwitches?.onChange(SWITCH_KEY, apply);
})();
