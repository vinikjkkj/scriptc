import { isUserJid } from "./jid.ts";
export function isBotJid(jid: string): boolean {
  return isUserJid(jid) && jid.startsWith("bot");
}
