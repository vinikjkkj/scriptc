// buffer.constants.MAX_LENGTH / MAX_STRING_LENGTH are Node's own numbers (v8 string and typed-array limits); ioredis compares a
// reply length against the string limit.
const buffer = require("buffer");
const { constants } = require("node:buffer");
console.log(buffer.constants.MAX_LENGTH, buffer.constants.MAX_STRING_LENGTH);
console.log(constants.MAX_STRING_LENGTH === buffer.constants.MAX_STRING_LENGTH, typeof constants.MAX_LENGTH);
const data = { length: 10 };
console.log(data.length + 5 >= buffer.constants.MAX_STRING_LENGTH, data.length + 536870888 >= buffer.constants.MAX_STRING_LENGTH);
