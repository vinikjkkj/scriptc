/* The barrel re-exports bot.ts BEFORE defaults.ts, so the walk enters the
 * cluster with defaults.ts still unevaluated — jid.ts's top-level read of
 * WA_DEFAULTS is exactly the TDZ Node throws on. */
export * from "./bot.ts";
export * from "./defaults.ts";
export * from "./jid.ts";
