import { WA_DEFAULTS } from "./constants.ts";
const KNOWN_SERVERS: Record<string, string> = {
  [WA_DEFAULTS.HOST_DOMAIN]: WA_DEFAULTS.HOST_DOMAIN,
};
export function isUserJid(jid: string): boolean {
  return KNOWN_SERVERS[jid.slice(jid.indexOf("@") + 1)] !== undefined;
}
