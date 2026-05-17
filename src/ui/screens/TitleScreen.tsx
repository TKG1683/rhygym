import { useAppStore } from '../store/appStore';

export function TitleScreen() {
  const goto = useAppStore((s) => s.goto);
  const audioContext = useAppStore((s) => s.audioContext);
  const setAudioContext = useAppStore((s) => s.setAudioContext);

  const handleStart = async () => {
    // Create (or reuse) the AudioContext while we are still inside the
    // user-gesture handler — iOS Safari and Android Chrome both refuse
    // to start audio that wasn't initiated by a tap/click.
    let ctx = audioContext;
    if (!ctx) {
      ctx = new AudioContext();
      setAudioContext(ctx);
    }
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    // Warm-up: play an inaudible 50 ms buffer so the audio pipeline is
    // fully spun up by the time GameScreen mounts. Without this, the
    // first few metronome clicks come out quieter than the rest because
    // the audio thread is still ramping up its first real output.
    warmUpAudio(ctx);
    goto('select');
  };

  return (
    <main className="screen">
      <h1 className="logo">Rhygym</h1>
      <p className="tagline">楽譜を読み、タップでリズムを叩け。</p>
      <button className="primary" onClick={handleStart}>
        Start
      </button>
    </main>
  );
}

function warmUpAudio(ctx: AudioContext): void {
  // Play a 100 ms barely-audible 440 Hz tone (-60 dB) to spin up the
  // audio thread AND give AGC/output normalisation something real to
  // react to. A pure silent buffer wasn't enough — iOS / Android only
  // commit the playback path on the first non-zero sample, and without
  // that the first real metronome click came out quieter than the rest.
  const lengthSamples = Math.ceil(ctx.sampleRate * 0.1);
  const buffer = ctx.createBuffer(1, lengthSamples, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const tinyAmplitude = 0.001;
  for (let i = 0; i < lengthSamples; i++) {
    data[i] = Math.sin((2 * Math.PI * 440 * i) / ctx.sampleRate) * tinyAmplitude;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
}
