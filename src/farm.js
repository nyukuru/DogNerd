(() => {
  "use strict";

  const { COLLECTIONS, onData, warnOnce, el, spriteUrl, query, activeDog } = DogNerd;

  const ROUTE = /^\/farm\/?$/;
  const ROW = "dognerd-crop-variants";

  let harvested = null;

  async function loadHarvested() {
    try {
      const { dogs } = await query("doghouse.getState");
      const dogIndex = activeDog(dogs).index;
      const { crops } = await query("collection.getDogState", { dogIndex });
      harvested = crops.map((c) => !!c.hasHarvested);
      document.querySelectorAll(`.${ROW}`).forEach((n) => n.remove());
      schedule();
    } catch (e) {
      warnOnce("harvested", "couldn't load the harvested crops:", e.message);
    }
  }

  // "Oak Tree (19 hours remaining)" -> "Oak Tree"
  const plantName = (label) => label.replace(/\s*\(.*\)$/, "");

  function fillTileDialog() {
    const body = document.querySelector('[role="dialog"] [class*="Dialog_body__"]');
    const actions = body?.querySelector('[class*="FarmGrid_tileActionList__"]');
    if (!actions || body.querySelector(`.${ROW}`)) return;
    const plant = plantName(body.querySelector('[class*="FarmGrid_tileModalLabel__"]')?.textContent ?? "");
    const slots = COLLECTIONS.harvestables.slots;
    const crops = slots.flatMap((slot, i) => (slot?.plant === plant ? [i] : []));
    if (!crops.length) return;
    actions.before(
      el(
        "div",
        { className: ROW },
        crops.map((i) => {
          const name = harvested[i] ? slots[i].name : "???";
          return el("img", {
            src: spriteUrl(slots[i].sprite),
            alt: name,
            className: harvested[i] ? "" : "dognerd-unharvested",
          });
        }),
      ),
    );
  }

  let scheduled = false;
  let loaded = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!ROUTE.test(location.pathname)) {
        loaded = false;
        return;
      }
      if (!loaded) {
        loaded = true;
        loadHarvested();
      }
      if (!COLLECTIONS.harvestables || !harvested) return;
      fillTileDialog();
    });
  }

  document.addEventListener(
    "click",
    (e) => {
      if (!ROUTE.test(location.pathname) || !e.target.closest?.('[class*="FarmGrid_tileActionButton__"]')) return;
      setTimeout(loadHarvested, 1500);
    },
    true,
  );

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  onData(schedule);
  schedule();
})();
