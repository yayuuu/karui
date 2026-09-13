---
title: Dokumentacja Karui
format: markdown
---
Tutaj dowiesz się, jak tworzyć wtyczki, przygotowywać widoki i dodawać interakcje oraz ustawienia administracyjne. Możesz też zajrzeć do [działającego przykładu](/plugins/example) i wykorzystać go jako punkt wyjścia.

Dokumentację wyświetla Karui — dokładnie ten sam silnik, który obsługuje tworzone w nim strony. Dokumentacja ma własną konfigurację (`docs/site.yml`), treść (`docs/pages`), wtyczki (`docs/plugins`) i prywatne dane (`docs/state`).

## Wersje językowe

Przy jednym języku strona korzysta z pliku `index.md`. Po włączeniu kilku języków używa plików takich jak `index.pl.md`, `index.en.md` i `index.fr.md`. Panel wykonuje migrację nazwy przy pierwszym zapisie, bez masowego przepisywania treści. Język publicznej strony wybiera parametr `?lang=pl`.

Menu ma jeden wspólny układ. Linki, zagnieżdżenie i nazwy w języku domyślnym pozostają w `site.yml`. W zakładce **Menu** wybierz język domyślny, aby edytować drzewo, albo inny język, aby uzupełnić tabelę „Nazwa domyślna / Tłumaczenie”. Karui zapisuje te etykiety w `content/lang/<język>.po`, w kontekście gettext `karui-menu`.

Każda wersja językowa strony ma własne metadane galerii. Jeśli inny język zawiera już zdjęcia, w edytorze strony możesz rozwinąć opcjonalną operację **Skopiuj galerię z innego języka**. Lista pokazuje wyłącznie niepuste galerie źródłowe, a pliki obrazów są współdzielone zamiast powielane.

## Uruchomienie lokalne

W katalogu projektu, po zainstalowaniu zależności:

```sh
npm run docs:dev
```

Otwórz `http://127.0.0.1:3002`. Aby zbudować i uruchomić dokumentację w trybie produkcyjnym, użyj:

```sh
npm run docs:build
npm run docs:start
```

Polecenie `docs:build` kompiluje silnik. Strony Markdown są przetwarzane podczas pracy aplikacji, a gotowy HTML trafia do pamięci podręcznej (cache). Przykładowa wtyczka kompiluje się przy pierwszym wejściu na jej stronę.

## Docker

```sh
docker compose -f docker-compose.docs.yml up -d --build
```

Port hosta możesz zmienić, ustawiając np. `DOCS_PORT=3003`. Dokumentacja jest dostępna tylko lokalnie i działa niezależnie od produkcyjnego kontenera oraz jego danych.

Katalog `docs` jest podmontowany tylko do odczytu. Wyjątkiem jest `docs/state`, dostępny do zapisu pod `/app/content/state`. Nadaj użytkownikowi kontenera (UID 1000) prawo zapisu do tego katalogu. Cache silnika i skompilowanych wtyczek znajduje się na dysku RAM (tmpfs); po odtworzeniu kontenera aplikacja odbuduje go w miarę potrzeb.

Pliki dokumentacji, tak jak katalog `content`, nie są kopiowane do obrazu. Treść zmieniasz bez przebudowywania kontenera: edytuj pliki `docs/pages`, a zmiana pojawi się zwykle po około sekundzie. Po zmianie kodu wtyczki zwiększ jej wersję w `plugin.json`.

## Od czego zacząć

1. [Struktura wtyczki](/plugins).
2. [Dane wejściowe, PluginContext i routing](/plugins/context).
3. [Treść strony oraz szablony Edge](/plugins/views).
4. [Web Worker i komunikacja z klientem](/plugins/client).
5. [Chroniona administracja wtyczki](/plugins/admin).
6. [Zależności, zapis plików, cache i limity](/plugins/runtime).
7. [Działający przykład](/plugins/example) i [testowanie](/testing).
