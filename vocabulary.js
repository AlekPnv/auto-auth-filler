// Every language-dependent word in the extension, in one table.
//
// Language matters in four separate places, and they are easy to miss:
//
//   1. The Gmail search query, which decides whether a message is fetched at
//      all. This one is a gate: if the query does not match, nothing below ever
//      runs, no matter how good the patterns are.
//   2. The labels that locate the code inside the message body.
//   3. The words that identify a code field on a web page.
//   4. The text on the button that submits such a form.
//
// Adding a language means adding one entry here. Nothing else needs editing.
//
// Values are regular expression fragments, not literal strings, so a term can
// express spelling variants: "one[- ]?time" covers "one-time" and "one time".
// Anything with regex punctuation in it must be escaped.
//
// A note for whoever adds a language written in a non-Latin script, Bulgarian
// included: JavaScript's \b is defined against \w, which is ASCII only. Every
// Cyrillic letter counts as a non-word character, so \b(код)\b does not behave
// like \b(code)\b. Use Unicode property escapes with the u flag, for example
// (?<!\p{L})код(?!\p{L}). Give that language its own entries rather than
// trying to bend the Latin ones around it.

globalThis.AAF_VOCAB = {
  en: {
    // Phrases that can only mean a security code. A code containing no digits
    // is trusted after one of these, so keep the list precise: "code" alone
    // belongs in genericLabels, not here.
    mailLabels: [
      "verification\\s*code", "security\\s*code", "authentication\\s*code",
      "auth\\s*code", "login\\s*code", "log[- ]?in\\s*code",
      "sign[- ]?in\\s*code", "access\\s*code", "confirmation\\s*code",
      "guard\\s*code", "recovery\\s*code", "temporary\\s*(?:code|password)",
      "one[- ]?time\\s*(?:password|code|pin)", "passcode",
      "2fa\\s*code", "two[- ]?factor\\s*code",
    ],

    // Words just as common in marketing as in security mail. A code found
    // after one of these must contain a digit.
    genericLabels: ["code", "otp", "pin", "token"],

    // Field name scoring, strongest first. See scoreInput() in content.js.
    fieldStrong: ["\\b(?:otp|one.?time|passcode)\\b"],
    fieldMedium: ["\\b(?:code|verify|token|pin|auth)\\b"],
    fieldWeak: ["\\b(?:verif|confirm|secure|access)\\b"],

    // Wording of the form around the field.
    formStrong: ["\\b(?:otp|one.?time|passcode|verify|verification)\\b"],
    formWeak: ["\\b(?:code|confirm|token|pin)\\b"],

    // Only these justify treating a type="password" field as a code input.
    // "passcode" is deliberately absent: sites use it for real passwords.
    passwordFieldOk: ["\\b(?:otp|one.?time)\\b", "verification\\s*code"],

    // Words meaning the form is about payment. A field that scored only on
    // "pin" is demoted when these appear, because a card PIN is not an
    // emailed code.
    payment: ["\\b(?:card|payment|iban|cvv|cvc|debit)\\b"],

    // Card data. Never an emailed code, so a field naming any of these is
    // refused outright rather than scored down. Getting this wrong means typing
    // a verification code into a payment form and submitting it.
    cardField: [
      "\\b(?:cvv|cvc|csc|cvn)\\b",
      "card[\\s_-]?number", "cardnumber", "card[\\s_-]?verification",
      "\\bexpir(?:y|ation)\\b", "\\bexp[\\s_-]?date\\b",
      "name[\\s_-]?on[\\s_-]?card", "cardholder",
    ],

    // Means the card security number only when the form is about payment.
    // Elsewhere it is an ordinary way to say "one-time code".
    cardAmbiguous: ["security[\\s_-]?code"],

    // Text on the button that submits a code. Matched as a substring, so
    // spacing variants have to be listed separately: Blizzard's button reads
    // "Log in", which "login" does not match.
    submitButtons: [
      "verify", "verif", "submit", "confirm", "continue", "next",
      "login", "log in", "log-in", "sign in", "sign-in", "signin",
      "done", "proceed",
    ],

    // Gmail query terms. Subject terms are matched against the subject only;
    // body terms are quoted phrases searched anywhere in the message.
    mailSubjectTerms: [
      "code", "verify", "security", "login", "confirmation",
      "authentication", "account",
    ],
    mailBodyTerms: [
      "verification", "one-time", "OTP", "2FA", "two-factor", "passcode",
    ],
  },

  de: {
    // German glues words together, so a field called "Bestätigungscode" has no
    // word boundary before "code" and \bcode\b never matches it. The compounds
    // are therefore listed whole, and fieldMedium carries a bare "code\\b"
    // suffix to catch the ones nobody has listed yet.
    //
    // Each umlaut term appears twice, once spelled with the umlaut and once
    // transliterated, because form field names are frequently written
    // "bestaetigungscode" to avoid non-ASCII characters in markup.
    mailLabels: [
      "einmalcode", "bestätigungscode", "bestaetigungscode",
      "sicherheitscode", "verifizierungscode", "anmeldecode",
      "zugangscode", "authentifizierungscode",
    ],
    genericLabels: [],

    fieldStrong: ["(?:einmal|bestätigungs|bestaetigungs|verifizierungs|sicherheits)code"],
    fieldMedium: ["code\\b", "\\b(?:bestätigen|bestaetigen|verifizieren)\\b"],
    fieldWeak: ["\\b(?:sicherheit|zugang)"],

    formStrong: ["(?:einmal|bestätigungs|bestaetigungs)code"],
    formWeak: ["code\\b", "\\b(?:bestätigen|bestaetigen)\\b"],

    passwordFieldOk: ["(?:einmal|bestätigungs|bestaetigungs|verifizierungs)code"],

    // German compounds have no word boundary before the noun, so \b cannot
    // find "karten" inside "Kartennummer" or "zahl" inside "bezahlen". The
    // same trap that hid Bestaetigungscode for so long, here hiding a
    // checkout page from the guard meant to recognise one.
    payment: ["kreditkarte", "kartennummer", "karteninhaber",
      "\\bkarten?\\b", "zahlung", "bezahl", "\\bzahlen\\b"],

    cardField: [
      "karten(?:nummer|pr\u00fcfnummer|pruefnummer|inhaber)",
      "\\bpr\u00fcfnummer\\b", "\\bpruefnummer\\b",
      "ablaufdatum", "g\u00fcltig bis", "gueltig bis",
    ],

    // Sicherheitscode is the collision that caused this: German uses it for a
    // card's CVV and for a one-time code alike. On a payment form it is the
    // former, and fieldStrong already matches it, so without this it scores 35.
    cardAmbiguous: ["sicherheitscode"],

    submitButtons: ["weiter", "bestätigen", "anmelden", "fortfahren"],

    mailSubjectTerms: [],
    mailBodyTerms: ["Einmalcode", "Authentifizierung", "Bestätigungscode"],
  },

  // bg: {
  //   Bulgarian goes here. Read the note at the top of this file first: \b does
  //   not work against Cyrillic, so these entries need \p{L} lookarounds and
  //   the patterns built from them need the u flag.
  // },
};

