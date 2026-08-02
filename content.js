// Auto Auth Filler

let overlay = null;
let debounceTimer = null;
let searchTimeout = null;
let busyRetries = 0;
let lastSearchStartedAt = 0;

// One lookup, from the moment a code field appears until a code is filled or
// the attempt is abandoned. Keeping it open is what lets the extension wait for
// mail that has not arrived yet without tearing the overlay down and starting
// over, which is what made it flicker.
let session = null;

// Which email the current code came from, kept so the fill status can keep
// showing it. Overwriting it with "Filled" meant the source was on screen for
// a few milliseconds and nobody ever saw it.
let codeSource = "";

// Filling a field is itself a DOM change, so the observer wakes immediately
// afterwards and finds the same field again. Without a guard the overlay would
// close, reopen, search, fill and close again for as long as the page stayed
// open.
const RESEARCH_COOLDOWN_MS = 15000;

// How far before the field appeared a code may have been sent and still count.
// Mail often lands a moment before the page does. Anything older than this is
// almost certainly left over from an earlier attempt, and filling it costs the
// user more time than filling nothing.
const CODE_LOOKBACK_MS = 60000;

// Codes already entered on this site. A code the site rejected must never be
// entered again: doing so leaves the field holding a value that cannot work.
//
// This has to outlive the page. Sites commonly submit a code by navigating
// rather than by XHR, and Blizzard re-renders the form with the rejected code
// still in the boxes. The content script is destroyed and rebuilt, so anything
// held only in memory is gone, and the new script sees a full field holding a
// code it has never seen and assumes the user typed it. Keeping the record in
// extension storage, keyed by hostname, is what survives that.
const attemptedCodes = new Set();

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

function attemptStorageKey() {
  return `attempted:${window.location.hostname}`;
}

// A short fingerprint rather than the code itself, so nothing readable is
// written to storage. FNV-1a is not a security measure and is not treated as
// one: a six-character code has too little entropy for a hash to hide it. It
// simply avoids keeping verification codes in plain text on disk.
function fingerprint(code) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function freshAttempts(entries) {
  const now = Date.now();
  return (entries ?? []).filter((e) => e && now - e.at < ATTEMPT_TTL_MS);
}

async function loadAttempts() {
  const key = attemptStorageKey();
  const stored = (await storageGet(key)) ?? {};
  for (const entry of freshAttempts(stored[key])) attemptedCodes.add(entry.fp);
}

async function rememberAttempt(code) {
  const fp = fingerprint(code);
  attemptedCodes.add(fp);

  const key = attemptStorageKey();
  const stored = (await storageGet(key)) ?? {};
  const entries = freshAttempts(stored[key]);

  if (!entries.some((e) => e.fp === fp)) entries.push({ fp, at: Date.now() });
  await storageSet({ [key]: entries });
}

function wasAttempted(code) {
  return code !== null && code !== undefined && attemptedCodes.has(fingerprint(code));
}

// While waiting for mail that has not arrived, ask again on this interval, for
// at most this long.
const POLL_INTERVAL_MS = 4000;
const POLL_WINDOW_MS = 120000;

// minimum score for an input to be treated as an OTP field
const CONFIDENCE_THRESHOLD = 28;

const BUSY_RETRY_MS = 1200;
const MAX_BUSY_RETRIES = 5;
const SEARCH_TIMEOUT_MS = 20000;

// How long to keep looking for a submit button that is present and enabled.
const SUBMIT_WAIT_MS = 2500;
const SUBMIT_POLL_MS = 150;

// Firefox implements the chrome namespace with callbacks, so calling these
// without one returns undefined rather than a promise. Chrome accepts callbacks
// too, so wrapping them gives one code path that is correct in both engines.
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      // Reading lastError marks it as handled. The worker being asleep or gone
      // is expected here, not a failure worth logging.
      void chrome.runtime.lastError;
      resolve(response);
    });
  });
}

// All of these come from vocabulary.js, which the manifest loads ahead of this
// file and which holds every language-dependent word in the extension. Add a
// language there, not here.
//
// NAME_STRONG through FORM_WEAK are the scoring tiers used by scoreInput().
// PAYMENT_CONTEXT demotes a field that scored on "pin" alone when the form is
// about a card, because a card PIN is never an emailed code. PASSWORD_FIELD_OK
// is the short list that allows a type="password" field to be considered at
// all, so an ordinary password box is never touched.
//
// Fail loudly if the table is absent. Destructuring undefined would throw here
// and kill the content script before anything ran: no overlay, no trace, and an
// error nobody would connect to a manifest ordering mistake.
if (!globalThis.AAF_TERMS) {
  console.error(
    "[Auto Auth Filler] vocabulary.js did not load before content.js. " +
      "Check the content_scripts js order in manifest.json and that " +
      "vocabulary.js is present in the package.",
  );
}

