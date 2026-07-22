(function () {
  "use strict";
  var params = new URLSearchParams(window.location.search);
  var theme = params.get("theme");
  if (theme === "light" || theme === "dark") document.body.dataset.widgetTheme = theme;
}());
