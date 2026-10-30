// A static method read as a value is named by its key, and a class
// expression takes its binding's name.
class C {
  static sm(): number { return 3; }
  static sfld = function (): number { return 1; };
}
class K {}
const KE = class {};
const KN = class Named {};
const sm: any = C.sm;
console.log(sm.name, sm);
console.log(C.sfld.name);
console.log(K.name, KE.name, KN.name);
