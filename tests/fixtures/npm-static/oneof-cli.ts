// npm-static pin: protobufjs static-module's ONEOF ACCESSOR idiom (see
// node_modules/oneofish/index.js). Not a differential — the package does not
// compile: the pin in npm-static.test.ts records WHICH four constructs refuse
// and in what order, because the `Object.defineProperty` fence a census
// counts is masking the prototype receiver underneath it.
import pb from "oneofish";

const m: any = pb.create({ username: 7 });
console.log("encode:", pb.encode(m));
