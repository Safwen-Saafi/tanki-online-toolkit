// Paste this whole file into the game's DevTools console (F12) in the garage, after opening any turret's Augments tab
// (from then on the game holds every augment of every turret and hull). It reads the game's own list of augments - each
// augment's number, the number of the turret or hull it belongs to, and its name in the game's current language - and
// saves it as augment-ids-EN.json or augment-ids-RU.json in your Downloads folder (it is also copied). Then run merge.mjs.
// It only reads plain data fields and the text of toString functions; it never calls a method of a game object.
(async () => {
    const source = (f) => { try { return Function.prototype.toString.call(f); } catch { return ''; } };
    const own = (o, k) => { const d = k == null ? null : Object.getOwnPropertyDescriptor(o, k); return d && 'value' in d ? d.value : undefined; };
    const texts = new Map();
    const textOf = (o) => {
        const c = o && o.constructor;
        if (!c || !c.prototype) return '';
        if (!texts.has(c)) { const t = own(c.prototype, 'toString'); texts.set(c, typeof t === 'function' ? source(t) : ''); }
        return texts.get(c);
    };
    const field = (s, n) => (new RegExp(n + '="\\+(?:[\\w$]+\\()?this\\.([\\w$]+)').exec(s) || [])[1];
    // The game's numbers are Kotlin Longs: two plain number fields, low and high.
    const asNumber = (v) => {
        if (typeof v === 'number' || typeof v === 'string') return String(v);
        if (!v || typeof v !== 'object') return null;
        const n = Object.keys(v).map((k) => own(v, k)).filter((x) => typeof x === 'number');
        return n.length === 2 ? (BigInt(n[1]) * 4294967296n + BigInt(n[0] >>> 0)).toString() : null;
    };
    const fromCode = (raw) => { const p = String(raw || '').toLowerCase().split(/[-_]/)[0]; return p === 'ru' ? 'RU' : p === 'en' ? 'EN' : null; };
    let language = null;
    try { language = fromCode(localStorage.getItem('language_store_key')); } catch { /* blocked storage */ }
    language = language || fromCode(document.documentElement.lang);
    if (!language) return console.warn('[augment-ids] the game is in neither English nor Russian');

    const rootElement = [...document.querySelectorAll('body *')].find((e) => Object.keys(e).some((k) => k.startsWith('__reactContainer$')));
    if (!rootElement) return console.warn('[augment-ids] the game page is not ready');
    const queue = [own(rootElement, Object.keys(rootElement).find((k) => k.startsWith('__reactContainer$')))];
    const seen = new Set();
    const devices = {};
    for (let i = 0; i < queue.length && i < 3000000; i++) {
        const o = queue[i];
        if (!o || typeof o !== 'object' || seen.has(o) || o instanceof Node || o instanceof ArrayBuffer || ArrayBuffer.isView(o)) continue;
        seen.add(o);
        const s = textOf(o);
        if (s.includes('"GarageDevice(id="')) {
            const id = asNumber(own(o, field(s, 'id')));
            const item = asNumber(own(o, field(s, 'baseItemId')));
            const name = own(o, field(s, 'name'));
            if (id && item && typeof name === 'string') devices[id] = [item, name];
        }
        if (o instanceof Map) o.forEach((v, k) => { queue.push(v); queue.push(k); });
        for (const k of Object.keys(o)) { const v = own(o, k); if (v && typeof v === 'object') queue.push(v); }
    }
    const count = Object.keys(devices).length;
    if (count === 0) return console.warn('[augment-ids] no augments found: open a turret\'s Augments tab in the garage first');

    const text = JSON.stringify({ kind: 'kasp-augment-capture', language, capturedAt: new Date().toISOString(), devices }, null, 1);
    if (typeof copy === 'function') copy(text);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    link.download = `augment-ids-${language}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    return `[augment-ids] ${count} augments in ${language}, saved as augment-ids-${language}.json`;
})();
