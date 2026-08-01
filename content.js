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

// Codes already put into this page. A code the site rejected must never be
// entered a second time: doing so leaves the field holding a value that cannot
// work, and the old rule that a filled field needs no search then meant nothing
// ever recovered.
const attemptedCodes = new Set();

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
const {
  nameStrong: NAME_STRONG,
  nameMedium: NAME_MEDIUM,
  nameWeak: NAME_WEAK,
  formStrong: FORM_STRONG,
  formWeak: FORM_WEAK,
  paymentContext: PAYMENT_CONTEXT,
  passwordFieldOk: PASSWORD_FIELD_OK,
  submitButtons: SUBMIT_BUTTONS,
} = globalThis.AAF_TERMS;

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
      <button class="aaf-close" aria-label="Close">✕</button>
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
  overlay.querySelector(".aaf-status").textContent = "Searching Gmail for code…";
  overlay.querySelector(".aaf-actions").hidden = true;
}

async function setOverlayResult(otp, subject, ageMins, error, details = {}) {
  if (!overlay) return;

  const statusEl = overlay.querySelector(".aaf-status");
  const actionsEl = overlay.querySelector(".aaf-actions");

  // Either nothing arrived, or the only thing that did is a code this page has
  // already rejected. Both mean the same thing: keep waiting for a newer one.
  const alreadyTried = otp !== null && otp !== undefined && attemptedCodes.has(otp);

  if (!error && (!otp || alreadyTried) && session) {
    if (Date.now() < session.deadline) {
      statusEl.textContent = alreadyTried
        ? "Waiting for a newer code…"
        : "Waiting for a new code…";
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
      statusEl.textContent = "Checking for an older code…";
      requestOTP();
      return;
    }

    session = null;

    // Only report failure if nothing was ever entered. After a successful fill
    // this is just the watch expiring, which is not news.
    if (attemptedCodes.size === 0) {
      statusEl.textContent = "No recent code found in Gmail.";
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
  const age = ageMins != null ? ` · ${ageMins}m ago` : "";
  const fromElsewhere = details.matchesSite === false;

  // Name the sender when it does not match this site, so it is obvious the code
  // belongs to something else before anyone clicks.
  statusEl.textContent = fromElsewhere
    ? `⚠ From ${truncate(details.sender || subject, 28)}${age}`
    : truncate(subject, 48) + age;

  // Built with DOM calls instead of innerHTML: the code originates in email
  // content, and add-on review flags every dynamic innerHTML assignment.
  actionsEl.textContent = "";

  const fillBtn = document.createElement("button");
  fillBtn.className = "aaf-btn aaf-fill";
  fillBtn.title = "Fill and submit";
  fillBtn.textContent = "↵ Fill & submit";
  fillBtn.addEventListener("click", () => fillOTP(otp));

  const copyBtn = document.createElement("button");
  copyBtn.className = "aaf-btn aaf-copy";
  copyBtn.title = "Copy to clipboard";
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

async function fillOTP(otp, knownInputs) {
  const inputs = knownInputs ?? findOTPInputs();
  if (!inputs || inputs.length === 0) return;

  // Remember it before entering it. If the site rejects this code, the next
  // lookup must not offer the same one again.
  attemptedCodes.add(otp);

  if (inputs.length === 1) {
    setNativeValue(inputs[0], otp);
  } else {
    // split-digit: one character per box
    inputs.forEach((input, i) => {
      if (otp[i] !== undefined) setNativeValue(input, otp[i]);
    });
  }

  const statusEl = overlay?.querySelector(".aaf-status");
  if (statusEl) statusEl.textContent = "✅ Filled";

  const { autoSubmit } = (await storageGet("autoSubmit")) ?? {};

  if (autoSubmit !== false) {
    const submitted = await clickSubmitWhenReady(inputs[0]);
    // Say so when the form was left for the user. Silence here is
    // indistinguishable from a submit that worked, and the difference matters
    // when the code expires in a few minutes.
    if (!submitted && statusEl) statusEl.textContent = "✅ Filled, submit manually";
  }

  // Keep watching rather than closing. A rejected code leaves the field holding
  // a value, and a filled field stops any new lookup from starting, so without
  // this the user has to clear the box by hand before anything happens again.
  // When a newer code arrives it simply replaces what is there.
  if (session && Date.now() < session.deadline) {
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

  // A field that already holds a value needs nothing, whether this extension
  // filled it or the user typed it. Once the cooldown passes, clearing the
  // field deliberately does start a fresh search, which is what someone
  // retrying a failed code expects.
  return inputs.some((el) => !el.value);
}

async function init() {
  if (overlay || session) return;
  if (!(await isPageRelevant())) return;

  const inputs = findOTPInputs();
  if (!shouldSearch(inputs)) return;

  lastSearchStartedAt = Date.now();
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
  observer.observe(document.documentElement, { childList: true, subtree: true });
  init();
}
