---
title: Testowanie i ograniczenia
format: markdown
---
Testuj wtyczkę na danych w osobnym katalogu tymczasowym, nie na plikach produkcyjnych. Kod silnika i obsługę wtyczek sprawdzisz poleceniami:

```sh
npm run typecheck
npm run build
PLUGIN_WORKERS=1 PLUGIN_MAX_WORKERS=4 node --import tsx --test karui/tests/plugin-admin.test.ts karui/tests/plugin-http.test.ts
npm run test:panel
```

`test:browser` i `test:panel` uruchamiają osobny serwer na porcie 3012 z tymczasowym katalogiem treści i domyślnym motywem. Nie korzystają z danych właściwej witryny. Uruchamiaj te zestawy osobno, bo używają tego samego portu. Testy silnika sprawdzają zachowanie, dostępność i przepływ danych, a nie konkretną paletę czy dekoracje motywu. Opcjonalne testy własnych treści i motywów można uruchomić przez `npm run test:content`; nie należą do zestawu silnika.

## Lista kontrolna wtyczki

1. Otwórz stronę bezpośrednio i przez link z innej podstrony. Sprawdź, czy oba sposoby dają ten sam widok. Nieobsługiwane ścieżki i metody powinny zwracać 404 lub 405, a `GET` i `HEAD` nie mogą zapisywać danych.
2. Wyślij niepoprawne parametry URL, treść żądania i własne pola YAML. Wtyczka powinna je odrzucić. Sprawdź też, czy nie da się wybrać dowolnego pliku przez podanie jego ścieżki w URL.
3. Wypróbuj wszystkie ustawienia `pluginPlacement`. W trybie `content` upewnij się, że tekst pojawia się tylko raz. Możesz korzystać z gotowego HTML lub samodzielnie przetwarzać źródło.
4. Sprawdź wartości wstawiane do HTML: znaki specjalne z niezaufanych danych muszą być zabezpieczone. JSON w `data-context` umieszczaj przez podwójne klamry Edge.
5. Spróbuj wejść do administracji bez sesji, bez `admin: true` i z niewłaściwym przypisaniem strony. Sprawdź odrzucanie zapisów bez CSRF. Parametr `mode=admin` w publicznym URL nie może otwierać administracji.
6. Sprawdź, czy bez zalogowania nie można pobrać prywatnego klienta i CSS. Pliki stanu, kod backendu, `node_modules` i szablony nie powinny być dostępne przez HTTP.
7. Wywołaj błąd backendu, przekroczenie czasu wykonania i błąd klienta. Reszta strony powinna działać. Sprawdź również, czy równoległe zapisy nie nadpisują sobie zmian.
8. Uruchom wtyczkę w docelowym obrazie kontenera. Sprawdź zależności oraz to, czy zmiana wersji odświeża kod, widoki i style.
9. Obejrzyj stronę na telefonie, przejdź ją klawiaturą i włącz ograniczenie animacji (`prefers-reduced-motion`). Upewnij się, że CSS wtyczki nie zmienia innych elementów strony.
10. Sprawdź liczbę wiadomości wysyłanych przez workera. Do kosztownego renderowania używaj OffscreenCanvas i ograniczaj częstotliwość aktualizacji.

## Co trzeba obsłużyć we własnej wtyczce

Formularze, sprawdzanie danych i zapis do plików przygotowujesz we wtyczce. Silnik nie generuje automatycznie operacji tworzenia, odczytu, zmiany i usuwania danych (CRUD).

API wtyczek nie udostępnia harmonogramu zadań (cron), WebSocketów, strumieni, odpowiedzi binarnych, własnych nagłówków i cookies ani rejestracji tras Fastify. Klient zmienia widok przez [polecenia hosta](/plugins/client), bez bezpośredniego dostępu do DOM. Silnik nie zapewnia instalatora ani bezpiecznego środowiska do uruchamiania kodu od niezaufanych autorów.

## Gdzie szukać przyczyny błędu

Zacznij od statusu HTTP i logu serwera. Sprawdź, czy manifest jest poprawny, pliki źródłowe i zależności są dostępne, a po zmianie kodu zwiększono `version`.

Jeśli widok się otwiera, ale nie reaguje na kliknięcia, zajrzyj do konsoli workera i karty Sieć w narzędziach przeglądarki. Sprawdź pobieranie plików z `?v=...` oraz ewentualne błędy CSP. Komunikaty o przekroczeniu limitów porównaj z [limitami wtyczek](/plugins/runtime). Jeśli problem dotyczy pakietu, sprawdź jego zgodność z Node i sposobem kompilacji backendu lub klienta.
