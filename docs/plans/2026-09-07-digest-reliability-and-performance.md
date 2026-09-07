# Plan implementacji i wdrożenia: szybszy digest i niezawodne podsumowanie AI

## 1. Instrukcja dla modelu przejmującego zadanie

Zaimplementuj opisane poniżej zmiany w repozytorium `daily-news-digest`. Celem jest skrócenie ścieżki generowania, ograniczenie liczby wywołań AI i zapewnienie, że przerwane podsumowanie zostanie wznowione bez otwartej przeglądarki. Realizuj kroki w podanej kolejności. Zachowaj istniejące zasady jakości źródeł, personalizacji i ochrony zapisanych wiadomości oraz notatek.

Ten dokument jest planem, nie zapisem wykonanej implementacji. Użytkownik zamówił audyt i plan przekazania drugiemu modelowi; produkcja, migracje i kod aplikacji nie zostały zmienione. W nowej sesji wykonuj zakres zlecony przez użytkownika. Sam plan nie jest zgodą na publikację na produkcji ani zmianę płatnego planu usług.

Repozytorium lokalne: `/Users/jakub/Desktop/n8n/daily-news-digest`.
Punkt odniesienia audytu: commit `f1a0ed8c62acf17baf13ddc420e985923516d6c9`, 2026-09-07.
Przed rozpoczęciem sprawdź aktualny HEAD i diff; nie nadpisuj późniejszych zmian użytkownika.

Przeczytaj `AGENTS.md`, `CONTEXT.md`, `README.md`, `docs/adr/0002-manual-first-digest-runs.md`, `docs/adr/0003-stage-aware-hosted-schema.md` oraz ADR dotyczący zamrożonego Source Portfolio. Do Supabase stosuj skill `supabase:supabase`, do modyfikacji Next.js `vercel:nextjs`, do deploymentu odpowiednie skille Vercel. Zweryfikuj bieżące API przed implementacją infrastruktury. Lokalny adres przeglądarki: `http://127.0.0.1:3000/`.

## 2. Stan potwierdzony i ograniczenia audytu

Aktualna kolejność etapów:

`source_fetch → article_normalization → story_clustering → enrichment → editorial_scoring → reader_publication → finalization`.

- Runtime to TypeScript/Next.js na Vercel, stan w Supabase. Nie przenoś rozwiązania do n8n na podstawie nazwy katalogu nadrzędnego.
- Uruchamianie jest manual-first. Cron `/api/digest-runs/advance` przesuwa istniejący przebieg; sam nie tworzy nowego digestu. Nie zmieniaj tego zachowania bez oddzielnego wymagania.
- Endpointy startu i advance mają `maxDuration = 120`. Pętla executor ma budżet 90 s, ale sprawdza go tylko między etapami. Etap uznaje się za porzucony po 150 s.
- Wyjście po `editorial_scoring` już daje publikacji świeże wywołanie funkcji. Zachowaj tę intencję przy zmianie granic etapów.
- Prompt AI prosi o krótki draft; walidator sprawdza długość pełnego briefingu. Rozwijanie dla DiffusionGemma dodaje równoległe zapytania dla leadu i sekcji.
- Rozwijanie po korekcie nie respektuje całkowitego limitu 100 s; ścieżka może zbliżyć się do 140 s AI, poza operacjami DB.
- Retry AI do trzech prób obejmuje cały `reader_publication`; model zastępczy jest wybierany w drugiej próbie. Błędy HTTP tracą typ i są zamieniane na `null`.
- Wiadomości publikują się przed AI, lecz nie ma trwałego, osobnego stanu generowania i przechowania jego wejścia/wyniku.
- Część błędów zapisu podsumowania jest ignorowana. `isDigestBriefSchemaError` rozpoznaje nawet samą nazwę tabeli w komunikacie.
- Brak kwalifikujących się źródeł, wyłączone AI i brak klucza są różnymi powodami pominięcia. Obecna metryka nie rozróżnia ich wystarczająco.
- Enrichment przetwarza do 40 artykułów, po 4 równolegle. Każda paczka ponownie czyta wszystkie kolumny wszystkich artykułów przebiegu. RSS już jest pobierany równolegle.
- Utworzenie `digest_runs` i etapów odbywa się w dwóch operacjach. Brak kolejnego queued etapu może prowadzić do sukcesu bez sprawdzenia kompletności i poprzedników.
- Finalizacja usuwa `source_items`, `story_snapshots`, `enrichment_records` i część tekstu artykułów. Późniejszy retry AI nie może od nich zależeć.
- Usunięcie `digest_runs` kaskadowo usuwa powiązane `digest_summaries`. Uwzględnij to w retencji nowych rekordów.

Uruchomiono 39 testów w 5 plikach: `ai-summary`, `digest-stage-executor`, `digest-run-continuation`, `reader-publication`, `enrichment`; wszystkie przeszły. To testy lokalne z mockami, nie pomiar niezawodności produkcji. Nie sprawdzono planu Vercel, wdrożonych migracji, rzeczywistych zmiennych, statystyk dostawcy ani logów. Nie obiecuj procentowego przyspieszenia bez pomiarów.

## 3. Docelowe zachowanie i niezmienniki

Nowe przebiegi wersji 2:

