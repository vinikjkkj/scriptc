// prototype.constructor is the class; the prototype object is not an instance; instanceof follows the same chain.
class Animal { legs = 4; }
class Bird extends Animal { legs = 2; }
console.log(Animal.prototype.constructor === Animal, Bird.prototype.constructor === Bird, Bird.prototype.constructor === Animal);
console.log(typeof Animal.prototype, Animal.prototype instanceof Animal, Bird.prototype instanceof Animal);
const bird = new Bird();
console.log(bird instanceof Bird, bird instanceof Animal, Object.getPrototypeOf(bird).constructor === Bird);
console.log(Animal.prototype.isPrototypeOf(bird), Bird.prototype.isPrototypeOf(bird), Bird.prototype.isPrototypeOf(new Animal()));
console.log(bird.constructor === Bird, bird.constructor === Animal, Bird.prototype.constructor === bird.constructor);
