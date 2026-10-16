// Auto Auth Filler

// Short alias for the string table, which i18n.js puts on globalThis and
// popup.html loads first.
const T = (key, vars) => AAF_I18N.t(key, vars);

const $ = (id) => document.getElementById(id);

const authDot       = $("auth-dot");
const authStatus    = $("auth-status");
const spinner       = $("spinner");
const actionsAuthed = $("actions-authed");
const actionsUnauth = $("actions-unauthed");
const resultSection = $("result-section");
const noResultSec   = $("no-result-section");
const resultSubject = $("result-subject");
const resultCode    = $("result-code");
const resultAge     = $("result-age");
const noResult      = $("no-result");
const btnFetch      = $("btn-fetch");
const btnCopy       = $("btn-copy");
const btnLogin      = $("btn-login");
const btnLogout     = $("btn-logout");
const btnOptions    = $("btn-options");
const btnReport     = $("btn-report");

// The popup has no page of its own, so the site to compare a message against
// has to come from the active tab. Without it the site check inside
// findLatestOTP short-circuits to true for every message, and a code from one
// service gets presented on another's page. The overlay never had this
// problem because a content script already knows where it is running.
async function activeTabHost() {
  try {
    // Firefox implements chrome.* with callbacks rather than promises.
    const tabs = await new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    const url = tabs?.[0]?.url;
    // Privileged pages report no URL even with the tabs permission, and
    // there is nothing worth matching against on one anyway.
    return url ? new URL(url).hostname : "";
  } catch {
    return "";
  }
}

let lastCode = null;
let isAuthed = false;

async function checkAuth() {
  const { authenticated } = await sendMsg({ type: "CHECK_AUTH" });
  isAuthed = !!authenticated;

  if (authenticated) {
    authDot.className = "dot green";
    authStatus.textContent = T("popup.signedIn");
    actionsAuthed.hidden = false;
    actionsUnauth.hidden = true;
    btnLogout.hidden = false;
  } else {
    authDot.className = "dot red";
    authStatus.textContent = T("popup.notSignedIn");
    actionsAuthed.hidden = true;
    actionsUnauth.hidden = false;
    btnLogout.hidden = true;
  }
}

async function fetchCode() {
  setLoading(true);
  btnFetch.disabled = true;
  clearResult();

  try {
    const result = await sendMsg({
      type: "MANUAL_GET_OTP",
      siteHost: await activeTabHost(),
    });

    if (result.otp) {
      lastCode = result.otp;
      // Name the sender when the message did not come from this site. The
      // background already works this out; the popup used to discard it and
      // show a foreign code as though it belonged here.
      const fromElsewhere = result.matchesSite === false;
      resultSubject.classList.toggle("warn", fromElsewhere);
      resultSubject.textContent = fromElsewhere
        ? T("popup.fromElsewhere", { sender: result.sender || result.subject || "" })
        : (result.subject ?? "");
      resultCode.textContent = result.otp;
      resultAge.textContent = result.ageMins != null ? T("popup.minutesAgo", { n: result.ageMins }) : "";
      resultSection.hidden = false;
      noResultSec.hidden = true;
      btnCopy.hidden = false;
    } else {
      lastCode = null;
      btnCopy.hidden = true;
      // The lookup already works out why it found nothing. The overlay has
      // always shown that; the popup threw it away and said "no code", which
      // is the difference between "no mail arrived" and "a code arrived that
      // does not fit this field".
      noResult.textContent = result.error
        ? T("popup.error", { message: result.error })
        : result.reason
          ? T("popup.noCodeReason", { reason: result.reason })
          : T("overlay.noCode");
      noResultSec.hidden = false;
      resultSection.hidden = true;
    }
  } catch (err) {
    noResult.textContent = T("popup.error", { message: err.message });
    noResultSec.hidden = false;
    resultSection.hidden = true;
  } finally {
    setLoading(false);
    btnFetch.disabled = false;
  }
}

function clearResult() {
  resultSection.hidden = true;
  noResultSec.hidden = true;
  resultCode.textContent = "";
  resultSubject.textContent = "";
  resultAge.textContent = "";
}

