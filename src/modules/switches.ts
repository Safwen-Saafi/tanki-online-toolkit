// Isolated-world content script: the switch service. It is the one place that knows how a feature's switch is saved: off is the
// exact text 0 under its localStorage key, on is no key, any other value is on, and a storage that cannot be read counts as on.
// It publishes window.kaspSwitches for the other modules, which share this isolated world, and loads right after language.js so
// every module finds it when it starts. The settings tab saves through set(); a live module reads its switch once and leaves an
// action with onChange(), which set() calls directly with the new value, so a change reaches it at once, with no loop and no
// event the game's page could see. A reload module just reads its switch once at start. A choice (such as the chat's target
// language) works the same way through getChoice, setChoice and onChoice: its value is the text under its key, and no key, or a
// storage that cannot be read, means the module's own default.
(function () {
    'use strict';

    const LOG = '[KI-test][switches]';
    const OFF = '0';
    const actions = new Map<string, Array<(on: boolean) => void>>();
    const choiceActions = new Map<string, Array<(value: string | null) => void>>();

    // An action that fails is warned about and the others still run, so one module cannot break another or the panel.
    function tell<T>(key: string, list: ReadonlyArray<(value: T) => void> | undefined, value: T): void {
        for (const action of list ?? []) {
            try {
                action(value);
            } catch (error: unknown) {
                console.warn(`${LOG} a module failed to apply ${key}:`, error instanceof Error ? error.message : error);
            }
        }
    }

    function listen<T>(map: Map<string, Array<(value: T) => void>>, key: string, action: (value: T) => void): void {
        const list = map.get(key);
        if (list === undefined) map.set(key, [action]);
        else list.push(action);
    }

    function isOn(key: string): boolean {
        try {
            return localStorage.getItem(key) !== OFF;
        } catch {
            return true;
        }
    }

    // Saves the switch, then tells the modules waiting on it, only when its value really changed.
    function set(key: string, on: boolean): boolean {
        const was = isOn(key);
        try {
            if (on) localStorage.removeItem(key);
            else localStorage.setItem(key, OFF);
        } catch (error: unknown) {
            console.warn(`${LOG} could not save ${key}:`, error instanceof Error ? error.message : error);
            return false;
        }
        if (was !== on) tell(key, actions.get(key), on);
        return true;
    }

    function onChange(key: string, action: (on: boolean) => void): void {
        listen(actions, key, action);
    }

    function getChoice(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    // Saves the choice (null removes it, back to the module's default), then tells the modules waiting on it, only when it changed.
    function setChoice(key: string, value: string | null): boolean {
        const was = getChoice(key);
        try {
            if (value === null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch (error: unknown) {
            console.warn(`${LOG} could not save ${key}:`, error instanceof Error ? error.message : error);
            return false;
        }
        if (was !== value) tell(key, choiceActions.get(key), value);
        return true;
    }

    function onChoice(key: string, action: (value: string | null) => void): void {
        listen(choiceActions, key, action);
    }

    window.kaspSwitches = { isOn, set, onChange, getChoice, setChoice, onChoice };
})();
