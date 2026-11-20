# Sprawdzenie planu przed decyzją — bez skutków produkcyjnych

```bash
node tools/development-admission/rollout-preflight.cjs --read-only
```

Narzędzie łączy istniejący uwierzytelniony reader z Rollout.next,
przekazując zawsze `grant=null`. Nie przyjmuje pliku zgody, Decision,
argumentów publikacji ani grantów z odpowiedzi readera. W prywatnym
katalogu tymczasowym inicjalizuje **roboczy** Journal, sprawdza bazowy stan
przez istniejący planista i potwierdza brak intencji. Po próbie usuwa katalog.
Nie jest to dziennik odzyskiwania przyszłego rzeczywistego przełączenia;
nie wolno używać tej inicjalizacji jako sposobu resetowania rolloutów.

Odrzuca inny digest planu, niewłaściwe flagi readera, stare źródło,
zmienioną wersję/ref/graf i niepełne kolejki. Raport wskazuje osobno, czy
kolejki były puste. Zajęta kolejka nie jest upoważnieniem do anulowania;
przed przyszłym stagingiem nadal obowiązuje drain. Odświeżenie źródeł nie
gwarantuje atomowości między platformami ani blokady UI innych operatorów.

## Wynik 20.11

[Receipt](rollout-preflight-receipt.json): baseline-verified-awaiting-authorization,
zatrzymanie przed pause:Kj0Bm4Q2XnRtKsn1, zero intencji, grantów, mutacji
i wywołań modelu. Kolejki puste w chwili kolekcji. 340 stabilnych refów,
130/24 runs z pełnych 2/1 stron. Plan nadal 25305882…. Historyczny receipt
wygasa jako źródło do operacji po 30 sekundach; nie jest zgodą na wykonanie.

Obaj producenci mają już availableInMCP=true (osobny odczyt readOnly).
Nie włączano MCP ani nie zapisywano ustawień. Właściwy transport zmian
może użyć istniejącego MCP po oddzielnej zgodzie, bez bezpośredniego
zapisu do SQLite. Czytnik n8n pozostaje wyłącznie query_only/readOnly.
Nie przygotowano ani nie uruchomiono automatycznego wykonawcy zmian.

104 testy Node PASS, w tym pięć nowych: zgodny plan bez grantu, odrzucone
flagi/digest, dryf/stare dane, kolejka niepełna lub zajęta i ignorowanie
przekazanego syntetycznego grantu. Testy nie kontaktują się z produkcją.
Rzeczywista próba korzystała z nadzorowanego Maca i istniejących dostępów.

## Materiał do kolejnej decyzji

Po review/scaleniu pakietu i synchronizacji można przygotować zgodę na
jedno okno stagingu. Musi wskazać dokładny SHA kodu i pełny digest
25305882ecac0b439125038e0e22909bf745900d8f8e32d81434dd2ea0792dae,
czas ważności <=1 h oraz zgodę na pauzę obu współdzielonych producentów
n8n i dwóch wejść AI Tele. W tym oknie bez równoległych edycji:

1. Świeży pełny odczyt i kontrola zgodności.
2. Pauza Kj0Bm4Q2XnRtKsn1 oraz YfyZaVDeZspB8VgK z odczytem skutku.
3. Disable wyłącznie Tele 271334799 i 273082025, następnie pełny drain.
4. Cztery parametry z manifestu, zgodny hash i dokładne nowe draft versionId.
5. Stop: obaj producenci w pauzie, Tele odcięte, bez publikacji.

Do rzeczywistej operacji utworzyć jawnie jeden trwały prywatny Journal
na nadzorowanym Macu, przypięty do planu, i zachować go przy utracie
odpowiedzi/restartach. Nie używać katalogu scratch preflightu ani czyścić
claimów, dziennika lub lease do wymuszenia ponowienia. Partial staging lub
dryf utrzymują containment; nie włączać starych wejść automatycznie.
Publikacja i wznowienie klasyfikatora/modelu wymagają osobnej decyzji oraz
dowodu monitoringu. Odbiór poprawionego alertu do naturalnej próby.

Ten pakiet nie wykonuje żadnego kroku powyżej, nie przerywa heartbeat,
nie wysyła alertu i nie aktywuje finalizatora. GAL-1862 ma istniejący plan;
nie przejmować ponownie. Brak nowego zakwalifikowanego pilota pozostaje
oddzielną otwartą sprawą, nie powodem do uruchomienia modelu.
