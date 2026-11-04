// An ES-module entry whose imports evaluate before its own body: the JSON documents the CommonJS chain reads must already hold
// their values when the first imported module runs.
import { WA_VERSION, channel } from "./vs.cjs";
import { WA_VERSION as direct } from "./index.cjs";
console.log(WA_VERSION, channel, direct === WA_VERSION);
