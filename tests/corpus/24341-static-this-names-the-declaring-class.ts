// The TypeScript spelling: declared static fields, a static accessor and a static method calling another through `this`.
class Registry {
  static names: string[] = [];
  static total = 0;
  static add(n: string): number {
    this.names.push(n);
    this.total += n.length;
    return this.names.length;
  }
  static describe(): string {
    return this.names.join("+") + ":" + this.total + ":" + this.size;
  }
  static get size(): number {
    return this.names.length;
  }
  static addAll(ns: string[]): number {
    let last = 0;
    for (const n of ns) last = this.add(n);
    return last;
  }
}
console.log(Registry.add("ab"), Registry.addAll(["c", "def"]), Registry.describe(), Registry.size);
