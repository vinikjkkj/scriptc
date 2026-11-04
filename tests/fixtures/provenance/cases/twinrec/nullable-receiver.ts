// A class instance reached through a field that is `Class | undefined` at the call: the call runs when the field was
// created and throws Node's TypeError when it was not.
import { Cluster } from "twinrec/nullable";
async function main(): Promise<void> {
  const on = new Cluster({ sharded: true });
  console.log(await on.go(), on.halt());
  const off = new Cluster({});
  console.log(await off.go(), off.halt());
  try {
    off.breakIt();
  } catch (e) {
    console.log((e as Error).constructor.name, (e as Error).message);
  }
}
void main();
