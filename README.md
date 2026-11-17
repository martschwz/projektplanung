# Projektplan Haus & Hof

Persönliche Projekte (Familie, Haus, Freizeit, Wald, Imkerei, Bauernhof …) an einem Ort:

- **Bewerten** nach Dringlichkeit, Wichtigkeit, Freude, Aufwand und Kosten, mit einstellbarer Gewichtung
- **Saison-Zeitfenster und Fristen** fließen in die Priorität ein
- **Ansichten:** Rangliste, Wichtig/Dringend-Matrix, Jahresansicht mit geplanten und erfassten Stunden, Zeiten
- **Projektschritte** mit Stundenschätzung und Fälligkeit
- **Zeiterfassung** am Handy und am PC (Datum, Stunden, Bereich, Projekt, Beschreibung)
- **Eigene Bereiche**, Export und Import der Daten

Die App ist eine einzelne Webseite (HTML/JavaScript ohne Build-Schritt). Sie läuft auf **GitHub Pages**, die Daten liegen in **Supabase** (kostenloser Tarif reicht). Am Handy lässt sie sich wie eine App auf den Startbildschirm legen.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Seite und Gestaltung |
| `app.js` | App-Logik |
| `config.js` | Zugangsdaten zu Supabase (Project URL und anon Key) |
| `supabase/setup.sql` | Legt Tabelle und Zugriffsregeln in Supabase an |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installation auf dem Handy, Start auch bei schlechtem Netz |
| `daten/` | Deine Exporte. **Wird nicht hochgeladen** (siehe `.gitignore`) |

---

## Einrichtung (einmalig, ca. 20 Minuten)

### 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein Konto anlegen und **New project** wählen.
   Region: **Central EU (Frankfurt)**. Das Datenbank-Passwort brauchst du für die App nicht, bewahre es trotzdem auf.
2. Links **SQL Editor** → **New query** → Inhalt von `supabase/setup.sql` einfügen → **Run**.
   Es sollte „Success. No rows returned“ erscheinen.

### 2. Dein Konto anlegen und Fremde aussperren

1. **Authentication → Users → Add user → Create new user**: deine E-Mail und ein Passwort eintragen, **Auto Confirm User** anhaken.
2. **Authentication → Sign In / Providers** (je nach Version auch *Settings*): **Allow new users to sign up** ausschalten.
   Danach kann sich niemand sonst ein Konto anlegen.

### 3. Zugangsdaten eintragen

1. **Project Settings → Data API** (bzw. **API**): die **Project URL** kopieren.
2. **Project Settings → API Keys**: den **anon public**- bzw. **publishable**-Schlüssel kopieren.
   *Nicht* den `service_role`- oder `secret`-Schlüssel – der darf nie in die App.
3. Beide Werte in `config.js` eintragen und speichern.

> Der anon-Schlüssel ist für die Öffentlichkeit gedacht und darf im Repository stehen. Geschützt sind deine Daten durch den Login und die Zugriffsregeln aus `setup.sql`: Jede Person sieht nur ihre eigenen Einträge.

### 4. Mit GitHub Desktop hochladen

1. GitHub Desktop → **File → Add local repository** → diesen Ordner wählen.
   Kommt die Meldung „This directory does not appear to be a Git repository“, auf **create a repository** klicken → **Create repository**.
2. **Publish repository**. Für kostenloses GitHub Pages muss **Keep this code private** *aus* sein.
   Dank `.gitignore` werden die Exporte in `daten/` nicht hochgeladen.
3. Auf github.com im Repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, Branch **main**, Ordner **/ (root)** → **Save**.
4. Nach ein bis zwei Minuten läuft die App unter `https://<dein-github-name>.github.io/<repository-name>/`.

### 5. Daten übernehmen

1. Die App öffnen und anmelden.
2. **Einstellungen → Daten → Export importieren …** → `daten/export-2026-11-17.json` wählen → **Importieren**.
   Darin stecken die 15 Projekte aus der bisherigen Version und deine Bereiche.

### 6. Aufs Handy

- **Android (Chrome):** Seite öffnen → Menü ⋮ → **Zum Startbildschirm hinzufügen** bzw. **App installieren**.
  Lange auf das Icon drücken bietet direkt **Zeit erfassen** an.
- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → **Zum Home-Bildschirm**.

---

## Gut zu wissen

- **Pausierung im Gratis-Tarif:** Supabase pausiert kostenlose Projekte nach etwa einer Woche ohne Nutzung. Bei regelmäßiger Nutzung passiert das nicht. Falls doch: im Supabase-Dashboard auf **Restore** klicken, die Daten bleiben erhalten.
- **Sicherung:** Ab und zu unter Einstellungen → Daten einen Export herunterladen und in `daten/` ablegen.
- **Ohne Internet** startet die App, kann aber nichts laden oder speichern.
- **Änderungen veröffentlichen:** Dateien ändern → in GitHub Desktop **Commit to main** → **Push origin**. In `sw.js` dann die Versionsnummer (`projektplan-v1` → `v2`) erhöhen, damit die Handys die neue Version sicher laden.
- **Ausprobieren ohne Supabase:** In `config.js` `demo: true` setzen. Die Daten bleiben dann nur bis zum Neuladen erhalten.