`source_fetch → article_normalization → story_clustering → enrichment → editorial_scoring → reader_publication → ai_brief → finalization`.

1. Publikacja wiadomości kończy się niezależnie od dostępności dostawcy AI.
2. `reader_publication` zapisuje trwałe wejście do AI i wersję awaryjną podsumowania, zanim oznaczy etap jako zakończony.
3. `ai_brief` wykonuje najwyżej jedno zapytanie dostawcy w jednym wywołaniu workera. Nie rozwija sekcji i nie koryguje odpowiedzi w tym samym wywołaniu.
4. Retry AI nie powtarza RSS, rankingu, enrichmentu, publikacji newsów ani aktualizacji tagów.
5. Stan w bazie jest źródłem prawdy. HTTP 202 oznacza przyjęcie sygnału, a nie wykonanie pracy. Samo `after()` nie daje trwałego harmonogramu.
6. Zadanie po utracie HTTP lub zabiciu funkcji wraca do wykonania przez niezależny watchdog. Poprawność nie zależy od karty czytnika.
7. Tylko właściciel aktualnej dzierżawy może zapisać wynik lub zmienić stan próby. Duplikaty dostarczenia są bezpieczne.
8. Nie deklaruj exactly-once dla zewnętrznego AI: crash po otrzymaniu odpowiedzi, ale przed trwałym zapisem, może wymusić kolejne zapytanie. Gwarantuj idempotentny zapis i ograniczoną liczbę prób.
9. Sukces przebiegu wymaga wszystkich etapów danej wersji i zapisanego końcowego podsumowania AI lub jawnej wersji awaryjnej. Brak tabeli lub błąd zapisu nie jest sukcesem.
10. UI osobno pokazuje wynik publikacji i syntezy. Sukces publikacji z fallbackiem nie może wyglądać jak sukces AI.
11. Pełny briefing nadal wymaga wiarygodnych danych; nie usuwaj filtra `limited`, aby sztucznie zwiększyć odsetek generacji.
12. Cleanup nie jest warunkiem dostępności gotowego digestu i nie usuwa danych niezbędnych do retry.

## 4. Kolejność prac i mapa plików

### Krok A — pomiary i wersjonowanie

- Dodaj wersję pipeline w metadanych przebiegu, np. `pipelineVersion: 2`; brak pola oznacza wersję 1. Nie wykorzystuj bez sprawdzenia istniejącego ogólnego `metadata.version`.
- Zmień listę/sortowanie etapów na zależne od wersji. Nieznany etap ma dawać jawny błąd kompatybilności, nie sortować się jako pierwszy.
- Zapisz ADR opisujący osobny etap AI, trwałe retry i watchdog. Zaktualizuj `CONTEXT.md`.
- Przygotuj metryki z sekcji 10; do porównań użyj tego samego zestawu artykułów i ustawień.
- Na początku odczytaj dostępne ostatnie przebiegi produkcji/stagingu, jeśli nowa sesja ma dostęp. Brak dostępu nie blokuje implementacji i testów lokalnych; oznacz brak pomiaru.

Pliki: `lib/digest-runs.ts`, `lib/digest-builder/types.ts`, `lib/digest-builder/stage-registry.ts`, dokumentacja.

### Krok B — migracje i atomowe operacje stanu

Zaprojektuj addytywną migrację; nie edytuj historycznych migracji. W repo są nazwy numeryczne i timestampy oraz niepełna lista w README. Najpierw sprawdź faktyczną historię migracji i używany proces, a nowy plik utwórz narzędziem migracji zgodnie z dostępnymi skillami. Nie wymyślaj kolejnego numeru.

Rozszerz CHECK nazw etapów o `ai_brief`. W `pipeline_stage_runs` dodaj:

| Pole | Znaczenie |
| --- | --- |
| `next_attempt_at timestamptz` | Najwcześniejsze ponowne wykonanie; null oznacza natychmiastową gotowość |
| `lease_token uuid` | Unikalny właściciel claimu |
| `lease_expires_at timestamptz` | Termin odzyskania po crashu |

Zachowaj `attempt_count` jako licznik claimów, a nie liczbę generacji AI. Paczki enrichmentu, recovery i próby zapisu także robią claimy.

Dodaj tabelę `digest_brief_jobs` z jednym rekordem na `digest_run_id` (PK/FK, spójna retencja). Minimalny kontrakt:

| Pole | Znaczenie |
| --- | --- |
| `input_payload jsonb` | Zamrożone wejście, kolejność źródeł, mapowanie referencji i ustawienia |
| `input_hash text`, `prompt_version text` | Identyfikacja wersji wejścia i promptu |
| `status text` | `pending`, `generating`, `retry_wait`, `generated`, `fallback`, `skipped`, `failed`, `cancelled` |
| `reason text` | Rozróżnialny powód fallbacku, skipu albo błędu |
| `generation_attempt_count integer` | Wyłącznie rozpoczęte próby wywołania dostawcy w bieżącym cyklu |
| `retry_cycle integer` | Osobny cykl jawnego manualnego retry, początkowo 0 |
| `candidate_payload jsonb` | Trwale zapisany poprawny wynik, który można opublikować bez ponownego AI |
| `model text`, `last_error_code text` | Pochodzenie wyniku i klasyfikacja błędu |
| `created_at`, `updated_at`, `completed_at` | Czas stanu i zakończenia |

