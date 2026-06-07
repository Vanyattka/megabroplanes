// Biome selection now lives in the unified TerrainShape module (a 2D climate
// map over elevation × temperature × moisture). This file is kept as a thin
// re-export so existing imports (`import { biomeAt } from './Biome.js'`) in
// Scatter / Minimap / Villages / Ruins keep working unchanged.
export { biomeAt } from './TerrainShape.js';
