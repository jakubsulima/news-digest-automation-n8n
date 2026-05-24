# Daily News Digest

Proste lokalne MVP oparte o n8n, które:

- codziennie rano pobiera newsy z RSS
- klastruje artykuły do poziomu story clusterów
- wzbogaca topowe story o tekst pobrany z docelowych stron
- zapisuje historię runów, story i wzbogaconych artykułów w PostgreSQL
- generuje polski digest w Markdown z naciskiem na to, co nowe w ostatniej dobie
- zapisuje najnowszy digest do pliku lokalnego
- udostępnia go przez prywatny webhook n8n
- pozwala zapisać wynik do Apple Notes przez Apple Shortcuts

Projekt jest celowo prosty. Nie używa scrapowania stron, nie wystawia panelu n8n publicznie i da się go uruchomić lokalnie w jeden wieczór.

## Architektura

1. Docker Compose uruchamia lokalnie `n8n` i `PostgreSQL`.
2. Workflow `Daily News Digest - Build` wywołuje lokalny serwis Pythona, który pobiera RSS, klastruje story, wzbogaca topowe pozycje i tworzy digest.
3. Serwis Pythona zapisuje run metadata, story clusters i wzbogacone artykuły do PostgreSQL.
4. Digest jest zapisywany do pliku `storage/digests/latest.md` oraz do archiwum dziennego `storage/digests/archive/YYYY-MM-DD.md`.
5. Workflow `Daily News Digest - Get Latest` zwraca zawartość `latest.md` przez webhook GET.
6. Apple Shortcut wywołuje webhook przez Tailscale i zapisuje wynik jako notatkę w Apple Notes.

## Dlaczego zapis do lokalnego pliku

Digest nadal jest dostarczany jako lokalny plik, ale nie jest juz jedynym stanem systemu.

- `latest.md` i archiwum Markdown są wygodne do konsumpcji i backupu.
- PostgreSQL przechowuje pamiec story miedzy runami, co pozwala liczyc nowosc, potwierdzenie i zmiany od poprzedniej doby.
- Wzbogacony tekst topowych artykulow zostaje w bazie, wiec mozna potem debugowac ranking albo przebudowac podsumowanie bez ponownego fetchu.

To podejscie zostawia prosty delivery path, ale dodaje warstwe analityczna potrzebna do sensownego digestu coverage-first.

## Struktura projektu

```text
daily-news-digest/
  docker-compose.yml
  .env.example
  .gitignore
  Dockerfile.digest-builder
  README.md
  workflows/
    daily-news-digest-build.json
    daily-news-digest-get-latest.json
  config/
    editorial-settings.json
  prompts/
    ai-editorial-review.md
    nvidia-news-editor.md
  storage/
    digests/
      latest.md
      archive/
```

## Wymagania

- Docker Desktop albo Docker Engine + Docker Compose
- konto i klient Tailscale na urządzeniu z n8n
- konto Tailscale na iPhonie i/lub Macu, z których chcesz wywoływać webhook
- klucz `NVIDIA_API_KEY` do NVIDIA Build / NIM
- podstawowa znajomość kopiowania plików i uruchamiania poleceń w terminalu
- świadomość, ze serwis `digest-builder` buduje wlasny obraz Dockera z klientem PostgreSQL

## Instalacja krok po kroku

### 1. Wejdź do katalogu projektu

```bash
cd /Users/jakub/Desktop/n8n/daily-news-digest
```

### 2. Skopiuj `.env.example` do `.env`

```bash
cp .env.example .env
```

### 3. Wygeneruj `N8N_ENCRYPTION_KEY`

```bash
openssl rand -hex 32
```

Wklej wynik do `.env` pod:

```env
N8N_ENCRYPTION_KEY=tu-wklej-wynik
```

To ważne. Ten klucz musi być stały. Nie zmieniaj go po starcie systemu, jeśli nie chcesz problemów z danymi i credentialami n8n.

### 4. Wpisz dane do PostgreSQL w `.env`

Przykład:

```env
POSTGRES_USER=n8n
POSTGRES_PASSWORD=zmien-mnie-na-mocne-haslo
POSTGRES_DB=n8n
```

### 5. Wpisz `NVIDIA_API_KEY`

W `.env` ustaw:

```env
NVIDIA_API_KEY=tu-wklej-swoj-klucz
```

Domyślny model i fallback są już przygotowane:

