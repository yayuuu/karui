---
title: Treść statyczna i szablony Edge
format: markdown
---
## Bloki kodu Markdown

Blok kodu otocz trzema znakami backtick (`` ` ``). Po znakach otwierających wpisz nazwę języka, np. `ts`, `js`, `json`, `yaml`, `sh`, `html`, `css`, `python`, `sql` lub `edge`. Biblioteka **highlight.js** pokoloruje składnię zarówno na stronie, jak i w dokumentacji:

````markdown
```ts
const message = "Hello world";
console.log(message);
```
````

Wynik:

```ts
const message = "Hello world";
console.log(message);
```

Nazwa `edge` włącza reguły HTML/Handlebars, które rozpoznają znaczniki i wyrażenia w klamrach. Jeśli pominiesz język, podasz nieznaną nazwę albo użyjesz `text` lub `plaintext`, blok zachowa ramkę, ale nie będzie kolorowany. Silnik nie rozpoznaje języka automatycznie. Pomija też kolorowanie bloków dłuższych niż 50 000 znaków, żeby nie spowalniać renderowania strony.

Kolory kodu dopasowują się do jasnego lub ciemnego motywu. Długie linie możesz przewijać wewnątrz bloku, również na telefonie; na wydruku zostaną zawinięte. HTML i JavaScript zapisane w bloku są wyświetlane jako tekst, a nie wykonywane.

Kolorowanie odbywa się na serwerze podczas odświeżania cache treści. Nie wymaga dodatkowej biblioteki w przeglądarce, działa bez JavaScript i przy doładowywaniu podstron. Nie zmienia też zapisanego źródła Markdown.

W `context.content.html` bloki są już pokolorowane. Ta funkcja nie obejmuje stron z ustawionym `format: html`, ręcznie wstawionego HTML ani kodu wewnątrz zdania. Edytor zapisuje treść bez znaczników dodawanych przy kolorowaniu.

## Tabele Markdown

Tabelę zapisz standardową składnią Markdown. Silnik doda wyróżniony nagłówek, obramowanie i delikatne tło co drugiego wiersza, dopasowane do wybranego motywu. Wygląd jest wspólny dla strony i dokumentacji. Szeroką tabelę można przewijać poziomo, także dotykiem i klawiaturą, bez rozciągania całej strony.

```markdown
| Opcja | Stan | Liczba |
| :--- | :---: | ---: |
| `cache` | **Aktywny** | 8 |
| Wtyczki | Opcjonalne | 16 |
```

| Opcja | Stan | Liczba |
| :--- | :---: | ---: |
| `cache` | **Aktywny** | 8 |
| Wtyczki | Opcjonalne | 16 |

Dwukropki w wierszu pod nagłówkiem określają wyrównanie kolumn: do lewej, do środka lub do prawej. W komórkach możesz umieszczać linki, pogrubienia i kod. Pionową kreskę zapisz jako `\|`, żeby nie została potraktowana jako granica kolumny.

Wynik to tabela HTML z nagłówkami, działająca bez JavaScript. Nie ma sortowania ani podziału na strony. Style są dodawane tylko do tabel zapisanych w Markdown; ręcznie wstawiony HTML i plik źródłowy pozostają bez zmian. Wtyczka otrzymuje gotową tabelę w `context.content.html`. Na wydruku jej zawartość jest zawijana, żeby nie została obcięta.

## Wspólny wygląd elementów

Silnik ładuje `ui.css` na każdej stronie, również w panelu i dokumentacji. Pola tekstowe, przyciski, selecty, pola wyboru, `fieldset`, `details`, cytaty i separatory mają domyślne style pasujące do wybranego motywu. Reguły bazowe mają niską specyficzność, więc wtyczka może dostosować układ bez `!important`.

Sekcja `<section>` sama w sobie nie dostaje ramki ani tła. Do budowania widoków służą wspólne klasy:

| Klasa | Zastosowanie |
| --- | --- |
| `ui-section` | Przezroczysta sekcja dziedzicząca kolor tekstu. |
| `ui-section-heading` | Nagłówek sekcji. Rozmiar można dobrać do widoku. |
| `ui-surface` | Przezroczysty blok z odstępami, cienką ramką i zaokrągleniami. |
| `ui-badge` | Mała etykieta z akcentem motywu. |
| `ui-empty` | Komunikat o braku zawartości. |
| `ui-notice` | Komunikat z wyróżnioną krawędzią. |

```html
<section class="ui-section ui-surface">
  <h2 class="ui-section-heading">Zadania <span class="ui-badge">Dzisiaj</span></h2>
  <p class="ui-empty">Nie masz zaplanowanych zadań.</p>
</section>
```

We własnym CSS korzystaj z `--ui-accent` (akcent), `--ui-muted` (tekst pomocniczy), `--ui-line` (ramka), `--ui-rule` (delikatny separator), `--ui-tint` (przezroczyste tło akcentu) i `--ui-radius` (zaokrąglenie). Kolory kontrolek to `--ui-control-bg`, `--ui-control-text` i `--ui-control-border`; stany interakcji używają `--ui-hover` oraz `--ui-active`. Dzięki tym zmiennym przełączenie motywu zmienia też wygląd wtyczki, bez dodatkowego JavaScriptu.

## Położenie wtyczki względem treści

W edytorze strony wybierz wtyczkę, a następnie ustaw „Położenie wtyczki względem treści”. W pliku strony odpowiada za to pole YAML `pluginPlacement`:

| `pluginPlacement` | Zachowanie |
| --- | --- |
| `after` | Domyślny układ: tekst, galeria, lista podstron, wtyczka. |
| `before` | Tytuł strony, wtyczka, tekst, galeria, lista podstron. |
| `content` | Wtyczka otrzymuje tekst w `context.content` i decyduje, jak go wykorzystać. Silnik nie wyświetla tekstu osobno. Galeria i lista podstron mają własne ustawienia i pojawiają się przed wtyczką. |

Wtyczka ma dostęp do treści w każdym z tych trybów. Ustawienie `content` zmienia tylko sposób jej wyświetlania. Jeśli do strony nie przypisano wtyczki, silnik wyświetla tekst niezależnie od wartości tego pola.

Nagłówek strony wyświetla silnik. Wybrany układ obowiązuje przy bezpośrednim wejściu, doładowaniu podstrony i drukowaniu; nie wpływa na odpowiedzi JSON.

W `context.content.source` jest źródło bez YAML; w `context.content.html` gotowy HTML. Wtyczka może pominąć tekst, wstawić go do własnego widoku, dzielić albo zastępować własne znaczniki. Przykład bez ponownego parsowania Markdown:

```ts
const escape = (text: string) => text.replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const html = context.content.html.replaceAll('[[notice]]', escape('Wiadomość z wtyczki'));
return { type: 'view', template: 'views/public.edge', data: { html } };
```

W widoku wstaw wynik przez `{{{ html }}}`. Potrójne klamry pozwalają wyświetlić HTML bez zamieniania znaczników na tekst. Nie przekazuj w ten sposób niesprawdzonych wartości z parametrów URL lub treści żądania. Parser Markdown dopuszcza ręcznie wstawiony HTML i nie usuwa niebezpiecznych znaczników — treść strony i kod wtyczki muszą pochodzić od zaufanych autorów.

## Widoki lokalne

Handler zwraca np.:

```ts
return {
  type: 'view',
  template: 'views/public.edge',
  data: { title: context.page.title, items: ['A', 'B'] },
  client: 'client.ts',
  styles: 'style.css',
};
```

Silnik wyszukuje pliki `.edge` w katalogu wtyczki i jego podkatalogach. W polu `template` podaj ścieżkę od katalogu wtyczki, razem z rozszerzeniem `.edge`. Nazwy katalogów i plików mogą zawierać litery ASCII, cyfry, `_` i `-`. Ścieżki absolutne oraz `..` są niedozwolone. Silnik pomija ukryte katalogi, `node_modules` i dowiązania symboliczne; korzystać można tylko z zarejestrowanych widoków.

Opcjonalne pole `status` ustawia kod HTTP wyrenderowanego widoku. Dzięki temu wtyczka może pokazać błąd we wspólnym kontenerze strony, a jednocześnie zwrócić właściwy kod, na przykład `{ type: 'view', template: 'views/not-found.edge', status: 404 }`. Bez tego pola widok zwraca 200.

Zmienne widoku pochodzą z obiektu `data` zwróconego przez handler. Szablon nie dostaje automatycznie `context`, `page`, ścieżek serwera ani danych sesji i CSRF. Przekaż do niego tylko to, czego potrzebuje:

```edge
<h2>{{ title }}</h2>
@include('views/partials/list')
```

Plik `views/partials/list.edge`:

```edge
<ul>
  @each(item in items)
    <li>{{ item }}</li>
  @end
</ul>
```

W `@include` podaj ścieżkę bez rozszerzenia, liczoną od głównego katalogu wtyczki, a nie od pliku z tym poleceniem. Możesz używać warunków, pętli, komponentów, slotów i pozostałych dyrektyw Edge.

Worker wtyczki korzysta z osobnej instancji Edge i nie ma dostępu do widoków silnika strony. Handler nie może rejestrować globalnych zmiennych ani funkcji pomocniczych Edge. Potrzebne obliczenia wykonaj przed zwróceniem widoku, a wyniki przekaż w `data`.

## Przekazanie danych klientowi

Umieść wewnątrz widoku pojedynczy element:

```edge
<div data-context="{{ JSON.stringify(clientContext) }}">
  <button type="button" data-action="next">Dalej</button>
</div>
```

`clientContext` to obiekt z danymi przeznaczonymi dla przeglądarki, przygotowany przez handler. Użyj podwójnych klamer, aby Edge zabezpieczył znaki specjalne w atrybucie HTML. Silnik odczyta JSON z pierwszego elementu `[data-context]` we wtyczce i przekaże go Web Workerowi jako `init.context`. Jeśli nie znajdzie tego elementu, przekaże `{}`.

Nie wysyłaj całego `PluginContext` do przeglądarki: zawiera ścieżki serwera, a w trybie administracyjnym również dane sesji.

## CSS i statyczne zasoby

Zwróć `styles: 'style.css'`, żeby dołączyć arkusz stylów z adresem przypisanym do wersji wtyczki. W administracji możesz też wskazać `admin.css`.

Style nie są automatycznie izolowane. Poprzedzaj selektory własną klasą, np. `.example-plugin button`, żeby nie zmieniać wyglądu menu lub panelu.

Obrazy, fonty, dokumenty i inne pliki publiczne umieść w katalogu `assets/` wtyczki. Przy kompilacji silnik kopiuje je do wersjonowanego katalogu `CONTENT_CACHE_DIR/plugins/public`. Widok Edge automatycznie otrzymuje słownik `pluginAssets`, a backend ten sam słownik jako `context.assets`:

```edge
<img src="{{ pluginAssets['images/logo.webp'] }}" alt="Logo">
<a href="{{ pluginAssets['documents/manual.pdf'] }}">Instrukcja</a>
```

```ts
const logoUrl = context.assets['images/logo.webp'];
```

Nie składaj adresu ręcznie. Wersjonowany URL zawiera nazwę wtyczki i klucz skompilowanego artefaktu. W widoku administracyjnym `pluginAssets` wskazuje chronioną trasę panelu, a w widoku publicznym trasę publiczną. Dzięki temu oba widoki mogą korzystać z tego samego szablonu.

W CSS odwołuj się do katalogu źródłowego względnie. Kompilator zamieni adres na wersjonowany:

```css
.example-plugin { background-image: url("./assets/images/background.webp"); }
```

Ścieżki zewnętrzne, adresy `/media/...`, `data:` oraz odwołania spoza `assets/` pozostają bez zmian. `@import` nie jest dołączany automatycznie.

Katalog może zawierać maksymalnie 512 plików. Jeden plik może mieć do 32 MiB, a całość do 128 MiB. Nazwy segmentów ścieżki mogą zawierać litery ASCII, cyfry, kropki, `_` i `-`; cała ścieżka może mieć do 240 znaków. Ukryte pliki i katalogi oraz dowiązania symboliczne są pomijane. Brak pliku wskazanego przez `url("./assets/...")` zatrzymuje kompilację danej wersji zamiast publikować uszkodzony CSS.

Wszystko umieszczone w `assets/` traktuj jako publiczne. Nie zapisuj tam konfiguracji, kodu źródłowego, kluczy ani danych użytkowników. Po zmianie pliku zwiększ `version` w `plugin.json`; stary, otwarty dokument zachowa adres poprzedniego snapshotu.

Skrypt klienta dołączaj przez pole `client`, nie przez znacznik `<script>` w HTML. Polityka CSP blokuje takie skrypty w treści widoku.

Przez publiczne adresy wtyczki można pobrać tylko skompilowany kod `client.ts`/`client.js`, plik `style.css` oraz snapshot plików z `assets/`. Kod backendu (`index.ts`), manifest, szablony i `node_modules` nie są udostępniane przez HTTP. Pliki `admin.ts`/`admin.js` i `admin.css` są dostępne wyłącznie przez chronione trasy panelu.
