'use strict';

// Plain ANSI escape codes - no dependency. Purely cosmetic: never changes
// exit codes or the underlying facts printed alongside it. A terminal that
// doesn't render these just shows a few stray characters, not broken output.
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';

const OOPS_LINES = [
    'Nice try, but not today.',
    'The release gremlins say no.',
    'Close, but this one stays in the box.',
    'Abort mission - literally.',
];

const SUCCESS_LINES = [
    'Ship it! Off to GitHub it goes.',
    'Another one for the shelf.',
    'Tag deployed, mission complete.',
    'That is one small step for a tank.',
];

function pick(lines) {
    return lines[Math.floor(Math.random() * lines.length)];
}

function box(lines, color) {
    const width = Math.max(...lines.map((l) => l.length));
    const top = `${color}┌${'─'.repeat(width + 2)}┐${RESET}`;
    const bottom = `${color}└${'─'.repeat(width + 2)}┘${RESET}`;
    const body = lines
        .map((l) => `${color}│${RESET} ${l.padEnd(width)} ${color}│${RESET}`)
        .join('\n');
    return `${top}\n${body}\n${bottom}`;
}

function refusalBox(lines) {
    console.error(box([...lines, '', pick(OOPS_LINES)], RED));
}

function successBox(lines) {
    console.log(box([...lines, '', pick(SUCCESS_LINES)], GREEN));
}

module.exports = { refusalBox, successBox };