`next_attempt_at` oraz dzierżawa pozostają tylko w etapie, aby nie tworzyć dwóch sprzecznych harmonogramów. Typy i CHECK wymuszają legalne statusy; input jest niezmienny po publikacji. Zadbaj o RLS i uprawnienia: surowe wejście i błędy dostępne tylko backendowi, UI dostaje ograniczony DTO stanu. Nie upubliczniaj tabeli przez szeroką politykę authenticated.

Dodaj metadane pochodzenia do `digest_summaries`: `generation_kind` (`ai`, `fallback`, `legacy`), `generation_reason`, `model`, `prompt_version`, `input_hash`. Stare rekordy oznacz `legacy`; nie zgaduj ich pochodzenia z tekstu. Stan pending/retry pochodzi z joba.

Wprowadź transakcyjne funkcje DB/RPC:

- utworzenie lub zwrot jednego aktywnego przebiegu wraz z pełną listą etapów;
- claim pierwszego niezakończonego etapu, wyłącznie po ukończeniu wymaganych poprzedników i po `next_attempt_at`, z atomowym nadaniem tokenu;
- zakończenie/requeue etapu z kontrolą tokenu oraz aktywnego statusu przebiegu;
- start próby AI: walidacja tokenu, zwiększenie generation counter i przejście joba do generating;
- zapis candidate z kontrolą tokenu;
- zatwierdzenie candidate do `digest_summaries`, stanu joba i etapu AI w jednej transakcji;
- atomowy reset/anulowanie/retry, bez okna, w którym worker może zobaczyć sprzeczne stany.

Worker z utraconym tokenem ma zakończyć pracę bez zapisu i bez failowania nowszej próby. Check obejmuje też anulowanie podczas AI. RPC muszą być dostępne wyłącznie właściwej roli backendowej; preferuj SECURITY INVOKER, jawnie sprawdź EXECUTE i search_path. Nie dodawaj ogólnej funkcji z podwyższonymi uprawnieniami dla klientów.

Ustal jednego właściciela zatwierdzania: executor wywołuje transakcyjne zatwierdzenie wyniku zwróconego przez runner. Rozszerz `StageResult` o jawny wariant rezultatu AI i requeue; nie pozwól, aby runner zakończył etap RPC, a dotychczasowy executor później bezwarunkowo nadpisał jego status i metryki. Przechowanie candidate podczas pracy jest oddzielnym checkpointem chronionym tokenem.

Indeksy: unikalność run/job; dostęp po run/stage; częściowe indeksy gotowych queued i wygasających running etapów, jeżeli plan zapytań uzasadnia ich dodanie. Zaktualizuj `lib/database.types.ts` sprawdzonym mechanizmem projektu i testuj zapytania na bazie testowej.

### Krok C — rozdzielenie publikacji i syntezy

Refaktor `lib/digest-builder/stage-runners/reader-publication.ts`:

1. Zachowaj deterministyczne tworzenie/upsert `news_items` i stabilne `story_cluster_id`.
2. Wydziel helper budujący zamrożone `BriefInputV1`, a nie drugi niezależny zestaw reguł wyboru.
3. Wejście zawiera listę maksymalnie 10 dopuszczonych artykułów, stabilny indeks, newsItemId, storyClusterId, tytuł, źródło, kategorię, treść, evidence, datę oraz kopię profilu zainteresowań. Limituj wszystkie pola i całkowity rozmiar.
4. Wybierz i przytnij wejście raz; hash licz po kanonicznej serializacji treści i ustawień wraz z prompt version. Nie mapuj później indeksów na zmienione newsy.
5. Zachowaj komplet danych referencji w input/candidate, aby retry nie zależało od bieżącego rankingu ani usuwanych snapshotów.
6. Zapisz fallback i job przed ukończeniem publication. Ponowienie tego kroku nie nadpisuje istniejącego zamrożonego inputu ani wygenerowanego AI fallbackiem. Konflikt innego hasha dla tego samego runa jest błędem, nie cichym overwrite.
7. Tagi aktualizuj paczkami lub z ograniczoną współbieżnością. Przenieś ich wzbogacanie do idempotentnej pracy pomocniczej, jeśli nie jest konieczne dla bieżącego wyboru. Błąd opcjonalnych tagów ma być widoczny, ale nie blokować syntezy.
8. Usuń wywołanie AI i cleanup retencji z nowej wersji publication.

Nowy `stage-runners/ai-brief.ts` ładuje job. Jeśli ma candidate, publikuje go bez API. Jeśli podsumowanie jest już zatwierdzone dla tego inputu, kończy idempotentnie. W pozostałych przypadkach wykonuje jedną próbę i stosuje retry z kroku E.

Nie zawężaj automatycznie publicznego feedu do 10 newsów: limit dotyczy wyłącznie wejścia do AI. Pokaż w coverage, ile materiałów rzeczywiście użyto i dlaczego inne pominięto, bez błędnego przypisywania wszystkiego do braku jakości.

### Krok D — prostsze generowanie i jednoznaczna walidacja

Pliki: `lib/ai-summary.ts`, `lib/ai-summary.test.ts`, `lib/digest-brief-text.ts` oraz nowe helpery, jeśli poprawiają czytelność.

