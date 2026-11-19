# Prepared supervised rollout and Tele isolation

Prepared only. No HTTP client, credential reader, n8n mutation or GitHub dispatch
is implemented or performed by this package. The current authorization permits
preparation and offline tests, not changes to active n8n, a model or finalizer.

## Reviewed sources, 2026-11-09

`rollout-preview.json` binds the shared ownership registry, both producer
versions, complete MCP-visible graph hashes before/after the four reviewed
parameter changes and a digest of all current Tele branch/tag tips. The manifest also binds the loaded rollout/compiler implementation hashes.
It contains operations and hashes, never full source configurations or credentials.
Private temporary full configurations were deleted after deriving the manifest.
`rollout-readiness.json` records the observed versions and limitations.

Tele still has active definitions 271334799 (ai-plan.yml) and 273082025
(ai-impl.yml). The prepared isolation disables those repository workflow IDs,
without editing master, development or the release branch, changing v1 or
triggering a client mirror. It pauses AI planning/implementation for other Tele
issues too. It does not revoke organization credentials or prevent a new,
arbitrary workflow from using them. A changed ref inventory halts the plan;
this is containment of the known old entry points, not a repository security sandbox.

GitHub states that disabling prevents triggering but does not cancel existing
runs. The plan never treats a disabled workflow as proof that work has drained.
Source: [GitHub workflow disable/enable](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows).

## Explicit order

1. Future separate authorization must bind the exact plan digest, expire within
   one hour and acknowledge an exclusive supervised editing window, shared
   producer pause and Tele AI pause. No event, issue, PR prose or model supplies
   authority. The test authorization objects are synthetic, not human approvals.
2. Pause both n8n producers and read back inactive state, no active version and
   unchanged draft configuration. Pausing affects all AI Dev projects using them.
3. Disable only the two Tele workflow IDs and verify each identity/path and
   disabled_manually state. No enable, cancel or source push is generated.
4. Read complete in-flight inventories for both platforms. Any running, queued,
   waiting, unknown or incomplete result blocks staging. Do not cancel work
   automatically or use the whole live dispatcher as a test.
5. Stage the four reviewed parameters while producers remain paused and Tele
   remains disabled. Read back the complete candidate graph and actual new
   draft version IDs. Changed unrelated settings, graph, credential references,
   unexpected draft or registry material fail closed.
6. Stop with reviewed drafts paused unless publication is separately authorized.
   Publication also requires matched evidence of failure-monitor delivery/readback
   and acknowledgement that resuming shared producers can classify ordinary
   legacy work using a paid model. No model test is part of this acceptance.
7. Propose publication of the exact draft version read back in step 5, never
   whatever draft happens to be latest. Require exact active-version and graph
   readback; the publish API response alone is insufficient. Tele remains disabled.