```env
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
NVIDIA_NIM_FALLBACK_MODEL=nvidia/nvidia-nemotron-nano-9b-v2
ENRICH_TOP_N=12
```

### 6. Uruchom Docker Compose

```bash
docker compose up -d
```

### 7. Sprawdź, czy kontenery działają

```bash
docker compose ps
```

Powinieneś zobaczyć uruchomione usługi `postgres` i `n8n`.

### 8. Otwórz panel n8n

Wejdź na:

```text
http://127.0.0.1:5678
```

Panel jest wystawiony tylko lokalnie. To celowe.

## Test NVIDIA API przez curl

Przed importem workflowów warto sprawdzić, czy klucz działa.

Najpierw wczytaj zmienne z `.env` do bieżącej sesji terminala:

```bash
set -a
source .env
set +a
```

Następnie uruchom:

```bash
curl https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Authorization: Bearer $NVIDIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "meta/llama-3.3-70b-instruct",
    "messages": [
      {
        "role": "user",
        "content": "Napisz jednozdaniowe streszczenie po polsku: NVIDIA NIM może być użyte jako OpenAI-compatible API."
      }
    ],
    "temperature": 0.2,
    "max_tokens": 200
  }'
```

Jeśli wszystko działa, dostaniesz odpowiedź JSON z `choices[0].message.content`.

## Konfiguracja Tailscale

Cel: prywatny dostęp do panelu n8n i webhooków bez publicznego wystawiania usługi.

### 1. Zaloguj Tailscale na maszynie z n8n

Upewnij się, że urządzenie z Dockerem jest zalogowane do tego samego tailnetu co iPhone i Mac.

### 2. Wystaw lokalny panel n8n przez Tailscale Serve

```bash
tailscale serve --bg http://127.0.0.1:5678
```

### 3. Sprawdź status

```bash
tailscale serve status
```

Zobaczysz URL przypisany do urządzenia w tailnecie. To jego użyjesz w Shortcuts.

### 4. Opcjonalnie ustaw poprawne URL-e w `.env`

Jeśli chcesz, żeby n8n generował webhooki już z adresem Tailscale, dopisz do `.env`:

```env
N8N_HOST=twoje-urzadzenie.twoj-tailnet.ts.net
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://twoje-urzadzenie.twoj-tailnet.ts.net
WEBHOOK_URL=https://twoje-urzadzenie.twoj-tailnet.ts.net/
```

Po zmianie zrestartuj stack:

```bash
docker compose down
docker compose up -d
```

### 5. Ważne zasady bezpieczeństwa

- Nie używaj Tailscale Funnel do panelu n8n.
- Nie wystawiaj `5678` publicznie w routerze ani reverse proxy.
- iPhone i Mac muszą być połączone z tym samym tailnetem, żeby wywoływać webhook.
- Sekrety trzymaj tylko w `.env`.

## Import workflowów do n8n

### Workflow 1: `Daily News Digest - Build`

1. Otwórz n8n.
2. Kliknij `Workflows`.
3. Kliknij `Import from File`.
4. Wskaż plik:

```text
workflows/daily-news-digest-build.json
```
 
5. Zapisz workflow.
6. Otwórz node `NVIDIA NIM Primary` i sprawdź, czy expressions wyglądają poprawnie.
7. Otwórz node `NVIDIA NIM Fallback` i sprawdź fallback model.
8. Aktywuj workflow dopiero po teście ręcznym.

### Workflow 2: `Daily News Digest - Get Latest`

1. Kliknij `Import from File`.
2. Wskaż plik:

```text
workflows/daily-news-digest-get-latest.json
```

3. Zapisz workflow.
4. Aktywuj workflow po pierwszym wygenerowaniu digestu.

## Jak działa workflow `Daily News Digest - Build`

1. `Schedule Trigger` uruchamia workflow codziennie o 07:00 czasu `Europe/Warsaw`.
2. Node `RSS Sources Config` przekazuje do serwisu Pythona:
   - ścieżkę do konfiguracji RSS
   - limit artykułów
   - flagę AI dedupe
3. Node `Build Digest In Python` wywołuje `http://digest-builder:8000/build`.
4. Serwis Pythona:
   - pobiera RSS-y
   - normalizuje URL-e i odrzuca stare wpisy
   - scala podobne artykuły do story clusterów
   - porównuje je z historią w PostgreSQL
   - liczy impact, novelty, confirmation, scope fit i urgency
   - wzbogaca topowe story o tekst z docelowych stron
   - zapisuje run/story/article metadata do PostgreSQL
