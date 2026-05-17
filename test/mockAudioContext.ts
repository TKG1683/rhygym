/**
 * Minimal AudioContext stub for unit tests. jsdom has no Web Audio API,
 * and we don't actually want to make sound — we just want to verify that
 * the scheduler called createOscillator / start at the expected times.
 *
 * Each `oscillator.start(t)` records `t` into `oscStarts` so tests can
 * assert on the click timeline.
 */

export class MockAudioContext {
  currentTime = 0;
  state: 'running' | 'suspended' | 'closed' = 'running';
  destination = {} as AudioNode;

  /** AudioContext.currentTime values that oscillator.start() was called with. */
  oscStarts: number[] = [];
  /** Frequencies set on oscillators in call order (parallel to oscStarts). */
  oscFreqs: number[] = [];

  createOscillator(): OscillatorNode {
    const self = this;
    let freq = 0;
    const osc = {
      frequency: {
        get value(): number {
          return freq;
        },
        set value(v: number) {
          freq = v;
        },
      },
      connect: () => {},
      start: (time: number) => {
        self.oscStarts.push(time);
        self.oscFreqs.push(freq);
      },
      stop: () => {},
    };
    return osc as unknown as OscillatorNode;
  }

  createGain(): GainNode {
    const gain = {
      gain: {
        value: 0,
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    };
    return gain as unknown as GainNode;
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }

  /** Test helper: advance the audio clock without involving real timers. */
  advance(sec: number): void {
    this.currentTime += sec;
  }
}
