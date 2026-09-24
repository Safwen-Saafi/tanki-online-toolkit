"use strict";
(function () {
    'use strict';
    window.__kaspSendAction = function (className, obj) {
        try {
            let res = [className];
            let seen = new Set();
            function safeWalk(o, depth) {
                if (depth > 2 || !o || typeof o !== 'object' || seen.has(o))
                    return;
                seen.add(o);
                let keys = [];
                try {
                    keys = Object.keys(o);
                }
                catch (e) {
                    return;
                }
                for (let i = 0; i < keys.length; i++) {
                    let k = keys[i];
                    let v;
                    try {
                        v = o[k];
                    }
                    catch (e) {
                        continue;
                    }
                    if (v != null) {
                        if (typeof v === 'string' || typeof v === 'number') {
                            let strVal = String(v).trim();
                            if (strVal && strVal.length >= 2 && strVal.length < 30) {
                                res.push(strVal);
                            }
                        }
                        else if (typeof v === 'object' && depth < 2) {
                            safeWalk(v, depth + 1);
                        }
                    }
                }
            }
            safeWalk(obj, 0);
            window.postMessage({ type: 'kasp:useraction', detail: res }, '*');
        }
        catch (e) { }
    };
    console.log('[KI-test][injector] MAIN-world injector loaded at', document.readyState);
    const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of Array.from(m.addedNodes)) {
                if (node instanceof HTMLScriptElement && node.src.includes('/static/js/main.')) {
                    console.log('[KI-test][injector] caught main bundle tag:', node.src);
                    node.type = 'javascript/blocked';
                    node.remove();
                    observer.disconnect();
                    fetch(node.src)
                        .then(res => res.text())
                        .then(code => {
                        console.log('[KI-test][injector] fetched bundle, length:', code.length);
                        const match = /return"TankUserActionLog\(\w+="\+(?:\w+\()?this\.(\w+)/.exec(code);
                        if (match) {
                            const propName = match[1];
                            console.log('[KI-test][injector] step1 regex matched, propName =', propName);
                            const p = new RegExp(`(function [\\w$]+\\([^)]{1,150}\\)\\{[^{}]{0,800}?this\\.${propName}=[\\w$]+(?:,this\\.[\\w$]+=[\\w$]+){0,30})\\}`);
                            if (p.test(code)) {
                                code = code.replace(p, `$1, window.__kaspSendAction("TankUserActionLog", this)}`);
                                console.log('[KI-test][injector] step2 patch applied OK — hook installed');
                            } else {
                                console.warn('[KI-test][injector] step2 FAILED — constructor pattern not found for propName "' + propName + '".');
                            }
                        } else {
                            console.warn('[KI-test][injector] step1 FAILED — could not find TankUserActionLog property name in this bundle.');
                        }
                        const script = document.createElement('script');
                        script.textContent = code;
                        (document.head || document.documentElement).appendChild(script);
                        console.log('[KI-test][injector] bundle re-injected, patched:', code.includes('__kaspSendAction'));
                    });
                }
            }
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setTimeout(() => {
        if (!document.querySelector('script[data-kasp-patched]')) {
            const stillUnpatched = [...document.scripts].some(s => s.src.includes('/static/js/main.'));
            if (stillUnpatched) {
                console.error('[KI-test][injector] WATCHDOG: original main.*.js is still present UNBLOCKED after 8s — observer lost the race even in MAIN world. This would be very unusual.');
            } else {
                console.log('[KI-test][injector] WATCHDOG: original tag no longer present as an unblocked script — patch path likely ran.');
            }
        }
    }, 8000);
})();
