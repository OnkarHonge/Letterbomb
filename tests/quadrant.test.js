import { describe, expect, it } from 'vitest';
import { areaName, missLine, zoneAt, zoneForKey, zoneName } from '../src/engine/quadrant.js';

describe('quadrant groups', () => {
  it('splits the alphabet into the four corners', () => {
    expect(zoneForKey('A')).toBe('nw');
    expect(zoneForKey('g')).toBe('nw');
    expect(zoneForKey('H')).toBe('ne');
    expect(zoneForKey('M')).toBe('ne');
    expect(zoneForKey('N')).toBe('sw');
    expect(zoneForKey('S')).toBe('sw');
    expect(zoneForKey('T')).toBe('se');
    expect(zoneForKey('W')).toBe('se');
    expect(zoneForKey('Z')).toBe('se');
    expect(zoneForKey('é')).toBe('nw');
    expect(zoneName('se')).toBe('T–Z');
  });

  it('splits the digits into the four corners', () => {
    expect(zoneForKey('0')).toBe('nw');
    expect(zoneForKey('2')).toBe('nw');
    expect(zoneForKey('3')).toBe('ne');
    expect(zoneForKey('4')).toBe('ne');
    expect(zoneForKey('5')).toBe('sw');
    expect(zoneForKey('6')).toBe('sw');
    expect(zoneForKey('7')).toBe('se');
    expect(zoneForKey('9')).toBe('se');
    expect(zoneForKey('')).toBeNull();
    expect(zoneForKey(null)).toBeNull();
    expect(areaName('nw', '1')).toBe('0–2');
    expect(areaName('se', 'W')).toBe('T–Z');
    expect(zoneName('ne')).toBe('H–M');
  });

  it('ignores the middle cross and points outside the box', () => {
    expect(zoneAt(10, 10, 100, 100)).toBe('nw');
    expect(zoneAt(90, 10, 100, 100)).toBe('ne');
    expect(zoneAt(10, 90, 100, 100)).toBe('sw');
    expect(zoneAt(90, 90, 100, 100)).toBe('se');
    expect(zoneAt(41.9, 10, 100, 100)).toBe('nw');
    expect(zoneAt(42, 10, 100, 100)).toBeNull();
    expect(zoneAt(57.9, 10, 100, 100)).toBeNull();
    expect(zoneAt(70, 10, 100, 100)).toBe('ne');
    expect(zoneAt(10, 50, 100, 100)).toBeNull();
    expect(zoneAt(50, 50, 100, 100)).toBeNull();
    expect(zoneAt(-1, 10, 100, 100)).toBeNull();
    expect(zoneAt(10, 110, 100, 100)).toBeNull();
    expect(zoneAt(10, 10, 0, 100)).toBeNull();
  });

  it('names a wrong corner and keeps a wrong key', () => {
    expect(missLine('wrong', 'T–Z', 'A')).toBe('That area was T–Z. This letter is A.');
    expect(missLine('wrong', '0–2', '4')).toBe('That area was 0–2. This letter is 4.');
    expect(missLine('wrong', 'B', 'T')).toBe('That key was B. This letter is T.');
    expect(missLine('timeout', null, 'A')).toBe('Time ran out. This letter is A.');
  });
});
