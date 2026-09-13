# Kod przeglądarki

Katalogi odpowiadają funkcjom interfejsu: nawigacji, galerii i panelowi.
Widoki komponentów są zapisane w Preact/TSX, a logika ich działania i modele danych
w TypeScript. Edge renderuje dokument i treść podstron na serwerze; Preact obsługuje
poszczególne elementy interfejsu w przeglądarce.

```text
client/
├── main.ts                    # start publicznej strony
├── panel.ts                   # start panelu
├── themes.ts                  # ładowanie klienta motywu i domyślne przejścia
├── navigation/
│   ├── index.ts               # pobieranie fragmentów, historia, cykl życia stron
│   ├── chrome.tsx             # komunikaty, Powrót
│   ├── mobile.tsx             # dolny pasek i drzewo nawigacji zamiast treści
│   ├── motion.ts              # wyjście, wejście i anulowanie animacji
│   └── scroll-controls.ts     # powrót na górę
├── gallery/
│   ├── index.ts               # układ istniejących zdjęć i lightbox
│   └── diagnostics.tsx        # opcjonalna diagnostyka, sprzątana przy wyjściu
├── panel/
│   ├── index.ts               # formularze, API, ochrona niezapisanych zmian
│   ├── editor/
│   │   ├── index.ts           # Tiptap, źródło, bezpieczny podgląd
│   │   ├── html.ts            # zachowanie ręcznych bloków HTML i konwersja formatów
│   │   └── toolbar.tsx        # przyciski i pola formatowania
│   ├── photos/
│   │   ├── index.tsx          # karty zdjęć, kolejka, postęp i ponawianie
│   │   └── upload.ts          # transport uploadu w tle
│   └── menu/
│       ├── index.tsx          # akcje edycji, montowanie i zapis
│       ├── components.tsx     # węzeł, podmenu i przyciski drzewa
│       ├── tree.ts            # model, przenoszenie, walidacja i serializacja
│       └── sortable.ts        # adapter drag and drop
├── widgets/
│   └── worker-host.ts         # izolacja zewnętrznych wtyczek i dozwolone polecenia
└── ui/
    └── island.ts              # montowanie, aktualizacja i usuwanie wysp Preact
```

## Zasady rozbudowy

- HTML interfejsu zapisuj w nazwanych komponentach `.tsx`, blisko danej funkcji.
  Zdarzenia i tekst przekazuj jako typowane propsy. Nie składaj HTML z łańcuchów tekstu.
- `ui/` jest wyłącznie dla współdzielonej infrastruktury lub faktycznie wspólnych
  komponentów; dekoracje i kontrolki wyglądu trafiają do `content/themes/<motyw>/client/`
  albo do edytowalnego szablonu w `content/templates/<motyw>/client/`.
- Preact zarządza tylko elementem, w którym został zamontowany (hostem).
  Przed usunięciem tego elementu wywołaj `island.dispose()`, żeby odmontować komponenty.
  Komponenty globalne działają przez cały czas otwarcia dokumentu, a lokalne do zmiany podstrony.
- Sortable pokazuje przeciąganie, ale po puszczeniu adapter odtwarza poprzedni DOM,
  aktualizuje model i pozwala Preactowi wyrenderować nową kolejność. Nie odczytujemy
  modelu menu z DOM. Klucze węzłów są stabilne i nie trafiają do zapisywanego YAML.
- Operacje techniczne korzystają bezpośrednio z DOM: buforowe canvasy, pobieranie plików,
  ładowanie arkuszy, parsowanie HTML z Edge/Tiptap i ograniczony protokół workera.
  To nie są komponenty UI. Galeria przestawia istniejące węzły zdjęć, zachowując
  `decoding="sync"`, potrzebne do poprawnego wyświetlania w Vivaldi. Nie montuj tych
  węzłów ponownie przez Preact.
- Nie przekazuj treści zewnętrznych wtyczek do `dangerouslySetInnerHTML`. Wyjątkiem
  od deklaratywnego widoku jest kontrolowana granica wstawiania fragmentów Edge.
- Zewnętrzne wtyczki umieszczaj w `content/plugins`; nie przenoś ich implementacji
  do klienta silnika.

Wynikowe skrypty są dostępne pod `/assets/main.js` i `/assets/panel.js`.
Zmiany sprawdzisz przez `npm run check` i `npm run test:panel`.
`npm run test:browser` i `npm run test:panel` używają tymczasowego serwera z neutralnym motywem. Dekoracje, tła i niestandardowe przejścia należą do wybranego motywu, poza kodem klienta Karui.
