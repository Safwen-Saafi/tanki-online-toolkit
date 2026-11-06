// Isolated-world content script: the switch service. It is the one place that knows how a feature's switch is saved: off is the
// exact text 0 under its localStorage key, on is no key, any other value is on, and a storage that cannot be read counts as on.
// It publishes window.kaspSwitches for the other modules, which share this isolated world, and loads right after language.js so
// every module finds it when it starts. The settings tab saves through set(); a live module reads its switch once and leaves an
// action with onChange(), which set() calls directly with the new value, so a change reaches it at once, with no loop and no
// event the game's page could see. A reload module just reads its switch once at start.
(function () {
    'use strict';

    const LOG = '[KI-test][switches]';
    const OFF = '0';
    const actions = new Map<string, Array<(on: boolean) => void>>();

    function isOn(key: string): boolean {
        try {
            return localStorage.getItem(key) !== OFF;
        } catch {
            return true;
        }
    }

    // Saves the switch, then tells the modules waiting on it, only when its value really changed. An action that fails is warned
    // about and the others still run, so one module cannot break another or the panel.
    function set(key: string, on: boolean): boolean {
        const was = isOn(key);
        try {
            if (on) localStorage.removeItem(key);
            else localStorage.setItem(key, OFF);
        } catch (error: unknown) {
            console.warn(`${LOG} could not save ${key}:`, error instanceof Error ? error.message : error);
            return false;
        }
        if (was === on) return true;
        for (const action of actions.get(key) ?? []) {
            try {
                action(on);
            } catch (error: unknown) {
                console.warn(`${LOG} a module failed to apply ${key}:`, error instanceof Error ? error.message : error);
            }
        }
        return true;
    }

    function onChange(key: string, action: (on: boolean) => void): void {
        const list = actions.get(key);
        if (list === undefined) actions.set(key, [action]);
        else list.push(action);
    }

    window.kaspSwitches = { isOn, set, onChange };
})();
