// main.js

// Add to the top of main.js
class ChunkedAudioProcessor {
  constructor() {
    this.CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
    this.mp3encoder = null;
    this.audioCtx = null;
    this.totalChunks = 0;
    this.processedChunks = 0;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.initialized = true;
    } catch (error) {
      console.error('Audio Context initialization error:', error);
      throw new Error('Failed to initialize audio processor');
    }
  }

  async processFile(file, statusCallback) {
    if (!this.initialized) {
      await this.init();
    }

    const chunks = [];
    this.totalChunks = Math.ceil(file.size / this.CHUNK_SIZE);
    this.processedChunks = 0;

    try {
      // Process the first chunk to get audio parameters
      const firstChunk = file.slice(0, this.CHUNK_SIZE);
      const firstArrayBuffer = await firstChunk.arrayBuffer();
      const firstAudioBuffer = await this.audioCtx.decodeAudioData(firstArrayBuffer);
      
      // Initialize MP3 encoder with correct parameters
      const channels = firstAudioBuffer.numberOfChannels;
      this.mp3encoder = new lamejs.Mp3Encoder(
        channels,
        firstAudioBuffer.sampleRate,
        320 // kbps
      );

      // Process first chunk
      const firstProcessedChunk = await this.encodeMp3Chunk(firstAudioBuffer);
      if (firstProcessedChunk) {
        chunks.push(firstProcessedChunk);
      }
      
      this.processedChunks++;
      if (statusCallback) {
        statusCallback((this.processedChunks / this.totalChunks) * 100);
      }

      // Process remaining chunks
      for (let start = this.CHUNK_SIZE; start < file.size; start += this.CHUNK_SIZE) {
        const chunk = file.slice(start, Math.min(start + this.CHUNK_SIZE, file.size));
        const processedChunk = await this.processChunk(chunk);
        if (processedChunk) {
          chunks.push(processedChunk);
        }
        
        this.processedChunks++;
        if (statusCallback) {
          statusCallback((this.processedChunks / this.totalChunks) * 100);
        }
      }

      // Finalize MP3
      const mp3Buf = this.mp3encoder.flush();
      if (mp3Buf.length > 0) {
        chunks.push(new Uint8Array(mp3Buf));
      }

      // Combine all chunks into a single blob
      return new Blob(chunks, { type: 'audio/mp3' });
    } catch (error) {
      console.error('Processing error:', error);
      throw error;
    } finally {
      // Cleanup
      if (this.audioCtx) {
        await this.audioCtx.close();
        this.audioCtx = null;
      }
      this.mp3encoder = null;
      this.initialized = false;
    }
  }

  async processChunk(chunk) {
    try {
      const arrayBuffer = await chunk.arrayBuffer();
      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      return await this.encodeMp3Chunk(audioBuffer);
    } catch (error) {
      console.error('Chunk processing error:', error);
      return null;
    }
  }

  async encodeMp3Chunk(audioBuffer) {
    const channels = audioBuffer.numberOfChannels;
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
    
    // Convert Float32Array to Int16Array
    const sampleLength = leftChannel.length;
    const left = new Int16Array(sampleLength);
    const right = new Int16Array(sampleLength);

    // Convert samples
    for (let i = 0; i < sampleLength; i++) {
      left[i] = this.convertSample(leftChannel[i]);
      right[i] = this.convertSample(rightChannel[i]);
    }

    // Encode to MP3 in smaller blocks
    const mp3Data = [];
    const blockSize = 1152; // Must be multiple of 576
    
    for (let i = 0; i < sampleLength; i += blockSize) {
      const leftChunk = left.subarray(i, i + blockSize);
      const rightChunk = right.subarray(i, i + blockSize);
      
      const mp3buf = this.mp3encoder.encodeBuffer(leftChunk, rightChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(new Uint8Array(mp3buf));
      }
    }

    return new Blob(mp3Data);
  }

  convertSample(sample) {
    // Clamp value between -1 and 1, then convert to 16-bit integer
    const clampedSample = Math.max(-1, Math.min(1, sample));
    return clampedSample < 0 ? 
      Math.max(-32768, Math.floor(clampedSample * 32768)) :
      Math.min(32767, Math.floor(clampedSample * 32767));
  }
}

