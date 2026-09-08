// Theme toggle, shared by every page.
//
// The inline script in each <head> applies a stored choice before first paint;
// this only wires up the button afterwards. Splitting it that way is what stops
// a visitor who chose light from seeing a dark flash on every navigation.
(function () {
  var root = document.documentElement;
  var btn = document.getElementById("theme-toggle");
  var label = document.getElementById("theme-label");
  if (!btn || !label) return;

  var systemDark = window.matchMedia("(prefers-color-scheme: dark)");

  function current() {
    if (root.dataset.theme) return root.dataset.theme;
    return systemDark.matches ? "dark" : "light";
  }

  function paint() {
    var now = current();
    // The button says what a click will do, not what is showing.
    label.textContent = now === "dark" ? "Light" : "Dark";
    btn.setAttribute("aria-label", "Switch to " + label.textContent.toLowerCase() + " mode");
  }

  btn.addEventListener("click", function () {
    var next = current() === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
    paint();
  });

  // Follow the system only while the visitor has made no choice of their own.
  systemDark.addEventListener("change", function () {
    if (!root.dataset.theme) paint();
  });

  paint();
})();
