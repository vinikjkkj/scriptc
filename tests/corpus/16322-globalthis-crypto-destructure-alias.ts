// A destructured `crypto` from globalThis (the cast a library writes to
// reach the WebCrypto singleton without the lib.dom declaration). The binding
// is the global itself: every use answers as the global would. The first
// element binds the same global under another name.
const { crypto: wc } = globalThis as { crypto?: { getRandomValues?: (space: Uint8Array) => Uint8Array } };
const { crypto } = globalThis as { crypto?: { getRandomValues?: (space: Uint8Array) => Uint8Array } };
console.log(wc != null, crypto != null, typeof crypto!.getRandomValues!);
const u = new Uint8Array(3);
console.log(crypto!.getRandomValues!(u) === u, (wc as any).getRandomValues(u) === u);
export {};
