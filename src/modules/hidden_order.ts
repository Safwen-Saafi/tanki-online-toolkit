// Isolated-world content script. Publishes window.kaspHiddenOrder.place(), the rule that says which augment each hidden
// "?" card on the Augments tab is. The game fixes the order of the front of the row (Phoenix, then the legendaries, Excelsior
// and Pulsar), so a "?" card is named by its place. This file only holds the rule: no DOM, no data loading, so augments.ts
// does the reading and the drawing and the rule can be run on its own. See blueprint/context/garage-augments-screen.md.
(function () {
    'use strict';

    function refuse(reason: string): KaspPlacement {
        return { ok: false, reason };
    }

    // A named card must be known, and no augment can be on two cards.
    function checkNamed(slots: readonly KaspHiddenSlot[]): string | null {
        const seen = new Set<string>();
        for (const slot of slots) {
            if (slot.hidden) continue;
            if (slot.name === null) return 'a named card is not in the data';
            if (seen.has(slot.name)) return `"${slot.name}" is on two cards`;
            seen.add(slot.name);
        }
        return null;
    }

    // A hull has one fixed order, taken from the game, and the block must be exactly as long as it.
    function placeHull(slots: readonly KaspHiddenSlot[], order: readonly (string | null)[]): KaspPlacement {
        if (slots.length !== order.length) return refuse(`hull block has ${slots.length} cards, expected ${order.length}`);
        const names: (string | null)[] = [];
        for (const [index, slot] of slots.entries()) {
            const expected = order[index] ?? null;
            if (slot.hidden) {
                names.push(expected);
                continue;
            }
            if (slot.name !== expected) return refuse(`card ${index + 1} is "${slot.name}", expected "${expected}"`);
            names.push(null);
        }
        return { ok: true, names };
    }

    // A turret has its own legendaries in the middle, in the wiki's order; the ones the player shows are taken out of the
    // list and the rest fill the hidden middle cards in order. A middle card with no augment left stays "?".
    function placeTurret(block: KaspTurretBlock): KaspPlacement {
        const { slots, start, end, candidates } = block;
        const middleEnd = slots.length - end.length;
        if (middleEnd < start.length) return refuse(`block has ${slots.length} cards, too short`);
        const anchors = new Set<string>();
        for (const name of [...start, ...end]) if (name !== null) anchors.add(name);

        const shown = new Set<string>();
        const names: (string | null)[] = [];
        for (const [index, slot] of slots.entries()) {
            const expected = index < start.length ? (start[index] ?? null) : index >= middleEnd ? (end[index - middleEnd] ?? null) : undefined;
            if (!slot.hidden) {
                if (expected !== undefined && slot.name !== expected) return refuse(`card ${index + 1} is "${slot.name}", expected "${expected}"`);
                if (expected === undefined && slot.name !== null) {
                    if (anchors.has(slot.name)) return refuse(`"${slot.name}" is in the middle of the block`);
                    shown.add(slot.name);
                }
            }
            names.push(slot.hidden && expected !== undefined ? expected : null);
        }

        const remaining = candidates.filter((name) => !shown.has(name));
        let next = 0;
        for (const [index, slot] of slots.entries()) {
            if (!slot.hidden || index < start.length || index >= middleEnd) continue;
            names[index] = remaining[next] ?? null;
            next += 1;
        }
        return { ok: true, names };
    }

    function place(block: KaspHiddenBlock): KaspPlacement {
        const problem = checkNamed(block.slots);
        if (problem !== null) return refuse(problem);
        return block.kind === 'hull' ? placeHull(block.slots, block.order) : placeTurret(block);
    }

    window.kaspHiddenOrder = { place };
})();
