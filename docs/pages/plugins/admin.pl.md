---
title: Administracja wtyczki
format: markdown
---
## Włączenie

Dodaj `"admin": true` do `plugin.json` i zwiększ `version`. W edytorze strony, do której przypisano wtyczkę, pojawi się odnośnik „Ustawienia administracyjne wtyczki”. Jeśli dopiero wybierasz wtyczkę z listy, najpierw zapisz stronę — odnośnik korzysta z zapisanego przypisania.

Ten sam handler obsługuje stronę publiczną i administrację. Na początku funkcji sprawdź tryb:

```ts
export default async function render(context) {
  if (context.mode === 'admin') return renderAdmin(context);
  return renderPublic(context);
}
```

Silnik ustala tryb po sprawdzeniu sesji panelu. `context.admin` zawiera login, rolę i CSRF, ale nie hasło ani cookie. Obie role panelu (`owner`, `admin`) mogą wejść do administracji przypisanego wtyczki; jeśli jakaś akcja jest wyłącznie dla właściciela, sprawdź `context.admin.role === 'owner'` wewnątrz wtyczki.

Część administracyjna otwiera się pod osobnym adresem. Nie uruchamia się przy wejściu na publiczną stronę ani przy otwarciu jej edytora. Wtyczka musi mieć poprawny manifest z `admin: true` i być przypisana do wskazanej strony. Sama strona może być niepublikowana.

## Formularz bez JavaScript

Handler może przekazać do widoku:

```ts
const action = context.basePath + '?path=' + encodeURIComponent(context.page.href);
return {
  type: 'view', template: 'views/admin.edge',
  data: { action, csrf: context.admin.csrf, message: '' },
  styles: 'admin.css',
};
```

```edge
<form method="post" action="{{ action }}">
  <input type="hidden" name="_csrf" value="{{ csrf }}">
  <label>Wiadomość <input name="message" value="{{ message }}" maxlength="200"></label>
  <button type="submit">Zapisz</button>
</form>
```

Przy obsłudze `POST` sprawdź `context.method`, `suffix` i zawartość `context.body`. Po zapisaniu danych zwróć widok z potwierdzeniem lub odpowiedź JSON. Nie zapisuj danych przy żądaniach `GET` i `HEAD`.

Panel sprawdza pole `_csrf` przed uruchomieniem handlera. Jeśli formularz ma być wysyłany zwykłym żądaniem POST, nie dodawaj `data-action` do przycisku wysyłania — ten atrybut przekierowałby kliknięcie do workera klienta.

## Interakcje w części administracyjnej

Zwróć `client: 'admin.ts'`, aby dołączyć skrypt administracyjny. Działa on jako Web Worker, bez bezpośredniego dostępu do DOM, tak samo jak klient publiczny. Możesz też współdzielić kod w `client.ts`, ale nie umieszczaj w nim sekretów. Uprawnienia sprawdzaj na serwerze — samo ukrycie przycisku nie blokuje wykonania akcji.

Przekaż do `[data-context]` tylko potrzebne dane, np. `{ endpoint, csrf }`. Endpoint:

```ts
const endpoint = context.basePath + '/save?path=' + encodeURIComponent(context.page.href);
```

Żądanie wysłane przez workera:

```ts
const response = await fetch(endpoint, {
  method: 'POST', credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ message: 'Nowa wiadomość' }),
});
```

Wysyłaj żądanie pod ten sam origin, czyli ten sam protokół, host i port. Przeglądarka automatycznie dołączy cookie sesji oznaczone jako HttpOnly. Worker nie potrzebuje jego wartości i nie ma do niej dostępu. Token CSRF przekaż wyłącznie klientowi widoku administracyjnego.

Po wygaśnięciu sesji lub wylogowaniu serwer odrzuci kolejne żądania ze statusem 401. Wtedy odśwież widok i zaloguj się ponownie.

## Ochrona i izolacja

Trasy `/panel/plugins/...` i `/panel/plugin-assets/...` korzystają z zabezpieczeń panelu: sprawdzania sesji, nagłówków `Cache-Control: no-store` i `X-Robots-Tag: noindex, nofollow` oraz polityki CSP. Każda metoda poza `GET` i `HEAD` wymaga tokenu CSRF. Żądania z obcych witryn są blokowane. Jeśli ustawiono `PANEL_ORIGIN`, panel sprawdza też przesłany nagłówek `Origin`.

Publiczna trasa `/plugin-assets` nie udostępnia plików `admin.ts`, `admin.js` ani `admin.css`.

Nie ustalaj uprawnień na podstawie parametrów URL. Dodanie `mode`, `admin` lub `path` do publicznego adresu nie czyni użytkownika administratorem. Korzystaj z trybu i danych sesji przekazanych przez silnik.

Prywatnych plików nie umieszczaj w `/media`, a danych z `context.admin` nie zwracaj w publicznym API. Także do widoku administracyjnego przekazuj tylko te dane, których potrzebuje.

Kod administracyjny korzysta z tej samej puli workerów, limitu czasu i zasad współbieżności co kod publiczny. Awaria wtyczki kończy żądanie odpowiedzią 503, ale nie zatrzymuje panelu.

Osobny worker pozwala przerwać zawieszoną wtyczkę, lecz nie ogranicza jej uprawnień do plików. Wtyczka może czytać pliki dostępne użytkownikowi procesu. Dlatego kod backendu, HTML i style muszą pochodzić od zaufanych autorów.

## Przykładowe konto tylko dla dokumentacji

Lokalnie:

```sh
CONTENT_DIR=./docs npm run panel:init -- docs-admin
```

W kontenerze dokumentacji:

```sh
docker compose -f docker-compose.docs.yml exec docs node scripts/panel-account.ts docs-admin
```

Przed utworzeniem konta zbuduj silnik. Polecenie poprosi o hasło; utwórz osobne konto dla dokumentacji, zamiast kopiować konta produkcyjne. Zaloguj się pod `/panel` w instancji dokumentacji, a następnie otwórz [administrację przykładu](/panel/plugins/example?path=%2Fdemo).

W konfiguracji Docker pliki dokumentacji i wtyczek są tylko do odczytu. Dane przykładu i konta zapisują się w osobno podmontowanym `docs/state`. Treść dokumentacji edytuj w plikach na hoście — panel nie może jej zapisać w tym trybie.
