// audioWorker.js
class ChunkedAudioProcessor {
  constructor() {
    this.CHUNK_SIZE = 512 * 1024; // 512KB chunks
    this.ctx = null;
    this.tempFiles = [];
  }

  async init() {
    // Request temporary filesystem quota
    const quota = await new Promise((resolve, reject) => {
      navigator.webkitPersistentStorage.requestQuota(
        1024 * 1024 * 1024, // 1GB quota
        resolve,
        reject
      );
    });

    // Initialize filesystem
    this.fs = await new Promise((resolve, reject) => {
      window.webkitRequestFileSystem(
        window.PERSISTENT,
        quota,
        resolve,
        reject
      );
    });

    // Initialize audio context
    this.ctx = new OfflineAudioContext({
      numberOfChannels: 2,
      length: 44100, // 1 second buffer
      sampleRate: 44100
    });
  }

  async processFile(file) {
    await this.init();
    
    const chunks = Math.ceil(file.size / this.CHUNK_SIZE);
    let processedSize = 0;
    
    for (let i = 0; i < chunks; i++) {
      const start = i * this.CHUNK_SIZE;
      const end = Math.min(start + this.CHUNK_SIZE, file.size);
      
      // Read chunk
      const chunk = await this.readChunk(file, start, end);
      
      // Process chunk
      const processedChunk = await this.processChunk(chunk);
      
      // Save processed chunk
      await this.saveChunk(processedChunk, i);
      
      processedSize += (end - start);
      postMessage({
        type: 'progress',
        progress: (processedSize / file.size) * 100
      });
    }
    
    // Combine chunks
    const finalBuffer = await this.combineChunks();
    
    // Clean up temp files
    await this.cleanup();
    
    return finalBuffer;
  }

  async readChunk(file, start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file.slice(start, end));
    });
  }

  async processChunk(arrayBuffer) {
    try {
      // Decode audio data
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      
      // Create processing context
      const offlineCtx = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
        sampleRate: audioBuffer.sampleRate
      });

      // Create source
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      // Create processing chain
      const processedNode = this.createProcessingChain(offlineCtx, source);
      processedNode.connect(offlineCtx.destination);

      // Process audio
      source.start(0);
      const processedBuffer = await offlineCtx.startRendering();

      // Convert to raw PCM data
      return this.audioBufferToPCM(processedBuffer);
    } catch (error) {
      console.error('Chunk processing error:', error);
      // Return original data if processing fails
      return arrayBuffer;
    }
  }

  createProcessingChain(ctx, source) {
    // Get processing parameters from shared data
    const params = this.processingParams;

    // Create nodes
    const noiseGate = ctx.createDynamicsCompressor();
    noiseGate.threshold.value = params.noiseGateThreshold;
    noiseGate.knee.value = 40;
    noiseGate.ratio.value = 20;
    noiseGate.attack.value = params.attackTime;
    noiseGate.release.value = params.releaseTime;

    const gain = ctx.createGain();
    gain.gain.value = params.gainValue;

    // Connect nodes
    source.connect(noiseGate);
    noiseGate.connect(gain);

    return gain;
  }

  async saveChunk(data, index) {
    return new Promise((resolve, reject) => {
      this.fs.root.getFile(
        `chunk_${index}.tmp`,
        { create: true },
        async (fileEntry) => {
          this.tempFiles.push(fileEntry);
          const writer = await this.createWriter(fileEntry);
          writer.write(new Blob([data]));
          writer.onwriteend = resolve;
          writer.onerror = reject;
        },
        reject
      );
    });
  }

  async createWriter(fileEntry) {
    return new Promise((resolve, reject) => {
      fileEntry.createWriter(resolve, reject);
    });
  }

  async combineChunks() {
    const chunks = [];
    
    for (const fileEntry of this.tempFiles) {
      const file = await this.readFile(fileEntry);
      chunks.push(await file.arrayBuffer());
    }
    
    return new Blob(chunks, { type: 'audio/wav' });
  }

  async readFile(fileEntry) {
    return new Promise((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
  }

  async cleanup() {
    for (const fileEntry of this.tempFiles) {
      await new Promise((resolve, reject) => {
        fileEntry.remove(resolve, reject);
      });
    }
    this.tempFiles = [];
  }

  audioBufferToPCM(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numChannels * 2; // 16-bit samples
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    let offset = 0;

    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
        const sample = audioBuffer.getChannelData(channel)[i];
        const value = Math.max(-1, Math.min(1, sample));
        const int16 = value < 0 ? value * 0x8000 : value * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return buffer;
  }
}

// Worker setup
let processor = null;

self.onmessage = async function(e) {
  if (!processor) {
    processor = new ChunkedAudioProcessor();
  }

  switch (e.data.type) {
    case 'init':
      processor.processingParams = e.data.params;
      break;

    case 'process':
      try {
        const result = await processor.processFile(e.data.file);
        self.postMessage({ type: 'complete', result }, [result]);
      } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
      }
      break;
  }
};
