export function createSound() {
  let ctx = null;
  let enabled = true;

  function context() {
    if (!enabled) return null;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const semitone = 2 ** (1 / 12);

  function ascentPitch(step) {
    const height = Math.min(16, Math.max(1, Math.floor(Number(step) || 1)));
    return 496 * semitone ** (height - 1);
  }

  function tone({ frequency, endFrequency, duration, type = 'sine', gain = 0.08, delay = 0 }) {
    const audio = context();
    if (!audio) return;
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const start = audio.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    }
    amp.gain.setValueAtTime(gain, start);
    amp.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.connect(amp);
    amp.connect(audio.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  return {
    setEnabled(value) {
      enabled = Boolean(value);
    },
    unlock() {
      try {
        context();
      } catch {
        // Audio is optional. A failure must not stop the game.
      }
    },
    hit(step) {
      try {
        const base = ascentPitch(step);
        tone({
          frequency: base,
          endFrequency: base * semitone ** (1 / 3),
          duration: 0.07,
          gain: 0.06,
        });
      } catch {
        // Ignore audio graph errors.
      }
    },
    miss() {
      try {
        tone({
          frequency: 180,
          endFrequency: 70,
          duration: 0.16,
          type: 'triangle',
          gain: 0.05,
        });
      } catch {
        // Ignore audio graph errors.
      }
    },
    recallHit() {
      try {
        tone({ frequency: 640, endFrequency: 880, duration: 0.12, type: 'triangle', gain: 0.06 });
      } catch {
        // Ignore audio graph errors.
      }
    },
    recallMiss() {
      try {
        tone({ frequency: 240, endFrequency: 180, duration: 0.12, type: 'sine', gain: 0.04 });
      } catch {
        // Ignore audio graph errors.
      }
    },
    milestone(step) {
      try {
        const root = ascentPitch(step);
        const chord = [523.25, 659.25, 783.99];
        const scale = root / chord[0];
        chord.forEach((frequency, index) => {
          tone({
            frequency: frequency * scale,
            duration: 0.1,
            type: 'triangle',
            gain: 0.05,
            delay: index * 0.07,
          });
        });
      } catch {
        // Ignore audio graph errors.
      }
    },
  };
}
