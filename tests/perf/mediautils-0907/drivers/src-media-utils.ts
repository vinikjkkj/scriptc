// pkgstatus lane-F driver: the package SOURCE, taken from the zapo-js@1.8.2
// attested checkout (757a8071b819, refs/tags/v1.8.2), because this package
// publishes NO provenance attestation and therefore cannot be measured
// through its npm artifact at all. Copied to napp/pkgsrc/media-utils/ verbatim.
import { createMediaProcessor } from './media-utils/index'

const p = createMediaProcessor()
console.log('processor=' + typeof p)
console.log('generateImageThumbnail=' + typeof p.generateImageThumbnail)
