// Every user-visible string in the extension, in one table.
//
// This does not use chrome.i18n. That API picks the language from the browser
// and offers no way to override it, and the point here is a switcher: someone
// running an English Firefox may still want the German interface. So the
// language is a stored setting and the lookup is our own.
//
// Loaded by popup.html, options.html and, through the manifest, by the content
// script. It defines globalThis.AAF_I18N and must load before its consumers.
//
// Adding a language means adding one block below. The test suite fails if a
// language is missing a key that English has, so a half-translated release
// cannot ship.

const AAF_STRINGS = {
  en: {
    // Popup
    "popup.title": "Auto Auth Filler",
    "popup.checking": "Checking…",
    "popup.signedIn": "Signed in to Gmail",
    "popup.notSignedIn": "Not signed in",
    "popup.fetch": "Fetch code",
    "popup.copy": "Copy",
    "popup.copied": "Copied",
    "popup.signIn": "Sign in with Google",
    "popup.signingIn": "Signing in…",
    "popup.signOut": "Sign out",
    "popup.settings": "Settings",
    "popup.signInFailed": "Sign-in failed: {reason}",
    "popup.unknownError": "unknown error",
    "popup.error": "Error: {message}",
    "popup.minutesAgo": "{n} minute(s) ago",

    // Overlay, shown on the page itself
    "overlay.searching": "Searching Gmail for code…",
    "overlay.checkingOlder": "Checking for an older code…",
    // Two different situations: nothing has arrived yet, versus a code arrived
    // but the site already rejected it, so a newer one is needed.
    "overlay.waitingNew": "Waiting for a new code…",
    "overlay.waitingNewer": "Waiting for a newer code…",
    "overlay.noCode": "No recent code found in Gmail.",
    "overlay.submitManually": "submit manually",
    "overlay.done": "Done",
    "overlay.fillSubmit": "Fill & submit",
    "overlay.fill": "Fill",
    "overlay.copyTitle": "Copy to clipboard",
    "overlay.filled": "Filled",
    "overlay.close": "Close",
    "overlay.minutesAgo": "{n}m ago",

    // Settings page
    "opt.pageTitle": "Auto Auth Filler Settings",
    "opt.heading": "Auto Auth Filler",
    "opt.subtitle": "Settings",
    "opt.behaviour": "Behaviour",
    "opt.behaviourHint": "Control how the extension reacts when it finds a code.",
    "opt.autoFill": "Fill automatically",
    "opt.autoFillHint": "Enter the code as soon as it is found, without waiting for a click. Password fields always require a click.",
    "opt.autoSubmit": "Auto-submit after filling",
    "opt.autoSubmitHint": "Click the verify/submit button automatically after filling the code.",
    "opt.maxAge": "Maximum code age (minutes)",
    "opt.maxAgeHint": "Codes older than this are ignored. Gmail OTPs are usually valid for 10 minutes.",
    "opt.save": "Save",
    "opt.saved": "Saved",
    "opt.detection": "Detection",
    "opt.detectionHint": "The extension uses score-based detection to find OTP fields on any website automatically, no whitelist needed. Use the blocklist below to silence it on specific domains.",
    "opt.blocked": "Blocked domains (one per line or comma-separated)",
    "opt.blockedHint": "The overlay will never appear on these domains.",
    "opt.language": "Language",
    "opt.languageHint": "The language of this extension's own interface. Code detection understands English and German regardless of this setting.",
    "opt.languageAuto": "Match my browser",
    "opt.account": "Google Account",
    "opt.accountHint": "The extension reads Gmail with gmail.readonly scope. It cannot send or modify emails.",
    "opt.advanced": "Advanced / Troubleshooting",
    "opt.advChrome": "Chrome:",
    "opt.advChromeText": "Open chrome://extensions, turn on Developer Mode and load this folder as an unpacked extension.",
    "opt.advFirefox": "Firefox:",
    "opt.advFirefoxText": "Open about:debugging#/runtime/this-firefox, choose Load Temporary Add-on and select manifest.json.",
    "opt.advOAuth": "OAuth client:",
    "opt.advOAuthText": "The registered client ID needs this extension's redirect URL added in Google Cloud Console, under APIs and Services, then Credentials. The redirect URL is printed to the browser console the first time sign-in runs.",
    "opt.accountChecking": "Checking…",
    "opt.signIn": "Sign in with Google",
    "opt.signOut": "Sign out",
    "opt.accountActive": "Signed in. Gmail access active.",
    "opt.accountNone": "Not signed in.",
    "opt.accountUnreachable": "Could not contact the background script.",
    "opt.signingIn": "Signing in…",
  },

  de: {
    // Popup
    "popup.title": "Auto Auth Filler",
    "popup.checking": "Wird geprüft…",
    "popup.signedIn": "Bei Gmail angemeldet",
    "popup.notSignedIn": "Nicht angemeldet",
    "popup.fetch": "Code holen",
    "popup.copy": "Kopieren",
    "popup.copied": "Kopiert",
    "popup.signIn": "Mit Google anmelden",
    "popup.signingIn": "Anmeldung läuft…",
    "popup.signOut": "Abmelden",
    "popup.settings": "Einstellungen",
    "popup.signInFailed": "Anmeldung fehlgeschlagen: {reason}",
    "popup.unknownError": "unbekannter Fehler",
    "popup.error": "Fehler: {message}",
    "popup.minutesAgo": "vor {n} Minute(n)",

    // Overlay
    "overlay.searching": "Gmail wird nach Code durchsucht…",
    "overlay.checkingOlder": "Älterer Code wird geprüft…",
    "overlay.waitingNew": "Warten auf einen neuen Code…",
    "overlay.waitingNewer": "Warten auf einen neueren Code…",
    "overlay.noCode": "Kein aktueller Code in Gmail gefunden.",
    "overlay.submitManually": "bitte selbst senden",
    "overlay.done": "Fertig",
    "overlay.fillSubmit": "Einfügen & senden",
    "overlay.fill": "Einfügen",
    "overlay.copyTitle": "In die Zwischenablage kopieren",
    "overlay.filled": "Eingefügt",
    "overlay.close": "Schließen",
    "overlay.minutesAgo": "vor {n} Min.",

    // Settings page
    "opt.pageTitle": "Auto Auth Filler Einstellungen",
    "opt.heading": "Auto Auth Filler",
    "opt.subtitle": "Einstellungen",
    "opt.behaviour": "Verhalten",
    "opt.behaviourHint": "Legt fest, wie sich die Erweiterung verhält, wenn sie einen Code findet.",
    "opt.autoFill": "Automatisch einfügen",
    "opt.autoFillHint": "Fügt den Code ein, sobald er gefunden wurde, ohne auf einen Klick zu warten. Bei Passwortfeldern wird immer auf einen Klick gewartet.",
    "opt.autoSubmit": "Nach dem Einfügen automatisch senden",
    "opt.autoSubmitHint": "Klickt nach dem Einfügen automatisch auf die Bestätigen- oder Senden-Schaltfläche.",
    "opt.maxAge": "Höchstalter des Codes (Minuten)",
    "opt.maxAgeHint": "Ältere Codes werden ignoriert. Gmail-Codes gelten meist zehn Minuten.",
    "opt.save": "Speichern",
    "opt.saved": "Gespeichert",
    "opt.detection": "Erkennung",
    "opt.detectionHint": "Die Erweiterung erkennt Code-Felder anhand einer Punktebewertung auf jeder Website, ganz ohne Liste erlaubter Seiten. Mit der Sperrliste unten lässt sie sich auf einzelnen Domains stummschalten.",
    "opt.blocked": "Gesperrte Domains (eine pro Zeile oder mit Komma getrennt)",
    "opt.blockedHint": "Auf diesen Domains erscheint die Einblendung nie.",
    "opt.language": "Sprache",
    "opt.languageHint": "Die Sprache der Oberfläche dieser Erweiterung. Die Code-Erkennung versteht Deutsch und Englisch unabhängig von dieser Einstellung.",
    "opt.languageAuto": "Sprache des Browsers verwenden",
    "opt.account": "Google-Konto",
    "opt.accountHint": "Die Erweiterung liest Gmail mit der Berechtigung gmail.readonly. Sie kann keine E-Mails senden oder ändern.",
    "opt.advanced": "Erweitert / Fehlerbehebung",
    "opt.advChrome": "Chrome:",
    "opt.advChromeText": "chrome://extensions öffnen, den Entwicklermodus einschalten und diesen Ordner als entpackte Erweiterung laden.",
    "opt.advFirefox": "Firefox:",
    "opt.advFirefoxText": "about:debugging#/runtime/this-firefox öffnen, auf Temporäres Add-on laden klicken und manifest.json auswählen.",
    "opt.advOAuth": "OAuth-Client:",
    "opt.advOAuthText": "Bei der registrierten Client-ID muss die Weiterleitungs-URL dieser Erweiterung in der Google Cloud Console hinterlegt sein, unter APIs und Dienste, dann Anmeldedaten. Die Weiterleitungs-URL wird beim ersten Anmeldeversuch in der Browser-Konsole ausgegeben.",
    "opt.accountChecking": "Wird geprüft…",
    "opt.signIn": "Mit Google anmelden",
    "opt.signOut": "Abmelden",
    "opt.accountActive": "Angemeldet. Gmail-Zugriff aktiv.",
    "opt.accountNone": "Nicht angemeldet.",
    "opt.accountUnreachable": "Das Hintergrundskript ist nicht erreichbar.",
    "opt.signingIn": "Anmeldung läuft…",
  },
};

