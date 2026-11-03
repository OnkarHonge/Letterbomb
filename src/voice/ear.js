/**
 * One microphone session for Speak.
 * Phones end recognition after each phrase, so a session that ends while
 * the round is still on is opened again. A new word drops the previous
 * phrase so a late "bee" cannot answer the next word.
 * The first start() has to come from a tap. Later restarts ride that session.
 */

export function createEar({ Recognition, onArm, onUtterance, onIdle, onState } = {}) {
  let wanted = false;
  let rec = null;
  let generation = 0;
  let heard = false;

  function supported() {
    return typeof Recognition === 'function';
  }

  function detach(current) {
    current.onresult = null;
    current.onspeechstart = null;
    current.onerror = null;
    current.onend = null;
  }

  function live(gen, current) {
    return gen === generation && rec === current;
  }

  function open() {
    if (!wanted || rec) return;
    const gen = generation;
    let current;
    try {
      current = new Recognition();
    } catch {
      wanted = false;
      onState?.('missing');
      return;
    }
    rec = current;
    heard = false;
    current.lang = 'en-US';
    current.continuous = false;
    current.interimResults = true;
    current.maxAlternatives = 5;

    current.onspeechstart = () => {
      if (!live(gen, current)) return;
      onArm?.();
    };

    current.onresult = (event) => {
      if (!live(gen, current) || heard) return;
      const list = event?.results;
      if (!list?.length) return;
      const latest = list[list.length - 1];
      const final = Boolean(latest.isFinal);
      const count = typeof latest.length === 'number' ? latest.length : 0;
      const texts = [];
      for (let index = 0; index < count; index += 1) {
        const text = latest[index]?.transcript;
        if (text) texts.push(text);
      }
      if (onUtterance?.(texts, !final)) {
        heard = true;
        return;
      }
      if (final) onIdle?.();
    };

    current.onerror = (event) => {
      if (!live(gen, current)) return;
      const code = event?.error || '';
      if (code === 'no-speech' || code === 'aborted') return;
      if (code === 'network') {
        wanted = false;
        onState?.('network');
        return;
      }
      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        wanted = false;
        onState?.('blocked');
      }
    };

    current.onend = () => {
      if (!live(gen, current)) return;
      rec = null;
      if (wanted) open();
    };

    try {
      current.start();
      onState?.('listening');
    } catch (error) {
      if (rec === current) rec = null;
      if (error?.name === 'InvalidStateError') return;
      wanted = false;
      onState?.('blocked');
    }
  }

  function start() {
    if (!supported()) {
      onState?.('missing');
      return false;
    }
    wanted = true;
    if (!rec) open();
    return true;
  }

  function stop() {
    wanted = false;
    generation += 1;
    const current = rec;
    rec = null;
    if (current) {
      detach(current);
      try {
        current.abort();
      } catch {
        // The session had already ended.
      }
    }
  }

  function active() {
    return Boolean(wanted || rec);
  }

  function bump() {
    if (!wanted) return;
    generation += 1;
    heard = false;
    const current = rec;
    rec = null;
    if (!current) {
      open();
      return;
    }
    current.onresult = null;
    current.onspeechstart = null;
    current.onerror = null;
    current.onend = () => {
      if (wanted) open();
    };
    try {
      current.abort();
    } catch {
      if (wanted) open();
    }
  }

  function listening() {
    return Boolean(wanted && rec);
  }

  return { start, stop, bump, listening, active, supported };
}
