// A class merged with an interface of the same name (declaration merging).
// Statics are written through the class name, read back through the name
// and through a const alias of it. The merged interface is type-only here.
// Node prints the values below.
class Registry {
  static size = 0;
  static label: string;
  static options: { retries: number } = { retries: 1 };
  name: string;
  constructor(name: string) {
    this.name = name;
    Registry.size += 1;
  }
  describe(): string {
    return `${this.name}:${Registry.label}:${Registry.size}`;
  }
}

interface Registry {
  readonly kind: string;
}

Registry.label = "main";
Registry.options.retries = 3;
const Alias = Registry;
Alias.size = 10;

const a = new Registry("a");
const b = new Registry("b");

console.log(Registry.size, Alias.size, Registry.label, Registry.options.retries);
console.log(a.describe(), b.describe());