// Everything below composes the table into the forms the two scripts consume,
// so neither of them needs to know that more than one language exists.

function aafCollect(key) {
  return Object.values(globalThis.AAF_VOCAB).flatMap((lang) => lang[key] ?? []);
}

function aafAlternation(key) {
  return aafCollect(key).join("|");
}

function aafPattern(key) {
  return new RegExp(aafAlternation(key));
}

function aafGmailQuery() {
  const subject = aafCollect("mailSubjectTerms").map((t) => `subject:${t}`);
  const body = aafCollect("mailBodyTerms").map((t) => `"${t}"`);
  return `newer_than:1d (${subject.concat(body).join(" OR ")})`;
}

globalThis.AAF_TERMS = {
  // Regex sources, assembled into larger patterns by background.js.
  securityLabel: aafAlternation("mailLabels"),
  genericLabel: aafAlternation("genericLabels"),

  // Ready-made patterns for content.js.
  nameStrong: aafPattern("fieldStrong"),
  nameMedium: aafPattern("fieldMedium"),
  nameWeak: aafPattern("fieldWeak"),
  formStrong: aafPattern("formStrong"),
  formWeak: aafPattern("formWeak"),
  passwordFieldOk: aafPattern("passwordFieldOk"),
  paymentContext: aafPattern("payment"),
  cardField: aafPattern("cardField"),
  cardAmbiguous: aafPattern("cardAmbiguous"),

  submitButtons: aafCollect("submitButtons"),
  gmailQuery: aafGmailQuery(),
};
