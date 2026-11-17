// A static member read through new.target answers the invoked class's own value: a subclass that redeclares it is seen, one that does not inherits.
class Base {
  static label = "base";
  static make(): string { return "made-by-base"; }
  label: string;
  made: string;
  constructor() {
    this.label = new.target.label;
    this.made = new.target.make();
  }
}
class Child extends Base { static label = "child"; static make(): string { return "made-by-child"; } }
class Plain extends Base {}
for (const o of [new Base(), new Child(), new Plain()]) console.log(o.label, o.made);
