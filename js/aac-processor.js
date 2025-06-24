class AACStreamProcessor {
  constructor() {
    this.CHUNK_SIZE = 5 * 1024 * 1024; // 5MB segments
    this.sourceBuffer = null;
    this.mediaSource = null;
    this.tmpAudio = null;
    this.queue = [];
    this.isProcessing = false;
  }

  async init() {
    try {
      this.tmpAudio = document.createElement('audio');
      this.mediaSource = new MediaSource();
      this.tmpAudio.src = URL.createObjectURL(this.mediaSource);

      await new Promise((resolve) => {
        this.mediaSource.addEventListener('sourceopen', () => {
          try {
            // Create source buffer without setting mode
            this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/aac');
            
            this.sourceBuffer.addEventListener('updateend', () => {
              this.processQueue();
            });

            resolve();
          } catch (error) {
            console.error('Error creating source buffer:', error);
            // Fallback to basic audio context
            this.sourceBuffer = null;
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Init error:', error);
      throw error;
    }
  }

  async processFile(file, options = {}) {
    const {
      onProgress = () => {},
      onError = () => {},
      format = 'mp3'
    } = options;

    try {
      await this.init();
      
      // If source buffer creation failed, use fallback method
      if (!this.sourceBuffer) {
        return this.processFallback(file, { onProgress, format });
      }

      const reader = file.stream().getReader();
      let processedSize = 0;
      const fileSize = file.size;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        await this.appendChunk(value);
        processedSize += value.length;
        onProgress((processedSize / fileSize) * 100);
      }

      // Wait for processing to complete
      await this.waitForProcessing();

      // Export to requested format
      return this.exportToFormat(format);
    } catch (error) {
      onError(error);
      this.cleanup();
      throw error;
    }
  }

  async appendChunk(chunk) {
    if (this.sourceBuffer.updating) {
      this.queue.push(chunk);
      return;
    }

    try {
      this.sourceBuffer.appendBuffer(chunk);
    } catch (error) {
      console.error('Error appending chunk:', error);
      throw error;
    }
  }

  async processQueue() {
    if (this.queue.length > 0 && !this.sourceBuffer.updating) {
      const chunk = this.queue.shift();
      await this.appendChunk(chunk);
    }
  }

  async waitForProcessing() {
    return new Promise((resolve) => {
      const check = () => {
        if (this.queue.length === 0 && !this.sourceBuffer.updating) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async processFallback(file, { onProgress, format }) {
    // Create audio context
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Read file as array buffer
    const arrayBuffer = await file.arrayBuffer();
    
    // Decode audio data
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    
    // Process audio
    const processedBuffer = await this.processAudioBuffer(audioBuffer, ctx);
    
    // Export to requested format
    return this.encodeToFormat(processedBuffer, format);
  }

  async processAudioBuffer(buffer, ctx) {
    const offlineCtx = new OfflineAudioContext({
      numberOfChannels: buffer.numberOfChannels,
      length: buffer.length,
      sampleRate: buffer.sampleRate
    });

    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    // Apply audio processing
    const processedNode = await this.createProcessingChain(offlineCtx, source);
    processedNode.connect(offlineCtx.destination);

    source.start(0);
    return offlineCtx.startRendering();
  }

  async createProcessingChain(ctx, source) {
    // Create nodes
    const noiseGate = ctx.createDynamicsCompressor();
    const gain = ctx.createGain();
    
    // Configure noise gate
    noiseGate.threshold.value = parseFloat(document.getElementById('noiseGateThreshold').value);
    noiseGate.knee.value = 40;
    noiseGate.ratio.value = 20;
    noiseGate.attack.value = parseFloat(document.getElementById('attackTime').value);
    noiseGate.release.value = parseFloat(document.getElementById('releaseTime').value);

    // Configure gain
    gain.gain.value = parseFloat(document.getElementById('gainSlider').value);

    // Create and configure EQ filters
    const filters = Array.from(document.querySelectorAll('.eq-slider')).map(slider => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = parseFloat(slider.dataset.frequency);
      filter.Q.value = 1;
      filter.gain.value = parseFloat(slider.value);
      return filter;
    });

    // Connect nodes
    source.connect(noiseGate);
    noiseGate.connect(gain);

    let prevNode = gain;
    filters.forEach(filter => {
      prevNode.connect(filter);
      prevNode = filter;
    });

    return prevNode;
  }

  async encodeToFormat(audioBuffer, format) {
    switch (format) {
      case 'mp3':
        return this.encodeToMP3(audioBuffer);
      case 'wav':
        return this.encodeToWAV(audioBuffer);
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  async encodeToMP3(audioBuffer) {
    const mp3encoder = new lamejs.Mp3Encoder(
      audioBuffer.numberOfChannels,
      audioBuffer.sampleRate,
      128
    );

    const samples = audioBuffer.getChannelData(0);
    const mp3Data = [];

    // Process in chunks
    const CHUNK_SIZE = 1152; // MP3 frame size
    for (let i = 0; i < samples.length; i += CHUNK_SIZE) {
      const chunk = samples.slice(i, i + CHUNK_SIZE);
      const mp3buf = mp3encoder.encodeBuffer(this.float32ToInt16(chunk));
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }

      // Allow GC
      if (i % (CHUNK_SIZE * 1000) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const end = mp3encoder.flush();
    if (end.length > 0) {
      mp3Data.push(end);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  async encodeToWAV(audioBuffer) {
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

    // Write WAV header
    this.writeWAVHeader(view, {
      numChannels,
      sampleRate,
      bitsPerSample,
      dataSize
    });

    // Write audio data
    let offset = 44;
    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = Math.max(-1, Math.min(1, audioBuffer.getChannelData(channel)[i]));
        const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        view.setInt16(offset, value, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  writeWAVHeader(view, { numChannels, sampleRate, bitsPerSample, dataSize }) {
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
  }

  float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
  }

  cleanup() {
    if (this.tmpAudio) {
      this.tmpAudio.pause();
      this.tmpAudio.src = '';
      this.tmpAudio = null;
    }
    if (this.mediaSource && this.mediaSource.readyState === 'open') {
      try {
        this.mediaSource.endOfStream();
      } catch (e) {
        console.warn('Error ending media source stream:', e);
      }
    }
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.queue = [];
  }
}