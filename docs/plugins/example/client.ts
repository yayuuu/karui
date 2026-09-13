let count = 0, label = '';
self.addEventListener('message', event => {
  if (event.data.type === 'init') label = event.data.context.label;
  if (event.data.type === 'event' && event.data.action === 'click') {
    self.postMessage({ type: 'text', selector: '[data-local-count]', value: `${label}: ${++count}` });
  }
});
export {};
