exports.name = 'cyc1'
exports.later = function () { return require('./cyc2').back }
console.log('cyc1 init')
