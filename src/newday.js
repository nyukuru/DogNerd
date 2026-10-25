(() => {
  "use strict";

  const { el, untilNewDay } = DogNerd;

  const NEW_DAY = "dognerd-new-day";

  const clock = (ms) => {
    const minutes = Math.floor(ms / 60000);
    return [Math.floor(minutes / 60), minutes % 60].map((n) => String(n).padStart(2, "0")).join(":");
  };

  function showNewDay() {
    const message = document.querySelector('[class*="Weather_message__"]');
    if (!message) return;
    let line = message.querySelector(`:scope > .${NEW_DAY}`);
    if (!line) message.append((line = el("span", { className: NEW_DAY }, [el("br"), "A new day will come in: ", el("span")])));
    const text = clock(untilNewDay());
    if (line.lastChild.textContent !== text) line.lastChild.textContent = text;
  }

  setInterval(showNewDay, 1000);
  new MutationObserver(showNewDay).observe(document.body, { childList: true, subtree: true });
  showNewDay();
})();
