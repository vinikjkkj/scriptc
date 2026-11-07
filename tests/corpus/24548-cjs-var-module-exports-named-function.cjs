// `var generate = module.exports = function generate(...) {...}` (cluster-key-slot, ioredis' slot hash): the named function
// binds first, then becomes the module's export, and a later `module.exports.member = fn` assignment is written beside it.
// The binding and the function's own name read back as Node's.
var lookup = [];
for (var i = 0; i < 256; i++) {
  var crc = i << 8;
  for (var j = 0; j < 8; j++) crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
  lookup.push(crc & 0xffff);
}

var generate = module.exports = function generate(str) {
  var result = 0;
  for (var k = 0; k < str.length; k++) {
    result = lookup[(str.charCodeAt(k) ^ (result >> 8)) & 0xff] ^ (result << 8);
  }
  return result & 0x3fff;
};

console.log(generate("foo"), generate("{user1000}.following"), generate(""));

module.exports.generateMulti = function generateMulti(keys) {
  var base = generate(keys[0]);
  for (var m = 1; m < keys.length; m++) if (generate(keys[m]) !== base) return -1;
  return base;
};
console.log(typeof generate, generate.name);
console.log("slot " + generate("bar") + "/" + generate.name.toUpperCase());
