# Normalizacja odczytów do planisty — przygotowanie offline

`rollout-observation.cjs` udostępnia `observe(plan, sources, now)`.
Nie ma klienta API, odczytu credentials, zapisu, rezerwacji ani publikacji.
Nie jest podłączony do wykonawcy produkcyjnego. Nie uruchamia modelu.

Wejście może dostarczyć wyłącznie zaufany operator lub przyszły, osobno
odebrany adapter uwierzytelniony. Dane z modelu, webhooka, issue czy PR nie
są dowodem odczytu. Moduł sprawdza spójność struktur; nie potwierdza sam
pochodzenia, kompletności faktycznej kwerendy ani autoryzacji człowieka.

## Kontrakt wejścia

Wszystkie trzy grupy wymagają `observed_at` jako sekundy Unix. Każdy odczyt
musi być w przedziale od teraz minus 30 sekund do teraz. Ustawić moment
rozpoczęcia całej kolekcji danej grupy, nie czas późniejszego złożenia JSON.

- `n8n`: `workflows` — dwa pełne get_workflow_details.workflow z dokładnymi
  ID planu, nodes/connections/settings/nodeGroups i jawne activeVersion.
  `sameAsDraft` wolno zadeklarować tylko po weryfikacji platformy, bez
  wymyślania na podstawie samego statusu active. `execution_scope` obejmuje
  oba ID. `executions` to komplet rekordów id/workflowId/status w zadanym
  zakresie, `total_count` potwierdza odczytaną liczbę. Przyszły reader może
  pomijać tylko znane terminalne success/error/canceled/crashed; nie filtrować
  kwerendy wyłącznie na running/new/waiting, bo zgubiłaby unknown.
- `github`: dokładne `repository`, dwa rekordy workflow id/path/state oraz
  `run_inventories` osobno dla każdego `workflow_id`. Każdy ma `pages`:
  odpowiedzi list runs z `total_count` i `workflow_runs`. Wymagana co
  najmniej jedna odpowiedź także dla zera. Sumy stron muszą być zgodne,
  bez duplikatów run id i rekordów innego workflowu. Czytnik ma zachować
  wszystkie strony i filtry zapytania. Osiągnięcie limitu API bez pełnej
  liczby rekordów jest niepełnym odczytem i ma przerwać zbieranie.
- `refs`: dwie kompletne listy `before` i `after`, rekordy ref/sha dla
  refs/heads i refs/tags, bez peeled refs i duplikatów. Różnica w trakcie
  kolekcji blokuje wynik. Porównanie z digestem zatwierdzonego planu
  wykonuje potem dotychczasowy Rollout.next.

Wynik zawiera hashe oddzielnie dla grafu aktywnego i draftu, dokładne
wersje, stany Tele oraz kompletne listy prac w toku. Status GitHub inny
niż completed i nieznany status n8n pozostają blokadą drain. Wynik nie
zawiera pełnych nodes, settings, credentiali ani tytułów zadań. Monitor
receipt celowo nie jest kopiowany z wejścia: osobny dowód wymaga przeglądu.

## Dowody i otwarte podłączenie

12 testów obejmuje paginację, duplikaty, pusty/niepełny zakres, zmianę
refów, nieznane statusy, inny graf draftu i aktywnej wersji, brak uprawnień
wykonawczych oraz integrację z istniejącym dziennikiem. Oczekujący run
GitHub kończy symulację na waiting-for-drain przed stagingiem. Pełny
pakiet admission: 93 testy Node PASS. Bez API, modelu i zmiany produkcji.

Do następnego etapu pozostaje przypięty, uwierzytelniony reader i odbiór
rzeczywistych pełnych odpowiedzi z n8n/GitHub. Nie wpisywać complete=true
z ręcznie pustej tablicy. Rejestr i kompilator nie zmieniają się, więc digest
planu 25305882… jest ten sam; wersja adaptera jest osobnym materiałem do
review i nie jest jeszcze częścią wdrożonego czytnika ani upoważnienia.
Publikacja producentów i skutki modelu nadal osobno zatwierdzane.
