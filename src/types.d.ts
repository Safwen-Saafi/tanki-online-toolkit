interface SkinsDatabase {
  readonly names: Readonly<Record<string, string>>;
  readonly defaults: Readonly<Record<string, string>>;
}

interface KaspUserActionMessage {
  readonly type: "kasp:useraction";
  readonly detail: string[];
}

type KaspLanguageCode = "EN" | "RU";

// Published by src/modules/language.ts; the kasp:language-changed window event carries this as its detail.
interface KaspLanguageChange {
  readonly language: KaspLanguageCode;
  readonly source: "storage" | "html" | "hostname" | "default";
}

interface KaspLanguage {
  readonly get: () => KaspLanguageCode;
  readonly source: () => KaspLanguageChange["source"];
}

type KaspGarageTab = "augments" | "skins" | "shot-color";

// Published by src/modules/garage_tab.ts; read() is null when no item tab menu is on screen.
interface KaspGarageTabReader {
  readonly read: () => KaspGarageTab | null;
}

interface Window {
  __kaspSendAction?: (className: string, obj: unknown) => void;
  kaspLanguage?: KaspLanguage;
  kaspGarageTab?: KaspGarageTabReader;
}
