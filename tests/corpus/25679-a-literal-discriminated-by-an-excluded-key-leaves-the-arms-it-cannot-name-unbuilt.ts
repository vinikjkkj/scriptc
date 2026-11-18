// zapo's history-sync shape: `Item` has two arms the key type EXCLUDES ('conversations' carries the same two properties, 'conversations.messages' carries a third), so the literal
// `{ kind: key, value } as Item` names only the other arms. The arm is picked by the run-time value of `key`, `value` arrives as `unknown` and is validated as that arm's value type.
type Item =
  | { readonly kind: "pushnames"; readonly value: { id: string; name?: string } }
  | { readonly kind: "progress"; readonly value: number }
  | { readonly kind: "order"; readonly value: string[] }
  | { readonly kind: "conversations"; readonly value: { id: string } }
  | { readonly kind: "conversations.messages"; readonly conversationId: string; readonly value: { text: string } };
type SinkKey = Exclude<Item["kind"], "conversations" | "conversations.messages">;
const seen: string[] = [];
function show(it: Item): string {
  switch (it.kind) {
    case "pushnames": return "p:" + it.value.id + "/" + (it.value.name ?? "-");
    case "progress": return "g:" + (it.value + 1);
    case "order": return "o:" + it.value.join("+");
    case "conversations": return "c:" + it.value.id;
    default: return "m:" + it.conversationId + it.value.text;
  }
}
function sink(it: Item): Promise<void> | undefined {
  seen.push(show(it));
  return typeof (it as unknown as PromiseLike<void>).then === "function" ? Promise.resolve() : undefined;
}
function deliver(key: SinkKey, value: unknown): Promise<void> | undefined {
  return sink({ kind: key, value } as Item);
}
let evals = 0;
function nextKey(): SinkKey { evals += 1; return evals % 2 === 0 ? "progress" : "order"; }
function nextValue(k: SinkKey): unknown { evals += 10; return k === "progress" ? evals : ["x" + evals]; }
deliver("pushnames", { id: "u1", name: "Ann" });
deliver("pushnames", { id: "u2" });
deliver("progress", 41);
deliver("order", ["m", "n"]);
deliver("order", []);
const k = nextKey();
sink({ kind: k, value: nextValue(k) } as Item);
console.log(seen.join(" "));
console.log(JSON.stringify([{ kind: "progress", value: 1 } as Item, { kind: "conversations", value: { id: "z" } } as Item]), evals);
