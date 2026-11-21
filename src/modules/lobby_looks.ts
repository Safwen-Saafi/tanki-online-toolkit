// The lobby looks the player can pick (build-plan 26f on), in ONE place: the look data (lobby.ts, which must have a look for every
// value here or the build fails), the floor cleaning (hangar_files.ts: `sunlit` looks keep the game's own floor, every other look
// gets the cleaned one) and the settings tab's Lobby look list (settings_tab.ts). A new look is added here, with its data in
// lobby.ts. The saved choice is kasp_lobby_look; no key (or an unknown one) is the first look.
// Shared only in the two ways already proven in this project (2026-11-21, after this list, run in both script worlds, was not
// found by the settings tab): in the page's world as window.__kaspLobbyLooks (this file runs before lobby.js and hangar_files.js,
// as lobby_pass.js before lobby.js), and to the extension's world as the page's data-kasp-lobby-looks attribute (as
// hangar_files_base.ts's data-kasp-hangar-base the other way), read by the settings tab when it is opened. The other files never
// name KASP_LOBBY_LOOKS itself; it is kept for the types below.
const KASP_LOBBY_LOOKS = [
    { value: 'day-normal', label: { EN: 'Day', RU: 'День' }, sunlit: true },
    { value: 'day-sunny', label: { EN: 'Day, very sunny', RU: 'День, очень солнечно' }, sunlit: true },
    { value: 'night-normal', label: { EN: 'Night', RU: 'Ночь' }, sunlit: false },
    { value: 'day-rainy', label: { EN: 'Day, rainy', RU: 'День, дождь' }, sunlit: false },
    { value: 'night-rainy', label: { EN: 'Night, rainy', RU: 'Ночь, дождь' }, sunlit: false },
    { value: 'day-foggy', label: { EN: 'Day, foggy', RU: 'День, туман' }, sunlit: false },
    { value: 'night-foggy', label: { EN: 'Night, foggy', RU: 'Ночь, туман' }, sunlit: false },
] as const;
type KaspLobbyLookName = (typeof KASP_LOBBY_LOOKS)[number]['value'];
window.__kaspLobbyLooks = KASP_LOBBY_LOOKS;
document.documentElement.setAttribute('data-kasp-lobby-looks', JSON.stringify(KASP_LOBBY_LOOKS.map((l) => ({ value: l.value, label: l.label }))));
