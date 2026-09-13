---
title: PluginContext oraz adresy URL
format: markdown
---
Przy każdym żądaniu silnik przygotowuje `PluginContext` i przekazuje jego kopię do workera backendowego. Znajdziesz w nim adres żądania, dane strony i ścieżki potrzebne do pracy z plikami. Zawiera wyłącznie dane, bez funkcji i obiektów obsługujących połączenie HTTP. Nie trafia automatycznie do przeglądarki.

| Pole | Zawartość |
| --- | --- |
| `url: string` | Ścieżka żądania wraz z parametrami po `?`, bez protokołu i hosta. |
| `method: string` | Metoda HTTP, np. `GET`, `HEAD`, `POST`. |
| `body: unknown` | Odczytana treść żądania albo `null`. Wtyczka musi sprawdzić jej typ i poprawność. |
| `suffix: string` | Część ścieżki po adresie przypisanej strony lub części administracyjnej wtyczki. Dla głównego adresu jest pusta; dla dodatkowej trasy może wynosić np. `/api/save`. |
| `basePath: string` | Publicznie: adres przypisanej strony. W panelu: `/panel/plugins/<nazwa>`. Bez query string. |
| `language: string` | Język oczekiwanej odpowiedzi, wybrany przez `?lang=` albo zapamiętany wybór użytkownika. Wtyczka samodzielnie dobiera swoje tłumaczenia. |
| `defaultLanguage: string` | Domyślny język ustawiony dla całej strony. Przydaje się jako fallback tłumaczeń wtyczki. |
| `page` | Metadane i treść zapisanej strony, opis poniżej. |
| `content.source: string` | Dokładna treść Markdown/HTML bez front matter YAML. |
| `content.html: string` | Treść po renderowaniu Markdown do HTML, albo HTML w formacie `html`. |
| `content.format` | `markdown` albo `html`. |
| `mode` | `public` albo `admin`, ustalone przez silnik, nigdy przez query/body. |
| `admin` | `null` publicznie; w panelu `{ login, role, csrf }`. `role`: `owner` lub `admin`. |
| `assets` | Słownik wersjonowanych adresów plików z katalogu `assets/`, indeksowany ścieżką względną, np. `assets['images/logo.webp']`. |
| `pluginDir` | Absolutna ścieżka `content/plugins/<nazwa>`. |
| `contentRoot` | Absolutna ścieżka podmontowanego katalogu z treścią. |
| `storageDir` | Absolutna ścieżka `content/state/<nazwa>`; wtyczka tworzy katalog w razie potrzeby. |

## Dane strony (`page`)

Obiekt zawiera pola: `href`, `title`, `keywords`, `order`, `plugin`, `pluginPlacement`, `format`, `published`, `showSubpages`, `showPrint`, `showPdf`, `galleryVisibility`, `gallery`, `html`, `source` i `sourceFile`. Ścieżka w `sourceFile` jest liczona od katalogu `pages`.

Możesz dodać własne pola do metadanych YAML. Wtyczka otrzyma je w `page`, ale sama musi sprawdzić ich typ i poprawność. Pola `href`, `html` i `source` ustala silnik.

Na publicznej stronie `page.gallery` zawiera zdjęcia zgodne z ustawieniami widoczności, uzupełnione o wymiary. W panelu zawiera wszystkie zapisane zdjęcia. Każde zdjęcie ma pola `src`, `thumbnail` i `alt`, a opcjonalnie także `download`. W trybie publicznym może mieć również `width` i `height`.

Zmiany w `context` nie zapisują się do pliku strony ani do innych plików. Zmienne globalne wtyczki mogą natomiast przetrwać między żądaniami. Nie przechowuj w nich sesji, tokenów CSRF ani danych użytkowników.

## Routing publiczny

Dla przypisania wtyczki do `/tools/report`:

