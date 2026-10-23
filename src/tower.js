(() => {
  "use strict";

  const { el, icon, warnOnce, query } = DogNerd;

  const ROUTE = /^\/tower\/?$/;
  const RUN_KEY = "towerRun";
  const MOB_PORTRAIT = '[class*="tower_tuiMobPortrait__"] [class*="tower_portraitImageContainer__"]';
  const PLAYER_PORTRAIT = '[class*="tower_playerPortraitFx__"]';

  const EFFECTS = [
    {
      status: "riposting",
      start: /You chuck the (.+?), readying yourself to riposte!/,
      tick: /You riposte .+ attack/,
      items: {
        "Polished Frisbee": { turns: 3, image: "/img/items/weapons/Weapon_Upgrade_Ranged2.png" },
        "Ultimate Frisbee": { turns: 5, image: "/img/items/weapons/Weapon_Upgrade_Ranged3.png" },
      },
    },
  ];

  let run = null;
  const newRun = () => ({ floor: null, queue: 0, pendingPop: false, effects: {}, last: null });

  const hashString = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

  browser.storage.local
    .get(RUN_KEY)
    .then(async (r) => {
      run ??= r[RUN_KEY] ?? null;
      schedule();
      if (ROUTE.test(location.pathname)) onState(await query("tower.getState"));
    })
    .catch((e) => warnOnce("tower-load", "couldn't load the run:", e.message));

  function save() {
    browser.storage.local.set({ [RUN_KEY]: run }).catch((e) => warnOnce("tower-save", "couldn't save the run:", e.message));
    schedule();
  }

  // left is null while the effect is active but its remaining turns are unknown.
  function nextEffect(effect, previous, text, statuses) {
    if (!statuses.includes(effect.status)) return { left: 0, item: null };
    const started = text.match(effect.start);
    if (started) return { left: effect.items[started[1]]?.turns || null, item: started[1] };
    const current = { left: 0, item: null, ...previous };
    if (effect.tick.test(text)) current.left = Math.max(0, (current.left ?? 0) - 1);
    return { ...current, left: current.left || null };
  }

  function followEffects(ui, text) {
    const statuses = ui.playerPortrait?.statusEffects ?? [];
    for (const effect of EFFECTS) {
      run.effects[effect.status] = nextEffect(effect, run.effects[effect.status], text, statuses);
    }
  }

  function followQueue(ui, text) {
    const floor = ui.levelName?.text ?? null;
    if (floor !== run.floor) Object.assign(run, { floor, queue: 0, pendingPop: false });

    const mob = ui.mobPortrait;
    if (run.pendingPop && mob?.visible && mob.hp > 0) {
      run.queue = Math.max(0, run.queue - 1);
      run.pendingPop = false;
    }
    if (/You SLICE the enemy in two/.test(text)) run.queue += 1;
    if (/You defeated/.test(text) && run.queue > 0) run.pendingPop = true;
    if (ui.directionControls?.visible) Object.assign(run, { queue: 0, pendingPop: false });
  }

  function follow(ui) {
    const step = hashString(JSON.stringify(ui));
    if (run?.last === step) return;
    run ??= newRun();
    run.last = step;
    const text = ui.textbox?.text ?? "";
    followEffects(ui, text);
    followQueue(ui, text);
    save();
  }

  let latestUi = null;

  function onState(data) {
    const active = data?.state === "active";
    latestUi = active ? (data.ui ?? null) : null;
    schedule();
    if (active && data.ui) {
      follow(data.ui);
    } else if (data?.state && run) {
      run = null;
      save();
    }
  }

  function onTowerResponse(procedures, text) {
    let results;
    try {
      results = JSON.parse(text);
    } catch {
      return;
    }
    procedures.forEach((procedure, i) => {
      const result = results?.[i]?.result;
      if (!result) return;
      if (procedure === "tower.start") {
        run = newRun();
        save();
      } else if (procedure === "tower.getState" || procedure === "tower.takeTurn") {
        onState(result.data?.json);
      }
    });
  }

  document.addEventListener("dognerd:tower", (e) => {
    try {
      const { procedures, text } = JSON.parse(e.detail);
      onTowerResponse(procedures, text);
    } catch (err) {
      warnOnce("tower-fetch", "couldn't follow a tower request:", err.message);
    }
  });

  const imagePath = (src) => {
    try {
      return new URL(src, location.origin).pathname;
    } catch {
      return "";
    }
  };

  function showEffects() {
    const cells = [...document.querySelectorAll('[class*="tower_combatCell__"]')];
    const turnsByCell = new Map();
    for (const e of EFFECTS) {
      const effect = run?.effects[e.status];
      if (!effect || effect.left === 0) continue;
      const items = effect.item ? [e.items[effect.item]] : Object.values(e.items);
      const images = items.map((i) => i?.image);
      const turns = effect.left === null ? "?" : String(effect.left);
      for (const cell of cells) {
        if (images.includes(imagePath(cell.querySelector("img")?.src ?? ""))) turnsByCell.set(cell, turns);
      }
    }
    for (const cell of cells) {
      let badge = cell.querySelector(":scope > .dognerd-turns");
      const turns = turnsByCell.get(cell);
      if (turns === undefined) {
        badge?.remove();
        continue;
      }
      if (!badge) cell.append((badge = el("span", { className: "dognerd-item-badge dognerd-turns" })));
      if (badge.dataset.text !== turns) {
        badge.dataset.text = turns;
        badge.replaceChildren(icon("shield"), turns);
      }
    }
  }

  function showQueue() {
    const portrait = document.querySelector(MOB_PORTRAIT);
    let badge = portrait?.querySelector(":scope > .dognerd-queue");
    if (!portrait || !run?.queue) {
      badge?.remove();
      return;
    }
    if (!badge) portrait.append((badge = el("span", { className: "dognerd-queue" })));
    badge.textContent = `+${run.queue}`;
  }

  const STATUS_KINDS = {
    riposting: "good",
    protected: "good",
    "force-field": "good",
    glowing: "good",
    burning: "fire",
    poisoned: "poison",
    worms: "poison",
    curse: "curse",
    "marked-for-death": "curse",
    weakened: "weak",
    crushed: "weak",
    bubbled: "stun",
    frozen: "ice",
    cold: "ice",
    slowed: "ice",
    confused: "charm",
    charmed: "charm",
    seduced: "charm",
    small: "size",
    big: "size",
  };

  // "marked-for-death" -> "Marked For Death"
  const statusLabel = (status) => status.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  function showStatuses(container, statuses) {
    let row = container?.querySelector(":scope > .dognerd-statuses");
    if (!container || !statuses?.length) {
      row?.remove();
      return;
    }
    const sig = JSON.stringify(statuses);
    if (row?.dataset.sig === sig) return;
    if (!row) container.append((row = el("div", { className: "dognerd-statuses" })));
    row.dataset.sig = sig;
    row.replaceChildren(
      ...statuses.map((s) =>
        el("span", {
          className: `dognerd-item-badge dognerd-status dognerd-status-${STATUS_KINDS[s] ?? "other"}`,
          textContent: statusLabel(s),
        }),
      ),
    );
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!ROUTE.test(location.pathname)) return;
      showEffects();
      showQueue();
      showStatuses(document.querySelector(PLAYER_PORTRAIT), latestUi?.playerPortrait?.statusEffects);
      showStatuses(
        document.querySelector(MOB_PORTRAIT),
        latestUi?.mobPortrait?.visible ? latestUi.mobPortrait.statusEffects : null,
      );
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
