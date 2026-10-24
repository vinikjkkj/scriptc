exports.hidden = (() => { console.log('side effect'); return 7; })();
exports.other = 'x';
module.exports = { value: 'table' };
