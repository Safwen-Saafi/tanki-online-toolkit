// Isolated-world content script (same world type as the real extension's kasp_main.js).
// Detection logic ported from modules.changeCounter (src/kasp_main.ts:2840-2952). The
// marker is its own cell, pinned at fixed coordinates in the space past the kills/deaths
// column rather than inserted into the row's flow - the game's own stat cells are pinned
// the same way, so nothing in that row responds to flex order or column widths. See
// change_counter.css. The cell is added to every row, visible or not, so the layout never
// shifts when a player changes equipment mid-battle.
(function () {
    'use strict';

    const CACHE_KEY = 'kasp_player_changes_cache';
    const STATS_CONTAINER_SELECTOR = '.BattleTabStatisticComponentStyle-container';
    const BATTLE_CANVAS_SELECTOR = '.BattleComponentStyle-canvasContainer';
    const MARKER_TITLE = 'Changed equipment during this battle';
    const MARKER_IMAGE = `url("${chrome.runtime.getURL('icons/change-marker.webp')}")`;

    // A player can change equipment once per battle, so only "changed or not" is kept. The set survives a page reload
    // through sessionStorage and is emptied when the battle ends.
    const changedPlayers = new Set<string>();
    let isInBattle = false;

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

    window.addEventListener('message', (e: MessageEvent) => {
        // The injector posts from the page to this same window; anything else is not ours.
        if (e.source !== window) return;
        const data: unknown = e.data;
        if (!isKaspUserActionMessage(data)) return;
        const detail = data.detail;
        if (detail[0] !== 'TankUserActionLog' || !detail.includes('CHANGE_EQUIPMENT')) return;

        const nickname = findNickname(detail);
        if (!nickname) return;

        changedPlayers.add(nickname);
        saveCache();
        sync();
    });

    function checkBattleCanvas(): void {
        const currentInBattle = document.querySelector(BATTLE_CANVAS_SELECTOR) !== null;
        if (currentInBattle === isInBattle) return;
        isInBattle = currentInBattle;
        if (!isInBattle) {
            clearCache();
            sync();
        }
    }

    function createMarkerCell(): HTMLElement {
        const td = document.createElement('td');
        td.className = 'kasp-change-td';
        const icon = document.createElement('span');
        icon.className = 'kasp-change-icon';
        icon.title = MARKER_TITLE;
        icon.style.backgroundImage = MARKER_IMAGE;
        td.appendChild(icon);
        return td;
    }

    // Gives every player row its marker cell and lights the ones whose player changed. Returns the first cell, which
    // the header is aligned to.
    function syncRows(table: HTMLTableElement): HTMLElement | null {
        let firstTd: HTMLElement | null = null;
        for (const row of table.querySelectorAll('tbody > tr')) {
            const nicknameCell = row.querySelector('.BattleTabStatisticComponentStyle-nicknameCell');
            if (!nicknameCell) continue;

            let td = row.querySelector<HTMLElement>('.kasp-change-td');
            if (!td) {
                td = createMarkerCell();
                row.appendChild(td);
            }
            firstTd ??= td;

            // "[CLAN] Nick" shows the clan tag first; only the nickname is matched.
            const nickname = (nicknameCell.textContent ?? '').replace(/^\[.*?\]\s*/, '').trim();
            if (!nickname) continue;
            td.classList.toggle('kasp-changed', changedPlayers.has(nickname));
        }
        return firstTd;
    }

    function ensureHeaderCell(headerRow: Element): HTMLElement {
        let th = headerRow.querySelector<HTMLElement>('.kasp-change-th');
        if (!th) {
            th = document.createElement('th');
            th.className = 'kasp-change-th';
            th.textContent = '⇄';
            th.title = MARKER_TITLE;
            headerRow.appendChild(th);
        }
        return th;
    }

    function positionHeaderCell(th: HTMLElement, headerRow: Element, firstTd: HTMLElement | null): void {
        const headerRect = headerRow.getBoundingClientRect();

        // The header keeps its original width while the body rows stretch with
        // the widened panel, so the two have different right edges - anchoring
        // both to `right` drops the label on top of the last header icon. The
        // header cell is measured against the body column instead, which stays
        // correct whatever the panel is widened to.
        if (firstTd) {
            th.style.left = `${firstTd.getBoundingClientRect().left - headerRect.left}px`;
        }

        // Vertically the game's labels sit in their own band rather than filling
        // the header row, so the neighbouring label is copied instead of
        // stretching to the row's full height.
        const neighbour = th.previousElementSibling;
        if (neighbour) {
            const neighbourRect = neighbour.getBoundingClientRect();
            th.style.top = `${neighbourRect.top - headerRect.top}px`;
            th.style.height = `${neighbourRect.height}px`;
        }
    }

    function sync(): void {
        const container = document.querySelector(STATS_CONTAINER_SELECTOR);
        if (!container) return;

        for (const table of container.querySelectorAll('table')) {
            const firstTd = syncRows(table);
            const headerRow = table.querySelector('thead > tr');
            if (!headerRow) continue;
            positionHeaderCell(ensureHeaderCell(headerRow), headerRow, firstTd);
        }
    }

    // Polling made the marker appear a beat after the panel did, because the panel
    // renders and the next tick is up to an interval away. Reacting to the DOM
    // change instead injects it on the very next frame. Throttled to one pass per
    // frame, since the stats table mutates constantly as scores tick.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            checkBattleCanvas();
            sync();
        });
    });

    function startObserving(): void {
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    loadCache();

    if (document.documentElement) startObserving();
    else document.addEventListener('DOMContentLoaded', startObserving, { once: true });

    // Safety net for any state reached without a DOM mutation.
    setInterval(() => {
        checkBattleCanvas();
        sync();
    }, 1000);
})();
