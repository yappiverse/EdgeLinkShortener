export type Bindings = {
    DB: D1Database;
    EdgeLinkCache: KVNamespace;
    ASSETS: Fetcher;
    URL: string;
    TURNSTILE_SECRET: string;
    TURNSTILE_SITEKEY: string;
};

export type TurnstileVerifyResponse = {
    success: boolean;
    challenge_ts?: string;
    hostname?: string;
    "error-codes"?: string[];
};