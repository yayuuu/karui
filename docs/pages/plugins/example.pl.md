---
title: Przykładowa wtyczka z administracją
format: markdown
plugin: example
pluginPlacement: content
showSubpages: false
---
Ten akapit pochodzi z `docs/pages/plugins/example.md`, ale **renderuje go wtyczka**.

Wtyczka zastępuje znacznik w treści wiadomością z ustawień: **[[notice]]**.

Kod przykładu znajdziesz w `docs/plugins/example`. Kliknięcie przycisku poniżej trafia do publicznego Web Workera. Worker odsyła polecenie zmiany tekstu, które silnik wykonuje na stronie.

Możesz porównać dwa sposoby przechowywania danych: licznik kliknięć działa tylko do opuszczenia strony, a licznik w administracji zapisuje się w `state/example/settings.json`. Zapisany licznik jest wspólny dla wszystkich stron korzystających z tej wtyczki.

[Instrukcja uruchomienia administracji](/plugins/admin) · [Publiczne API statusu](/plugins/example/api/status)
