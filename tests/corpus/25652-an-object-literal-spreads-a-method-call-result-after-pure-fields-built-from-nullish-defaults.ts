// `{ jid, phoneJid: p ?? jid, lidJid, ...this.outcome(...) }`: the call result is evaluated once, its keys follow the earlier ones, and an optional key is absent when the call omits it.
interface Row { jid: string; phoneJid: string; lidJid: string | null; status: string; error?: string }
class Api {
  calls = 0;
  private outcome(ok: boolean, jid: string): { status: string; error?: string } {
    this.calls += 1;
    return ok ? { status: "ok" } : { status: "failed", error: "bad " + jid };
  }
  parse(inputs: string[]): Row[] {
    const parsed: Row[] = [];
    for (let c = 0; c < inputs.length; c += 1) {
      const inputJid = inputs[c];
      const phoneJid: string | null = c % 2 === 0 ? null : "p" + c;
      const lidJid: string | null = c === 2 ? null : "l" + c;
      parsed.push({
        jid: inputJid,
        phoneJid: phoneJid ?? inputJid,
        lidJid,
        ...this.outcome(c !== 1, inputJid)
      });
    }
    return parsed;
  }
}
const api = new Api();
for (const r of api.parse(["a", "b", "c"])) console.log(JSON.stringify(r), r.error === undefined);
console.log("calls", api.calls);
