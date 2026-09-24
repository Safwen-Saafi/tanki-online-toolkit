// Isolated-world content script (same world type as the real extension's kasp_main.js).
// Detection logic ported from modules.changeCounter (src/kasp_main.ts:2840-2952). The
// visual marker here is intentionally simplified from the production version: instead of a
// separate flex-column table cell (which depends on mainUI.css fixing every other column's
// width), it's a small self-contained span appended right next to the nickname text, with
// its own inline styles only. No game CSS is loaded or modified by this test build.
(function () {
    'use strict';

    const CACHE_KEY = 'kasp_player_changes_cache';
    const playerChanges = new Map();
    let isInBattle = false;

    try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
            const parsed = JSON.parse(cached);
            for (const [nick, count] of Object.entries(parsed)) {
                playerChanges.set(nick, count);
            }
        }
    } catch (e) {}

    function saveCache() {
        const obj = {};
        playerChanges.forEach((count, nick) => { obj[nick] = count; });
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    }

    function clearCache() {
        playerChanges.clear();
        sessionStorage.removeItem(CACHE_KEY);
    }

    window.addEventListener('message', (e) => {
        const data = e.data;
        if (!data || data.type !== 'kasp:useraction') return;
        const detail = data.detail;
        if (!Array.isArray(detail)) return;
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

    function checkBattleCanvas() {
        const currentInBattle = !!document.querySelector('.BattleComponentStyle-canvasContainer');
        if (currentInBattle !== isInBattle) {
            isInBattle = currentInBattle;
            if (!isInBattle) {
                clearCache();
                sync();
            }
        }
    }

    function sync() {
        const container = document.querySelector('.BattleTabStatisticComponentStyle-container');
        if (!container) return;

        const bodyRows = container.querySelectorAll('table > tbody > tr');
        for (let i = 0; i < bodyRows.length; i++) {
            const row = bodyRows[i];
            const cell = row.querySelector('.BattleTabStatisticComponentStyle-nicknameCell');
            if (!cell) continue;
            const nickname = (cell.textContent || '').replace(/^\[.*?\]\s*/, '').trim();
            if (!nickname) continue;
            const count = playerChanges.get(nickname) ?? 0;

            let mark = cell.querySelector('.kasp-change-mark');
            if (count > 0) {
                if (!mark) {
                    mark = document.createElement('span');
                    mark.className = 'kasp-change-mark';
                    mark.textContent = '⚠';
                    mark.title = 'Changed equipment during this battle';
                    mark.style.cssText = 'margin-left:0.3em; color:#ff4d4d; font-weight:bold;';
                    cell.appendChild(mark);
                }
            } else if (mark) {
                mark.remove();
            }
        }
    }

    setInterval(() => {
        checkBattleCanvas();
        sync();
    }, 250);

    console.log('[KI-test] changeCounter isolated-world content script loaded');
})();
