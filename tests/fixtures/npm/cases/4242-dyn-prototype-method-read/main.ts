// The READ half of the dyn prototype dispatch, gridded -- the positive
// case for what 4153's MECHANISM 3 priced and this change closes.
//
// `typeof o[k]` answered `undefined` for every prototype method on every
// dyn value, while `o[k](...)` beside it answered. Object.prototype's
// methods and every primitive prototype's live in this runtime as C
// branches inside scr_dyn_invoke.c, reachable from the CALL and from
// nowhere else, so the read had nothing to walk. Silent, no diagnostic,
// invisible to the trap census -- and exactly what makes a program
// feature-detecting with `if (o[k])` take the wrong branch. protobufjs
// writes both spellings, which is how it got noticed.
//
// THE CONTRACT this pins, and it is a two-sided one: the read answers a
// function for EXACTLY the names the dispatch implements or fences
// LOUDLY by name. The `*Nope` rows and `objPush`/`objTrim` are the other
// side -- a name the receiver's kind does NOT have still reads
// `undefined`, so a read that simply started answering everything would
// fail here rather than pass. `shadowType`/`shadowVal`/`ownUndef` say an
// OWN member still wins, `bareHop` that a null-prototype dictionary
// inherits nothing, and the six own-only rows at the end that
// Object.keys / `in` / JSON / Object.assign did not move.
//
// `strSplit` is the loud half: String.prototype HAS split, this runtime
// fences it (the regex family), and Node says `function`. Reading
// `undefined` there was a lie about the MEMBER where the truth is a
// missing IMPLEMENTATION -- 4152's story, from the read side.
import { objHopElem, objHopDot, objVofElem, objHopCall, objVofCall, objNope, objPush, objTrim, shadowType, shadowVal, ownUndef, bareHop, bareOwn, arrPush, arrJoin, arrHop, arrNope, arrLen, arrPushCall, strTrimElem, strTrimDot, strSplit, strNope, strTrimCall, numTs, numToFixed, numNope, numTsCall, detect, detectNope, keys, inOwn, inProto, inProtoVar, inProtoArr, hasOwnStatic, json, spread } from "protoread"
console.log("objHopElem   = " + objHopElem())
console.log("objHopDot    = " + objHopDot())
console.log("objVofElem   = " + objVofElem())
console.log("objHopCall   = " + objHopCall())
console.log("objVofCall   = " + objVofCall())
console.log("objNope      = " + objNope())
console.log("objPush      = " + objPush())
console.log("objTrim      = " + objTrim())
console.log("shadowType   = " + shadowType())
console.log("shadowVal    = " + shadowVal())
console.log("ownUndef     = " + ownUndef())
console.log("bareHop      = " + bareHop())
console.log("bareOwn      = " + bareOwn())
console.log("arrPush      = " + arrPush())
console.log("arrJoin      = " + arrJoin())
console.log("arrHop       = " + arrHop())
console.log("arrNope      = " + arrNope())
console.log("arrLen       = " + arrLen())
console.log("arrPushCall  = " + arrPushCall())
console.log("strTrimElem  = " + strTrimElem())
console.log("strTrimDot   = " + strTrimDot())
console.log("strSplit     = " + strSplit())
console.log("strNope      = " + strNope())
console.log("strTrimCall  = " + strTrimCall())
console.log("numTs        = " + numTs())
console.log("numToFixed   = " + numToFixed())
console.log("numNope      = " + numNope())
console.log("numTsCall    = " + numTsCall())
console.log("detect       = " + detect())
console.log("detectNope   = " + detectNope())
console.log("keys         = " + keys())
console.log("inOwn        = " + inOwn())
console.log("inProto      = " + inProto())
console.log("inProtoVar   = " + inProtoVar())
console.log("inProtoArr   = " + inProtoArr())
console.log("hasOwnStatic = " + hasOwnStatic())
console.log("json         = " + json())
console.log("spread       = " + spread())
