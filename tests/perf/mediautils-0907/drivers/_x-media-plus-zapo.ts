// A/B arm: the same media-utils driver PLUS the `zapo-js` import every real
// consumer writes. On the store lane this one added import moved store-sqlite
// from 7 blocker sites to 0, because tsconfig "paths" is one table per program
// and zapo-js@1.8.2's answer wins the 41-key alias collision.
// Question here: does naming zapo-js change media-utils' ISLAND status?
import { WaClient } from 'zapo-js'
import { createMediaProcessor } from '@zapo-js/media-utils'

const p = createMediaProcessor()
console.log('processor=' + typeof p)
console.log('generateImageThumbnail=' + typeof p.generateImageThumbnail)
console.log('WaClient=' + typeof WaClient)