5. n8n zapisuje wynik do:
   - `storage/digests/latest.md`
   - `storage/digests/archive/YYYY-MM-DD.md`

## Strojenie wag bez zmiany kodu

Plik:

```text
config/editorial-settings.json
```

steruje:

- wagami końcowymi `impact / novelty / confirmation / scope_fit / urgency`
- słowami kluczowymi i ich wagami
- karą dla ogólnych historii wojennych
- progami dopasowania story
- domyślnym `top-N` dla enrichmentu
- etapem `AI editorial review` dla shortlisty story clusterów

Po zmianie tego pliku wystarczy przeładować stack:

```bash
docker compose up -d
```

Jeśli zmienisz też obraz lub zależności, użyj:

```bash
docker compose up --build -d
```

## AI editorial review

Po heurystycznym shortlistingu system może zrobić drugi etap oceny przez model.

Pipeline:

1. heurystyki i clustering wybierają kandydatów
2. enrichment pobiera tekst dla topowych historii
3. AI ocenia shortlistę i zwraca JSON z:
   - `keep`
   - `editorialAdjustment`
   - `importance`
   - `scopeFit`
   - `warRelevance`
   - `reason`
4. końcowy ranking to heurystyka plus bonus lub kara od AI

Ustawienia tego etapu są w:

```text
config/editorial-settings.json
```

Sekcja:

```json
"ai_editorial_review": {
  "enabled": true,
  "shortlist_size": 24,
  "temperature": 0.1,
  "max_tokens": 2800,
  "max_abs_adjustment": 20,
  "reject_penalty": 18,
  "weight": 1.0
}
```

Jeśli `NVIDIA_API_KEY` nie jest ustawiony albo API nie odpowie, workflow wraca do samej heurystyki.

Prompt dla tego etapu jest w:

```text
prompts/ai-editorial-review.md
```

Możesz go edytować bez zmiany kodu.

## Jak działa workflow `Daily News Digest - Get Latest`

1. `Webhook` obsługuje metodę `GET` na ścieżce:

```text
/daily-news-digest
```

2. `Read Latest Digest File` czyta `storage/digests/latest.md`.
3. `Binary To Text` zamienia plik na tekst.
4. `Respond To Webhook` zwraca samą treść digestu jako `text/markdown`.

To jest wygodne dla Apple Shortcuts, bo skrót dostaje gotowy tekst bez dodatkowego JSON-a.

## Konfiguracja env w n8n

W tym MVP nie tworzysz osobnych credentiali dla NVIDIA API w n8n.

- `NVIDIA_API_KEY` jest przekazywany do kontenera przez Docker Compose.
- node `HTTP Request` czyta go przez `{{$env.NVIDIA_API_KEY}}`.
- po zmianie `.env` zrestartuj kontener n8n:

```bash
docker compose down
docker compose up -d
```

## Testowanie krok po kroku

### Test 1. Czy n8n działa

1. Otwórz `http://127.0.0.1:5678`.
2. Upewnij się, że panel się ładuje.

### Test 2. Czy NVIDIA API działa

1. Uruchom test `curl` z sekcji wyżej.
2. Potwierdź, że dostajesz `choices[0].message.content`.

### Test 3. Czy workflow Build generuje digest

1. Otwórz workflow `Daily News Digest - Build`.
2. Kliknij `Execute workflow`.
3. Poczekaj na zakończenie.
4. Sprawdź, czy node `Write Latest Digest` przeszedł poprawnie.
5. Sprawdź plik:

```text
storage/digests/latest.md
```

### Test 4. Czy webhook zwraca digest

1. Otwórz workflow `Daily News Digest - Get Latest`.
2. Aktywuj workflow.
3. Wywołaj webhook z terminala:

```bash
curl http://127.0.0.1:5678/webhook/daily-news-digest
```

Jeśli używasz Tailscale Serve, użyj zamiast tego URL-a Tailscale.

### Test 5. Czy Apple Shortcut zapisuje notatkę

1. Skonfiguruj skrót według instrukcji niżej.
2. Uruchom go na iPhonie albo Macu podłączonym do tailnetu.
3. Otwórz Apple Notes i sprawdź nową notatkę.

## Apple Shortcut: `Zapisz Daily News Digest`

Cel: pobrać najnowszy digest i zapisać go jako nową notatkę.

