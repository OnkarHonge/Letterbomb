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
    hit(streak) {
      try {
        const base = 480 + Math.min(streak, 16) * 16;
        tone({ frequency: base, endFrequency: base * 1.4, duration: 0.07, gain: 0.06 });
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
    milestone() {
      try {
        [523.25, 659.25, 783.99].forEach((frequency, index) => {
          tone({
            frequency,
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
