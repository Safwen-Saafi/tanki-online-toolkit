// MAIN-world content script (26d step 9, owner 2026-11-24): the battle search moment. While the game searches, the one sound the
// player picked plays in a loop from the search's start to its end, then fades out (Battle search > Search sound: a sonar or one
// of two alarms; never two together); the files are in extension/sounds/ (credits in SEARCH-SOUNDS-CREDITS.txt; the first try's
// sounds made by code were not liked). lobby.ts reads window.__kaspSearch in its own lobby frames for the rest: the camera's ready
// shot, the drone escort, the hangar on alert (the emergency lights) and the hangar sounds turned down.
// Nothing watches the page: the stylesheet (end of lobby_ui.css) plays a 1 ms animation on <body> each time the game's search box
// comes or goes; this file only answers those animation events. The
// switches and the Sound dropdown (Battle search, in the settings tab) are read at each search start, so a change applies at the
// next search.
(function () {
    'use strict';

    const KEYS = {
        camera: 'kasp_searchcamera',
        sound: 'kasp_searchsound',
        pick: 'kasp_searchsoundpick',
        drone: 'kasp_searchdrone',
        alert: 'kasp_searchsiren',
        room: 'kasp_searchroom',
    } as const;
    // The sounds the player can pick (the settings tab's Sound dropdown; the first is its fallback there too), each looped for as
    // long as the search lasts (owner 2026-11-24) and faded out when it ends. level = its loudness after each file is brought to the
    // same peak.
    const SOUNDS = {
        sonar: { file: 'search-sonar.mp3', level: 0.45 },
        alarm: { file: 'search-alarm.mp3', level: 0.5 },
        redalert: { file: 'search-redalert.mp3', level: 0.5 },
    } as const;
    type Pick = keyof typeof SOUNDS;
    const PEAK = 0.9;
    // the fade when the search ends (seconds), as the hangar sounds come back up
    const END_FADE = 1;
    // The search box can go and come back at once (a screen change may draw it again): that is the same search, with no new sound.
    const SAME_SEARCH_MS = 1500;

    const isOn = (key: string): boolean => {
        try {
            return localStorage.getItem(key) !== '0';
        } catch {
            return true;
        }
    };
    function readPick(): Pick {
        let saved: string | null = null;
        try {
            saved = localStorage.getItem(KEYS.pick);
        } catch {
            // nothing saved: the first one
        }
        return saved !== null && saved in SOUNDS ? (saved as Pick) : 'sonar';
    }

    const search: KaspSearch = { on: false, camera: false, drone: false, alert: false, room: false };
    window.__kaspSearch = search;
    // the sound of this search (null = none)
    let pick: Pick | null = null;
    let offAt = -Infinity;

    // ---- the sound ----
    // The audio is made, and the picked sound read, once the page has loaded (warm, below); the browser keeps the audio paused until the
    // player has clicked somewhere, and a search always comes after a click. A file picked later is read at its first search, then
    // kept. A missing or broken file stays silent.
    let ctx: AudioContext | null = null;
    const bufs = new Map<Pick, { readonly buf: AudioBuffer; readonly norm: number } | 'loading' | 'failed'>();
    // the loop playing now, so the search's end can fade it
    let playing: { readonly src: AudioBufferSourceNode; readonly gain: GainNode } | null = null;

    function audio(): AudioContext | null {
        if (ctx === null) {
            try {
                ctx = new AudioContext();
            } catch {
                return null;
            }
        }
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
    }

    function load(c: AudioContext, key: Pick, then: () => void): void {
        const base = document.documentElement.getAttribute('data-kasp-sounds-base');
        if (bufs.has(key) || base === null) return;
        bufs.set(key, 'loading');
        fetch(base + SOUNDS[key].file)
            .then((r) => {
                if (!r.ok) throw new Error(SOUNDS[key].file);
                return r.arrayBuffer();
            })
            .then((data) => c.decodeAudioData(data))
            .then(
                (buf) => {
                    let peak = 0;
                    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                        const d = buf.getChannelData(ch);
                        for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
                    }
                    bufs.set(key, { buf, norm: PEAK / (peak || 1) });
                    then();
                },
                () => {
                    bufs.set(key, 'failed');
                },
            );
    }

    function fadeOut(seconds: number): void {
        const c = ctx;
        const p = playing;
        playing = null;
        if (c === null || p === null) return;
        const t = c.currentTime;
        p.gain.gain.cancelScheduledValues(t);
        p.gain.gain.setValueAtTime(p.gain.gain.value, t);
        p.gain.gain.linearRampToValueAtTime(0, t + seconds);
        try {
            p.src.stop(t + seconds + 0.05);
        } catch {
            // it had ended already
        }
    }

    function play(key: Pick): void {
        const c = audio();
        const one = bufs.get(key);
        if (c === null || one === undefined || typeof one === 'string') return;
        fadeOut(0.1);
        const src = c.createBufferSource();
        const gain = c.createGain();
        src.buffer = one.buf;
        src.loop = true;
        gain.gain.value = one.norm * SOUNDS[key].level;
        src.connect(gain);
        gain.connect(c.destination);
        src.start();
        const me = { src, gain };
        playing = me;
        src.onended = () => {
            if (playing === me) playing = null;
        };
    }

    // ---- the search's start and end ----
    function begin(): void {
        if (search.on) return;
        search.on = true;
        // the same search drawn again: everything stays as it was, the loop (faded by the box going) started again
        if (performance.now() - offAt < SAME_SEARCH_MS) {
            if (pick !== null) play(pick);
            return;
        }
        search.camera = isOn(KEYS.camera);
        search.drone = isOn(KEYS.drone);
        search.alert = isOn(KEYS.alert);
        search.room = isOn(KEYS.room);
        pick = isOn(KEYS.sound) ? readPick() : null;
        if (pick === null) return;
        const key = pick;
        const c = audio();
        if (c === null) return;
        if (bufs.has(key)) play(key);
        else
            load(c, key, () => {
                if (search.on && pick === key) play(key);
            });
    }

    function end(): void {
        if (!search.on) return;
        search.on = false;
        offAt = performance.now();
        fadeOut(END_FADE);
    }

    function onAnimation(event: AnimationEvent): void {
        if (event.animationName === 'kasp-search-on') begin();
        else if (event.animationName === 'kasp-search-off') end();
    }

    document.addEventListener('animationstart', onAnimation);

    // Made ahead (2026-11-26, the owner's trace of a first search: making the audio and reading the sound at the click took about 50 ms,
    // right as the lift started): once the page has loaded (the game's loading screen, nobody playing yet), the audio is made and the
    // picked sound read and measured, so the search itself only starts it.
    function warm(): void {
        if (!isOn(KEYS.sound)) return;
        const c = audio();
        if (c !== null) load(c, readPick(), () => {});
    }
    if (document.readyState === 'complete') warm();
    else window.addEventListener('load', () => window.setTimeout(warm, 0), { once: true });

    // For the owner's console checks (probe 15): stop the search's sound, or start it again.
    window.__kaspSearchSound = {
        stop: () => fadeOut(0.1),
        play: () => {
            if (search.on && pick !== null) play(pick);
        },
    };
})();
