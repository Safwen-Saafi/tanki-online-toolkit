// MAIN-world content script for the showroom garage (build-plan 25, see blueprint/context/garage-restyle-research.md): the garage's
// 3D looks and moves like the official skins preview page. The injector (src/injector.ts) edits the 3D tank code at start, only
// while the switch kasp_showroom is on, so that every frame a 3D tank asks window.__kaspShowroom.camera for its camera and the tank
// model asks window.__kaspShowroom.drone where to move the drone. This file defines both; they answer only while the garage is open
// (the main lobby's tank runs the same code and keeps the game's camera). It also draws the website's floor on a canvas of its own,
// put at the very back of the page (#root) when the page has loaded, and everything the screens draw stays on top. The garage's own
// box lets it show through, live (it moves with the mouse there); every other screen's box paints a calm, still copy of it with
// softer light, made once when the floor picture has loaded (styles/showroom.css). The floor is hidden in a battle. With the switch off none of the game's calls arrive, and this file does nothing.
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
    // The garage's category bar has seven items, the Drones tab is the 4th; read by place, so any game language works.
    const MENU_ITEMS = '.GarageMenuComponentStyle-garageMenuContainer .MenuComponentStyle-mainMenuItem';
    const MENU_LENGTH = 7;
    const DRONES_PLACE = 3;
    const ACTIVE_ITEM = /-activeMenu/;
    const TAB_READ_MS = 100;

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

    function camera(tankHeight: number): KaspShowroomCamera | null {
        if (garageBoxes.length === 0) {
            keepFloor();
            return null;
        }
        const garageScreen = garageBoxes[0].parentElement;
        if (garageScreen !== null && !garageScreen.hasAttribute(GARAGE_MARK)) garageScreen.setAttribute(GARAGE_MARK, '');
        lastFrame = performance.now();
        if (!listening) {
            addEventListener('mousemove', onMove, true);
            listening = true;
        }
        eased.x += (mouse.x - eased.x) * EASE;
        eased.y += (mouse.y - eased.y) * EASE;
        const sideways = eased.x * MOUSE_RANGE;
        cameraAnswer.distance = Math.hypot(DISTANCE, sideways);
        cameraAnswer.angle = TURN + Math.atan2(sideways, DISTANCE);
        cameraAnswer.height = (Number.isFinite(tankHeight) ? tankHeight : 0) + CAMERA_UP + eased.y * MOUSE_RANGE;
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
    let tabReadAt = -Infinity;

    function dronesTabOpen(): boolean {
        try {
            const items = document.querySelectorAll(MENU_ITEMS);
            return items.length === MENU_LENGTH && ACTIVE_ITEM.test(items[DRONES_PLACE].className);
        } catch {
            return false;
        }
    }

    function drone(): KaspShowroomDrone | null {
        if (!framed) return null;
        framed = false;
        if (lastFrame - tabReadAt >= TAB_READ_MS) {
            tabReadAt = lastFrame;
            droneAnswer.shown = dronesTabOpen();
        }
        return droneAnswer;
    }

    window.__kaspShowroom = { camera, drone };
    // The floor is the background from the first screen on, before any 3D tank is drawn.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', keepFloor, { once: true });
    else keepFloor();
})();