if (!globalThis.AAF_I18N) {
  console.error(
    "[Auto Auth Filler] i18n.js did not load before content.js. " +
      "Check the content_scripts js order in manifest.json.",
  );
}

// The overlay is the only part of the extension most people ever read, so it
// follows the chosen language too. Falling back to the key would be visible, so
// a missing table degrades to English rather than to nothing.
const T = (key, vars) =>
  globalThis.AAF_I18N ? globalThis.AAF_I18N.t(key, vars) : key;

const {
  nameStrong: NAME_STRONG,
  nameMedium: NAME_MEDIUM,
  nameWeak: NAME_WEAK,
  formStrong: FORM_STRONG,
  formWeak: FORM_WEAK,
  paymentContext: PAYMENT_CONTEXT,
  passwordFieldOk: PASSWORD_FIELD_OK,
  submitButtons: SUBMIT_BUTTONS,
} = globalThis.AAF_TERMS ?? {};

// every text label associated with an input, lowercased, as one string
function labelBag(el) {
  return [
    el.name,
    el.id,
    el.placeholder,
    el.getAttribute("aria-label"),
    el.getAttribute("aria-labelledby") ? getTextById(el.getAttribute("aria-labelledby")) : "",
    el.labels?.[0]?.textContent ?? "",
    el.getAttribute("data-testid") ?? "",
  ].join(" ").toLowerCase();
}

function findOTPInputs() {
  // autocomplete="one-time-code" is an unambiguous signal, no scoring needed
  const explicit = Array.from(document.querySelectorAll('input[autocomplete="one-time-code"]'))
    .filter(isUsable);
  if (explicit.length > 0) return explicit;

  // detect split-digit boxes: 4-8 adjacent single-character inputs in the same container
  const singleChar = Array.from(
    document.querySelectorAll('input[maxlength="1"]'),
  ).filter((el) => isUsable(el) && isTextLike(el));

  if (singleChar.length >= 4 && singleChar.length <= 8) {
    if (shareCommonAncestor(singleChar, 5)) return singleChar;
  }

  const scored = [];
  for (const el of document.querySelectorAll("input")) {
    if (!isUsable(el)) continue;
    const type = (el.type || "text").toLowerCase();
    if (["hidden", "email", "submit", "button", "checkbox", "radio", "file", "image"].includes(type)) continue;
    if (type === "password" && !PASSWORD_FIELD_OK.test(labelBag(el))) continue;

    const score = scoreInput(el);
    if (score >= CONFIDENCE_THRESHOLD) scored.push({ el, score });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => b.score - a.score);
  return [scored[0].el];
}

function scoreInput(el) {
  let score = 0;

  const bag = labelBag(el);

  if (NAME_STRONG.test(bag)) score += 35;
  else if (NAME_MEDIUM.test(bag)) score += 25;
  else if (NAME_WEAK.test(bag)) score += 10;

  if (el.inputMode === "numeric" || el.type === "tel") score += 12;

  // OTP codes are almost always 4-8 characters; a matching maxlength is a strong signal
  const maxLen = parseInt(el.maxLength ?? 0);
  if (maxLen >= 4 && maxLen <= 8) score += 15;
  else if (maxLen === 9 || maxLen === 10) score += 5;

  const form = el.closest("form");
  if (form) {
    const formText = form.textContent.toLowerCase();
    if (FORM_STRONG.test(formText)) score += 10;
    else if (FORM_WEAK.test(formText)) score += 5;

    // Demote card-PIN fields: they match "pin" but never hold an emailed code.
    // Only applies when "pin" was the field's sole reason for scoring.
    const scoredOnlyOnPin =
      !NAME_STRONG.test(bag) &&
      /\bpin\b/.test(bag) &&
      !/\b(code|verify|token|auth)\b|code\b/.test(bag);
    if (scoredOnlyOnPin && PAYMENT_CONTEXT.test(formText)) score -= 30;
  }

  return score;
}

function getTextById(id) {
  return document.getElementById(id)?.textContent ?? "";
}

function isUsable(el) {
  return el.offsetWidth > 0 && el.offsetHeight > 0 && !el.disabled && !el.readOnly;
}

