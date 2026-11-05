// Statics tsc places after a class (`C.k = v`) when the class has a base and subclasses of its own: each class object owns its
// properties and a read walks the constructor chain, own first.
import { probe } from "twinrec/staticbag";
console.log(probe());
