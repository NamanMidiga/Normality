import { getRoomKeyFromLocation } from '../server/locationUtils.js';

describe('Location Utilities', () => {
  test('getRoomKeyFromLocation returns correct grid keys', () => {
    // Test known locations
    expect(getRoomKeyFromLocation(37.7749, -122.4194)).toBe('41930:-107408');
    expect(getRoomKeyFromLocation(0, 0)).toBe('0:0');
    expect(getRoomKeyFromLocation(90, 180)).toBe('9990:18000');
  });
});
