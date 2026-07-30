// Auto Auth Filler

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

let lastCode = null;
let isAuthed = false;

async function checkAuth() {
  const { authenticated } = await sendMsg({ type: "CHECK_AUTH" });
  isAuthed = !!authenticated;

  if (authenticated) {
    authDot.className = "dot green";
    authStatus.textContent = "Signed in to Gmail";
    actionsAuthed.hidden = false;
    actionsUnauth.hidden = true;
    btnLogout.hidden = false;
  } else {
    authDot.className = "dot red";
    authStatus.textContent = "Not signed in";
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
    const result = await sendMsg({ type: "MANUAL_GET_OTP" });

    if (result.otp) {
      lastCode = result.otp;
      resultSubject.textContent = result.subject ?? "";
      resultCode.textContent = result.otp;
      resultAge.textContent = result.ageMins != null ? `${result.ageMins} minute(s) ago` : "";
      resultSection.hidden = false;
      noResultSec.hidden = true;
      btnCopy.hidden = false;
    } else {
      lastCode = null;
      btnCopy.hidden = true;
      noResult.textContent = result.error
        ? "Error: " + result.error
        : "No recent code found in Gmail.";
      noResultSec.hidden = false;
      resultSection.hidden = true;
    }
  } catch (err) {
    noResult.textContent = "Error: " + err.message;
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
    btnCopy.textContent = "✅ Copied";
    setTimeout(() => { btnCopy.textContent = "📋 Copy"; }, 1500);
  });
});

btnLogin.addEventListener("click", async () => {
  btnLogin.disabled = true;
  btnLogin.textContent = "Signing in…";
  try {
    const res = await sendMsg({ type: "LOGIN" });
    if (res.ok) {
      await checkAuth();
    } else {
      authStatus.textContent = "Sign-in failed: " + (res.error ?? "unknown error");
      authDot.className = "dot red";
    }
  } catch (err) {
    authStatus.textContent = "Error: " + err.message;
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = "Sign in with Google";
  }
});

btnLogout.addEventListener("click", async () => {
  await sendMsg({ type: "LOGOUT" });
  lastCode = null;
  clearResult();
  await checkAuth();
});

btnFetch.addEventListener("click", fetchCode);

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

checkAuth();
