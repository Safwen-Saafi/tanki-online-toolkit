// Isolated-world content script for the showroom garage (build-plan 25): a smooth wheel on the garage's card row. The game moves the
// row the whole wheel step at once on each notch, with no motion in between, which reads as a stutter (the page itself keeps its
// frame rate). So a wheel on the card row is taken here first, on the window before the game's own handler, which never sees it,
// and the row glides there itself: each notch adds its step to a goal and every frame the row moves part of the way (eased, the
// same feel at any frame rate). The arrows, the drag and the game's jump to the equipped item stay the game's own; a press on the
// row stops the glide so the game's move wins. The listeners are passive (they never hold up the browser) and nothing runs while
// the row is still. Proven live with blueprint/reference/garage-cards-glide-probe.js (owner, 2026-11-16).
// Under the Showroom garage switch (kasp_showroom); the switch applies after a reload. Other scrolling rows join through ROWS.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_showroom';
    const BATTLE_ATTRIBUTE = 'data-kasp-showroom-battle';
    // the rows that glide: the garage's card row (ListItems, on every item screen)
    const ROWS = '.GarageCommonStyle-garageContainer .ListItemsComponentStyle-itemsListContainer';
    const SPEED = 1; // distance per notch: 1 is the game's own step
    const EASE = 0.2; // part of the way to the goal covered each frame at 60 fps
    const LINE = 40; // pixels in a wheel "line" (a wheel that counts in lines)

    if (!(window.kaspSwitches?.isOn(SWITCH_KEY) ?? true)) return;

    let box: Element | null = null;
    let goal = 0;
    let position = 0;
    let frame = 0;
    let lastTime = 0;

    // the row's own scroll box: the first box from the wheel's target up to the row that can move sideways
    function scroller(target: EventTarget | null): Element | null {
        if (!(target instanceof Element)) return null;
        const row = target.closest(ROWS);
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
        box.scrollLeft = position;
        if (position !== goal) frame = requestAnimationFrame(step);
        else lastTime = 0;
    }

    window.addEventListener('wheel', (event) => {
        if (event.ctrlKey || document.documentElement.hasAttribute(BATTLE_ATTRIBUTE)) return;
        const row = scroller(event.target);
        if (!row) return;
        event.stopPropagation(); // the game's own handler would jump the row
        const unit = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? row.clientWidth : 1;
        const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit * SPEED;
        // start from where the row really is (after a drag, an arrow or the game's jump)
        if (row !== box || !frame) {
            box = row;
            position = goal = row.scrollLeft;
        }
        goal = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, goal + delta));
        if (!frame) frame = requestAnimationFrame(step);
    }, { capture: true, passive: true });

    // a press on the row (drag, arrow, card) stops the glide, so the game's own move wins
    window.addEventListener('pointerdown', (event) => {
        if (frame && event.target instanceof Element && event.target.closest(ROWS)) stop();
    }, { capture: true, passive: true });
})();
