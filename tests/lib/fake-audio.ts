/**
 * A tiny stand-in for the Web Audio API so Vitest can run every sound recipe in Node. It enforces the rules the
 * real API throws on (exponential ramps to zero or negative values, non-finite values, stopping before starting)
 * and counts the nodes made.
 */
export class FakeParam {
  value: number;
  events: [string, number, number][] = [];
  constructor(v = 0) { this.value = v; }
  private check(name: string, v: number, t: number) {
    if (!Number.isFinite(v) || !Number.isFinite(t)) throw new Error(`${name}: non-finite ${v} @ ${t}`);
    if (t < 0) throw new Error(`${name}: negative time ${t}`);
    this.events.push([name, v, t]);
    return this as unknown as AudioParam;
  }
  setValueAtTime(v: number, t: number) { return this.check('set', v, t); }
  linearRampToValueAtTime(v: number, t: number) { return this.check('lin', v, t); }
  exponentialRampToValueAtTime(v: number, t: number) { if (v <= 0) throw new Error(`exponential ramp to ${v}`); return this.check('exp', v, t); }
  setTargetAtTime(v: number, t: number, k: number) { if (!(k > 0)) throw new Error(`setTargetAtTime constant ${k}`); return this.check('target', v, t); }
  cancelScheduledValues() { return this as unknown as AudioParam; }
}

class FakeNode {
  outputs: unknown[] = [];
  constructor(readonly ctx: FakeContext, readonly kind: string) { ctx.nodes++; ctx.byKind[kind] = (ctx.byKind[kind] ?? 0) + 1; }
  connect<T>(n: T): T { if (!n) throw new Error('connect to nothing'); this.outputs.push(n); return n; }
  disconnect() { this.outputs = []; }
}
class FakeSource extends FakeNode {
  started = -1;
  start(t = 0) { if (this.started >= 0) throw new Error('start twice'); if (!Number.isFinite(t)) throw new Error('bad start'); this.started = t; }
  stop(t = 0) { if (this.started < 0) throw new Error('stop before start'); if (!Number.isFinite(t)) throw new Error('bad stop'); }
}

export class FakeContext {
  nodes = 0;
  byKind: Record<string, number> = {};
  currentTime = 0;
  sampleRate = 8000;
  state = 'running';
  destination = new FakeNode(this, 'destination');
  listener = { positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam(), forwardX: new FakeParam(), forwardY: new FakeParam(), forwardZ: new FakeParam(-1), upX: new FakeParam(), upY: new FakeParam(1), upZ: new FakeParam() };
  createGain() { return Object.assign(new FakeNode(this, 'gain'), { gain: new FakeParam(1) }); }
  createOscillator() { return Object.assign(new FakeSource(this, 'osc'), { type: 'sine', frequency: new FakeParam(440), detune: new FakeParam(0) }); }
  createBufferSource() { return Object.assign(new FakeSource(this, 'buffer'), { buffer: null, loop: false, playbackRate: new FakeParam(1) }); }
  createBiquadFilter() { return Object.assign(new FakeNode(this, 'biquad'), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1), gain: new FakeParam(0) }); }
  createWaveShaper() { return Object.assign(new FakeNode(this, 'shaper'), { curve: null, oversample: 'none' }); }
  createConvolver() { return Object.assign(new FakeNode(this, 'convolver'), { buffer: null }); }
  createDynamicsCompressor() { return Object.assign(new FakeNode(this, 'compressor'), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() }); }
  createAnalyser() { return Object.assign(new FakeNode(this, 'analyser'), { fftSize: 2048, getFloatTimeDomainData: (b: Float32Array) => b.fill(0) }); }
  createStereoPanner() { return Object.assign(new FakeNode(this, 'stereo'), { pan: new FakeParam() }); }
  createPanner() { return Object.assign(new FakeNode(this, 'panner'), { panningModel: '', distanceModel: '', refDistance: 1, maxDistance: 1, rolloffFactor: 1, positionX: new FakeParam(), positionY: new FakeParam(), positionZ: new FakeParam() }); }
  createBuffer(ch: number, len: number, rate: number) {
    const data = Array.from({ length: ch }, () => new Float32Array(len));
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: (i: number) => data[i] };
  }
}

export const fakeContext = () => new FakeContext() as unknown as BaseAudioContext & FakeContext;
