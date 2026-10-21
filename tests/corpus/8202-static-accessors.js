// Static getters and setters, the way PerMessageDeflate.extensionName and
// option-validating classes write them.
class Codec {
  static _level = 6;
  static _sets = 0;

  static get extensionName() {
    return 'permessage-deflate';
  }

  static get level() {
    return Codec._level;
  }

  static set level(v) {
    Codec._sets = Codec._sets + 1;
    Codec._level = v < 0 ? 0 : v;
  }

  static describe() {
    return Codec.extensionName + '@' + Codec.level;
  }
}

class Fast extends Codec {
  static get extensionName() {
    return 'fast';
  }
}

console.log(Codec.extensionName, Codec.level);
Codec.level = 9;
Codec.level = -3;
console.log(Codec.level, Codec._sets);
console.log(Fast.extensionName, Fast.level);
console.log(Codec.describe());

const table = { [Codec.extensionName]: 1 };
console.log(table['permessage-deflate'], Codec.extensionName.length);
