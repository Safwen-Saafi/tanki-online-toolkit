// MAIN-world content script (owner 2026-11-26, the search lag): which of the game's screens and windows are on the page, written on
// <html> as marks the stylesheets read (lobby.css, lobby_ui.css) instead of a :has() on <html>. A :has() on <html> made Chrome
// search the whole page again for each of about 200 elements whenever anything changed anywhere (the search timer's number, once a
// second): about 40 ms each time, a stutter every second of the search (the owner's trace "sex", 2026-11-26).
// One check a frame (the owner's pick: something going away has no CSS signal): the game's live element lists, which the browser
// keeps up to date by itself and answers at once while the page is unchanged. PLAY and the search box are looked at on every
// screen; the rest only with PLAY on the page (they are lobby windows), the group button only with PLAY or the search box.
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

    // In a battle none of these screens can be there: the frame check stops and every mark comes off until the battle ends
    // (owner 2026-11-26). This script does not look for the battle itself: src/modules/core/battle.ts (the one battle check) writes
    // data-kasp-battle on <html> and sends kasp:battle at each change.
    const BATTLE_MARK = 'data-kasp-battle';
    // the next frame's check, 0 while stopped (cancelled at once, so a battle that ends before it ran never leaves two loops)
    let next = 0;
    function follow(): void {
        if (root.hasAttribute(BATTLE_MARK)) {
            cancelAnimationFrame(next);
            next = 0;
            for (const name of Object.keys(now)) mark(name, false);
        } else if (next === 0) {
            next = requestAnimationFrame(frame);
        }
    }
    window.addEventListener('kasp:battle', follow);

    function frame(): void {
        const atPlay = play.length > 0;
        const atSearch = search.length > 0;
        mark('data-kasp-at-play', atPlay);
        mark('data-kasp-at-search', atSearch);
        mark('data-kasp-at-loader', atPlay && loader.length > 0);
        mark('data-kasp-at-news', atPlay && news.length > 0);
        mark('data-kasp-at-chat', atPlay && chat.length > 0);
        mark('data-kasp-at-friends', atPlay && tabBars.length > 0 && keep(friends, findFriends));
        mark('data-kasp-at-group', (atPlay || atSearch) && keep(group, findGroup));
        next = requestAnimationFrame(frame);
    }
    follow();
})();
