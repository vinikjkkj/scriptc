// import() of a provenance-mapped AUTHORED-JavaScript package (a CommonJS module whose mapped entry is a
// hand-written .d.ts with its .js beside it: the mysql2/promise shape). Node answers the CJS namespace
// (the lexer-detected named exports, `default` = module.exports); the compiled program used to build clean and
// REJECT the import() at run time ("Cannot load module ... runs in the embedded dynamic engine").
async function main(): Promise<void> {
  const m = await import("authoredjs");
  console.log("protocol=" + String(m.PROTOCOL_VERSION));
  console.log("wire.regular=" + String(m.CHANNEL_WIRE_CODES.regular));
  console.log("wire.private=" + String(m.CHANNEL_WIRE_CODES.private));
  console.log("fn.count=" + String(m.channelCount()));
  console.log("CHAT_OPEN=" + String(m.ENUMS.UI_ACTION_TYPE.values.CHAT_OPEN));
  console.log("LT128=" + String(m.ENUMS.SIZE_BUCKET.values.LT128));
  const d = (m as unknown as { default: { PROTOCOL_VERSION: number } }).default;
  console.log("default.protocol=" + String(d.PROTOCOL_VERSION));
}
main();
