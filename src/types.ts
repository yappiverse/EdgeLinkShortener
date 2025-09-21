export type Bindings = {
    DB: D1Database;
    LINKS_KV: KVNamespace
    URL: string;
    secretKey: string;
    TURNSTILE_SECRET: string;
};

export type TurnstileVerifyResponse = {
    success: boolean;
    challenge_ts?: string;
    hostname?: string;
    "error-codes"?: string[];
};