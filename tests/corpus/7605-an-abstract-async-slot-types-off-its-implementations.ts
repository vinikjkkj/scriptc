// An ABSTRACT async declaration has no function of its own, so the slot's
// signature has to come from a descendant's vtable entry — which for an
// async implementation is its synthesized thunk, not its body. An override
// that also WIDENS the slot (a trailing optional parameter the slot does
// not carry) makes the entry do both jobs in one.
abstract class Task {
  abstract run(n: number): Promise<string>;
  async twice(n: number): Promise<string> {
    const a = await this.run(n);
    const b = await this.run(n + 1);
    return a + '|' + b;
  }
}
class Adder extends Task {
  override async run(n: number): Promise<string> {
    return 'add' + String(n + 1);
  }
}
class Waiter extends Task {
  override async run(n: number): Promise<string> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1);
    });
    return 'wait' + String(n);
  }
}
class Tagging extends Task {
  // One MORE parameter than the slot carries: the entry must fill the
  // omitted argument AND spawn the fiber.
  override async run(n: number, tag?: string): Promise<string> {
    return 'tag' + String(n) + ':' + (tag ?? '<none>');
  }
}
async function main(): Promise<void> {
  const ts: Task[] = [new Adder(), new Waiter(), new Tagging()];
  for (const t of ts) console.log(await t.run(1));
  for (const t of ts) console.log(await t.twice(10));
  // The direct call at the leaf keeps the wider signature.
  const t = new Tagging();
  console.log('direct:', await t.run(3, 'tagged'));
}
void main();
