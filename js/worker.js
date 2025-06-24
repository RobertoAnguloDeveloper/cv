// In worker.js
importScripts('/js/processors/processor.js');

let processor = null;

self.onmessage = async function(e) {
  if (!processor) {
    processor = new AudioProcessor();
  }

  switch (e.data.type) {
    case 'init':
      processor.setParams(e.data.params);
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