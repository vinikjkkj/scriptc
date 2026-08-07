/* A THIRD generated module, and the one shape the other two cannot carry:
 * a CommonJS twin whose whole export is an IDENTIFIER.
 *
 * spec/proto and spec/version both hand their declarations something a
 * NAME can reach — an ESM named export, which registers its own storage.
 * A generator that emits `pbjs --target static-module --wrap commonjs`
 * (zapo's spec/proto: 1.8 MB, one line) emits neither. It builds one root
 * object at runtime and ends the file with `module.exports = <root>`, so
 * the export the declaration calls `wire` is the PROPERTY `root.wire` and
 * there is no binding of that name anywhere in the twin.
 *
 * Its own package.json is what makes this half CommonJS inside an ESM
 * package — zapo's `spec/proto/package.json` (private, no "type") does
 * exactly this. */
export declare namespace wire {
	class Frame {
		constructor(p?: wire.Frame.$Properties)
		n?: (number|null)
		tag?: (string|null)
		static encode(m: wire.Frame.$Properties): string
	}
	namespace Frame {
		interface $Properties {
			n?: (number|null)
			tag?: (string|null)
		}
	}
}

export declare const WIRE_TAG: string
