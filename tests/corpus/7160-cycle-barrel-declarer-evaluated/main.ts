/* A three-module ES cycle closed through a BARREL: constants.ts →
 * bot.ts → jid.ts → constants.ts. jid.ts reads WA_DEFAULTS at its top
 * level, through the barrel — and the fence used to refuse exactly that
 * read ("the cycle-crossing binding 'WA_DEFAULTS' is read ... outside any
 * function body"). The specifier names the module the read goes THROUGH;
 * the alias resolves to defaults.ts, which the walk finished before it
 * entered the cluster, so the storage is initialized and Node's
 * partially-initialized module is not observable. Node runs this; so does
 * the compiled program.
 *
 * This is zapo's own `src/protocol/{constants,bot,jid}.ts` shape, reduced. */
import { isBotJid, isKnownServer, isUserJid } from "./constants.ts";

console.log(isUserJid("123@s.whatsapp.net"));
console.log(isUserJid("123@g.us"));
console.log(isBotJid("bot456@s.whatsapp.net"));
console.log(isBotJid("456@s.whatsapp.net"));
console.log(isKnownServer("123@g.us"));
console.log(isKnownServer("123@example.com"));
