// src/services/soundNotifier.js
//
// Tiny opt-in sound for SSE-driven events (e.g. a sale landing on another
// cashier's screen). Uses the Web Audio API to synthesize short beeps so
// we don't need to ship an audio file. Off by default — every public
// entry point is a no-op until the user explicitly enables it.
//
// Browser autoplay policy: AudioContext starts suspended until the page
// receives a user gesture. We resume on the first click/keydown so a
// later programmatic play() actually produces sound.

const STORAGE_KEY = "pos.soundNotifier.enabled";
const VOLUME_KEY = "pos.soundNotifier.volume";

let audioCtx = null;
let enabled = readEnabledFromStorage();
let volume = readVolumeFromStorage();

const isBrowser = typeof window !== "undefined" && typeof window.AudioContext !== "undefined";

const readEnabledFromStorage = () => {
  if (!isBrowser) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
};

const writeEnabledToStorage = (next) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* private mode / quota */
  }
};

const readVolumeFromStorage = () => {
  if (!isBrowser) return 0.5;
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    const n = Number(raw);
    // Default 0.5 if missing/invalid. Clamp into [0, 1] so a tampered
    // localStorage value can't blow the user's ears out.
    if (!Number.isFinite(n)) return 0.5;
    return Math.min(1, Math.max(0, n));
  } catch {
    return 0.5;
  }
};

const writeVolumeToStorage = (next) => {
  if (!isBrowser) return;
  try {
    window.localStorage.setItem(VOLUME_KEY, String(next));
  } catch {
    /* private mode / quota */
  }
};

const ensureContext = () => {
  if (!isBrowser) return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === "suspended") {
    // Resume is a no-op if not triggered by a user gesture in some
    // browsers — that's fine; we'll retry on the next play() after the
    // user clicks anywhere.
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

// Browser autoplay policy: attach a one-shot listener that resumes the
// AudioContext on the first user interaction. After that, programmatic
// play() works.
if (isBrowser) {
  const resume = () => {
    ensureContext();
    window.removeEventListener("click", resume, true);
    window.removeEventListener("keydown", resume, true);
    window.removeEventListener("touchstart", resume, true);
  };
  window.addEventListener("click", resume, true);
  window.addEventListener("keydown", resume, true);
  window.addEventListener("touchstart", resume, true);
}

// Synthesize a short tone at the given frequency. Falls back to a quick
// ADSR envelope so it doesn't click. The `gain` argument is the raw
// waveform amplitude; we scale by the user's volume setting so they can
// dial it down on a noisy shift.
const playTone = ({ frequency = 880, durationMs = 90, gain = 0.12 } = {}) => {
  const ac = ensureContext();
  if (!ac) return;
  const now = ac.currentTime;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = frequency;
  // Tiny attack so the very first sample isn't a click; release tail so
  // it doesn't pop on cutoff.
  const peak = Math.min(1, Math.max(0, gain * volume));
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(peak, now + 0.005);
  g.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
};

const play = (kind) => {
  if (!enabled || !isBrowser) return;
  if (kind === "invoice") {
    playTone({ frequency: 1320, durationMs: 70 });
    setTimeout(() => playTone({ frequency: 1760, durationMs: 70 }), 80);
  } else if (kind === "booking") {
    playTone({ frequency: 880, durationMs: 110 });
  } else if (kind === "low-stock") {
    playTone({ frequency: 440, durationMs: 140 });
  } else {
    playTone({ frequency: 880, durationMs: 80 });
  }
};

// Preview a sound regardless of the enabled flag. Used by the Test
// Sound button so users can verify audio without first enabling global
// sounds — useful for diagnosing "I hear nothing on new sales."
const preview = (kind) => {
  if (!isBrowser) return;
  if (kind === "invoice") {
    playTone({ frequency: 1320, durationMs: 70 });
    setTimeout(() => playTone({ frequency: 1760, durationMs: 70 }), 80);
  } else if (kind === "booking") {
    playTone({ frequency: 880, durationMs: 110 });
  } else if (kind === "low-stock") {
    playTone({ frequency: 440, durationMs: 140 });
  } else {
    playTone({ frequency: 880, durationMs: 80 });
  }
};

export const setSoundEnabled = (next) => {
  enabled = !!next;
  writeEnabledToStorage(enabled);
  // Touch the context on toggle so the next play() doesn't pay the
  // first-call cost (which can drop the first frame on slow devices).
  if (enabled) ensureContext();
};

export const isSoundEnabled = () => enabled;

// Volume is a 0..1 scalar. Persisted so it survives reload.
export const setVolume = (next) => {
  const clamped = Math.min(1, Math.max(0, Number(next) || 0));
  volume = clamped;
  writeVolumeToStorage(clamped);
};

export const getVolume = () => volume;

// Play a sound for testing/feedback. Respects the `enabled` flag — the
// SSE bridge in DataContext always calls this, so a user who has not
// opted in never hears a beep.
export const playSound = (kind) => play(kind);

// Preview a sound regardless of the enabled flag. The Test Sound button
// in the user menu uses this so users can verify their audio routing /
// volume without first enabling global activity sounds.
export const previewSound = (kind) => preview(kind);

// Test-only — reset module state. Not exported through the public API
// but exposed for unit tests that need to clear localStorage between
// cases.
export const __resetForTests = () => {
  enabled = false;
  volume = 0.5;
  audioCtx = null;
};
