let config: { endpoint: string; csrf: string } | undefined;
let busy = false;
self.addEventListener('message', async event => {
  if (event.data.type === 'init') { config = event.data.context; return; }
  if (event.data.type !== 'event' || event.data.action !== 'increment' || !config || busy) return;
  busy = true;
  try {
    const response = await fetch(config.endpoint, {
      method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': config.csrf }, body: '{}',
    });
    if (!response.ok) throw new Error(`Nie udało się zapisać (${response.status}). Odśwież panel, jeśli sesja wygasła.`);
    const data = await response.json();
    self.postMessage({ type: 'text', selector: '[data-count]', value: String(data.count) });
    self.postMessage({ type: 'text', selector: '[data-save-status]', value: 'Zapisano licznik.' });
  } catch (error) {
    self.postMessage({ type: 'text', selector: '[data-save-status]', value: String(error) });
  } finally { busy = false; }
});
export {};
