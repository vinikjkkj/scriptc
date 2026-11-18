// zapo's `{ jid: inputJid, phoneJid: phoneJid ?? inputJid, lidJid, ...this.outcome(...) }`: `inputJid` is a union-typed const narrowed by an early `continue`, so the earlier fields read it through a
// tag-checked narrowing. The call runs once, after those fields are evaluated, and its keys follow the earlier ones.
type St = "in" | "out" | "error" | "unanswered";
interface Err { code?: string; text?: string }
interface Entry { readonly jid: string; readonly lidJid: string | null; readonly phoneJid: string | null; readonly status: St; readonly error?: Err }
class Api {
  calls = 0;
  private recover(s: string): string | null { return s === "" ? null : s + "!"; }
  private outcome(jid: string, lidJid: string | null, lidError: Err | undefined): Pick<Entry, "status" | "error"> {
    this.calls += 1;
    if (lidJid !== null) return lidError ? { status: "in", error: lidError } : { status: "in" };
    return lidError ? { status: "error", error: lidError } : { status: "unanswered" };
  }
  parse(inputs: string[], pn: (string | null)[]): Entry[] {
    const parsed: Entry[] = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const pnJid = pn[i];
      const resolvedJid = inputs[i] === "z" ? null : inputs[i];
      const phoneJid = pnJid ?? resolvedJid;
      const lidJid = i === 1 ? null : "l" + i;
      const lidError = i === 2 ? { code: "c" } : undefined;
      const inputJid = this.recover(inputs[i]);
      if (inputJid === null) continue;
      parsed.push({
        jid: inputJid,
        phoneJid: phoneJid ?? inputJid,
        lidJid,
        ...this.outcome(inputJid, lidJid, lidError)
      });
    }
    return parsed;
  }
}
const api = new Api();
for (const r of api.parse(["a", "b", "c", "", "z"], [null, "p", null, null, null])) console.log(JSON.stringify(r));
console.log(api.calls);
