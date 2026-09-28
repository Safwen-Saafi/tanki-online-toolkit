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
    const playerChanges = new Map<string, number>();
    let isInBattle = false;

    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const parsed: unknown = JSON.parse(cached);
            if (parsed && typeof parsed === 'object') {
                for (const [nick, count] of Object.entries(parsed as Record<string, number>)) {
                    playerChanges.set(nick, count);
                }
            }
        }
    } catch (e) {}

    function saveCache(): void {
        const obj: Record<string, number> = {};
        playerChanges.forEach((count, nick) => { obj[nick] = count; });
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    }

    function clearCache(): void {
        playerChanges.clear();
        sessionStorage.removeItem(CACHE_KEY);
    }

    function isKaspUserActionMessage(data: unknown): data is KaspUserActionMessage {
        return (
            !!data &&
            typeof data === 'object' &&
            (data as { type?: unknown }).type === 'kasp:useraction' &&
            Array.isArray((data as { detail?: unknown }).detail)
        );
    }

    window.addEventListener('message', (e: MessageEvent) => {
        const data: unknown = e.data;
        if (!isKaspUserActionMessage(data)) return;
        const detail = data.detail;
        if (detail[0] !== 'TankUserActionLog' || !detail.includes('CHANGE_EQUIPMENT')) return;

        const nickname = detail.find((item) =>
            typeof item === 'string' &&
            item !== 'TankUserActionLog' &&
            item !== 'CHANGE_EQUIPMENT' &&
            item !== 'ALLY' &&
            item !== 'ENEMIES' &&
            !item.startsWith('-') &&
            /[a-zA-Z]/.test(item) &&
            item.length >= 2 && item.length < 30
        );
        if (!nickname) return;

        playerChanges.set(nickname, (playerChanges.get(nickname) ?? 0) + 1);
        saveCache();
        console.log('[KI-test] CHANGE_EQUIPMENT ->', nickname, 'count:', playerChanges.get(nickname));
        if (document.querySelector('.BattleTabStatisticComponentStyle-container')) {
            sync();
        }
    });

    document.addEventListener('kasp:battle:id', () => {
        clearCache();
        sync();
    });

    function checkBattleCanvas(): void {
        const currentInBattle = !!document.querySelector('.BattleComponentStyle-canvasContainer');
        if (currentInBattle !== isInBattle) {
            isInBattle = currentInBattle;
            if (!isInBattle) {
                clearCache();
                sync();
            }
        }
    }

    function sync(): void {
        const container = document.querySelector('.BattleTabStatisticComponentStyle-container');
        if (!container) return;

        const tables = container.querySelectorAll('table');
        for (let t = 0; t < tables.length; t++) {
            const table = tables[t];
            let firstTd: HTMLElement | null = null;

            const bodyRows = table.querySelectorAll('tbody > tr');
            for (let i = 0; i < bodyRows.length; i++) {
                const row = bodyRows[i];
                const cell = row.querySelector('.BattleTabStatisticComponentStyle-nicknameCell');
                if (!cell) continue;

                let td = row.querySelector<HTMLElement>('.kasp-change-td');
                if (!td) {
                    td = document.createElement('td');
                    td.className = 'kasp-change-td';
                    td.innerHTML = '<span class="kasp-change-icon" title="Changed equipment during this battle">⚠</span>';
                    row.appendChild(td);
                }
                if (!firstTd) firstTd = td;

                const nickname = (cell.textContent || '').replace(/^\[.*?\]\s*/, '').trim();
                if (!nickname) continue;

                const count = playerChanges.get(nickname) ?? 0;
                td.classList.toggle('kasp-changed', count > 0);
            }

            const headerRow = table.querySelector('thead > tr');
            if (!headerRow) continue;

            let th = headerRow.querySelector<HTMLElement>('.kasp-change-th');
            if (!th) {
                th = document.createElement('th');
                th.className = 'kasp-change-th';
                th.textContent = '⇄';
                th.title = 'Changed equipment during this battle';
                headerRow.appendChild(th);
            }

            // The header keeps its original width while the body rows stretch with
            // the widened panel, so the two have different right edges - anchoring
            // both to `right` drops the label on top of the last header icon. The
            // header cell is measured against the body column instead, which stays
            // correct whatever the panel is widened to.
            const headerRect = headerRow.getBoundingClientRect();
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

    if (document.documentElement) startObserving();
    else document.addEventListener('DOMContentLoaded', startObserving, { once: true });

    // Safety net for any state reached without a DOM mutation.
    setInterval(() => {
        checkBattleCanvas();
        sync();
    }, 1000);

    console.log('[KI-test] changeCounter isolated-world content script loaded');
})();
