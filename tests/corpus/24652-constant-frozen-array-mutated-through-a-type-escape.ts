// A CONSTANT freeze (`Object.freeze([...])`) leaves no mutable reference unless the program escapes the readonly type; this one does (`as number[]`),
// so the writes through the escaped reference must throw as in Node (ES module = strict).
const table: readonly number[] = Object.freeze([1, 2, 3]);
const words: readonly string[] = Object.freeze(["a", "b"]);
const t = (name: string, f: () => unknown): void => {
  try { const r = f(); console.log(name, "ok", r === undefined ? "-" : r); } catch (e) { console.log(name, (e as Error).constructor.name + ": " + (e as Error).message); }
};
const mut = table as number[];
const wmut = words as unknown as string[];
t("set", () => { mut[0] = 9; return mut.join(); });
t("push", () => mut.push(4));
t("pop", () => mut.pop());
t("length", () => { mut.length = 0; return mut.length; });
t("wpush", () => wmut.push("c"));
t("wset", () => { wmut[1] = "z"; return wmut.join(); });
const own: number[] = [5, 6];
own.push(7); own[0] = 1;
console.log(table.join(), words.join(), own.join(), Object.isFrozen(table), Object.isFrozen(own));