### URL webhooka

Jeśli używasz Tailscale Serve, webhook będzie zwykle wyglądał tak:

```text
https://twoje-urzadzenie.twoj-tailnet.ts.net/webhook/daily-news-digest
```

Nie używaj lokalnego `127.0.0.1` na iPhonie.

### iPhone: krok po kroku

1. Otwórz aplikację `Shortcuts`.
2. Kliknij `+`, aby dodać nowy skrót.
3. Nazwij go `Zapisz Daily News Digest`.
4. Dodaj akcję `Get Contents of URL`.
5. Ustaw:
   - URL: URL webhooka n8n przez Tailscale
   - Method: `GET`
6. Dodaj akcję `Current Date`.
7. Dodaj akcję `Format Date`.
8. Ustaw format na `Custom`.
9. Ustaw wzorzec na:

```text
yyyy-MM-dd
```

10. Dodaj akcję `Create Note`.
11. Ustaw tytuł notatki na:

```text
News Digest - [Formatted Date]
```

12. Ustaw treść notatki na wynik z `Get Contents of URL`.
13. Jeśli akcja `Create Note` pozwala wskazać folder, wybierz folder `News Digest`.
14. Jeśli folderu nie ma, utwórz go wcześniej ręcznie w Apple Notes.
15. Zapisz skrót.
16. Uruchom skrót testowo.

### Mac: krok po kroku

1. Otwórz aplikację `Shortcuts`.
2. Kliknij `+`.
3. Nazwij skrót `Zapisz Daily News Digest`.
4. Dodaj `Get Contents of URL`.
5. Ustaw metodę `GET`.
6. Wklej URL webhooka przez Tailscale.
7. Dodaj `Current Date`.
8. Dodaj `Format Date` z formatem `yyyy-MM-dd`.
9. Dodaj `Create Note`.
10. Tytuł:

```text
News Digest - [Formatted Date]
```

11. Treść:

```text
[Get Contents of URL]
```

12. Jeśli interfejs pokazuje wybór folderu, ustaw `News Digest`.
13. Zapisz i uruchom skrót.

## Apple Shortcut: `Pobierz Daily News Digest`

To prostsza wersja bez zapisu do Notes.

### iPhone lub Mac

1. Utwórz nowy skrót `Pobierz Daily News Digest`.
2. Dodaj akcję `Get Contents of URL`.
3. Ustaw metodę `GET`.
4. Wklej URL webhooka.
5. Dodaj akcję `Quick Look` albo `Show Result`.
6. Zapisz skrót.

Po uruchomieniu zobaczysz sam digest na ekranie.

## Future enhancement: `Streść ten link`

Tego workflowu nie implementujemy teraz, ale to dobry następny krok.

Pomysł:

1. Skrót działa z `Share Sheet`.
2. Przejmuje URL aktualnej strony.
3. Wysyła URL do webhooka n8n.
4. n8n pobiera metadane albo treść linku.
5. NVIDIA NIM robi streszczenie.
6. Wynik trafia do Apple Notes albo jest wyświetlany od razu.

## Przykładowe źródła RSS

W MVP są dodane neutralne przykłady:

- AI: `https://venturebeat.com/category/ai/feed/`
- Apple / Tech: `https://9to5mac.com/feed/`
- produktywność: `https://zapier.com/blog/rss.xml`
- cybersecurity: `https://thehackernews.com/feeds/posts/default`
- dev tools: `https://stackoverflow.blog/feed/`
- rynek pracy tech: `https://weworkremotely.com/categories/remote-programming-jobs.rss`

Możesz je łatwo wymienić, edytując konkretne node’y `RSS Feed Read`.

## Jak zmienić źródła RSS

1. Otwórz workflow `Daily News Digest - Build`.
2. Kliknij node `RSS AI`, `RSS Apple Tech` itd.
3. Podmień pole `URL`.
4. Zapisz workflow.
5. Uruchom testowo `Execute workflow`.

Nie dodawaj na start zbyt wielu źródeł. 5–8 feedów na MVP to rozsądny zakres.

## Jak zmienić zainteresowania w promptcie

Masz dwie opcje:

1. Prosta:
   - edytuj system prompt bezpośrednio w node `NVIDIA NIM Primary` i `NVIDIA NIM Fallback`
2. Porządkowa:
   - potraktuj plik `prompts/nvidia-news-editor.md` jako źródło prawdy
   - skopiuj zmiany z pliku do node’ów HTTP Request

