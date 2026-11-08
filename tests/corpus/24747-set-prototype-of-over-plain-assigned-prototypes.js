// Every assignment to a `.prototype` in this program is a plain object, so setPrototypeOf over one is shown safe.
function Animal() {}
Animal.prototype = { speak() { return "..."; } };
function Dog() {}
Dog.prototype = Object.create(Animal.prototype);
Dog.prototype.constructor = Dog;
function Puppy() {}
Puppy.prototype = Dog.prototype;
const Loud = function () {};
Loud.prototype = new Animal();
Object.setPrototypeOf(Loud.prototype, { speak() { return "LOUD"; } });
console.log(new Dog().speak(), new Loud().speak(), new Puppy() instanceof Animal);
Object.setPrototypeOf(Dog.prototype, { speak() { return "woof"; } });
console.log(new Dog().speak(), new Dog() instanceof Animal, new Dog() instanceof Dog);
