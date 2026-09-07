/* NEGATIVE CONTROL for assemble.mjs's control-byte guard: a body carrying one
 * 0x08 must be REFUSED. If this prints "GUARD DID NOT FIRE", the guard is
 * decorative and the mangling trap is still open. */
const check = (body) => {
  const bytes = Buffer.from(body, "utf8");
  const bad = [];
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c < 0x09 || (c > 0x0d && c < 0x20)) bad.push(`0x${c.toString(16)}@${i}`);
  }
  if (bad.length > 0) throw new Error(`assemble: ${bad.length} control byte(s) in the body: ${bad.slice(0, 8).join(" ")}`);
  return "clean";
};
console.log("clean body  ->", check("<blocks>/pkgstatus is fine\nso is a tab\there\n"));
try {
  check("G:" + String.fromCharCode(8) + "locks\\pkgstatus");
  console.log("GUARD DID NOT FIRE  <-- BROKEN");
} catch (e) {
  console.log("mangled body ->", e.message);
}
