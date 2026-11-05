// Isolated-world content script for the extension's tab in the game's settings screen. The tab itself is drawn by the game:
// src/injector.ts adds it to the game's own tab list, bar and panel tables (the settings-tab hook), and the game gives our tab
// an empty panel box. This script will fill that box with our panel (build-plan 17a step 2).
// See blueprint/context/settings-tab.md (the game's settings screen, what was proven on it).
(function () {
    'use strict';

    const LOG = '[KI-test][settings_tab]';

    console.log(`${LOG} ready`);
})();
