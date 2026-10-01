import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WikiError, extractParsedHtml } from './wiki.js';

test('returns the rendered html of a page with augments', () => {
    const body = JSON.stringify({ parse: { text: { '*': '<div class="device-container"></div>' } } });
    assert.equal(extractParsedHtml(body, 'Augments/Firebird'), '<div class="device-container"></div>');
});

test('an API error reply becomes a WikiError with the wiki message', () => {
    const body = JSON.stringify({ error: { code: 'readapidenied', info: 'You need read permission' } });
    assert.throws(() => extractParsedHtml(body, 'X'), (error: unknown) => {
        return error instanceof WikiError && error.message.includes('You need read permission');
    });
});

test('an html challenge page instead of JSON is reported as a cookie check problem', () => {
    assert.throws(() => extractParsedHtml('<html><script>challenge</script></html>', 'X'), /cookie check/);
});

test('a page with no .device-container is rejected', () => {
    const body = JSON.stringify({ parse: { text: { '*': '<p>nothing here</p>' } } });
    assert.throws(() => extractParsedHtml(body, 'X'), /no augments/);
});
