// ORDERING. A virtual async call runs its body eagerly up to the FIRST
// suspension and then returns to the caller; the rest resumes on a later
// loop turn. Two such calls started back to back therefore interleave in a
// fixed, observable order — an order a body running to completion inline
// would get wrong.
function tick(tag: string): Promise<string> {
  return new Promise<string>((resolve) => {
    setTimeout(() => resolve(tag), 0);
  });
}
class Base {
  async run(tag: string): Promise<string> {
    return 'base:' + tag;
  }
}
class A extends Base {
  override async run(tag: string): Promise<string> {
    console.log('A enter', tag);
    const v = await tick(tag);
    console.log('A resume', tag);
    return 'A:' + v;
  }
}
class B extends Base {
  override async run(tag: string): Promise<string> {
    console.log('B enter', tag);
    const v = await tick(tag);
    console.log('B resume', tag);
    return 'B:' + v;
  }
}
async function main(): Promise<void> {
  const a: Base = new A();
  const b: Base = new B();
  const pa = a.run('one');
  console.log('after starting A');
  const pb = b.run('two');
  console.log('after starting B');
  console.log(await pa);
  console.log(await pb);
  const objs: Base[] = [new A(), new B(), new Base()];
  const ps = objs.map((o) => o.run('z'));
  console.log('all started');
  for (const p of ps) console.log(await p);
}
void main();