n8n distinguishes drafts from published versions and publishing is asynchronous.
The MCP publish tool accepts an explicit versionId; the planner emits that
version. It does not change workflow settings, which can themselves trigger
republication. Source: [n8n save/publish](https://docs.n8n.io/build/understand-workflows/save-and-publish-workflows/).

## Persistence, restart and concurrency

`Journal.initialize(root, plan)` is an explicit one-time operation in an
existing absolute owner-only directory. Normal execution refuses missing state,
unsafe permissions, symlink state or another plan digest; it never silently
initializes/replaces recovery history. JSON records are private, fsynced and
replaced atomically. One cooperating process owns an O_EXCL lease.

`Rollout.next(observation, grant, now)` returns one manual proposal at a time.
It commits an intent before returning it. A second caller, restart or lost API
response cannot obtain that operation again: it can only reconcile fresh
readback or remain uncertain. A crashed lease is never stolen by timeout/PID.
Reconcile existing intent and process ownership under supervision before any
manual lease recovery. No clearing state to force another attempt.

The observations must come from trusted authenticated readers, not an incoming
webhook. Normalize the full active/draft graph, preserve complete pagination of
refs and all in-flight states, and compute hashes with this module. An empty
array without a verified complete read is not evidence. Observations expire
at 30 seconds. Read again immediately before delivering each proposed operation;
a queued manual proposal is not a permanent execution permit.

## Concrete remaining limits

- The journal coordinates our own cooperating executor only. It does not lock
  the n8n UI, other users or other tools. The mutation tool has no compare-and-swap
  expected-version parameter. An exclusive supervised window and fresh checks
  are required; this is not an autonomous, atomic cross-platform deployer.
- There is no authenticated reader/executor adapter in this package. Action
  descriptors and synthetic grants do not grant permission or execute an API.
- Both producer configurations currently have no assigned errorWorkflow. An
  external monitor might exist, but delivery/readback evidence was not verified.
  Publication therefore stays blocked until that evidence is reviewed. We did
  not create or activate an error workflow to manufacture acceptance.
- Partial stop/stage/publication or drift keeps containment. `containment(plan)`
  only proposes producer pause and Tele disable. It never restores unsafe code,
  re-enables old entry points, deletes claims or resumes schedules automatically.
- GitHub disable cannot fence an execution already running; n8n pause cannot
  undo an effect already performed. Preserve all uncertain runs for reconciliation.
- Hashes cover MCP-visible configuration and credential references, not secret
  values hidden by the platform. No credential is read or copied by the planner.

## Offline acceptance

Tests simulate pause, disable, drain, stage, explicit publication and readback
without a model or network. They cover partial/lost responses, restart before
and after delivery, running/waiting work, stale/incomplete inventories, changed
refs or versions, unpublished drafts, missing monitoring, expired/wrong authority,
permissions/symlinks, crashed leases, containment and six competing OS processes.
Run `node --test tools/development-admission/*.test.cjs`.

No live safety, delivery or autonomous acceptance is inferred from these tests.
Tele release acceptance remains at the next planned release. The completed
GAL-1881 and Shared admission probe must not be replayed.

## Aktualizacja GAL-1862 — 17.11.2026

Rejestr zawiera UUID `94a12e23-8b83-4836-ac78-86c2f639e4cf` i klucz
`GAL-1862` dla `smartsoft001/galena-tele`. Stan Linear odczytano jako
Backlog bez etykiet. Wpis rezerwuje sprawę dla przygotowywanego pilota.
Akcja admission jest przypięta do commita
`566ab8c81ca674dbf2c7eab136dda3e85faaf35f`, zawierającego nowy rejestr.

Przeliczony plan ma digest
`c3a3c0b19962d621dbd0788f623b432ec937c4864f67c8754c215099ec7bfdec`.
Odczyt SQLite read-only potwierdził bazowe wersje obu producentów i zgodne
wykonywalne grafy. W historii workflowów nazwa jest inna od bieżącej nazwy
rekordu, dlatego porównano graf z nazwą bieżącą. Ref inventory obejmuje
48 gałęzi i 292 tagi, zgodne przy powtórnym odczycie.

162 testy Python i 79 Node PASS. Obie propozycje filtrów n8n blokują sprawy
rejestru bez etykiet. Brama GitHub blokuje GAL-1862 przed odczytem Linear
także przy obcym repo, a ten sam UUID z innym kluczem zatrzymuje po
odczycie. Testy rolloutu obejmują wyłączenie obu wejść Tele przed stagingiem,
weryfikację prac w toku oraz blokadę po ponownym włączeniu wejścia.

Odczytane wrappery Tele nadal wywołują Shared `@v1`
(`866b257a58acbcbd91adfb5da6e4036696ed1844`). Oba są aktywne. Kod v1
uruchamia model bez bramy ownership. Samo scalenie tego pakietu nie
przełącza tych wrapperów ani aktywnych grafów n8n. Publikacja nowego pilota
wymaga rzeczywistego odcięcia starych wejść i świeżego odczytu. Nie
uruchomiono modelu, dispatchu, zmian produkcyjnych ani finalizatora.

## 19.11 — poprawiony format operacji MCP

Operacje stagingu używają teraz `updateNodeParameters`, `parameters` z jednym
polem i `replace:false`. Poprzednie `setNodeParameter` z gołą ścieżką pola
zostało odrzucone przez MCP podczas osobnej poprawki obserwatora. Ten pakiet
nie próbuje takiego zapisu na producentach. Aktualizowanie jednego pola przez
merge zostało zastosowane przy tej osobnej, zatwierdzonej poprawce; akceptacja
zapisu dokładnie tych czterech zmian pozostaje do okna stagingu.

Wynikowy graf obu kandydatów jest niezmieniony. Zmiana reprezentacji operacji
i kompilatora zmienia jednak digest planu na
`25305882ecac0b439125038e0e22909bf745900d8f8e32d81434dd2ea0792dae`.
Starego digestu `c3a3c0b1…` nie wolno użyć do tej wersji.

`node tools/development-admission/rehearse-stage.cjs` przeprowadza pełną próbę
**w lokalnym katalogu tymczasowym** na aktualnym `rollout-preview.json`.
Bez zgody nie powstaje intencja. Syntetyczna zgoda na staging pozwala zasymulować
pauzę obu producentów, odcięcie obu wejść Tele i dwie aktualizacje draftów.
Po każdym z sześciu kroków restart z utraconą odpowiedzią nie ponawia operacji.
Próba kończy się `staged-paused-awaiting-publication-approval`. Nie wywołuje
API, modelu ani finalizatora; nie jest rzeczywistą zgodą ani testem MCP.
Próba jest uruchamiana również w Shared offline CI.

GAL-1862 ma już In Progress/AI Plan i zapisany plan. Historycznej rezerwacji
nie usuwać ani nie traktować jako zgody na ponowny start. Wpis własności
pozostaje do uzgodnienia przed scaleniem rejestru i wyborem nowego pilota.
