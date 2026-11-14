# Audit del codice · interfaccia

Perimetro: `src/app/**`, `src/ui/**`, `src/app/globals.css`, i file `*.tsx` di `src/modules/**`, `messages/*.json`. Base misurata: 178 file `.tsx` non di test, 34.167 righe; 41 `page.tsx`, 5 `layout.tsx`, 15 `route.ts`.

Parte dell'audit del piano di riscrittura: indice in [`02-audit.md`](02-audit.md). Base: `main` a `5fbbdbc` (13/11/2026), sola lettura. I percorsi sono relativi alla radice del repo. I numeri di riga valgono per questo commit.

Colonna **P**: priorità del refactor che la voce tocca (1 modularità, 2 pulizia e chiarezza, 3 prestazioni). Regole: [`02-audit.md`](02-audit.md) §2.0.

Limiti: nessun test eseguito; le differenze di numeri derivano dalla lettura del codice, non da dati reali. `AGENTS.md` è un file locale fuori da Git (`docs/operations.md:53`): le convenzioni citate vengono da `src/architecture.test.ts`, `docs/development.md` e `docs/scheduler.md`. «Export inutilizzato» significa: nessun uso in `src/` fuori dai file di test.

## 0. Sintesi numerica

| Misura | Valore |
| --- | --- |
| Tabelle totali (`<Table>` 39 + 1 `<table>` raw) | 40 |
| Tabelle scritte due volte (tabella + lista mobile) | **28** (20 con `md:` viewport, 2 con `@3xl`, 6 con `@5xl`) |
| Tabelle senza variante mobile | 12 |
| Implementazioni del "segmented control" | 4 |
| Implementazioni dello stepper di periodo/anno | 3 |
| Implementazioni di una cifra KPI | 8 (2 componenti + 6 a mano) |
| Blocchi "hero" (cifra grande + tasso) a mano | 4 uguali (`text-[2rem]`) + 4 varianti |
| Hook errore + `ErrorLine` ridefiniti | 4 file |
| `ConfirmDialog` ridefinito | 2 file |
| Chiusure locali `const money = (…) => formatMoney(…)` | 35 in 31 file (+7 `percent`, +12 data) |
| Server Component async (file / funzioni) | 61 / 68 |
| Client component (`"use client"`) | 89 file |
| Server Action esportate | **153** in 21 file `"use server"` |
| File `.tsx` che importano azioni | 55 |
| Chiamate `startTransition(async …)` | 113 |
| `revalidatePath(` | 117 |
| `router.refresh()` | 47 |
| `useActionState` / `<form action={serverAction}>` | **0 / 0** |
| `redirect/notFound/permanentRedirect` | 32 |
| `cookies()/headers()` | 13 |
| File con `next-intl/server` / con `useTranslations` | 62 / 69 |
| File con `next/navigation` / `next/link` / `next/image` | 58 / 41 / 0 |
| Valori Tailwind arbitrari (`-[…]`) | 364 (145 `rounded-[…]`, 54 `tracking-[…]`, 85 dimensioni) |
| File componente > 400 righe | 19 (13.971 righe, 41% del totale `.tsx`) |
| Chiavi messaggi | 3.619 per lingua, 20 namespace, en/it allineati, 0 chiavi doppie nello stesso oggetto |

## 1. Tabella di accoppiamento server per area (punto 3)

"Async comp" = componenti `async function` che leggono dati o traduzioni sul server (file / funzioni). "Azioni" = funzioni esportate dai file `"use server"` dell'area.

| Area | page | layout | route | tsx | Async comp (file/fn) | Client (`use client`) | File azioni / azioni | tsx che importano azioni | revalidatePath | redirect / notFound | cookies / headers | `next-intl/server` (file) | `useTranslations` (file) | `next/navigation` (file) | `router.refresh()` | `next/link` (file) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shell + Overview | 1 | 1 | 0 | 10 | 2 / 2 | 6 | 1 / 1 | 2 | 0 | 0 | 2 | 3 | 0 | 4 | 0 | 4 |
| Accounts | 3 | 0 | 0 | 11 | 5 / 6 | 5 | 1 / 12 | 5 | 28 | 1 | 0 | 5 | 5 | 3 | 0 | 4 |
| Expenses | 1 | 0 | 0 | 8 | 5 / 5 | 3 | 1 / 8 | 2 | 12 | 0 | 0 | 5 | 3 | 1 | 0 | 1 |
| Budgets | 2 | 0 | 0 | 6 | 3 / 3 | 3 | 1 / 3 | 3 | 3 | 2 | 1 | 3 | 3 | 2 | 0 | 2 |
| Subscriptions | 1 | 0 | 1 | 4 | 1 / 1 | 3 | 1 / 5 | 2 | 2 | 0 | 0 | 2 | 4 | 0 | 0 | 1 |
| Pockets | 2 | 0 | 0 | 3 | 2 / 2 | 1 | 1 / 8 | 3 | 2 | 1 | 0 | 2 | 1 | 2 | 0 | 1 |
| Interests | 2 | 0 | 0 | 4 | 2 / 2 | 2 | 1 / 5 | 2 | 3 | 1 | 0 | 2 | 2 | 2 | 0 | 1 |
| Investments | 6 | 1 | 0 | 12 | 7 / 8 | 3 | 1 / 15 | 1 | 9 | 8 | 0 | 7 | 5 | 8 | 8 | 6 |
| Funds | 3 | 1 | 2 | 18 | 11 / 16 | 4 | 3 / 26 | 5 | 14 | 10 | 0 | 10 | 4 | 7 | 12 | 7 |
| Payroll | 3 | 0 | 1 | 9 | 3 / 3 | 6 | 1 / 12 | 5 | 7 | 1 | 0 | 3 | 5 | 5 | 5 | 3 |
| Time Off | 2 | 0 | 0 | 8 | 2 / 2 | 4 | 3 / 12 | 6 | 3 | 0 | 0 | 2 | 4 | 4 | 7 | 2 |
| Settings (+ `modules/users`) | 8 | 1 | 1 | 35 | 9 / 9 | 24 | 5 / 45 | 18 | 34 | 1 | 7 | 9 | 23 | 9 | 13 | 2 |
| Auth `(auth)` | 7 | 1 | 1 | 16 | 8 / 8 | 7 | 1 / 1 | 1 | 0 | 7 | 2 | 8 | 7 | 10 | 2 | 4 |
| Root (`layout`, `error`, `not-found`) | 0 | 1 | 0 | 4 | 1 / 1 | 2 | 0 / 0 | 0 | 0 | 0 | 1 | 1 | 2 | 0 | 0 | 0 |
| Design system (`src/ui`, senza shell) | 0 | 0 | 0 | 30 | 0 / 0 | 16 | 0 / 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 3 |
| **Totale** | **41** | **5** | **15** | **178** | **61 / 68** | **89** | **21 / 153** | **55** | **117** | **32** | **13** | **62** | **69** | **58** | **47** | **41** |

Lettura della tabella:

- **Tutte le 41 pagine sono Server Component async** che chiamano i servizi del modulo (`requireSession()` + query). Nessuna pagina legge dati dal client.
- **Le azioni sono già chiamate in modo imperativo**: `await xAction(...)` dentro `startTransition` (113 punti), mai con `useActionState` né `<form action={azione}>`. I 3 `action=` trovati sono form GET verso un URL (`src/ui/date-range-picker.tsx:240`, `src/modules/transactions/ui/filter-bar.tsx:269`, `src/app/(app)/investments/[accountId]/activity/page.tsx:267`). Sostituire le azioni con un client REST è quindi un lavoro meccanico: 153 funzioni, 55 file.
- **Il lavoro vero è nei 61 Server Component**: mescolano lettura dati, view-model (calcoli, etichette, formattazione con `ctx`) e JSX. Le aree più pesanti sono Funds (16 funzioni async, 11 file) e Investments (8 funzioni, 6 pagine + 1 layout).
- **Invalidazione**: 117 `revalidatePath` + 47 `router.refresh()` vanno sostituiti da una cache client (invalidazione per chiave).
- **Stato nell'URL**: periodo, tab, vista del grafico e filtri sono query string lette dal server (`searchParams` in 38 righe). Resta valido in client-only, ma la lettura passa al router client.
- **`next/image` non è usato.** `next/font/local` è usato una volta (`src/app/layout.tsx:13`). 5 route handler sotto `(app)` servono file (`subscriptions/export.csv`, `settings/data/export.zip`, `payroll/[id]/original`, `funds/[id]/documents/[docId]/original`, `funds/[id]/returns`): servono equivalenti REST e un download nativo in Capacitor/Tauri.

