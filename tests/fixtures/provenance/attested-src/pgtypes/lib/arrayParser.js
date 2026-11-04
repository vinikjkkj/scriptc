// An OBJECT with a `create` member, as pg-types' lib/arrayParser.js exports.
module.exports = {
  create: function (source, transform) {
    return {
      parse: function () {
        var body = source.slice(1, -1);
        if (body === "") return [];
        return body.split(",").map(function (entry) {
          return transform ? transform(entry) : entry;
        });
      },
    };
  },
};
