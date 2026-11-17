// Zugangsdaten zu deinem Supabase-Projekt.
// Zu finden in Supabase unter: Project Settings → API (bzw. "Data API" / "API Keys").
// Der "anon"/"publishable" Schlüssel darf öffentlich sein – geschützt sind die Daten
// durch Login und die Zugriffsregeln aus supabase/setup.sql.
window.PROJEKTPLAN_CONFIG = {
  supabaseUrl: "https://teshvpcfhezzukstgwoc.supabase.co",
  supabaseAnonKey: "sb_publishable_OsE-sd7wtZjgSGzm_EJ3qA_83pmFPJQ",

  // true = Ausprobieren ohne Supabase. Daten bleiben nur bis zum Neuladen erhalten.
  demo: false
};
