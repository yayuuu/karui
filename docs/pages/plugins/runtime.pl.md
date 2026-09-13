---
title: Pliki, zależności, kompilacja i pula workerów
format: markdown
---
## Zależności

Wtyczka może mieć własne `package.json`, plik blokady wersji (`package-lock.json`) i katalog `node_modules`. Kompilator łączy lokalnie importowane pliki backendu w jeden plik wynikowy. Pakiety Node pozostają poza nim i są ładowane względem pliku wejściowego wtyczki.

Backend jest kompilowany do CommonJS (CJS) dla Node 24. Sprawdź, czy wybrane pakiety obsługują ten sposób ładowania, szczególnie jeśli korzystają z ESM lub `await` poza funkcją. Kod klienta jest łączony z zależnościami i kompilowany do ESM zgodnego z ES2022 dla przeglądarki. Pamiętaj, że biblioteki wymagające DOM nie zadziałają w Web Workerze.

Aby zainstalować zależności jednej wtyczki, wykonaj w jej katalogu `npm ci --omit=dev --ignore-scripts`. Zależności wszystkich wtyczek możesz zainstalować lokalnie lub przez Docker:

```sh
npm run plugins:install
docker compose --profile tools run --rm plugins-install
```

Narzędzie uruchamia `npm ci`, jeśli wtyczka ma plik blokady wersji, a w przeciwnym razie `npm install`. Pomija `devDependencies`, skrypty instalacyjne oraz operacje `audit` i `fund`, więc pakiety potrzebne do działania wtyczki wpisuj w `dependencies`.

Pakiety natywne mogą wymagać osobnych kroków instalacji. Przygotuj je dla systemu i architektury używanych w kontenerze; skopiowanie `node_modules` z innego systemu może nie wystarczyć.

## Wersjonowanie

Przy uruchomieniu silnik przygotowuje pulę workerów, ale nie kompiluje wtyczek. Dopiero pierwsze żądanie do wtyczki powoduje sprawdzenie manifestu i wyszukanie gotowego wyniku kompilacji (artefaktu). Jeśli go brakuje, jest niepoprawny albo zmieniono `version`, silnik kompiluje wtyczkę.

Zwiększ wersję po zmianie kodu backendu, funkcji pomocniczych, widoków, klienta, CSS, plików w `assets/`, zależności lub ustawień `admin` i `concurrent`. Sam zapis pliku źródłowego lub zmiana daty jego modyfikacji nie uruchamia kompilacji.

Artefakt zawiera kod backendu i klientów, style oraz szablony Edge. Nie obejmuje danych odczytywanych przez handler podczas pracy, np. pliku JSON ze stanem wtyczki. Takie dane możesz zmieniać bez ponownej kompilacji.

Klucz cache zależy od wersji formatu artefaktu, esbuild, głównej wersji Node, absolutnej ścieżki wtyczki i wersji zapisanej w manifeście. Artefakt oraz snapshot publicznych zasobów trafiają do `CONTENT_CACHE_DIR/plugins` przez zapis atomowy. W pamięci silnik przechowuje do 32 wpisów. Pliki pozostają dostępne do wyczyszczenia cache lub odtworzenia tmpfs; nie służą do trwałego przechowywania danych.

Adresy JS i CSS w HTML zawierają `?v=...`, a adresy plików z `assets/` mają klucz w ścieżce. Widok pobiera dzięki temu wszystkie elementy z tej samej kompilacji. Plik pod danym kluczem jest dostępny tak długo, jak odpowiadający mu artefakt. Publiczne pliki mają cache `immutable`, a adresy używane przez widok administracyjny — `no-store`. Nie umieszczaj sekretów w kodzie ani zasobach publicznych.

Jeśli nie można odczytać manifestu, silnik nie uruchomi wtyczki, nawet gdy jej skompilowany kod znajduje się w cache.

## Workery

### Co wykonuje worker

