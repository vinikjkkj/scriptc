// A script command reached through an assertion over unknown (zapo's pre-key store): it answers a promise of buffers, the program pairs them into a record keyed
// by each key buffer's text.
import { Redis } from "expclass";
async function main(): Promise<void> {
  const r = new Redis({ host: "h" });
  const raw = await (
    r as unknown as {
      evalBuffer: (...args: unknown[]) => Promise<Buffer[] | null>;
    }
  ).evalBuffer("LUA", 2, "h1", "i2", "x");
  if (!raw || raw.length === 0) return;
  const data: Record<string, Buffer> = {};
  for (let i = 0; i < raw.length; i += 2) {
    data[raw[i].toString()] = raw[i + 1];
  }
  console.log(Object.keys(data).join(","), data["field:i2"].toString(), r.calls);
}
main();
