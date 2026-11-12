// MAIN-world content script for the daily offer quick buying (build-plan 24, see blueprint/context/shop-quick-buy.md). It runs in the
// page's own world because the Buy all button clicks each card the way the game's own click handler does, and that handler is
// only reachable from there. The injector (src/injector.ts) changes the game's code at start, only while the switch kasp_shopquickbuy
// is on: a showcase card click leaves a note so the game's "Purchase successful" dialog draws nothing, and each showcase card, when
// the game mounts it, calls window.__kaspShopCard, which adds the Buy all button once. This file defines that function and the
// signal window.__kaspShopDialogShown that the injector calls when it has skipped a dialog, which is how a buy-all knows a purchase
// went through. With the switch off none of the game's calls arrive, and this file does nothing.
// Nothing watches the page: no observer, no interval, no polling. The only timers are one-shot timeouts that start from a click on
// Buy all and end by themselves: 150 ms between two purchases, and one stop timer of a few seconds that is cleared by the signal.
// Our dialog adds a key listener only while it is open and removes it when it closes.
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
    // the previous one turned SOLD. A purchase with no answer after STOP_MS ends the run.
    const NEXT_CARD_MS = 150;
    const STOP_MS = 6000;

    interface Texts {
        readonly button: string;
        readonly title: string;
        readonly already: string;
        readonly close: string;
        readonly done: (bought: number, total: number) => string;
        readonly stopped: (bought: number, total: number) => string;
    }

    const TEXTS: Readonly<Record<KaspLanguageCode, Texts>> = {
        EN: {
            button: 'Buy all',
            title: 'Daily offer',
            already: 'Already bought',
            close: 'Close',
            done: (bought, total) => `Bought ${bought} of ${total}`,
            stopped: (bought, total) => `Bought ${bought} of ${total}. Stopped: a purchase did not go through`,
        },
        RU: {
            button: 'Купить всё',
            title: 'Ежедневное предложение',
            already: 'Уже куплено',
            close: 'Закрыть',
            done: (bought, total) => `Куплено ${bought} из ${total}`,
            stopped: (bought, total) => `Куплено ${bought} из ${total}. Остановлено: покупка не прошла`,
        },
    };

    // This file shares no code with the extension's isolated world, so it works out the game's language itself, as language.ts does
    // from the same two places, when a text is shown.
    function texts(): Texts {
        try {
            const raw = (localStorage.getItem('language_store_key') ?? document.documentElement.lang ?? '').toLowerCase();
            return raw.split(/[-_]/)[0] === 'ru' ? TEXTS.RU : TEXTS.EN;
        } catch {
            return TEXTS.EN;
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

    // ---- our dialog, in the look of the game's own dialogs (see shop_quick_buy.css) ----

    let dialogShade: HTMLElement | null = null;

    function onDialogKey(event: KeyboardEvent): void {
        if (event.key !== 'Enter' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        closeDialog();
    }

    function closeDialog(): void {
        window.removeEventListener('keydown', onDialogKey, true);
        dialogShade?.remove();
        dialogShade = null;
    }

    function element(tag: string, className: string, text?: string): HTMLElement {
        const made = document.createElement(tag);
        made.className = className;
        if (text !== undefined) made.textContent = text;
        return made;
    }

    function showDialog(message: string): void {
        closeDialog();
        const words = texts();
        const shade = element('div', 'kasp-dialog-shade');
        const box = element('div', 'kasp-dialog');
        const head = element('div', 'kasp-dialog-head');
        const cross = element('div', 'kasp-dialog-cross');
        head.append(element('h1', 'kasp-dialog-title', words.title), cross);
        const body = element('div', 'kasp-dialog-body');
        body.append(element('span', 'kasp-dialog-text', message));
        const foot = element('div', 'kasp-dialog-foot');
        const ok = element('div', 'kasp-dialog-ok');
        ok.append(element('span', '', words.close));
        foot.append(ok);
        box.append(head, body, foot);
        shade.append(box);
        cross.addEventListener('click', closeDialog);
        ok.addEventListener('click', closeDialog);
        shade.addEventListener('click', (event) => {
            if (event.target === shade) closeDialog();
        });
        window.addEventListener('keydown', onDialogKey, true);
        document.body.append(shade);
        dialogShade = shade;
    }

    // ---- Buy all ----

    // One run at a time. It buys the cards that had no overlay when it started, in the grid's order: it clicks one card, waits for
    // the signal that the game's success dialog was skipped (the purchase went through), waits NEXT_CARD_MS, then clicks the next.
    interface Run {
        readonly queue: number[];
        total: number;
        bought: number;
        stopTimer: number;
        nextTimer: number;
    }

    let run: Run | null = null;

    function currentGrid(): Element | null {
        return document.querySelector(GRID_SELECTOR);
    }

    function setBusy(busy: boolean): void {
        document.getElementById(BUTTON_CLASS)?.classList.toggle('kasp-busy', busy);
    }

    function finish(stopped: boolean): void {
        if (run === null) return;
        const ended = run;
        run = null;
        window.clearTimeout(ended.stopTimer);
        window.clearTimeout(ended.nextTimer);
        setBusy(false);
        const words = texts();
        if (ended.total <= 0) showDialog(words.already);
        else showDialog(stopped ? words.stopped(ended.bought, ended.total) : words.done(ended.bought, ended.total));
    }

    function clickNext(): void {
        if (run === null) return;
        const current = run;
        const grid = currentGrid();
        if (grid === null) {
            finish(true);
            return;
        }
        for (let index = current.queue.shift(); index !== undefined; index = current.queue.shift()) {
            const card = cardsOf(grid)[index];
            // A card that is gone or got its overlay since the run began is not a purchase to wait for.
            if (card === undefined || isTaken(card)) {
                current.total--;
                continue;
            }
            const handler = clickHandlerOf(card);
            if (handler === null) {
                finish(true);
                return;
            }
            current.stopTimer = window.setTimeout(() => finish(true), STOP_MS);
            handler({ preventDefault() {}, stopPropagation() {} });
            return;
        }
        finish(false);
    }

    // Called by the injector when it has skipped a success dialog. A purchase made by hand, with no run going, is not ours.
    window.__kaspShopDialogShown = (): void => {
        if (run === null) return;
        window.clearTimeout(run.stopTimer);
        run.bought++;
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
            showDialog(texts().already);
            return;
        }
        run = { queue, total: queue.length, bought: 0, stopTimer: 0, nextTimer: 0 };
        setBusy(true);
        clickNext();
    }

    // ---- the button ----

    // Called by the game's code each time one of the showcase cards mounts (six times when the showcase opens). The button is added
    // to the cards' grid once; the grid is thrown away by the game when the player leaves the showcase, and the button with it.
    function ensureButton(): void {
        const grid = currentGrid();
        if (grid === null || grid.querySelector(`.${BUTTON_CLASS}`) !== null) return;
        grid.setAttribute(GRID_MARK, '');
        const button = element('div', BUTTON_CLASS);
        button.id = BUTTON_CLASS;
        button.append(element('span', '', texts().button));
        button.addEventListener('click', onButton);
        grid.append(button);
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
