// pkgstatus lane-A driver, @zapo-js/media-utils.
import { createMediaProcessor } from '@zapo-js/media-utils'

const p = createMediaProcessor()
console.log('processor=' + typeof p)
console.log('generateImageThumbnail=' + typeof p.generateImageThumbnail)
