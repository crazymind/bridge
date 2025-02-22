export const URL: {
    new (url: string | URL, base?: string | URL): URL;
    prototype: URL;
    createObjectURL(obj: Blob | MediaSource): string;
    revokeObjectURL(url: string): void;
};
export const URLSearchParams: {
    new (init?: string | URLSearchParams | string[][] | Record<string, string>): URLSearchParams;
    prototype: URLSearchParams;
    toString(): string;
};
export function parseURL(): void;
export function basicURLParse(): void;
export function serializeURL(): void;
export function serializeHost(): void;
export function serializeInteger(): void;
export function serializeURLOrigin(): void;
export function setTheUsername(): void;
export function setThePassword(): void;
export function cannotHaveAUsernamePasswordPort(): void;
export function percentDecodeBytes(): void;
export function percentDecodeString(): void;
