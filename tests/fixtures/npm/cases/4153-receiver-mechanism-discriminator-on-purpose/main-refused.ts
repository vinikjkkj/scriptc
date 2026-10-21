// m1CallElem: the element spelling over a typed record whose member is a
// function has no static lowering: refused at BUILD time (npm-static.test.ts,
// 4153 refused row).
import { m1CallElem } from "recvmech-refused"
console.log("m1CallElem          = " + m1CallElem())
