// Utility functions for location calculations

/**
 * Calculate room key from latitude and longitude
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {string} Room key
 */
export function getRoomKeyFromLocation(lat, lon) {
  const metersPerDegLat = 111000;
  const metersPerDegLon = 111000 * Math.cos((lat * Math.PI) / 180);
  const latMeters = lat * metersPerDegLat;
  const lonMeters = lon * metersPerDegLon;
  const cellSize = 100;
  const latKey = Math.floor(latMeters / cellSize);
  const lonKey = Math.floor(lonMeters / cellSize);
  return `${latKey}:${lonKey}`;
}

/**
 * Select preferred room key based on location
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {boolean} discussion - Is discussion room
 * @returns {string} Preferred room key
 */
export function selectPreferredRoomKey(lat, lon, discussion) {
  const baseKey = getRoomKeyFromLocation(lat, lon);
  
  let best = null;
  const [baseLatKey, baseLonKey] = baseKey.split(':').map(Number);
  
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const latKey = baseLatKey + dy;
      const lonKey = baseLonKey + dx;
      const k = `${latKey}:${lonKey}${discussion ? '|discussion' : ''}`;
      const set = rooms.get(k);
      if (!set || set.size === 0) continue;
      
      const hasActive = Array.from(set).some(c => c.ws.readyState === 1 && !c.spectate);
      if (!hasActive) continue;
      
      const center = {
        lat: (latKey + 0.5) * (100 / 111000),
        lon: (lonKey + 0.5) * (100 / (111000 * Math.cos((lat * Math.PI) / 180)))
      };
      const d = distanceMeters({ lat, lon }, center);
      
      if (d <= 100 && (!best || d < best.dist)) {
        best = { key: k, dist: d };
      }
    }
  }

  return best ? best.key : `${baseKey}${discussion ? '|discussion' : ''}`;
}

/**
 * Calculate distance in meters between two points
 * @param {{lat: number, lon: number}} a - Point A
 * @param {{lat: number, lon: number}} b - Point B
 * @returns {number} Distance in meters
 */
export function distanceMeters(a, b) {
  try {
    const metersPerDegLat = 111000;
    const midLat = (a.lat + b.lat) / 2;
    const metersPerDegLon = 111000 * Math.cos((midLat * Math.PI) / 180);
    const dLat = (a.lat - b.lat) * metersPerDegLat;
    const dLon = (a.lon - b.lon) * metersPerDegLon;
    return Math.sqrt(dLat * dLat + dLon * dLon);
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}
