---
title: Web Worker i interakcje przeglądarki
format: markdown
---
Kod klienta działa w osobnym Web Workerze typu `module`. Nie ma dostępu do `window`, `document` ani elementów strony. Może korzystać z `fetch`, timerów, `postMessage` czy `OffscreenCanvas`, o ile pozwalają na to przeglądarka i polityka CSP.

Żeby dołączyć klienta, zwróć w widoku pole `client` wskazujące `client.ts` lub `client.js`. W części administracyjnej możesz też wskazać `admin.ts` lub `admin.js`. Kompilator łączy plik i jego zależności we wtyczkę ESM, udostępnianą pod adresem z kluczem wersji `?v=...`.

W komunikacji ze stroną pośredniczy **host** — część silnika działająca w głównym wątku przeglądarki. Przekazuje workerowi zdarzenia użytkownika i wykonuje jego polecenia zmieniające widok.

## Wiadomości host → worker

```ts
self.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'init') {
    // message.context: JSON z [data-context], nie serwerowy PluginContext
    // message.canvases: mapa przekazanych OffscreenCanvas
    // message.reducedMotion: ustawienie prefers-reduced-motion w chwili montowania
  }
  if (message.type === 'event' && message.action === 'next') {
    self.postMessage({ type: 'text', selector: '[data-status]', value: 'Gotowe' });
  }
});
```

| Element / zdarzenie | Wiadomość `type: 'event'` |
| --- | --- |
| Kliknięcie `[data-action]` | `action` z atrybutu, opcjonalne `value` z `data-value`; natywna akcja kliknięcia zostaje anulowana. |
| Zmiana pola `[data-change]` | `action` z atrybutu i tekstowe `value` aktualnej wartości. Nie wysyła całego formularza. |
| Klawisz we wtyczce | `action: 'key', key`; Enter/Spacja na `[data-action][role=button]` wykonuje jego akcję. |
| Zamknięcie dialogu Escape | `action: 'cancel'`. |
| Pointer na `canvas[data-canvas]` | `action: 'pointerdown'/'pointermove'/'pointerup'`, nazwa `canvas`; down/move dodatkowo `point: [x,y]` w pikselach bitmapy, przycięte do granic. |

Zdarzenie `pointermove` jest wysyłane tylko wtedy, gdy wskaźnik pozostaje wciśnięty. `pointercancel` i `lostpointercapture` kończą tę akcję. Element `canvas[data-canvas="surface"]` trafia do workera jako `init.canvases.surface`, żeby worker mógł go renderować. Jeśli przeglądarka nie obsługuje OffscreenCanvas, wtyczka wyświetli komunikat błędu.

## Wiadomości worker → host

Host wyszukuje elementy tylko wewnątrz sekcji danej wtyczki. Selektor może mieć do 200 znaków, a jedno polecenie obejmuje najwyżej 30 pasujących elementów. Nie można zmieniać komunikatu błędu wyświetlanego przez silnik ani elementów, które go otaczają.

| `type` | Dodatkowe pola i działanie |
| --- | --- |
| `text` | `selector`, `value: string` do 20 000 znaków, ustawia `textContent`, nie HTML. |
| `hidden` | `selector`, `value: boolean`, przełącza `hidden`. |
| `class` | `selector`, `name` (mała litera, potem litery/cyfry/myślniki, do 64 znaków), `value: boolean`. |
| `style` | `selector`, `name`, `value: string` krótsze niż 200 znaków, bez `url`/`expression`. |
| `attribute` | `selector`, `name`, `value: string` krótsze niż 2000 znaków. |
| `dialog` | `selector` wskazujący `<dialog>`, `value: boolean`; `showModal()` lub `close()`. |
| `list` | `selector`, `items: [{tag, text}]`, zastępuje zawartość elementu. Do 1000 elementów, tekst do 1000 znaków. Tagi: `li`, `p`, `span`, `div`. |
| `query` | `name`, `value`: zmienia parametr bieżącego URL i uruchamia nawigację silnika. Bez selektora. Nazwa `[a-z0-9_-]` do 64 znaków, wartość do 200. |

Dozwolone style: `transform`, `width`, `height`, `left`, `top`, `opacity`, `pointer-events`, `transition-duration`.

Dozwolone atrybuty to `src`, `href`, `alt`, `title`, `download`, `aria-*` i `tabindex`. Wartości `src` i `href` muszą zaczynać się od pojedynczego `/`, nie `//`.

Host nie pozwala ustawiać `innerHTML`, wykonywać dowolnego JavaScript, zmieniać wartości pól formularza ani tworzyć elementów spoza listy obsługiwanych tagów. Jeśli potrzebujesz większej zmiany widoku, użyj polecenia `query`: silnik pobierze widok ponownie z serwera. W panelu takie przejście przeładowuje całą stronę, zamiast doładowywać samą treść.

## Fetch

Worker może wysyłać żądania `fetch` do tras wtyczki. Przekaż mu `basePath: context.basePath` w danych klienta, żeby nie wpisywać adresu strony na stałe. Dzięki temu wtyczka zadziała także po przypisaniu do innej strony:

```ts
const response = await fetch(basePath + '/api/save', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ value: 42 }),
});
if (!response.ok) throw new Error('Zapis nie powiódł się');
const result = await response.json();
```

W administracji dołącz token CSRF i parametr `path` — szczegóły znajdziesz w [opisie administracji](/plugins/admin). Obsłuż błąd połączenia, niepoprawną odpowiedź JSON i przekroczenie czasu oczekiwania. Jeśli pozwalasz ponowić zapis, zadbaj o to, żeby nie wykonał się dwukrotnie.

Worker działa w tej samej domenie co strona. Ograniczenia komunikacji z DOM nie chronią przed celowo szkodliwym kodem, więc uruchamiaj tylko wtyczki od zaufanych autorów.

## Cykl życia i błędy

Host co sekundę sprawdza, czy worker odpowiada, wysyłając ping. Obsługa odpowiedzi `__pong` jest dodawana automatycznie podczas kompilacji. Jeśli na widocznej stronie worker nie odpowie przez ponad 6 sekund, zostanie zatrzymany. W nieaktywnej karcie przeglądarka może spowalniać timery, dlatego wtedy ten limit nie jest egzekwowany.

Worker może wysłać do 240 wiadomości na sekundę, łącznie z odpowiedziami na ping. Błąd, niepoprawne polecenie lub przekroczenie limitu zatrzymuje wtyczkę i wyświetla komunikat. Menu strony pozostaje dostępne.

Przy zmianie strony oraz zdarzeniu `pagehide` host zatrzymuje workera, usuwa obsługę zdarzeń i zamyka dialogi. Kolejne wejście uruchamia osobną instancję — zmienne klienta nie służą do trwałego przechowywania danych.

W asynchronicznych pętlach obsługuj błędy i ograniczaj kosztowne obliczenia. Osobny wątek nie zwalnia wtyczki z dbania o zużycie procesora, GPU i pamięci.
