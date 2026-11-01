// `string | Function` holding a string: .toString(), String(), templates and
// concatenation answer the string itself.
class Holder {
  code: string;
  constructor(code: string | Function) {
    this.code = code.toString();
  }
}
let slot: string | Function = "first";
console.log(slot.toString());
console.log(String(slot), `${slot}`, "" + slot);
slot = "second";
console.log(slot.toString().length);
console.log(new Holder("plain text").code);
console.log(new Holder("").code === "");
