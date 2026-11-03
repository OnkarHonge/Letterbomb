import { describe, expect, it } from 'vitest';
import { createEar } from '../src/voice/ear.js';

class FakeRecognition {
  static instances = [];

  constructor() {
    this.started = false;
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started = true;
  }

  abort() {
    this.started = false;
    this.onend?.();
  }
}

function utterance(transcript, isFinal, alternatives = []) {
  const row = [{ transcript }, ...alternatives.map((text) => ({ transcript: text }))];
  row.isFinal = isFinal;
  return { results: [row] };
}

function ear(handlers = {}) {
  FakeRecognition.instances = [];
  const states = [];
  const heard = [];
  const counts = { idles: 0, arms: 0 };
  const session = createEar({
    Recognition: FakeRecognition,
    onArm() {
      counts.arms += 1;
    },
    onUtterance(texts, interim) {
      const taken = handlers.onUtterance ? handlers.onUtterance(texts, interim) : false;
      if (taken) heard.push(texts);
      return taken;
    },
    onIdle() {
      counts.idles += 1;
    },
    onState(state) {
      states.push(state);
    },
  });
  return { session, states, heard, counts };
}

describe('microphone session', () => {
  it('restarts when a phrase ends and drops the phrase a new word replaces', () => {
    const taken = [];
    const { session, states } = ear({
      onUtterance(texts) {
        taken.push(texts[0]);
        return true;
      },
    });
    expect(session.start()).toBe(true);
    expect(states).toEqual(['listening']);
    const first = FakeRecognition.instances[0];
    const late = first.onresult;
    first.onend();
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(FakeRecognition.instances[1].started).toBe(true);

    session.bump();
    expect(FakeRecognition.instances).toHaveLength(3);
    late(utterance('bee', true));
    expect(taken).toEqual([]);
  });

  it('keeps one session across repeated starts and stops restarting after stop', () => {
    const { session } = ear();
    session.start();
    session.start();
    expect(FakeRecognition.instances).toHaveLength(1);
    const first = FakeRecognition.instances[0];
    const ended = first.onend;
    session.stop();
    ended();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(session.listening()).toBe(false);
    expect(session.active()).toBe(false);
  });

  it('accepts a letter name once, and waits for a final single character', () => {
    const letters = [];
    const { session } = ear({
      onUtterance(texts, interim) {
        const token = String(texts[0] || '');
        if (interim && token.length < 2) return false;
        if (token === 'b') {
          letters.push('B');
          return true;
        }
        if (token === 'bee' || token === 'bravo') {
          letters.push('B');
          return true;
        }
        return false;
      },
    });
    session.start();
    const first = FakeRecognition.instances[0];
    first.onresult(utterance('b', false));
    expect(letters).toEqual([]);
    first.onresult(utterance('bee', true));
    first.onresult(utterance('see', true));
    expect(letters).toEqual(['B']);
  });

  it('releases the bar when a final phrase is not a letter', () => {
    const { session, counts } = ear({ onUtterance: () => false });
    session.start();
    const first = FakeRecognition.instances[0];
    first.onresult(utterance('hello', false));
    expect(counts.idles).toBe(0);
    first.onresult(utterance('hello', true));
    expect(counts.idles).toBe(1);
    first.onspeechstart();
    expect(counts.arms).toBe(1);
    expect(session.listening()).toBe(true);
  });

  it('stops on a blocked mic and does not open another session', () => {
    const { session, states } = ear();
    session.start();
    const first = FakeRecognition.instances[0];
    first.onerror({ error: 'not-allowed' });
    first.onend();
    expect(states).toContain('blocked');
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it('reports a missing recognizer without throwing', () => {
    const states = [];
    const session = createEar({ onState: (state) => states.push(state) });
    expect(session.supported()).toBe(false);
    expect(session.start()).toBe(false);
    expect(states).toEqual(['missing']);
  });
});
