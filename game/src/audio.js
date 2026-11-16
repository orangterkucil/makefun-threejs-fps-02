// audio.js — every sound is synthesised here; the game loads no audio file.
//
// A shot is filtered noise plus a low body tone, a reload is a short square blip, and the
// charge ticks on the same oscillator family, so the whole soundscape is a few dozen lines
// of WebAudio with no network request and no asset to ship. Nodes disconnect themselves
// when they end, so a long round does not leak voices.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;

  function unlock() {
    if (!context) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      context = new AudioCtor();
      master = context.createGain();
      master.gain.value = 0.22;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, Math.floor(context.sampleRate * 0.35), context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (context.state === 'suspended') context.resume();
  }

  function running() {
    return context && master && !muted && context.state === 'running';
  }

  function tone(startFreq, duration, volume, type = 'sine', endFreq = startFreq) {
    if (!running()) return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFreq, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, endFreq), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now);
    oscillator.stop(now + duration);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function burst(cutoff, volume, duration = 0.13) {
    if (!running()) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, cutoff * 0.25), now + duration);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(now);
    source.stop(now + duration + 0.02);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  return {
    unlock,
    toggleMute() { muted = !muted; return muted; },
    shot(weaponId, volume = 1) {
      const heavy = weaponId === 'shotgun';
      burst(heavy ? 1800 : 4200, (heavy ? 0.85 : 0.6) * volume, heavy ? 0.22 : 0.1);
      tone(heavy ? 90 : 150, heavy ? 0.24 : 0.1, 0.4 * volume, 'triangle', 40);
    },
    reload() { tone(760, 0.06, 0.13, 'square', 320); },
    step() { burst(300, 0.1, 0.08); },
    hit(head) { tone(head ? 2100 : 1500, head ? 0.09 : 0.05, head ? 0.26 : 0.16, 'triangle'); },
    beep() { tone(1080, 0.1, 0.22); },
    armed() { tone(520, 0.18, 0.3, 'square', 900); },
    horn() { tone(180, 0.5, 0.3, 'sawtooth', 120); },
    throw() { burst(900, 0.14, 0.09); },
    explode() { burst(700, 1, 0.5); tone(70, 0.6, 0.8, 'triangle', 22); },
    tick() { tone(1600, 0.03, 0.1, 'square'); },
  };
}
