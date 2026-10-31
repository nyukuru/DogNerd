(() => {
  "use strict";

  const { el, icon, warnOnce, gameClass: g, dialog, confirmDialog, watchStored, SETTINGS_KEY, settingOn } = DogNerd;

  const BUTTON = "dognerd-settings-button";
  const ARROW = "dognerd-settings-arrow";
  const ARROW_IMAGE = browser.runtime.getURL("img/arrow_right.png");
  // Caches of game data, they reload on their own.
  const SKIPPED_KEYS = ["collections", "itemBadges", "fishCaught"];
  const FEATURES = [
    { key: "collection", label: "Collection hints" },
    { key: "items", label: "Item badges" },
    { key: "inventory", label: "Inventory 2.0" },
    { key: "doghouse", label: "Doghouse store buttons" },
    { key: "trade", label: "Up for trade" },
    { key: "fishing", label: "Fishing info" },
    { key: "farm", label: "Farm crop variants" },
    { key: "tower", label: "Tower info" },
    { key: "maze", label: "Cheese maze map" },
    { key: "dyslexiaFont", label: "Dyslexia font" },
    { key: "stillEffects", label: "Stop flashing effects" },
  ];

  let settings = {};
  watchStored(SETTINGS_KEY, (stored) => {
    settings = stored ?? {};
  });

  function save(key, on) {
    settings = { ...settings, [key]: on };
    browser.storage.local.set({ [SETTINGS_KEY]: settings }).catch((e) => warnOnce("settings-save", "couldn't save the settings:", e.message));
  }

  function checkbox({ key, label }) {
    const id = `dognerd-setting-${key}`;
    const input = el("input", { className: g("Checkbox_checkbox"), id, type: "checkbox", checked: settingOn(settings, key) });
    input.onchange = () => save(key, input.checked);
    return el("div", { className: g("Checkbox_group") }, [el("label", { className: g("Checkbox_label"), htmlFor: id }, [input, label])]);
  }

  function flash(button, text) {
    const label = button.textContent;
    button.textContent = text;
    setTimeout(() => (button.textContent = label), 1500);
  }

  async function download(button) {
    try {
      const data = await browser.storage.local.get(null);
      for (const key of SKIPPED_KEYS) delete data[key];
      const file = { app: "DogNerd", version: browser.runtime.getManifest().version, data };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
      const now = new Date();
      const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, "0")).join("-");
      const link = el("a", { href: url, download: `dognerd-${date}.json` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      warnOnce("settings-download", "couldn't download the data:", e.message);
      flash(button, "Couldn't Download");
    }
  }

  async function restore(button, file, reopen) {
    try {
      const { app, data } = JSON.parse(await file.text());
      if (app !== "DogNerd" || typeof data !== "object" || !data) throw new Error("not a DogNerd data file");
      const replace = await confirmDialog({
        title: "Restore Data",
        text: "This replaces your DogNerd settings, trade list and other saved data with the ones in the file.",
        confirm: "Restore",
      });
      if (!replace) return;
      for (const key of SKIPPED_KEYS) delete data[key];
      const kept = await browser.storage.local.get(SKIPPED_KEYS);
      await browser.storage.local.clear();
      await browser.storage.local.set({ ...data, ...kept });
      settings = data[SETTINGS_KEY] ?? {};
      reopen();
    } catch (e) {
      warnOnce("settings-restore", "couldn't restore the data:", e.message);
      flash(button, "Couldn't Restore");
    }
  }

  function dataButtons(reopen) {
    const button = (text, onclick) => el("button", { type: "button", className: `${g("Button_button")} ${g("Button_neutral")}`, textContent: text, onclick });
    const picker = el("input", { type: "file", accept: "application/json,.json", hidden: true });
    const downloadButton = button("Download Data", () => download(downloadButton));
    const restoreButton = button("Restore Data", () => picker.click());
    picker.onchange = () => {
      const [file] = picker.files;
      picker.value = "";
      if (file) restore(restoreButton, file, reopen);
    };
    return el("div", { className: g("SettingsDialog_buttonRow") }, [downloadButton, restoreButton, picker]);
  }

  function arrow(direction, label, onclick) {
    const image = el("img", { src: ARROW_IMAGE, alt: "" });
    const button = el("button", { type: "button", className: `${ARROW} ${ARROW}-${direction}`, title: label, onclick }, [image]);
    button.setAttribute("aria-label", label);
    return button;
  }

  const gameSettingsButton = () => [...document.querySelectorAll("footer button")].find((b) => b.textContent === "Settings");

  function openSettings() {
    const closeButton = el("button", {
      type: "button",
      className: `${g("Button_button")} ${g("Button_primary")} ${g("ButtonGroup_buttonContainer")}`,
      textContent: "Close",
      onclick: () => close(),
    });
    const close = dialog(
      el("div", { className: g("SettingsDialog_settings") }, [
        el("h2", { textContent: "DogNerd Settings" }),
        el("div", { className: "dognerd-settings-list" }, FEATURES.map(checkbox)),
        dataButtons(() => {
          close();
          openSettings();
        }),
      ]),
      "dognerd-settings",
      undefined,
      {
        wide: false,
        footer: el("div", { className: g("ButtonGroup_groupContainer") }, [
          el("div", { className: `${g("ButtonGroup_rowContainer")} ${g("ButtonGroup_row")}` }, [
            arrow("left", "Game settings", () => {
              close();
              gameSettingsButton()?.click();
            }),
            closeButton,
          ]),
        ]),
      },
    );
  }

  function showGameArrow() {
    const dialog = document.querySelector('[role="dialog"]:has([class*="SettingsDialog_settings__"]):not(.dognerd-settings)');
    const row = dialog?.querySelector('[class*="ButtonGroup_rowContainer__"]');
    if (!row || row.querySelector(`:scope > .${ARROW}`)) return;
    const close = [...row.querySelectorAll("button")].find((b) => b.textContent === "Close");
    row.append(
      arrow("right", "DogNerd settings", () => {
        close?.click();
        openSettings();
      }),
    );
  }

  function showButton() {
    const nav = document.querySelector('[class*="Layout_nav__"]');
    if (!nav || nav.querySelector(`:scope > .${BUTTON}`)) return;
    const button = el("button", { type: "button", className: BUTTON, title: "DogNerd settings", onclick: openSettings }, [icon("settings")]);
    button.setAttribute("aria-label", "DogNerd settings");
    button.setAttribute("aria-haspopup", "dialog");
    nav.append(button);
  }

  function update() {
    showButton();
    showGameArrow();
  }

  new MutationObserver(update).observe(document.body, { childList: true, subtree: true });
  update();
})();
