// Arrow functions and callbacks inside members read captured bindings and `this`.
function build(items: string[], sep: string) {
  return class Joiner {
    parts: string[] = [];
    add(x: string): this {
      this.parts.push(x);
      return this;
    }
    render(): string {
      return this.parts.concat(items).map((p) => p + sep).join("");
    }
    deferred(): () => number {
      return () => this.parts.length + items.length;
    }
  };
}
const J1 = build(["a", "b"], ",");
const J2 = build(["z"], ";");
const j1 = new J1().add("x");
const j2 = new J2().add("y").add("w");
console.log(j1.render(), j2.render(), j1.deferred()(), j2.deferred()());
