interface SkinsDatabase {
  readonly brands: Readonly<Record<string, string>>;
  readonly names: Readonly<Record<string, string>>;
  readonly defaults: Readonly<Record<string, string>>;
  readonly database: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

interface KaspUserActionMessage {
  readonly type: "kasp:useraction";
  readonly detail: string[];
}

interface Window {
  __kaspSendAction?: (className: string, obj: unknown) => void;
}