Ta sekcja dotyczy workerów backendowych z `node:worker_threads`, a nie [Web Workerów w przeglądarce](/plugins/client). Są to osobne wątki w jednym procesie Node, nie osobne kontenery. Każdy ma własną instancję silnika JavaScript i własne zwykłe zmienne. Wątki mogą wykonywać JavaScript równolegle. [Opis workerów w Node](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#worker-threads).

Główny wątek aplikacji przyjmuje żądanie HTTP i przekazuje do puli dane wtyczki. Wybrany worker uruchamia handler, czeka na jego wynik i renderuje szablon Edge, jeśli odpowiedzią jest widok. Gotowy HTML lub dane JSON wracają do silnika, który wysyła odpowiedź do przeglądarki.

Jeden worker obsługuje jedno zadanie naraz. Czekanie na `await readFile(...)` lub `await fetch(...)` również zajmuje jego miejsce w puli — w tym czasie silnik nie przekazuje mu kolejnego żądania. Po zakończeniu zadania worker może obsłużyć następne.

### Stała pula i dodatkowe wątki

Silnik domyślnie utrzymuje 8 stałych workerów. To wspólna pula dla wszystkich wtyczek, nie 8 wątków na każdą wtyczkę. Jeśli nie ma wolnego workera, a zasady współbieżności pozwalają rozpocząć następne zadanie, silnik może utworzyć dodatkowy wątek, do 16 łącznie. Po osiągnięciu tego limitu zadania czekają w kolejce.

Dodatkowe workery są tymczasowe: po zakończeniu zadania mogą pozostawać bezczynne przez 10 sekund. Kolejne zadanie anuluje odliczanie, a po jego zakończeniu zaczyna się pełne 10 sekund. Czas bezczynności nie przerywa trwającego zadania — do tego służy osobny limit wykonania.

Silnik najpierw szuka wolnego workera z załadowaną właściwą wersją wtyczki, a następnie workera jeszcze nieprzypisanego. Worker jest związany z jedną wersją jednej wtyczki. Gdy trzeba wykorzystać jego miejsce dla innej wtyczki lub wersji, silnik wymienia wątek. „Stały” oznacza więc utrzymywane miejsce w puli, nie niezmienną instancję ani trwałe zmienne.

Edge jest ładowany przy przygotowaniu workera, a kod wtyczki i jego zależności — przy pierwszym zadaniu. Dlatego pierwsze wejście może trwać dłużej niż kolejne. Sam start puli nie kompiluje wtyczek.

Przykładowo: przy ustawieniach 8/16 dwanaście równoległych, dozwolonych zadań może zająć 12 workerów. Jeśli jednak wszystkie żądania dotyczą jednej wtyczki z `concurrent: false`, będzie wykonywane tylko jedno. Pozostałe poczekają, mimo wolnych miejsc w puli.

### Ustawienia puli

| Zmienna | Domyślnie | Zakres |
| --- | --- | --- |
| `PLUGIN_WORKERS` | 8 | 1–64 |
| `PLUGIN_MAX_WORKERS` | max(16, stałe) | 1–128, nie mniej niż stałych |
| `PLUGIN_WORKER_IDLE_MS` | 10000 | 100–300000 ms |
| `PLUGIN_TIMEOUT_MS` | 5000 | 100–30000 ms |
| `PLUGIN_WORKER_OLD_GENERATION_MB` | 64 | 16–4096 MB, liczba całkowita |
| `PLUGIN_WORKER_YOUNG_GENERATION_MB` | 16 | 4–1024 MB, liczba całkowita |
| `PLUGIN_WORKER_STACK_MB` | 4 | 1–64 MB, liczba całkowita |
| `CONTENT_CACHE_DIR` | tmp + `karui-cache` | Docker: `/var/cache/karui` na tmpfs |
| `CONTENT_REFRESH_MS` | 1000 | 100–60000 ms |

Tabela pokazuje domyślne ustawienia silnika. Instancja dokumentacji używa mniejszej puli: 1 stałego workera i maksymalnie 4. W głównym Compose wartości `PLUGIN_WORKERS` i `PLUGIN_MAX_WORKERS` są ustawiane osobno. Zwiększając pierwszą, sprawdź również drugą.

Więcej workerów pozwala rozpocząć więcej zadań, ale zwiększa zużycie pamięci i obciążenie procesora. Nie przyspieszy pojedynczego handlera ani kolejki jednej wtyczki z `concurrent: false`. Dobieraj liczbę wątków na podstawie pomiarów z docelowymi wtyczkami i danymi.

### Co oznaczają limity pamięci V8

V8 to silnik wykonujący JavaScript w Node. Przechowuje obiekty w pamięci nazywanej stertą i automatycznie odzyskuje miejsce po obiektach, które nie są już używane. Ten mechanizm to garbage collector, w skrócie GC. Zakończenie funkcji nie oznacza natychmiastowego zwolnienia całej używanej przez nią pamięci.

Sterta jest podzielona na obszary. Większość nowych obiektów zaczyna w młodej generacji. Obiekty, które przeżywają kolejne porządki GC, mogą trafić do starej generacji. „Młoda” i „stara” opisują czas życia obiektów w pamięci, nie wersję kodu. Więcej o tym podziale: [generacje i garbage collector V8](https://v8.dev/blog/trash-talk#generational-layout).

W `karui/src/plugins/pool.ts` aplikacja przekazuje ustawienia środowiska do `resourceLimits`. Domyślnie są to:

| Ustawienie | Wartość | Co to oznacza w praktyce |
| --- | ---: | --- |
| `maxYoungGenerationSizeMb` | 16 MB | Obszar niedawno utworzonych obiektów, np. danych powstających podczas przetwarzania żądania. Zapełnianie go powoduje pracę GC; nie jest to limit rozmiaru żądania ani pliku. |
| `maxOldGenerationSizeMb` | 64 MB | Limit związany z główną stertą i dłużej żyjącymi obiektami, np. cache przechowywanym w zmiennych wtyczki. Korzystają z niego także załadowane biblioteki i szablony. |
| `stackSizeMb` | 4 MB | Stos wywołań funkcji. Zbyt głęboka rekurencja może go przepełnić, nawet jeśli przetwarzane dane są małe. |

Wartości dotyczą każdego workera, również dodatkowych wątków i tych uruchamianych po awarii. Nie są rezerwacją pamięci ani obietnicą, że worker zużyje najwyżej `16 + 64 + 4 = 84 MB`.

Aby zmienić limity, wpisz do `.env` np.:

```dotenv
PLUGIN_WORKER_OLD_GENERATION_MB=128
PLUGIN_WORKER_YOUNG_GENERATION_MB=32
PLUGIN_WORKER_STACK_MB=4
```

Główny Compose i Compose dokumentacji przekazują te zmienne do kontenera podczas uruchamiania. Nie są to argumenty budowania obrazu. Po zmianie `.env` odtwórz wybraną usługę:

```sh
docker compose up -d --force-recreate karui
# Dla instancji dokumentacji:
docker compose -f docker-compose.docs.yml up -d --force-recreate docs
```

Samo `docker compose restart` nie wczytuje zmienionych zmiennych środowiskowych. Kolejne zmiany limitów nie wymagają przebudowy obrazu ani zwiększania wersji wtyczek. Przy uruchamianiu bez Dockera przekaż zmienne do procesu Node; silnik nie odczytuje sam pliku `.env`. Niepoprawne wartości powodują błąd konfiguracji przy starcie. Górne granice dopuszczone przez konfigurację nie oznaczają, że dana wartość zmieści się w pamięci kontenera.

Unikaj równoczesnego ustawiania flag Node `--max-old-space-size` i `--max-semi-space-size` (także przez `NODE_OPTIONS`): mogą nadpisywać odpowiadające im limity sterty workerów. Nie używaj ich do ustawiania niezależnego limitu tylko dla głównego wątku. [Znaczenie opcji `resourceLimits`](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options).

Przykład: wtyczka przy każdym żądaniu dopisuje cały raport do globalnej tablicy `reports`. Dopóki tablica przechowuje odwołania, GC nie może usunąć raportów. Zużycie pamięci rośnie z kolejnymi wejściami, choć pojedyncze żądanie jest małe. Rozwiązaniem jest ograniczony cache lub odczytywanie potrzebnych danych z plików, a nie samo zwiększenie limitu.

Drugi przykład to rekurencyjne przechodzenie po drzewie kategorii. Tysiące zagnieżdżonych wywołań mogą przepełnić stos. W takim przypadku ogranicz dozwoloną głębokość danych albo zastosuj iterację z własną kolejką zadań.

### Czego te limity nie obejmują

Limity `resourceLimits` dotyczą silnika JavaScript, nie całej pamięci procesu. Nie obejmują m.in. danych `ArrayBuffer` ani pamięci zewnętrznej bibliotek natywnych. Przekroczenie limitu V8 może zakończyć worker, ale ogólny brak pamięci może zakończyć cały proces. [Ograniczenia ochrony pamięci w Node](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html#new-workerfilename-options).

Przykład: rozkodowany obraz 5000 × 5000 pikseli z czterema bajtami na piksel zajmuje około 100 MB, zanim uwzględnisz kopie i pamięć roboczą biblioteki. Mały plik PNG na dysku może więc wymagać znacznie więcej RAM podczas obróbki. Kilka takich operacji naraz może wyczerpać pamięć kontenera, mimo ustawienia 64 MB dla starej generacji każdego workera.

Dlatego ograniczaj nie tylko wielkość pliku wejściowego, ale też wymiary obrazów, liczbę jednoczesnych operacji i rozmiar przechowywanych wyników. Główny Compose ustawia `mem_limit: 1024m`, a dokumentacja `512m`. W tym budżecie trzeba zmieścić silnik, całą pulę, biblioteki oraz używany tmpfs. Limit kontenera jest ostatnim zabezpieczeniem, nie sposobem na łagodne odrzucenie zbyt dużego zadania.

Do diagnostyki możesz chwilowo dodać w handlerze log:

```ts
const usage = process.memoryUsage();
const mib = (bytes: number) => Math.round(bytes / 1024 / 1024);
console.log({
  heapUsedMiB: mib(usage.heapUsed),
  externalMiB: mib(usage.external),
  arrayBuffersMiB: mib(usage.arrayBuffers),
  processRssMiB: mib(usage.rss),
});
```

`heapUsed` pokazuje zajętą stertę bieżącego wątku. `external` obejmuje raportowaną pamięć zewnętrzną powiązaną z obiektami JS, a `arrayBuffers` m.in. dane buforów Node. `arrayBuffers` zawiera się w `external`, więc nie dodawaj ich do siebie. `rss` dotyczy całego procesu ze wszystkimi workerami, nie tylko tego, który wykonał pomiar. Nie jest też pełnym pomiarem pamięci kontenera. [Opis `process.memoryUsage()`](https://nodejs.org/docs/latest-v24.x/api/process.html#processmemoryusage).

### Awaria i limit czasu

`PLUGIN_TIMEOUT_MS` określa czas od przekazania zadania do gotowego workera do otrzymania wyniku. Obejmuje oczekiwanie na pliki i sieć, wykonanie handlera oraz renderowanie Edge. Przy pierwszym zadaniu obejmuje również ładowanie kodu wtyczki i jego zależności. To nie jest limit samego czasu CPU ani całkowitego żądania HTTP — kompilacja i oczekiwanie w kolejce mają osobne etapy.

Po błędzie, zakończeniu wątku lub przekroczeniu czasu wykonania silnik usuwa worker. Jeśli zajmował stałe miejsce w puli, uruchamia zastępczy wątek. Strona publiczna wtyczki otrzymuje status 503 i komunikat błędu; endpointy JSON i administracja otrzymują odpowiedź JSON ze statusem 503. Przy awarii zadania blokada kolejki wtyczki jest zwalniana dopiero po zakończeniu uszkodzonego wątku.

Timeout nie cofa zapisów do plików ani żądań wysłanych do innych usług. Jeśli handler zdążył zapisać dane, a potem zawiesił się podczas renderowania widoku, użytkownik może dostać 503 mimo wykonanego zapisu. Do konsekwencji dla ponawiania żądań wracamy poniżej.

### Izolacja awarii to nie izolacja uprawnień

Worker nie jest bezpiecznym miejscem do uruchamiania dowolnego kodu znalezionego w Internecie. W tej aplikacji wtyczka korzysta z uprawnień użytkownika procesu. `storageDir` wskazuje miejsce na jej dane, ale nie jest blokadą dostępu do innych katalogów. Na przykład błędnie napisana wtyczka może nadpisać plik innej wtyczki, a celowo szkodliwy kod może odczytać dostępne pliki lub wysłać dane do sieci. Osobny wątek i `concurrent: false` przed tym nie chronią.

Zwykły wyjątek JavaScript można obsłużyć przez zatrzymanie workera. Awaria biblioteki natywnej lub wyczerpanie zasobów całego procesu może natomiast dotknąć całą aplikację. Korzystaj z zaufanego kodu i zależności, ograniczaj dane wejściowe i zachowuj kopie zapasowe.

Uważaj też na dane przechowywane między żądaniami. Jeśli zapiszesz `context.admin` w globalnej zmiennej, ten sam worker może później obsługiwać publiczny widok wtyczki. Omyłkowe użycie zapamiętanych danych zamiast bieżącego kontekstu może ujawnić dane sesji. Każde żądanie powinno korzystać z własnego `context`; w globalnym cache nie przechowuj tokenów ani danych użytkowników.

## Współbieżność i stan

### Co zmienia `concurrent`

Współbieżność oznacza, że kilka zadań jest w toku jednocześnie. W tej puli mogą one również wykonywać kod równolegle, w różnych workerach. To, czy wolno tak obsługiwać daną wtyczkę, określasz w `plugin.json`:

```json
{ "version": "1", "concurrent": false, "admin": true }
```

| Ustawienie | Obsługa żądań do tej samej wtyczki | Kiedy je wybrać |
| --- | --- | --- |
| `false` (domyślne) | Jedno zadanie naraz; kolejne czeka na zakończenie poprzedniego. Inne wtyczki mogą pracować w tym czasie. | Wtyczka odczytuje, zmienia i zapisuje wspólny stan w plikach. |
| `true` | Kilka zadań może pracować w osobnych workerach, jeśli pula ma wolne miejsca. | Zadania są niezależne, wyłącznie odczytują dane lub mają własne zabezpieczenie wspólnych zapisów. |

Kolejka jest wspólna dla całego katalogu wtyczki. Obejmuje wszystkie przypisane strony, zasoby, parametry URL, metody HTTP i część administracyjną. Silnik nie ma osobnego ustawienia współbieżności dla `GET`, `POST` czy wybranego zasobu. Po zmianie `concurrent` zwiększ `version`.

Na przykład przy `concurrent: false` długie żądanie A opóźni krótkie żądanie B skierowane do tej samej wtyczki, nawet jeśli dotyczą niezależnych zasobów. Dzięki temu autor wtyczki nie musi sam synchronizować dostępu do współdzielonego stanu. Zwiększenie liczby workerów nie zmieni tej zasady.

### Przykład: dwa kliknięcia, a licznik rośnie tylko o jeden

Załóżmy, że w `settings.json` jest `count: 10`. Handler po kliknięciu odczytuje plik, zwiększa licznik i zapisuje wynik. Poniższy fragment korzysta z funkcji `readSettings` i `saveSettings` z `docs/plugins/example/index.ts`; pokazuje sam zapis, po sprawdzeniu metody i uprawnień:

```ts
const settings = await readSettings(context.storageDir);
settings.count += 1;
await saveSettings(context.storageDir, settings);
return { type: 'json', data: { count: settings.count } };
```

Przy równoległej obsłudze dwa żądania mogą wykonać się tak:

| Krok | Żądanie A | Żądanie B | Licznik w pliku |
| --- | --- | --- | ---: |
| 1 | Odczytuje 10 | — | 10 |
| 2 | — | Odczytuje 10 | 10 |
| 3 | Oblicza i zapisuje 11 | — | 11 |
| 4 | — | Oblicza i zapisuje 11 | 11 |

Oba żądania mogą zakończyć się sukcesem, plik jest poprawnym JSON, ale jedno kliknięcie zniknęło. To utrata aktualizacji: B zapisało wynik obliczony na podstawie nieaktualnego odczytu. Przy `concurrent: false` B zacznie po zakończeniu A, odczyta 11 i zapisze 12 — pod warunkiem że nikt spoza tej kolejki nie zmienia pliku.

Ten sam problem wystąpi przy dowolnym dokumencie modyfikowanym na podstawie wcześniejszego odczytu. Dwa żądania mogą przygotować poprawne, ale różne wersje, a ostatni zapis usunie zmianę wprowadzoną przez pierwsze.

### Atomowy zapis i kolejka rozwiązują różne problemy

Funkcja `saveSettings` z przykładu zapisuje plik tymczasowy, a potem zastępuje docelowy przez `rename`. Czytelnik otrzymuje kompletną zawartość sprzed zastąpienia lub po nim, zamiast połowy zapisywanego JSON. Nie oznacza to jednak, że cała sekwencja „odczytaj → zmień → zapisz” jest atomowa. Scenariusz utraconego kliknięcia jest możliwy także przy takim zapisie.

Do prostego wspólnego stanu użyj obu mechanizmów: `concurrent: false` do ochrony całej operacji oraz pliku tymczasowego i `rename` do zastępowania zawartości. Plik tymczasowy powinien mieć unikalną nazwę i znajdować się w tym samym katalogu co docelowy. Nie traktuj błędu parsowania istniejącego pliku jako pustego stanu — zapis wartości domyślnych mógłby zniszczyć dane potrzebne do odzyskania.

Atomowe zastąpienie nie jest transakcją obejmującą kilka plików ani gwarancją przetrwania awarii zasilania. Jeśli zapisujesz osobno obraz i metadane, przerwanie pracy pomiędzy nimi może pozostawić niespójny zestaw. Potrzebny jest wtedy protokół odzyskiwania, np. zapis informacji o rozpoczętej operacji i jej dokończenie przy kolejnym odczycie. Samo `finally` również nie gwarantuje sprzątnięcia po przymusowym zakończeniu workera.

### Gdzie kończy się ochrona kolejki

`concurrent: false` chroni tylko zadania przekazane do kolejki danej wtyczki. Nie obejmuje:

- innej wtyczki zapisującego ten sam plik;
- skryptu administracyjnego albo ręcznej edycji danych na hoście;
- operacji uruchomionej przez wtyczkę w tle, która trwa po zwróceniu odpowiedzi.

Alternatywą jest rozdzielenie danych tak, żeby zadania nie modyfikowały tego samego pliku, albo przekazywanie zapisów do jednego wspólnego wykonawcy. Sam podział na osobne pliki nie wystarczy, jeśli kilka żądań może równocześnie zmieniać ten sam zasób.

### `await` musi obejmować zakończenie pracy

Silnik uznaje handler za zakończony, gdy otrzyma jego wynik, i po wyrenderowaniu odpowiedzi zwalnia miejsce w puli. Nie wie o operacjach, które handler rozpoczął bez oczekiwania na ich zakończenie.

```ts
// Źle: zapis może trwać już po zwróceniu odpowiedzi.
void saveSettings(context.storageDir, settings);
return { type: 'json', data: { saved: true } };
```

W takim przypadku następne żądanie może odczytać plik przed zakończeniem zapisu, nawet przy `concurrent: false`. Użytkownik otrzyma też potwierdzenie, zanim będzie wiadomo, czy zapis się udał.

```ts
// Dobrze: błąd zapisu trafi do handlera, a kolejka poczeka.
await saveSettings(context.storageDir, settings);
return { type: 'json', data: { saved: true } };
```

Uważaj również na `Promise.all(...)` wewnątrz jednego handlera: ustawienie `concurrent: false` nie kolejkuje jego wewnętrznych operacji. Jeśli dwie z nich zmieniają ten sam stan, mogą wejść sobie w drogę. Timery i inne zadania w tle nie powinny służyć jako trwała kolejka — worker może zostać wymieniony lub zatrzymany.

### Kolejność, ponowienia i nieaktualne formularze

Kolejka porządkuje zadania zgłoszone do silnika, nie działania użytkownika. Żądanie wysłane jako drugie może dotrzeć jako pierwsze. Przy operacjach zależnych od kolejności trzeba uwzględnić numery operacji albo czekać na potwierdzenie poprzedniej.

Sam brak odpowiedzi nie mówi, czy zapis się wykonał. W przykładzie licznika A zapisuje 11, ale odpowiedź ginie lub wtyczka przekracza limit czasu. Użytkownik klika „Ponów”, a ponowienie zwiększa licznik do 12. Jedno zamierzone kliknięcie zostało policzone dwukrotnie — nawet bez współbieżności.

Rozwiązaniem jest identyfikator operacji: klient tworzy go przed pierwszą próbą i zachowuje przy ponowieniach. Backend zapamiętuje wykonane identyfikatory wraz z wynikiem i nie wykonuje ponownie tej samej zmiany. Sprawdzenie identyfikatora i zapis stanu muszą podlegać tej samej ochronie przed współbieżnością. Nie jest to automatyczna funkcja silnika; trzeba ją zaimplementować we wtyczce.

Kolejka nie rozwiązuje też konfliktu dwóch otwartych formularzy. Oba mogą zawierać stan z chwili otwarcia, a późniejszy zapis nadpisać zmiany z pierwszej karty. Dla takich edytorów dodaj numer rewizji: formularz wysyła wersję, którą edytował, a backend pod ochroną kolejki lub blokady porównuje ją z aktualną. W razie różnicy zwraca konflikt (np. 409), zamiast nadpisywać plik. Wtyczka przygotowuje ten mechanizm samodzielnie.

### Jak wybrać ustawienie

Zacznij od `concurrent: false`, jeśli wtyczka zapisuje wspólne pliki. Włącz `true`, gdy potrafisz wskazać, dlaczego żądania nie wejdą sobie w drogę — np. tylko odczytują niezmienne raporty albo zapisują niezależne wyniki pod unikalnymi nazwami. Sprawdź też, czy pozorny odczyt nie tworzy cache, nie inicjalizuje pliku lub nie odzyskuje przerwanej operacji.

Przed wdrożeniem wyślij kilka jednoczesnych żądań i sprawdź końcową zawartość pliku, nie tylko statusy HTTP. Dla licznika startującego od 0 dziesięć różnych, zakończonych zapisów powinno dać 10. Osobno sprawdź ponowienie tego samego identyfikatora, nieaktualną rewizję oraz awarię pomiędzy etapami zapisu. Testy uruchamiaj na tymczasowych danych, nigdy na produkcyjnym stanie.

## Gdzie przechowywać dane

Stan zapisuj w `context.storageDir`. W razie potrzeby utwórz katalog przez `mkdir({recursive:true})`. Kompletny przykład odczytu, sprawdzenia danych i atomowego zapisu znajdziesz w `docs/plugins/example/index.ts`.

Wszystkie strony korzystające z danej wtyczki współdzielą `storageDir`. Jeśli chcesz rozdzielić stan stron lub zasobów, użyj bezpiecznego, powtarzalnego klucza, np. skrótu `page.href`. Nie używaj jako ścieżki niesprawdzonej wartości z URL.

Katalog stanu nie jest dostępny przez HTTP. Danych, które mają przetrwać restart, nie przechowuj w zmiennych globalnych workera ani w cache na tmpfs.

Pliki przeznaczone do publicznego pobierania umieszczaj w `content/media`. Silnik obsługuje PNG/JPEG/WebP/GIF, MOV/MP4/WebM, MP3/OGG, WOFF2 oraz HTML z osobną polityką CSP sandbox. Nie udostępnia automatycznie plików JSON, TS ani Edge.

Własne pliki wtyczki możesz odczytywać przez API Node. `PluginContext` nie ma metod do edycji metadanych stron, galerii i kont ani do czyszczenia cache. Jeśli inne narzędzie zapisze poprawny plik w `pages` w sposób atomowy, silnik wykryje zmianę przy odświeżeniu cache.

## Limity rozmiaru i kolejki

- Manifest: 4096 znaków.
- Źródłowy klient publiczny/admin: 256 000 bajtów każdy przed bundlowaniem.
- Zserializowany artefakt: 8 000 000 bajtów.
- Wyrenderowany HTML: 2 000 000 bajtów.
- Wynik inny niż widok: 4 000 000 bajtów po zamianie na JSON; po sprawdzeniu rozmiaru silnik sprawdza poprawność odpowiedzi.
- Kolejka: do 128 zadań, w tym maksymalnie 48 oczekujących na tę samą wtyczkę. Mechanizm wykonujący zadania dodatkowo ogranicza ich łączną liczbę (oczekujących i wykonywanych) do 128.
- Czas oczekiwania w kolejce: 10 s plus limit czasu wykonania wtyczki. Limit uruchomienia workera: 10 s.

Zwracaj dane, które można zapisać jako JSON: zwykłe obiekty, tablice, tekst, liczby, wartości logiczne i `null`. Wartości `BigInt` wymagają konwersji; unikaj cyklicznych odwołań, funkcji i uchwytów do zasobów. Pamiętaj, że worker izoluje wykonanie, ale nie stanowi zabezpieczenia do uruchamiania niezaufanego kodu.
