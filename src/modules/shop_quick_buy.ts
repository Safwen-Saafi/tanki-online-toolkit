// MAIN-world content script for the daily offer quick buying (build-plan 24, see blueprint/context/shop-quick-buy.md). It runs in the
// page's own world because the Buy all button clicks each card the way the game's own click handler does, and that handler is
// only reachable from there. The injector (src/injector.ts) changes the game's code at start, only while the switch kasp_shopquickbuy
// is on: a showcase card click leaves a note so the game's "Purchase successful" dialog draws nothing, and each showcase card, when
// the game mounts it, calls window.__kaspShopCard, which adds the Buy all button once. This file defines that function and the
// signal window.__kaspShopDialogShown that the injector calls when it has skipped a dialog, which is how a buy-all knows a purchase
// went through. With the switch off none of the game's calls arrive, and this file does nothing.
// Nothing watches the page: no observer, no interval, no polling. The only timers are one-shot timeouts that start from a click or
// from a purchase and end by themselves: 150 ms between two purchases, one stop timer of a few seconds that is cleared by the
// signal, and one short timeout after a purchase that greys the button when every card is taken. This file draws no dialog: the
// cards turning SOLD and the greyed button are the feedback, and a refused purchase is explained by the game's own message.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_shopquickbuy';
    const GRID_SELECTOR = '[class*="ShopCategoryOfferSectionStyle-containerItem"]';
    const CARD_SELECTOR = '.shop-item-component';
    // A card that cannot be bought (sold, or disabled for another reason) has this overlay.
    const OVERLAY_SELECTOR = '[class*="ShowcaseItemComponentStyle-disabledBackground"]';
    const GRID_MARK = 'data-kasp-buyall';
    const BUTTON_CLASS = 'kasp-buyall';
    // The game ignores a card click while an earlier purchase waits for its answer; it was proven to take a card again 150 ms after
    // the previous one turned SOLD. A purchase with no answer after STOP_MS ends the run (this is also what ends it when the game
    // refuses a purchase, for example for too few crystals: the game then draws its own message and no success dialog).
    const NEXT_CARD_MS = 150;
    const STOP_MS = 6000;
    // After a purchase went through, the card turns SOLD about as fast as the success dialog mounts; this leaves it room.
    const REFRESH_MS = 400;

    const BUTTON_TEXT: Readonly<Record<KaspLanguageCode, string>> = { EN: 'Buy all', RU: 'Купить всё' };

    // This file shares no code with the extension's isolated world, so it works out the game's language itself, as language.ts does
    // from the same two places, when the button is made.
    function buttonText(): string {
        try {
            const raw = (localStorage.getItem('language_store_key') ?? document.documentElement.lang ?? '').toLowerCase();
            return raw.split(/[-_]/)[0] === 'ru' ? BUTTON_TEXT.RU : BUTTON_TEXT.EN;
        } catch {
            return BUTTON_TEXT.EN;
        }
    }

    function isSwitchedOff(): boolean {
        try {
            return localStorage.getItem(SWITCH_KEY) === '0';
        } catch {
            return false;
        }
    }

    function isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }

    function cardsOf(grid: Element): HTMLElement[] {
        return [...grid.querySelectorAll<HTMLElement>(CARD_SELECTOR)];
    }

    function isTaken(card: Element): boolean {
        return card.querySelector(OVERLAY_SELECTOR) !== null;
    }

    // The card's own click function: the game's host element for the card carries it in its React props, the same function a
    // mouse click calls, so the game checks and does everything itself.
    function clickHandlerOf(card: Element): ((event: unknown) => void) | null {
        const key = Object.keys(card).find((name) => name.startsWith('__reactFiber$'));
        if (key === undefined) return null;
        let fiber: unknown = (card as unknown as Record<string, unknown>)[key];
        for (let depth = 0; depth < 4 && isObject(fiber); depth++) {
            const props = fiber['memoizedProps'];
            if (isObject(props) && typeof props['onClick'] === 'function') return props['onClick'] as (event: unknown) => void;
            fiber = fiber['return'];
        }
        return null;
    }

    function currentGrid(): Element | null {
        return document.querySelector(GRID_SELECTOR);
    }

    // The button is greyed while every card of the grid has its overlay (nothing left to buy). It stays clickable on purpose: a click
    // counts the cards again, so a wrong grey could never lock the button.
    function refreshButton(): void {
        const grid = currentGrid();
        if (grid === null) return;
        const button = grid.querySelector(`.${BUTTON_CLASS}`);
        if (button === null) return;
        const cards = cardsOf(grid);
        button.classList.toggle('kasp-done', cards.length > 0 && cards.every(isTaken));
    }

    let refreshTimer = 0;

    function refreshSoon(): void {
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(refreshButton, REFRESH_MS);
    }

    function setBusy(busy: boolean): void {
        document.getElementById(BUTTON_CLASS)?.classList.toggle('kasp-busy', busy);
    }

    // ---- Buy all ----

    // One run at a time. It buys the cards that had no overlay when it started, in the grid's order: it clicks one card, waits for
    // the signal that the game's success dialog was skipped (the purchase went through), waits NEXT_CARD_MS, then clicks the next.
    interface Run {
        readonly queue: number[];
        stopTimer: number;
        nextTimer: number;
    }

    let run: Run | null = null;

    function finish(): void {
        if (run === null) return;
        const ended = run;
        run = null;
        window.clearTimeout(ended.stopTimer);
        window.clearTimeout(ended.nextTimer);
        setBusy(false);
        refreshButton();
    }

    function clickNext(): void {
        if (run === null) return;
        const current = run;
        const grid = currentGrid();
        if (grid === null) {
            finish();
            return;
        }
        for (let index = current.queue.shift(); index !== undefined; index = current.queue.shift()) {
            const card = cardsOf(grid)[index];
            // A card that is gone or got its overlay since the run began is not a purchase to wait for.
            if (card === undefined || isTaken(card)) continue;
            try {
                const handler = clickHandlerOf(card);
                if (handler === null) {
                    finish();
                    return;
                }
                window.clearTimeout(current.stopTimer);
                current.stopTimer = window.setTimeout(finish, STOP_MS);
                handler({ preventDefault() {}, stopPropagation() {} });
            } catch {
                // The game's own click function threw: end the run now, the shop stays as the game left it.
                finish();
            }
            return;
        }
        finish();
    }

    // Called by the injector when it has skipped a success dialog, for a purchase made by hand as well as by a run.
    window.__kaspShopDialogShown = (): void => {
        refreshSoon();
        if (run === null) return;
        window.clearTimeout(run.stopTimer);
        window.clearTimeout(run.nextTimer);
        run.nextTimer = window.setTimeout(clickNext, NEXT_CARD_MS);
    };

    function onButton(): void {
        if (run !== null) return;
        const grid = currentGrid();
        if (grid === null) return;
        const queue: number[] = [];
        cardsOf(grid).forEach((card, index) => {
            if (!isTaken(card)) queue.push(index);
        });
        if (queue.length === 0) {
            refreshButton();
            return;
        }
        run = { queue, stopTimer: 0, nextTimer: 0 };
        setBusy(true);
        clickNext();
    }

    // ---- the button ----

    function element(tag: string, className: string, text?: string): HTMLElement {
        const made = document.createElement(tag);
        made.className = className;
        if (text !== undefined) made.textContent = text;
        return made;
    }

    // Called by the game's code each time one of the showcase cards mounts (six times when the showcase opens). The button is added
    // to the cards' grid once; the grid is thrown away by the game when the player leaves the showcase, and the button with it. Every
    // call also reads the cards again, so the last of the six sees them all.
    function ensureButton(): void {
        const grid = currentGrid();
        if (grid === null) return;
        if (grid.querySelector(`.${BUTTON_CLASS}`) === null) {
            grid.setAttribute(GRID_MARK, '');
            const button = element('div', BUTTON_CLASS);
            button.id = BUTTON_CLASS;
            button.append(element('span', '', buttonText()));
            button.addEventListener('click', onButton);
            grid.append(button);
        }
        refreshButton();
    }

    if (!isSwitchedOff()) {
        window.__kaspShopCard = (): void => {
            try {
                ensureButton();
            } catch {
                // a button that cannot be added leaves the shop as the game drew it
            }
        };
    }
})();