function setLoading(on) {
  spinner.style.display = on ? "block" : "none";
  // Assigning authDot.className to itself left the dot yellow forever once a
  // fetch had run; restore it from the actual auth state instead.
  authDot.className = on ? "dot yellow" : isAuthed ? "dot green" : "dot red";
}

btnCopy.addEventListener("click", () => {
  if (!lastCode) return;
  navigator.clipboard.writeText(lastCode).then(() => {
    btnCopy.textContent = T("popup.copied");
    setTimeout(() => { btnCopy.textContent = T("popup.copy"); }, 1500);
  });
});

btnLogin.addEventListener("click", async () => {
  btnLogin.disabled = true;
  btnLogin.textContent = T("popup.signingIn");
  try {
    const res = await sendMsg({ type: "LOGIN" });
    if (res.ok) {
      await checkAuth();
    } else {
      authStatus.textContent = T("popup.signInFailed", { reason: res.error ?? T("popup.unknownError") });
      authDot.className = "dot red";
    }
  } catch (err) {
    authStatus.textContent = T("popup.error", { message: err.message });
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = T("popup.signIn");
  }
});

btnLogout.addEventListener("click", async () => {
  await sendMsg({ type: "LOGOUT" });
  lastCode = null;
  clearResult();
  await checkAuth();
});


const ISSUE_URL = "https://github.com/AlekPnv/auto-auth-filler/issues/new";

// A detection bug is reproducible from the field metadata and almost nothing
// else, so the report gathers that rather than asking the user to describe a
// form they did not write. Nothing here can carry a code: detectionReport()
// reads attributes and never values.
function issueBody(report, version) {
  const lines = [
    "### What went wrong",
    "",
    "<!-- Did it fill the wrong field, the wrong code, or do nothing at all?",
    "     Please never paste a real code or email address into a public issue. -->",
    "",
    "### Detection report",
    "",
  ];

  if (!report) {
    lines.push("The page could not be inspected. This happens on browser pages",
               "such as about: and chrome://, and on a tab opened before the",
               "extension was installed or updated.");
  } else {
    lines.push("Site: `" + report.host + "`",
               "",
               "Fields examined: " + report.fields.length +
               ", detected: " + report.detected +
               ", threshold: " + report.threshold,
               "",
               "| type | name | id | placeholder | aria-label | autocomplete | maxlength | inputmode | score |",
               "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const f of report.fields) {
      const cell = (v) => (v === null || v === "" ? " " : String(v).replace(/\|/g, "/").slice(0, 40));
      lines.push("| " + [f.type, f.name, f.id, f.placeholder, f.label, f.autocomplete,
                         f.maxLength, f.inputMode, f.score].map(cell).join(" | ") + " |");
    }
  }

  lines.push("", "Extension " + version + ", " + navigator.userAgent);
  return lines.join("\n");
}

async function reportProblem() {
  const manifest = chrome.runtime.getManifest();
  let report = null;

  try {
    const tabs = await new Promise((resolve) =>
      chrome.tabs.query({ active: true, currentWindow: true }, resolve));
    const tabId = tabs?.[0]?.id;
    if (tabId != null) {
      report = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { type: "DETECTION_REPORT" }, (res) => {
          // A page with no content script leaves lastError set. Reading it is
          // what stops the browser logging an unchecked-error warning.
          void chrome.runtime.lastError;
          resolve(res ?? null);
        });
      });
    }
  } catch {
    report = null;
  }

  const url = ISSUE_URL + "?labels=detection&body=" +
    encodeURIComponent(issueBody(report, manifest.version));
  chrome.tabs.create({ url });
  window.close();
}

btnFetch.addEventListener("click", fetchCode);
btnReport.addEventListener("click", reportProblem);

btnOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response ?? {});
    });
  });
}

// Resolve the language, translate the static markup, then render. Doing this
// before checkAuth() stops the popup showing English for an instant.
AAF_I18N.init().then(() => {
  AAF_I18N.apply();
  checkAuth();
});
