// Isolated-world content script: the battle service. It is the one place that checks whether a battle is on screen: the game's
// battle canvas, .BattleComponentStyle-canvasContainer, exists only then. One clock for every module, so a battle wakes the page
// twice a second for this instead of once for each module that needs to know. It publishes window.kaspBattle for the other
// modules, which share this isolated world: isOn(), and onChange(action), which is called with the new value only when it
// changes. It loads right after switches.js, so every module finds it when it starts.
(function () {
    'use strict';

    const LOG = '[KI-test][battle]';
    const CHECK_MS = 500;
    // A live list, so the check reads the page again only after the page changed.
    const canvases = document.getElementsByClassName('BattleComponentStyle-canvasContainer');
    const actions: Array<(on: boolean) => void> = [];
    let inBattle = false;

    function check(): void {
        const now = canvases[0] !== undefined;
        if (now === inBattle) return;
        inBattle = now;
        // An action that fails is warned about and the others still run, so one module cannot break another.
        for (const action of actions) {
            try {
                action(inBattle);
            } catch (error: unknown) {
                console.warn(`${LOG} a module failed to follow the battle:`, error instanceof Error ? error.message : error);
            }
        }
    }

    window.kaspBattle = {
        isOn: () => inBattle,
        onChange: (action) => {
            actions.push(action);
        },
    };
    setInterval(check, CHECK_MS);
})();
