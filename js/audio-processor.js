// StreamProcessor.js - Handles large audio files with streaming
class StreamProcessor {
  constructor() {
    this.chunkSize = 1024 * 1024; // 1MB chunks
    this.supported = {
      aac: 'audio/aac',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg'
    };
  }

  async processFile(file, options = {}) {
    const {
      onProgress = () => {},
      onError = () => {},
      format = 'mp3',
      sampleRate = 44100,
      channels = 2
    } = options;

    try {
      // Initialize processing context
      const ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate,
        latencyHint: 'playback'
      });

      // Create MediaSource for streaming
      const mediaSource = new MediaSource();
      const sourceBuffer = await this.setupMediaSource(mediaSource, format);
      
      // Process in chunks
      let offset = 0;
      const chunks = [];
      
      while (offset < file.size) {
        const chunk = await this.readChunk(file, offset);
        const processedChunk = await this.processChunk(chunk, ctx);
        chunks.push(processedChunk);
        
        offset += this.chunkSize;
        onProgress(Math.min(100, (offset / file.size) * 100));
        
        // Allow GC and UI updates
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // Combine and encode final output
      const finalBuffer = await this.combineAudioBuffers(chunks, ctx);
      const encodedData = await this.encodeAudioBuffer(finalBuffer, format);
      
      return new Blob([encodedData], { type: this.supported[format] });
    } catch (error) {
      onError(error);
      throw error;
    }
  }

  async setupMediaSource(mediaSource, format) {
    return new Promise((resolve, reject) => {
      mediaSource.addEventListener('sourceopen', () => {
        try {
          const mimeType = this.supported[format];
          const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
          resolve(sourceBuffer);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  async readChunk(file, offset) {
    const chunk = file.slice(offset, offset + this.chunkSize);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(chunk);
    });
  }

  async processChunk(arrayBuffer, ctx) {
    try {
      // Decode audio data
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      // Create offline context for processing
      const offlineCtx = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
        sampleRate: audioBuffer.sampleRate
      });

      // Create processing nodes
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      // Apply audio processing chain
      const processedNode = await this.createProcessingChain(offlineCtx, source);
      processedNode.connect(offlineCtx.destination);
      
      source.start(0);
      return offlineCtx.startRendering();
    } catch (error) {
      console.error('Chunk processing error:', error);
      // Return original chunk if processing fails
      return ctx.createBuffer(2, arrayBuffer.length / 4, ctx.sampleRate);
    }
  }

  async createProcessingChain(ctx, source) {
    // Get parameters from UI
    const gainValue = parseFloat(document.getElementById('gainSlider').value);
    const noiseGateThreshold = parseFloat(document.getElementById('noiseGateThreshold').value);
    const reductionAmount = parseFloat(document.getElementById('reductionAmount').value);
    
    // Create optimized processing chain
    const noiseGate = ctx.createDynamicsCompressor();
    noiseGate.threshold.value = noiseGateThreshold;
    noiseGate.knee.value = 40;
    noiseGate.ratio.value = 20;
    noiseGate.attack.value = 0.02;
    noiseGate.release.value = 0.25;

    const gain = ctx.createGain();
    gain.gain.value = gainValue;

    // Connect nodes
    source.connect(noiseGate);
    noiseGate.connect(gain);

    // Add EQ if needed
    const eqNodes = Array.from(document.querySelectorAll('.eq-slider')).map(slider => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = parseFloat(slider.dataset.frequency);
      filter.Q.value = 1;
      filter.gain.value = parseFloat(slider.value);
      return filter;
    });

    // Connect EQ chain
    if (eqNodes.length > 0) {
      let prevNode = gain;
      eqNodes.forEach(node => {
        prevNode.connect(node);
        prevNode = node;
      });
      return eqNodes[eqNodes.length - 1];
    }

    return gain;
  }

  async combineAudioBuffers(buffers, ctx) {
    if (!buffers.length) return null;

    const totalLength = buffers.reduce((total, buf) => total + buf.length, 0);
    const combinedBuffer = ctx.createBuffer(
      buffers[0].numberOfChannels,
      totalLength,
      buffers[0].sampleRate
    );

    for (let channel = 0; channel < combinedBuffer.numberOfChannels; channel++) {
      const channelData = combinedBuffer.getChannelData(channel);
      let offset = 0;

      buffers.forEach(buffer => {
        channelData.set(buffer.getChannelData(channel), offset);
        offset += buffer.length;
      });
    }

    return combinedBuffer;
  }

  async encodeAudioBuffer(audioBuffer, format) {
    switch (format) {
      case 'mp3':
        return this.encodeMp3(audioBuffer);
      case 'aac':
        return this.encodeAAC(audioBuffer);
      default:
        return this.encodeWav(audioBuffer);
    }
  }

  async encodeMp3(audioBuffer) {
    const mp3encoder = new lamejs.Mp3Encoder(
      audioBuffer.numberOfChannels,
      audioBuffer.sampleRate,
      128
    );
    
    const samples = audioBuffer.getChannelData(0);
    const mp3Data = [];
    const blockSize = 1152; // MP3 frame size

    for (let i = 0; i < samples.length; i += blockSize) {
      const sampleChunk = samples.slice(i, i + blockSize);
      const mp3buf = mp3encoder.encodeBuffer(this.float32ToInt16(sampleChunk));
      if (mp3buf.length > 0) mp3Data.push(mp3buf);

      // Allow GC every 1000 chunks
      if (i % (blockSize * 1000) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const end = mp3encoder.flush();
    if (end.length > 0) mp3Data.push(end);

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  async encodeAAC(audioBuffer) {
    // Use MediaRecorder API for AAC encoding
    const ctx = new OfflineAudioContext({
      numberOfChannels: audioBuffer.numberOfChannels,
      length: audioBuffer.length,
      sampleRate: audioBuffer.sampleRate
    });

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const stream = ctx.createMediaStreamDestination().stream;
    const recorder = new MediaRecorder(stream, {
      mimeType: 'audio/aac'
    });

    const chunks = [];
    recorder.ondataavailable = e => chunks.push(e.data);

    recorder.start();
    source.start();

    return new Promise((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: 'audio/aac' }));
      };
      
      setTimeout(() => recorder.stop(), audioBuffer.duration * 1000);
    });
  }

  async encodeWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = audioBuffer.length * blockAlign;
    const bufferSize = 44 + dataSize;
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    const writeString = (view, offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Write audio data
    const offset = 44;
    const volume = 1;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
        const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset + (i * blockAlign) + (channel * 2), int16 * volume, true);
      }
    }

    return arrayBuffer;
  }

  float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }
}