- Usuń `expandTerseDiffusionGemmaBrief` z v2 i automatyczną korektę wewnątrz tej samej próby.
- Prompt od początku zamawia gotowy tekst. Dla co najmniej 3 wystarczająco opisanych historii docelowo 350–550 słów widocznych dla czytelnika. 3–4 sekcje są celem redakcyjnym, nie pretekstem do sztucznego dzielenia 1–2 historii. Przy małym inputcie zamów krótszy briefing i 1–2 sekcje.
- Nie zmuszaj modelu do dopisywania watchlisty, gdy brak popartego źródłami sygnału. Nie generuj dat i kontekstu wyłącznie dla spełnienia minimum słów.
- Prompt i walidator korzystają z tych samych stałych/trybu. Drobne odchylenie długości to warning, nie kolejna generacja. Twarde błędy: niepoprawny kształt, puste wymagane treści, niepoprawne referencje, powtórne przypisanie tego samego źródła do sprzecznych sekcji, dominujący zły język. Nie przedstawiaj heurystyki języka jako pełnej oceny jakości.
- Nie uznawaj wyniku za poprawny tylko dlatego, że ma więcej słów. Zwracaj jawny wynik walidacji: hard errors i warnings.
- Zwracaj typowany wynik dostawcy, np. success, timeout, rate_limit, upstream_error, invalid_output, configuration_error. Zachowaj status HTTP, Retry-After, finish_reason i usage, jeśli dostawca je zwróci. Nie rozpoznawaj fallbacku po identyczności tekstu.
- Wyjściowy limit tokenów skonfiguruj osobno dla modeli i zweryfikuj na fixture oraz małej próbce rzeczywistej. Startowy kandydat: 2400 dla pełnego briefingu, 1200 dla krótkiego; nie uznawaj tych wartości za zmierzone optimum. Jeśli model regularnie ucina JSON lub jest zbyt wolny, dopasuj model/limit na podstawie pomiaru, nie przywracaj kaskady rozwijania.
- Zachowaj adapter parametrów modeli: nie każdy model obsługuje `response_format`; sprawdź aktualne możliwości. Nie zmieniaj dostawcy na płatnego bez autoryzacji.
- Zapisuj candidate od razu po poprawnej walidacji. Błąd publikacji trwale zapisanego candidate ponawia zapis, nie model.

### Krok E — budżety i retry

Wartości początkowe, do potwierdzenia pomiarem na docelowej konfiguracji:

| Parametr | Wartość/polityka |
| --- | --- |
| Limit funkcji | 120 s; potwierdzić rzeczywiste ustawienie deploymentu |
| Soft deadline całego wywołania | 100 s od wejścia do handlera, nie dopiero od startu AI |
| Maksymalna pojedyncza próba AI | 60 s |
| Rezerwa na zapis i kończenie | 20 s; timeout DB musi się w niej mieścić |
| Claim etapu | lease 150 s; nie przedłużaj sztucznie nieaktywnej pracy |
| Sygnał kontynuacji HTTP | timeout 5 s, najwyżej jedno szybkie ponowienie jeśli jest budżet |
| Automatyczne generacje | maksymalnie 3 na cykl |
| Opóźnienia | po próbie 1: 30 s + jitter 0–10 s; po próbie 2: 120 s + jitter 0–30 s |
| Watchdog | co 60 s; cel odzyskania do 3 minut przy sprawnej infrastrukturze |

Deadline/sygnał przekaż jawnie przez `StageRunner` do fetchów. Timeout AI = minimum 60 s i czasu pozostałego po odjęciu rezerwy. Jeśli nie ma użytecznego budżetu (np. 10 s), oddaj etap bez zużywania generacji. Operacje DB też muszą być ograniczone czasowo sprawdzonym mechanizmem klienta/serwera. Sam Promise.race bez przerwania pracy nie wystarcza.

Przed długim etapem sprawdzaj jego wymagany budżet; AI zawsze zaczyna w świeżej funkcji i po nim następuje yield. Inne etapy mają współpracować z deadline: przetwarzać paczki, zapisywać postęp, zwracać partial. Nie zakładaj, że sprawdzenie 90 s przed uruchomieniem arbitralnie długiego etapu chroni przed timeoutem.

Polityka błędów:

- timeout/network/408/429/5xx: retry; honoruj poprawny Retry-After, z udokumentowanym maksymalnym automatycznym oczekiwaniem 15 min, potem fallback z powodem;
- invalid JSON, truncation lub hard validation error: następna trwała próba z krótkim opisem błędu i docelowymi wymaganiami; nie wysyłaj nieograniczonej poprzedniej odpowiedzi;
- 401/403/brak klucza/nieobsługiwany model: jawny błąd konfiguracji, bez trzech identycznych prób; zapisz fallback i przyczynę;
- domyślna kolejność modeli: primary, fallback, primary jak obecnie; zmień ją dopiero po pomiarze. Oba modele na tym samym endpointcie nie chronią przed awarią całego dostawcy;
- po wyczerpaniu prób: zatwierdź fallback, zakończ AI jako terminalny wynik bez syntezy, pozwól dokończyć run;
- błąd zapisu candidate/summary: osobny ograniczony retry infrastrukturalny, np. 3 próby, z trwałym licznikiem w metrykach; po wyczerpaniu fail etapu, nigdy success;
- crash po rozpoczęciu wywołania liczy się do limitu generacji; sam claim bez rozpoczęcia generacji nie;
- ręczny retry AI to nowy `retry_cycle`, reset licznika cyklu, zachowany input i historia. Wymaga uprawnionego operatora. Zapisany poprawny wynik AI zachowaj do czasu poprawnej wymiany.

