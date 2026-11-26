// Isolated-world content script: the message service. The injector and the modules talk through window.postMessage, and every
// message posted on the page reaches every message listener of this world, the game's own messages too (its coroutines post
// one for each batch of work). So this world has one listener, here: it drops anything that is not an object with a type at
// once, and hands the rest to the modules waiting for that type. It publishes window.kaspMessages for the other modules, which
// share this isolated world, and loads right after switches.js, so every module finds it when it starts.
(function () {
    'use strict';

    const LOG = '[KI-test][messages]';
    const actions = new Map<string, Array<(data: Readonly<Record<string, unknown>>) => void>>();

    window.addEventListener('message', (event: MessageEvent) => {
        // The injector posts from the page to this same window; anything else is not ours.
        if (event.source !== window) return;
        const data: unknown = event.data;
        if (data === null || typeof data !== 'object') return;
        const type = (data as { type?: unknown }).type;
        if (typeof type !== 'string') return;
        const list = actions.get(type);
        if (list === undefined) return;
        // An action that fails is warned about and the others still run, as when each module had its own listener.
        for (const action of list) {
            try {
                action(data as Readonly<Record<string, unknown>>);
            } catch (error: unknown) {
                console.warn(`${LOG} a module failed to read ${type}:`, error instanceof Error ? error.message : error);
            }
        }
    });

    function on(type: string, action: (data: Readonly<Record<string, unknown>>) => void): void {
        const list = actions.get(type);
        if (list === undefined) actions.set(type, [action]);
        else list.push(action);
    }

    window.kaspMessages = { on };
})();
