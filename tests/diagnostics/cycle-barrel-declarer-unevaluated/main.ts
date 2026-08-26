/* The order control for the barrel exemption. Same three-module cycle as
 * tests/corpus/7160-cycle-barrel-declarer-evaluated, with ONE difference:
 * the barrel names bot.ts before defaults.ts, so when the walk reaches
 * jid.ts the declaring module has NOT been evaluated. Node throws
 * `ReferenceError: Cannot access 'WA_DEFAULTS' before initialization`
 * here, and the fence must stay. */
import { isBotJid } from "./constants.ts";
console.log(isBotJid("bot1@s.whatsapp.net"));
