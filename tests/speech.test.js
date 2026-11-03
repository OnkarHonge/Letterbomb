import { describe, expect, it } from 'vitest';
import { chooseSpokenLetter, letterFromSpeech } from '../src/engine/speech.js';

describe('spoken letters', () => {
  it('maps a letter name, a radio word, and a digit', () => {
    expect(letterFromSpeech('bee')).toBe('B');
    expect(letterFromSpeech('Bravo')).toBe('B');
    expect(letterFromSpeech('zed')).toBe('Z');
    expect(letterFromSpeech('zee')).toBe('Z');
    expect(letterFromSpeech('double-u')).toBe('W');
    expect(letterFromSpeech('x-ray')).toBe('X');
    expect(letterFromSpeech('two')).toBe('2');
    expect(letterFromSpeech('8')).toBe('8');
  });

  it('strips filler and a leading "letter"', () => {
    expect(letterFromSpeech('um, the letter bee!')).toBe('B');
    expect(letterFromSpeech('letter a')).toBe('A');
  });

  it('refuses a word, a sentence, and the common number traps', () => {
    expect(letterFromSpeech('hello')).toBeNull();
    expect(letterFromSpeech('the cat')).toBeNull();
    expect(letterFromSpeech('to')).toBeNull();
    expect(letterFromSpeech('too')).toBeNull();
    expect(letterFromSpeech('for')).toBeNull();
    expect(letterFromSpeech('')).toBeNull();
  });

  it('waits to call a single character final', () => {
    expect(letterFromSpeech('b', { interim: true })).toBeNull();
    expect(letterFromSpeech('b', { interim: false })).toBe('B');
    expect(letterFromSpeech('bee', { interim: true })).toBe('B');
  });

  it('uses oh for O, and for 0 only when the word wants the digit', () => {
    expect(letterFromSpeech('oh')).toBe('O');
    expect(letterFromSpeech('oh', { expected: '0' })).toBe('0');
    expect(letterFromSpeech('zero', { expected: 'O' })).toBe('0');
  });

  it('picks the expected letter when one guess is right', () => {
    expect(chooseSpokenLetter(['hello', 'whiskey'], { expected: 'W' })).toBe('W');
    expect(chooseSpokenLetter(['see', 'bee'], { expected: 'B' })).toBe('B');
    expect(chooseSpokenLetter(['see', 'bee'], { expected: 'T' })).toBe('C');
    expect(chooseSpokenLetter('because')).toBeNull();
  });
});