## 2. Design system (`src/ui`, token)

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-DS-1 | doppione | 1 | `src/ui/segmented.tsx:25-32`, `src/modules/accounts/ui/controls.tsx:33-44` (`LinkTabs`), `src/modules/investments/ui/period-control.tsx:84-99`, `src/app/(app)/timeoff/page.tsx:428-444` | Lo stesso "segmented control" (`rounded-[7px] bg-hover p-0.5`, voce attiva `bg-card shadow-[0_1px_2px_rgba(0,0,0,0.08)]`) è scritto 4 volte: 1 a stato, 3 a link. `LinkTabs` ha 14 usi ma vive in `modules/accounts`. | Un solo `Segmented` in `packages/ui` con due modalità (`value/onChange` e `href`), stile unico da token. |
| UI-DS-2 | doppione | 1 | `src/modules/accounts/ui/controls.tsx:60-110` (`PeriodStepper`), `src/modules/investments/ui/period-control.tsx:101-133`, `src/modules/timeoff/ui/year-picker.tsx:8-70` | Stepper "‹ periodo ›" scritto 3 volte, con la stessa classe `arrow` copiata (`controls.tsx:82`, `period-control.tsx:71`). | `Stepper` generico (`previous`, `next`, `label`, `onLatest`) in `packages/ui`. |
| UI-DS-3 | doppione | 1 | 28 coppie, elenco in §2.1 | Ogni tabella è scritta due volte: `<Table>` nascosta sotto la soglia + `<ul>` per il telefono, con le stesse celle e gli stessi formatter. Tre soglie diverse: `md` (20), `@3xl` (2), `@5xl` (6). | `DataTable<T>` con colonne dichiarate una volta (`header`, `cell`, `align`, ruolo mobile `title / value / meta / hidden`), che disegna tabella o lista a schede con una sola soglia a container query. Copre tutte le 28 coppie; le 12 tabelle senza variante mobile la ottengono gratis. |
| UI-DS-4 | componente simile | 1 | `src/ui/kpi-tile.tsx:5-34`, `src/modules/funds/ui/fund-kpi.tsx:6-28` | Due tile KPI quasi uguali: `Kpi` di Funds differisce solo per la nota che va a capo e `testId`. `KpiTile` 43 usi, `Kpi` 11 usi. | Un `KpiTile` con `noteWrap` e `testId`; eliminare `fund-kpi.tsx`. |
| UI-DS-5 | componente simile | 1 | `src/modules/timeoff/ui/kind-card.tsx:45-53`, `src/app/(app)/timeoff/page.tsx:359-373`, `src/modules/accounts/ui/net-worth-card.tsx:160`, `src/modules/transactions/ui/spending-card.tsx:57`, `src/app/(app)/budgets/page.tsx:112-121`, `src/app/(app)/pockets/[id]/page.tsx:150-165` | Cifra KPI (`text-kpi font-semibold …`) riscritta a mano in 6 punti fuori dai due componenti. | `Stat` (etichetta + valore + unità + nota) come primitivo; `KpiTile` = `Card` + `Stat`. |
| UI-DS-6 | doppione | 1 | Griglia `grid grid-cols-2 gap-4 @4xl:grid-cols-4` in 9 pagine: `src/app/(app)/page.tsx:118`, `accounts/page.tsx:163`, `accounts/[id]/page.tsx:359`, `subscriptions/page.tsx:149`, `pockets/page.tsx:74`, `interests/[id]/page.tsx:122`, `investments/page.tsx:796`, `funds/home-skeleton.tsx:13`, `funds/[id]/fund-skeleton.tsx:14` (+ `payroll/page.tsx:80` con `@3xl:grid-cols-5`, `src/ui/states.tsx:67` con `lg:`) | La riga di KPI è una stringa di classi copiata. | `KpiRow` (colonne 3/4/5) in `packages/ui`. |
| UI-DS-7 | doppione | 1 | `h1` di pagina `text-title font-semibold tracking-[-0.02em]` in 31 punti (es. `src/app/(app)/page.tsx:40`, `accounts/page.tsx:73,143`, `expenses/page.tsx:225,246`, `funds/page.tsx:153,222`, `settings/layout.tsx:31`) | Il titolo di pagina è ripetuto in ogni pagina, con `max-md:sr-only` in 19 casi. `Page` (`src/ui/shell/page.tsx:12-31`) non lo disegna. | `Page` riceve `heading` e lo disegna; oppure `PageHeader` (titolo + meta + azioni + controllo periodo). |
| UI-DS-8 | componente simile | 1 | 37 paragrafi "vuoto" a mano (es. `src/app/(app)/timeoff/page.tsx:448`, `interests/[id]/page.tsx:138,269`, `investments/page.tsx:507,543,735`, `settings/integrations/page.tsx:169`, `src/modules/accounts/ui/balance-entries.tsx:254`) contro 16 `<EmptyState>`; `ErrorState` solo in `src/app/error.tsx:13` e `src/app/global-error.tsx:17`; `LoadingState` (`src/ui/states.tsx:59`) mai usato | Tre padding diversi (`px-4 pb-4`, `p-4`, `px-4 py-3`) per lo stesso stato vuoto di una card. Nessuno stato di errore o di caricamento per sezione: oggi basta perché rende il server; con REST servono in ogni schermata. | `EmptyState` con variante `inline` (dentro card); `QueryBoundary` con `loading / error / empty` per ogni blocco dati. |
| UI-DS-9 | doppione | 1 | `src/modules/investments/ui/dialogs.tsx:107-129`, `src/modules/funds/ui/fund-forms.tsx:41-64`, `src/modules/funds/ui/pension-forms.tsx:52-76`, `src/modules/pockets/ui/pocket-actions.tsx:54-86` | `useErrors` / `useResult` + `ErrorLine` ridefiniti in 4 file con lo stesso corpo. In più 9 funzioni `messageFor` locali (es. `transactions-table.tsx:184`, `wallet-card.tsx:64`, `trek-card.tsx:53`) e 55 righe `role="alert" … text-neg` in 43 file. | `useMutationResult(namespace, knownErrors)` + `FormError` in `packages/ui`; mappa codice errore → messaggio una sola volta, alimentata dagli errori REST. |
| UI-DS-10 | doppione | 1 | `src/modules/investments/ui/dialogs.tsx:184-229`, `src/modules/pockets/ui/pocket-actions.tsx:474-519` | `ConfirmDialog` definito due volte. `Modal` (`src/ui/modal.tsx:6-56`) non ha una variante di conferma. | `ConfirmDialog` in `packages/ui`. |
| UI-DS-11 | doppione | 1 | `src/modules/investments/ui/dialogs.tsx:143-182` (`Dialog` con form a griglia), `:131-141` (`Actions`), `:261-358` (`DateField`, `MoneyField`, `NumberField`) | Wrapper "modale con form" e campi data/importo/numero esistono solo in Investments. Funds, Pockets e Accounts li ricompongono a mano (49 `<Modal>` in 30 file). | `FormDialog`, `DateField`, `MoneyField`, `NumberField` in `packages/ui`. |
| UI-DS-12 | componente simile | 1 | `src/ui/progress-bar.tsx:6-52` contro barre a mano: `src/modules/timeoff/ui/kind-card.tsx:54-60`, `src/modules/subscriptions/ui/subscriptions-table.tsx:77`, `src/app/(app)/investments/[accountId]/positions/page.tsx:665`, `src/modules/transactions/ui/breakdown-card.tsx:44` | 4 barre scritte con `style={{ width }}` invece di `ProgressBar`. | `ProgressBar` con segmenti multipli (`taken` + `planned`). |
| UI-DS-13 | doppione | 1 | 58 link testuali con la stessa stringa `focus-ring inline-flex min-h-6 items-center rounded-[2px] … hover:underline` in 32 file (es. `src/app/(app)/page.tsx:157,181`, `accounts/page.tsx:201,272`, `investments/page.tsx:427,440,461,861`) | Esiste `LinkButton` (`src/ui/button.tsx:103`) ma i link testuali sono classi copiate. | `TextLink` in `packages/ui`. |
| UI-DS-14 | doppione | 1 | Pallino colore `size-2 rounded-full` + `style={{ background }}` in 23 punti / 18 file (es. `accounts/page.tsx:194-198,265-269`, `investments/page.tsx:746-750`, `funds/page.tsx:819-823`) | Il pallino di serie/categoria è scritto a mano ovunque; `ColorDot` esiste solo in `src/app/(app)/settings/categories/color-swatch.tsx:15`. | `ColorDot` in `packages/ui`. |
| UI-DS-15 | token | 2 | `src/app/globals.css:5-66` (colori chiaro/scuro), `:68-92` (mappa Tailwind), `:94-151` (font, scala testo, raggi, animazioni), `:154-167` (`focus-ring`); `src/ui/tone.ts:1-17`; `src/platform/theme.ts:1-31` | I token sono in un solo file CSS, più i toni in `tone.ts` e la preferenza tema in `platform/theme.ts`. Mancano token per: spaziatura, tracking, ombre piccole, backdrop, z-index, raggi piccoli. | `packages/design-tokens`: sorgente unica (TS/JSON) che genera il CSS e i tipi `Tone`; aggiungere `radius-xs/sm`, `tracking-tight/caps`, `shadow-sm`, `overlay`, scala `z`. |
| UI-DS-16 | token | 2 | `rounded-[4px]` ×55, `rounded-[2px]` ×47, `rounded-[5px]` ×21, `rounded-[3px]` ×8, `rounded-[7px]` ×6 (145 raggi arbitrari in tutto) | I token di raggio sono solo `ctl 6 / card 10 / modal 12` (`globals.css:124-126`): tutti i raggi piccoli sono valori magici. | Token `radius-2/4/5/7` o riduzione a due valori. |
| UI-DS-17 | token | 2 | `tracking-[-0.02em]` ×43, `tracking-[0.04em]` ×8, `tracking-[-0.01em]` ×3 | Il tracking dei titoli non è un token. | `--tracking-tight`, `--tracking-caps`. |
| UI-DS-18 | token | 2 | `text-[2rem]` in `investments/page.tsx:382`, `investments/[accountId]/page.tsx:219`, `funds/page.tsx:876`, `funds/[id]/page.tsx:755`; `text-[10px]` in `src/ui/avatar.tsx:4`, `src/modules/timeoff/ui/kind-card.tsx:112` | Il token `--text-hero: 32px` (`globals.css:116`) e `--text-micro: 10px` (`:99`) esistono ma non sono usati qui. | Sostituire con `text-hero` / `text-micro`. |
| UI-DS-19 | token | 2 | Colori fissi: palette serie `src/modules/accounts/ui/display.ts:11-22` (12 hex), `src/modules/budgets/ui/present.ts:6` (`#8a8f98`), `src/ui/qr-code.tsx:21-22`; backdrop `rgba(10,12,16,…)` in `src/ui/modal.tsx:29`, `src/ui/shell/command-palette.tsx:140`, `src/ui/shell/mobile-nav.tsx:80`; ombra `rgba(0,0,0,0.08)` in 4 punti (UI-DS-1); 30 stringhe `var(--…)` in TS (14 in `src/ui/chart.tsx`, 4 in `funds/page.tsx`, 3 in `fund-chart.tsx`) | La palette dei grafici vive in un modulo di dominio, non nei token, e non ha variante scura. Nessuna classe palette Tailwind usata (solo 1 `bg-white`). | Palette serie e `overlay` in `design-tokens`; costanti `CHART_TONE` invece delle stringhe `var(--…)`. |
| UI-DS-20 | accoppiamento server | 1 | `src/ui/button.tsx:2`, `src/ui/tab-links.tsx:2`, `src/ui/date-range-picker.tsx:5-6`, `src/ui/shell/topbar.tsx:4`, `src/ui/shell/sidebar.tsx:4-5`, `src/ui/shell/mobile-nav.tsx:5-6`, `src/ui/shell/command-palette.tsx:5`, `src/ui/shell/sign-out.ts:3-4`; tipo `Route` di `next` in 8 file; `@/platform/*` in 5 file (`date-range-picker.tsx:8-9`, `theme-provider.tsx:4`, `shell-context.tsx:4`, `sign-out.ts:4`); `next-intl` in `src/ui/unsaved-changes.tsx:11` | `src/ui` dipende da `next/link`, `next/navigation`, dal tipo `Route` e da `@/platform`. Il resto è già pulito: le etichette arrivano come prop ("`src/ui` knows no message catalogue", `date-range-picker.tsx:19`). | `packages/ui` con un adattatore di routing iniettato (`LinkComponent`, `useNavigate`, `usePathname`); `dates`/`format` in un pacchetto condiviso; `apps/web` fornisce l'adattatore. |
| UI-DS-21 | file grande | 2 | `src/ui/chart.tsx` (836 righe) | 8 grafici SVG in un file: `Sparkline:129`, `AreaLine:167`, `StackedArea:320`, `MultiLine:413`, `CompositionBar:517`, `Bars:540`, `StackedBars:619`, `MiniBars:778`. | Un file per grafico + `chart/scale.ts` per `extentOf/scale/xOf/segmentsOf`. |
| UI-DS-22 | doppione | 1 | Iniziali dei giorni: `src/ui/date-range-picker.tsx:57-66`, `src/modules/timeoff/ui/kinds.ts:57`, `src/app/(app)/settings/integrations/schedule-describe.ts:12`, `src/modules/subscriptions/ui/present.ts:119`. Data+ora: `src/app/(app)/settings/integrations/format-instant.ts:10-19`, `src/app/(app)/investments/[accountId]/service-data.ts:89-102`, `src/app/(app)/settings/server/page.tsx:48-49`, `src/app/(app)/settings/integrations/schedule-control.tsx:283`. Numeri: `src/app/(app)/timeoff/page.tsx:551`, `settings/server/page.tsx:114` | `platform/format.ts` non ha formatter per giorno della settimana, data-ora e numero puro: ogni schermata usa `Intl` a mano (15 punti). | Aggiungere `formatWeekday`, `formatInstant`, `formatNumber` al formatter condiviso. |
| UI-DS-23 | doppione | 1 | 35 chiusure `const money = (…) => formatMoney(…, ctx.numberFormat, …)` in 31 file (es. `investments/page.tsx:60-62`, `funds/page.tsx:181-183`, `funds/[id]/page.tsx:138-141`, `pockets/page.tsx:27`, `budgets/page.tsx:36`), più 7 `percent` e 12 chiusure data. 94 chiamate `formatMoney` in 36 file, 154 `formatDate` in 41 | Ogni pagina ricostruisce i propri formatter con opzioni ad hoc (`signed`, `decimals`, `currency`) perché `ctx` esiste solo sul server e viene passato come prop (41 punti). | Hook `useFormat()` che legge le preferenze da un provider e restituisce `money / percent / date / number` già legati. |

