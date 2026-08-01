// Auto Auth Filler

let overlay = null;
let debounceTimer = null;
let hasInitialized = false;
let searchTimeout = null;
let busyRetries = 0;

// minimum score for an input to be treated as an OTP field
const CONFIDENCE_THRESHOLD = 28;

const BUSY_RETRY_MS = 1200;
const MAX_BUSY_RETRIES = 5;
const SEARCH_TIMEOUT_MS = 20000;

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

// German compounds ("Bestätigungscode", "Einmalcode") have no word boundary
// before "code", so \b alone never matches them. The bare `code\b` suffix
// catches the whole family without listing every compound.
const NAME_STRONG = /\b(otp|one.?time|passcode)\b|(?:einmal|bestätigungs|bestaetigungs|verifizierungs|sicherheits)code/;
const NAME_MEDIUM = /\b(code|verify|token|pin|auth)\b|code\b|\b(bestätigen|bestaetigen|verifizieren)\b/;
const NAME_WEAK   = /\b(verif|confirm|secure|access)\b|\b(sicherheit|zugang)/;

const FORM_STRONG = /\b(otp|one.?time|passcode|verify|verification)\b|(?:einmal|bestätigungs|bestaetigungs)code/;
const FORM_WEAK   = /\b(code|confirm|token|pin)\b|code\b|\b(bestätigen|bestaetigen)\b/;

// A card PIN is not an emailed code. Used only to demote fields that scored
// on "pin" alone - a field that also says "code" or "otp" keeps its points.
const PAYMENT_CONTEXT = /\b(card|karten?|kreditkarten?|payment|zahlung|iban|cvv|cvc|debit)\b/;

// Some banks render one-time codes as type="password". Such a field is only
// considered when it names itself unambiguously, so a real password box is
// never touched. "passcode" is deliberately absent: sites use it for actual
// passwords.
const PASSWORD_FIELD_OK = /\b(otp|one.?time)\b|(?:einmal|bestätigungs|bestaetigungs|verifizierungs)code|verification\s*code/;

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
  busyRetries = 0; // fresh overlay, fresh retry budget
}

function setOverlaySearching() {
  if (!overlay) return;
  overlay.querySelector(".aaf-status").textContent = "Searching Gmail for code…";
  overlay.querySelector(".aaf-actions").hidden = true;
}

async function setOverlayResult(otp, subject, ageMins, error) {
  if (!overlay) return;

  const statusEl = overlay.querySelector(".aaf-status");
  const actionsEl = overlay.querySelector(".aaf-actions");

  if (!otp) {
    statusEl.textContent = error
      ? "Error: " + truncate(error, 60)
      : "No recent code found in Gmail.";
    actionsEl.hidden = true;
    setTimeout(removeOverlay, 5000);
    return;
  }

  const age = ageMins != null ? ` · ${ageMins}m ago` : "";
  statusEl.textContent = truncate(subject, 48) + age;

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
  overlay?.remove();
  overlay = null;
}

function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}

async function fillOTP(otp, knownInputs) {
  const inputs = knownInputs ?? findOTPInputs();
  if (!inputs || inputs.length === 0) return;

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
    // Give the page a moment to react to the input events before submitting.
    setTimeout(() => findSubmitButton(inputs[0])?.click(), 300);
  }
  setTimeout(removeOverlay, 1500);
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
  const keywords = [
    "verify", "verif", "submit", "confirm", "continue", "next", "login",
    "sign in", "weiter", "bestätigen", "anmelden", "fortfahren",
  ];

  // Look inside the filled field's own form before falling back to the whole
  // page. Searching the document first can find an unrelated "Continue"
  // somewhere else, and auto-submit clicks whatever this returns.
  const scopes = [nearInput?.closest("form"), document].filter(Boolean);

  for (const scope of scopes) {
    for (const el of scope.querySelectorAll('button, input[type="submit"], [role="button"]')) {
      if (el.offsetWidth === 0) continue;
      const text = (el.innerText ?? el.textContent ?? el.value ?? "").toLowerCase();
      if (keywords.some((kw) => text.includes(kw))) return el;
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "OTP_RESULT") {
    clearTimeout(searchTimeout);
    setOverlayResult(msg.otp, msg.subject, msg.ageMins, msg.error);
  }
  if (msg.type === "AUTH_READY") {
    if (overlay) {
      setOverlaySearching();
      requestOTP();
    }
  }
});

async function requestOTP() {
  const inputs = findOTPInputs();
  const inputMaxLen = inputs?.[0] ? parseInt(inputs[0].maxLength ?? 0) || undefined : undefined;

  // An MV3 worker can be killed mid-request, and a reply is not guaranteed.
  // Without this the overlay would sit on "Searching..." forever.
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    setOverlayResult(null, null, null, "Timed out waiting for the background worker");
  }, SEARCH_TIMEOUT_MS);

  const response = await sendToBackground({ type: "GET_OTP", inputMaxLen });

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

async function init() {
  if (!(await isPageRelevant())) return;

  const inputs = findOTPInputs();
  if (!inputs || inputs.length === 0 || overlay) return;

  hasInitialized = true;
  createOverlay(inputs);
  requestOTP();
}

// debounced so rapid DOM mutations from SPAs do not spam init() on every micro-update
const observer = new MutationObserver(() => {
  if (overlay) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (!hasInitialized) init();
    else if (!overlay) {
      const inputs = findOTPInputs();
      if (inputs?.length) {
        createOverlay(inputs);
        requestOTP();
      }
    }
  }, 450);
});

observer.observe(document.documentElement, { childList: true, subtree: true });
init();
