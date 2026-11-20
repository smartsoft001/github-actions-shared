# Uwierzytelniony czytnik operatora — bez wykonawcy

Przygotowany do nadzorowanego uruchomienia na Macu operatora. Nie jest
usługą, harmonogramem ani elementem aktywnego workflowu n8n. Korzysta
wyłącznie z istniejących dostępów `gh` do github.com i `kubectl --context
smartsoft`, namespace n8n. Nie tworzy ani nie przenosi kluczy. Te dostępy
mogą mieć szersze prawa; kod używa tylko odczytów, nie jest nowym kontem
serwisowym o ograniczonych uprawnieniach.

```bash
node tools/development-admission/rollout-reader.cjs --read-only
```

Cel repozytorium, klaster, namespace, deployment, kontener i ID workflowów
są przypięte w kodzie/planie. Żaden URL, kod, token czy polecenie z webhooka,
zgłoszenia lub modelu nie jest wykonywane. Błąd transportu, brak logowania,
truncation lub przekroczenie świeżości kończy odczyt jako blocked, bez
fallbacku, resetu, modelu lub ponowienia mutacji. W narzędziu nie ma klienta
zapisu, Journal, Decision ani Rollout.next.

GitHub: odczyt dwóch definicji, pełne `gh api --paginate --slurp` runs dla
każdej, porównanie liczby stron/rekordów z total_count przez normalizator.
Refy: dwukrotny git ls-remote --refs tylko do galena-tele; zmiana blokuje wynik.

n8n: kubectl exec uruchamia stały helper Node. SQLite jest otwierane z
readOnly=true i PRAGMA query_only=ON w jednej transakcji. Odczytywane są
wyłącznie dwa workflowy, ich wersje z workflow_history i niekońcowe stany
execution_entity, w tym unknown/NULL. Nie ma odczytu credentials_entity ani
execution_data. Nazwę historyczną normalizujemy do bieżącej nazwy rekordu,
zgodnie z wcześniejszym odczytem. Graf publikacji pochodzi z historii,
nie z założenia, że identyczne versionId gwarantują identyczny kod.

Pełne grafy przechodzą prywatnymi pipe'ami tylko przez pamięć rodzica.
Nie uruchamiać rollout-read-n8n.cjs bezpośrednio do terminala/pliku/logu.
CLI drukuje wyłącznie znormalizowane hashe, wersje, metadane kolejki,
liczniki i hash trzech załadowanych plików readera. Błędy nie drukują
odpowiedzi procesu ani komend z prywatną treścią. Plik receipt zawiera
wyłącznie taki bezpieczny raport; nie jest upoważnieniem do zmiany.

## Odbiór 19.11

[Raport rzeczywistego odczytu](rollout-reader-receipt.json): 8,013 s,
340 stabilnych refów, 130 runs planowania na dwóch stronach i 24 runs
implementacji na jednej. Zero prac w toku dla obu platform. Obie wersje
producentów i hashe aktywnych/roboczych grafów zgodne z bazą planu.
Dwa wejścia Tele nadal active. Plan 25305882… nie zmienił się.
99 testów Node PASS: 93 dotychczasowe i 6 testów czytnika, w tym rzeczywisty
helper SQLite w izolowanej bazie bez tabel credentials/execution_data.
CI jawnie używa Node 24 z przypiętym setup-node.

Odczyty są ważne najwyżej 30 sekund i nie są atomowym snapshotem między
platformami. Zmiany mogą zajść po odczycie. Przed każdym skutkiem wymagana
świeża kolekcja i nadzorowane okno bez równoległych edycji, zgodnie z ROLLOUT.md.
Czytnik nie sprawdza odbioru alertu i nie dopisuje dowodu monitoringu.
Nie jest podłączony do planisty live, nie publikuje ani nie pauzuje producentów.

Shared #24 i Development #46 scalone; repozytoria na ai-os-server
zsynchronizowane. Ten nowy czytnik pozostaje pakietem do review. Na
ai-os-server brak kubectl; nie instalowano go ani nie kopiowano kubeconfigu.
Zdalne uruchomienie wymaga osobnego rozwiązania dostępu, jeżeli będzie potrzebne.
Odbiór alertu do naturalnej próby, bez modelu i aktywacji finalizatora.
