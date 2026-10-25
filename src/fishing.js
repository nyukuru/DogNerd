(() => {
  "use strict";

  const { COLLECTIONS, onData, norm, warnOnce, el, spriteUrl, untilNewDay, query, activeDog } = DogNerd;

  const ROUTE = /^\/fish\/([a-z]+)\/?$/;
  const MARK = "dognerd-bait-mark";
  const ROW = "dognerd-catchable";
  const COUNT = "dognerd-fish-count";
  const NEW_DAY = "dognerd-new-day";
  const CAUGHT_KEY = "fishCaught";

  const currentArea = () => location.pathname.match(ROUTE)?.[1] ?? null;

  function conditions() {
    const [time, weather] = document.querySelectorAll('[class*="Weather_message__"] span');
    return time && weather ? { time: norm(time.textContent), weather: norm(weather.textContent) } : null;
  }

  const allows = (allowed = "All", current) =>
    allowed.split(",").some((v) => norm(v) === "all" || norm(v) === current);

  function catchable(area, bait, now) {
    const fish = COLLECTIONS.fish;
    const where = fish?.fishing?.areas?.[area];
    const tier = fish?.fishing?.baitTiers?.find((t) => t.some((b) => norm(b) === norm(bait)));
    if (!where || !tier) return [];
    const rankOf = (name) => tier.findIndex((b) => norm(b) === norm(name));
    const baitRank = rankOf(bait);
    return fish.slots.flatMap((slot, index) => {
      const bites = slot?.obtain.some(({ where: spot, details }) => {
        if (spot !== where) return false;
        const info = Object.fromEntries(details);
        const minimumRank = rankOf(info["Minimum Bait"] ?? "");
        return (
          minimumRank >= 0 &&
          minimumRank <= baitRank &&
          allows(info["Times of Day"], now.time) &&
          allows(info["Weather Conditions"], now.weather)
        );
      });
      return bites ? [index] : [];
    });
  }

  let caught = null;
  let loadingCaught = false;

  function applyCaught(flags) {
    if (JSON.stringify(flags) === JSON.stringify(caught)) return;
    caught = flags;
    document.querySelectorAll(`.${MARK}, .${ROW}`).forEach((n) => n.remove());
    schedule();
  }

  async function loadCaught() {
    if (loadingCaught) return;
    loadingCaught = true;
    try {
      const stored = (await browser.storage.local.get(CAUGHT_KEY))[CAUGHT_KEY];
      if (stored && !caught) applyCaught(stored.caught);

      // The stored dog's fish are fetched in parallel and only refetched if the active dog changed.
      const [{ dogs }, storedDogState] = await Promise.all([
        query("doghouse.getState"),
        stored ? query("collection.getDogState", { dogIndex: stored.dogIndex }).catch(() => null) : null,
      ]);
      const dogIndex = activeDog(dogs).index;
      const { fish } =
        storedDogState && dogIndex === stored.dogIndex
          ? storedDogState
          : await query("collection.getDogState", { dogIndex });
      const flags = fish.map((f) => !!f.hasCaught);
      if (flags.length !== COLLECTIONS.fish?.slots.length) {
        warnOnce("fish-count", `the game has ${flags.length} fish but fish.json has ${COLLECTIONS.fish?.slots.length}.`);
      }
      applyCaught(flags);
      await browser.storage.local.set({ [CAUGHT_KEY]: { dogIndex, caught: flags } });
    } catch (e) {
      warnOnce("caught", "couldn't load the caught fish:", e.message);
    } finally {
      loadingCaught = false;
    }
  }

  let today = null;
  async function loadToday(area) {
    try {
      const { fishCaughtToday, todaysCap } = await query("fish.getState", { fishingAreaId: area });
      if (typeof fishCaughtToday !== "number" || typeof todaysCap !== "number") return;
      // todaysCap is zero-based.
      today = { fished: fishCaughtToday, limit: todaysCap + 1 };
      schedule();
    } catch (e) {
      warnOnce("today", "couldn't load today's fishing count:", e.message);
    }
  }

  const fractionSprite = (fished, limit) =>
    limit === 10 ? browser.runtime.getURL(`img/fished/${fished}tenth.gif`) : null;

  function countBadge(fished, limit) {
    const src = fractionSprite(fished, limit);
    if (src) return el("div", { className: "dognerd-fish-badge dognerd-sprite" }, [el("img", { src, alt: "" })]);
    const part = (className, textContent) => el("span", { className, textContent, ariaHidden: "true" });
    return el("div", { className: "dognerd-fish-badge" }, [
      part("dognerd-numerator", String(fished)),
      part("dognerd-slash", "/"),
      part("dognerd-denominator", String(limit)),
    ]);
  }

  const resizeWatched = new WeakSet();
  function showToday() {
    const art = document.querySelector('[class*="NpcPortrait_dialogue__"] > [class*="NpcPortrait_portrait__"]');
    if (!art || !today) return;
    const box = art.parentElement;
    if (!resizeWatched.has(box)) {
      resizeWatched.add(box);
      const observer = new ResizeObserver(schedule);
      observer.observe(box);
      observer.observe(art);
    }

    let label = box.querySelector(`:scope > .${COUNT}`);
    if (!label) box.append((label = el("div", { className: COUNT })));
    const fished = Math.min(today.fished, today.limit);
    const text = `${fished}/${today.limit}`;
    if (label.dataset.text !== text) {
      label.dataset.text = text;
      label.setAttribute("aria-label", `Fished ${fished} of ${today.limit} times today`);
      label.replaceChildren(
        el("div", { className: "dognerd-fish-caption", textContent: "Daily Fish:", ariaHidden: "true" }),
        countBadge(fished, today.limit),
      );
    }

    const gap = 12;
    const left = art.offsetLeft + art.offsetWidth + gap;
    const above = left + label.offsetWidth > box.clientWidth;
    label.classList.toggle("dognerd-above", above);
    label.style.left = above ? "" : `${Math.round(left)}px`;
    label.style.top = above ? "" : `${Math.round(art.offsetTop + (art.offsetHeight - label.offsetHeight) / 2)}px`;
  }

  let previousLeft = untilNewDay();
  setInterval(() => {
    const area = currentArea();
    const left = untilNewDay();
    const dayRolledOver = left > previousLeft;
    if (area && dayRolledOver) setTimeout(() => loadToday(area), 5000);
    previousLeft = left;
  }, 1000);

  const baitName = (card) => card.querySelector('[class*="ItemCard_name__"]')?.textContent ?? "";

  function markBaits(area, now) {
    for (const card of document.querySelectorAll('[class*="ItemGrid_grid__"] > [class*="ItemCard_card__"]')) {
      const wrap = card.querySelector('[class*="ItemCard_iconWrap__"]');
      if (!wrap) continue;
      const uncaught = catchable(area, baitName(card), now).filter((i) => !caught[i]).length;
      let mark = wrap.querySelector(`:scope > .${MARK}`);
      if (!uncaught) {
        mark?.remove();
        continue;
      }
      if (!mark) wrap.append((mark = el("span", { className: MARK, textContent: "!" })));
      mark.setAttribute("aria-label", `${uncaught} fish not caught yet can bite on this bait right now`);
    }
  }

  function fillBaitDialog(area, now) {
    const body = document.querySelector('[role="dialog"] [class*="Dialog_body__"]');
    if (!body || body.querySelector(`.${ROW}`)) return;
    const bait = body.querySelector("h2")?.textContent ?? "";
    const isBait = [...document.querySelectorAll('[class*="ItemGrid_grid__"] [class*="ItemCard_name__"]')].some(
      (n) => n.textContent === bait,
    );
    if (!isBait) return;
    const fish = catchable(area, bait, now);
    if (!fish.length) return;
    body.append(
      el(
        "div",
        { className: ROW },
        fish.map((i) => {
          const slot = COLLECTIONS.fish.slots[i];
          const name = caught[i] ? slot.name : "???";
          return el("img", {
            src: spriteUrl(slot.sprite),
            alt: name,
            className: caught[i] ? "" : "dognerd-uncaught",
          });
        }),
      ),
    );
  }

  let scheduled = false;
  let loadedFor = null;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const area = currentArea();
      if (!area) {
        loadedFor = null;
        return;
      }
      if (loadedFor !== location.pathname) {
        loadedFor = location.pathname;
        today = null;
        loadCaught();
        loadToday(area);
      }
      showToday();
      if (!COLLECTIONS.fish?.fishing) return;
      const now = conditions();
      if (!caught || !now) return;
      markBaits(area, now);
      fillBaitDialog(area, now);
    });
  }

  document.addEventListener(
    "click",
    (e) => {
      const button = e.target.closest?.('[role="dialog"] button');
      const area = currentArea();
      if (!area || !button || !/fish/i.test(button.textContent)) return;
      if (today) {
        today = { ...today, fished: Math.min(today.fished + 1, today.limit) };
        schedule();
      }
      setTimeout(() => {
        loadCaught();
        loadToday(area);
      }, 1500);
    },
    true,
  );

  let markedConditions = null;
  const isCountdown = (node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement)?.closest(`.${NEW_DAY}`);
  new MutationObserver((mutations) => {
    if (mutations.every((m) => isCountdown(m.target))) return;
    const now = JSON.stringify(conditions());
    if (now !== markedConditions) {
      markedConditions = now;
      document.querySelectorAll(`.${MARK}`).forEach((n) => n.remove());
    }
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  onData(schedule);
  schedule();
})();
