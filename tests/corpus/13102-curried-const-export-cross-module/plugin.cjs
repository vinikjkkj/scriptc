'use strict';
const p = (o) => (d) => d.connection + (o.x || 0);
module.exports = p;