### 2.1 Elenco delle 28 tabelle scritte due volte (UI-DS-3)

| # | File | Tabella | Lista mobile | Soglia |
| --- | --- | --- | --- | --- |
| 1 | `src/app/(app)/page.tsx` | 163 | 203 | `md` |
| 2 | `src/app/(app)/accounts/page.tsx` | 177 | 257 | `md` |
| 3 | `src/app/(app)/interests/page.tsx` | 67 | 148 | `md` |
| 4 | `src/app/(app)/interests/[id]/page.tsx` | 143 | 202 | `md` |
| 5 | `src/app/(app)/pockets/[id]/page.tsx` | 262 | 303 | `md` |
| 6 | `src/app/(app)/investments/page.tsx` | 615 | 671 | `md` |
| 7 | `src/app/(app)/investments/[accountId]/positions/page.tsx` | 359 | 443 | `md` |
| 8 | `src/app/(app)/investments/[accountId]/positions/page.tsx` | 555 | 597 | `md` |
| 9 | `src/app/(app)/investments/[accountId]/activity/page.tsx` | 303 | 354 | `md` |
| 10 | `src/app/(app)/payroll/[id]/page.tsx` | 213 | 244 | `md` |
| 11 | `src/app/(app)/settings/server/jobs-card.tsx` | 47 | 91 | `md` |
| 12 | `src/app/(app)/settings/security/connected-apps-table.tsx` | 56 | 89 | `md` |
| 13 | `src/app/(app)/settings/security/api-clients-table.tsx` | 47 | 80 | `md` |
| 14 | `src/app/(app)/funds/page.tsx` | 523 | 584 | `@3xl` |
| 15 | `src/app/(app)/funds/page.tsx` | 702 | 747 | `@3xl` |
| 16 | `src/modules/transactions/ui/transactions-table.tsx` | 418 | 527 | `md` |
| 17 | `src/modules/budgets/ui/budgets-table.tsx` | 147 | 197 | `md` |
| 18 | `src/modules/subscriptions/ui/subscriptions-table.tsx` | 149 | 248 | `md` |
| 19 | `src/modules/accounts/ui/balance-entries.tsx` | 259 | 321 | `md` |
| 20 | `src/modules/users/ui/people-table.tsx` | 170 | 242 | `md` |
| 21 | `src/modules/payroll/ui/register-table.tsx` | 62 | 186 | `md` |
| 22 | `src/modules/funds/ui/projection.tsx` | 46 | 26 | `md` |
| 23 | `src/modules/funds/ui/pac-deposits.tsx` | 93 | 135 | `@5xl` |
| 24 | `src/modules/funds/ui/fund-valuations.tsx` | 109 | 158 | `@5xl` |
| 25 | `src/modules/funds/ui/fund-valuations.tsx` | 222 | 254 | `@5xl` |
| 26 | `src/modules/funds/ui/pension-contributions.tsx` | 124 | 174 | `@5xl` |
| 27 | `src/modules/funds/ui/pension-contributions.tsx` | 232 | 273 | `@5xl` |
| 28 | `src/modules/funds/ui/pension-contributions.tsx` | 398 | 422 | `@5xl` |

Tabelle senza variante mobile (12): `src/app/(app)/timeoff/page.tsx:454` (nasconde due colonne, `:459-460`), `settings/integrations/page.tsx:172`, `settings/data/page.tsx:32`, `settings/categories/labels-card.tsx:119`, `accounts/[id]/page.tsx:460`, `funds/[id]/documents/[docId]/page.tsx:185`, `interests/[id]/page.tsx:279`, `investments/page.tsx:589`, `src/modules/funds/ui/fund-chart.tsx:210,235`, `src/modules/funds/ui/pension-settings.tsx:198`, `src/modules/subscriptions/ui/subscriptions-table.tsx:337`.

## 3. Shell e navigazione

Menu attuale, `src/app/(app)/navigation.ts:23-133` (unica lista: sidebar, tab mobili e palette derivano da qui, `:22`):