Manualny retry po fallbacku ma działać również po finalizacji. Reaktywuj ten sam przebieg i `ai_brief`/krótką finalizację atomowo, tylko gdy nie istnieje inny aktywny przebieg; przy konflikcie zwróć jasny komunikat. Nie cofaj publication i nie potrzebuj usuniętych snapshotów. Każda generacja musi mieć skończony limit; nie buduj automatycznej pętli retry bez końca.

### Krok F — executor i niezależne odzyskiwanie

Pliki: `lib/digest-stage-executor.ts`, `lib/digest-run-continuation.ts`, obie trasy API digestu, `lib/digest-runs.ts`.

- Zastąp sekwencję luźnych odczytów/aktualizacji atomowym claimem. Wybieraj pierwszy niezakończony etap danej wersji, a nie dowolny queued. Przyszły `next_attempt_at` blokuje późniejsze etapy.
- Usuń ścieżkę „nie ma queued → succeeded” bez dowodu ukończenia. Niepełna lista etapów/failed poprzednik ma zatrzymać run z diagnozą.
- Reset, cancel i retry unieważniają lease. Wszystkie zapisy po powrocie AI sprawdzają token, status joba i runa.
- Po trwałym requeue wysyłaj best-effort sygnał kontynuacji tylko dla pracy gotowej teraz. Przyszłe retry pozostaw watchdogowi; nie twórz łańcucha natychmiastowych HTTP podczas oczekiwania.
- Błąd sygnału nie może zmieniać poprawnie zakolejkowanego zadania w failed. Zapisz telemetrykę i zostaw je do odzyskania.
- Użyj skonfigurowanego, zaufanego adresu aplikacji; nie wysyłaj CRON_SECRET do dowolnego hosta pochodzącego z żądania.
- API do UI zwraca DTO; nie dodawaj do istniejącego GET surowego input/candidate ani odpowiedzi dostawcy.

**Wybrany wariant watchdogu:** Supabase Cron co minutę sprawdza, czy istnieje gotowy queued etap albo wygasła lease aktywnego przebiegu, i wysyła autoryzowany sygnał HTTP przez pg_net do advance. Nie wykonuj AI w transakcji DB. Sekret i docelowy URL przechowuj w zatwierdzonym mechanizmie sekretów, np. Vault; nie zapisuj sekretu w repo ani jawnej definicji crona. Zweryfikuj rozszerzenia, aktualne sygnatury i politykę dostępu projektu.

Cron ma stałą nazwę i idempotentną instalację/aktualizację, aby ponowne wdrożenie nie tworzyło duplikatów. Ogranicz liczbę sygnałów na tick; sprawdzaj wynik HTTP i wiek zaległej pracy. Sukces SQL dispatchu nie dowodzi sukcesu workera. Zagubiony sygnał zostanie naprawiony przez następny tick, ponieważ kolejka jest w trwałej tabeli etapów.

Domyślna nazwa watchdogu: `digest-stage-watchdog-v2`. Maintenance uruchamiaj osobno raz dziennie jako `digest-maintenance-v2`, z budżetem pojedynczego wykonania 60 s i trwałym checkpointem. Jego zaległe paczki mogą być wznawiane kolejnym ograniczonym wywołaniem; nie mieszaj ich claimów z aktywnym etapem generacji. Skrypty instalacji muszą przyjmować środowisko/URL i działać idempotentnie; nie umieszczaj wartości sekretów w parametrach logowanych przez CI.

Jeżeli projekt nie pozwala na Supabase Cron/pg_net, użyj Vercel Cron co minutę wyłącznie po potwierdzeniu planu, który to obsługuje. Nie dodawaj minutowego crona na Vercel Hobby. Wybierz jeden watchdog, udokumentuj wybór i nie deklaruj niezawodności bez jego uruchomienia. Istniejący dzienny cron może pozostać awaryjnym sygnałem; nie ma rozpoczynać nowych digestów.

### Krok G — jawne statusy i finalizacja

Pliki: `lib/digest-brief.ts`, `components/digest-run-panel.tsx`, `components/digest-brief.tsx`, odpowiednie DTO i teksty PL/EN.

