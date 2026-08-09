/* A FOURTH generated module: the bundler spelling of the CJS whole export.
 *
 * spec/wire proves the bridge over a root the source spells `const` on a
 * line of its own. This one proves it over the root a MINIFIER leaves —
 * a merged `var` declarator list the module keeps as an init local, and
 * the export parked in a comma operand at the end of the last expression
 * statement. Neither the root nor the declared export has a binding of its
 * own anywhere in the twin, so the only thing left to read the exports off
 * is the module's own export OBJECT.
 *
 * Its own package.json is what makes this half CommonJS inside an ESM
 * package — zapo's `spec/proto/package.json` (private, no "type") does
 * exactly this. */
export declare namespace codec {
	class Tag {
		constructor(p?: codec.Tag.$Properties)
		id?: (number|null)
		name?: (string|null)
		static encode(m: codec.Tag.$Properties): string
	}
	namespace Tag {
		interface $Properties {
			id?: (number|null)
			name?: (string|null)
		}
	}
}

export declare const BUNDLE_TAG: string
