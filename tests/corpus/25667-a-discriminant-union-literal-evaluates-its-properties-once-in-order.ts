// The properties of a literal whose arm is picked at run time are evaluated exactly once and in source order, whichever arm is built; a shorthand value and a computed one mix.
type Msg = { tag: "ping"; n: number } | { tag: "pong"; n: number | null } | { tag: "ack"; n: number | undefined };
const log: string[] = [];
function tagOf(i: number): Msg["tag"] { log.push("tag" + i); return i % 3 === 0 ? "ping" : i % 3 === 1 ? "pong" : "ack"; }
function num(i: number): number { log.push("num" + i); return i * 10; }
function build(i: number): Msg { return { tag: tagOf(i), n: num(i) } as Msg; }
function buildShort(tag: Msg["tag"], n: number): Msg { return { tag, n }; }
const out: string[] = [];
for (let i = 0; i < 6; i++) { const m = build(i); out.push(m.tag + ":" + m.n); }
console.log(out.join(" "));
console.log(log.join(","));
console.log(JSON.stringify([buildShort("ping", 1), buildShort("ack", 3), buildShort("pong", 2)]));