- Rozróżnij: „Wiadomości gotowe — trwa podsumowanie”, „Ponowienie AI o …”, „Podsumowanie AI gotowe”, „Wersja awaryjna — dostawca niedostępny”, „AI wyłączone”, „Brak wystarczających źródeł”, „Błąd konfiguracji”, „Nie udało się zapisać podsumowania”.
- `useAiSummaries=false` → job skipped z powodem disabled; brak źródeł → skipped/insufficient_evidence; brak klucza → fallback/configuration_error. Każda ścieżka ma zapisany dostępny fallback, jeśli są wiadomości.
- Pusty digest: jawny stan no_articles i deterministyczna informacja o braku wiadomości, bez wywołania AI. Nie wymuszaj fikcyjnych highlights ani sekcji.
- Zawęź `isDigestBriefSchemaError` do rzeczywistych kodów brakującej relacji/kolumny; tolerancja odczytu historycznego może zostać. Przy zapisie nowej wersji żaden błąd schematu nie jest ignorowany.
- Wybieraj podsumowanie zgodne z pokazywanym digestem; stary briefing nie może wyglądać jak wynik właśnie publikowanych newsów.
- Rozszerz panel o etap AI, prawidłowe liczenie skipped i przycisk ponowienia samego AI, bez resetu całego digestu.
- V2 finalization tylko sprawdza kompletność, trwały końcowy wynik i zamyka run. Cleanup retencji oraz stagingu wydziel do bounded maintenance; zapisuj błędy osobno, nie zmieniaj gotowego runa na failed przez cleanup.
- Maintenance ma osobny harmonogram, limit rekordów/czasu i checkpoint. Nie usuwa aktywnych ani oczekujących na retry runów/jobów, zapisanych newsów i notatek. Chroni job/input przez cały okres dostępności manualnego retry, zgodny z retencją runów.

### Krok H — optymalizacja enrichmentu po ustabilizowaniu AI

Pliki: `stage-runners/enrichment.ts`, `digest-builder/run-articles.ts`, `constants.ts`, ewentualnie `story-clustering.ts`.

Pierwsza bezpieczna optymalizacja:

- wybierz candidate IDs raz i zapisz przed rozpoczęciem fetchów;
- kolejne paczki czytają tylko potrzebne kolumny wskazanych ID, nie pełny `select('*')` całego runa;
- zachowaj początkowo 40 kandydatów i concurrency 4, aby mierzyć zmianę I/O bez jednoczesnej zmiany jakości;
- aktualizacje czterech artykułów wykonuj ograniczenie równolegle lub atomową paczką; checkpoint zgodny z faktycznie utrwalonymi wynikami;
- nie ponawiaj bez końca stron błędnych/nieczytelnych; status, data próby i TTL decydują o kolejnym pobraniu;
- sprawdź paginację `loadRunArticles`: wynik ograniczony limitem API nie może udawać pełnego zbioru;
- zachowaj istniejące zabezpieczenia DNS/redirect/rozmiaru i timeouty remote fetch.

Druga, osobna optymalizacja za flagą: enrichment na poziomie historii, najpierw najlepszy dostępny reprezentant potencjalnie wybranych historii, dopiero potem alternatywne źródła. Wstępny ranking musi zachować różnorodność kategorii. Nie obniżaj sztywno do 10 kandydatów tylko dlatego, że AI przyjmuje 10 artykułów: feed może publikować do 100, a odrzucenia źródeł wymagają zapasu.

Nie zwiększaj bez pomiaru współbieżności RSS — już działa równolegle. W `story-clustering.ts` sprawdź koszt seryjnego ustawiania kanonicznego artykułu i rozważ atomową operację zbiorczą zachowującą dokładnie jednego reprezentanta. Te zmiany wydajnościowe nie są warunkiem uruchomienia bezpiecznego AI i powinny mieć osobny diff.

## 5. Testy wymagane przed wdrożeniem

Nie ograniczaj się do aktualnych testów helpera retry. Dodaj testy orkiestracji i integracyjne z prawdziwym PostgreSQL/Supabase testowym.

| Scenariusz | Oczekiwany rezultat |
| --- | --- |
| Typowa poprawna odpowiedź | Jedno AI, poprawne referencje, zapisany candidate i summary |
| Niewielkie odchylenie długości | Warning, bez automatycznego rozwijania |
| 1–2 historie lub brak watch signals | Krótszy poprawny briefing bez zmyślania |
| Zły JSON / truncation | Trwałe retry w nowym wywołaniu, ograniczona liczba prób |
| 429 z Retry-After | Brak wywołania przed terminem, poprawny model/kolejna próba |
| 401/403/brak klucza | Jawny powód, brak pętli retry, fallback |
| Model ignoruje odpowiedź do timeoutu | Przerwanie requestu, rezerwa na zapis, retry |
| Za mało budżetu przed AI | Yield bez zwiększenia generation counter |
| Crash po claimie | Watchdog odzyskuje po lease, brak przeskoku do finalization |
| Dwa równoległe claimy | Tylko jeden aktywny właściciel; sprawdzić realną bazą |
| Spóźniona odpowiedź starego workera | Token nie pozwala nadpisać nowszego wyniku |
| Cancel podczas AI | Brak publikacji wyniku po anulowaniu |
| Zerwany sygnał HTTP | Zadanie nadal trwałe; odzysk bez przeglądarki |
| 202, a background nie ruszył | Watchdog ponawia na podstawie DB |
| Zapis candidate OK, zapis summary fail | Ponowienie zapisu bez dodatkowej generacji |
| Odpowiedź zatwierdzenia DB zgubiona | Odczyt stanu rozpoznaje sukces, bez overwrite |
| Brak tabeli/kolumny summary | Błąd widoczny, nigdy fałszywy success |
| Brak etapów po starcie | Atomowy rollback lub jawny błąd, nigdy sukces |
| Poprzednik failed / przyszły retry | Późniejszy etap nie jest wykonywany |
| 3 nieudane generacje | Fallback, końcowy jawny status, brak 4. automatycznej próby |
| Manualny retry po cleanup | Ten sam zamrożony input, bez RSS i publication |
| Retry przy innym aktywnym runie | Atomowe odrzucenie konfliktu, brak dwóch aktywnych |
| Cleanup fail | Gotowe newsy i briefing nadal dostępne |
| Rollout v1/v2 | Każda wersja używa poprawnego zestawu etapów |
| Enrichment kilka paczek | Kolejne odczyty wyłącznie potrzebnych rekordów, zachowany wybór |
| Puste / same limited / AI off | Trzy rozróżnialne ścieżki bez niepotrzebnych zapytań |

