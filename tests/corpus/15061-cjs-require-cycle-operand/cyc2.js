console.log('cyc2 init')
exports.back = 'back-from-2'
exports.fromOne = (function () { return require('./cyc1').name || 'none' })()