Na MVP najprościej po prostu zedytować prompt w node’ach.

## Jak zmienić model NVIDIA

Zmień w `.env`:

```env
NVIDIA_NIM_MODEL=twoj-model
NVIDIA_NIM_FALLBACK_MODEL=twoj-fallback
```

Potem restart:

```bash
docker compose down
docker compose up -d
```

## Jak wyłączyć AI i działać jako lista linków

Masz dwie proste opcje:

1. Ustaw w workflow stałe przejście do `Build Basic Digest`.
2. Tymczasowo wpisz zły model albo pusty `NVIDIA_API_KEY`, żeby workflow przeszedł do fallbacku bez AI.

Pierwsza opcja jest czyściejsza.

## Typowe problemy

### NVIDIA API zwraca 401

Najczęstsze przyczyny:

- zły `NVIDIA_API_KEY`
- spacje lub cudzysłowy w `.env`
- kontener n8n nie został zrestartowany po zmianie `.env`

### NVIDIA API zwraca 404 lub błąd modelu

Najczęstsze przyczyny:

- niepoprawna nazwa modelu
- model jest niedostępny dla Twojego konta

Sprawdź:

```env
NVIDIA_NIM_MODEL=meta/llama-3.3-70b-instruct
NVIDIA_NIM_FALLBACK_MODEL=nvidia/nvidia-nemotron-nano-9b-v2
```

### NVIDIA API zwraca 429 lub limity

To zwykle rate limit lub quota.

Co zrobić:

- spróbuj ponownie za kilka minut
- obniż częstotliwość testów
- przetestuj fallback model
- tymczasowo użyj trybu bez AI

### RSS node zwraca mało danych lub błąd

Nie każdy feed jest idealny. Niektóre mogą:

- zwracać tylko część wpisów
- blokować żądania
- czasem odpowiadać niestabilnie

Na MVP po prostu podmień feed na inny.

### Webhook nie działa na iPhonie

Sprawdź:

- czy iPhone jest zalogowany do Tailscale
- czy urządzenie z n8n jest online
- czy `tailscale serve status` pokazuje aktywne mapowanie
- czy workflow `Daily News Digest - Get Latest` jest aktywny

### `latest.md` nie istnieje

Najpierw uruchom workflow `Daily News Digest - Build` ręcznie. Dopiero potem testuj `Get Latest`.

## Debugowanie workflowu NVIDIA

Jeśli AI nie działa:

1. Otwórz ostatnie wykonanie workflowu.
2. Kliknij node `NVIDIA NIM Primary`.
3. Sprawdź:
   - status HTTP
   - body błędu
   - czy `Authorization` faktycznie ma token
4. Jeśli primary zawiedzie, sprawdź node `NVIDIA NIM Fallback`.
5. Jeśli oba zawiodą, sprawdź wynik `Build Basic Digest`.

To zamierzone zachowanie. Digest ma powstać nawet bez AI.

## Backup

Na MVP wystarczą trzy warstwy backupu:

- Apple Notes przechowuje kopie dziennych digestów
- katalog `storage/digests/archive/` przechowuje lokalne archiwum Markdown
- Docker volumes przechowują stan n8n i PostgreSQL

Jeśli chcesz zrobić szybki backup projektu, skopiuj:

- cały katalog projektu
- Docker volumes albo eksport Dockera

## Aktualizacja n8n

1. Zatrzymaj stack:

```bash
docker compose down
```

2. Pobierz nowszy obraz:

```bash
docker compose pull
```

3. Uruchom ponownie:

```bash
docker compose up -d
```

4. Otwórz n8n i sprawdź, czy workflowy dalej się importują i wykonują poprawnie.

## Ręczne zbudowanie workflowu node po node

Jeśli import JSON nie zadziała przez różnice wersji n8n, zbuduj workflow ręcznie.

### Workflow `Daily News Digest - Build`

Dodaj kolejno:

1. `Schedule Trigger`
   - cron: `0 7 * * *`
   - timezone: `Europe/Warsaw`

2. Kilka node’ów `RSS Feed Read`
   - po jednym dla każdego feedu

3. `Merge`
   - połącz feedy w trybie `Append`

4. `Code`
   - wklej kod z sekcji `Code node: czyszczenie URL i deduplikacja`

