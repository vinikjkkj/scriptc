// Accessor edges the compiler rejects (tsc-clean, outside the subset).

// object-literal accessors carry dynamic `this` semantics records don't model
const obj = {
  _x: 1,
  get x(): number {
    return this._x;
  },
  set x(v: number) {
    this._x = v;
  },
};
console.log(obj._x);

// static members don't poison the class — their USES fence (the class
// name has no value form)
class Config {
  static get version(): number {
    return 1;
  }
}
console.log(Config.version);

// auto-accessor fields desugar to a private slot plus a get/set pair
class Auto {
  accessor a: number = 1;
}

// a getter/setter pair may have DIFFERENT types on its two halves (tsc 5.1+
// admits unrelated annotated ones) — there is no shared slot: reads call the
// getter at its return type, writes call the setter at its parameter type.
// The one spelling that needs both at once is compound assignment, and that
// is where the remaining fence is.
class Mixed {
  private held = 0;
  get m(): number {
    return this.held;
  }
  set m(v: number | string) {
    this.held = typeof v === "string" ? v.length : v;
  }
}
const mixed = new Mixed();
mixed.m = "abc";
console.log(mixed.m);
const mixed2 = new Mixed();
mixed2.m += 1;

// accessor overrides keep the exact type — property covariance through a
// vtable slot would be unsound, same rule as methods
class Animal {
  tag: string = "animal";
}
class Dog extends Animal {
  breed: string = "lab";
}
class Kennel {
  _a: Animal = new Animal();
  get pet(): Animal {
    return this._a;
  }
}
class DogKennel extends Kennel {
  get pet(): Dog {
    return new Dog();
  }
}

// reading a property that has only a setter: tsc types it, Node yields
// undefined — unrepresentable in these property types
class Sink {
  set w(v: number) {
    console.log(v);
  }
}
const sink = new Sink();
console.log(sink.w);

// overriding only the SETTER of an inherited pair: JS shadows the getter,
// so reads through a base-typed reference would yield undefined
class Cell {
  _v: number = 0;
  get v(): number {
    return this._v;
  }
  set v(x: number) {
    this._v = x;
  }
}
class WriteOnlyCell extends Cell {
  set v(x: number) {
    this._v = x * 2;
  }
}

// compound assignment through super accessors (read and write separately)
class Base2 {
  _s: number = 1;
  get scale(): number {
    return this._s;
  }
  set scale(v: number) {
    this._s = v;
  }
}
class Derived2 extends Base2 {
  bump(): void {
    super.scale += 1;
  }
}

// computed accessor names
class Computed {
  get ["q"](): number {
    return 1;
  }
}

// bound method references through super (property syntax reaches the
// accessor read path; methods have no bound-value form)
class R {
  m(): number {
    return 1;
  }
}
class S extends R {
  probe(): number {
    const f = super.m;
    return f();
  }
}

// Reached: unreached bodies never lower, so their rejections only exist
// when something on the entry path uses them.
new Derived2().bump();
new S().probe();

// Reached: collection defers its diagnostics until a reference makes
// them relevant; these references are what makes them count.
new Config();
new Auto();
new DogKennel();
new WriteOnlyCell();
new Computed();
