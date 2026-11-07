/* A TypeScript-source package (what zapo's @zapo-js/store-mysql is) that STATICALLY imports an
 * authored-JavaScript package (what mysql2/promise is). It is reached only through import(). */
import { channelCount, CHANNEL_WIRE_CODES, ENUMS, PROTOCOL_VERSION } from "authoredjs";

export function report(): string[] {
  return [
    "protocol=" + String(PROTOCOL_VERSION),
    "wire.regular=" + String(CHANNEL_WIRE_CODES.regular),
    "wire.private=" + String(CHANNEL_WIRE_CODES.private),
    "fn.count=" + String(channelCount()),
    "CHAT_OPEN=" + String(ENUMS.UI_ACTION_TYPE.values.CHAT_OPEN),
    "LT128=" + String(ENUMS.SIZE_BUCKET.values.LT128),
  ];
}
