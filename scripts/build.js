/**
 * build.js
 * Runs Style Dictionary to compile tokens/tokens.json into platform outputs
 * under build/ using style-dictionary.config.js.
 */

import sd from '../style-dictionary.config.js';

console.log('Building tokens with Style Dictionary…');

await sd.cleanAllPlatforms();
await sd.buildAllPlatforms();

console.log('Build complete. Outputs are in the build/ directory.');
