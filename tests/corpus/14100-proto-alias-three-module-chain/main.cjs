'use strict';
// C: extends B. The alias reads B.prototype.y, which B inherits from A two modules away.
const B = require('./b.cjs');
class C extends B {}
module.exports = C;
C.prototype.x = B.prototype.y;
const c = new C({ n: 4 });
console.log(c.x(), c.x("cb"), c.tag, c instanceof B);
console.log(new C({ n: 9, closed: true }).x());
