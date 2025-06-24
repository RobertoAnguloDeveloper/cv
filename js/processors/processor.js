// processor.js
class AudioProcessor {
  constructor() {
    this.CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks
    this.params = null;
    this.initialized = false;
  }

  setParams(params) {
    this.params = params;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;
  }

  async processFile(file) {
    await this.init();

    const chunks = Math.ceil(file.size / this.CHUNK_SIZE);
    let processedSize = 0;
    const processedChunks = [];

    try {
      // Process file in chunks
      for (let i = 0; i < chunks; i++) {
        const start = i * this.CHUNK_SIZE;
        const end = Math.min(start + this.CHUNK_SIZE, file.size);

        // Read chunk
        const chunk = await this.readChunk(file, start, end);

        // Send chunk to main thread for processing
        const processedChunk = await this.sendChunkToMainThread(chunk);
        processedChunks.push(processedChunk);

        // Update progress
        processedSize += (end - start);
        self.postMessage({
          type: 'progress',
          progress: (processedSize / file.size) * 100
        });

        // Allow GC and prevent UI blocking
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // Combine processed chunks
      const finalBuffer = await this.combineChunks(processedChunks);

      // Convert to WAV format
      return await this.encodeToWav(finalBuffer);

    } catch (error) {
      console.error('Processing error:', error);
      throw error;
    }
  }

  async sendChunkToMainThread(arrayBuffer) {
    return new Promise((resolve, reject) => {
      self.postMessage({
        type: 'processChunk',
        chunk: arrayBuffer,
        params: this.params
      }, [arrayBuffer]);

      const handler = (e) => {
        if (e.data.type === 'chunkProcessed') {
          self.removeEventListener('message', handler);
          resolve(e.data.result);
        }
      };

      self.addEventListener('message', handler);
    });
  }

  async readChunk(file, start, end) {
    const chunk = file.slice(start, end);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(chunk);
    });
  }

  async processChunk(arrayBuffer) {
    try {
      // Decode audio data
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);

      // Create processing context for this chunk
      const offlineCtx = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
        sampleRate: audioBuffer.sampleRate
      });

      // Create source
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      // Apply processing chain
      const processedNode = await this.createProcessingChain(offlineCtx, source);
      processedNode.connect(offlineCtx.destination);

      // Process audio
      source.start(0);
      return await offlineCtx.startRendering();

    } catch (error) {
      console.error('Chunk processing error:', error);
      // Return original data if processing fails
      return arrayBuffer;
    }
  }

  async createProcessingChain(ctx, source) {
    if (!this.params) {
      return source;
    }

    try {
      // Create nodes
      const noiseGate = ctx.createDynamicsCompressor();
      const gain = ctx.createGain();

      // Configure noise gate
      noiseGate.threshold.value = this.params.noiseGateThreshold;
      noiseGate.knee.value = 40;
      noiseGate.ratio.value = 20;
      noiseGate.attack.value = this.params.attackTime;
      noiseGate.release.value = this.params.releaseTime;

      // Configure gain
      gain.gain.value = this.params.gainValue;

      // Connect nodes
      source.connect(noiseGate);
      noiseGate.connect(gain);

      return gain;

    } catch (error) {
      console.error('Error creating processing chain:', error);
      return source;
    }
  }

  async combineChunks(chunks) {
    if (!chunks.length) return null;

    // Calculate total length
    const totalLength = chunks.reduce((total, chunk) => {
      return total + (chunk instanceof ArrayBuffer ? new Float32Array(chunk).length : 0);
    }, 0);

    // Create final buffer
    const finalBuffer = new Float32Array(totalLength);

    // Combine chunks
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk instanceof ArrayBuffer) {
        const chunkData = new Float32Array(chunk);
        finalBuffer.set(chunkData, offset);
        offset += chunkData.length;
      }
    }

    return finalBuffer.buffer;
  }

  async encodeToWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    // Calculate sizes
    const blockAlign = numChannels * (bitDepth / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = audioBuffer.length * blockAlign;
    const bufferSize = 44 + dataSize;

    // Create buffer
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // Write WAV header
    this.writeWavHeader(view, {
      numChannels,
      sampleRate,
      bitDepth,
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

    return new Blob([buffer], { type: 'audio/wav' });
  }

  writeWavHeader(view, { numChannels, sampleRate, bitDepth, dataSize }) {
    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);

    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

// Export the processor
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AudioProcessor;
} else {
  self.AudioProcessor = AudioProcessor;
}