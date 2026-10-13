/* Apply the saved theme before first paint. Keep the key in sync with ThemeContext. */
try {
  var theme = localStorage.getItem("dfaztec.theme.v1");
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#000000");
  }
} catch (e) {
  /* Storage can be unavailable; the splash stays on the dark default. */
}
