// MAIN-world content script for the showroom garage (build-plan 25, see blueprint/context/garage-restyle-research.md): the garage's
// 3D looks and moves like the official skins preview page. The injector (src/injector.ts) edits the 3D tank code at start, only
// while the switch kasp_showroom is on, so that every frame a 3D tank asks window.__kaspShowroom.camera for its camera and the tank
// model asks window.__kaspShowroom.drone where to move the drone. This file defines both; they answer only while the garage is open
// (the main lobby's tank runs the same code and keeps the game's camera). It also draws the website's floor on a canvas of its own,
// put at the very back of the page (#root) when the page has loaded, and everything the screens draw stays on top: a closed studio
// room (25d1) whose floor and back wall are the website's floor exactly, its camera worked out from each garage frame's camera
// answer, so every camera move (the tab swings, the mouse drift) moves the tank and the floor together. The garage's own box lets
// it show through, live; every other screen's box paints a calm, still copy of it in the main pose with softer light, made once
// when the floor picture has loaded (styles/showroom.css). The floor is hidden in a battle. With the switch off none of the game's
// calls arrive, and this file does nothing.
// On the Turrets and Hulls tabs (25g) the camera swings round to the tank's other side, so the tank stands on the right facing left,
// and on Hulls it then closes in on the hull from the front and low down; each move eases in and out, and the screens opened from
// those tabs (Augments, Skins, Shot colour) keep the pose.
// On the Grenades screen (25f1) the game keeps the tank shown (an injector edit) and the camera turns round the turret to the
// grenade, read from the tank model the game passes in, so it finds a grenade on the right or the left side of any turret.
// On the Protection tab (25f3) the camera goes round the tank's right side to its back, easing in and out like the other moves.
// On the Supplies screen (25f4) the game keeps the tank shown (the same injector edit) and the camera faces the tank's front.
// On the Paints tab (25d1) the tank moves further left, and a drag turns the whole view round it, all the way round (the floor's
// camera follows); a 360 icon under the tank and a round button that turns the view back show there (styles/showroom_paints.css).
// Nothing watches the page: no observer, no interval. Work happens only inside the frames the game draws for a 3D tank; the mouse
// listener and Paints' pointer listeners take themselves away on the first mouse move after the garage stopped drawing, and come
// back with the garage.
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
    // How long after the garage's last frame the camera still answers with its pose: covers the one frame the game draws after the
    // garage closed, and is far shorter than any other screen takes to draw a 3D tank.
    const LEAVE_HOLD_MS = 100;

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
    const SUPPLIES_PLACE = 5;
    const PAINTS_PLACE = 6;
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
    // On Protection (25f3, owner 2026-11-15): the camera from behind the tank, going round the tank's right side, at the main
    // pose's distance and height, so the tank keeps its place on the left of the screen. Straight behind is -90 degrees (the
    // tank's front is +y); first the main pose mirrored (-53.4), then turned more to the rear (owner: it showed too much side).
    const REAR_POSE = { turn: (-83 * Math.PI) / 180 };
    // On Supplies (25f4, owner 2026-11-15): the camera straight in front of the tank (the tank's front is +y, so a quarter turn),
    // at the main pose's distance, height and sideways push, so the tank stays left of the column on the right.
    const FRONT_POSE = { turn: Math.PI / 2 };
    // On Paints (25d1, owner 2026-11-16): the tank further left (side) and in the middle of the screen's height (look), a sixth eased
    // move; dragging turns the whole view round the tank, as far as the player likes, PAINTS_DRAG radians a pixel, eased over
    // PAINTS_EASE_MS (the floor's camera follows the answer, so the tank, the floor and its light turn together).
    const PAINTS_POSE = { side: 140, look: 163 };
    const PAINTS_DRAG = 0.01;
    const PAINTS_EASE_MS = 70;
    // Where a drag may start: in the garage, under the header (6.04em, the game's) and left of the paints column (25d2: 14em from the
    // right edge, 27.5em wide), never on one of these (cards, buttons, links, fields, the paints screen's blocks and list, the tabs
    // column, our round button).
    const HEADER_EM = 6.04;
    const PAINTS_COLUMN_RIGHT_EM = 14;
    const PAINTS_COLUMN_WIDTH_EM = 27.5;
    const NO_DRAG = '.garage-item, button, a, input, [class*="PaintsCollectionComponentStyle-headlinePaint"], [class*="PaintsCollectionComponentStyle-fullDescriptionPaint"], '
        + '[class*="PaintsCollectionComponentStyle-descriptionBlockCollection"], [class*="PaintsCollectionComponentStyle-captionPaint"], '
        + '[class*="PaintsCollectionComponentStyle-commonBlockFOrInfoAndCaptionCategory"], [class*="PaintsCollectionComponentStyle-favoriteIconContainer"], '
        + '[class*="ListItemsComponentStyle-"], [class*="TanksPartComponentStyle-tankPartUpgrades"], [class*="MenuComponentStyle-"], '
        + '[class*="BreadcrumbsComponentStyle-"]';
    // On <html> while Paints is lit; styles/showroom_paints.css shows the 360 icon and the round button only then.
    const PAINTS_MARK = 'data-kasp-showroom-paints';
    const TURN_ICON_ID = 'kasp-showroom-turn';
    const TURN_BACK_ID = 'kasp-showroom-turn-back';
    const DRAGGING_ATTRIBUTE = 'data-dragging';
    const ICON_VARIABLE = '--kasp-showroom-turn-icon';

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
    // On <html> once the injector's grenade part is known to work: styles/showroom_grenades.css waits for it; the same for its
    // supplies part and styles/showroom_supplies.css.
    const GRENADES_MARK = 'data-kasp-showroom-grenades';
    const SUPPLIES_MARK = 'data-kasp-showroom-supplies';

    // A live list, so the check reads the page again only after the page changed.
    const garageBoxes = document.getElementsByClassName('GarageCommonStyle-garageContainer');

    // The floor picture's address (src/modules/showroom_floor.ts), and the mark the injector puts on <html> once its garage edits
    // went in (the stylesheets wait for it too): without it there is no floor, so a game build the edits miss keeps the game's garage.
    const PICTURE_ATTRIBUTE = 'data-kasp-showroom-picture';
    const SHOWROOM_ON_ATTRIBUTE = 'data-kasp-showroom-floor';
    const FLOOR_ADDRESS = /^chrome-extension:\/\/[a-p]{32}\/showroom\/floor\.png$/;
    const FLOOR_ID = 'kasp-showroom-floor';
    const PAGE_ROOT_ID = 'root';
    // The calm floor, a still picture made once, as a CSS variable that styles/showroom.css paints on every screen's own box; the
    // garage's box gets this mark (it goes away with the garage), so it stays see-through and shows the live floor.
    const CALM_VARIABLE = '--kasp-showroom-calm';
    const GARAGE_MARK = 'data-kasp-showroom-garage';
    const MAX_PIXEL_RATIO = 2;

    // ---- the studio room (25d1) ----

    // A floor camera in the room's own units: where the eye is and the point it looks at.
    interface RoomView {
        readonly eye: readonly [number, number, number];
        readonly look: readonly [number, number, number];
    }
    // The showroom's main pose in the game's units, the one that is the website's floor camera exactly.
    interface RoomPose {
        readonly turn: number;
        readonly side: number;
        readonly distance: number;
        readonly look: number;
        // The camera's height above the look point.
        readonly rise: number;
    }
    // How strong each of the room's lights is, 0 to 1 (a missing one is off): a pool of light on the floor under the tank, turntable
    // rings round it, a light strip along the walls' foot, floor tiles, darker screen edges, a light sweeping round the walls (it
    // moves), a glow rising up the walls.
    interface RoomLights {
        readonly pool?: number;
        readonly rings?: number;
        readonly strip?: number;
        readonly tiles?: number;
        readonly edges?: number;
        readonly sweep?: number;
        readonly glow?: number;
        // 1: the floor picture's own lights taken out (its two white beams, the pale patch and the bright lamp spots), so only the
        // room's lights light the room (owner 2026-11-16: no light on the ground except in the Website look).
        readonly bare?: number;
    }
    interface RoomDrawer {
        // Throws when the browser refuses the picture.
        picture: (image: HTMLImageElement) => void;
        // seconds: the sweeping light's clock; strength: how much of the lights shows, 0 to 1 (0 is the Website look).
        draw: (view: RoomView, hue: number | null, calm: boolean, width: number, height: number, aspect: number, lights: RoomLights, seconds: number, strength: number) => void;
    }

    // ROOM-START: the room the floor canvas draws. The offline check runs the compiled code between the two markers on its own, so
    // nothing in it reads the rest of this file.
    const ROOM = (() => {
        // The website's floor (floor-3.glb) in its own units: a floor at height 0 from z 13.35 (front) to z -6.50, then a wall curving
        // up to 13.6 at z -13.35, 26.7 wide, nothing at the sides or in front. The picture's u follows x (u = U0 + KU x), v follows z
        // on the floor and the height on the wall. The tank stands at (TANK_X, TANK_Z), its middle TANK_Y up.
        // The room keeps that floor and that back wall exactly (the same picture places), and adds the same curved wall on the left,
        // the right and in front, with rounded corners: a closed studio the camera can go all the way round. The picture on every
        // wall carries on from the floor's own place at the wall's foot, so there is no seam anywhere; from the back corners on, the
        // walls (and the floor's last 2.5 before them) fade to the picture's plain dark edge, so the light beams stay on the back
        // wall and the floor only.
        const U0 = 0.361935;
        const KU = 0.026051;
        const U_MIN = 0.02;
        const U_MAX = 0.69;
        const TANK_X = -1.21133;
        const TANK_Y = 0.514267;
        const TANK_Z = 0.027776;
        const Z_FRONT = 13.35163;
        const Z_BACK = -6.49611;
        const V_FRONT = 0.98879;
        const V_BACK = 0.47193;
        const floorV = (z: number): number => V_BACK + ((z - Z_BACK) * (V_FRONT - V_BACK)) / (Z_FRONT - Z_BACK);
        // The wall's cross-section from the back of floor-3: [distance past the foot, height, v].
        const WALL: readonly (readonly [number, number, number])[] = [[0, 0, 0.47193], [0.93396, 0.09128, 0.44735], [1.86302, 0.27709, 0.42253],
            [2.75949, 0.54929, 0.39796], [3.41472, 0.81986, 0.3791], [4.48559, 1.5354, 0.34546], [5.32012, 2.36993, 0.3142], [5.62003, 2.81979, 0.30012],
            [6.03077, 3.58912, 0.27697], [6.37958, 4.42854, 0.25287], [6.63222, 5.26307, 0.22996], [6.73653, 6.07967, 0.20825],
            [6.79684, 6.70719, 0.19179], [6.85552, 7.88401, 0.161], [6.85552, 13.61975, 0.01162]];
        // The walls' feet round the tank: the back one where floor-3 has it, the sides and the front 11 away, corners of radius 3 (the
        // straight back runs 8 each side of the tank, wider than the screen shows of it in the main pose).
        const BACK = TANK_Z - Z_BACK;
        const SIDES = 11;
        const FRONT = 11;
        const CORNER = 3;
        const STEP = 0.25;
        // Round the tank from straight behind: where the walls start to go plain, and where they are all plain.
        const FADE_FROM = (50 * Math.PI) / 180;
        const FADE_TO = (90 * Math.PI) / 180;
        // How far before a plain wall's foot the floor starts to go plain too.
        const FLOOR_FADE = 2.5;
        const smooth = (x: number): number => {
            const c = Math.min(1, Math.max(0, x));
            return c * c * (3 - 2 * c);
        };
        const plainness = (x: number, z: number): number => smooth((Math.abs(Math.atan2(x, -z)) - FADE_FROM) / (FADE_TO - FADE_FROM));

        // The feet walked once round (from the tank): [x, z, outward x, outward z], about every STEP, the first one again at the end.
        function feet(): (readonly [number, number, number, number])[] {
            const out: (readonly [number, number, number, number])[] = [];
            const line = (x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): void => {
                const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / STEP));
                for (let i = 0; i < n; i++) out.push([x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, nx, nz]);
            };
            const arc = (cx: number, cz: number, from: number, to: number): void => {
                const n = Math.ceil((CORNER * Math.abs(to - from)) / STEP);
                for (let i = 0; i < n; i++) {
                    const t = from + ((to - from) * i) / n;
                    out.push([cx + CORNER * Math.cos(t), cz + CORNER * Math.sin(t), Math.cos(t), Math.sin(t)]);
                }
            };
            const left = -SIDES;
            const right = SIDES;
            const back = -BACK;
            const c = CORNER;
            line(left + c, back, right - c, back, 0, -1);
            arc(right - c, back + c, -Math.PI / 2, 0);
            line(right, back + c, right, FRONT - c, 1, 0);
            arc(right - c, FRONT - c, 0, Math.PI / 2);
            line(right - c, FRONT, left + c, FRONT, 0, 1);
            arc(left + c, FRONT - c, Math.PI / 2, Math.PI);
            line(left, FRONT - c, left, back + c, -1, 0);
            arc(left + c, back + c, Math.PI, 1.5 * Math.PI);
            out.push(out[0]);
            return out;
        }

        // Each point: p its place, a its place in the picture, w = (how plain it is, the plain edge's v there), q its distance from the
        // walls' foot (minus on the floor, plus up the wall; the lights along the foot and up the walls read it).
        function mesh(): { p: number[]; a: number[]; w: number[]; q: number[]; index: number[] } {
            const ring = feet();
            const cols = ring.length;
            const p: number[] = [];
            const a: number[] = [];
            const w: number[] = [];
            const q: number[] = [];
            const index: number[] = [];
            const floorSteps = [0, 0.3, 0.55, 0.72, 0.84, 0.92, 1];
            for (const f of floorSteps) {
                for (const [fx, fz] of ring) {
                    const x = TANK_X + fx * f;
                    const z = TANK_Z + fz * f;
                    p.push(x, 0, z);
                    a.push(U0 + KU * x, floorV(z));
                    const before = (1 - f) * Math.hypot(fx, fz);
                    w.push(plainness(fx, fz) * smooth(1 - before / FLOOR_FADE), V_BACK);
                    q.push(-before);
                }
            }
            for (const [d, y, v] of WALL.slice(1)) {
                for (const [fx, fz, nx, nz] of ring) {
                    p.push(TANK_X + fx + nx * d, y, TANK_Z + fz + nz * d);
                    // The picture carries on from the foot: the foot's own floor place, raised by the wall's own v.
                    a.push(U0 + KU * (TANK_X + fx), floorV(TANK_Z + fz) - (V_BACK - v));
                    w.push(plainness(fx, fz), v);
                    q.push(d);
                }
            }
            const rows = floorSteps.length + WALL.length - 1;
            for (let i = 0; i + 1 < rows; i++) {
                for (let j = 0; j + 1 < cols; j++) {
                    const k = i * cols + j;
                    index.push(k, k + cols, k + 1, k + 1, k + cols, k + cols + 1);
                }
            }
            return { p, a, w, q, index };
        }

        const VERTEX = 'attribute vec3 p; attribute vec2 a; attribute vec2 w; attribute float q; uniform mat4 m; varying vec2 va; varying vec2 vw;'
            + ' varying vec3 vp; varying float vq; void main(){ va = a; vw = w; vp = p; vq = q; gl_Position = m * vec4(p, 1.); }';
        // The plain walls take the mean of the picture's two edge columns at their own v. Then the lights (owner 2026-11-16), all in
        // the floor picture's own blue (so the game colour turns them too) and fixed in the room (so they move with the camera like the
        // rest): fx = (pool, rings, strip, tiles), fx2 = (edges, sweep, glow, the clock in seconds). Then the hue swap on every pixel:
        // the picture's white light streaks are nearly grey, and leaving those out made a blue-grey blob. The calm look (every screen
        // but the garage, owner 2026-11-13) has no lights, and rolls the light off softly above the dark floor (always rising, so no
        // ring round the brightest spot) and gives the pale glows the colour; it always sets one hue, since the near-white pixels
        // carry random tints that the added colour would show as speckles. The floor picture's own blue is 208.
        const BLUE_HUE = 208;
        const FRAGMENT = [
            'precision mediump float; varying vec2 va; varying vec2 vw; varying vec3 vp; varying float vq; uniform sampler2D t;',
            'uniform float hue; uniform float swap; uniform float calm; uniform float bare; uniform vec4 fx; uniform vec4 fx2; uniform vec2 res;',
            'vec3 rgb2hsl(vec3 c){ float mx=max(c.r,max(c.g,c.b)), mn=min(c.r,min(c.g,c.b)); float l=(mx+mn)*.5; if(mx==mn) return vec3(0.,0.,l);',
            '  float d=mx-mn; float s=l>.5?d/(2.-mx-mn):d/(mx+mn); float h=mx==c.r?(c.g-c.b)/d+(c.g<c.b?6.:0.):mx==c.g?(c.b-c.r)/d+2.:(c.r-c.g)/d+4.; return vec3(h/6.,s,l); }',
            'float h2r(float p,float q,float t){ t=fract(t); if(t<1./6.) return p+(q-p)*6.*t; if(t<.5) return q; if(t<2./3.) return p+(q-p)*(2./3.-t)*6.; return p; }',
            'vec3 hsl2rgb(vec3 c){ if(c.y==0.) return vec3(c.z); float q=c.z<.5?c.z*(1.+c.y):c.z+c.y-c.z*c.y; float p=2.*c.z-q; return vec3(h2r(p,q,c.x+1./3.),h2r(p,q,c.x),h2r(p,q,c.x-1./3.)); }',
            'void main(){ vec4 c = texture2D(t, va);',
            '  float ev = clamp(vw.y, .02, .99);',
            `  vec4 ed = (texture2D(t, vec2(${U_MIN}, ev)) + texture2D(t, vec2(${U_MAX}, ev))) * .5;`,
            '  c = mix(c, ed, vw.x);',
            // Bare: the picture's background never has more than about 0.09 in its weakest channel, its beams and pale patch do (white
            // light added on the blue), so that excess is taken away and a little of the floor's blue put in its place (without it the
            // beams left a darker, greyer shadow); then anything brighter than the broad blue glow (the lamp spots) is rolled off
            // softly, always rising, so no ring shows.
            '  if (bare > 0.) { float white = max(0., min(c.r, min(c.g, c.b)) - .09); vec3 b = c.rgb + vec3(0., .25, .42) * white - white;',
            '    float top = max(b.r, max(b.g, b.b));',
            '    if (top > .3) b *= (.3 + (top - .3) / (1. + (top - .3) * 6.)) / top;',
            '    c.rgb = mix(c.rgb, b, bare); }',
            '  vec3 L = vec3(.33, .62, 1.);',
            `  vec2 rel = vp.xz - vec2(${TANK_X}, ${TANK_Z}); float r = length(rel); float floorPart = step(vp.y, .02);`,
            '  c.rgb += L * fx.x * .5 * exp(-r * r / 6.) * floorPart;',
            '  c.rgb += L * fx.y * .45 * (smoothstep(.07, 0., abs(r - 3.1)) + .55 * smoothstep(.05, 0., abs(r - 3.45))) * floorPart;',
            '  c.rgb += L * fx.z * (.75 * exp(-vq * vq / .05) + .25 * exp(-vq * vq / .8));',
            '  vec2 g = abs(fract(vp.xz / 1.6 - .5) - .5) * 1.6; c.rgb += vec3(.55, .72, 1.) * fx.w * .09 * smoothstep(.03, 0., min(g.x, g.y)) * floorPart * exp(-r / 8.);',
            '  float up = clamp(vq / 1.5, 0., 1.); c.rgb += L * fx2.z * .22 * up * exp(-vp.y / 3.5);',
            '  float ang = atan(rel.x, -rel.y) - fx2.w * .3; ang = mod(ang + 3.14159, 6.28318) - 3.14159;',
            '  c.rgb += L * fx2.y * .4 * exp(-ang * ang / .015) * up * smoothstep(12., 1., vp.y);',
            '  vec2 sc = gl_FragCoord.xy / res - .5; c.rgb *= 1. - fx2.x * .9 * dot(sc, sc);',
            '  if (swap > .5 || calm > .5) { vec3 h = rgb2hsl(c.rgb); h.x = hue;',
            '    if (calm > .5) { float k = smoothstep(.12, .45, h.z); h.y = min(1., h.y + k * (.5 - h.y * .5)); if (h.z > .15) h.z = .15 + (h.z - .15) / (1. + (h.z - .15) * 6.); }',
            '    c.rgb = hsl2rgb(h); }',
            '  gl_FragColor = c; }',
        ].join('\n');

        // Projection times view (column-major, as WebGL takes it); fov is the whole lens angle up and down.
        function matrix(view: RoomView, aspect: number, fov: number): Float32Array {
            const { eye, look } = view;
            const f = 1 / Math.tan(fov / 2);
            const near = 0.1;
            const far = 1000;
            const P = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
            const back = [eye[0] - look[0], eye[1] - look[1], eye[2] - look[2]];
            const backLength = Math.hypot(back[0], back[1], back[2]);
            const z = [back[0] / backLength, back[1] / backLength, back[2] / backLength];
            const xLength = Math.hypot(z[2], z[0]);
            const x = [z[2] / xLength, 0, -z[0] / xLength];
            const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
            const dot = (v: readonly number[]): number => v[0] * eye[0] + v[1] * eye[1] + v[2] * eye[2];
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

        function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
            const made = gl.createShader(type);
            if (made === null) throw new Error('no shader');
            gl.shaderSource(made, source);
            gl.compileShader(made);
            if (!gl.getShaderParameter(made, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(made) ?? 'shader');
            return made;
        }

        // The room on a WebGL canvas; throws when the browser cannot build it.
        function drawer(gl: WebGLRenderingContext, fov: number): RoomDrawer {
            const program = gl.createProgram();
            if (program === null) throw new Error('no program');
            gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
            gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
            gl.useProgram(program);
            const room = mesh();
            const attribute = (name: string, data: readonly number[], size: number): void => {
                gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
                const at = gl.getAttribLocation(program, name);
                gl.enableVertexAttribArray(at);
                gl.vertexAttribPointer(at, size, gl.FLOAT, false, 0, 0);
            };
            attribute('p', room.p, 3);
            attribute('a', room.a, 2);
            attribute('w', room.w, 2);
            attribute('q', room.q, 1);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(room.index), gl.STATIC_DRAW);
            gl.disable(gl.DEPTH_TEST);
            const matrixAt = gl.getUniformLocation(program, 'm');
            const hueAt = gl.getUniformLocation(program, 'hue');
            const swapAt = gl.getUniformLocation(program, 'swap');
            const calmAt = gl.getUniformLocation(program, 'calm');
            const bareAt = gl.getUniformLocation(program, 'bare');
            const fxAt = gl.getUniformLocation(program, 'fx');
            const fx2At = gl.getUniformLocation(program, 'fx2');
            const resAt = gl.getUniformLocation(program, 'res');
            const texture = gl.createTexture();
            return {
                picture(image: HTMLImageElement): void {
                    gl.bindTexture(gl.TEXTURE_2D, texture);
                    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                    gl.generateMipmap(gl.TEXTURE_2D);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
                },
                draw(view: RoomView, hue: number | null, calm: boolean, width: number, height: number, aspect: number, lights: RoomLights, seconds: number, strength: number): void {
                    gl.viewport(0, 0, width, height);
                    gl.clearColor(0, 0, 0, 0);
                    gl.clear(gl.COLOR_BUFFER_BIT);
                    gl.uniformMatrix4fv(matrixAt, false, matrix(view, aspect, fov));
                    gl.uniform1f(hueAt, (hue ?? BLUE_HUE) / 360);
                    gl.uniform1f(swapAt, hue === null ? 0 : 1);
                    gl.uniform1f(calmAt, calm ? 1 : 0);
                    const k = strength;
                    gl.uniform1f(bareAt, (lights.bare ?? 0) * k);
                    gl.uniform4f(fxAt, (lights.pool ?? 0) * k, (lights.rings ?? 0) * k, (lights.strip ?? 0) * k, (lights.tiles ?? 0) * k);
                    gl.uniform4f(fx2At, (lights.edges ?? 0) * k, (lights.sweep ?? 0) * k, (lights.glow ?? 0) * k, seconds);
                    gl.uniform2f(resAt, width, height);
                    gl.drawElements(gl.TRIANGLES, room.index.length, gl.UNSIGNED_SHORT, 0);
                },
            };
        }

        // The floor camera from the game's camera answer (owner 2026-11-16: one room for the whole garage, so the floor moves with
        // every camera move). The main pose is the website's floor camera exactly (eye (0, 3.4605, 9) looking at (0, 1.2, 0)); any
        // other answer is that camera changed the same way: turned round the tank by the answer's turn minus the main turn (both
        // worlds have the floor flat and the up axis the same way round, so the same way), the look point's sideways reach and height
        // scaled by side and look against the main pose's, the eye's distance from the look point and its height above it by
        // distance and (camera height - ground - look) against the main pose's. The mouse drift is in the answer, so it reaches the
        // floor from there.
        const WEB_EYE = [0, 3.4605, 9];
        const WEB_LOOK = [0, 1.2, 0];
        function fromGame(answer: KaspShowroomCamera, ground: number, main: RoomPose): RoomView {
            const turn = answer.angle - main.turn;
            const cos = Math.cos(turn);
            const sin = Math.sin(turn);
            const k = answer.side / main.side;
            const lookX = (WEB_LOOK[0] - TANK_X) * k;
            const lookZ = (WEB_LOOK[2] - TANK_Z) * k;
            const lookY = TANK_Y + (WEB_LOOK[1] - TANK_Y) * (answer.look / main.look);
            const f = answer.distance / main.distance;
            const eyeX = (WEB_EYE[0] - WEB_LOOK[0]) * f;
            const eyeZ = (WEB_EYE[2] - WEB_LOOK[2]) * f;
            const look: [number, number, number] = [TANK_X + lookX * cos + lookZ * sin, lookY, TANK_Z - lookX * sin + lookZ * cos];
            const eyeY = lookY + (WEB_EYE[1] - WEB_LOOK[1]) * ((answer.height - ground - answer.look) / main.rise);
            return { eye: [look[0] + eyeX * cos + eyeZ * sin, eyeY, look[2] - eyeX * sin + eyeZ * cos], look };
        }

        // The looks the player picks from (owner's numbers, probe v5): Website is the floor alone, as before; Stage's light sweeps.
        const LOOKS: { readonly [name: string]: RoomLights } = {
            website: {},
            studio: { pool: 1, strip: 1, glow: 0.7, edges: 0.6, bare: 1 },
            showroom: { pool: 0.9, rings: 1, strip: 0.7, tiles: 1, glow: 0.4, edges: 0.7, bare: 1 },
            stage: { pool: 0.8, rings: 0.6, strip: 1, glow: 0.9, edges: 0.8, sweep: 1, bare: 1 },
        };

        return { drawer, fromGame, LOOKS };
    })();
    // ROOM-END

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
            stopListening();
            return;
        }
        mouse.x = event.clientX / innerWidth - 0.5;
        mouse.y = -(event.clientY / innerHeight - 0.5);
    }

    // The mouse listener and Paints' pointer listeners (25d1) come with the garage's frames and go on the first mouse move after
    // they stopped; Paints ends with them.
    function startListening(): void {
        addEventListener('mousemove', onMove, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        addEventListener('pointermove', onPointerMove, true);
        addEventListener('pointerup', endDrag, true);
        addEventListener('pointercancel', endDrag, true);
        document.addEventListener('dblclick', onDoubleClick, true);
        listening = true;
    }

    function stopListening(): void {
        removeEventListener('mousemove', onMove, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        removeEventListener('pointermove', onPointerMove, true);
        removeEventListener('pointerup', endDrag, true);
        removeEventListener('pointercancel', endDrag, true);
        document.removeEventListener('dblclick', onDoubleClick, true);
        listening = false;
        setPaints(false);
    }

    // ---- the floor ----

    interface Floor {
        readonly canvas: HTMLCanvasElement;
        // live: called from a garage frame, where a moving light is drawn every time.
        draw: (force: boolean, live: boolean) => void;
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

    // The main pose, and the floor camera it gives (the website's own). The live floor follows the last garage frame's camera; until
    // the first one it shows the main pose.
    const MAIN_POSE: RoomPose = { turn: TURN, side: SIDE, distance: DISTANCE, look: LOOK_UP, rise: CAMERA_UP - LOOK_UP };
    const MAIN_VIEW = ROOM.fromGame({ fov: FOV, distance: DISTANCE, height: CAMERA_UP, look: LOOK_UP, angle: TURN, side: SIDE }, 0, MAIN_POSE);
    let floorView = MAIN_VIEW;

    const sameView = (a: RoomView, b: RoomView): boolean => {
        for (let i = 0; i < 3; i++) if (Math.abs(a.eye[i] - b.eye[i]) > 1e-5 || Math.abs(a.look[i] - b.look[i]) > 1e-5) return false;
        return true;
    };

    // The room's look, chosen in the extension's settings tab (Garage background): read at load and each time the garage starts
    // drawing again after a pause, so a choice shows when the player is back in the garage. No key, any other value or a storage
    // that cannot be read means Studio.
    const LOOK_KEY = 'kasp_showroom_look';
    const NO_LIGHTS: RoomLights = {};
    function readLook(): RoomLights {
        try {
            const name = localStorage.getItem(LOOK_KEY);
            if (name === 'website' || name === 'showroom' || name === 'stage') return ROOM.LOOKS[name];
        } catch {
            // the default below
        }
        return ROOM.LOOKS.studio;
    }
    let roomLights = readLook();
    // How far the game has faded its garage tank in, 0 to 1 (owner 2026-11-16: the room's line showed before the tank). Opening the
    // garage, the game fades its 3D canvas from opacity 0 to 1 over about 200 ms (probe 2026-11-16); the room's lights follow the
    // same fade, so the room starts as the plain floor (the Website look, as before 25d1) and lights up with the tank.
    let reveal = 1;
    let revealFrom = 0;
    const TANK_CANVAS_ID = 'tankPreviewCanvas';
    // The longest the lights wait for the fade, in case the canvas stays part-faded for some other reason.
    const REVEAL_MAX_MS = 1000;

    function readReveal(now: number): void {
        if (reveal >= 1) return;
        const tank = document.getElementById(TANK_CANVAS_ID);
        if (tank === null || now - revealFrom > REVEAL_MAX_MS) {
            reveal = 1;
            return;
        }
        const style = getComputedStyle(tank);
        const opacity = Number.parseFloat(style.opacity);
        reveal = style.visibility !== 'visible' ? 0 : Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
    }

    function makeFloor(): Floor | null {
        const address = document.documentElement.getAttribute(PICTURE_ATTRIBUTE);
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
        const room = ROOM.drawer(gl, FOV);

        let ready = false;
        let drawn = { view: null as RoomView | null, width: 0, height: 0, hue: null as number | null, lights: NO_LIGHTS, reveal: 1 };
        const paint = (view: RoomView, calm: boolean, width: number, height: number, lights: RoomLights): void => {
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            room.draw(view, made.hue, calm, width, height, innerWidth / innerHeight, lights, performance.now() / 1000, reveal);
        };
        const pixelSize = (): [number, number] => {
            const ratio = Math.min(MAX_PIXEL_RATIO, devicePixelRatio || 1);
            return [Math.round(innerWidth * ratio), Math.round(innerHeight * ratio)];
        };
        const made: Floor = {
            canvas,
            hue: themeHue(),
            draw(force: boolean, live: boolean): void {
                if (!ready) return;
                const [width, height] = pixelSize();
                const still = drawn.view !== null && sameView(floorView, drawn.view) && !(live && roomLights.sweep);
                const same = width === drawn.width && height === drawn.height && made.hue === drawn.hue && roomLights === drawn.lights && reveal === drawn.reveal;
                if (!force && still && same) return;
                drawn = { view: floorView, width, height, hue: made.hue, lights: roomLights, reveal };
                paint(floorView, false, width, height, roomLights);
            },
        };
        // The calm floor in the main pose with no added lights, painted once at the window's own size (it is soft, more pixels add
        // nothing) and kept as a picture; then the live floor. A data: address: the game page's security rules allow data: pictures
        // but not blob: ones.
        const makeCalm = (): void => {
            paint(MAIN_VIEW, true, innerWidth, innerHeight, NO_LIGHTS);
            document.documentElement.style.setProperty(CALM_VARIABLE, `url("${canvas.toDataURL('image/webp', 0.92)}")`);
            made.draw(true, false);
        };
        const picture = new Image();
        picture.crossOrigin = 'anonymous';
        picture.onload = () => {
            try {
                room.picture(picture);
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
        current.draw(true, false);
    }

    // live: called from a garage frame.
    function keepFloor(live: boolean): void {
        if (floorFailed || !document.documentElement.hasAttribute(SHOWROOM_ON_ATTRIBUTE)) return;
        try {
            if (floor === null) floor = makeFloor();
            if (floor === null) return;
            if (floor.canvas.isConnected) floor.draw(false, live);
            else placeFloor(floor);
        } catch (e: unknown) {
            floorFails(e instanceof Error ? e.message : String(e));
        }
    }

    // ---- what the garage's code calls ----

    const cameraAnswer: KaspShowroomCamera = { fov: FOV, distance: DISTANCE, height: CAMERA_UP, look: LOOK_UP, angle: TURN, side: SIDE };
    let framed = false;

    // How far each swing has gone (0 = the garage's usual pose, 1 = the whole move) and where it is going; set from the tabs
    // (turret, hull, rear, front) and from the Grenades screen being in the page (grenade).
    const swing = { turret: 0, hull: 0, rear: 0, front: 0, grenade: 0, paints: 0 };
    const goal = { turret: 0, hull: 0, rear: 0, front: 0, grenade: 0, paints: 0 };
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

    // ---- Paints: the drag that turns the view (25d1) ----

    let onPaints = false;
    // The view's turn in radians: the goal from the drag, and the shown one, eased towards it every frame.
    const viewTurn = { goal: 0, shown: 0 };
    let dragX: number | null = null;
    let turnIcon: HTMLElement | null = null;
    let turnBackButton: HTMLButtonElement | null = null;

    // Back to the nearest whole turn (the same view, so nothing shows), then eased to the start.
    function unturn(): void {
        viewTurn.shown -= TAU * Math.round(viewTurn.shown / TAU);
        viewTurn.goal = 0;
    }

    function endDrag(): void {
        dragX = null;
        turnIcon?.removeAttribute(DRAGGING_ATTRIBUTE);
    }

    function setPaints(on: boolean): void {
        goal.paints = on ? 1 : 0;
        if (on === onPaints) return;
        onPaints = on;
        if (on) {
            document.documentElement.setAttribute(PAINTS_MARK, '');
        } else {
            document.documentElement.removeAttribute(PAINTS_MARK);
            endDrag();
            unturn();
        }
    }

    function dragAllowed(event: MouseEvent): boolean {
        if (!onPaints || garageBoxes.length === 0) return false;
        const em = Number.parseFloat(getComputedStyle(garageBoxes[0]).fontSize) || 14;
        if (event.clientY < HEADER_EM * em || event.clientX > innerWidth - (PAINTS_COLUMN_RIGHT_EM + PAINTS_COLUMN_WIDTH_EM) * em) return false;
        return event.target instanceof Element && event.target.closest(NO_DRAG) === null;
    }

    function onPointerDown(event: PointerEvent): void {
        if (event.button !== 0 || !dragAllowed(event)) return;
        dragX = event.clientX;
        turnIcon?.setAttribute(DRAGGING_ATTRIBUTE, '');
        event.preventDefault();
    }

    function onPointerMove(event: PointerEvent): void {
        if (dragX === null) return;
        viewTurn.goal += (event.clientX - dragX) * PAINTS_DRAG;
        dragX = event.clientX;
    }

    function onDoubleClick(event: MouseEvent): void {
        if (dragAllowed(event)) unturn();
    }

    function onTurnBack(event: MouseEvent): void {
        event.stopPropagation();
        unturn();
    }

    // The 360 icon (the extension's showroom/turn-360.svg, beside the floor picture) and the round arrow button, made once and kept in
    // the garage's own box, so they go with the garage; styles/showroom_paints.css places them and shows them only on Paints.
    function keepPaintsParts(box: Element): void {
        if (turnBackButton === null) {
            const floorAddress = document.documentElement.getAttribute(PICTURE_ATTRIBUTE);
            if (floorAddress !== null && FLOOR_ADDRESS.test(floorAddress)) {
                turnIcon = document.createElement('div');
                turnIcon.id = TURN_ICON_ID;
                turnIcon.style.setProperty(ICON_VARIABLE, `url("${floorAddress.replace(/floor\.png$/, 'turn-360.svg')}")`);
            }
            turnBackButton = document.createElement('button');
            turnBackButton.type = 'button';
            turnBackButton.id = TURN_BACK_ID;
            turnBackButton.setAttribute('aria-label', 'Turn the view back');
            turnBackButton.addEventListener('click', onTurnBack);
        }
        if (turnBackButton.parentElement === box) return;
        if (turnIcon !== null) box.append(turnIcon);
        box.append(turnBackButton);
    }

    // The main screen: no swing. The 7-tab bar: the turret pose on Turrets and Hulls, the hull close-up on Hulls, the rear on
    // Protection, the front on Supplies, the drone on Drones. On Grenades the pose under the grenade move stays the one of the screen before, so the camera
    // goes straight from there to the grenade (a pose moving at the same time pulled it aside and back). No 7-tab bar (a screen
    // opened from Turrets or Hulls): every swing stays where it is.
    function readTabs(): void {
        try {
            droneShown = false;
            if (document.querySelector(MAIN_SCREEN) !== null) {
                goal.turret = 0;
                goal.hull = 0;
                goal.rear = 0;
                goal.front = 0;
                setPaints(false);
                return;
            }
            const items = document.querySelectorAll(MENU_ITEMS);
            if (items.length !== MENU_LENGTH) return;
            let lit = -1;
            for (let i = 0; i < items.length && lit < 0; i++) if (ACTIVE_ITEM.test(items[i].className)) lit = i;
            setPaints(lit === PAINTS_PLACE);
            if (lit === GRENADES_PLACE) return;
            goal.turret = lit === TURRETS_PLACE || lit === HULLS_PLACE ? 1 : 0;
            goal.hull = lit === HULLS_PLACE ? 1 : 0;
            goal.rear = lit === PROTECTION_PLACE ? 1 : 0;
            goal.front = lit === SUPPLIES_PLACE ? 1 : 0;
            droneShown = lit === DRONES_PLACE;
        } catch {
            droneShown = false;
        }
    }

    const towards = (value: number, target: number, step: number): number =>
        target > value ? Math.min(target, value + step) : Math.max(target, value - step);
    // Ease in and out.
    const smooth = (x: number): number => x * x * (3 - 2 * x);
    // The camera's turn for how far the turret, hull, rear and front moves have gone, without the mouse.
    const poseTurn = (turret: number, hull: number, rear: number, front: number): number =>
        TURN + (TURRET_POSE.turn - TURN) * turret + (HULL_POSE.turn - TURRET_POSE.turn) * hull + (REAR_POSE.turn - TURN) * rear + (FRONT_POSE.turn - TURN) * front;

    function camera(tankHeight: number, photo: boolean, model?: unknown, parts?: KaspShowroomParts): KaspShowroomCamera | null {
        if (parts !== undefined && !grenadesMarked) {
            grenadesMarked = true;
            document.documentElement.setAttribute(GRENADES_MARK, '');
            if (parts.supplies) document.documentElement.setAttribute(SUPPLIES_MARK, '');
        }
        if (garageBoxes.length === 0) {
            // The frame the garage closes: the game draws its tank once more, still shown, before hiding it (probe 2026-11-16).
            // Answered with the garage's last camera (and drone), so the game's own garage view never blinks in.
            if (performance.now() - lastFrame < LEAVE_HOLD_MS) {
                framed = true;
                return cameraAnswer;
            }
            keepFloor(false);
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
        goal.grenade = parts !== undefined && (grenadePictures.length > 0 || grenadeCounts.length > 0) ? 1 : 0;        // Leaving the Grenades screen while the camera is all grenade pose: the pose under it does not show in this frame, so it takes
        // the next screen's pose at once (the tab lights before the screen changes, so it is read now), and the grenade turn is put
        // the shorter way round from it (a whole turn more or less: the same view). The camera then goes straight from the grenade
        // to the next pose, never round the long way and never aside and back.
        if (!away && grenadeWhole && goal.grenade === 0 && grenadeTurn !== null) {
            tabReadAt = now;
            readTabs();
            swing.turret = goal.turret;
            swing.hull = goal.hull;
            swing.rear = goal.rear;
            swing.front = goal.front;
            const next = poseTurn(goal.turret, goal.hull, goal.rear, goal.front);
            grenadeTurn += TAU * Math.round((next - grenadeTurn) / TAU);
        }
        const frameMs = away ? 0 : Math.min(now - lastFrame, MAX_FRAME_MS);
        if (away) {
            roomLights = readLook();
            reveal = 0;
            revealFrom = now;
            swing.turret = goal.turret;
            swing.hull = goal.hull;
            swing.rear = goal.rear;
            swing.front = goal.front;
            swing.grenade = goal.grenade;
            swing.paints = goal.paints;
            viewTurn.goal = 0;
            viewTurn.shown = 0;
        } else {
            const step = frameMs / SWING_MS;
            swing.turret = towards(swing.turret, goal.turret, step);
            swing.hull = towards(swing.hull, goal.hull, step);
            swing.rear = towards(swing.rear, goal.rear, step);
            swing.front = towards(swing.front, goal.front, step);
            swing.grenade = towards(swing.grenade, goal.grenade, step);
            swing.paints = towards(swing.paints, goal.paints, step);
        }
        lastFrame = now;
        if (!listening) startListening();
        eased.x += (mouse.x - eased.x) * EASE;
        eased.y += (mouse.y - eased.y) * EASE;
        const turret = smooth(swing.turret);
        const hull = smooth(swing.hull);
        const rear = smooth(swing.rear);
        const front = smooth(swing.front);
        const far = 1 + (TURRET_POSE.far - 1) * turret + (HULL_POSE.far - TURRET_POSE.far) * hull;
        const lift = 1 + (HULL_POSE.lift - 1) * hull;
        const sideways = eased.x * MOUSE_RANGE;
        cameraAnswer.distance = Math.hypot(DISTANCE, sideways) * far;
        cameraAnswer.angle = poseTurn(turret, hull, rear, front) + Math.atan2(sideways, DISTANCE);
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
        // Paints: the tank's place, and the drag's turn round the tank.
        const paints = smooth(swing.paints);
        cameraAnswer.side += (PAINTS_POSE.side - cameraAnswer.side) * paints;
        cameraAnswer.look += (PAINTS_POSE.look - cameraAnswer.look) * paints;
        viewTurn.shown += (viewTurn.goal - viewTurn.shown) * (1 - Math.exp(-frameMs / PAINTS_EASE_MS));
        if (!onPaints && Math.abs(viewTurn.shown) < 1e-4) viewTurn.shown = 0;
        cameraAnswer.angle -= viewTurn.shown;
        if (onPaints) keepPaintsParts(garageBoxes[0]);
        // Photo mode: no sideways push, so the tank stands in the middle of the screen as in the game's own photo mode.
        if (photo) cameraAnswer.side = 0;
        framed = true;
        // The floor's camera from this very answer, so the tank, the floor and its light move together in every move.
        floorView = ROOM.fromGame(cameraAnswer, Number.isFinite(tankHeight) ? tankHeight : 0, MAIN_POSE);
        readReveal(now);
        keepFloor(true);
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

    // The floor is the background from the first screen on, before any 3D tank is drawn: made when the injector's edits went in
    // (start), and put in the page when it has loaded (or by the first 3D frame).
    window.__kaspShowroom = { start: () => keepFloor(false), camera, drone };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => keepFloor(false), { once: true });
    else keepFloor(false);
})();
