// The prelude's web classes print like Node's: URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal, EventTarget, Blob and File show their public state, not their internals, also when nested.
const run: any = new Function(`
  console.log(new URLSearchParams(), new URLSearchParams("a=1&b=2&a=3"), new URLSearchParams({ x: "1" }));
  console.log(new TextEncoder(), new TextDecoder("utf-8", { fatal: true }), new AbortController(), new EventTarget());
  const ac = new AbortController(); ac.abort(); console.log(ac.signal, ac, AbortSignal.abort());
  console.log(new Blob(["abc"], { type: "text/plain" }), new File(["a"], "f.txt", { lastModified: 5 }));
  console.log({ nested: new Map([["k", new URLSearchParams("a=1")]]), deep: { a: { b: new URL("http://d.org/p?x=1") } } });
`);
run();
