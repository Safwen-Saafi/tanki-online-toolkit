// MAIN-world content script for the showroom garage (build-plan 25, see blueprint/context/garage-restyle-research.md): the garage's
// 3D looks and moves like the official skins preview page. The injector (src/injector.ts) edits the 3D tank code at start, only
// while the switch kasp_showroom is on, so that every frame a 3D tank asks window.__kaspShowroom.camera for its camera and the tank
// model asks window.__kaspShowroom.drone where to move the drone. This file defines both; they answer only while the garage is open
// (the main lobby's tank runs the same code and keeps the game's camera). It also draws the website's floor on a canvas of its own,
// put at the very back of the page (#root) when the page has loaded, and everything the screens draw stays on top. The garage's own
// box lets it show through, live (it moves with the mouse there); every other screen's box paints a calm, still copy of it with
// softer light, made once when the floor picture has loaded (styles/showroom.css). The floor is hidden in a battle. With the switch off none of the game's calls arrive, and this file does nothing.
// On the Turrets and Hulls tabs (25g) the camera swings round to the tank's other side, so the tank stands on the right facing left,
// and on Hulls it then closes in on the hull from the front and low down; each move eases in and out, and the screens opened from
// those tabs (Augments, Skins, Shot colour) keep the pose.
// On the Grenades screen (25f1) the game keeps the tank shown (an injector edit) and the camera turns round the turret to the
// grenade, read from the tank model the game passes in, so it finds a grenade on the right or the left side of any turret.
// On the Protection tab (25f3) the camera goes round the tank's right side to its back, easing in and out like the other moves.
// Nothing watches the page: no observer, no interval. Work happens only inside the frames the game draws for a 3D tank; the one
// mouse listener takes itself away on its first event after the garage stopped drawing, and comes back with the garage.
(function () {
    'use strict';

    const SWITCH_KEY = 'kasp_showroom';
    const LOG = '[KI-test][showroom]';
    // The game empties the page's console functions when it runs; this file runs before it.
    const warn = console.warn.bind(console);

    // The website's camera in the game's units, with the owner's final numbers (2026-11-13).
    const FOV = (22 * Math.PI) / 180;
    const DISTANCE = 1307;
    const CAMERA_UP = 416;
    const LOOK_UP = 97;
    const SIDE = 171;
    const TURN = (53.4 * Math.PI) / 180;
    // The website moves its camera 4 of its units per half screen of mouse, and draws the model at scale 0.007079.
    const MOUSE_RANGE = 4 / 0.007079;
    // 5% of the way to the mouse every frame, like the website: the game draws the garage once per screen frame.
    const EASE = 0.05;
    const IDLE_MS = 500;

    // The game puts the drone at the hull plus this offset; the owner's place is right of the tank, up and towards the camera.
    const GAME_DRONE = { x: 250, y: -160, z: 70 };
    const DRONE_RIGHT = 296;
    const DRONE_UP = 70;
    const DRONE_FRONT = 20;
    // The garage's category bar has seven items: Turrets, Hulls, Grenades, Drones and so on; read by place, so any game language
    // works. Only a bar of exactly seven decides: the screens opened from Turrets or Hulls have a shorter bar of their own.
    const MENU_ITEMS = '.GarageMenuComponentStyle-garageMenuContainer .MenuComponentStyle-mainMenuItem';
    const MENU_LENGTH = 7;
    const TURRETS_PLACE = 0;
    const HULLS_PLACE = 1;
    const GRENADES_PLACE = 2;
    const DRONES_PLACE = 3;
    const PROTECTION_PLACE = 4;
    const ACTIVE_ITEM = /-activeMenu/;
    const TAB_READ_MS = 100;
    // Only the main screen has this block.
    const MAIN_SCREEN = '.MountedItemsStyle-containerBlockGarage';

    // The owner's numbers from the live probe (2026-11-14). On Turrets and Hulls: the camera turned to the tank's other side, pushed
    // the other way and a little further, so the tank stands on the right facing left. On Hulls, on top of that: turned more to the
    // front, closer, the camera at 0.3 of its height above the tank and looking at a lower point. Each move takes SWING_MS.
    const TURRET_POSE = { turn: (126.6 * Math.PI) / 180, side: -125, far: 1.12 };
    const HULL_POSE = { turn: (112 * Math.PI) / 180, side: -110, far: 0.9, lift: 0.3, look: 70 };
    const SWING_MS = 700;
    // The most time one frame may move a swing, so a long gap between two frames never makes it jump.
    const MAX_FRAME_MS = 50;
    // On Protection (25f3, owner 2026-11-15): the camera from behind the tank. The main pose turned from front to back (its turn
    // mirrored), so the camera goes round the tank's right side, which stays in view, and the tank keeps its place on the left of
    // the screen, at the same distance and height. From the Turrets or Hulls pose it is half a turn either way, so it stays smooth.
    const REAR_POSE = { turn: -TURN };

    // The Grenades screen (25f1, the owner's numbers from the live probe, 2026-11-15): the camera stands straight out from the
    // turret's middle through the grenade, GRENADE_FAR from it and GRENADE_UP above it, and the grenade sits in the middle of the
    // free space between the left column and the tabs column. The columns' fixed places, in the game's em, from the stylesheets:
    // the left column ends at 6 + 22.5, the tabs column starts 1 + 4.6 from the right, both run from 7.3 under the top to 13 above
    // the bottom. Measured boxes are never used: the item cards slide up as the screen opens, and aiming at them shook the camera.
    const GRENADE_FAR = 800;
    const GRENADE_UP = 250;
    const FREE_LEFT_EM = 28.5;
    const FREE_RIGHT_EM = 5.6;
    const FREE_TOP_EM = 7.3;
    const FREE_BOTTOM_EM = 13;
    const TAU = 2 * Math.PI;
    // Only the Grenades screen has these (its still picture, which the game draws for the grenades category only, and its count
    // box); live lists, so reading their length every frame costs next to nothing. Not the lit tab: the tab, the screen and the
    // tank change at slightly different moments.
    const grenadePictures = document.getElementsByClassName('GarageGrenadePreviewComponentStyle-view');
    const grenadeCounts = document.getElementsByClassName('TanksPartComponentStyle-amountItems');
    // On <html> once the injector's grenade part is known to work: styles/showroom_grenades.css waits for it.
    const GRENADES_MARK = 'data-kasp-showroom-grenades';

    // A live list, so the check reads the page again only after the page changed.
    const garageBoxes = document.getElementsByClassName('GarageCommonStyle-garageContainer');

    const FLOOR_ATTRIBUTE = 'data-kasp-showroom-floor';
    const FLOOR_ADDRESS = /^chrome-extension:\/\/[a-p]{32}\/showroom\/floor\.png$/;
    const FLOOR_ID = 'kasp-showroom-floor';
    const PAGE_ROOT_ID = 'root';
    // The calm floor, a still picture made once, as a CSS variable that styles/showroom.css paints on every screen's own box; the
    // garage's box gets this mark (it goes away with the garage), so it stays see-through and shows the live floor.
    const CALM_VARIABLE = '--kasp-showroom-calm';
    const GARAGE_MARK = 'data-kasp-showroom-garage';
    const MAX_PIXEL_RATIO = 2;
    // The website's floor model (floor-3.glb, a floor that curves up into a back wall), Draco-decoded once.
    const FLOOR_POSITIONS = [13.35163, 0, 13.35163, 13.35163, 0, -6.49611, -13.35163, 0, 13.35163, -13.35163, 0, -6.49611, 13.35163, 0.09128, -7.43007, -13.35163, 0.09128, -7.43007, 13.35163, 0.27709, -8.35913, -13.35163, 0.27709, -8.35913, 13.35163, 0.54929, -9.2556, -13.35163, 0.54929, -9.2556, 13.35163, 0.81986, -9.91083, -13.35163, 0.81986, -9.91083, 13.35163, 1.5354, -10.9817, -13.35163, 1.5354, -10.9817, 13.35163, 2.36993, -11.81623, -13.35163, 2.36993, -11.81623, 13.35163, 2.81979, -12.11614, -13.35163, 2.81979, -12.11614, 13.35163, 3.58912, -12.52688, -13.35163, 3.58912, -12.52688, 13.35163, 4.42854, -12.87569, -13.35163, 4.42854, -12.87569, 13.35163, 5.26307, -13.12833, -13.35163, 5.26307, -13.12833, 13.35163, 5.26307, -13.12833, -13.35163, 5.26307, -13.12833, 13.35163, 6.07967, -13.23264, -13.35163, 6.07967, -13.23264, 13.35163, 6.70719, -13.29295, -13.35163, 6.70719, -13.29295, 13.35163, 7.88401, -13.35163, -13.35163, 7.88401, -13.35163, -13.35163, 13.61975, -13.35163, 13.35163, 13.61975, -13.35163];
    const FLOOR_UVS = [0.70973, 0.98879, 0.70973, 0.47193, 0.01414, 0.98879, 0.01414, 0.47193, 0.70973, 0.44735, 0.01414, 0.44735, 0.70973, 0.42253, 0.01414, 0.42253, 0.70973, 0.39796, 0.01414, 0.39796, 0.70973, 0.3791, 0.01414, 0.3791, 0.70973, 0.34546, 0.01414, 0.34546, 0.70973, 0.3142, 0.01414, 0.3142, 0.70973, 0.30012, 0.01414, 0.30012, 0.70973, 0.27697, 0.01414, 0.27697, 0.70973, 0.25287, 0.01414, 0.25287, 0.70973, 0.22996, 0.01414, 0.22996, 0.70973, 0.22996, 0.01414, 0.22996, 0.70973, 0.20825, 0.01414, 0.20825, 0.70973, 0.19179, 0.01414, 0.19179, 0.70973, 0.161, 0.01414, 0.161, 0.01414, 0.01162, 0.70973, 0.01162];
    const FLOOR_INDEX = [0, 1, 2, 2, 1, 3, 1, 4, 3, 3, 4, 5, 4, 6, 5, 5, 6, 7, 6, 8, 7, 7, 8, 9, 8, 10, 9, 9, 10, 11, 10, 12, 11, 11, 12, 13, 12, 14, 13, 13, 14, 15, 14, 16, 15, 15, 16, 17, 16, 18, 17, 17, 18, 19, 18, 20, 19, 19, 20, 21, 20, 22, 21, 21, 22, 23, 22, 24, 23, 23, 24, 25, 24, 26, 25, 25, 26, 27, 26, 28, 27, 27, 28, 29, 28, 30, 29, 29, 30, 31, 32, 31, 33, 31, 30, 33];
    // The website's floor camera: eye (4x, 3.4605 + 4y, 9) for the eased mouse (x, y), looking at (0, 1.2, 0).
    const FLOOR_EYE_HEIGHT = 3.4605;
    const FLOOR_EYE_DISTANCE = 9;
    const FLOOR_LOOK_HEIGHT = 1.2;
    const FLOOR_MOUSE_RANGE = 4;
    // Hue swap on every pixel: the picture's white light streaks are nearly grey, and leaving those out made a blue-grey blob.
    // The calm look (every screen but the garage, owner 2026-11-13) also rolls the light off softly above the dark floor (always
    // rising, so no ring round the brightest spot) and gives the pale glows the colour; it always sets one hue, since the
    // near-white pixels carry random tints that the added colour would show as speckles. The floor picture's own blue is 208.
    const FLOOR_BLUE_HUE = 208;
    const FLOOR_SHADER = [
        'precision mediump float; varying vec2 v; uniform sampler2D t; uniform float hue; uniform float swap; uniform float calm;',
        'vec3 rgb2hsl(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float l=(mx+mn)*.5; if(mx==mn) return vec3(0.,0.,l);',
        '  float d=mx-mn; float s=l>.5?d/(2.-mx-mn):d/(mx+mn); float h=mx==c.r?(c.g-c.b)/d+(c.g<c.b?6.:0.):mx==c.g?(c.b-c.r)/d+2.:(c.r-c.g)/d+4.; return vec3(h/6.,s,l); }',
        'float h2r(float p,float q,float t){ t=fract(t); if(t<1./6.) return p+(q-p)*6.*t; if(t<.5) return q; if(t<2./3.) return p+(q-p)*(2./3.-t)*6.; return p; }',
        'vec3 hsl2rgb(vec3 c){ if(c.y==0.) return vec3(c.z); float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y; float p=2.*c.z-q; return vec3(h2r(p,q,c.x+1./3.),h2r(p,q,c.x),h2r(p,q,c.x-1./3.)); }',
        'void main(){ vec4 c = texture2D(t, v);',
        '  if (swap > .5 || calm > .5) { vec3 h = rgb2hsl(c.rgb); h.x = hue;',
        '    if (calm > .5) { float k = smoothstep(.12, .45, h.z); h.y = min(1., h.y + k * (.5 - h.y * .5)); if (h.z > .15) h.z = .15 + (h.z - .15) / (1. + (h.z - .15) * 6.); }',
        '    c.rgb = hsl2rgb(h); }',
        '  gl_FragColor = c; }',
    ].join('\n');
    const VERTEX_SHADER = 'attribute vec3 p; attribute vec2 uv; uniform mat4 m; varying vec2 v; void main(){ v = uv; gl_Position = m * vec4(p, 1.); }';

    function isSwitchedOff(): boolean {
        try {
            return localStorage.getItem(SWITCH_KEY) === '0';
        } catch {
            return false;
        }
    }

    if (isSwitchedOff()) return;

    const mouse = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    let listening = false;
    let lastFrame = 0;

    function onMove(event: MouseEvent): void {
        if (performance.now() - lastFrame > IDLE_MS) {
            removeEventListener('mousemove', onMove, true);
            listening = false;
            return;
        }
        mouse.x = event.clientX / innerWidth - 0.5;
        mouse.y = -(event.clientY / innerHeight - 0.5);
    }

    // ---- the floor ----

    interface Floor {
        readonly canvas: HTMLCanvasElement;
        draw: (force: boolean) => void;
        hue: number | null;
    }

    let floor: Floor | null = null;
    let floorFailed = false;

    function floorFails(why: string): void {
        if (floorFailed) return;
        floorFailed = true;
        warn(`${LOG} no showroom floor: ${why}`);
        floor?.canvas.remove();
        floor = null;
    }

    // The game colour's hue, or null for the game's own blue, from the two variables the injector writes once at start.
    function themeHue(): number | null {
        const style = document.documentElement.style;
        const hue = Number.parseFloat(style.getPropertyValue('--kasp-theme-hue'));
        return style.getPropertyValue('--kasp-theme-strength').trim() === '1' && Number.isFinite(hue) ? hue : null;
    }

    // Projection times view for the website's camera (column-major, as WebGL takes it).
    function floorMatrix(eye: readonly [number, number, number], aspect: number): Float32Array {
        const f = 1 / Math.tan(FOV / 2);
        const near = 0.1;
        const far = 1000;
        const P = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
        const back = [eye[0], eye[1] - FLOOR_LOOK_HEIGHT, eye[2]];
        const backLength = Math.hypot(back[0], back[1], back[2]);
        const z = [back[0] / backLength, back[1] / backLength, back[2] / backLength];
        const xLength = Math.hypot(z[2], z[0]);
        const x = [z[2] / xLength, 0, -z[0] / xLength];
        const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
        const dot = (a: readonly number[]): number => a[0] * eye[0] + a[1] * eye[1] + a[2] * eye[2];
        const V = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x), -dot(y), -dot(z), 1];
        const M = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) sum += P[k * 4 + row] * V[col * 4 + k];
                M[col * 4 + row] = sum;
            }
        }
        return M;
    }

    function shader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
        const made = gl.createShader(type);
        if (made === null) throw new Error('no shader');
        gl.shaderSource(made, source);
        gl.compileShader(made);
        if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(made) ?? 'shader');
        return made;
    }

    function makeFloor(): Floor | null {
        const address = document.documentElement.getAttribute(FLOOR_ATTRIBUTE);
        if (address === null || !FLOOR_ADDRESS.test(address)) {
            floorFails('the picture address is missing or not the extension\'s');
            return null;
        }
        const canvas = document.createElement('canvas');
        canvas.id = FLOOR_ID;
        // Hidden until the garage's first frame: only the garage shows the live floor (every other screen covers it with the calm
        // picture), and while the game is still loading nothing would cover it.
        canvas.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;display:none';
        // Kept between draws: the floor is drawn rarely and must still be there after a battle hid it.
        const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
        if (gl === null) {
            floorFails('no WebGL');
            return null;
        }
        const program = gl.createProgram();
        if (program === null) throw new Error('no program');
        gl.attachShader(program, shader(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
        gl.attachShader(program, shader(gl, gl.FRAGMENT_SHADER, FLOOR_SHADER));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
        gl.useProgram(program);
        const attribute = (name: string, data: readonly number[], size: number): void => {
            gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
            const at = gl.getAttribLocation(program, name);
            gl.enableVertexAttribArray(at);
            gl.vertexAttribPointer(at, size, gl.FLOAT, false, 0, 0);
        };
        attribute('p', FLOOR_POSITIONS, 3);
        attribute('uv', FLOOR_UVS, 2);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(FLOOR_INDEX), gl.STATIC_DRAW);
        gl.disable(gl.DEPTH_TEST);
        const matrixAt = gl.getUniformLocation(program, 'm');
        const hueAt = gl.getUniformLocation(program, 'hue');
        const swapAt = gl.getUniformLocation(program, 'swap');
        const calmAt = gl.getUniformLocation(program, 'calm');
        const texture = gl.createTexture();

        let ready = false;
        let drawn = { x: NaN, y: NaN, width: 0, height: 0, hue: null as number | null };
        const paint = (mouseX: number, mouseY: number, calm: boolean, width: number, height: number): void => {
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            gl.viewport(0, 0, width, height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const eye: [number, number, number] = [FLOOR_MOUSE_RANGE * mouseX, FLOOR_EYE_HEIGHT + FLOOR_MOUSE_RANGE * mouseY, FLOOR_EYE_DISTANCE];
            gl.uniformMatrix4fv(matrixAt, false, floorMatrix(eye, innerWidth / innerHeight));
            gl.uniform1f(hueAt, (made.hue ?? FLOOR_BLUE_HUE) / 360);
            gl.uniform1f(swapAt, made.hue === null ? 0 : 1);
            gl.uniform1f(calmAt, calm ? 1 : 0);
            gl.drawElements(gl.TRIANGLES, FLOOR_INDEX.length, gl.UNSIGNED_SHORT, 0);
        };
        const pixelSize = (): [number, number] => {
            const ratio = Math.min(MAX_PIXEL_RATIO, devicePixelRatio || 1);
            return [Math.round(innerWidth * ratio), Math.round(innerHeight * ratio)];
        };
        const made: Floor = {
            canvas,
            hue: themeHue(),
            draw(force: boolean): void {
                if (!ready) return;
                const [width, height] = pixelSize();
                const still = Math.abs(eased.x - drawn.x) < 1e-4 && Math.abs(eased.y - drawn.y) < 1e-4;
                if (!force && still && width === drawn.width && height === drawn.height && made.hue === drawn.hue) return;
                drawn = { x: eased.x, y: eased.y, width, height, hue: made.hue };
                paint(eased.x, eased.y, false, width, height);
            },
        };
        // The calm floor at rest, painted once at the window's own size (it is soft, more pixels add nothing) and kept as a picture;
        // then the live floor. A data: address: the game page's security rules allow data: pictures but not blob: ones.
        const makeCalm = (): void => {
            paint(0, 0, true, innerWidth, innerHeight);
            document.documentElement.style.setProperty(CALM_VARIABLE, `url("${canvas.toDataURL('image/webp', 0.92)}")`);
            made.draw(true);
        };
        const picture = new Image();
        picture.crossOrigin = 'anonymous';
        picture.onload = () => {
            try {
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                ready = true;
                makeCalm();
            } catch (e: unknown) {
                floorFails('the picture was refused (' + (e instanceof Error ? e.message : String(e)) + ')');
            }
        };
        picture.onerror = () => floorFails('the picture did not load');
        picture.src = address;
        return made;
    }

    // The first child of #root, the box that holds the whole game: drawn right after #root's own background and before every screen,
    // so nothing a screen draws can end up under it. Put back by the next 3D frame if the page ever removes it.
    function placeFloor(current: Floor): void {
        const root = document.getElementById(PAGE_ROOT_ID);
        if (root === null) return;
        root.insertBefore(current.canvas, root.firstChild);
        current.hue = themeHue();
        current.draw(true);
    }

    function keepFloor(): void {
        if (floorFailed) return;
        try {
            if (floor === null) floor = makeFloor();
            if (floor === null) return;
            if (floor.canvas.isConnected) floor.draw(false);
            else placeFloor(floor);
        } catch (e: unknown) {
            floorFails(e instanceof Error ? e.message : String(e));
        }
    }

    // ---- what the garage's code calls ----

    const cameraAnswer: KaspShowroomCamera = { fov: FOV, distance: DISTANCE, height: CAMERA_UP, look: LOOK_UP, angle: TURN, side: SIDE };
    let framed = false;

    // How far each swing has gone (0 = the garage's usual pose, 1 = the whole move) and where it is going; set from the tabs
    // (turret, hull, rear) and from the Grenades screen being in the page (grenade).
    const swing = { turret: 0, hull: 0, rear: 0, grenade: 0 };
    const goal = { turret: 0, hull: 0, rear: 0, grenade: 0 };
    // Whether the last frame's camera was the whole grenade pose (none of the pose under it showing).
    let grenadeWhole = false;
    let droneShown = false;
    let tabReadAt = -Infinity;

    // ---- the Grenades screen's camera (25f1) ----

    interface Point {
        readonly x: number;
        readonly y: number;
        readonly z: number;
    }

    const field = (owner: unknown, name: string): unknown =>
        typeof owner === 'object' && owner !== null ? (owner as Record<string, unknown>)[name] : undefined;

    function point(value: unknown, parts: KaspShowroomParts): Point | null {
        const x = field(value, parts.x);
        const y = field(value, parts.y);
        const z = field(value, parts.z);
        return typeof x === 'number' && typeof y === 'number' && typeof z === 'number' ? { x, y, z } : null;
    }

    let grenadesMarked = false;
    // The grenade's last place on each turret, for a frame where the game has taken the grenade off for a moment.
    const lastGrenade = new WeakMap<object, Point>();

    // Where the grenade is (game units, the tank's floor axes) and which way it sticks out from the turret's middle: the tank's
    // place + the turret's place on the hull + the grenade's place on the turret (the game puts it at the turret model's "fmnt"
    // point, 15 up), turned with the turret. Null with no grenade seen on this turret.
    function grenadePlace(model: unknown, parts: KaspShowroomParts): { readonly at: Point; readonly outX: number; readonly outY: number } | null {
        const turret = field(model, parts.turret);
        if (typeof turret !== 'object' || turret === null) return null;
        const mount = point(field(turret, parts.place), parts);
        if (mount === null) return null;
        let local = point(field(field(model, parts.grenade), parts.place), parts);
        if (local !== null) lastGrenade.set(turret, local);
        else local = lastGrenade.get(turret) ?? null;
        if (local === null) return null;
        const tank = point(field(model, parts.place), parts) ?? { x: 0, y: 0, z: 0 };
        const turn = field(field(turret, parts.turn), parts.z);
        const yaw = typeof turn === 'number' && Number.isFinite(turn) ? turn : 0;
        const outX = local.x * Math.cos(yaw) - local.y * Math.sin(yaw);
        const outY = local.x * Math.sin(yaw) + local.y * Math.cos(yaw);
        return { at: { x: tank.x + mount.x + outX, y: tank.y + mount.y + outY, z: tank.z + mount.z + local.z }, outX, outY };
    }

    // The middle of the free space in pixels, read again only when the window size changes (the game's em follows it).
    const free = { width: -1, height: -1, x: 0, y: 0 };
    function freeMiddle(garageBox: Element): void {
        if (free.width === innerWidth && free.height === innerHeight) return;
        const em = Number.parseFloat(getComputedStyle(garageBox).fontSize) || 14;
        free.width = innerWidth;
        free.height = innerHeight;
        free.x = (FREE_LEFT_EM * em + innerWidth - FREE_RIGHT_EM * em) / 2;
        free.y = (FREE_TOP_EM * em + innerHeight - FREE_BOTTOM_EM * em) / 2;
    }

    // The grenade pose, with the mouse drift. The game's camera stands at (cos a, sin a) x distance + side x (-sin a, cos a), at the
    // answer's height, and looks at side x (-sin a, cos a) at the tank's height + look: the look point can only move sideways, so
    // the camera is pushed back by the grenade's distance along the view and the look tilted so the line of sight passes through it.
    const grenadeAnswer = { angle: 0, distance: 0, height: 0, side: 0, look: 0 };
    function aimAtGrenade(at: Point, outX: number, outY: number, tankHeight: number): void {
        const angle = Math.atan2(outY, outX) + Math.atan2(eased.x * MOUSE_RANGE, DISTANCE);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const along = at.x * cos + at.y * sin;
        const across = -at.x * sin + at.y * cos;
        const up = GRENADE_UP + eased.y * MOUSE_RANGE * (GRENADE_FAR / DISTANCE);
        const depth = Math.hypot(GRENADE_FAR, up);
        const focal = innerHeight / 2 / Math.tan(FOV / 2);
        const distance = Math.max(50, along + GRENADE_FAR);
        const height = at.z + up;
        const lookAtGrenade = at.z + ((free.y - innerHeight / 2) / focal) * depth;
        grenadeAnswer.angle = angle;
        grenadeAnswer.distance = distance;
        grenadeAnswer.height = height;
        grenadeAnswer.side = across - ((free.x - innerWidth / 2) / focal) * depth;
        grenadeAnswer.look = height + ((lookAtGrenade - height) * distance) / GRENADE_FAR - tankHeight;
    }

    // The grenade pose's turn as one continuous number: the way round is picked once, when the move starts (the shorter one from
    // where the camera is then), and then only follows the small changes. Picking the shorter way anew every frame flipped sides
    // in the middle of a half-turn move and shook the camera (probe v1.2, 2026-11-15).
    let grenadeTurn: number | null = null;

    // The main screen: no swing. The 7-tab bar: the turret pose on Turrets and Hulls, the hull close-up on Hulls, the rear on
    // Protection, the drone on Drones. On Grenades the pose under the grenade move stays the one of the screen before, so the camera
    // goes straight from there to the grenade (a pose moving at the same time pulled it aside and back). No 7-tab bar (a screen
    // opened from Turrets or Hulls): every swing stays where it is.
    function readTabs(): void {
        try {
            droneShown = false;
            if (document.querySelector(MAIN_SCREEN) !== null) {
                goal.turret = 0;
                goal.hull = 0;
                goal.rear = 0;
                return;
            }
            const items = document.querySelectorAll(MENU_ITEMS);
            if (items.length !== MENU_LENGTH) return;
            let lit = -1;
            for (let i = 0; i < items.length && lit < 0; i++) if (ACTIVE_ITEM.test(items[i].className)) lit = i;
            if (lit === GRENADES_PLACE) return;
            goal.turret = lit === TURRETS_PLACE || lit === HULLS_PLACE ? 1 : 0;
            goal.hull = lit === HULLS_PLACE ? 1 : 0;
            goal.rear = lit === PROTECTION_PLACE ? 1 : 0;
            droneShown = lit === DRONES_PLACE;
        } catch {
            droneShown = false;
        }
    }

    const towards = (value: number, target: number, step: number): number =>
        target > value ? Math.min(target, value + step) : Math.max(target, value - step);
    // Ease in and out.
    const smooth = (x: number): number => x * x * (3 - 2 * x);
    // The camera's turn for how far the turret, hull and rear moves have gone, without the mouse.
    const poseTurn = (turret: number, hull: number, rear: number): number =>
        TURN + (TURRET_POSE.turn - TURN) * turret + (HULL_POSE.turn - TURRET_POSE.turn) * hull + (REAR_POSE.turn - TURN) * rear;

    function camera(tankHeight: number, model?: unknown, parts?: KaspShowroomParts): KaspShowroomCamera | null {
        if (parts !== undefined && !grenadesMarked) {
            grenadesMarked = true;
            document.documentElement.setAttribute(GRENADES_MARK, '');
        }
        if (garageBoxes.length === 0) {
            keepFloor();
            return null;
        }
        const garageScreen = garageBoxes[0].parentElement;
        if (garageScreen !== null && !garageScreen.hasAttribute(GARAGE_MARK)) garageScreen.setAttribute(GARAGE_MARK, '');
        const now = performance.now();
        // Back in the garage after a pause (or the first frame): the tank takes the pose of the screen at once, with no swing.
        const away = now - lastFrame > IDLE_MS;
        if (away || now - tabReadAt >= TAB_READ_MS) {
            tabReadAt = now;
            readTabs();
        }
        goal.grenade = parts !== undefined && (grenadePictures.length > 0 || grenadeCounts.length > 0) ? 1 : 0;
        // Leaving the Grenades screen while the camera is all grenade pose: the pose under it does not show in this frame, so it takes
        // the next screen's pose at once (the tab lights before the screen changes, so it is read now), and the grenade turn is put
        // the shorter way round from it (a whole turn more or less: the same view). The camera then goes straight from the grenade
        // to the next pose, never round the long way and never aside and back.
        if (!away && grenadeWhole && goal.grenade === 0 && grenadeTurn !== null) {
            tabReadAt = now;
            readTabs();
            swing.turret = goal.turret;
            swing.hull = goal.hull;
            swing.rear = goal.rear;
            const next = poseTurn(goal.turret, goal.hull, goal.rear);
            grenadeTurn += TAU * Math.round((next - grenadeTurn) / TAU);
        }
        if (away) {
            swing.turret = goal.turret;
            swing.hull = goal.hull;
            swing.rear = goal.rear;
            swing.grenade = goal.grenade;
        } else {
            const step = Math.min(now - lastFrame, MAX_FRAME_MS) / SWING_MS;
            swing.turret = towards(swing.turret, goal.turret, step);
            swing.hull = towards(swing.hull, goal.hull, step);
            swing.rear = towards(swing.rear, goal.rear, step);
            swing.grenade = towards(swing.grenade, goal.grenade, step);
        }
        lastFrame = now;
        if (!listening) {
            addEventListener('mousemove', onMove, true);
            listening = true;
        }
        eased.x += (mouse.x - eased.x) * EASE;
        eased.y += (mouse.y - eased.y) * EASE;
        const turret = smooth(swing.turret);
        const hull = smooth(swing.hull);
        const rear = smooth(swing.rear);
        const far = 1 + (TURRET_POSE.far - 1) * turret + (HULL_POSE.far - TURRET_POSE.far) * hull;
        const lift = 1 + (HULL_POSE.lift - 1) * hull;
        const sideways = eased.x * MOUSE_RANGE;
        cameraAnswer.distance = Math.hypot(DISTANCE, sideways) * far;
        cameraAnswer.angle = poseTurn(turret, hull, rear) + Math.atan2(sideways, DISTANCE);
        cameraAnswer.height = (Number.isFinite(tankHeight) ? tankHeight : 0) + (CAMERA_UP + eased.y * MOUSE_RANGE) * far * lift;
        cameraAnswer.side = SIDE + (TURRET_POSE.side - SIDE) * turret + (HULL_POSE.side - TURRET_POSE.side) * hull;
        cameraAnswer.look = LOOK_UP + (HULL_POSE.look - LOOK_UP) * hull;
        const place = swing.grenade > 0 && parts !== undefined ? grenadePlace(model, parts) : null;
        if (place !== null) {
            freeMiddle(garageBoxes[0]);
            aimAtGrenade(place.at, place.outX, place.outY, Number.isFinite(tankHeight) ? tankHeight : 0);
            grenadeTurn = grenadeAnswer.angle + TAU * Math.round(((grenadeTurn ?? cameraAnswer.angle) - grenadeAnswer.angle) / TAU);
            const k = smooth(swing.grenade);
            cameraAnswer.angle += (grenadeTurn - cameraAnswer.angle) * k;
            cameraAnswer.distance += (grenadeAnswer.distance - cameraAnswer.distance) * k;
            cameraAnswer.height += (grenadeAnswer.height - cameraAnswer.height) * k;
            cameraAnswer.side += (grenadeAnswer.side - cameraAnswer.side) * k;
            cameraAnswer.look += (grenadeAnswer.look - cameraAnswer.look) * k;
        } else if (swing.grenade === 0) {
            grenadeTurn = null;
        }
        grenadeWhole = place !== null && swing.grenade === 1;
        framed = true;
        keepFloor();
        if (floor !== null && floor.canvas.style.display === 'none') floor.canvas.style.display = '';
        return cameraAnswer;
    }

    // The drone's move, in the game's floor axes, for the still pose: right of the tank on screen and towards the camera.
    const droneAnswer: KaspShowroomDrone = {
        x: -DRONE_RIGHT * Math.sin(TURN) + DRONE_FRONT * Math.cos(TURN) - GAME_DRONE.x,
        y: DRONE_RIGHT * Math.cos(TURN) + DRONE_FRONT * Math.sin(TURN) - GAME_DRONE.y,
        z: DRONE_UP - GAME_DRONE.z,
        shown: false,
    };

    // The Drones tab is read with the other tabs in camera(), which runs just before this in the same frame.
    function drone(): KaspShowroomDrone | null {
        if (!framed) return null;
        framed = false;
        droneAnswer.shown = droneShown;
        return droneAnswer;
    }

    window.__kaspShowroom = { camera, drone };
    // The floor is the background from the first screen on, before any 3D tank is drawn.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', keepFloor, { once: true });
    else keepFloor();
})();
