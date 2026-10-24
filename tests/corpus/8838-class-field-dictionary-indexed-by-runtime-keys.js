// A class field seeded with {} and indexed with run-time keys (this._nodes[id]) is a dictionary: mysql2's PoolCluster.
'use strict';
class Cluster {
  constructor(config) {
    config = config || {};
    this._defaultSelector = config.defaultSelector || 'RR';
    this._lastId = 0;
    this._nodes = {};
    this._serviceableNodeIds = [];
    this._findCaches = {};
  }
  add(id, cfg) {
    if (typeof id === 'object') { cfg = id; id = `CLUSTER::${++this._lastId}`; }
    if (typeof this._nodes[id] === 'undefined') {
      this._nodes[id] = { id, errorCount: 0, cfg, _offlineUntil: 0 };
      this._serviceableNodeIds.push(id);
      this._clearFindCaches();
    }
  }
  _getNode(id) { return this._nodes[id] || null; }
  find(pattern) {
    let found = this._findCaches[pattern];
    if (found === undefined) found = this._serviceableNodeIds.filter((id) => id.indexOf(pattern) === 0);
    this._findCaches[pattern] = found;
    return found.filter((nodeId) => !this._getNode(nodeId)._offlineUntil);
  }
  remove(node) {
    const index = this._serviceableNodeIds.indexOf(node.id);
    if (index !== -1) { this._serviceableNodeIds.splice(index, 1); delete this._nodes[node.id]; this._clearFindCaches(); }
  }
  ids() { const out = []; for (const id in this._nodes) out.push(id); return out; }
  _clearFindCaches() { this._findCaches = {}; }
}
const c = new Cluster();
c.add({ host: 'a' }); c.add('ns::1', { host: 'b' }); c.add('ns::2', { host: 'c' });
console.log(c.ids(), c.find('CLUSTER'), c.find('ns'), c._getNode('nope'), c._getNode('ns::1').cfg);
c.remove(c._getNode('ns::1'));
console.log(c.ids(), c.find('ns'), Object.keys(c._findCaches));
