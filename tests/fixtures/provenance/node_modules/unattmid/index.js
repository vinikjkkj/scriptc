// The implementation half, published as authored (no build step, so this
// IS the attested source). It requires a SECOND package, and that second
// package publishes no attestation -- which is the only way the
// SCRIPTC_PROVENANCE_UNATTESTED arm is reached in the real population.
'use strict'

const leaf = require('unattleaf')

const WIRE_LIMIT = leaf.WIRE_LIMIT
const TAG = leaf.TAG

module.exports = { WIRE_LIMIT, TAG }
