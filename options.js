// Auto Auth Filler

function $(id) { return document.getElementById(id); }

// i18n.js is loaded before this file by options.html.
const T = (key, vars) => AAF_I18N.t(key, vars);

// Read the version from the manifest rather than repeating it in the markup,
// where it silently went stale every time the manifest was bumped. Opened
// outside the extension there is no chrome.runtime, so the label stays plain
// rather than throwing.
document.addEventListener("DOMContentLoaded", () => {
  AAF_I18N.init().then(() => {
    AAF_I18N.apply();
    // Written after apply(), which would otherwise overwrite it with the
    // untranslated subtitle.
    const version = chrome?.runtime?.getManifest?.().version;
    $("version").textContent = version ? T("opt.subtitle") + " v" + version : T("opt.subtitle");
  });
});

function showFeedback(id, text) {
  text = text ?? T("opt.saved");
  const el = $(id);
  el.textContent = text;
  el.classList.add("visible");
  setTimeout(() => el.classList.remove("visible"), 2500);
}

function sendMsg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res ?? {});
    });
  });
}

chrome.storage.local.get(["autoFill", "autoSubmit", "maxOTPAge", "blockedDomains", "uiLanguage"], (res) => {
  $("uiLanguage").value = res.uiLanguage ?? "auto";
  $("autoFill").checked = res.autoFill !== false;
  $("autoSubmit").checked = res.autoSubmit !== false;
  $("maxAge").value = res.maxOTPAge ?? 10;

  const domains = Array.isArray(res.blockedDomains) ? res.blockedDomains : [];
  $("blockedDomains").value = domains.join("\n");
});

$("saveBehaviour").addEventListener("click", () => {
  const autoFill = $("autoFill").checked;
  const autoSubmit = $("autoSubmit").checked;
  const maxOTPAge = Math.max(1, Math.min(60, parseInt($("maxAge").value) || 10));

  chrome.storage.local.set({ autoFill, autoSubmit, maxOTPAge }, () => {
    showFeedback("behaviourFeedback");
  });
});

$("saveLanguage").addEventListener("click", () => {
  const uiLanguage = $("uiLanguage").value;
  chrome.storage.local.set({ uiLanguage }, () => {
    // Re-render immediately. Asking someone to reopen the page to see the
    // language they just chose would be a strange way to confirm it worked.
    AAF_I18N.lang = AAF_I18N.resolve(uiLanguage);
    AAF_I18N.apply();
    const version = chrome?.runtime?.getManifest?.().version;
    $("version").textContent = version ? T("opt.subtitle") + " v" + version : T("opt.subtitle");
    showFeedback("languageFeedback");
  });
});

$("saveDetection").addEventListener("click", () => {
  const raw = $("blockedDomains").value;
  const blockedDomains = raw
    .split(/[\n,]/)
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  chrome.storage.local.set({ blockedDomains }, () => {
    showFeedback("detectionFeedback");
  });
});

async function refreshAccountStatus() {
  const accountStatus = $("account-status");
  try {
    const { authenticated } = await sendMsg({ type: "CHECK_AUTH" });
    if (authenticated) {
      accountStatus.textContent = "✅ " + T("opt.accountActive");
      accountStatus.style.color = "#a6e3a1";
      $("btnLogin").hidden = true;
      $("btnLogout").hidden = false;
    } else {
      accountStatus.textContent = T("opt.accountNone");
      accountStatus.style.color = "#6c7086";
      $("btnLogin").hidden = false;
      $("btnLogout").hidden = true;
    }
  } catch {
    accountStatus.textContent = T("opt.accountUnreachable");
    accountStatus.style.color = "#f38ba8";
  }
}

$("btnLogin").addEventListener("click", async () => {
  $("btnLogin").disabled = true;
  $("btnLogin").textContent = T("opt.signingIn");
  try {
    const res = await sendMsg({ type: "LOGIN" });
    if (res.ok) {
      showFeedback("accountFeedback", "Signed in ✓");
      await refreshAccountStatus();
    } else {
      showFeedback("accountFeedback", "Failed: " + (res.error ?? "unknown"));
    }
  } catch (err) {
    showFeedback("accountFeedback", "Error: " + err.message);
  } finally {
    $("btnLogin").disabled = false;
    $("btnLogin").textContent = T("opt.signIn");
  }
});

$("btnLogout").addEventListener("click", async () => {
  await sendMsg({ type: "LOGOUT" });
  showFeedback("accountFeedback", "Signed out ✓");
  await refreshAccountStatus();
});

refreshAccountStatus();
