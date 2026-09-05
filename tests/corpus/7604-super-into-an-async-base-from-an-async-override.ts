// `super.m()` from an async override into an async base stays a DIRECT
// call at the base's own function, while the outer call is virtual — a
// three-level chain exercises both at once.
class Base {
  async greet(): Promise<string> {
    return 'base';
  }
}
class Child extends Base {
  override async greet(): Promise<string> {
    const inherited = await super.greet();
    return inherited + '+child';
  }
}
class GrandChild extends Child {
  override async greet(): Promise<string> {
    const inherited = await super.greet();
    return inherited + '+grand';
  }
}
async function main(): Promise<void> {
  const objs: Base[] = [new Base(), new Child(), new GrandChild()];
  for (const o of objs) console.log(await o.greet());
  // The MIDDLE level typed exactly, and the leaf typed exactly: both
  // devirtualize, and both must answer what the virtual path answered.
  const mid: Child = new Child();
  console.log('at Child:', await mid.greet());
  const leaf = new GrandChild();
  console.log('exact:', await leaf.greet());
}
void main();