| # | id | href | gruppo | tab mobile | Righe |
| --- | --- | --- | --- | --- | --- |
| 1 | `overview` | `/` | finance | sì | 24-32 |
| 2 | `accounts` | `/accounts` | finance | sì | 33-41 |
| 3 | `expenses` | `/expenses` | finance | sì | 42-50 |
| 4 | `budgets` | `/budgets` | finance | no | 51-59 |
| 5 | `funds` | `/funds` | finance | no | 60-68 |
| 6 | `investments` | `/investments` | finance | no | 69-77 |
| 7 | `interests` | `/interests` | finance | no | 78-86 |
| 8 | `pockets` | `/pockets` | finance | no | 87-95 |
| 9 | `subscriptions` | `/subscriptions` | finance | no | 96-104 |
| 10 | `payroll` | `/payroll` | work | sì | 105-113 |
| 11 | `timeoff` | `/timeoff` | work | no (commento `:120`) | 114-123 |
| 12 | `settings` | `/settings/profile` | footer | no | 124-132 |

Tab mobili: 4 voci con `mobile: true` (Overview, Accounts, Expenses, Payroll) + la quinta cella "More" (`src/ui/shell/mobile-nav.tsx:37,44,64-76`). Il foglio "More" raggruppa il resto in `finance / work / system` e sposta `footer` in `system` (`mobile-nav.tsx:17-29,84-121`). Nessuna voce è `adminOnly: true`; il filtro esiste (`navigation.ts:135-137`).

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-NAV-1 | accoppiamento server | 1 | `src/app/(app)/layout.tsx:21-121` | Il layout dell'app è un Server Component che legge sessione (`:22-23`), SSO (`:24`), preferenze (`:26`), cookie sidebar (`:94`), traduce 20 etichette (`:73-93`) e passa 3 Server Action come prop (`saveTheme :101`, `searchPayeesAction :114`, `searchRecordsAction :115`). | `AppShell` client in `packages/ui`: sessione e preferenze da REST, etichette da `useTranslations`, ricerca palette via API. |
| UI-NAV-2 | doppione | 1 | `src/app/(app)/layout.tsx:45-72` contro `src/app/(app)/settings/layout.tsx:11-25` | La lista delle tab di Settings è scritta due volte: una per la palette, una per le tab. Le voci `timeoff-settings` e `payroll-settings` esistono solo nella palette (`layout.tsx:62-71`). | Una sola definizione `SETTINGS_TABS` accanto a `NAV_ITEMS`. |
| UI-NAV-3 | componente simile | 1 | Tab come route con layout: `settings/layout.tsx:11-25` + `settings-tabs.tsx:9-18`, `investments/[accountId]/layout.tsx:49-67` + `src/modules/investments/ui/service-nav.tsx:29-56`. Tab come query `?tab=`: `accounts/[id]/page.tsx:190`, `funds/[id]/page.tsx:116-117,177-184`. Tab come array copiato in due pagine sorelle: `payroll/page.tsx:64-70` + `payroll/settings/page.tsx:34`, `timeoff/page.tsx:247-253` + `timeoff/settings/page.tsx:94` | Tre meccanismi diversi per le tab di sezione, 8 dichiarazioni. Il titolo nel breadcrumb è ricalcolato in due componenti (`settings-tabs.tsx:15-18`, `service-nav.tsx:52-56`). | `SectionTabs` unico: definizione dichiarativa delle tab per sezione, tab come route, breadcrumb derivato. |
| UI-NAV-4 | doppione | 1 | `src/ui/shell/sidebar.tsx:17` e `src/ui/shell/mobile-nav.tsx:17` | `GROUPS = ["finance","work","system"]` definito due volte; la regola `footer → system` è solo in `mobile-nav.tsx:20-29`. | Gruppi e ordine nel modello di navigazione. |
| UI-NAV-5 | accoppiamento server | 1 | `src/ui/shell/shell-context.tsx:65-67` (scrive `document.cookie`), `src/app/(app)/layout.tsx:94` (lo legge sul server), `src/app/layout.tsx:36-52` + `src/platform/theme.ts:30` (`THEME_SCRIPT`, cookie tema) | Stato sidebar e tema passano dai cookie per il primo render sul server. In Capacitor e Tauri non c'è render server. | Storage astratto (`localStorage` / preferenze native) dietro un `PreferencesStore`. |
| UI-NAV-6 | debito | 2 | `src/ui/shell/mobile-nav.tsx:44`, `src/ui/shell/sidebar.tsx:29,57,65`, `src/ui/shell/topbar.tsx:28-69` | La shell sceglie tra sidebar e tab solo con `md:` del viewport. Non esiste una variante per finestra desktop stretta (Tauri) né gestione delle safe area (Capacitor): la barra ha `h-16 pb-2` fisso. | Shell con layout scelto da piattaforma + larghezza, `env(safe-area-inset-*)` nei token. |
| UI-NAV-7 | debito | 2 | `src/ui/shell/shell-context.tsx:71-83` | Scorciatoie `⌘K` e `⌘\` registrate su `window`; su Android non hanno equivalente. | Azione "cerca" sempre visibile nella topbar mobile (oggi `topbar.tsx:63`). |

## 4. Overview

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-OVR-1 | doppione | 1 | `src/app/(app)/page.tsx:163-201` (tabella) e `:203-235` (lista), contro `src/app/(app)/accounts/page.tsx:177-255` e `:257-…` | L'elenco conti è scritto 4 volte (2 schermate × tabella e lista), con lo stesso calcolo `changeBetween` / `counterValue` ripetuto (`page.tsx:173-175` e `:205-207`). | `AccountList` con `columns` (`compact` o `full`) sopra `DataTable`. |
| UI-OVR-2 | componente simile | 1 | `src/app/(app)/page.tsx:77-109` | Hero "patrimonio netto" (`text-hero`) scritto a mano; stesso schema di Investments/Funds (UI-INV-2). | `HeroFigure` (etichetta, valore, delta, note, slot avvisi). |
| UI-OVR-3 | accoppiamento server | 1 | `src/app/(app)/page.tsx:27-58` (3 letture), `src/modules/accounts/ui/net-worth-card.tsx:29` e `src/modules/budgets/ui/overview-card.tsx:16` (card async che leggono da sole) | La pagina e due card sono Server Component con lettura propria. | 3 hook dati (`useAccountsView`, `useNetWorthSeries`, `useBudgetsOverview`) + card pure. |

## 5. Accounts

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-ACC-1 | doppione | 1 | `src/app/(app)/accounts/page.tsx:229-233`, `:286-290`, `src/app/(app)/accounts/[id]/page.tsx:152-154`; `src/app/(app)/investments/[accountId]/layout.tsx:70-86`; `src/app/(app)/settings/integrations/connection-row.tsx:9-21,50-55` | Lo stato di sincronizzazione ("manuale / mai / N ore fa / errore / revocata") è composto a mano in 5 punti con 3 vocabolari (`accounts.synced.*`, `investments.header.state.*`, `settings.integrations.states.*`). | `SyncStatus` (pallino + parola + "ultima sync") con un solo modello `{state, lastOkAt, lastError}`. |
| UI-ACC-2 | componente simile | 1 | `src/app/(app)/accounts/[id]/page.tsx:142-190`, `src/app/(app)/investments/[accountId]/layout.tsx:93-136`, `src/app/(app)/funds/[id]/page.tsx:156-198` | Intestazione di dettaglio (riga meta con `·`, `h1`, cifra, tab) scritta 3 volte. | `DetailHeader` (meta, titolo, badge, hero, azioni, tab, periodo). |
| UI-ACC-3 | doppione | 1 | `src/app/(app)/accounts/page.tsx:339-371` (lista `:349`), `src/app/(app)/investments/page.tsx:718-761`, `src/app/(app)/funds/page.tsx:802-832` | Card "composizione" (`CompositionBar` + lista `grid-cols-[minmax(0,1fr)_auto_auto]` con pallino, importo, quota) scritta 3 volte, quasi riga per riga. | `CompositionCard` (`parts`, `groupBy` opzionale, nota). |
| UI-ACC-4 | componente simile | 1 | `src/modules/accounts/ui/period-bar.tsx:31-57` contro `src/modules/transactions/ui/filter-bar.tsx:100-128` | La stessa composizione `PeriodStepper + RangePicker + LinkTabs(preset)` è scritta due volte; `PeriodBar` nasce per riusarla (`period-bar.tsx:11`) ma Expenses non la usa. | Un solo `PeriodBar` usato anche da Expenses. |
| UI-ACC-5 | componente simile | 1 | `src/modules/accounts/ui/balance-entries.tsx:90-150` (`EditEntryDialog`), `src/modules/funds/ui/fund-forms.tsx:399-535` (`ValuationFields`, `ValuationButton`, `EditValuationButton`), `src/modules/investments/ui/dialogs.tsx:1410-1470` (`UpdateValueDialog`), `:720-815` (`ReconcileDialog`) | "Aggiorna valore / registra saldo a una data" esiste 4 volte: data + importo + nota, salvati come saldo del conto. | `ValueEntryDialog` (data, importo, nota, riga "ultimo valore"). |
| UI-ACC-6 | doppione | 1 | `<Select>` con `accounts.map` in `src/modules/interests/ui/rule-dialog.tsx:113`, `subscriptions/ui/subscription-dialog.tsx:150`, `funds/ui/fund-forms.tsx:168,823`, `budgets/ui/add-budget.tsx:107`, `pockets/ui/pocket-actions.tsx:148`, `transactions/ui/filter-bar.tsx:198` | Selettore conto scritto 7 volte. | `AccountSelect` in `packages/ui`. |
| UI-ACC-7 | accoppiamento server | 3 | `src/app/(app)/accounts/[id]/page.tsx:82-138` (7 letture in sequenza), `:265` (`OverviewTab` async), `:220` (`await` dentro il JSX), `src/modules/accounts/actions.ts` (12 azioni, 28 `revalidatePath`) | Il dettaglio conto carica tutto per ogni tab. | Una query per tab; invalidazione per chiave al posto dei 28 `revalidatePath`. |
| UI-ACC-8 | file grande | 2 | `src/app/(app)/accounts/[id]/page.tsx` (560) | Pagina + 3 tab + view-model in un file. | Un file per tab. |

## 6. Expenses / Transactions

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-EXP-1 | componente simile | 1 | Expenses: `filter-bar.tsx:100-128` (stepper + range giorno + preset). Investments e Funds: `src/modules/investments/ui/period-control.tsx:41-151` (`Anno · Tutto · Personalizzato`), usato in `investments/page.tsx:350`, `funds/page.tsx:223`, `funds/[id]/page.tsx:186`, `service-nav.tsx:89`. Budgets: `budgets/page.tsx:49` (solo stepper). Time Off: `year-picker.tsx:8`. | 4 controlli di periodo. Funds riusa già quello di Investments (stesso componente, stesso namespace `investments.period`): qui il doppione non c'è. Il doppione è tra Expenses/Accounts e Investments/Funds: stesso `DateRangePicker`, due involucri (`range-picker.tsx:14-60`, `period-picker.tsx:14-60`) e due set di messaggi con 8 stringhe identiche (`expenses.filters.range`, `investments.period`). | `PeriodControl` unico con modalità (`preset`, `year`, `all`, `custom`) e granularità (`day`, `month`, `year`); messaggi in `common.period`. |
| UI-EXP-2 | componente simile | 1 | `src/ui/category-picker.tsx` (211 righe, 5 usi: `add-budget.tsx:78`, `rule-dialog.tsx:248`, `subscription-dialog.tsx:124`, `transactions-table.tsx:260,374`) contro il filtro `<details>` in `src/modules/transactions/ui/filter-bar.tsx:132-170` | Il selettore categoria è già condiviso; resta una seconda implementazione multi-scelta nel filtro. | `CategoryPicker` con `multiple`. |
| UI-EXP-3 | accoppiamento server | 1 | `src/modules/transactions/ui/filter-bar.tsx:58`, `spending-card.tsx:26`, `breakdown-card.tsx:61`, `shortcuts-card.tsx:12` (4 componenti async) + `src/app/(app)/expenses/page.tsx:58-116`; filtri come `<details>` + form GET (`filter-bar.tsx:132,177,215,269`) | Barra filtri e card sono Server Component; i filtri funzionano senza JavaScript tramite navigazione GET. | Barra filtri client con stato nell'URL via router; `<details>` → `Popover`/sheet su mobile. |
| UI-EXP-4 | file grande | 2 | `src/modules/transactions/ui/transactions-table.tsx` (596) | Tabella, lista mobile, selezione multipla, menu riga, modale. | `DataTable` + `useSelection` + `TransactionRowMenu`. |

## 7. Budgets, Subscriptions, Pockets, Interests

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-BUD-1 | componente simile | 1 | `src/app/(app)/budgets/page.tsx:112-121` (KPI in `<dl>`), `src/app/(app)/budgets/[id]/page.tsx:72` (hero), `src/modules/budgets/ui/overview-card.tsx:16-83` | Riepilogo budget con KPI e barra scritti a mano; nessun `KpiTile`. | `Stat` + `ProgressBar` (UI-DS-5, UI-DS-12). |
| UI-BUD-2 | accoppiamento server | 1 | `src/app/(app)/budgets/[id]/page.tsx:45` | Legge la sessione con `headers()` dentro la pagina. | Dato utente dal provider di sessione. |
| UI-SUB-1 | file grande | 2 | `src/modules/subscriptions/ui/subscriptions-table.tsx` (413) | Due tabelle (`:150`, `:337`), lista mobile (`:248`), barra a mano (`:77`). | `DataTable` + `ProgressBar`. |
| UI-SUB-2 | debito | 2 | `src/app/(app)/subscriptions/page.tsx:61` | Export CSV come `<a href download>` verso un route handler. | Azione "esporta" con download per piattaforma. |
| UI-PCK-1 | file grande | 2 | `src/modules/pockets/ui/pocket-actions.tsx` (725) | 5 dialoghi + conferma + menu: `PocketDialog:89`, `AddToPocketDialog:214`, `PlannedExpenseDialog:312`, `LinkExpenseDialog:396`, `ConfirmDialog:474`. | Un file per dialogo sopra `FormDialog`. |
| UI-PCK-2 | componente simile | 1 | `src/app/(app)/pockets/[id]/page.tsx:100-165` | Hero + barra + griglia `<dl>` a 5 voci a mano. | `HeroFigure` + `StatGrid`. |
| UI-INT-1 | componente simile | 1 | `src/modules/interests/ui/rule-dialog.tsx:217` (cadenza di liquidazione), `src/modules/funds/ui/fund-forms.tsx:178` (giorno di addebito 1-31), `src/modules/subscriptions/ui/subscription-dialog.tsx` (cadenza), `src/app/(app)/settings/integrations/schedule-control.tsx:535-959` (`RepeatFields`, `WeekdayChips:851`, `MonthDayChips:881`, `DaysEditor:914`) | Le ricorrenze di dominio (mensile, giorno del mese, cadenza) hanno ognuna il proprio campo, mentre il selettore completo esiste solo per le sync. | `RecurrenceField` (cadenza + giorno) riusando `WeekdayChips` / `MonthDayChips`. |

## 8. Investments

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-INV-1 | doppione | 1 | `src/app/(app)/investments/page.tsx` (869) contro `src/app/(app)/funds/page.tsx` (924) | Stesso scheletro di home, scritto due volte. Vedi §8.1. | `PortfolioHome` condiviso (vedi UI-FND-1). |
| UI-INV-2 | doppione | 1 | `src/app/(app)/investments/page.tsx:367-395`, `src/app/(app)/investments/[accountId]/page.tsx:206-225`, `src/app/(app)/funds/page.tsx:863-895`, `src/app/(app)/funds/[id]/page.tsx:743-760` | Blocco hero identico (`text-[2rem] leading-tight … TONE_TEXT[toneOfSign(…)]` + tasso `text-lg`) in 4 punti. | `HeroFigure`. |
| UI-INV-3 | doppione | 1 | `src/app/(app)/investments/page.tsx:483-609`, `src/app/(app)/investments/[accountId]/page.tsx:392-490`, `src/modules/funds/ui/fund-chart.tsx:166-254` | Card "andamento": titolo + nota, `LinkTabs` `pnl/gain · value`, `StackedBars` o `StackedArea`, riga legenda, `<details>` con la tabella dei dati. Scritta 3 volte. | `PerformanceCard` (serie, vista, legenda, tabella dati accessibile). |
| UI-INV-4 | doppione | 1 | `src/app/(app)/investments/page.tsx:437-469` contro `src/app/(app)/funds/page.tsx:351-383` | Avvisi: 1 avviso = link con badge, più avvisi = `Popover` con elenco. Stessa struttura e stesse classi. | `AlertsSummary` (`items`, `hrefFor`). |
| UI-INV-5 | componente simile | 1 | `src/app/(app)/investments/catalog/page.tsx:32-103` (card del catalogo), `:125-131` (sezione "Coming soon"); voci in `src/modules/investments/catalog.ts` | **"Manual account"**: voce `catalog.ts:66-73` (`name: "Manual account"` `:68`), nome mostrato da `catalog/page.tsx:44` (`catalog.manualName`, `messages/en.json:3265`), pulsante `:64`. **"Coming soon"**: stato `planned` in `catalog.ts:51` (tutti gli exchange creati da `exchange()`, `:45-61`), `:95` (IBKR), `:103` (Degiro), `:111` (Trade Republic), `:119` (Scalable); filtro `catalog/page.tsx:28-31`; badge `:45-47` (`catalog.status.planned`, `en.json:3263`); descrizione `:54` (`en.json:3267`); sezione chiusa `:125-131` (`catalog.plannedSection`, `en.json:3270`). | Decisione approvata: il catalogo sparisce. Dialog «Aggiungi investimento» a 3 scelte; nessuna voce «Coming soon» e nessuna scheda «Manual account» (rilascio R5b). |
| UI-INV-6 | componente simile | 1 | Log di sync: `src/app/(app)/settings/integrations/page.tsx:167-209` (tabella delle esecuzioni, `RUN_TONE :54`, durata `:62-65`), `src/app/(app)/investments/[accountId]/connection/page.tsx:310-478` (`Received`, copertura per stream `:445-475`), `:484-560` (`ReadingRuns`); log affini: `settings/data/page.tsx:28-32` (snapshot), `settings/server/jobs-card.tsx:29-112` (job) | 4 viste "registro" con struttura riga diversa (tabella senza variante mobile, lista piegata, card). | `RunLog` (`at`, `kind`, `state`, `duration`, `counts`, `detail`) usato da Integrations, Connection, Data e Server. |
| UI-INV-7 | file grande | 2 | `src/modules/investments/ui/dialogs.tsx` (1.511) | 20 componenti esportati o interni: primitivi form (`:107-358`), servizio manuale (`:360-493`), menu operazioni e posizioni (`:495-709`), riconciliazione (`:711-815`), trasferimenti (`:890-975`), connessione provider (`:977-1173`), sync (`:1175-1241`), chiave e disconnessione (`:1243-1360`), `HeaderDialogs :1362`, `UpdateValueDialog :1410`, `ServiceActions :1472`. Unico file dell'area che importa le 15 azioni. | Primitivi in `packages/ui`; un file per flusso (`connect`, `holdings`, `transfers`, `sync`, `value`). |
| UI-INV-8 | file grande | 2 | `investments/page.tsx` (869), `[accountId]/positions/page.tsx` (724), `[accountId]/page.tsx` (600), `[accountId]/connection/page.tsx` (560), `[accountId]/activity/page.tsx` (529) | 5 pagine server oltre 500 righe: lettura, view-model e JSX insieme. | Per pagina: hook dati + `selectors.ts` puro + componenti di sezione. |
| UI-INV-9 | accoppiamento server | 1 | `src/app/(app)/investments/[accountId]/layout.tsx:33-141`, `service-nav.tsx:63-100` | Il layout server non riceve i `searchParams`, quindi il periodo è ricalcolato sul client con le stesse regole (`service-nav.tsx:58-61`). `PeriodControl` riceve `t` come prop per funzionare da entrambi i lati (`period-control.tsx:12-13,35-40`). | In client-only il doppio percorso sparisce: `PeriodControl` usa `useTranslations` e il router. |
| UI-INV-10 | debito | 1 | `src/app/(app)/timeoff/settings/page.tsx:9-12`, `src/app/(app)/investments/[accountId]/connection/page.tsx:26-28` | 7 import da `@/app/(app)/settings/integrations/*` (`ConnectionRow`, `ScheduleControl`, `formatInstant`, `recommendedSchedule`): componenti condivisi che vivono nella cartella di una route. | Spostare in `packages/ui` (`ConnectionRow`, `ScheduleControl`) e nel formatter condiviso. |

### 8.1 Funds contro Investments: coppie di file (punto 2)

| Parte | Investments | Funds | Stato |
| --- | --- | --- | --- |
| Home: redirect legacy + periodo | `investments/page.tsx:42-51` | `funds/page.tsx:66-75` | doppione |
| Home: stato vuoto | `investments/page.tsx:80-96` | `funds/page.tsx:150-160` | doppione |
| Home: titolo + `PeriodControl` | `investments/page.tsx:347-361` | `funds/page.tsx:220-234` | doppione (stesso componente) |
| Home: hero guadagno + tasso | `investments/page.tsx:367-436` | `funds/page.tsx:863-903` | doppione |
| Home: avvisi | `investments/page.tsx:437-469` | `funds/page.tsx:351-383` | doppione |
| Home: riga KPI | `investments/page.tsx:774-845` (`PartsKpis`, `KpiTile`) | `funds/page.tsx:426-480` (`Kpi`) | stesso schema, 2 componenti KPI |
| Home: card grafico | `investments/page.tsx:483-609` | `src/modules/funds/ui/fund-chart.tsx:22-255` | doppione |
| Home: elenco (tabella + lista) | `investments/page.tsx:612-716` | `funds/page.tsx:698-790` | doppione |
| Home: composizione | `investments/page.tsx:718-761` | `funds/page.tsx:802-832` | doppione |
| Home: layout a due colonne | `investments/page.tsx:611` (`@4xl`) | `funds/page.tsx:913` (`@6xl`) | stessa griglia, soglia diversa |
| Dettaglio: guscio (meta, `h1`, azioni, tab, periodo) | `investments/[accountId]/layout.tsx:88-140` + `service-nav.tsx` | `funds/[id]/page.tsx:156-223` + `funds/[id]/layout.tsx` | stesso schema, due meccanismi (route contro `?tab=`) |
| Dettaglio: panoramica | `investments/[accountId]/page.tsx` | `funds/[id]/page.tsx:340-818` | stesso schema (hero, KPI, grafico, ultimi movimenti) |
| Dettaglio: posizioni | `investments/[accountId]/positions/page.tsx` | nessun equivalente (un fondo non ha posizioni); il più vicino è `fund-valuations.tsx` | solo Investments |
| Dettaglio: movimenti | `investments/[accountId]/activity/page.tsx` | `src/modules/funds/ui/pac-deposits.tsx`, `pension-contributions.tsx` | componente simile |
| Dettaglio: impostazioni / connessione | `investments/[accountId]/connection/page.tsx` | `src/modules/funds/ui/pac-settings.tsx`, `pension-settings.tsx` | componente simile |
| Tab | `investments/[accountId]/layout.tsx:49-67` (overview, positions, activity, connection) | `funds/[id]/page.tsx:47` (`PAC_TABS`), `pension-settings.tsx:21` (`PENSION_TABS`) | stesso schema |
| Dialoghi | `src/modules/investments/ui/dialogs.tsx` | `src/modules/funds/ui/fund-forms.tsx`, `pension-forms.tsx` | helper duplicati (UI-DS-9) |
| "Aggiorna valore" | `dialogs.tsx:1410-1470` | `fund-forms.tsx:430-488` | componente simile (UI-ACC-5) |
| Scheletri di caricamento | nessuno | `funds/home-skeleton.tsx`, `funds/[id]/fund-skeleton.tsx` | solo Funds |
| Periodo e messaggi | `src/modules/investments/period.ts`, `investments.period` | importati da Funds (`funds/page.tsx:25-27,98`) | già condiviso |

## 9. Funds

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-FND-1 | doppione | 1 | Vedi §8.1: 9 blocchi di home e 3 di dettaglio | Funds e Investments sono lo stesso prodotto UI ("portafoglio con periodo") implementato due volte: circa 1.800 righe di pagina home in due file. | `PortfolioHome` e `PortfolioDetail` in `packages/ui`, parametrizzati da un view-model (`hero`, `kpis`, `series`, `rows`, `composition`, `alerts`, `tabs`). Funds e Investments forniscono solo i dati e le etichette. |
| UI-FND-2 | accoppiamento server | 1 | `src/modules/funds/ui/` ha 11 componenti async: `fund-chart.tsx:22`, `fund-valuations.tsx:25`, `pac-deposits.tsx:23`, `pac-settings.tsx:11`, `pension-contributions.tsx:31`, `pension-settings.tsx:36`, `projection.tsx:14,79,107,133`; `funds/page.tsx:83` e `funds/[id]/page.tsx:95` dentro `<Suspense>` (`:77`, `:89`); 10 `redirect/notFound`; 26 azioni in 3 file | Area con più Server Component: 16 funzioni async. Le tab del dettaglio sono rami `if (tab === …)` nella stessa pagina (`funds/[id]/page.tsx:226,304,318,332`), con `await` dentro il JSX (`:313,328`). | Una route (o query) per tab; ogni tab = hook dati + componente puro. I due `<Suspense>` diventano stati di caricamento della query. |
| UI-FND-3 | doppione | 1 | `src/modules/funds/ui/fund-forms.tsx:41-64` e `pension-forms.tsx:52-76` | `useResult` + `ErrorLine` duplicati dentro lo stesso modulo. | UI-DS-9. |
| UI-FND-4 | file grande | 2 | `pension-forms.tsx` (992, 16 componenti esportati), `funds/page.tsx` (924), `fund-forms.tsx` (838), `funds/[id]/page.tsx` (818), `pension-contributions.tsx` (533) | 5 file oltre 500 righe; `pension-forms.tsx` unisce import documento, revisione posizione, contributi volontari, commissioni, regole e impostazioni. | Un file per flusso; tabelle su `DataTable` (6 coppie `@5xl` nel modulo). |
| UI-FND-5 | debito | 2 | Soglie: `@5xl` in `fund-valuations.tsx:109,158,222,254`, `pac-deposits.tsx:93,135`, `pension-contributions.tsx:124,174,232,273,398,422`; `@3xl` in `funds/page.tsx:523,584,702,747`; il resto dell'app usa `md:` | Funds passa da tabella a lista con container query, le altre aree con il viewport: comportamento diverso alla stessa larghezza. | Una sola soglia nel `DataTable`. |
| UI-FND-6 | debito | 2 | `src/modules/funds/ui/pension-forms.tsx:81-190` (`ImportCometaButton`), `src/modules/payroll/ui/add-payslips.tsx` | Upload PDF con `<input type="file">` + Server Action con `FormData`. | Upload multipart REST; selettore file nativo su Capacitor/Tauri. |

## 10. Payroll

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-PAY-1 | accoppiamento server | 3 | `src/modules/payroll/ui/auto-refresh.tsx` (23 righe, `router.refresh()` a intervalli), `src/app/(app)/payroll/[id]/page.tsx:42-51` | Lo stato di elaborazione del cedolino è seguito ricaricando la pagina server. | Polling della query (o SSE) sul documento. |
| UI-PAY-2 | debito | 2 | `src/app/(app)/payroll/[id]/page.tsx:176` (`<a href="/payroll/{id}/original" target="_blank">`), `src/ui/pdf-viewer.tsx` (217), `src/ui/pdf-assets.ts` | L'originale PDF si apre da un route handler in una nuova scheda; il viewer dipende da asset serviti dall'app web. | URL firmato REST + apertura per piattaforma; asset del viewer nel bundle di `packages/ui`. |
| UI-PAY-3 | componente simile | 1 | `src/modules/payroll/ui/register-table.tsx:62-222` | Unica tabella con `<table>` raw e intestazioni fisse (`h-[calc(100dvh-280px)]`), più lista mobile (`:186`). | `DataTable` con `stickyHeader` e gruppi. |
| UI-PAY-4 | componente simile | 1 | `src/modules/payroll/ui/present.ts:20` (`STATE_TONE`), `settings/integrations/page.tsx:54` (`RUN_TONE`), `connection-row.tsx:9-21` (`DOT`, `STATUS_TONE`) | Tre mappe stato → tono, una per area. | `StatusBadge` con mappa per dominio registrata una volta. |

## 11. Time Off

Interazioni del calendario (punto 6), tutte in `src/modules/timeoff/ui/year-calendar.tsx`:

| Gesto | Cosa fa | Dove |
| --- | --- | --- |
| Click | Ciclo niente → ferie → ROL → ferie (`cycleDayAction`); se il giorno non è ciclabile apre il dialogo | funzione `click` `:78-91`, handler `onClick` `:299-306` |
| Pressione lunga, tasto sinistro (450 ms) | Mezza giornata e ritorno (`halveDayAction`) | `HOLD_MS` `:15`, `pressStart` `:133-154`, `onPointerDown` `:280-285` |
| Pressione lunga, tasto destro | Mezza ferie + mezza ROL (`splitDayAction`) | `pressStart` `:140-143`, `onPointerDown` `:284` |
| Click destro | Cancella il giorno (`clearDayAction`) | `clear` `:103-116`, `onPointerUp` `:286-297`, `onContextMenu` `:307-314`, anti-doppio `rightHandled` `:64-69,312` |
| Alt o Shift + click | Apre il dialogo (nota, altri tipi) | `:302-304`, `openDialog` `:181-186` |
| Fine pressione / uscita | Annulla il timer, ingoia il click di coda | `endPress` `:161-165`, `cancelPress` `:168-172`, `consumeHold` `:175-179`, `onPointerLeave` `:298` |
| Tastiera | Frecce, Home, End; Canc e Backspace cancellano | `onKeyDown` `:226-244`, `move` `:188-202` |

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-TOF-1 | debito | 2 | `year-calendar.tsx:284,286-297,304,307-314` | Tre gesti su cinque non esistono su touch: click destro, pressione lunga con tasto destro, Alt/Shift + click. Su Android la pressione lunga compete con il menu contestuale del sistema. Cancellare un giorno da telefono è possibile solo dal dialogo. | Decisione approvata: selezione primo e ultimo giorno + pannello (tipo, durata) e pulsante «Aggiungi assenza». Tutti i gesti nascosti spariscono su ogni piattaforma (rilascio N5). |
| UI-TOF-2 | accoppiamento server | 3 | `year-calendar.tsx:80-82,105-110,143-145` | Ogni gesto chiama una Server Action e poi `router.refresh()`: nessun aggiornamento ottimistico, un round trip per click. Il commento `:96-101` documenta un bug nato dai dati di prop non aggiornati. | Mutazione ottimistica sulla cache del calendario. |
| UI-TOF-3 | doppione | 1 | `src/app/(app)/timeoff/page.tsx:359-388` contro `src/modules/timeoff/ui/kind-card.tsx:45-62` | La card "totale preso" ricopia a mano lo scheletro di `KindCard`. | `KindCard` con slot per la legenda. |
| UI-TOF-4 | doppione | 1 | `src/app/(app)/timeoff/page.tsx:428-444` | Quarto "segmented" a mano per il filtro della tabella (UI-DS-1). | `Segmented`. |
| UI-TOF-5 | componente simile | 1 | `year-calendar.tsx:206-399` (12 griglie mese), `src/ui/date-range-picker.tsx:34-45` (`calendarCells`), `src/app/(app)/timeoff/settings/holiday-calendars.tsx` | Due griglie calendario indipendenti (anno ferie e selettore intervallo), ciascuna con le proprie iniziali dei giorni (UI-DS-22). | `MonthGrid` primitivo condiviso (celle, intestazione, navigazione da tastiera). |
| UI-TOF-6 | file grande | 2 | `src/app/(app)/timeoff/page.tsx` (558), `year-calendar.tsx` (426) | Pagina con card, calendario, tabella e helper (`Legend :533`, formatter `:551`). | Sezioni separate; cella giorno (`year-calendar.tsx:268-393`) come componente proprio. |

## 12. Settings

Tab di Settings (`src/app/(app)/settings/layout.tsx:11-25`, disegnate da `settings-tabs.tsx:9-12`; `/settings` reindirizza a profile, `settings/page.tsx:3-5`):

| Tab | Route | Riga | File della pagina | Sezioni |
| --- | --- | --- | --- | --- |
| Profile | `/settings/profile` | 12 | `profile/page.tsx`, `name-form.tsx`, `preferences-form.tsx` | Account (`page.tsx:36`), Preferenze (`:44`) |
| Security | `/settings/security` | 13 | `security/page.tsx`, `sign-in-method.tsx`, `password-form.tsx`, `two-factor-card.tsx`, `api-clients-table.tsx`, `new-api-client.tsx`, `connected-apps-table.tsx`, `sessions-list.tsx`, `actions.ts` | Accesso (`:72`), 2FA (`:77`), Client API (`:85`), App collegate (`:93`), Sessioni (`:100`) |
| Integrations | `/settings/integrations` | 14 | `integrations/page.tsx`, `wallet-card.tsx`, `trek-card.tsx`, `connection-row.tsx`, `schedule-control.tsx`, `schedule-form.ts`, `schedule-describe.ts`, `recommended-schedule.ts`, `format-instant.ts`, `actions.ts` | Connessioni Wallet e Trek (`:122`), Investimenti (`:134`), Registro esecuzioni (`:167`) |
| Categories | `/settings/categories` | 15 | `categories/page.tsx`, `category-tree.tsx`, `labels-card.tsx`, `color-swatch.tsx`, `actions.ts` | Categorie (`:66`), Etichette (`:69`) |
| Data | `/settings/data` | 16 | `data/page.tsx`, `export.zip/route.ts` | Snapshot (`:24`), Registro snapshot (`:28`), Export (`:67`) |
| Users (admin) | `/settings/users` | 21 | `users/page.tsx` + `src/modules/users/ui/people-table.tsx`, `invite-person.tsx` | Persone (`:40`) |
| Server (admin) | `/settings/server` | 22 | `server/page.tsx`, `oidc-card.tsx`, `smtp-card.tsx`, `llm-card.tsx`, `jobs-card.tsx`, `maintenance-card.tsx`, `actions.ts` | OIDC (`:59`), SMTP (`:75`), LLM (`:87`), Job (`:90`), Manutenzione (`:93`) |

Impostazioni fuori da Settings: `/timeoff/settings` (`timeoff/settings/page.tsx`) e `/payroll/settings` (`payroll/settings/page.tsx`), raggiungibili dalle tab della sezione e dalla palette (`src/app/(app)/layout.tsx:62-71`).

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-SET-1 | accoppiamento server | 1 | 5 file azioni (`settings/categories/actions.ts` 8, `integrations/actions.ts` 10, `security/actions.ts` 3, `server/actions.ts` 11, `src/modules/users/actions.ts` 13) = 45 azioni; 18 file che le importano; 34 `revalidatePath`; 7 `cookies()/headers()` | Area con più azioni e più client component (24). Le azioni vivono nelle cartelle delle route, non in un modulo. | Endpoint REST per risorsa (`/preferences`, `/categories`, `/labels`, `/connections`, `/api-clients`, `/sessions`, `/server/*`). |
| UI-SET-2 | file grande | 2 | `src/app/(app)/settings/integrations/schedule-control.tsx` (959) | Selettore di pianificazione completo in un file di route: `ScheduleControl :133`, `ScheduleDialog :234`, `RepeatFields :535`, `TimeInput :605`, `RuleEditor :630`, `TimesEditor :767`, `WeekdayChips :851`, `MonthDayChips :881`, `DaysEditor :914`. Usato da 3 schermate (`integrations/page.tsx:96`, `timeoff/settings/page.tsx:151`, `investments/[accountId]/connection/page.tsx:216`). | `packages/ui/schedule/*` (un file per editor) + azione di salvataggio iniettata. |
| UI-SET-3 | componente simile | 1 | `settings/integrations/connection-row.tsx:28-76` usato da `wallet-card.tsx:103`, `trek-card.tsx:96`, `integrations/page.tsx:146`, `timeoff/settings/page.tsx:145`; non usato da `investments/[accountId]/connection/page.tsx:204-225` (scheda `<dl>` propria) né da `src/modules/accounts/ui/connections.tsx:105-130` | La riga di connessione è condivisa in 4 punti ma la pagina Connection di Investments ridisegna stato, ultima sync e pianificazione. | `ConnectionRow` + `SyncStatus` (UI-ACC-1) ovunque. |
| UI-SET-4 | componente simile | 1 | `wallet-card.tsx` (279) e `trek-card.tsx` (270) | Due card con la stessa macchina a stati (assente / attiva / errore / revocata), modale token, modale di conferma e `messageFor` propri (`wallet-card.tsx:64`, `trek-card.tsx:53`). | `ProviderConnectionCard` parametrico (campi credenziali, azioni). |
| UI-SET-5 | doppione | 1 | `security/api-clients-table.tsx:47-80`, `security/connected-apps-table.tsx:56-89`, `server/jobs-card.tsx:47-91`, `src/modules/users/ui/people-table.tsx:170-242` | 4 tabelle di Settings scritte due volte; le altre 3 (`integrations/page.tsx:172`, `data/page.tsx:32`, `categories/labels-card.tsx:119`) non hanno variante mobile e scorrono in orizzontale. | `DataTable`. |
| UI-SET-6 | componente simile | 1 | `settings/categories/color-swatch.tsx:15-92` (`ColorDot`, `ColorSwatchPicker`), `src/modules/accounts/ui/settings-form.tsx` (colore del conto), palette in `src/modules/accounts/ui/display.ts:11-22` | Il selettore colore esiste solo per le categorie; la palette è in un altro modulo. | `ColorPicker` + palette nei token. |
| UI-SET-7 | accoppiamento server | 1 | `settings/profile/page.tsx:22,29` (`headers()`, `Intl.supportedValuesOf` sul server), `settings/security/page.tsx:30`, `src/modules/users/actions.ts:52,63` (cookie tema) | Profilo e sicurezza leggono la sessione con `headers()`; il tema viene salvato scrivendo un cookie in una Server Action. | Sessione e preferenze via REST; tema nello storage di piattaforma. |
| UI-SET-8 | debito | 2 | `src/ui/unsaved-changes.tsx:163-241` (intercetta i click sui link, `:198-200`) | L'avviso "modifiche non salvate" si basa su `window.location` e sui click sugli `<a>`. Non copre il tasto indietro di Android. | Blocco di navigazione del router + gestione del back hardware. |

## 13. Auth e root (fuori elenco, per completezza)

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-AUT-1 | accoppiamento server | 1 | `src/app/(auth)/**`: 7 pagine async, 7 `redirect`, `actions.ts:36` (`headers()`), `sign-in/destination.ts:14` e `oauth/consent/consent-form.tsx:43` (`window.location.assign`) | Accesso con cookie di sessione e redirect server; OIDC con redirect del browser. | Flusso di accesso per piattaforma (cookie sul web, deep link / token su Capacitor e Tauri). |
| UI-AUT-2 | accoppiamento server | 1 | `src/app/layout.tsx:36-52` (`getLocale`, `cookies()`), `:13-28` (`next/font/local`), `:46` (script inline del tema) | Lingua, tema e font risolti sul server al primo render. | Bootstrap client: lingua e tema da storage, font nel bundle. |

## 14. Messaggi (`messages/en.json`, `messages/it.json`)

| ID | Tipo | P | Dove | Cosa | Proposta |
| --- | --- | --- | --- | --- | --- |
| UI-MSG-1 | doppione | 1 | 3.619 chiavi per lingua, 20 namespace; `investments` 775, `settings` 647, `funds` 640, `payroll` 307, `accounts` 229 | 381 valori inglesi compaiono più di una volta (851 copie in più): `Cancel` ×31, `Save` ×19, `Value` ×18, `Date` ×17, `Name` ×14, `Couldn't save. Try again.` ×13. Nomi di chiave ripetuti: `cancel` ×34, `save` ×26, `failed` ×42, `empty` ×53. `common` ha solo 7 chiavi (`en.json`, namespace `common`), tra cui `save` e `cancel` che i moduli non usano. | Namespace `common.actions`, `common.fields`, `common.errors`, `common.period`; i moduli tengono solo le stringhe proprie. |
| UI-MSG-2 | doppione | 1 | `expenses.filters.range` (`en.json:1063`) e `investments.period` (`en.json:3689`) | 11 nomi di chiave in comune, 8 con valore identico (`from`, `to`, `apply`, `cancel`, `pickEnd`, `previousMonth`, `nextMonth`, `hint`). Funds usa `investments.period` (`funds/page.tsx:98`). | `common.period` unico. |
| UI-MSG-3 | debito | 2 | namespace `gallery` (`en.json:1271`, 89 chiavi) | Nessun riferimento in `src/` (solo una menzione in un commento, `src/platform/format.ts:22`). Da confermare prima di rimuovere: la ricerca copre `src`, `tests`, `test`. | Rimuovere o spostare nella documentazione del design system. |
| UI-MSG-4 | nota | 2 | entrambe le lingue | Strutture allineate (0 chiavi solo in una lingua) e 0 chiavi doppie nello stesso oggetto. | Nessuna azione. |

## 15. File componente oltre 400 righe (punto 8)

| # | File | Righe | Natura |
| --- | --- | --- | --- |
| 1 | `src/modules/investments/ui/dialogs.tsx` | 1.511 | client, 15 azioni |
| 2 | `src/modules/funds/ui/pension-forms.tsx` | 992 | client |
| 3 | `src/app/(app)/settings/integrations/schedule-control.tsx` | 959 | client |
| 4 | `src/app/(app)/funds/page.tsx` | 924 | server |
| 5 | `src/app/(app)/investments/page.tsx` | 869 | server |
| 6 | `src/modules/funds/ui/fund-forms.tsx` | 838 | client |
| 7 | `src/ui/chart.tsx` | 836 | design system |
| 8 | `src/app/(app)/funds/[id]/page.tsx` | 818 | server |
| 9 | `src/modules/pockets/ui/pocket-actions.tsx` | 725 | client |
| 10 | `src/app/(app)/investments/[accountId]/positions/page.tsx` | 724 | server |
| 11 | `src/app/(app)/investments/[accountId]/page.tsx` | 600 | server |
| 12 | `src/modules/transactions/ui/transactions-table.tsx` | 596 | client |
| 13 | `src/app/(app)/investments/[accountId]/connection/page.tsx` | 560 | server |
| 14 | `src/app/(app)/accounts/[id]/page.tsx` | 560 | server |
| 15 | `src/app/(app)/timeoff/page.tsx` | 558 | server |
| 16 | `src/modules/funds/ui/pension-contributions.tsx` | 533 | server |
| 17 | `src/app/(app)/investments/[accountId]/activity/page.tsx` | 529 | server |
| 18 | `src/modules/timeoff/ui/year-calendar.tsx` | 426 | client |
| 19 | `src/modules/subscriptions/ui/subscriptions-table.tsx` | 413 | client |

Totale 13.971 righe su 34.167 (41%). 10 dei 19 sono Server Component che uniscono lettura dati, view-model e JSX: sono i file da dividere per primi nel passaggio a client-only. Investments e Funds insieme ne contano 11.

## 16. Componenti condivisi proposti (riepilogo per il piano)

| Componente | Sostituisce | Riferimenti |
| --- | --- | --- |
| `DataTable` | 28 coppie tabella + lista, 12 tabelle senza mobile | UI-DS-3 |
| `PortfolioHome` / `PortfolioDetail` | Home e dettaglio di Funds e Investments | UI-FND-1, UI-INV-1 |
| `HeroFigure` | 8 blocchi hero | UI-INV-2, UI-OVR-2, UI-PCK-2 |
| `PerformanceCard` | 3 card grafico | UI-INV-3 |
| `CompositionCard` | 3 card composizione | UI-ACC-3 |
| `PeriodControl` + `Segmented` + `Stepper` | 4 controlli di periodo, 4 segmented, 3 stepper | UI-EXP-1, UI-DS-1, UI-DS-2 |
| `KpiTile` / `Stat` / `KpiRow` | 2 tile, 6 KPI a mano, 9 griglie | UI-DS-4, UI-DS-5, UI-DS-6 |
| `DetailHeader` + `SectionTabs` | 3 intestazioni di dettaglio, 8 dichiarazioni di tab | UI-ACC-2, UI-NAV-3 |
| `FormDialog`, `ConfirmDialog`, `MoneyField`, `DateField`, `FormError`, `useMutationResult` | 4 hook errore, 2 conferme, 49 modali composte a mano | UI-DS-9, UI-DS-10, UI-DS-11 |
| `ValueEntryDialog` | 4 dialoghi "aggiorna valore" | UI-ACC-5 |
| `SyncStatus`, `ConnectionRow`, `RunLog`, `ScheduleControl` | 5 stati di sync, 4 registri, selettore in cartella di route | UI-ACC-1, UI-INV-6, UI-SET-2, UI-SET-3 |
| `AccountSelect`, `CategoryPicker` (multi), `ColorPicker`, `ColorDot`, `TextLink` | 7 select conto, 1 filtro categoria, 23 pallini, 58 link | UI-ACC-6, UI-EXP-2, UI-SET-6, UI-DS-13, UI-DS-14 |
| `useFormat()` + formatter condiviso | 54 chiusure locali, 15 usi diretti di `Intl` | UI-DS-22, UI-DS-23 |
| `design-tokens` | 364 valori arbitrari, palette serie, backdrop, ombre | UI-DS-15 … UI-DS-19 |