| Adres żądania | `page.href` / `basePath` | `suffix` |
| --- | --- | --- |
| `/tools/report?filter=active` | `/tools/report` | `""` |
| `/tools/report/api/save?filter=active` | `/tools/report` | `/api/save` |
| `/tools/report/history/2026` | `/tools/report` | `/history/2026` |

Silnik najpierw szuka strony o podanym adresie. Jeśli jej nie znajdzie, sprawdza kolejne strony nadrzędne i wybiera najbliższą z przypisaną wtyczką. Dzięki temu podstrona zapisana w pliku ma pierwszeństwo przed trasą dynamiczną o tym samym adresie. Jeśli strona lub którakolwiek z jej stron nadrzędnych jest niepublikowana, dostęp zostaje zablokowany przed uruchomieniem wtyczki.

Pod adresem `/` silnik wyświetla samo tło i menu, chyba że w konfiguracji ustawiono stronę startową. Dokumentacja używa `site.home: /start`, więc wejście na `/` przekierowuje do `/start`.

Silnik dekoduje ścieżkę URL i przekierowuje adresy z końcowym `/` na adres bez niego (z wyjątkiem samego `/`). Zanim użyjesz `suffix` do wybrania pliku, sprawdź, czy ma dozwoloną wartość. Ścieżki `/panel`, `/assets`, `/plugin-assets`, `/media` i `/healthz` są zarezerwowane dla silnika.

```ts
const url = new URL(context.url, 'http://plugin.invalid');
const filter = url.searchParams.get('filter') ?? 'all';
if (!/^(all|active|archived)$/.test(filter)) {
  return { type: 'json', status: 400, data: { error: 'Nieprawidłowy filtr' } };
}
```

Adres `http://plugin.invalid` służy tu wyłącznie do odczytania względnego URL przez `new URL()`. Nie jest adresem serwera. Kontekst nie zawiera rzeczywistego hosta, nagłówków, cookies ani adresu IP. Fragment po `#` nie jest wysyłany do backendu.

## Routing administracyjny

Adres `/panel/plugins/example?path=%2Ftools%2Freport` ma pusty `suffix`, a `/panel/plugins/example/save?path=%2Ftools%2Freport` ma `suffix` równy `/save`. Każde żądanie musi zawierać parametr `path` z adresem zapisanej strony, do której przypisano tę wtyczkę. Strona nie musi być opublikowana.

W tym przykładzie `context.url` zawiera adres panelu, `basePath` wynosi `/panel/plugins/example`, a `page.href` wskazuje `/tools/report`. Parametr `path` wybiera stronę przypisaną do wtyczki, nie dowolny plik na dysku. Dodanie `mode=admin` lub `admin=true` do publicznego adresu nie daje uprawnień administratora.

## Treść żądania i odpowiedzi

Publiczne trasy obsługują JSON i tekst zgodnie z parserami Fastify. Obsługa formularzy URL-encoded i multipart jest włączona tylko w panelu. Limit treści żądania wynosi 150 000 bajtów dla tras publicznych i 300 000 bajtów dla tras administracyjnych wtyczki. API zdjęć w panelu ma osobne limity.

`PluginContext` nie udostępnia `request.file()`. Jeśli wtyczka ma przyjmować pliki, zaprojektuj przesyłanie ich w obsługiwanym formacie, np. jako JSON z odpowiednim limitem rozmiaru, albo skorzystaj z galerii silnika.

Odpowiedź JSON ma postać `{ type: 'json', status: 200, data: {...} }`. Pole `status` domyślnie wynosi 200 i przyjmuje wartości od 200 do 599. Odpowiedź wtyczki nie pozwala ustawiać własnych nagłówków i cookies ani zwracać strumieni, plików binarnych czy przekierowań z nagłówkiem `Location`.

Żądania `HEAD` obsługuj bez zapisywania danych i innych efektów ubocznych. Silnik HTTP pomija w nich treść odpowiedzi.