Testy deadline używają fake timers i kontrolowanego fetch. Testy concurrency muszą rzeczywiście uruchomić równoległe transakcje; same mocki update nie dowodzą atomowości. Sekrety tylko testowe. Nie wywołuj prawdziwego płatnego API w CI.

Uruchom po zmianach z katalogu projektu:

```sh
pnpm test:reader
pnpm typecheck:reader
pnpm build:reader
pnpm knip
```

Sprawdź `.github/workflows/reader-ci.yml` i uzupełnij wymagane sprawdzenia migracji/integracji. Zachowaj strukturę projektu; nie dodawaj nowego frameworka testowego bez potrzeby. Browser smoke test: start, publikacja przed AI, pending, retry, fallback, manualny retry i gotowe źródła. Zamknij kartę na czas wykonywania, a wynik sprawdź po ponownym otwarciu.

## 6. Wdrożenie addytywne i zgodność wersji

1. **Preflight:** sprawdź projekt/region Vercel i Supabase, historię migracji, plan crona, ograniczenia funkcji, aktualny model/klucz bez ujawniania wartości. Pobierz baseline. Nie uruchamiaj preview na produkcyjnej bazie.
2. **Release kompatybilności:** dodaj odczyt nowych pól z bezpiecznymi wartościami dla legacy, obsługę obu wersji pipeline i flagę tworzenia nowych v2 domyślnie off. v1 zachowuje swój executor/runner; nie wysyłaj v2 do kodu, który nie zna `ai_brief`.
3. **Staging DB:** zastosuj addytywne migracje, sprawdź constrainty, RLS/RPC oraz wykonaj testy integracyjne i awarie. Użyj nowego/sanitized projektu testowego, nie kopiuj prywatnych treści bez potrzeby.
4. **Staging aplikacja:** wdrożenie preview może wymagać jawnego uruchomienia, bo `vercel.json` ignoruje gałęzie inne niż main. Sprawdź ochronę preview i autoryzację sygnałów. Nie zdejmuj globalnie ochrony produkcji dla testu.
5. **Production DB:** po autoryzacji wykonaj migracje addytywne, bez kasowania danych. Stary kompatybilny kod nadal powinien działać przy fladze off.
6. **Production app:** wgraj kod obsługujący v1 i v2 z flagą off; odczekaj zakończenie starych in-flight funkcji i potwierdź, że sygnały trafiają w nową wersję. Wykonaj read-only smoke test.
7. **Watchdog:** zainstaluj dokładnie jeden harmonogram, sprawdź sekret, URL, odpowiedź endpointu i odczyt zaległej pracy. Harmonogram musi działać przed aktywacją v2.
8. **Canary:** po ukończeniu aktualnego v1 włącz tworzenie v2 i uruchom jeden digest operatora. Wersję przypisuj do runa raz; nie przełączaj runnera istniejącego runa zmianą globalnej flagi.
9. **Weryfikacja:** sprawdź publikację przed AI, jeden request w zwykłym przypadku, recovery bez przeglądarki, rekord summary i komplet etapów. Kontrolowane awarie wykonuj na stagingu, nie przez psucie klucza całej produkcji.
10. **Obserwacja:** 24–48 godzin i co najmniej kilka reprezentatywnych przebiegów, bez wymuszania drogich generacji dla samej statystyki. Jeśli próbka jest mała, podaj to w raporcie.
11. **Enrichment:** dopiero po stabilizacji aktywuj osobno optymalizację odczytów, a później opcjonalny nowy wybór kandydatów. Porównaj czas i jakość.
12. **Domknięcie:** README, env examples, ADR, instrukcja retry/recovery i operacyjny rollback muszą odpowiadać wdrożonemu wariantowi. Usuń stary dzienny mechanizm tylko gdy ma to uzasadnienie; nie usuń jedynego aktywnego watchdogu.

Nie dodawaj `ai_brief` w locie do rozpoczętych v1. Nie zmieniaj historycznych succeeded runów na v2. Jeśli istniejący v1 jest uszkodzony, diagnozuj i napraw konkretny run z kontrolą stanu, zamiast masowej migracji statusów.

## 7. Rollback

