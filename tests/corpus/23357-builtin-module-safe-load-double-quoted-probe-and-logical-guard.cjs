const dc = (() => {
    try {
        return "getBuiltinModule" in process
            ? process.getBuiltinModule("node:diagnostics_channel")
            : require("node:diagnostics_channel");
    }
    catch {
        return undefined;
    }
})();
const hasTracingChannel = dc && typeof dc.tracingChannel === "function";
const ch = hasTracingChannel ? dc.tracingChannel("app:cmd") : undefined;
console.log(typeof dc, hasTracingChannel, ch !== undefined && ch.hasSubscribers);
function traced(fn) { if (!ch || ch.hasSubscribers === false) return fn(); return ch.tracePromise(fn, {}); }
traced(() => Promise.resolve(5)).then((v) => console.log("v", v));
