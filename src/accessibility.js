(() => {
  "use strict";

  globalThis.browser ??= chrome;

  const CLASSES = { dyslexiaFont: "dognerd-dyslexia-font", stillEffects: "dognerd-still-effects" };

  function apply(settings) {
    for (const [key, className] of Object.entries(CLASSES)) {
      document.documentElement.classList.toggle(className, settings?.[key] === true);
    }
  }

  browser.storage.local
    .get("settings")
    .then((r) => apply(r.settings))
    .catch(() => {});
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) apply(changes.settings.newValue);
  });
})();
