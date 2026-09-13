---
title: Motywy
format: markdown
showSubpages: false
---

Motyw określa wygląd całej strony, także panelu administracyjnego. Nie jest wtyczką przypisaną do konkretnej podstrony. Może zawierać szablony Edge, style, obrazki oraz kod uruchamiany w przeglądarce.

## Wybór motywu

W panelu otwórz **Ustawienia strony**, wybierz motyw i zapisz. Ten sam wybór możesz zapisać w `site.yml`:

```yaml
title: Moja strona
theme: example
menu: []
```

W tej samej zakładce ustawisz również stronę startową oraz dane używane przez motyw domyślny:

```yaml
title: Moja strona
home: /aktualnosci
language: pl
description: Krótki opis witryny
brandName: Nazwa marki
tagline: Dodatkowy tekst w nagłówku
logo: /media/logo.png
favicon: /media/favicon.png
showBrandName: true
footerFormat: markdown
footer: |
  © 2026 **Nazwa marki** · [Kontakt](/kontakt)
```

`title` trafia do tytułu dokumentu, `language` do atrybutu `lang`, a `description` do metadanych strony. `brandName`, `tagline` i `logo` tworzą nagłówek. Logo i favicon mogą wskazywać plik pod `/media/` albo bezwzględny adres HTTPS. Stopka przyjmuje Markdown lub HTML, zależnie od `footerFormat`. Motyw domyślny obsługuje wszystkie te pola; własny motyw decyduje, które z nich wykorzysta i gdzie je pokaże.

`site.yml` zawsze pozostaje główną konfiguracją. Dla każdego dodatkowego języka plik `site.<język>.yml` może nadpisać wyłącznie `title`, `description`, `brandName`, `tagline` oraz `footer`. Selektor języka w panelu przełącza edytowany plik i blokuje pola wspólne, takie jak motyw, strona startowa, logo, lista języków i format stopki. Brak przetłumaczonej wartości powoduje użycie danych z `site.yml`.

Bez pola `theme` używany jest motyw `default` z katalogu `karui/templates/` silnika. Nie wymaga katalogu motywów w treściach. Pusty katalog treści pokazuje stronę powitalną Karui; kolejne strony dodasz w panelu. Dokumentacja również korzysta z motywu domyślnego.

## Utworzenie własnego szablonu

Polecenie eksportuje kompletny motyw domyślny, który można swobodnie zmieniać. Uruchom je w terminalu kontenera lub katalogu projektu:

```bash
npm run create-template
```

Program zapyta o nazwę i zapisze pliki w `content/templates/<nazwa>`. Nazwa używa małych liter, cyfr i myślników. Do automatyzacji można przekazać ją jako argument: `npm run create-template -- firmowy`.

Wyeksportowany szablon pojawi się w **Ustawieniach strony** na tej samej liście co motywy z `content/themes`. Oba katalogi mają ten sam format i sposób kompilacji. Nie używaj tej samej nazwy w obu katalogach. Polecenie nigdy nie nadpisuje istniejącego szablonu.

## Pliki motywu

```text
content/
  site.yml
  themes/
    example/
      theme.json
      client.ts
      client/
        controls.tsx
      templates/
        components/layout.edge
        partials/home.edge
      assets/
        site.css
        images/logo.svg
  templates/
    firmowy/
      theme.json
      templates/
      assets/
```

Wymagany jest tylko `theme.json`:

```json
{
  "name": "Example",
  "version": "1.0.0",
  "description": "Krótki opis wyglądu."
}
```

Identyfikator motywu pochodzi z nazwy katalogu pod `content/themes` albo `content/templates`. Używaj małych liter, cyfr i myślników, maksymalnie 64 znaków. `default` jest nazwą zarezerwowaną dla motywu silnika. `version` jest obowiązkowe; zmieniaj je przy publikacji zmian szablonów, stylów lub skryptów.

Szablony i zasoby zastępują pliki domyślne o tej samej ścieżce. Brakujące pliki są dziedziczone: możesz zmienić samo `assets/site.css`, zachowując formularze panelu i wszystkie widoki silnika.

## Szablony i zasoby

W Edge dostępny jest obiekt `theme`:

| Pole | Znaczenie |
| --- | --- |
| `name` | Identyfikator katalogu, np. `example` |
| `label` | Nazwa z manifestu |
| `version` | Wersja z manifestu |
| `key` | Klucz skompilowanego zestawu |
| `assets` | Mapa względnych nazw plików na publiczne adresy |
| `client` | Adres pakietu przeglądarkowego albo pusty tekst |

```edge
<link rel="stylesheet" href="{{ theme.assets['site.css'] }}">
<img src="{{ theme.assets['images/logo.svg'] }}" alt="Logo">
```

W CSS używaj ścieżek względem arkusza, np. `url("images/logo.svg")`. W `client.ts` adres obrazka można uzyskać przez `new URL('./images/logo.svg', import.meta.url)`: wynikowy pakiet `client.js` leży w tym samym katalogu publicznym co `site.css`.

Publikowane jest wyłącznie `assets/` oraz wynik kompilacji `client.ts`. Nie są publikowane źródła TypeScript, manifest ani szablony Edge. Dowiązania symboliczne w drzewie zasobów są pomijane. Nazwy plików mogą zawierać litery ASCII, cyfry, kropki, myślniki i podkreślenia; bez spacji, ścieżek `..` i ukrytych plików. Limit wynosi 1024 pliki i 128 MiB na drzewo, 32 MiB na plik. Pakiet JavaScript może mieć do 4 MB.

