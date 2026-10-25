// Promise.all over promises of one type: the rejection that comes first in time
// rejects the combined promise, with its own reason, whatever the array order.
const later = new Promise<string>((resolve) => {
  setTimeout(() => resolve("later"), 40);
});
const early = new Promise<string>((_resolve, reject) => {
  setTimeout(() => reject("early failure"), 10);
});
const never = new Promise<string>((_resolve, reject) => {
  setTimeout(() => reject("very late failure"), 80);
});

async function main(): Promise<void> {
  try {
    await Promise.all([later, early, never]);
    console.log("all fulfilled");
  } catch (e) {
    console.log("all rejected", e);
  }
  const ok = await Promise.all([Promise.resolve(1), Promise.resolve(2)]);
  console.log("values", ok[0], ok[1], ok.length);
  console.log("main done");
}

main();
