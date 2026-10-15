// `Sub.<m> = Base.<m>` where `<m>` is a static METHOD `Sub` ALREADY
// answers with -- mysql2's `PoolConnection.statementKey =
// Connection.statementKey`. findStaticOn walks the base chain, so every
// compiled read of `Sub.statementKey` already calls Base's lowered body,
// before this statement and after it. The assignment stores the value
// that is already there, and its honest lowering is nothing at all.
//
// A PAIR on purpose. The refused half is everything that is NOT an
// identical rebind: a DIFFERENT method under the name (the receiver would
// have to answer with something new), and a static FIELD (where JS's
// own-property creation is a real storage split -- the fence there is
// right, and it is a different, pointed message).
'use strict';
const Base = require('./base.cjs');

class Sub extends Base {
  constructor() { super(); this.m = 1; }
}

// --- ADMITTED: the identical rebind. ---
Sub.statementKey = Base.statementKey;

// --- REFUSED, both halves of the point. ---
Sub.statementKey = Base.other; //         a DIFFERENT method under the name
Sub.tag = Base.tag; //                    a static FIELD: real storage split

module.exports = Sub;
