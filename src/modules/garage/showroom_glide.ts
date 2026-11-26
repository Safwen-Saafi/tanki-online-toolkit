// Isolated-world content script for the showroom garage (build-plan 25): a smooth wheel on the garage's scrolling rows. A wheel
// notch moves a row a whole step at once, with no motion in between, which reads as a stutter (the page itself keeps its frame
// rate). So the wheel is taken here and the row glides there itself: each notch adds its step to a goal and every frame the row
// moves part of the way (eased, the same feel at any frame rate). Nothing runs while a row is still; a press on a row (a drag,
// an arrow, a card, the scroll bar) stops its glide, so that move wins.
// Two kinds of rows, proven live by the owner on 2026-11-16:
// - the card row along the bottom (the game scrolls it sideways with its own wheel handler): our wheel listener is on the window,
//   before the game's, which never sees the wheel; it is passive, so it never holds up the browser
//   (blueprint/reference/garage-cards-glide-probe.js);
// - the Augments, Skins and Shot colour lists (styles/showroom_lists.css turns them into up-and-down scrollers the browser
//   scrolls by itself): the browser's own step is stopped, which needs a listener that is not passive, so it goes on each list box
//   only, the first time the mouse comes over it, never on the window (blueprint/reference/garage-lists-glide-probe.js).
// The arrows, the drag and the game's jump to the equipped item stay the game's own. Under the Showroom garage switch
// (kasp_showroom); the switch applies after a reload.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_showroom';
    // the card row (ListItems, on every item screen): scrolled sideways by the game
    const CARD_ROW = '.GarageCommonStyle-garageContainer .ListItemsComponentStyle-itemsListContainer';
    // the Augments, Skins and Shot colour lists: up-and-down scrollers, scrolled by the browser
    const ITEM_LIST = '.GarageCommonStyle-garageContainer .GarageCommonStyle-subMenu > .SkinsAndAlterationsStyle-SkinsVerticalComponent';
    const SPEED = 1; // distance per notch: 1 is the game's or the browser's own step
    const EASE = 0.2; // part of the way to the goal covered each frame at 60 fps
    const LINE = 40; // pixels in a wheel "line" (a wheel that counts in lines)

    if (!(window.kaspSwitches?.isOn(SWITCH_KEY) ?? true)) return;

    // one glide at a time: the box, which way it scrolls, where it is going and where it is
    let box: Element | null = null;
    let vertical = false;
    let goal = 0;
    let position = 0;
    let frame = 0;
    let lastTime = 0;
    const hookedLists = new WeakSet<Element>();

    function stop(): void {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
    }

    function step(time: number): void {
        frame = 0;
        if (!box || !box.isConnected) {
            box = null;
            lastTime = 0;
            return;
        }
        const elapsed = lastTime ? Math.min(time - lastTime, 50) : 16.7;
        lastTime = time;
        position += (goal - position) * (1 - Math.pow(1 - EASE, elapsed / 16.7));
        if (Math.abs(goal - position) < 0.5) position = goal;
        if (vertical) box.scrollTop = position;
        else box.scrollLeft = position;
        if (position !== goal) frame = requestAnimationFrame(step);
        else lastTime = 0;
    }

    // adds one wheel notch to the glide of this box
    function glide(target: Element, down: boolean, event: WheelEvent): void {
        const size = down ? target.clientHeight : target.clientWidth;
        const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? size : 1;
        const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit * SPEED;
        // start from where the box really is (after a drag, an arrow, the scroll bar or the game's jump)
        if (target !== box || !frame) {
            box = target;
            vertical = down;
            position = goal = down ? target.scrollTop : target.scrollLeft;
        }
        const end = down ? target.scrollHeight - target.clientHeight : target.scrollWidth - target.clientWidth;
        goal = Math.max(0, Math.min(end, goal + delta));
        if (!frame) frame = requestAnimationFrame(step);
    }

    // the card row's own scroll box: the first box from the wheel's target up to the row that can move sideways
    function cardRowScroller(target: EventTarget | null): Element | null {
        if (!(target instanceof Element)) return null;
        const row = target.closest(CARD_ROW);
        if (!row) return null;
        for (let node: Element | null = target; node; node = node.parentElement) {
            if (node.scrollWidth > node.clientWidth + 1) {
                const overflow = getComputedStyle(node).overflowX;
                if (overflow === 'auto' || overflow === 'scroll' || overflow === 'hidden') return node;
            }
            if (node === row) break;
        }
        return null;
    }

    // the card row: taken on the window before the game's own handler, which would jump the row; in battle too (owner 2026-11-24:
    // the garage opened in a battle glides like the lobby's; a wheel away from the card row only costs one closest() and goes on)
    window.addEventListener('wheel', (event) => {
        if (event.ctrlKey) return;
        const row = cardRowScroller(event.target);
        if (!row) return;
        event.stopPropagation();
        glide(row, false, event);
    }, { capture: true, passive: true });

    // an item list: the browser's own step is stopped on the list box itself
    function onListWheel(event: WheelEvent): void {
        const list = event.currentTarget;
        if (event.ctrlKey || !(list instanceof Element) || list.scrollHeight <= list.clientHeight + 1) return;
        event.preventDefault();
        glide(list, true, event);
    }

    window.addEventListener('pointerover', (event) => {
        const list = event.target instanceof Element ? event.target.closest(ITEM_LIST) : null;
        if (list && !hookedLists.has(list)) {
            hookedLists.add(list);
            list.addEventListener('wheel', onListWheel as EventListener, { passive: false });
        }
    }, { capture: true, passive: true });

    // a press on a row (drag, arrow, card, scroll bar) stops the glide, so that move wins
    window.addEventListener('pointerdown', (event) => {
        if (frame && event.target instanceof Element && event.target.closest(`${CARD_ROW}, ${ITEM_LIST}`)) stop();
    }, { capture: true, passive: true });
})();
