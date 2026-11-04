// Fire-and-forget promise chains over async methods of JavaScript classes, ordered against awaits on the main path.
import { Holder } from "twinrec/ticks";
async function main(): Promise<void> {
  new Holder().run((s) => console.log(s));
  await null;
  console.log("1");
  await null;
  console.log("2");
  await null;
  console.log("3");
  await null;
  console.log("4");
  await null;
  console.log("5");
}
void main();
