import { WA_DEFAULTS } from "./constants.ts";

/* The top-level read the fence used to refuse: WA_DEFAULTS crosses the
 * cycle-closing edge, but it is DECLARED in defaults.ts, which the walk
 * finished before it ever entered bot.ts. */
const KNOWN_SERVERS: Record<string, string> = {
  [WA_DEFAULTS.HOST_DOMAIN]: WA_DEFAULTS.HOST_DOMAIN,
  [WA_DEFAULTS.GROUP_SERVER]: WA_DEFAULTS.GROUP_SERVER,
};

export function serverOf(jid: string): string {
  const at = jid.indexOf("@");
  return at < 0 ? "" : jid.slice(at + 1);
}

export function isKnownServer(jid: string): boolean {
  return KNOWN_SERVERS[serverOf(jid)] !== undefined;
}

export function isUserJid(jid: string): boolean {
  return serverOf(jid) === WA_DEFAULTS.HOST_DOMAIN;
}
