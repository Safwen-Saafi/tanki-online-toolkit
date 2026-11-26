// Isolated-world half of the lobby's hangar files (build-plan 26e). Only this world can ask Chrome for the extension's own address, so
// while the lobby look is on (kasp_lobby) it puts the address of the bundled hangar files on the page's root element
// (data-kasp-hangar-base), where src/modules/hangar_files.ts (MAIN world) and the later lobby parts read it.
(function () {
    'use strict';

    try {
        // the battle search sounds (26d step 9, lobby_search.ts) whatever the lobby look
        document.documentElement.setAttribute('data-kasp-sounds-base', chrome.runtime.getURL('sounds/'));
        if (localStorage.getItem('kasp_lobby') === '0') return;
        document.documentElement.setAttribute('data-kasp-hangar-base', chrome.runtime.getURL('hangars/'));
        // the lobby's own pictures (the Tanki logo on the waiting room's walls, lobby.ts)
        document.documentElement.setAttribute('data-kasp-lobby-base', chrome.runtime.getURL('lobby/'));
    } catch {
        // no address: the bundled files are not read
    }
})();
