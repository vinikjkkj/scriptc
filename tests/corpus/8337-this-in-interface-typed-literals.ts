interface Greeter { name: string; greet(): string }
const g: Greeter = { name: "ann", greet() { return "hi " + this.name; } };
console.log(g.greet());
function make(): Greeter { return { name: "bob", greet() { return "yo " + this.name; } }; }
console.log(make().greet());
