// MAIN-world content script (owner 2026-11-26, the search lag): which of the game's screens and windows are on the page, written on
// <html> as marks the stylesheets read (lobby.css, lobby_ui.css) instead of a :has() on <html>. A :has() on <html> made Chrome
// search the whole page again for each of about 200 elements whenever anything changed anywhere (the search timer's number, once a
// second): about 40 ms each time, a stutter every second of the search (the owner's trace "sex", 2026-11-26).
// One check a frame (the owner's pick: something going away has no CSS signal): the game's live element lists, which the browser
// keeps up to date by itself and answers at once while the page is unchanged. PLAY and the search box are looked at on every
// screen; the rest only with PLAY on the page (they are lobby windows), the group button only with PLAY or the search box. The
// garage's screens (showroom_*.css, owner 2026-11-26: the garage part of the same fix) only with the garage on the page.
(function () {
    'use strict';

    const root = document.documentElement;
    const live = (cls: string): HTMLCollectionOf<Element> => document.getElementsByClassName(cls);
    const play = live('MainScreenComponentStyle-playButtonContainer');
    const search = live('MatchmakingWaitComponentStyle-container');
    const loader = live('LobbyLoaderComponentStyle-container');
    const news = live('NewsComponentStyle-newsWindow');
    const chat = live('ChatComponentStyle-chatWindow');
    const tabBars = live('GarageMenuComponentStyle-garageMenuContainer');
    const headers = live('BreadcrumbsComponentStyle-headerContainer');
    const garage = live('GarageCommonStyle-garageContainer');
    const paints = live('PaintsCollectionComponentStyle-containerPaints');
    const grenades = live('TanksPartComponentStyle-amountItems');
    const protection = live('GarageProtectionsComponentStyle-blockParametersProtection');
    const supplies = live('GarageSuppliesComponentStyle-blockStats');
    const drones = live('TanksPartComponentStyle-descriptionContainer GarageCommonStyle-animatedBlurredLeftBlock');
    const ITEM = 'MenuComponentStyle-mainMenuItem';
    // on the page: the first one only (a list's length counts the whole page after a change, its first entry stops at the first)
    const on = (list: HTMLCollectionOf<Element>): boolean => list[0] !== undefined;
    const FRIENDS = '[class*="FriendListComponentStyle-"], [class*="FriendRequestComponentStyle-"]';
    const GROUP = '[class*="UserGroupTitleButtonComponentStyle-"]';
    // a search for a part that is not there is tried again every RETRY frames, not on every one
    const RETRY = 10;

    // the friends screen over the lobby: a part of the friends list or the requests after the garage's tab bar (in it, or itself)
    function findFriends(): Element | null {
        for (const bar of Array.from(tabBars)) {
            for (let s = bar.nextElementSibling; s !== null; s = s.nextElementSibling) {
                if (s.matches(FRIENDS)) return s;
                const inner = s.querySelector(FRIENDS);
                if (inner !== null) return inner;
            }
        }
        return null;
    }
    // the group button in the top bar
    function findGroup(): Element | null {
        for (const h of Array.from(headers)) {
            const g = h.querySelector(GROUP);
            if (g !== null) return g;
        }
        return null;
    }

    // Turrets or Hulls: the garage's own tab bar (the one with a 7th tab) has its 1st or 2nd tab lit; its tabs are siblings
    function itemScreen(box: Element): boolean {
        const parent = box.getElementsByClassName(ITEM)[0]?.parentElement;
        if (parent === null || parent === undefined) return false;
        let count = 0;
        let lit = false;
        const kids = parent.children;
        for (let i = 0; i < kids.length; i++) {
            const child = kids[i];
            if (!child.classList.contains(ITEM)) continue;
            count++;
            if (count <= 2 && child.className.includes('activeMenu')) lit = true;
            if (count === 7) return lit;
        }
        return false;
    }

    // a part found by a search: kept while it is still on the page, searched again (every RETRY frames) when it is not
    type Kept = { el: Element | null; wait: number };
    const friends: Kept = { el: null, wait: 0 };
    const group: Kept = { el: null, wait: 0 };
    function keep(k: Kept, find: () => Element | null): boolean {
        if (k.el !== null && k.el.isConnected) return true;
        k.el = null;
        if (k.wait > 0) {
            k.wait--;
            return false;
        }
        k.el = find();
        if (k.el === null) k.wait = RETRY;
        return k.el !== null;
    }

    const now: Record<string, boolean> = {};
    function mark(name: string, on: boolean): void {
        if (now[name] === on) return;
        now[name] = on;
        if (on) root.setAttribute(name, '');
        else root.removeAttribute(name);
    }

    // It runs in battles too (owner 2026-11-26): stopped there, the lobby came back from a battle without its marks (the game's plain
    // lobby for a moment) until battle.ts's next look, twice a second; in a battle it costs the two live lists' answers a frame.
    function frame(): void {
        const atPlay = on(play);
        const atSearch = on(search);
        mark('data-kasp-at-play', atPlay);
        mark('data-kasp-at-search', atSearch);
        mark('data-kasp-at-loader', atPlay && on(loader));
        mark('data-kasp-at-news', atPlay && on(news));
        mark('data-kasp-at-chat', atPlay && on(chat));
        mark('data-kasp-at-friends', atPlay && on(tabBars) && keep(friends, findFriends));
        mark('data-kasp-at-group', (atPlay || atSearch) && keep(group, findGroup));
        const box = garage[0];
        const atGarage = box !== undefined;
        // showroom.css keeps the studio room shown in a battle while the garage is open over it (owner 2026-11-27)
        mark('data-kasp-at-garage', atGarage);
        mark('data-kasp-at-paints', atGarage && on(paints));
        mark('data-kasp-at-grenades', atGarage && on(grenades));
        mark('data-kasp-at-protection', atGarage && on(protection));
        mark('data-kasp-at-supplies', atGarage && on(supplies));
        mark('data-kasp-at-drones', atGarage && on(drones));
        mark('data-kasp-at-item', atGarage && itemScreen(box));
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
})();