function isTextLike(el) {
  return ["text", "tel", "number", ""].includes((el.type || "text").toLowerCase());
}

// confirms split-digit inputs belong to the same form/widget, not random inputs on the page
function shareCommonAncestor(els, maxDepth) {
  function ancestors(el, depth) {
    const list = [];
    let cur = el.parentElement;
    for (let i = 0; i < depth && cur; i++, cur = cur.parentElement) list.push(cur);
    return list;
  }
  const first = new Set(ancestors(els[0], maxDepth));
  return els.slice(1).every((el) => ancestors(el, maxDepth).some((a) => first.has(a)));
}

async function isPageRelevant() {
  const { blockedDomains = [] } = (await storageGet("blockedDomains")) ?? {};
  const hostname = window.location.hostname.toLowerCase();
  return !blockedDomains.some((d) => d.trim() && hostname.includes(d.trim()));
}

function createOverlay(inputs) {
  if (overlay || !inputs || inputs.length === 0) return;

  overlay = document.createElement("div");
  overlay.id = "aaf-overlay";
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div class="aaf-inner">
      <span class="aaf-icon">🔐</span>
      <span class="aaf-status">Searching Gmail for code…</span>
      <div class="aaf-actions" hidden></div>
      <button class="aaf-close" data-i18n-label="overlay.close" aria-label="Close">✕</button>
    </div>
  `;

  document.documentElement.appendChild(overlay);
  overlay.querySelector(".aaf-close").addEventListener("click", removeOverlay);

  // Escape dismisses it, the same as anything else that appears over a page.
  // The event is not consumed, so the page still receives it.
  document.addEventListener("keydown", onOverlayKeydown);

  busyRetries = 0; // fresh overlay, fresh retry budget
}

function onOverlayKeydown(event) {
  if (event.key === "Escape") removeOverlay();
}

function setOverlaySearching() {
  if (!overlay) return;
  overlay.querySelector(".aaf-status").textContent = T("overlay.searching");
  overlay.querySelector(".aaf-actions").hidden = true;
}

async function setOverlayResult(otp, subject, ageMins, error, details = {}) {
  if (!overlay) return;

  const statusEl = overlay.querySelector(".aaf-status");
  const actionsEl = overlay.querySelector(".aaf-actions");

  // Either nothing arrived, or the only thing that did is a code this page has
  // already rejected. Both mean the same thing: keep waiting for a newer one.
  const alreadyTried = wasAttempted(otp);

  if (!error && (!otp || alreadyTried) && session) {
    if (Date.now() < session.deadline) {
      trace(alreadyTried
        ? "already tried that code, waiting for a newer one"
        : `nothing yet: ${details.reason ?? "no reason given"}`);
      statusEl.textContent = alreadyTried
        ? T("overlay.waitingNewer")
        : T("overlay.waitingNew");
      actionsEl.hidden = true;
      setTimeout(requestOTP, POLL_INTERVAL_MS);
      return;
    }

    // The wait is over and nothing fresh arrived. Rather than leave the user
    // with nothing, drop the freshness requirement once and take the most
    // recent code there is, which is what they would have copied by hand.
    // A code already tried is never worth a second attempt, so this only
    // applies when nothing was found at all.
    if (!otp && !session.acceptedAnyAge) {
      session.acceptedAnyAge = true;
      session.notBefore = 0;
      statusEl.textContent = T("overlay.checkingOlder");
      requestOTP();
      return;
    }

    session = null;
    trace("watch ended");

    // Only report failure if nothing was ever entered. After a successful fill
    // this is just the watch expiring, which is not news.
    if (attemptedCodes.size === 0) {
      statusEl.textContent = T("overlay.noCode");
      actionsEl.hidden = true;
      setTimeout(removeOverlay, 5000);
    } else {
      setTimeout(removeOverlay, 1000);
    }
    return;
  }

  if (!otp) {
    statusEl.textContent = error
      ? "Error: " + truncate(error, 60)
      : "No recent code found in Gmail.";
    actionsEl.hidden = true;
    session = null;
    setTimeout(removeOverlay, 5000);
    return;
  }

  // The session deliberately stays open. If this code turns out to be the one
  // the site rejects, a newer message may still arrive, and by then the field
  // holds a value so nothing else would start a lookup.
  const age = ageMins != null ? " · " + T("overlay.minutesAgo", { n: ageMins }) : "";
  const fromElsewhere = details.matchesSite === false;

  // Name the sender when it does not match this site, so it is obvious the code
  // belongs to something else before anyone clicks.
  codeSource = fromElsewhere
    ? `⚠ From ${truncate(details.sender || subject, 26)}${age}`
    : truncate(subject, 40) + age;

  statusEl.textContent = codeSource;

  // Built with DOM calls instead of innerHTML: the code originates in email
  // content, and add-on review flags every dynamic innerHTML assignment.
  actionsEl.textContent = "";

  const fillBtn = document.createElement("button");
  fillBtn.className = "aaf-btn aaf-fill";
  fillBtn.title = T("overlay.fillSubmit");
  fillBtn.textContent = "↵ " + T("overlay.fillSubmit");
  fillBtn.addEventListener("click", () => fillOTP(otp));

  const copyBtn = document.createElement("button");
  copyBtn.className = "aaf-btn aaf-copy";
  copyBtn.title = T("overlay.copyTitle");
  copyBtn.textContent = "📋";
  copyBtn.addEventListener("click", () => copyOTP(otp));

  const codeEl = document.createElement("code");
  codeEl.className = "aaf-code";
  codeEl.textContent = otp;

  actionsEl.append(fillBtn, copyBtn, codeEl);
  actionsEl.hidden = false;

  // A code from a different service is shown but never entered. Typing one
  // site's code into another's form is worse than doing nothing: it can be
  // submitted automatically, and it teaches the user to trust a value that was
  // never meant for that page.
  if (fromElsewhere) return;

  // Fill without waiting for a click, which is the point of the extension.
  // Password-type fields are excluded: those are the ones where a wrong guess
  // does real damage, so they always need a deliberate click.
  const { autoFill } = (await storageGet("autoFill")) ?? {};
  if (autoFill === false) return;

  const inputs = findOTPInputs();
  const touchesPassword = inputs?.some((el) => (el.type || "").toLowerCase() === "password");
  if (!touchesPassword) fillOTP(otp, inputs);
}

function removeOverlay() {
  clearTimeout(searchTimeout);
  document.removeEventListener("keydown", onOverlayKeydown);
  // Closing the overlay abandons the lookup. Leaving the session open would let
  // a queued poll reopen it after the user dismissed it on purpose.
  session = null;
  overlay?.remove();
  overlay = null;
}

function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

async function fillOTP(otp, knownInputs, attempt = 0) {
  const inputs = knownInputs ?? findOTPInputs();

  // A form that has just rejected a code often disables or hides its boxes for
  // a moment while it talks to its server, and a disabled field is not a
  // detectable one. Returning here would drop the fill in silence, which is
  // exactly the shape of the bug this is meant to cure, so wait and look again.
  if (!inputs || inputs.length === 0) {
    if (attempt < 5) {
      trace(`no field to fill, retrying (${attempt + 1})`);
      setTimeout(() => fillOTP(otp, null, attempt + 1), 400);
    } else {
      trace("gave up: no fillable field");
    }
    return;
  }

  // Record it before entering it, and durably: the submit may navigate, which
  // destroys this script, and the replacement needs to know this code was tried.
  await rememberAttempt(otp);

  // Marks the point after which the field vanishing means the code worked.
  if (session) session.filled = true;

  if (inputs.length === 1) {
    setNativeValue(inputs[0], otp);
  } else {
    // split-digit: one character per box
    inputs.forEach((input, i) => {
      if (otp[i] !== undefined) setNativeValue(input, otp[i]);
    });
  }

  // The code itself is deliberately not logged. Which step ran is what makes
  // the trace useful; the value is a live credential and belongs nowhere near
  // the console of an arbitrary page.
  trace(`filling a ${otp.length} character code`);

  // Keep naming the email rather than replacing it with "Filled". Knowing
  // which message a code came from is the point of showing anything at all,
  // and the tick already says it was entered.
  const statusEl = overlay?.querySelector(".aaf-status");
  if (statusEl) statusEl.textContent = "✅ " + (codeSource || T("overlay.filled"));

  const { autoSubmit } = (await storageGet("autoSubmit")) ?? {};

  if (autoSubmit !== false) {
    const submitted = await clickSubmitWhenReady(inputs[0]);
    // Say so when the form was left for the user. Silence here is
    // indistinguishable from a submit that worked, and the difference matters
    // when the code expires in a few minutes.
    trace(submitted ? "submit clicked" : "no enabled submit button found");
    if (!submitted && statusEl) {
      statusEl.textContent =
        "✅ " + (codeSource || T("overlay.filled")) + " · " + T("overlay.submitManually");
    }
  }

  // Keep watching rather than closing. A rejected code leaves the field holding
  // a value, and a filled field stops any new lookup from starting, so without
  // this the user has to clear the box by hand before anything happens again.
  // When a newer code arrives it simply replaces what is there.
  if (session && Date.now() < session.deadline) {
    trace("watching for a newer code");
    if (statusEl) statusEl.textContent += " · watching";
    setTimeout(requestOTP, POLL_INTERVAL_MS);
    return;
  }

  setTimeout(removeOverlay, 1500);
}

// Waits for a usable submit button rather than clicking once and hoping. The
// page needs a moment to process the input events, and its button often stays
// disabled until it has.
function clickSubmitWhenReady(nearInput) {
  const deadline = Date.now() + SUBMIT_WAIT_MS;

  return new Promise((resolve) => {
    const attempt = () => {
      const button = findSubmitButton(nearInput);
      if (button) {
        button.click();
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(attempt, SUBMIT_POLL_MS);
    };

    setTimeout(attempt, 300);
  });
}

function copyOTP(otp) {
  const copyBtn = overlay?.querySelector(".aaf-copy");
  navigator.clipboard
    .writeText(otp)
    .then(() => {
      if (!copyBtn) return;
      copyBtn.textContent = "✅";
      setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = "📋"; }, 1500);
    })
    .catch(() => {
      // Some pages deny clipboard access. Say so rather than appearing to work.
      if (!copyBtn) return;
      copyBtn.textContent = "✕";
      setTimeout(() => { if (copyBtn.isConnected) copyBtn.textContent = "📋"; }, 1500);
    });
}

// setting input.value directly does not trigger React/Vue/Angular change detection;
// using the native prototype setter + dispatching events does
function setNativeValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: value.slice(-1) }));
  input.focus();
}

function findSubmitButton(nearInput) {
  const keywords = SUBMIT_BUTTONS;

  // Look inside the filled field's own form before falling back to the whole
  // page. Searching the document first can find an unrelated "Continue"
  // somewhere else, and auto-submit clicks whatever this returns.
  const scopes = [nearInput?.closest("form"), document].filter(Boolean);

  for (const scope of scopes) {
    for (const el of scope.querySelectorAll('button, input[type="submit"], [role="button"]')) {
      if (el.offsetWidth === 0) continue;
      // Clicking a disabled button does nothing at all, silently. Code forms
      // routinely keep theirs disabled until their own script has validated the
      // field, so treat one as not found rather than clicking into the void.
      if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;

      const text = (el.innerText ?? el.textContent ?? el.value ?? "").toLowerCase();
      if (keywords.some((kw) => text.includes(kw))) return el;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OTP_RESULT") {
    clearTimeout(searchTimeout);
    setOverlayResult(msg.otp, msg.subject, msg.ageMins, msg.error, msg);
  }
  if (msg.type === "AUTH_READY") {
    if (overlay) {
      setOverlaySearching();
      requestOTP();
    }
  }
});

async function requestOTP() {
  // A poll may already be queued when the user closes the overlay. Without this
  // it would reopen the search they just dismissed.
  if (!overlay) return;

  const inputs = findOTPInputs();

  // Once a code has been entered, the code field disappearing is what a
  // successful sign-in looks like. A site that rejects the code keeps its form
  // on screen, so this is the difference between the two, and without it the
  // watch would sit on a signed-in page announcing that it waits for a newer
  // code.
  //
  // Two consecutive misses are required, because a form can be absent for an
  // instant while it re-renders.
  if (session?.filled) {
    if (!inputs || inputs.length === 0) {
      session.missCount = (session.missCount ?? 0) + 1;
      if (session.missCount >= 2) {
        trace("code field gone, sign-in looks complete");
        const statusEl = overlay.querySelector(".aaf-status");
        if (statusEl) statusEl.textContent = "✅ " + T("overlay.done");
        session = null;
        setTimeout(removeOverlay, 1200);
        return;
      }
    } else {
      session.missCount = 0;
    }
  }
  const inputMaxLen = inputs?.[0] ? parseInt(inputs[0].maxLength ?? 0) || undefined : undefined;

  // An MV3 worker can be killed mid-request, and a reply is not guaranteed.
  // Without this the overlay would sit on "Searching..." forever.
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    setOverlayResult(null, null, null, "Timed out waiting for the background worker");
  }, SEARCH_TIMEOUT_MS);

  const response = await sendToBackground({
    type: "GET_OTP",
    inputMaxLen,
    // A split-digit widget holds exactly one character per box, so its box
    // count is a requirement, not a hint. A single field's maxlength is only an
    // upper bound and stays a preference.
    exactLength: inputs && inputs.length > 1 ? inputs.length : undefined,
    // Lets the worker tell whether a message came from this service at all.
    siteHost: window.location.hostname,
    notBefore: session?.notBefore ?? 0,
  });

  // The worker refuses overlapping fetches. Back off and ask again rather than
  // dropping the request silently, which would leave the overlay searching.
  if (response?.status !== "busy") return;

  if (busyRetries++ < MAX_BUSY_RETRIES) {
    setTimeout(requestOTP, BUSY_RETRY_MS);
  } else {
    clearTimeout(searchTimeout);
    setOverlayResult(null, null, null, "Background worker stayed busy");
  }
}

function shouldSearch(inputs) {
  if (!inputs || inputs.length === 0) return false;
  if (Date.now() - lastSearchStartedAt < RESEARCH_COOLDOWN_MS) return false;

  // An empty field obviously needs one.
  if (inputs.some((el) => !el.value)) return true;

  // The field is full, but with a code this extension put there. If the site
  // rejected it, a newer one must be able to replace it, so keep looking.
  //
  // This is the second, independent route to recovery. The lookup that filled
  // the field also keeps watching, but that depends on the overlay and the
  // session surviving whatever the page does after a failed submit. This route
  // needs nothing except the value sitting in the box, so it survives the
  // overlay being closed, the form re-rendering, or the watch expiring.
  //
  // It cannot bring back the flickering overlay: a lookup that turns up only a
  // code already entered here waits rather than refilling, and the cooldown
  // caps how often any of this can restart.
  return wasAttempted(currentFieldValue(inputs));
}

// What the field currently holds, split-digit boxes joined back together.
function currentFieldValue(inputs) {
  return inputs.length === 1 ? inputs[0].value : inputs.map((el) => el.value).join("");
}

// A trail of what the extension decided and why. This is heuristic code running
// against pages nobody controls, so when it does the wrong thing on some site
// the console is the only way to find out where it went wrong. console.debug is
// hidden unless the level is turned on, so it costs an ordinary user nothing.
function trace(message) {
  console.debug("[Auto Auth Filler] " + message);
}

async function init() {
  if (overlay || session) return;
  if (!(await isPageRelevant())) return;

  // Codes tried on this site before the page reloaded. Without these a form
  // re-rendered with a rejected code still in it looks like the user typed it.
  await loadAttempts();

  const inputs = findOTPInputs();
  if (!shouldSearch(inputs)) return;

  lastSearchStartedAt = Date.now();
  codeSource = ""; // belongs to the previous lookup, not this one
  trace(`lookup started, ${inputs.length} field(s)`);
  session = {
    // Codes older than this are from an earlier attempt at the same site. On a
    // second sign-in the previous code is usually still within the age limit,
    // and without this it would be filled in first.
    notBefore: Date.now() - CODE_LOOKBACK_MS,
    deadline: Date.now() + POLL_WINDOW_MS,
    acceptedAnyAge: false,
  };

  createOverlay(inputs);
  requestOTP();
}

// Debounced, because single-page apps rewrite the DOM constantly and every
// mutation would otherwise start another detection pass.
const observer = new MutationObserver(() => {
  if (overlay) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(init, 450);
});

// The script is injected into every frame, because a code field can sit inside
// one: bank 3-D Secure forms are the common case. Most frames on a page are
// advertising, though, and watching those for the lifetime of the page buys
// nothing.
//
// The filter is deliberately timid. It drops frames with no area at all, and
// the banner and skyscraper shapes, which cannot hold a code form. It keeps
// medium rectangles, because at that size an ad and a real payment form are
// the same shape and refusing to run is the more expensive mistake.
function frameCouldHoldCodeField() {
  if (window.top === window) return true;

  const width = window.innerWidth;
  const height = window.innerHeight;
  if (width === 0 || height === 0) return false;

  return width >= 250 && height >= 120;
}

if (frameCouldHoldCodeField()) {
  // Settle the language first. Detection does not depend on it, but the overlay
  // does, and reading the setting takes a moment. Starting without it would show
  // the first status line in English and correct it a tick later.
  const start = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    init();
  };
  if (globalThis.AAF_I18N) globalThis.AAF_I18N.init().then(start, start);
  else start();
}