- Natychmiast wyłącz tworzenie nowych v2; istniejące v2 dalej obsługuje wdrożony kompatybilny worker i watchdog.
- Flaga musi sterować wyłącznie tworzeniem nowych przebiegów, nie interpretacją aktywnych.
- W razie awarii samej generacji przełącz v2 na zapis jawnego fallbacku lub wstrzymaj due jobs z widocznym stanem. Zachowaj input i candidate do recovery.
- Nie cofaj aplikacji do wersji sprzed obsługi `ai_brief`, dopóki istnieje aktywny v2. Jeśli trzeba cofnąć głębiej: zatrzymaj nowe claimy, zaczekaj na wygaśnięcie workerów, zachowaj dane i jawnie zakończ/anuluj v2. Dopiero potem rollback starego kodu.
- Pozostaw addytywne tabele/kolumny. Nie odwracaj migracji destrukcyjnym DROP i nie kasuj gotowych podsumowań.
- Przetestuj rollback do release kompatybilności na stagingu z zadaniem w retry_wait.
- Retencję/maintenance można wyłączyć niezależnie od generowania. Sprawdź, że rollback harmonogramu nie tworzy dwóch konkurujących watchdogów.

## 8. Kryteria odbioru

- Zwykła udana synteza: jedno wywołanie AI, zero rozwijania/korekt w tym samym invocation.
- Timeout nie przekracza wspólnego deadline i pozostawia czas na trwały zapis stanu.
- Zamknięta przeglądarka nie zatrzymuje pracy; utracony sygnał lub crash odzyskuje się zgodnie z lease i watchdogiem. Cel do 3 minut dotyczy sprawnego DB/schedulera, nie awarii całego hostingu.
- Retry AI nie zmienia wyboru wiadomości ani zamrożonego wejścia i nie ponawia wcześniejszych etapów.
- Wygenerowany, zapisany candidate przeżywa błąd publikacji i jest użyty ponownie.
- Żaden błąd zapisu summary, brak etapu ani failed poprzednik nie kończy się fałszywym sukcesem.
- Fallback, brak źródeł, wyłączone AI i konfiguracja są odróżnialne w UI oraz danych.
- Nie ma równoczesnych właścicieli tego samego etapu; stare wyniki i anulowane zadania nie nadpisują aktualnych.
- Migracje, integracja, testy, typy, build i browser smoke są zweryfikowane; prawdziwy watchdog przetestowany w środowisku wdrożenia.
- Nie spada pokrycie wiarygodnymi źródłami ani zgodność referencji w porównaniu z baseline. Nie usuwamy limitów jakości dla lepszego wykresu sukcesu.
- Raport końcowy rozróżnia „zaimplementowane”, „przetestowane”, „wdrożone” i „niezweryfikowane”.

## 9. Sugerowany podział zmian do review

1. Kontrakty, migracje addytywne, atomowe tworzenie/claim i testy DB.
2. V2 publication + frozen input + osobny AI stage + uproszczony prompt/deadline.
3. Durable retry, watchdog, idempotentny zapis i recovery/cancel.
4. Statusy UI, manualny retry, maintenance, rollout i dokumentacja.
5. Osobna optymalizacja odczytów enrichmentu; później eksperyment wyboru kandydatów.

Pierwsze cztery części wdrażaj jako spójny zestaw za flagą. Nie aktywuj v2 pomiędzy częściowymi commitami bez watchdogu lub ochrony zapisu.

## 10. Metryki i raport implementacyjny

Log strukturalny: runId, pipelineVersion, stage, retryCycle, generationAttempt, model, inputHash, promptVersion, elapsedMs, deadlineRemainingMs, errorCode, HTTP status, finishReason, nextAttemptAt, wynik zapisu. Bez kluczy, nagłówków autoryzacji i całych treści artykułów/modelu w logach.

Mierz oddzielnie:

- czas do publikacji newsów i czas do gotowego AI;
- aktywny czas poszczególnych etapów oraz czas oczekiwania na retry;
- liczbę requestów/tokenów AI na briefing;
- AI generated / wszystkie runy kwalifikujące się do AI (klucz skonfigurowany, AI on, wystarczające źródła); disabled i insufficient evidence nie są awariami dostawcy;
- fallback według przyczyny, błędy zapisu, odzyskane lease, błędy dispatchu i wiek najstarszej zaległej pracy;
- liczbę zapytań oraz pobranych rekordów w enrichmentu;
- pokrycie źródłami, błędne referencje, język i ocenę czytelności na tej samej próbce.

Raport po implementacji ma zawierać: listę zmian i migracji, testy z wynikiem, pomiary przed/po z liczebnością próbki, ustawienia limitów, status wdrożenia/watchdogu, instrukcję ręcznego recovery i rollbacku oraz pozostałe ograniczenia. Nie nazywaj przejścia testów mockowanych pomiarem produkcyjnym.

## 11. Źródła platformowe i miejsca dalszej weryfikacji

- [Vercel: zarządzanie cronami](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — brak automatycznego retry, możliwość duplikatów i ograniczenia Hobby. Zweryfikowane w audycie; plan konta nieznany.
- [Next.js: after](https://nextjs.org/docs/app/api-reference/functions/after) — sprawdzić aktualne ograniczenia wykonywania pracy po odpowiedzi przed wdrożeniem.
- [Supabase Cron](https://supabase.com/docs/guides/cron) — harmonogramy i historia wykonań w Postgres.
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net) — asynchroniczny dispatch HTTP; API oznaczone beta, dlatego sprawdzić bieżące sygnatury i wynik HTTP, nie tylko ID requestu.

Te dokumenty potwierdzają dostępność mechanizmów platformy, nie konfigurację konkretnego projektu użytkownika.
