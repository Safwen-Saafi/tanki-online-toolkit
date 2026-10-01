import { chromium, type Browser, type BrowserContext } from 'playwright';
import type { Language } from './contract.js';

export interface WikiSite {
    readonly language: Language;
    readonly host: string;
    readonly hubTitle: string;
}

export const SITES: readonly WikiSite[] = [
    { language: 'EN', host: 'en.tankiwiki.com', hubTitle: 'Augments' },
    { language: 'RU', host: 'ru.tankiwiki.com', hubTitle: 'Ustroystva' },
];

export const USER_AGENT =
    'tanki-online-toolkit-augments-bot/1.0 (+https://github.com/Safwen-Saafi/tanki-online-toolkit)';

const REQUEST_GAP_MS = 1000;
const RETRY_BASE_MS = 2000;
const MAX_RETRIES = 2;
const REQUEST_TIMEOUT_MS = 30000;
const CHALLENGE_TIMEOUT_MS = 20000;
const CHALLENGE_COOKIE = 'TCK2';

export class WikiError extends Error {}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function extractParsedHtml(body: string, title: string): string {
    let data: unknown;
    try {
        data = JSON.parse(body);
    } catch {
        throw new WikiError(`"${title}" did not return JSON; the wiki cookie check may not have passed`);
    }
    if (isRecord(data)) {
        const parse = data['parse'];
        if (isRecord(parse)) {
            const text = parse['text'];
            if (isRecord(text) && typeof text['*'] === 'string') {
                const html = text['*'];
                if (!html.includes('device-container')) {
                    throw new WikiError(`"${title}" has no augments on it (no .device-container)`);
                }
                return html;
            }
        }
        const error = data['error'];
        if (isRecord(error) && typeof error['info'] === 'string') {
            throw new WikiError(`wiki refused "${title}": ${error['info']}`);
        }
    }
    throw new WikiError(`unexpected reply for "${title}"`);
}

async function waitForChallengeCookie(context: BrowserContext): Promise<void> {
    const deadline = Date.now() + CHALLENGE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const cookies = await context.cookies();
        if (cookies.some((cookie) => cookie.name === CHALLENGE_COOKIE)) return;
        await sleep(250);
    }
    throw new WikiError(`the wiki cookie check (${CHALLENGE_COOKIE}) did not complete in time`);
}

export class WikiSession {
    private lastRequestAt = 0;

    private constructor(
        private readonly browser: Browser,
        private readonly context: BrowserContext,
        private readonly host: string,
    ) {}

    static async open(site: WikiSite): Promise<WikiSession> {
        const browser = await chromium.launch();
        try {
            const context = await browser.newContext({ userAgent: USER_AGENT });
            const page = await context.newPage();
            await page.goto(`https://${site.host}/`, {
                waitUntil: 'domcontentloaded',
                timeout: REQUEST_TIMEOUT_MS,
            });
            await waitForChallengeCookie(context);
            await page.close();
            return new WikiSession(browser, context, site.host);
        } catch (error) {
            await browser.close();
            throw error;
        }
    }

    async fetchRaw(title: string): Promise<string> {
        return this.get(`https://${this.host}/index.php?title=${encodeURIComponent(title)}&action=raw`);
    }

    async fetchParsedHtml(title: string): Promise<string> {
        const url =
            `https://${this.host}/api.php?action=parse&page=${encodeURIComponent(title)}` +
            '&prop=text&format=json&disablelimitreport=1';
        return extractParsedHtml(await this.get(url), title);
    }

    async close(): Promise<void> {
        await this.browser.close();
    }

    private async get(url: string): Promise<string> {
        for (let attempt = 0; ; attempt++) {
            const wait = this.lastRequestAt + REQUEST_GAP_MS - Date.now();
            if (wait > 0) await sleep(wait);
            this.lastRequestAt = Date.now();

            let failure: string;
            try {
                const response = await this.context.request.get(url, { timeout: REQUEST_TIMEOUT_MS });
                if (response.ok()) return await response.text();
                const status = response.status();
                if (status !== 429 && status < 500) {
                    throw new WikiError(`HTTP ${status} for ${url}`);
                }
                failure = `HTTP ${status}`;
            } catch (error) {
                if (error instanceof WikiError) throw error;
                failure = error instanceof Error ? error.message : String(error);
            }

            if (attempt >= MAX_RETRIES) throw new WikiError(`giving up on ${url}: ${failure}`);
            await sleep(RETRY_BASE_MS * (attempt + 1));
        }
    }
}
