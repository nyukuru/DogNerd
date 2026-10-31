// Draws the "Copy as Image" pictures for trade.js and inventory.js, themed like the dog's page.
var DogNerdTradeImage = (() => {
  "use strict";

  const { spriteUrl, query } = DogNerd;

  const WIDTH = 1000;
  const CARD = { w: 162, h: 219, icon: 124, top: 16, font: 24, line: 26 };
  // Cards shrink to fit until this scale, then the image grows downwards instead.
  const MIN_SCALE = 0.5;
  const DOG_PAD = 12;
  const TITLE = { band: 110, height: 76, font: 44, pad: 32 };
  const HEADING = { height: 52, font: 30, pad: 20 };
  const SCREEN = { w: 1920, h: 1080, gap: 16, pad: 24, inset: 10, perRow: 5 };
  const FONT_FAMILY = "dognerd-trade-font";

  const fonts = new Map();
  function loadFont(src) {
    if (!fonts.has(src)) {
      const face = new FontFace(FONT_FAMILY, `url("${spriteUrl(src)}")`);
      fonts.set(src, face.load().then(() => document.fonts.add(face)));
    }
    return fonts.get(src);
  }

  async function pageTheme(dogName) {
    const state = dogName ? await query("dog.getState", { name: dogName }).catch(() => null) : null;
    const look = state?.appearance ?? {};
    const decoration = (type) => state?.decorations?.find((d) => d.type === type && d.src);
    const font = decoration("font");
    const background = decoration("background");
    const fontLoaded = font ? await loadFont(font.src).then(() => true, () => false) : false;
    const site = document.querySelector('[class*="Layout_main__"]');
    return {
      background: background ? await loadImage(spriteUrl(background.src)) : null,
      backgroundColor: site ? getComputedStyle(site).backgroundColor : "white",
      panel: look.panelBgColor ?? "#ffffffd9",
      border: look.panelBorderColor ?? "#cccccc",
      borderStyle: look.panelBorderStyle ?? "solid",
      borderWidth: look.panelBorderWidth ?? 2,
      radius: look.panelBorderRadius ?? 8,
      text: look.fontColor ?? "#3a3a4a",
      accent: look.panelAccentColor ?? "#315eff",
      font: fontLoaded ? FONT_FAMILY : '"NDS BIOS", sans-serif',
      fontScale: fontLoaded ? (font.sizeScale ?? 1) : 1,
    };
  }

  function dogLayers() {
    const dog = document.querySelector('[class*="DogDisplay_dogCard__"] [class*="DogRenderer_dog__"]');
    if (!dog) return null;
    const layers = [...dog.children].flatMap((layer) => {
      const img = layer.querySelector("img");
      if (!img?.naturalWidth) return [];
      return [{ img, x: parseFloat(layer.style.left) || 0, y: parseFloat(layer.style.top) || 0, z: parseInt(layer.style.zIndex, 10) || 0 }];
    });
    return { size: dog.offsetWidth, layers: layers.sort((a, b) => a.z - b.z) };
  }

  function dogBounds(dog, ox, oy, margin) {
    const xs = dog.layers.flatMap((l) => [l.x, l.x + l.img.naturalWidth]).concat([0, dog.size]);
    const ys = dog.layers.flatMap((l) => [l.y, l.y + l.img.naturalHeight]).concat([0, dog.size]);
    return {
      left: ox + Math.min(...xs) - margin,
      right: ox + Math.max(...xs) + margin,
      top: oy + Math.min(...ys) - margin,
      bottom: oy + Math.max(...ys) + margin,
    };
  }

  // Cells of a centred grid that miss the dog, nearest the dog first, rows past the square run downwards.
  function cells(scale, dogBox, extraRows) {
    const w = CARD.w * scale;
    const h = CARD.h * scale;
    // Odd counts put a column above and below the dog and a row either side of it.
    const odd = (n) => Math.max(1, n % 2 ? n : n - 1);
    const cols = odd(Math.floor(WIDTH / w));
    const baseRows = odd(Math.floor(WIDTH / h));
    const ox = (WIDTH - cols * w) / 2;
    const oy = (WIDTH - baseRows * h) / 2;
    const list = [];
    for (let r = 0; r < baseRows + extraRows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = ox + c * w;
        const y = oy + r * h;
        const hitsDog = dogBox && x < dogBox.right && x + w > dogBox.left && y < dogBox.bottom && y + h > dogBox.top;
        if (!hitsDog) list.push({ x, y });
      }
    }
    const centre = WIDTH / 2;
    const dist = ({ x, y }) => Math.hypot(x + w / 2 - centre, y + h / 2 - centre);
    list.sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x);
    return { list, cols, height: Math.max(WIDTH, oy * 2 + (baseRows + extraRows) * h) };
  }

  function layout(count, dogBox) {
    for (let scale = 1; scale > MIN_SCALE; scale -= 0.01) {
      const grid = cells(scale, dogBox, 0);
      if (grid.list.length >= count) return { scale, ...grid };
    }
    const base = cells(MIN_SCALE, dogBox, 0);
    const extraRows = Math.max(0, Math.ceil((count - base.list.length) / base.cols));
    return { scale: MIN_SCALE, ...cells(MIN_SCALE, dogBox, extraRows) };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.max(0, r));
  }

  function panel(ctx, x, y, w, h, theme) {
    ctx.fillStyle = theme.panel;
    roundRect(ctx, x, y, w, h, theme.radius);
    ctx.fill();
    const width = theme.borderWidth;
    if (!width) return;
    const stroke = (inset, line) => {
      ctx.lineWidth = line;
      roundRect(ctx, x + inset, y + inset, w - 2 * inset, h - 2 * inset, theme.radius - inset);
      ctx.stroke();
    };
    ctx.save();
    ctx.strokeStyle = theme.border;
    if (theme.borderStyle === "double") {
      const line = Math.max(1, width / 3);
      stroke(line / 2, line);
      stroke(width - line / 2, line);
    } else {
      if (theme.borderStyle === "dashed") ctx.setLineDash([width * 3, width * 2]);
      if (theme.borderStyle === "dotted") {
        ctx.setLineDash([0, width * 2]);
        ctx.lineCap = "round";
      }
      stroke(width / 2, width);
    }
    ctx.restore();
  }

  // Breaks after spaces and hyphens, like the doghouse cards.
  function wrap(ctx, name, width) {
    const lines = [""];
    for (const word of name.split(" ")) {
      word.split(/(?<=-)/).forEach((piece, i) => {
        const line = lines.at(-1);
        const next = line ? `${line}${i ? "" : " "}${piece}` : piece;
        if (!line || ctx.measureText(next).width <= width) lines[lines.length - 1] = next;
        else lines.push(piece);
      });
    }
    return lines;
  }

  // The largest size down to half that fits the name in two lines, past that the lines are cut with "...".
  function fitName(ctx, name, width, size, font) {
    const fits = (lines) => lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= width);
    let s = size;
    for (; s > size / 2; s--) {
      ctx.font = `${s}px ${font}`;
      const lines = wrap(ctx, name, width);
      if (fits(lines)) return { size: s, lines };
    }
    ctx.font = `${s}px ${font}`;
    const cut = (text) => {
      if (ctx.measureText(text).width <= width) return text;
      while (text.length > 1 && ctx.measureText(`${text}...`).width > width) text = text.slice(0, -1);
      return `${text}...`;
    };
    const [first, ...rest] = wrap(ctx, name, width);
    return { size: s, lines: rest.length ? [cut(first), cut(rest.join(" "))] : [cut(first)] };
  }

  function drawCard(ctx, item, image, theme) {
    panel(ctx, 4, 4, CARD.w - 8, CARD.h - 8, theme);

    const ix = (CARD.w - CARD.icon) / 2;
    if (image) {
      const fit = Math.min(CARD.icon / image.naturalWidth, CARD.icon / image.naturalHeight);
      const iw = image.naturalWidth * fit;
      const ih = image.naturalHeight * fit;
      ctx.drawImage(image, ix + (CARD.icon - iw) / 2, CARD.top + (CARD.icon - ih) / 2, iw, ih);
    }

    const size = CARD.font * theme.fontScale;
    ctx.font = `${size}px ${theme.font}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    if (item.qty > 1) {
      const label = `x${item.qty}`;
      const bw = ctx.measureText(label).width + 12;
      const bh = size + 8;
      const bx = ix + CARD.icon + 4 - bw;
      const by = CARD.top + CARD.icon + 4 - bh;
      ctx.fillStyle = theme.accent;
      roundRect(ctx, bx, by, bw, bh, 8);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    }

    ctx.fillStyle = theme.text;
    const name = fitName(ctx, item.name, CARD.w - 20, size, theme.font);
    ctx.font = `${name.size}px ${theme.font}`;
    const line = CARD.line * theme.fontScale * (name.size / size);
    name.lines.forEach((text, i) => {
      ctx.fillText(text, CARD.w / 2, CARD.top + CARD.icon + 8 + line * (i + 0.5));
    });
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function background(ctx, canvas, theme) {
    ctx.fillStyle = theme.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (theme.background) {
      ctx.fillStyle = ctx.createPattern(theme.background, "repeat");
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function title(ctx, text, theme, full = WIDTH) {
    const size = TITLE.font * theme.fontScale;
    ctx.font = `${size}px ${theme.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = Math.min(full - 40, ctx.measureText(text).width + TITLE.pad * 2);
    const top = (TITLE.band - TITLE.height) / 2;
    panel(ctx, (full - width) / 2, top, width, TITLE.height, theme);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, full / 2, top + TITLE.height / 2 + 2, full - 40 - TITLE.pad * 2);
  }

  function png(canvas) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("couldn't encode the image"))), "image/png"),
    );
  }

  // Groups fill fixed-height columns top to bottom. A group cut off at a column's end continues in a new panel,
  // without its heading, at the top of the next column.
  function flow(groups, scale, height) {
    const w = CARD.w * scale;
    const h = CARD.h * scale;
    const hs = Math.max(scale, 0.7);
    const head = HEADING.height * hs;
    const colW = SCREEN.perRow * w + 2 * SCREEN.inset;
    const cols = Math.max(1, Math.floor((SCREEN.w - 2 * SCREEN.pad + SCREEN.gap) / (colW + SCREEN.gap)));
    const room = height - TITLE.band - SCREEN.pad;
    const panels = [];
    let col = 0;
    let y = 0;
    let panel = null;
    const open = (group, heading) => {
      panel = { col, y, h: 0, group: heading ? group : null, cards: [] };
      panels.push(panel);
      y += SCREEN.inset + (heading ? head : 0);
    };
    const close = () => {
      y += SCREEN.inset;
      panel.h = y - panel.y;
      y += SCREEN.gap;
    };
    const nextCol = () => {
      col++;
      y = 0;
    };
    for (const group of groups) {
      if (y > 0 && y + 2 * SCREEN.inset + head + h > room) nextCol();
      open(group, true);
      for (let start = 0; start < group.items.length; start += SCREEN.perRow) {
        if (y + h + SCREEN.inset > room && panel.cards.length) {
          close();
          nextCol();
          open(group, false);
        }
        group.items.slice(start, start + SCREEN.perRow).forEach((item, i) => panel.cards.push({ item, x: i * w, y: y - panel.y }));
        y += h;
      }
      close();
    }
    const used = col + 1;
    return { scale, w, h, hs, head, colW, used, fits: used <= cols, panels };
  }

  // groups: [{label, items: [{name, image, qty}]}]
  async function renderGroups(groups, dogName) {
    const theme = await pageTheme(dogName);
    await document.fonts.load(`${CARD.font}px ${theme.font}`).catch(() => {});
    let height = SCREEN.h;
    let fit = flow(groups, 1, height);
    for (let scale = 1; scale >= MIN_SCALE && !fit.fits; scale -= 0.01) fit = flow(groups, scale, height);
    while (!fit.fits) fit = flow(groups, MIN_SCALE, (height += 20));
    const images = new Map(
      await Promise.all(groups.flatMap((g) => g.items).map(async (i) => [i, await loadImage(spriteUrl(`/${i.image}`))])),
    );

    const canvas = document.createElement("canvas");
    canvas.width = SCREEN.w;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    background(ctx, canvas, theme);
    if (dogName) title(ctx, `♡ ${dogName}'s inventory ♡`, theme, SCREEN.w);

    const left = (SCREEN.w - (fit.used * (fit.colW + SCREEN.gap) - SCREEN.gap)) / 2;
    for (const p of fit.panels) {
      const x = left + p.col * (fit.colW + SCREEN.gap);
      const y = TITLE.band + p.y;
      panel(ctx, x, y, fit.colW, p.h, theme);
      if (p.group) {
        ctx.font = `${HEADING.font * fit.hs * theme.fontScale}px ${theme.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = theme.text;
        ctx.fillText(p.group.label, x + fit.colW / 2, y + SCREEN.inset + fit.head / 2 + 2, fit.colW - 2 * SCREEN.inset);
      }
      for (const c of p.cards) {
        ctx.save();
        ctx.translate(x + SCREEN.inset + c.x, y + c.y);
        ctx.scale(fit.scale, fit.scale);
        drawCard(ctx, c.item, images.get(c.item), theme);
        ctx.restore();
      }
    }
    return png(canvas);
  }

  async function render(items, dogName) {
    const theme = await pageTheme(dogName);
    await document.fonts.load(`${CARD.font}px ${theme.font}`).catch(() => {});
    const dog = dogLayers();
    const dogOrigin = dog ? (WIDTH - dog.size) / 2 : 0;
    const dogBox = dog ? dogBounds(dog, dogOrigin, dogOrigin, DOG_PAD) : null;
    const grid = layout(items.length, dogBox);
    const images = await Promise.all(items.map((i) => loadImage(spriteUrl(`/${i.image}`))));

    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    const band = dogName ? TITLE.band : 0;
    canvas.height = band + Math.ceil(grid.height);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    background(ctx, canvas, theme);
    if (dogName) title(ctx, `♡ ${dogName}'s items for trade ♡`, theme);
    ctx.translate(0, band);

    if (dog) {
      panel(ctx, dogBox.left, dogBox.top, dogBox.right - dogBox.left, dogBox.bottom - dogBox.top, theme);
      for (const l of dog.layers) ctx.drawImage(l.img, dogOrigin + l.x, dogOrigin + l.y);
    }
    items.forEach((item, i) => {
      const cell = grid.list[i];
      ctx.save();
      ctx.translate(cell.x, cell.y);
      ctx.scale(grid.scale, grid.scale);
      drawCard(ctx, item, images[i], theme);
      ctx.restore();
    });

    return png(canvas);
  }

  return { render, renderGroups };
})();
