// Shared script of the garage mockups: the 3D tank stage (the website's own scene, copied from
// tankionline.com/en/skins/preview), the icon sprite, and the "Mockup controls" bar.
// A classic script on purpose: the pages open straight from disk (file://), where a local module script is blocked.
// three.js and the tank models come from the internet, so the mockups need a connection.
(function () {
    'use strict';

    const PAGE = window.MOCKUP || { screen: 'main', stage: {} };

    // ---------- state, carried between the three pages in the address (#layout=1&colour=blue&...) ----------
    const DEFAULTS = { layout: '1', colour: 'blue', light: 'flatplus', floor: 'web', model: 'XT_TeslaPaladin', drag: 'off' };
    const state = Object.assign({}, DEFAULTS);
    for (const part of location.hash.replace(/^#/, '').split('&')) {
        const [k, v] = part.split('=');
        if (k in state && v) state[k] = decodeURIComponent(v);
    }
    const hash = () => '#' + Object.keys(state).map((k) => k + '=' + encodeURIComponent(state[k])).join('&');
    function apply() {
        document.documentElement.dataset.colour = state.colour;
        document.body.dataset.layout = state.layout;
        history.replaceState(null, '', hash());
        for (const a of document.querySelectorAll('a[data-page]')) a.href = a.dataset.page + hash();
        for (const b of document.querySelectorAll('[data-set]')) {
            const [k, v] = b.dataset.set.split(':');
            b.classList.toggle('on', state[k] === v);
        }
        const sel = document.getElementById('mk-model');
        if (sel) sel.value = state.model;
        if (stage) stage.update();
    }

    // ---------- icons ----------
    const ICONS = {
        back: '<path d="M10 4 3 12l7 8M3 12h18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
        friends: '<circle cx="8" cy="8" r="3.5" fill="currentColor"/><circle cx="16.5" cy="8" r="3.5" fill="currentColor"/><path d="M1.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5zM12 20c.3-3 1.5-5.6 4.5-6.4 3.5 0 6 2.4 6 6.4z" fill="currentColor"/>',
        crystal: '<path d="M4 4h16l-8 17z M8.3 4 12 21 15.7 4 M4 9h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
        ruby: '<path d="M12 2 21 11l-9 11-9-11z" fill="currentColor"/>',
        plus: '<path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
        fullscreen: '<path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" fill="none" stroke="currentColor" stroke-width="2.2"/>',
        exit: '<path d="M10 3H4v18h6M15 7l5 5-5 5M20 12H9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
        home: '<path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z" fill="currentColor"/>',
        camera: '<path d="M4 7h4l2-3h4l2 3h4v13H4z" fill="currentColor"/><circle cx="12" cy="13" r="3.6" fill="var(--bg-deep)"/>',
        upgrade: '<path d="M12 3 3 12h5l4-4 4 4h5zM12 11 4 19h4l4-4 4 4h4z" fill="currentColor"/>',
        lock: '<rect x="5" y="10" width="14" height="11" rx="2" fill="currentColor"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/>',
        equip: '<path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 11.5 12 15l4-3.5M12 7v8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
        cart: '<path d="M2 4h3l3 11h11l2-8H7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="9" cy="19.5" r="1.8" fill="currentColor"/><circle cx="17.5" cy="19.5" r="1.8" fill="currentColor"/>',
        close: '<path d="M5 5l14 14M19 5 5 19" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
        star: '<path d="M12 2.5 14.9 9l7 .6-5.3 4.6 1.6 6.9L12 17.4l-6.2 3.7 1.6-6.9L2.1 9.6l7-.6z" fill="currentColor"/>',
        nuclear: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 12 7 3.5A10 10 0 0 0 2 12zM12 12l5-8.5A10 10 0 0 1 22 12zM12 12l-5 8.6a10 10 0 0 0 10 0z" fill="var(--bg-deep)" opacity=".55"/><circle cx="12" cy="12" r="2" fill="var(--bg-deep)"/>',
        wrench: '<path d="M21 6.5a5 5 0 0 1-6.7 4.7L6 19.5a2.1 2.1 0 0 1-3-3l8.3-8.3A5 5 0 0 1 17.5 3l-3 3 .5 3 3 .5z" fill="currentColor"/>',
        shield: '<path d="M12 2 20 5v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 5v14" stroke="currentColor" stroke-width="2"/>',
        damage: '<path d="M14 2 5 13h6l-2 9 10-12h-6z" fill="currentColor"/>',
        speed: '<path d="M12 3 4 11h5l3-3 3 3h5zM12 11 4 19h5l3-3 3 3h5z" fill="currentColor"/>',
        mine: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3"/><circle cx="12" cy="12" r="3.5" fill="currentColor"/>',
        goldbox: '<path d="M12 2 21 7v10l-9 5-9-5V7z" fill="currentColor"/><path d="M12 2v20M3 7l9 5 9-5" fill="none" stroke="var(--bg-deep)" stroke-width="1.6" opacity=".5"/>',
        diamond: '<path d="M12 3 21 12l-9 9-9-9z" fill="currentColor"/>',
        dots: '<circle cx="5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/>',
        chevron: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
        weasel: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8 15c2-6 6-8 9-8-2 3-2 5-5 7 2 0 3-1 4-1-2 3-5 4-8 2z" fill="var(--bg-deep)"/>',
        bullets: '<path d="M7 9a2 2 0 0 1 4 0v11H7zM13 9a2 2 0 0 1 4 0v11h-4z" fill="currentColor"/>',
        rocket: '<path d="M15 3c3 0 6 3 6 6l-9 9-6-6zM6 12l-3 3 3 3 3 3 3-3" fill="currentColor"/>',
        percent: '<circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8 16l8-8" stroke="var(--bg-deep)" stroke-width="2.4"/><circle cx="8.5" cy="8.5" r="1.8" fill="var(--bg-deep)"/><circle cx="15.5" cy="15.5" r="1.8" fill="var(--bg-deep)"/>',
        drone: '<path d="M3 11c3-4 15-4 18 0l-3 2-2-1-2 6h-4l-2-6-2 1z" fill="currentColor"/><circle cx="10" cy="11" r="1.2" fill="var(--crystal)"/><circle cx="14" cy="11" r="1.2" fill="var(--crystal)"/>',
        bomb: '<circle cx="12" cy="13" r="8" fill="currentColor"/><rect x="9.5" y="3" width="5" height="4" rx="1" fill="currentColor"/><rect x="8" y="12" width="8" height="2.4" rx="1.2" fill="var(--crystal)"/>',
    };
    function sprite() {
        const symbols = Object.keys(ICONS).map((k) => `<symbol id="i-${k}" viewBox="0 0 24 24">${ICONS[k]}</symbol>`).join('');
        const div = document.createElement('div');
        div.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${symbols}</svg>`;
        document.body.prepend(div.firstChild);
    }

    // ---------- the "Mockup controls" bar (not part of the design) ----------
    const MODELS = ['XT_TeslaPaladin', 'DC_HammerViking', 'XT_FreezeViking', 'XT_ScorpionCrusader', 'DC_FirebirdWasp',
        'DC_VolcanoHunter', 'GT_IsisaHornet', 'GT_RailgunDictator', 'GT_ThunderViking', 'LC_RailgunHornet', 'LC_SmokyWasp',
        'LC_ThunderViking', 'RF_RicochetPaladin', 'RF_TwinsCrusader', 'SP_MagnumTitan', 'SP_TwinsMammoth', 'UT_ThunderViking'];
    function controls() {
        const bar = document.createElement('div');
        bar.className = 'mk-bar';
        const btn = (k, v, label, title) => `<button type="button" data-set="${k}:${v}" title="${title || label}">${label}</button>`;
        bar.innerHTML = `
            <span class="mk-title">Mockup</span>
            <span class="mk-group"><span class="mk-label">Screen</span>
                <a data-page="main.html" class="${PAGE.screen === 'main' ? 'on' : ''}">Main</a>
                <a data-page="item.html" class="${PAGE.screen === 'item' ? 'on' : ''}">Item</a>
                <a data-page="paints.html" class="${PAGE.screen === 'paints' ? 'on' : ''}">Paints</a></span>
            <span class="mk-group"><span class="mk-label">Layout</span>
                ${btn('layout', '1', '1 Showroom', 'Tank left, all info in one glass column on the right')}
                ${btn('layout', '2', '2 Split', 'Info left, stats and buttons right, like today')}
                ${btn('layout', '3', '3 Dock', 'Big tank in the middle, info in a dock at the bottom')}</span>
            <span class="mk-group"><span class="mk-label">Colour</span>
                ${['blue', 'pink', 'purple', 'crimson', 'teal', 'bronze'].map((c) => `<button type="button" class="mk-dot mk-${c}" data-set="colour:${c}" title="${c}"></button>`).join('')}</span>
            <span class="mk-group"><span class="mk-label">Light</span>
                ${btn('light', 'game', 'Game', "The game's light today")}
                ${btn('light', 'flat', 'Flat', "The website's light")}
                ${btn('light', 'flatplus', 'Flat+', 'Flat with a soft light from above')}</span>
            <span class="mk-group"><span class="mk-label">Floor</span>
                ${btn('floor', 'web', 'Website', 'The floor tilts with the camera (the website)')}
                ${btn('floor', 'css', 'Fixed', 'The floor stays still when the camera drifts (what the game can do with CSS)')}</span>
            <span class="mk-group"><span class="mk-label">Drag</span>
                ${btn('drag', 'off', 'Off', 'Drag to turn the tank: off (the website)')}${btn('drag', 'on', 'On', 'Drag to turn the tank: on')}</span>
            <span class="mk-group"><span class="mk-label">Tank</span>
                <select id="mk-model">${MODELS.map((m) => `<option value="${m}">${m.replace('_', ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}</option>`).join('')}</select></span>
            <span class="mk-status" id="mk-status">loading</span>
            <button type="button" class="mk-hide" title="Hide the bar (H)">Hide</button>`;
        document.body.appendChild(bar);
        bar.addEventListener('click', (e) => {
            const b = e.target.closest('[data-set]');
            if (!b) return;
            const [k, v] = b.dataset.set.split(':');
            state[k] = v;
            apply();
        });
        bar.querySelector('#mk-model').addEventListener('change', (e) => { state.model = e.target.value; apply(); });
        bar.querySelector('.mk-hide').addEventListener('click', () => bar.classList.toggle('mk-hidden'));
        addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') bar.classList.toggle('mk-hidden'); });
    }

    // ---------- the 3D stage ----------
    // Copied from the website's viewer (React Three Fiber, three r152): camera fov 22 at (0, 3.4605, 9) looking at
    // (0, 1.2, 0), tank turned -135.683 degrees, unlit textures, the floor model "floor-3.glb" with skins-floor.png,
    // a mirrored copy of the tank that adds a faint glow, and the camera easing 5% per frame towards the mouse.
    // floor-3.glb (a floor that curves up into a back wall), Draco-decoded once into plain numbers so no decoder is needed
    const FLOOR = {"POSITION":[13.35163,0,13.35163,13.35163,0,-6.49611,-13.35163,0,13.35163,-13.35163,0,-6.49611,13.35163,0.09128,-7.43007,-13.35163,0.09128,-7.43007,13.35163,0.27709,-8.35913,-13.35163,0.27709,-8.35913,13.35163,0.54929,-9.2556,-13.35163,0.54929,-9.2556,13.35163,0.81986,-9.91083,-13.35163,0.81986,-9.91083,13.35163,1.5354,-10.9817,-13.35163,1.5354,-10.9817,13.35163,2.36993,-11.81623,-13.35163,2.36993,-11.81623,13.35163,2.81979,-12.11614,-13.35163,2.81979,-12.11614,13.35163,3.58912,-12.52688,-13.35163,3.58912,-12.52688,13.35163,4.42854,-12.87569,-13.35163,4.42854,-12.87569,13.35163,5.26307,-13.12833,-13.35163,5.26307,-13.12833,13.35163,5.26307,-13.12833,-13.35163,5.26307,-13.12833,13.35163,6.07967,-13.23264,-13.35163,6.07967,-13.23264,13.35163,6.70719,-13.29295,-13.35163,6.70719,-13.29295,13.35163,7.88401,-13.35163,-13.35163,7.88401,-13.35163,-13.35163,13.61975,-13.35163,13.35163,13.61975,-13.35163],"NORMAL":[0,1,0,0,0.99879,0.04922,0,1,0,0,0.99879,0.04922,0,0.98918,0.14671,0,0.98918,0.14671,0,0.97028,0.24198,0,0.97028,0.24198,0,0.94117,0.33792,0,0.94117,0.33792,0,0.88191,0.47141,0,0.88191,0.47141,0,0.77383,0.63339,0,0.77383,0.63339,0,0.63339,0.77383,0,0.63339,0.77383,0,0.51568,0.85678,0,0.51568,0.85678,0,0.4273,0.90411,0,0.4273,0.90411,0,0.33792,0.94117,0,0.33792,0.94117,0,0.80229,0.59693,0,0.80229,0.59693,0,0.75121,0.66007,0,0.75121,0.66007,0,0.11257,0.99364,0,0.11257,0.99364,0,0.07333,0.99731,0,0.07333,0.99731,0,0.02404,0.99971,0,0.02404,0.99971,0,0,1,0,0,1],"TEXCOORD_0":[0.70973,0.98879,0.70973,0.47193,0.01414,0.98879,0.01414,0.47193,0.70973,0.44735,0.01414,0.44735,0.70973,0.42253,0.01414,0.42253,0.70973,0.39796,0.01414,0.39796,0.70973,0.3791,0.01414,0.3791,0.70973,0.34546,0.01414,0.34546,0.70973,0.3142,0.01414,0.3142,0.70973,0.30012,0.01414,0.30012,0.70973,0.27697,0.01414,0.27697,0.70973,0.25287,0.01414,0.25287,0.70973,0.22996,0.01414,0.22996,0.70973,0.22996,0.01414,0.22996,0.70973,0.20825,0.01414,0.20825,0.70973,0.19179,0.01414,0.19179,0.70973,0.161,0.01414,0.161,0.01414,0.01162,0.70973,0.01162],"index":[0,1,2,2,1,3,1,4,3,3,4,5,4,6,5,5,6,7,6,8,7,7,8,9,8,10,9,9,10,11,10,12,11,11,12,13,12,14,13,13,14,15,14,16,15,15,16,17,16,18,17,17,18,19,18,20,19,19,20,21,20,22,21,21,22,23,22,24,23,23,24,25,24,26,25,25,26,27,26,28,27,27,28,29,28,30,29,29,30,31,32,31,33,31,30,33]};
    const FLOOR_PNG = 'https://web-cdn.tankionline.com/tanki-online/floor/skins-floor.png';
    const MODEL_URL = (name) => 'https://web-cdn.tankionline.com/skins/' + name + '.glb';
    // where the tank stands for each layout (the page can override): x left/right, y up/down, scale, camera distance,
    // lookY the height the camera looks at (lower moves the whole scene up on screen; the website's is 1.2)
    const STAGE = Object.assign({
        1: { x: -0.85, y: 0.514, scale: 0.0033, camZ: 9, lookY: 0.85 },
        2: { x: 0, y: 0.514, scale: 0.0036, camZ: 9, lookY: 0.95 },
        3: { x: 0, y: 0.514, scale: 0.004, camZ: 9, lookY: 0.6 },
    }, PAGE.stage || {});

    let stage = null;
    async function startStage() {
        const status = document.getElementById('mk-status');
        try {
            status.textContent = 'loading three.js';
            const THREE = await import('three');
            const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
            THREE.ColorManagement.enabled = true;
            const canvas = document.getElementById('stage');
            const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
            renderer.setPixelRatio(Math.min(2, devicePixelRatio));
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            renderer.toneMapping = THREE.NoToneMapping; // the website's "flat"
            renderer.setClearColor(0x000000, 0);
            renderer.autoClear = false;

            const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 1000);
            const floorCamera = camera.clone();
            const look = new THREE.Vector3(0, 1.2, 0);
            const camPos = new THREE.Vector3(0, 3.4605, 9);

            // floor
            const floorScene = new THREE.Scene();
            const loader = new GLTFLoader();
            const floorGeometry = new THREE.BufferGeometry();
            floorGeometry.setAttribute('position', new THREE.Float32BufferAttribute(FLOOR.POSITION, 3));
            floorGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(FLOOR.NORMAL, 3));
            floorGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(FLOOR.TEXCOORD_0, 2));
            floorGeometry.setIndex(FLOOR.index);
            status.textContent = 'loading floor picture';
            const floorTex = await new THREE.TextureLoader().loadAsync(FLOOR_PNG);
            floorTex.flipY = false;
            floorTex.wrapT = THREE.RepeatWrapping;
            floorTex.colorSpace = THREE.SRGBColorSpace;
            // The floor picture covers the whole screen (the CSS glow only shows through the mirror image), so Game colour
            // must reach it too: the same rule as the game patch, the hue is swapped and lightness and saturation are kept.
            const floorMaterial = new THREE.ShaderMaterial({
                uniforms: { map: { value: floorTex }, hue: { value: 0 }, swap: { value: 0 } },
                depthWrite: false,
                depthTest: false,
                vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
                fragmentShader: [
                    'varying vec2 vUv; uniform sampler2D map; uniform float hue; uniform float swap;',
                    'vec3 rgb2hsl(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float l=(mx+mn)*.5; if(mx==mn) return vec3(0.,0.,l);',
                    '  float d=mx-mn; float s=l>.5?d/(2.-mx-mn):d/(mx+mn); float h=mx==c.r?(c.g-c.b)/d+(c.g<c.b?6.:0.):mx==c.g?(c.b-c.r)/d+2.:(c.r-c.g)/d+4.; return vec3(h/6.,s,l); }',
                    'float h2r(float p,float q,float t){ t=fract(t); if(t<1./6.) return p+(q-p)*6.*t; if(t<.5) return q; if(t<2./3.) return p+(q-p)*(2./3.-t)*6.; return p; }',
                    'vec3 hsl2rgb(vec3 c){ if(c.y==0.) return vec3(c.z); float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y; float p=2.*c.z-q; return vec3(h2r(p,q,c.x+1./3.),h2r(p,q,c.x),h2r(p,q,c.x-1./3.)); }',
                    'void main(){ vec4 c = texture2D(map, vUv);',
                    '  if (swap > .5) { vec3 s = pow(c.rgb, vec3(1./2.2)); vec3 h = rgb2hsl(s); h.x = hue; s = hsl2rgb(h); c.rgb = pow(s, vec3(2.2)); }',
                    '  gl_FragColor = c;',
                    '  #include <encodings_fragment>',
                    '}',
                ].join('\n'),
            });
            const floor = new THREE.Mesh(floorGeometry, floorMaterial);
            floor.renderOrder = -1;
            floorScene.add(floor);

            // tank
            const scene = new THREE.Scene();
            const ambient = new THREE.AmbientLight(0xffffff, 1);
            const sun = new THREE.DirectionalLight(0xffffff, 0.45);
            sun.position.set(-2, 8, 6);
            scene.add(ambient, sun);
            const place = new THREE.Group();
            const turn = new THREE.Group();
            turn.rotation.y = (-135.683 * Math.PI) / 180;
            place.add(turn);
            scene.add(place);
            const reflectionMaterial = (map) => new THREE.ShaderMaterial({
                uniforms: { texture1: { value: map } },
                vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
                fragmentShader: 'varying vec2 vUv; uniform sampler2D texture1; void main(){ vec4 c = texture2D(texture1, vUv); c.a *= 0.025; c.rgb *= 0.45; gl_FragColor = c; }',
            });
            const meshes = [];
            let loadedName = null;
            let loading = null;
            async function loadModel(name) {
                if (loadedName === name || loading === name) return;
                loading = name;
                status.textContent = 'loading tank';
                const t0 = performance.now();
                const gltf = await loader.loadAsync(MODEL_URL(name), (p) => {
                    if (p.total) status.textContent = 'loading tank ' + Math.round((100 * p.loaded) / p.total) + '%';
                });
                console.log('[mockup] tank loaded in', Math.round(performance.now() - t0), 'ms');
                if (loading !== name) return;
                while (turn.children.length) turn.remove(turn.children[0]);
                meshes.length = 0;
                const tank = new THREE.Group();
                const mirror = new THREE.Group();
                mirror.scale.set(1, -1, 1);
                gltf.scene.traverse((o) => {
                    if (!o.isMesh) return;
                    const map = o.material && o.material.map;
                    const m = new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ map }));
                    m.userData.map = map;
                    meshes.push(m);
                    tank.add(m);
                    mirror.add(new THREE.Mesh(o.geometry, reflectionMaterial(map)));
                });
                turn.add(tank, mirror);
                loadedName = name;
                loading = null;
                setLight();
                status.textContent = 'ready';
            }
            let lightMode = null;
            function setLight() {
                if (lightMode === state.light && meshes.every((m) => m.userData.mode === state.light)) return;
                lightMode = state.light;
                for (const m of meshes) {
                    m.material.dispose();
                    m.material = state.light === 'flat'
                        ? new THREE.MeshBasicMaterial({ map: m.userData.map })
                        : new THREE.MeshLambertMaterial({ map: m.userData.map });
                    m.userData.mode = state.light;
                }
                if (state.light === 'game') {
                    // the game's TankPreviewLightSettings: ambient 100/255, light 200/255 from above
                    ambient.intensity = 0.39;
                    sun.intensity = 0.78;
                    sun.position.set(0, 10, 1);
                } else {
                    ambient.intensity = 1;
                    sun.intensity = 0.45;
                    sun.position.set(-2, 8, 6);
                }
            }

            // mouse drift and drag to turn
            const mouse = { x: 0, y: 0 };
            addEventListener('mousemove', (e) => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = -(e.clientY / innerHeight - 0.5); });
            let dragging = false;
            let lastX = 0;
            let yaw = 0;
            canvas.addEventListener('pointerdown', (e) => { if (state.drag === 'on') { dragging = true; lastX = e.clientX; canvas.setPointerCapture(e.pointerId); } });
            canvas.addEventListener('pointerup', () => { dragging = false; });
            canvas.addEventListener('pointermove', (e) => { if (dragging) { yaw += (e.clientX - lastX) * 0.01; lastX = e.clientX; } });

            function resize() {
                const w = innerWidth;
                const h = innerHeight;
                renderer.setSize(w, h, false);
                camera.aspect = floorCamera.aspect = w / h;
                camera.updateProjectionMatrix();
                floorCamera.updateProjectionMatrix();
            }
            addEventListener('resize', resize);
            resize();

            let target = STAGE[state.layout];
            const shown = { x: target.x, y: target.y, scale: target.scale, camZ: target.camZ, lookY: target.lookY ?? 1.2 };
            function frame() {
                target = STAGE[state.layout] || STAGE[1];
                // ease the tank to its place when the layout changes
                for (const k of ['x', 'y', 'scale', 'camZ', 'lookY']) shown[k] += ((target[k] ?? 1.2) - shown[k]) * 0.08;
                look.set(0, shown.lookY, 0);
                place.position.set(shown.x, shown.y, 0.028);
                place.scale.setScalar(shown.scale);
                turn.rotation.y = (-135.683 * Math.PI) / 180 + yaw;
                const base = new THREE.Vector3(0, 3.4605, shown.camZ);
                const goal = base.clone();
                goal.x += 4 * mouse.x;
                goal.y += 4 * mouse.y;
                camPos.lerp(goal, 0.05);
                camera.position.copy(camPos);
                camera.lookAt(look);
                floorCamera.position.copy(state.floor === 'css' ? base : camPos);
                floorCamera.lookAt(look);
                const themeHue = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hue')) || 205;
                floorMaterial.uniforms.swap.value = state.colour === 'blue' ? 0 : 1; // blue: the picture as it is
                floorMaterial.uniforms.hue.value = themeHue / 360;
                renderer.clear();
                renderer.render(floorScene, floorCamera);
                renderer.render(scene, camera);
                requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
            stage = {
                update() { loadModel(state.model).catch((e) => { status.textContent = '3D failed: ' + e.message; }); setLight(); },
            };
            stage.update();
        } catch (e) {
            status.textContent = '3D failed (needs internet): ' + e.message;
            console.error(e);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        sprite();
        controls();
        apply();
        setTimeout(() => document.body.classList.add('mk-ready'), 600); // layout changes slide, the first paint does not
        startStage();
    });
})();