5. `HTTP Request`
   - metoda: `POST`
   - URL: `https://integrate.api.nvidia.com/v1/chat/completions`
   - headers:
     - `Authorization: Bearer {{$env.NVIDIA_API_KEY}}`
     - `Content-Type: application/json`
   - body JSON:

```json
{
  "model": "{{$env.NVIDIA_NIM_MODEL || 'meta/llama-3.3-70b-instruct'}}",
  "temperature": 0.2,
  "max_tokens": 2500,
  "messages": [
    {
      "role": "system",
      "content": "Jesteś moim osobistym redaktorem newsów. Pisz po polsku, konkretnie, bez wymyślania faktów."
    },
    {
      "role": "user",
      "content": "Przygotuj dzienny digest na podstawie poniższych artykułów:\n\n{{$json.articlesText}}"
    }
  ]
}
```

6. `Code`
   - wyciągnij `choices[0].message.content`

7. Drugi `HTTP Request`
   - taki sam, ale z modelem `{{$env.NVIDIA_NIM_FALLBACK_MODEL}}`

8. `Code`
   - fallback bez AI

9. `Convert to File`
   - source property: `digest`

10. `Read/Write Files from Disk`
   - zapisz do `/files/digests/latest.md`

### Workflow `Daily News Digest - Get Latest`

Dodaj kolejno:

1. `Webhook`
   - method: `GET`
   - path: `daily-news-digest`
   - response mode: `Using Respond to Webhook node`

2. `Read/Write Files from Disk`
   - odczyt `/files/digests/latest.md`

3. `Code`
   - zamiana binary na text

4. `Respond to Webhook`
   - typ odpowiedzi: `Text`
   - body: `{{$json.digest}}`

## Code node: czyszczenie URL i deduplikacja

```javascript
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'ref',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

const MAX_ARTICLES = 30;

const stripHtml = (value = '') =>
  String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sourceFromUrl = (value) => {
  try {
    return new URL(value).hostname.replace(/^www\./, '') || 'unknown';
  } catch {
    return 'unknown';
  }
};

const normalizeUrl = (value) => {
  try {
    const url = new URL(value);

    for (const key of TRACKING_PARAMS) {
      url.searchParams.delete(key);
    }

    url.hash = '';

    const ordered = [...url.searchParams.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );

    url.search = '';

    for (const [key, val] of ordered) {
      url.searchParams.append(key, val);
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const getPublishedAt = (row) =>
  row.isoDate || row.pubDate || row.published || row.date || row.createdAt || null;

const seen = new Set();
const articles = [];

for (const item of $input.all()) {
  const row = item.json;
  const rawUrl = row.link || row.url || row.guid || row.id || '';
  const url = normalizeUrl(rawUrl);

  if (!url || seen.has(url)) continue;

  seen.add(url);

  articles.push({
    title: stripHtml(row.title || 'Bez tytułu'),
    source: sourceFromUrl(url),
    summary: stripHtml(
      row.contentSnippet || row.content || row.summary || row.description || '',
    ).slice(0, 500),
    url,
    publishedAt: getPublishedAt(row),
  });
}

articles.sort((a, b) => {
  const left = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
  const right = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
  return right - left;
});

return [
  {
    json: {
      articles: articles.slice(0, MAX_ARTICLES),
      articlesText: JSON.stringify(articles.slice(0, MAX_ARTICLES), null, 2),
    },
  },
];
```

## Code node: fallback digest bez AI

```javascript
const source = $('Clean & Deduplicate Articles').first().json;
const articles = source.articles || [];
const digestDate = new Date().toISOString().slice(0, 10);

const lines = [
  `# News Digest - ${digestDate}`,
  '',
  'AI unavailable — generated basic link list.',
  '',
  '## Linki',
  '',
];

for (const article of articles) {
  const date = article.publishedAt ? String(article.publishedAt).slice(0, 10) : 'brak daty';
  lines.push(`- [${article.title}](${article.url}) — ${article.source}, ${date}`);
}

return [
  {
    json: {
      digest: lines.join('\n'),
    },
  },
];
```

## Jak rozszerzyć projekt później

Dobry następny krok to:

- newslettery z maila jako dodatkowe źródło
- `Streść ten link` z Apple Share Sheet
- scoring artykułów przed wysłaniem do AI
- osobne digesty: AI, Apple, praca
- zapis historii digestów do SQLite albo PostgreSQL
- dashboard z poprzednimi digestami
- automatyczne tagowanie notatek
- wysyłka digestu do Telegrama albo maila
