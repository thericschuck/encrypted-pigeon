"""
Synthesizes the two <EncryptionSequence /> chimes from scratch (no samples,
so no licensing questions) and encodes them to public/sounds/*.mp3.

    python scripts/generate-sounds.py      # needs ffmpeg on PATH

- encrypt-start: retro terminal "boot" — a run of rising digital blips over a
  soft hum, closing on a confirmation beep. Plays when the sequence starts.
- encrypt-end: "launch" — a soft rising bell arpeggio plus an airy whoosh
  (the pigeon taking off). Plays when the sequence completes.

Pure standard library on purpose (math/random/wave), so tweaking a sound
never needs a pip install.
"""

import math
import os
import random
import subprocess
import tempfile
import wave

SAMPLE_RATE = 44100
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "sounds")
random.seed(7)  # deterministic output: re-running doesn't churn the files


def silence(seconds):
    return [0.0] * int(seconds * SAMPLE_RATE)


def mix_into(buffer, samples, start_seconds, gain=1.0):
    start = int(start_seconds * SAMPLE_RATE)
    needed = start + len(samples)
    if needed > len(buffer):
        buffer.extend([0.0] * (needed - len(buffer)))
    for i, s in enumerate(samples):
        buffer[start + i] += s * gain


def envelope(n, attack, release, curve=3.0):
    """Linear attack, exponential-ish release, in samples."""
    a = max(1, int(attack * SAMPLE_RATE))
    r = max(1, int(release * SAMPLE_RATE))
    env = []
    for i in range(n):
        if i < a:
            env.append(i / a)
        elif i >= n - r:
            t = (n - i) / r
            env.append(t ** curve)
        else:
            env.append(1.0)
    return env


def tone(freq, seconds, wave_fn, attack=0.004, release=0.05, freq_end=None, curve=3.0):
    n = int(seconds * SAMPLE_RATE)
    env = envelope(n, attack, release, curve)
    out = []
    phase = 0.0
    for i in range(n):
        f = freq if freq_end is None else freq + (freq_end - freq) * (i / n)
        phase += 2 * math.pi * f / SAMPLE_RATE
        out.append(wave_fn(phase) * env[i])
    return out


def sine(p):
    return math.sin(p)


def soft_square(p):
    # Band-limited-ish square: first few odd harmonics, so the blips sound
    # "digital" without harsh aliasing.
    return (math.sin(p) + math.sin(3 * p) / 3 + math.sin(5 * p) / 5) * 0.8


def bell(freq, seconds):
    # Two slightly inharmonic partials + fast attack / long decay = soft
    # glassy bell.
    n = int(seconds * SAMPLE_RATE)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        decay = math.exp(-t * 4.5)
        attack = min(1.0, t / 0.006)
        s = (
            math.sin(2 * math.pi * freq * t)
            + 0.35 * math.sin(2 * math.pi * freq * 2.76 * t) * math.exp(-t * 9)
            + 0.15 * math.sin(2 * math.pi * freq * 5.4 * t) * math.exp(-t * 16)
        )
        out.append(s * decay * attack * 0.6)
    return out


def noise_sweep(seconds, lp_start, lp_end, gain):
    """White noise through a one-pole low-pass whose cutoff sweeps — a whoosh."""
    n = int(seconds * SAMPLE_RATE)
    out = []
    y = 0.0
    for i in range(n):
        progress = i / n
        cutoff = lp_start + (lp_end - lp_start) * progress
        alpha = 1 - math.exp(-2 * math.pi * cutoff / SAMPLE_RATE)
        y += alpha * (random.uniform(-1, 1) - y)
        # Swell in, fade out.
        env = math.sin(math.pi * progress) ** 1.5
        out.append(y * env * gain)
    return out


def finalize(samples, peak=0.8, tail=0.05):
    samples = samples + silence(tail)
    # Gentle tanh saturation glues the layers, then normalize to `peak`.
    samples = [math.tanh(s * 1.3) for s in samples]
    max_abs = max(abs(s) for s in samples) or 1.0
    return [s / max_abs * peak for s in samples]


def write_mp3(name, samples):
    os.makedirs(OUT_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, f"{name}.wav")
        with wave.open(wav_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SAMPLE_RATE)
            w.writeframes(
                b"".join(
                    int(max(-1.0, min(1.0, s)) * 32767).to_bytes(2, "little", signed=True)
                    for s in samples
                )
            )
        mp3_path = os.path.abspath(os.path.join(OUT_DIR, f"{name}.mp3"))
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
                "-codec:a", "libmp3lame", "-b:a", "96k", "-map_metadata", "-1",
                mp3_path,
            ],
            check=True,
        )
        print(f"wrote {mp3_path}")


def encrypt_start():
    buf = silence(1.05)
    # Low hum swelling under the blips.
    mix_into(buf, tone(110, 0.95, sine, attack=0.25, release=0.35, curve=1.5), 0.0, 0.25)
    mix_into(buf, tone(165, 0.95, sine, attack=0.3, release=0.35, curve=1.5), 0.0, 0.1)
    # Rising run of digital blips, slightly irregular timing like a terminal.
    base = [523, 659, 587, 784, 698, 880, 988, 1175]
    t = 0.04
    for i, f in enumerate(base):
        mix_into(buf, tone(f, 0.045, soft_square, release=0.025), t, 0.28)
        t += 0.062 + random.uniform(-0.01, 0.012)
    # Confirmation beep: two quick notes, the second a fifth up.
    mix_into(buf, tone(1318, 0.07, sine, release=0.04), t + 0.06, 0.45)
    mix_into(buf, tone(1976, 0.16, sine, release=0.12), t + 0.14, 0.4)
    return finalize(buf, peak=0.7)


def encrypt_end():
    buf = silence(1.5)
    # Whoosh: noise sweeping up in brightness, like wings taking off.
    mix_into(buf, noise_sweep(0.75, 300, 4500, 1.4), 0.0, 1.0)
    # Soft rising bell arpeggio (C major: C6 E6 G6 C7).
    for i, f in enumerate([1047, 1319, 1568, 2093]):
        mix_into(buf, bell(f, 1.0), 0.18 + i * 0.09, 0.55 if i < 3 else 0.45)
    # Faint "wing flutter": a few tiny low thumps during the whoosh.
    for i in range(4):
        mix_into(buf, tone(95, 0.05, sine, attack=0.002, release=0.04), 0.08 + i * 0.075, 0.35)
    return finalize(buf, peak=0.7)


if __name__ == "__main__":
    write_mp3("encrypt-start", encrypt_start())
    write_mp3("encrypt-end", encrypt_end())