const AAF_FALLBACK_LANG = "en";
const AAF_LANGUAGES = Object.keys(AAF_STRINGS);

// "auto" resolves against the browser, anything else is taken literally. An
// unknown or unsupported value falls back rather than showing raw keys.
function aafResolveLang(setting) {
  if (setting && setting !== "auto" && AAF_STRINGS[setting]) return setting;
  if (setting && setting !== "auto") return AAF_FALLBACK_LANG;

  let ui = "";
  try {
    ui = (chrome?.i18n?.getUILanguage?.() || navigator.language || "").toLowerCase();
  } catch (e) {
    ui = (navigator.language || "").toLowerCase();
  }
  const base = ui.split("-")[0];
  return AAF_STRINGS[base] ? base : AAF_FALLBACK_LANG;
}

globalThis.AAF_I18N = {
  languages: AAF_LANGUAGES,
  fallback: AAF_FALLBACK_LANG,
  strings: AAF_STRINGS,
  resolve: aafResolveLang,

  // Current language, set by init(). Defaults so a consumer that forgets to
  // call init() still renders English rather than raw keys.
  lang: AAF_FALLBACK_LANG,

  // Reads the stored setting and fixes the language for this page. Returns a
  // promise so callers can render only once the language is known.
  init() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["uiLanguage"], (res) => {
          this.lang = aafResolveLang(res?.uiLanguage);
          resolve(this.lang);
        });
      } catch (e) {
        this.lang = aafResolveLang(null);
        resolve(this.lang);
      }
    });
  },

  // Look up a key, substituting {placeholders}. An unknown key returns itself,
  // which is ugly on screen and therefore easy to spot in review.
  t(key, vars) {
    const table = AAF_STRINGS[this.lang] || AAF_STRINGS[AAF_FALLBACK_LANG];
    let s = table[key] ?? AAF_STRINGS[AAF_FALLBACK_LANG][key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        s = s.split("{" + name + "}").join(String(value));
      }
    }
    return s;
  },

  // Translate a document in place. Elements opt in with data-i18n for their
  // text, data-i18n-title for a tooltip and data-i18n-label for aria-label.
  apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = this.t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.title = this.t(el.dataset.i18nTitle);
    });
    root.querySelectorAll("[data-i18n-label]").forEach((el) => {
      el.setAttribute("aria-label", this.t(el.dataset.i18nLabel));
    });
    if (root === document) document.documentElement.lang = this.lang;
  },
};