// Update the processWithWebAudio function
async function processWithWebAudio(file) {
    try {
        const processor = new ChunkedAudioProcessor();
        
        statusText.textContent = 'Processing audio...';
        const processedBlob = await processor.processFile(file, (progress) => {
            statusText.textContent = `Processing: ${Math.round(progress)}%`;
        });
        
        return processedBlob;
    } catch (error) {
        console.error('Processing error:', error);
        throw new Error('Error processing audio: ' + error.message);
    }
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const blockAlign = numChannels * (bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * blockAlign;
  const bufferSize = 44 + dataSize;
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // Write WAV header
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
  view.setUint16(34, bitDepth, true);              
  writeString(view, 36, 'data');                   
  view.setUint32(40, dataSize, true);              

  // Write PCM data
  const offset = 44;
  const channelData = new Array(numChannels).fill(null).map((_, i) => buffer.getChannelData(i));
  
  for (let i = 0; i < buffer.length; i++) {
      for (let channel = 0; channel < numChannels; channel++) {
          const sample = Math.max(-1, Math.min(1, channelData[channel][i]));
          const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          view.setInt16(offset + (i * blockAlign) + (channel * 2), value, true);
      }
  }

  return arrayBuffer;
}

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const fileInput = document.getElementById('fileInput');
  const audioElement = document.getElementById('audio');
  const statusText = document.getElementById('status');
  const downloadBtn = document.getElementById('downloadBtn');
  const formatSelect = document.getElementById('formatSelect');
  const waveformCanvas = document.getElementById('waveformCanvas');
  const frequencyCanvas = document.getElementById('frequencyCanvas');
  const waveformBtn = document.getElementById('waveformBtn');
  const frequencyBtn = document.getElementById('frequencyBtn');
  const gainSlider = document.getElementById('gainSlider');
  const gainDisplay = document.getElementById('gainDisplay');

  // Audio Contexts
  let audioContext;
  let analyserNode;
  let sourceNode;
  let gainNode;
  let eqNodes = [];

  // Constants
  const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

  // Visualization state
  let isWaveformActive = true;
  let animationFrameId = null;
  let ffmpegLoaded = false;
  let ffmpeg = null;

  // Check for SharedArrayBuffer support and initialize FFmpeg
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
  
  if (hasSharedArrayBuffer) {
      try {
          const { createFFmpeg } = FFmpeg;
          ffmpeg = createFFmpeg({ 
              log: true,
              corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
          });
          
          await ffmpeg.load();
          ffmpegLoaded = true;
          console.log('FFmpeg loaded successfully');
          statusText.textContent = 'Ready (FFmpeg mode)';
      } catch (error) {
          console.error('FFmpeg load error:', error);
          statusText.textContent = 'Using Web Audio processing';
          // Update format select to show only supported formats
          formatSelect.innerHTML = `
              <option value="wav">WAV</option>
              <option value="mp3">MP3</option>
          `;
      }
  } else {
      console.log('SharedArrayBuffer not available, using Web Audio API');
      statusText.textContent = 'Ready (Web Audio mode)';
      // Update format select to show only supported formats
      formatSelect.innerHTML = `
          <option value="wav">WAV</option>
          <option value="mp3">MP3</option>
      `;
  }

  // Initialize audio context and nodes
  async function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 44100,
      });
      
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 2048;
      
      gainNode = audioContext.createGain();
      gainNode.gain.value = parseFloat(gainSlider.value);
      
      // Create EQ nodes
      const eqSliders = document.querySelectorAll('.eq-slider');
      eqNodes = Array.from(eqSliders).map(slider => {
        const filter = audioContext.createBiquadFilter();
        filter.type = 'peaking';
        filter.frequency.value = parseFloat(slider.dataset.frequency);
        filter.Q.value = 1;
        filter.gain.value = parseFloat(slider.value);
        return filter;
      });
    }
    return audioContext;
  }

  // Process large file in chunks
  async function processLargeFile(file) {
    if (!ffmpegLoaded) {
      throw new Error('Audio processor not ready');
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const outputFormat = formatSelect.value;
    
    // Create temporary file for FFmpeg processing
    const inputFileName = 'input' + (file.name.match(/\.[^.]+$/) || ['.tmp'])[0];
    const outputFileName = `output.${outputFormat}`;

    try {
      // Write file to FFmpeg virtual filesystem in chunks
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const arrayBuffer = await chunk.arrayBuffer();
        
        if (i === 0) {
          ffmpeg.FS('writeFile', inputFileName, new Uint8Array(arrayBuffer));
        } else {
          const existing = ffmpeg.FS('readFile', inputFileName);
          const combined = new Uint8Array(existing.length + arrayBuffer.byteLength);
          combined.set(existing);
          combined.set(new Uint8Array(arrayBuffer), existing.length);
          ffmpeg.FS('writeFile', inputFileName, combined);
        }

        statusText.textContent = `Loading: ${Math.round((end / file.size) * 100)}%`;
      }

      // Get current parameters
      const params = {
        noiseGate: document.getElementById('noiseGateThreshold').value,
        attack: document.getElementById('attackTime').value,
        release: document.getElementById('releaseTime').value,
        reduction: document.getElementById('reductionAmount').value,
        gain: gainSlider.value,
        eqBands: Array.from(document.querySelectorAll('.eq-slider')).map(slider => ({
          freq: slider.dataset.frequency,
          gain: slider.value
        }))
      };

      // Build FFmpeg filter complex string
      let filterComplex = `volume=${params.gain}dB,`;
      
      // Add equalizer bands
      const eqFilters = params.eqBands
        .map(band => `equalizer=f=${band.freq}:t=q:w=1:g=${band.gain}`)
        .join(',');
      filterComplex += eqFilters;

      // Add noise gate if threshold is set
      if (params.noiseGate > -100) {
        filterComplex += `,agate=threshold=${params.noiseGate}dB:ratio=${params.reduction}:attack=${params.attack}:release=${params.release}`;
      }

      // Process audio with FFmpeg
      statusText.textContent = 'Processing audio...';
      
      let outputOptions = [];
      switch (outputFormat) {
        case 'mp3':
          outputOptions = ['-c:a', 'libmp3lame', '-b:a', '320k'];
          break;
        case 'aac':
          outputOptions = ['-c:a', 'aac', '-b:a', '320k'];
          break;
        case 'ogg':
          outputOptions = ['-c:a', 'libvorbis', '-q:a', '7'];
          break;
        case 'wav':
          outputOptions = ['-c:a', 'pcm_s16le'];
          break;
        case 'mp4':
          outputOptions = ['-c:a', 'aac', '-b:a', '320k', '-f', 'mp4'];
          break;
      }

      await ffmpeg.run(
        '-i', inputFileName,
        '-af', filterComplex,
        ...outputOptions,
        outputFileName
      );

      const processedData = ffmpeg.FS('readFile', outputFileName);
      
      // Clean up
      ffmpeg.FS('unlink', inputFileName);
      ffmpeg.FS('unlink', outputFileName);

      return new Blob([processedData.buffer], { 
        type: `audio/${outputFormat === 'aac' || outputFormat === 'mp4' ? 'mp4' : outputFormat}` 
      });

    } catch (error) {
      console.error('Processing error:', error);
      throw error;
    }
  }

  // Visualization functions
  function drawWaveform() {
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteTimeDomainData(dataArray);

    const canvasCtx = waveformCanvas.getContext('2d');
    canvasCtx.fillStyle = 'rgb(26, 26, 26)';
    canvasCtx.fillRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgb(58, 134, 255)';
    canvasCtx.beginPath();

    const sliceWidth = waveformCanvas.width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * waveformCanvas.height / 2;

      if (i === 0) {
        canvasCtx.moveTo(x, y);
      } else {
        canvasCtx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    canvasCtx.lineTo(waveformCanvas.width, waveformCanvas.height / 2);
    canvasCtx.stroke();
  }

  function drawFrequency() {
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyserNode.getByteFrequencyData(dataArray);

    const canvasCtx = frequencyCanvas.getContext('2d');
    canvasCtx.fillStyle = 'rgb(26, 26, 26)';
    canvasCtx.fillRect(0, 0, frequencyCanvas.width, frequencyCanvas.height);

    const barWidth = (frequencyCanvas.width / bufferLength) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * frequencyCanvas.height;
      const gradient = canvasCtx.createLinearGradient(0, frequencyCanvas.height, 0, 0);
      gradient.addColorStop(0, 'rgb(58, 134, 255)');
      gradient.addColorStop(1, 'rgb(131, 56, 236)');
      canvasCtx.fillStyle = gradient;
      canvasCtx.fillRect(x, frequencyCanvas.height - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
  }

  function animate() {
    if (isWaveformActive) {
      drawWaveform();
    } else {
      drawFrequency();
    }
    animationFrameId = requestAnimationFrame(animate);
  }

  // Event Listeners
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    downloadBtn.disabled = true;
    statusText.textContent = 'Preparing...';
    statusText.className = 'loading';

    try {
      // Create object URL for preview
      const objectUrl = URL.createObjectURL(file);
      audioElement.src = objectUrl;
      
      // Initialize audio context and connect nodes
      await initAudioContext();
      sourceNode = audioContext.createMediaElementSource(audioElement);
      
      // Connect audio nodes
      sourceNode.connect(gainNode);
      let prevNode = gainNode;
      
      eqNodes.forEach(node => {
        prevNode.connect(node);
        prevNode = node;
      });
      
      prevNode.connect(analyserNode);
      analyserNode.connect(audioContext.destination);
      
      // Start visualization
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      animate();
      
      downloadBtn.disabled = false;
      statusText.textContent = 'Ready to process';
      statusText.className = 'success';
      
    } catch (error) {
      console.error('Audio setup error:', error);
      statusText.textContent = `Error: ${error.message}`;
      statusText.className = 'error';
    }
  });

  // // Check for SharedArrayBuffer support
  // let processingMethod = 'webAudio'; // Default to Web Audio API
  
  // // Try to initialize FFmpeg if SharedArrayBuffer is available
  // if (hasSharedArrayBuffer) {
  //   try {
  //     const { createFFmpeg } = FFmpeg;
  //     const ffmpeg = createFFmpeg({ 
  //       log: true,
  //       corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
  //     });
      
  //     await ffmpeg.load();
  //     processingMethod = 'ffmpeg';
  //     console.log('FFmpeg loaded successfully');
  //     statusText.textContent = 'Ready (FFmpeg mode)';
  //   } catch (error) {
  //     console.error('FFmpeg load error:', error);
  //     statusText.textContent = 'Using Web Audio processing';
  //   }
  // } else {
  //   console.log('SharedArrayBuffer not available, using Web Audio API');
  //   statusText.textContent = 'Ready (Web Audio mode)';
  // }

  // Function to encode audio buffer to MP3
  async function encodeToMp3(audioBuffer, bitrate = 320) {
    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
    
    // Convert to integer samples
    const samples = new Int16Array(audioBuffer.length * channels);
    for (let channel = 0; channel < channels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let i = 0; i < channelData.length; i++) {
        const index = i * channels + channel;
        samples[index] = channelData[i] < 0 ? 
          Math.max(-32768, Math.floor(channelData[i] * 32768)) :
          Math.min(32767, Math.floor(channelData[i] * 32767));
      }
    }

    // Encode to MP3
    const mp3Data = [];
    const blockSize = 1152; // must be multiple of 576
    
    for (let i = 0; i < samples.length; i += blockSize * channels) {
      const sampleChunk = samples.subarray(i, i + blockSize * channels);
      const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
      if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
      }
    }

    // Get the last part of MP3
    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
  }

  // Function to process audio using Web Audio API
  async function processWithWebAudio(file) {
    try {
        const processor = new ChunkedAudioProcessor();
        
        statusText.textContent = 'Processing audio...';
        const processedBlob = await processor.processFile(file, (progress) => {
            statusText.textContent = `Processing: ${Math.round(progress)}%`;
        });
        
        return processedBlob;
    } catch (error) {
        console.error('Processing error:', error);
        throw new Error('Error processing audio: ' + error.message);
    }
}

  // Modified download button handler
  downloadBtn.addEventListener('click', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    
    downloadBtn.disabled = true;
    statusText.textContent = 'Processing...';
    statusText.className = 'loading';

    try {
        let processedBlob;
        if (ffmpegLoaded && ffmpeg) {
            processedBlob = await processLargeFile(file);
        } else {
            processedBlob = await processWithWebAudio(file);
        }

        const url = URL.createObjectURL(processedBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `processed-audio.${formatSelect.value}`;
        link.click();
        
        URL.revokeObjectURL(url);
        statusText.textContent = 'Processing complete!';
        statusText.className = 'success';
    } catch (error) {
        console.error('Processing error:', error);
        statusText.textContent = `Error: ${error.message}`;
        statusText.className = 'error';
        
        // Handle out of memory error specifically
        if (error.message.includes('out of memory')) {
            statusText.textContent = 'File too large to process. Try a smaller file or use FFmpeg mode.';
        }
    } finally {
        downloadBtn.disabled = false;
    }
});

  // UI Control Listeners
  waveformBtn.addEventListener('click', () => {
    isWaveformActive = true;
    waveformCanvas.style.display = 'block';
    frequencyCanvas.style.display = 'none';
  });

  frequencyBtn.addEventListener('click', () => {
    isWaveformActive = false;
    waveformCanvas.style.display = 'none';
    frequencyCanvas.style.display = 'block';
  });

  gainSlider.addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    gainNode.gain.value = value;
    const dbValue = 20 * Math.log10(value);
    gainDisplay.textContent = `${value.toFixed(2)} (${dbValue.toFixed(2)} dB)`;
  });

  document.querySelectorAll('.eq-slider').forEach((slider, index) => {
    slider.addEventListener('input', (e) => {
      if (eqNodes[index]) {
        eqNodes[index].gain.value = parseFloat(e.target.value);
      }
    });
  });

  // Handle noise gate controls
  document.getElementById('noiseGateThreshold').addEventListener('input', (e) => {
    document.getElementById('thresholdDisplay').textContent = `${e.target.value} dB`;
  });

  document.getElementById('attackTime').addEventListener('input', (e) => {
    document.getElementById('attackDisplay').textContent = `${e.target.value}s`;
  });

  document.getElementById('releaseTime').addEventListener('input', (e) => {
    document.getElementById('releaseDisplay').textContent = `${e.target.value}s`;
  });

  document.getElementById('reductionAmount').addEventListener('input', (e) => {
    document.getElementById('reductionDisplay').textContent = `${e.target.value} dB`;
  });

  // Canvas resize handling
  function resizeCanvases() {
    const container = document.querySelector('.visualizer-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    [waveformCanvas, frequencyCanvas].forEach(canvas => {
      canvas.width = width;
      canvas.height = height;
    });
  }

  window.addEventListener('resize', resizeCanvases);
  resizeCanvases();
});