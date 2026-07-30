// Auto Auth Filler

function $(id) { return document.getElementById(id); }

function showFeedback(id, text = "Saved ✓") {
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

chrome.storage.local.get(["autoFill", "autoSubmit", "maxOTPAge", "blockedDomains"], (res) => {
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
      accountStatus.textContent = "✅ Signed in. Gmail access active.";
      accountStatus.style.color = "#a6e3a1";
      $("btnLogin").hidden = true;
      $("btnLogout").hidden = false;
    } else {
      accountStatus.textContent = "Not signed in.";
      accountStatus.style.color = "#6c7086";
      $("btnLogin").hidden = false;
      $("btnLogout").hidden = true;
    }
  } catch {
    accountStatus.textContent = "Could not contact background script.";
    accountStatus.style.color = "#f38ba8";
  }
}

$("btnLogin").addEventListener("click", async () => {
  $("btnLogin").disabled = true;
  $("btnLogin").textContent = "Signing in…";
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
    $("btnLogin").textContent = "Sign in with Google";
  }
});

$("btnLogout").addEventListener("click", async () => {
  await sendMsg({ type: "LOGOUT" });
  showFeedback("accountFeedback", "Signed out ✓");
  await refreshAccountStatus();
});

refreshAccountStatus();
