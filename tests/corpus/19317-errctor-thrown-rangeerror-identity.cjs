try { throw new RangeError("r"); } catch (e) { console.log("eq", e.constructor === RangeError, e.constructor.name); }
