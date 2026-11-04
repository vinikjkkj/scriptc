"use strict";
// A destructured JSON require at the top of a CommonJS module (zapo-js spec/version).
const { waWeb, tag } = require("./version.json");
const WA_VERSION = waWeb;
module.exports = { WA_VERSION, channel: tag.channel };
