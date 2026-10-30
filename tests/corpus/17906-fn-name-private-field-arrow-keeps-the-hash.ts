// A private field's arrow is named with its private name, `#priv`.
class P {
  #priv = (): number => 12;
  getPriv(): any { return this.#priv; }
}
const p: any = new P().getPriv();
console.log(p.name);
console.log(p);
