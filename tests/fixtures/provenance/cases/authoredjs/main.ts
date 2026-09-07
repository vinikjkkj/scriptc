// Reads a CONST, an OBJECT table and a FUNCTION off an authored-JavaScript
// package. The const is what read `0` instead of `5` while the twin's module
// init was emitted and never called, so it is the line that fails first if
// that edge is dropped again.
import { channelCount, CHANNEL_WIRE_CODES, ENUMS, PROTOCOL_VERSION } from "authoredjs";

console.log("protocol=" + String(PROTOCOL_VERSION));
console.log("wire.regular=" + String(CHANNEL_WIRE_CODES.regular));
console.log("wire.private=" + String(CHANNEL_WIRE_CODES.private));
console.log("fn.count=" + String(channelCount()));
console.log("CHAT_OPEN=" + String(ENUMS.UI_ACTION_TYPE.values.CHAT_OPEN));
console.log("LT128=" + String(ENUMS.SIZE_BUCKET.values.LT128));
