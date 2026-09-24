# 🕊️ Encrypted Pigeon

Private 1:1-Messenger für einen kleinen, eingeladenen Freundeskreis.
Next.js 14 (App Router) + Supabase, als PWA installierbar.

## Funktionen

- **Dashboard (`/`):** alle eigenen Chats (neueste zuerst, live aktualisiert),
  „Neue Unterhaltung" mit jedem Mitglied, ohne Chat. Der Admin lädt hier per
  E-Mail ein und sieht offene Einladungen. Ab Tablet-Breite bleibt die
  Chatliste im Chat als Seitenleiste zum schnellen Wechseln.
- **Normaler Chat:** Text, Bilder, Sprachnachrichten — sofort zugestellt. Beim
  Absender läuft davor die (augenzwinkernde) Hacker-„Verschlüsselung"
  (antippen zum Überspringen).
- **Brieftaube (🕊️-Taste im Eingabefeld):** Brief statt Chatnachricht. Keine
  Verschlüsselungs-Show, dafür Flug mit Route, Zwischenfällen und Live-Karte.
  Der Empfänger sieht nur „eine Taube ist unterwegs" — **lesen kann er den
  Brief erst, wenn die Taube gelandet ist** (per RLS erzwungen, auch für
  Anhänge und Push-Benachrichtigungen).
- **Einstellungen (`/settings`):** Anzeigename, Profilbild, Name der eigenen
  Brieftaube, Akzentfarbe der eigenen Nachrichten, Hell/Dunkel/System, Push.

## Entwicklung

```bash
npm install
cp .env.example .env.local   # Werte eintragen
npm run dev
```

`npm run build` prüft Typen und Lint mit — vor jedem Deploy laufen lassen.

## Supabase

Das Supabase-Projekt wird mit einem älteren, fremden Projekt geteilt. **Alles
von dieser App lebt ausschließlich im Schema `pigeon` und in den Buckets
`pigeon-chat-images` / `pigeon-voice-messages` / `pigeon-avatars`.** Zusätzlich (unvermeidlich,
aber alles klar als Pigeon benannt): Storage-Policies nur für diese
Buckets, die Tabellen `pigeon.messages`/`pigeon.pigeon_flights` in der
`supabase_realtime`-Publication, die Cron-Jobs `deliver-pigeon-flights` und
`notify-pigeon-incidents` sowie das Vault-Secret `pigeon_service_role_key`.

Migrationen liegen in `supabase/migrations/`. **Noch auf dem Live-Projekt
anzuwenden** (in dieser Reihenfolge, falls nicht schon geschehen):
`20260924000000_push_notifications`, `20260924010000_security_hardening`,
`20260924020000_dashboard_and_pigeon_letters`. Danach die Edge Functions neu
deployen — die App-Version ab dem Dashboard setzt die letzte Migration voraus
(Spalte `messages.kind`, Tabelle `pigeon.invites`, Bucket `pigeon-avatars`).

Mitgliedschaft: Nur der Admin (`ADMIN_EMAIL`) und eingeladene E-Mails
(`pigeon.invites`) bekommen ein Profil. Wer schon Mitglied war, wird von der
Migration automatisch als eingeladen übernommen.

### Einmalige manuelle Schritte

1. **Schema freigeben:** Project Settings → API → Data API → Exposed schemas → `pigeon` hinzufügen.
2. **Vault-Secret** `pigeon_service_role_key` mit dem Service-Role-Key anlegen
   (wird von den DB-Triggern genutzt, um die Edge Functions aufzurufen).
3. **Edge Functions** `start-pigeon-flight` und `send-push-notification`
   deployen (beide mit `verify_jwt` an; sie akzeptieren zusätzlich nur
   Service-Role-Aufrufe).
4. **Web Push:** VAPID-Schlüsselpaar erzeugen (`npx web-push generate-vapid-keys`),
   dann
   - `supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=...`
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (gleicher Public Key) in `.env.local` / Vercel setzen.

## Sicherheitsmodell (Kurzfassung)

- Chats und Mitgliedschaften legt nur der Server an (`lib/auth/bootstrap.ts`,
  Service-Role). Clients können sich nicht selbst in Chats eintragen.
- Nur eingeladene Mitglieder haben ein Profil; Mitglieder sehen die Profile
  aller Mitglieder, aber nur die eigenen Chats.
- Nachrichten, Flüge und Anhänge sind per RLS nur für Chat-Teilnehmer
  sichtbar; Brieftauben-Briefe für den Empfänger erst nach der Landung.
  Chat-Buckets sind privat (kurzlebige Signed URLs); Profilbilder liegen
  öffentlich, aber unter zufälligen, nicht auflistbaren Pfaden.
- Taubenflüge sind serverseitig autoritativ (Edge Function + Cron), Clients
  haben darauf nur Lesezugriff.
