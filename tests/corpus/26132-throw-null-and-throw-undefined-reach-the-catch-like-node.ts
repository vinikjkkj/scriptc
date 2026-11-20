function nope(): never {
  throw null;
}
async function later(): Promise<void> {
  throw undefined;
}
try {
  throw null;
} catch (e) {
  console.log("caught", e, e === null, typeof e);
}
try {
  nope();
} catch (e: any) {
  console.log(String(e), `${e}`, "" + e, e ?? "dflt", e == null);
}
try {
  throw undefined;
} catch (e: any) {
  console.log(String(e), `${e}`, e === undefined, e ?? "dflt");
}
try {
  try {
    throw null;
  } catch (inner) {
    throw inner;
  }
} catch (outer) {
  console.log("rethrown", outer);
}
later().catch((r) => console.log("rejected", r, r === undefined));
