type Values = Record<string, string | number>;
let messages: Record<string, string> | undefined;

function catalog() {
  if (messages) return messages;
  const source = document.querySelector<HTMLElement>('[data-panel][data-translations]')?.dataset.translations ?? document.body.dataset.translations;
  try { messages = JSON.parse(source ?? '{}'); } catch { messages = {}; }
  return messages;
}

export function t(message: string, values?: Values) {
  const translated = catalog()![message] ?? message;
  return values ? translated.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => values[key] === undefined ? match : String(values[key])) : translated;
}
