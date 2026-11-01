// A user subclass value viewed through a refinement that adds one member, written before it is read.
class Coded extends Error {
  code: string;
  constructor(msg: string) {
    super(msg);
    this.name = 'Coded';
    this.code = 'E_MINE';
  }
}
const x = new Coded('boom') as Coded & { extra: number };
x.extra = 7;
console.log(x.message, x.code, x.extra, x.name);
const viaBase: Error & { extra: number } = x;
console.log(viaBase.message);
