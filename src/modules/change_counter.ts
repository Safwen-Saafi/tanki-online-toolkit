// Isolated-world content script. Marks the players who changed equipment during the battle in the stats table. The game
// itself draws the column (build-plan 18a): src/injector.ts adds a header and one more cell to every player row, and the
// cell carries the player's nickname in data-kasp-change. This script only keeps the list of players who changed and
// writes one style rule that shows the marker in their cells, so there is nothing to find, measure or redraw in the page.
(function () {
    'use strict';

    const CACHE_KEY = 'kasp_player_changes_cache';
    const CELL_ATTRIBUTE = 'data-kasp-change';
    // While the root element has it, change_counter.css hides every marker.
    const BLINK_ATTRIBUTE = 'data-kasp-blink-off';
    const BLINK_MS = 500;
    const MARKER_IMAGE = chrome.runtime.getURL('icons/change-marker.webp');

    // A player can change equipment once per battle, so only "changed or not" is kept. The set survives a page reload
    // through sessionStorage and is emptied when the battle ends.
    const changedPlayers = new Set<string>();
    let isInBattle = false;
    const markerRules = document.createElement('style');

    function loadCache(): void {
        try {
            const parsed: unknown = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null');
            if (!Array.isArray(parsed)) return;
            for (const nickname of parsed) {
                if (typeof nickname === 'string') changedPlayers.add(nickname);
            }
        } catch {
            // unreadable storage or a broken value: start with nobody marked
        }
    }

    function saveCache(): void {
        try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify([...changedPlayers]));
        } catch {
            // blocked or full storage only costs the marker surviving a reload
        }
    }

    function clearCache(): void {
        changedPlayers.clear();
        try {
            sessionStorage.removeItem(CACHE_KEY);
        } catch {
            // nothing stored, nothing to clear
        }
    }

    // The one blink clock of every marker (why it is an attribute on the root element: change_counter.css). It runs only while
    // someone is marked in a battle.
    let blinkTimer: number | undefined;

    function updateBlink(): void {
        const wanted = isInBattle && changedPlayers.size > 0;
        if (wanted === (blinkTimer !== undefined)) return;
        if (wanted) {
            blinkTimer = window.setInterval(() => document.documentElement?.toggleAttribute(BLINK_ATTRIBUTE), BLINK_MS);
            return;
        }
        window.clearInterval(blinkTimer);
        blinkTimer = undefined;
        document.documentElement?.removeAttribute(BLINK_ATTRIBUTE);
    }

    // One rule for every marked player: the size, the blink and the place come from change_counter.css, this only says
    // whose cell shows the picture. A nickname is escaped, so no name can break out of its selector.
    function drawMarkers(): void {
        const selectors = [...changedPlayers].map((nickname) => `[${CELL_ATTRIBUTE}=${CSS.escape(nickname)}]::after`);
        markerRules.textContent = selectors.length === 0
            ? ''
            : `${selectors.join(',')}{content:"";background-image:url("${MARKER_IMAGE}")}`;
        if (!markerRules.isConnected) document.documentElement?.appendChild(markerRules);
        updateBlink();
    }

    function isKaspUserActionMessage(data: unknown): data is KaspUserActionMessage {
        return (
            !!data &&
            typeof data === 'object' &&
            (data as { type?: unknown }).type === 'kasp:useraction' &&
            Array.isArray((data as { detail?: unknown }).detail)
        );
    }

    // The game's equipment-change action carries the nickname as one of several plain strings and does not label it, so
    // the nickname is the first string that is none of the known tokens, has a letter, is not a "-..." number and fits
    // a nickname's length (the injector only forwards strings of 2 to 29 characters, see src/injector.ts).
    function findNickname(detail: readonly unknown[]): string | undefined {
        const found = detail.find((item) =>
            typeof item === 'string' &&
            item !== 'TankUserActionLog' &&
            item !== 'CHANGE_EQUIPMENT' &&
            item !== 'ALLY' &&
            item !== 'ENEMIES' &&
            !item.startsWith('-') &&
            /[a-zA-Z]/.test(item) &&
            item.length >= 2 && item.length < 30
        );
        return typeof found === 'string' ? found : undefined;
    }

    window.kaspMessages?.on('kasp:useraction', (data) => {
        if (!isKaspUserActionMessage(data)) return;
        const detail = data.detail;
        if (detail[0] !== 'TankUserActionLog' || !detail.includes('CHANGE_EQUIPMENT')) return;

        const nickname = findNickname(detail);
        if (!nickname || changedPlayers.has(nickname)) return;

        changedPlayers.add(nickname);
        saveCache();
        drawMarkers();
    });

    // The end of the battle has no message of its own, so the battle service (src/modules/battle.ts) says when the battle
    // canvas goes away.
    function onBattle(on: boolean): void {
        isInBattle = on;
        if (on) {
            updateBlink();
            return;
        }
        clearCache();
        drawMarkers();
    }

    loadCache();
    if (document.documentElement) drawMarkers();
    else document.addEventListener('DOMContentLoaded', drawMarkers, { once: true });

    // The game draws the change column's header itself, with this picture; only this world can ask the extension for its
    // address.
    window.postMessage({ type: 'kasp:change-header', address: chrome.runtime.getURL('icons/change-header.svg') }, window.location.origin);

    window.kaspBattle?.onChange(onBattle);
})();
