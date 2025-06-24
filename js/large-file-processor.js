// Large File Audio Processor - Handles files over 1GB
class LargeFileProcessor {
  constructor() {
    this.CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
    this.MAX_CONCURRENT_CHUNKS = 3; // Limit concurrent processing
    this.processedChunks = new Map();
    this.totalChunks = 0;
    this.currentChunk = 0;
  }

  async processLargeFile(file, options = {}) {
    const {
      onProgress = () => {},
      onError = () => {},
      format = 'mp3'
    } = options;

    try {
      this.totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Set up processing queue
      const chunkQueue = [];
      for (let i = 0; i < this.totalChunks; i++) {
        const start = i * this.CHUNK_SIZE;
        const end = Math.min(start + this.CHUNK_SIZE, file.size);
        chunkQueue.push({ start, end, index: i });
      }

      // Process chunks with limited concurrency
      const processingPromises = [];
      let completedChunks = 0;

      while (chunkQueue.length > 0 || processingPromises.length > 0) {
        // Fill processing queue up to max concurrent chunks
        while (chunkQueue.length > 0 && processingPromises.length < this.MAX_CONCURRENT_CHUNKS) {
          const chunk = chunkQueue.shift();
          const promise = this.processChunk(file, chunk, ctx)
            .then(processedChunk => {
              this.processedChunks.set(chunk.index, processedChunk);
              completedChunks++;
              onProgress((completedChunks / this.totalChunks) * 100);
              
              // Clear processed chunk from memory
              processingPromises.splice(processingPromises.indexOf(promise), 1);
            })
            .catch(err => {
              onError(`Error processing chunk ${chunk.index}: ${err.message}`);
              // Skip failed chunk but continue processing
              completedChunks++;
            });
          
          processingPromises.push(promise);
        }

        // Wait for at least one promise to complete before next iteration
        if (processingPromises.length > 0) {
          await Promise.race(processingPromises);
        }

        // Allow GC and UI updates
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // Combine processed chunks
      const finalBuffer = await this.combineProcessedChunks(ctx);
      
      // Encode final audio
      let outputBlob;
      if (format === 'mp3') {
        outputBlob = await this.encodeLargeMP3(finalBuffer);
      } else {
        outputBlob = await this.encodeLargeWAV(finalBuffer);
      }

      // Clear all processed chunks
      this.processedChunks.clear();
      
      return outputBlob;
    } catch (error) {
      onError(error);
      throw error;
    }
  }

  async processChunk(file, { start, end, index }, ctx) {
    // Read chunk
    const chunk = await this.readFileChunk(file, start, end);
    
    try {
      // Decode audio data
      const audioBuffer = await ctx.decodeAudioData(chunk);
      
      // Create offline context for processing
      const offlineCtx = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
        sampleRate: audioBuffer.sampleRate
      });

      // Apply audio processing
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      
      const processedNode = await this.createProcessingChain(offlineCtx, source);
      processedNode.connect(offlineCtx.destination);
      
      source.start(0);
      return offlineCtx.startRendering();
    } catch (error) {
      console.error(`Chunk ${index} processing failed:`, error);
      // Return original chunk data if processing fails
      return ctx.createBuffer(2, end - start, ctx.sampleRate);
    }
  }

  async readFileChunk(file, start, end) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file.slice(start, end));
    });
  }

  async createProcessingChain(ctx, source) {
    // Get processing parameters
    const noiseGateThreshold = parseFloat(document.getElementById('noiseGateThreshold').value);
    const reductionAmount = parseFloat(document.getElementById('reductionAmount').value);
    const attackTime = parseFloat(document.getElementById('attackTime').value);
    const releaseTime = parseFloat(document.getElementById('releaseTime').value);
    const gainValue = parseFloat(document.getElementById('gainSlider').value);

    // Create and connect nodes
    const noiseGate = ctx.createDynamicsCompressor();
    noiseGate.threshold.value = noiseGateThreshold;
    noiseGate.knee.value = 40;
    noiseGate.ratio.value = 20;
    noiseGate.attack.value = attackTime;
    noiseGate.release.value = releaseTime;

    const gain = ctx.createGain();
    gain.gain.value = gainValue;

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

    let prevNode = gain;
    eqNodes.forEach(node => {
      prevNode.connect(node);
      prevNode = node;
    });

    return eqNodes.length > 0 ? eqNodes[eqNodes.length - 1] : gain;
  }

  async combineProcessedChunks(ctx) {
    // Calculate total length
    let totalLength = 0;
    let sampleRate = 44100;
    let numberOfChannels = 2;

    for (const buffer of this.processedChunks.values()) {
      totalLength += buffer.length;
      sampleRate = buffer.sampleRate;
      numberOfChannels = buffer.numberOfChannels;
    }

    // Create final buffer
    const finalBuffer = ctx.createBuffer(
      numberOfChannels,
      totalLength,
      sampleRate
    );

    // Combine chunks
    let offset = 0;
    for (let i = 0; i < this.totalChunks; i++) {
      const chunk = this.processedChunks.get(i);
      if (chunk) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
          const channelData = finalBuffer.getChannelData(channel);
          channelData.set(chunk.getChannelData(channel), offset);
        }
        offset += chunk.length;
      }
    }

    return finalBuffer;
  }

  async encodeLargeMP3(audioBuffer) {
    const CHUNK_SIZE = 1152; // MP3 frame size
    const encoder = new lamejs.Mp3Encoder(
      audioBuffer.numberOfChannels,
      audioBuffer.sampleRate,
      128
    );
    
    const chunks = [];
    const samples = audioBuffer.getChannelData(0);
    
    for (let i = 0; i < samples.length; i += CHUNK_SIZE) {
      const chunk = samples.slice(i, i + CHUNK_SIZE);
      const mp3buf = encoder.encodeBuffer(this.float32ToInt16(chunk));
      
      if (mp3buf.length > 0) {
        chunks.push(mp3buf);
      }

      // Allow GC every 1000 chunks
      if (i % (CHUNK_SIZE * 1000) === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const end = encoder.flush();
    if (end.length > 0) {
      chunks.push(end);
    }

    return new Blob(chunks, { type: 'audio/mp3' });
  }

  async encodeLargeWAV(audioBuffer) {
    const encoder = new WaveEncoder(audioBuffer.sampleRate, audioBuffer.numberOfChannels);
    const chunks = [];
    const chunkSize = 1024 * 1024; // 1MB chunks
    
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      
      for (let i = 0; i < channelData.length; i += chunkSize) {
        const chunk = channelData.slice(i, i + chunkSize);
        const encodedChunk = encoder.encodeChunk(chunk, channel);
        chunks.push(encodedChunk);
        
        // Allow GC
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }

    const wavHeader = encoder.generateHeader(audioBuffer.length);
    return new Blob([wavHeader, ...chunks], { type: 'audio/wav' });
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

// Helper class for WAV encoding
class WaveEncoder {
  constructor(sampleRate, numChannels) {
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this.bytesPerSample = 2;
  }

  generateHeader(totalSamples) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    
    // RIFF chunk descriptor
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + totalSamples * this.numChannels * this.bytesPerSample, true);
    this.writeString(view, 8, 'WAVE');
    
    // fmt sub-chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, this.numChannels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, this.sampleRate * this.numChannels * this.bytesPerSample, true);
    view.setUint16(32, this.numChannels * this.bytesPerSample, true);
    view.setUint16(34, 16, true);
    
    // data sub-chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, totalSamples * this.numChannels * this.bytesPerSample, true);
    
    return buffer;
  }

  encodeChunk(float32Array, channel) {
    const buffer = new ArrayBuffer(float32Array.length * this.bytesPerSample);
    const view = new DataView(buffer);
    
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(i * this.bytesPerSample, value, true);
    }
    
    return buffer;
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

class StreamingProcessor {
  constructor() {
    // Reduce chunk size to prevent buffer allocation errors
    this.CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks
    this.MAX_BUFFER_SIZE = 2 * 1024 * 1024; // 2MB buffer size
    this.MAX_CONCURRENT_CHUNKS = 2; // Reduce concurrent processing
    this.processedChunks = new Map();
    this.totalChunks = 0;
    this.currentChunk = 0;
    this.ctx = null;
  }

  async initContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 44100, // Force lower sample rate
        latencyHint: 'playback'
      });
    }
    return this.ctx;
  }

  async processLargeFile(file, options = {}) {
    const {
      onProgress = () => {},
      onError = () => {},
      format = 'mp3'
    } = options;

    try {
      await this.initContext();
      this.totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);
      
      // Create streaming buffer
      const streamBuffer = new StreamingBuffer(this.MAX_BUFFER_SIZE);
      const fileStream = file.stream();
      const reader = fileStream.getReader();

      let processedSize = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Add chunk to streaming buffer
        streamBuffer.push(value);

        // Process complete chunks
        while (streamBuffer.size >= this.CHUNK_SIZE) {
          const chunk = streamBuffer.pull(this.CHUNK_SIZE);
          try {
            const processedChunk = await this.processChunk(chunk);
            chunks.push(processedChunk);
          } catch (error) {
            console.warn('Chunk processing failed, using original data:', error);
            chunks.push(chunk);
          }

          processedSize += chunk.byteLength;
          onProgress((processedSize / file.size) * 100);

          // Allow GC and UI updates
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Process remaining data
      if (streamBuffer.size > 0) {
        const finalChunk = streamBuffer.pull(streamBuffer.size);
        try {
          const processedChunk = await this.processChunk(finalChunk);
          chunks.push(processedChunk);
        } catch (error) {
          console.warn('Final chunk processing failed:', error);
          chunks.push(finalChunk);
        }
      }

      // Encode final audio
      let outputBlob;
      if (format === 'mp3') {
        outputBlob = await this.encodeFinalMP3(chunks);
      } else {
        outputBlob = await this.encodeFinalWAV(chunks);
      }

      return outputBlob;
    } catch (error) {
      onError(error);
      throw error;
    }
  }

  async processChunk(chunk) {
    try {
      // Create temporary buffer for chunk processing
      const tempCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 44100
      });

      // Decode chunk
      const audioBuffer = await tempCtx.decodeAudioData(chunk.buffer.slice(0));

      // Create small offline context for processing
      const offlineCtx = new OfflineAudioContext({
        numberOfChannels: audioBuffer.numberOfChannels,
        length: audioBuffer.length,
        sampleRate: 44100
      });

      // Process audio
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;

      const processedNode = await this.createProcessingChain(offlineCtx, source);
      processedNode.connect(offlineCtx.destination);

      source.start(0);
      const processedBuffer = await offlineCtx.startRendering();

      // Convert to raw PCM data
      return this.audioBufferToPCM(processedBuffer);
    } catch (error) {
      console.error('Chunk processing error:', error);
      // Return original chunk on error
      return chunk;
    }
  }

  async createProcessingChain(ctx, source) {
    // Apply audio processing with error handling
    try {
      const noiseGate = ctx.createDynamicsCompressor();
      noiseGate.threshold.value = parseFloat(document.getElementById('noiseGateThreshold').value);
      noiseGate.knee.value = 40;
      noiseGate.ratio.value = 20;
      noiseGate.attack.value = parseFloat(document.getElementById('attackTime').value);
      noiseGate.release.value = parseFloat(document.getElementById('releaseTime').value);

      const gain = ctx.createGain();
      gain.gain.value = parseFloat(document.getElementById('gainSlider').value);

      source.connect(noiseGate);
      noiseGate.connect(gain);

      return gain;
    } catch (error) {
      console.warn('Processing chain creation failed:', error);
      return source; // Return unprocessed source on error
    }
  }

  audioBufferToPCM(audioBuffer) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length * numberOfChannels * 2; // 16-bit samples
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    let offset = 0;

    for (let i = 0; i < audioBuffer.length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = audioBuffer.getChannelData(channel)[i];
        const value = Math.max(-1, Math.min(1, sample)); // Clamp
        const int16 = value < 0 ? value * 0x8000 : value * 0x7FFF;
        view.setInt16(offset, int16, true);
        offset += 2;
      }
    }

    return new Uint8Array(buffer);
  }

  async encodeFinalMP3(chunks) {
    const encoder = new lamejs.Mp3Encoder(2, 44100, 128);
    const mp3Chunks = [];
    const FRAME_SIZE = 1152; // MP3 frame size

    for (const chunk of chunks) {
      // Convert chunk to samples
      const samples = new Int16Array(chunk.buffer);
      
      // Process in frames
      for (let i = 0; i < samples.length; i += FRAME_SIZE) {
        const frame = samples.slice(i, i + FRAME_SIZE);
        const mp3buf = encoder.encodeBuffer(frame);
        if (mp3buf.length > 0) {
          mp3Chunks.push(mp3buf);
        }
      }

      // Allow GC between chunks
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const end = encoder.flush();
    if (end.length > 0) {
      mp3Chunks.push(end);
    }

    return new Blob(mp3Chunks, { type: 'audio/mp3' });
  }

  async encodeFinalWAV(chunks) {
    // Calculate total size
    const totalSize = chunks.reduce((size, chunk) => size + chunk.length, 0);
    
    // Generate WAV header
    const header = this.createWAVHeader(totalSize, 2, 44100, 16);
    
    // Combine chunks with header
    return new Blob([header, ...chunks], { type: 'audio/wav' });
  }

  createWAVHeader(dataSize, numChannels, sampleRate, bitsPerSample) {
    const buffer = new ArrayBuffer(44);
    const view = new DataView(buffer);
    
    // RIFF chunk
    this.writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    this.writeString(view, 8, 'WAVE');
    
    // fmt chunk
    this.writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    
    // data chunk
    this.writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    return buffer;
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

// Helper class for streaming buffer management
class StreamingBuffer {
  constructor(maxSize) {
    this.buffer = new Uint8Array(0);
    this.maxSize = maxSize;
  }

  push(chunk) {
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;
  }

  pull(size) {
    const chunk = this.buffer.slice(0, size);
    this.buffer = this.buffer.slice(size);
    return chunk;
  }

  get size() {
    return this.buffer.length;
  }
}
