---
title: Tworzenie wtyczki
format: markdown
showSubpages: false
---
Wtyczka pozwala dodać do strony własną logikę w TypeScript lub JavaScript. Jej pliki umieszczasz w podmontowanym katalogu `content/plugins/<nazwa>`. W nazwie używaj małych liter ASCII, cyfr i myślników. Instaluj tylko kod od zaufanych autorów — wtyczki mają dostęp do plików serwera.

Galeria i panel edycji są częścią silnika i nie wymagają wtyczek.

```text
content/
  pages/example.md
  plugins/example/
    plugin.json        # wymagany manifest z numerem wersji
    index.ts           # wymagane: handler backendowy (lub index.js)
    views/public.edge  # dowolne widoki .edge i ich podkatalogi
    views/admin.edge
    client.ts          # opcjonalny publiczny Web Worker (lub client.js)
    style.css          # opcjonalny publiczny CSS
    assets/            # opcjonalne obrazy, fonty i pozostałe pliki publiczne
      logo.webp
    admin.ts           # opcjonalny prywatny Web Worker (lub admin.js)
    admin.css          # opcjonalny prywatny CSS
    package.json       # opcjonalne zależności wtyczki
    package-lock.json
    node_modules/
  state/example/       # prywatne dane robocze, tworzone przez wtyczkę
  media/               # publiczne media, obsługiwane przez silnik
```

Minimalny `plugin.json`:

```json
{ "version": "1", "concurrent": false, "admin": false }
```

Pole `version` jest wymagane. Jego wartość musi mieć od 1 do 64 znaków i zaczynać się od litery ASCII lub cyfry. Dalej możesz używać także kropek, podkreśleń i myślników.

Pola `concurrent` i `admin` są opcjonalne; oba domyślnie mają wartość `false`. Manifest nie przyjmuje innych kluczy.

Strona `pages/example.md`:

```yaml
---
title: Przykład
format: markdown
plugin: example
pluginPlacement: after
---
To jest zwykła **treść strony**.
```

Handler `index.ts`:

```ts
export default async function render(context) {
  if (context.suffix || !['GET', 'HEAD'].includes(context.method)) {
    return { type: 'json', status: 404, data: { error: 'Nie znaleziono' } };
  }
  return {
    type: 'view',
    template: 'views/public.edge',
    data: { title: context.page.title },
  };
}
```

Widok `views/public.edge`:

```edge
<p>{{ title }}</p>
```

Funkcję obsługującą żądanie (handler) udostępnij przez `export default`. Może być synchroniczna lub asynchroniczna. Zwraca widok albo JSON; kierowaniem żądań i wysyłaniem odpowiedzi zajmuje się silnik. Handler nie otrzymuje instancji Fastify ani obiektu `reply`.

Pełne definicje `PluginContext` i `PluginResponse` znajdziesz w `karui/src/plugins/contracts.ts`. Do opisania odpowiedzi handlera używaj `PluginResponse`. Typ `PluginResult` służy silnikowi do przechowywania wyniku po wyrenderowaniu widoku.

Przykład w tym repozytorium importuje typy przez ścieżkę względną do pliku silnika. Kompilator usuwa ten import. Jeśli rozwijasz wtyczkę w osobnym repozytorium, możesz przechowywać definicje typów lokalnie; nie importuj kodu silnika do wykonania podczas pracy wtyczki.

Pliki `.ts` mają pierwszeństwo przed odpowiadającymi im plikami `.js`. Kompilator dołącza lokalnie importowane pliki backendu do wspólnego pliku wynikowego. Zawartość `assets/` również należy do wersji wtyczki. Aby opublikować zmieniony kod lub zasób, [zwiększ wersję wtyczki](/plugins/runtime) — samo zapisanie źródeł nie wywołuje ponownej kompilacji.
