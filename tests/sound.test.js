import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSound } from '../src/audio/sound.js';

function installAudio() {
  const played = [];
  class Param {
    constructor() {
      this.value = null;
      this.ramp = null;
    }
    setValueAtTime(value) {
      this.value = value;
    }
    exponentialRampToValueAtTime(value) {
      this.ramp = value;
    }
  }
  class Osc {
    constructor() {
      this.type = 'sine';
      this.frequency = new Param();
    }
    connect() {}
    start() {
      played.push({
        type: this.type,
        frequency: this.frequency.value,
        ramp: this.frequency.ramp,
      });
    }
    stop() {}
  }
  class Gain {
    constructor() {
      this.gain = new Param();
    }
    connect() {}
  }
  vi.stubGlobal('window', {
    AudioContext: class {
      currentTime = 0;
      state = 'running';
      destination = {};
      createOscillator() {
        return new Osc();
      }
      createGain() {
        return new Gain();
      }
      resume() {}
    },
  });
  return played;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sound', () => {
  it('roots the sentence chord on the hit-chime pitch for that ascent', () => {
    const played = installAudio();
    const sound = createSound();
    sound.milestone(1);
    sound.milestone(16);
    sound.milestone(20);
    const semitone = 2 ** (1 / 12);
    const top = 496 * semitone ** 15;
    const roots = [496, top, top];
    const third = 659.25 / 523.25;
    const fifth = 783.99 / 523.25;
    expect(played).toHaveLength(9);
    roots.forEach((root, chord) => {
      const notes = played.slice(chord * 3, chord * 3 + 3);
      expect(notes[0].frequency).toBeCloseTo(root, 5);
      expect(notes[1].frequency / notes[0].frequency).toBeCloseTo(third, 10);
      expect(notes[2].frequency / notes[0].frequency).toBeCloseTo(fifth, 10);
      expect(notes.every((note) => note.type === 'triangle' && note.ramp === null)).toBe(true);
    });
  });

  it('raises each hit by a semitone and only flicks inside the note', () => {
    const played = installAudio();
    const sound = createSound();
    sound.hit(1);
    sound.hit(2);
    sound.hit(16);
    sound.hit(20);
    const semitone = 2 ** (1 / 12);
    expect(played[0].frequency).toBeCloseTo(496, 5);
    expect(played[1].frequency).toBeCloseTo(496 * semitone, 5);
    expect(played[2].frequency).toBeCloseTo(496 * semitone ** 15, 5);
    expect(played[3].frequency).toBeCloseTo(played[2].frequency, 5);
    expect(played[0].ramp / played[0].frequency).toBeCloseTo(semitone ** (1 / 3), 5);
    expect(played[0].ramp).toBeLessThan(played[1].frequency);
    expect(played.every((note) => note.type === 'sine')).toBe(true);
  });

  it('keeps the miss tone', () => {
    const played = installAudio();
    const sound = createSound();
    sound.miss();
    expect(played).toEqual([
      { type: 'triangle', frequency: 180, ramp: 70 },
    ]);
  });
});