## Układ zgodny z silnikiem

Najprościej odziedziczyć `components/layout.edge` i zmienić CSS. Jeśli zastępujesz układ, zachowaj punkty zaczepienia:

- `.site-shell` — wspólny rodzic treści i nawigacji;
- `#page` — kontener treści, z `tabindex="-1"` i tytułem strony w `aria-label`;
- `#menu` oraz widoki `partials/menu` i `partials/submenu` — nawigacja wraz z danymi drzewa mobilnego;
- `data-theme`, `data-theme-client`, `data-asset-version` i `data-print` na `body`;
- skrypt `/assets/main.js?v={{ assetVersion }}` oraz style dla bieżącej strony (`styleUrl` i CSS galerii).

`partials/page-content.edge` składa treść, wtyczkę, galerię i podstrony. `partials/home.edge` odpowiada za stronę główną. Motyw może pozostawić ten ostatni widok pusty, jeśli jego layout nie pokazuje kontenera na stronie głównej. Nawigacja obsługuje taki wariant bez przeładowania dokumentu.

Silnik udostępnia w widoku `site`, `page`, `submenu`, `children`, `back`, `home`, `print`, `styleUrl`, `assetVersion` oraz dane wtyczki. Dokładne kontrakty i atrybuty znajdziesz w domyślnych szablonach. Zachowaj je, jeśli nadpisujesz galerię lub panel: to interfejs pomiędzy HTML a kodem silnika.

## Kod przeglądarkowy i przejścia

Opcjonalny `client.ts` jest pakowany przez esbuild jako moduł ESM. Możesz importować pliki `.ts` i `.tsx`, używać Preact oraz zależności dostępnych w silniku lub własnym `node_modules` motywu. Zależności instalujesz samodzielnie — serwer nie uruchamia instalacji pakietów.

```ts
export default function initialize() {
  // Tu uruchom np. dekorację tła lub własne kontrolki.
  // Inicjalizacja odbywa się raz na pełny dokument.
  return {
    async transition(element, entering, signal) {
      if (!element || signal.aborted) return;
      const animation = element.animate(
        { opacity: entering ? [0, 1] : [1, 0] },
        { duration: entering ? 150 : 125 }
      );
      const cancel = () => animation.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try { await animation.finished; } catch { /* Anulowanie. */ }
      finally {
        signal.removeEventListener('abort', cancel);
        animation.cancel();
      }
    },
    waiting(page, shell) {
      // Opcjonalna dekoracja w czasie oczekiwania na odpowiedź.
      return () => { /* Usuń dekorację, timery i obserwatory. */ };
    }
  };
}
```

Obie funkcje są opcjonalne. Bez własnego przejścia działa delikatne zanikanie: 125 ms wyjścia i 150 ms wejścia. Wyjście zaczyna się równolegle z pobieraniem treści; wejście czeka na zakończenie wyjścia i załadowanie treści oraz stylów. `AbortSignal` przerywa starsze przejście po kolejnym kliknięciu. Ograniczenie ruchu w systemie pomija animacje.

`transition` dostaje kontener strony albo mobilnej nawigacji. Zwrócona obietnica musi się zakończyć. Nie podmieniaj ani nie klonuj zawartości kontenera — możesz stracić stan formularzy, zdjęć i wtyczek. Funkcja zwrócona przez `waiting` sprząta efekt po otrzymaniu odpowiedzi, błędzie lub anulowaniu. Po udanej nawigacji silnik emituje zdarzenie `karui:navigated` na `document`.

## Kompilacja i cache

Motywy nie są kompilowane przy starcie procesu. Kompilacja następuje przy pierwszym użyciu; zapis wyboru w panelu przygotowuje motyw przed zatwierdzeniem. Jednoczesne żądania w tym samym procesie współdzielą kompilację. Gotowy zestaw zawiera snapshot szablonów, zasobów i kodu klienta.

Publiczny adres ma postać `/assets/themes/<motyw>/<klucz>/<plik>`. Fizycznie zestawy są zapisywane pod `CONTENT_CACHE_DIR/themes`, poza katalogiem treści i poza katalogiem instalacji aplikacji. Nie trzeba nadawać zapisu do obrazu Dockera. Jeśli cache znajduje się na tmpfs, jest przechowywany w RAM i może zniknąć po odtworzeniu kontenera.

Ponowny start korzysta z istniejącego zestawu. Zmiana źródeł bez zmiany `version` nie przebudowuje go. Nowy zestaw powstaje po zmianie wersji motywu, silnika, domyślnych szablonów albo esbuild, a także gdy brakuje cache. Stare adresy pozostają poprawne dla już otwartych dokumentów. Cache ma nagłówek `immutable`, a zmiana motywu lub zestawu powoduje pełne ładowanie przy następnej nawigacji, aby nie mieszać wyglądów.

Nieprawidłowy manifest lub błąd kompilacji wybranego motywu powoduje użycie domyślnego wyglądu; panel nie zatwierdzi takiego wyboru. Motywy są zaufanym kodem administratora, nie piaskownicą: Edge może wykonywać wyrażenia na serwerze, a `client.ts` ma dostęp do dokumentu i uprawnień przeglądarki, także w panelu. Nie instaluj motywów z niezaufanego źródła. Wyjątki klienta są przechwytywane, ale nieskończona pętla może zablokować kartę.
