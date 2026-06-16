class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1024);
    this.offset = 0;
    this.firstFrame = 0;
    this.port.onmessage = event => {
      if (event.data?.type === 'reset') {
        this.offset = 0;
        this.firstFrame = currentFrame;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }

    const channelCount = input.length;
    const frameCount = input[0].length;
    const mono = new Float32Array(frameCount);

    for (let frame = 0; frame < frameCount; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        sum += input[channel][frame] || 0;
      }
      mono[frame] = sum / channelCount;
    }

    this.append(mono);
    return true;
  }

  append(samples) {
    let cursor = 0;
    while (cursor < samples.length) {
      if (this.offset === 0) {
        this.firstFrame = currentFrame + cursor;
      }

      const writable = Math.min(this.buffer.length - this.offset, samples.length - cursor);
      this.buffer.set(samples.subarray(cursor, cursor + writable), this.offset);
      this.offset += writable;
      cursor += writable;

      if (this.offset >= this.buffer.length) {
        this.flush();
      }
    }
  }

  flush() {
    if (this.offset === 0) return;

    const samples = this.buffer.slice(0, this.offset);
    this.port.postMessage(
      {
        type: 'pcm',
        samples,
        startFrame: this.firstFrame,
        sampleRate,
      },
      [samples.buffer],
    );
    this.offset = 0;
  }
}

registerProcessor('pcm-capture-processor', PcmCaptureProcessor);
