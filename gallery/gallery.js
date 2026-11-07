(() => {
  const FOUNDRY_ORDER = ["impacts", "melee", "explosions", "fire", "ice", "lightning", "arcane", "holy", "shadow", "nature", "water", "wind", "smoke", "status", "projectiles", "ui"];
  const LEGACY_ORDER = ["combat", "elemental", "defense", "support", "status", "arcane", "environment", "movement", "interface"];
  const LABELS = {
    impacts: "冲击", melee: "近战", explosions: "爆炸", fire: "火焰", ice: "冰霜", lightning: "闪电",
    arcane: "奥术", holy: "神圣", shadow: "暗影", nature: "自然", water: "水", wind: "风", smoke: "烟雾",
    status: "状态", projectiles: "弹道", ui: "界面", combat: "战斗", defense: "防御", elemental: "元素",
    environment: "环境", interface: "界面", movement: "移动", support: "辅助"
  };

  const state = {
    library: "foundry",
    tier: "lit",
    timing: "all",
    category: "all",
    scale: 3,
    checker: true,
    query: ""
  };

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const live = new Set();
  let effects = { foundry: [], legacy: [] };
  let selected = null;
  let detailPlayer = null;
  let observer = null;
  let builtFor = "";
  let lastTick = 0;

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const dialog = $("detail");

  function label(category) {
    return LABELS[category] || category;
  }

  function normalizeFoundry(effect) {
    return {
      key: `foundry:${effect.id}`,
      library: "foundry",
      id: effect.id,
      name: effect.name,
      description: effect.description || "",
      category: effect.category,
      tags: effect.tags || [],
      frames: effect.frames,
      frameMs: effect.frame_ms,
      loop: !!effect.loop,
      w: effect.size[0],
      h: effect.size[1],
      columns: 8,
      sheet(tier) {
        return `../${effect.artifacts[tier].grid.sheet}`;
      }
    };
  }

  function normalizeLegacy(effect) {
    return {
      key: `legacy:${effect.id}`,
      library: "legacy",
      id: effect.id,
      name: effect.display_name || effect.id,
      description: effect.description || "",
      category: effect.category,
      tags: effect.tags || [],
      frames: effect.frames,
      frameMs: 50,
      loop: effect.loop === "loop" || effect.loop === true,
      w: 96,
      h: 96,
      columns: 5,
      sheet() {
        return `../legacy/0.10.0/${effect.artifacts.grid.sheet}`;
      }
    };
  }

  function playableCount(effect) {
    return effect.loop ? effect.frames : Math.max(1, effect.frames - 1);
  }

  function matches(effect) {
    if (state.category !== "all" && effect.category !== state.category) return false;
    if (state.timing === "loop" && !effect.loop) return false;
    if (state.timing === "once" && effect.loop) return false;
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    const hay = `${effect.name} ${effect.id} ${effect.description} ${effect.tags.join(" ")} ${label(effect.category)}`.toLowerCase();
    return hay.includes(q);
  }

  function makeButton(parent, text, value, pressed, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.dataset.value = String(value);
    button.setAttribute("aria-pressed", pressed ? "true" : "false");
    button.addEventListener("click", onClick);
    parent.appendChild(button);
    return button;
  }

  function fillSeg(id, options, current, onPick) {
    const host = $(id);
    host.replaceChildren();
    for (const option of options) {
      makeButton(host, option.label, option.value, option.value === current, () => onPick(option.value));
    }
  }

  function press(id, value) {
    for (const button of $(id).querySelectorAll("button")) {
      button.setAttribute("aria-pressed", button.dataset.value === String(value) ? "true" : "false");
    }
  }

  function renderControls() {
    fillSeg("library", [
      { value: "foundry", label: "1.0 现行" },
      { value: "legacy", label: "0.10 旧版" }
    ], state.library, (value) => {
      if (value === state.library) return;
      state.library = value;
      state.category = "all";
      closeDetail();
      render();
    });

    const tierHost = $("tier");
    tierHost.hidden = state.library !== "foundry";
    if (state.library === "foundry") {
      fillSeg("tier", [
        { value: "lit", label: "明亮" },
        { value: "strict", label: "纯色" }
      ], state.tier, (value) => {
        if (value === state.tier) return;
        state.tier = value;
        render();
      });
    }

    fillSeg("timing", [
      { value: "all", label: "全部" },
      { value: "loop", label: "循环" },
      { value: "once", label: "单次" }
    ], state.timing, (value) => {
      state.timing = value;
      press("timing", value);
      applyFilter();
    });

    fillSeg("scale", [2, 3, 4].map((value) => ({ value, label: `${value}×` })), state.scale, (value) => {
      state.scale = Number(value);
      press("scale", state.scale);
      for (const player of live) layout(player);
    });

    $("checker").setAttribute("aria-pressed", state.checker ? "true" : "false");

    const order = state.library === "foundry" ? FOUNDRY_ORDER : LEGACY_ORDER;
    const present = new Set(effects[state.library].map((effect) => effect.category));
    const cats = $("cats");
    cats.replaceChildren();
    makeButton(cats, "全部", "all", state.category === "all", () => chooseCategory("all"));
    for (const category of order) {
      if (!present.has(category)) continue;
      makeButton(cats, label(category), category, state.category === category, () => chooseCategory(category));
    }
    cats.hidden = false;
    $("toolbar").hidden = false;
  }

  function chooseCategory(category) {
    state.category = category;
    press("cats", category);
    applyFilter();
  }

  function createPlayer(effect, canvas, stage, force) {
    const player = {
      effect,
      canvas,
      stage,
      ready: false,
      active: false,
      frame: reduceMotion ? Math.floor((playableCount(effect) - 1) / 2) : 0,
      acc: 0,
      hold: 0,
      force,
      scale: 1,
      dirty: true
    };
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      player.ready = true;
      player.dirty = true;
      draw(player);
    };
    image.src = effect.sheet(state.tier);
    player.image = image;
    live.add(player);
    return player;
  }

  function layout(player) {
    if (!player.stage.clientWidth || !player.stage.clientHeight) return;
    const dpr = Math.max(1, Math.round(devicePixelRatio || 1));
    const zoom = player.zoom || 1;
    let cssW;
    let cssH;
    let scale;
    if (player.fillStage) {
      cssW = player.stage.clientWidth;
      cssH = player.stage.clientHeight;
      const fitted = Math.max(1, Math.floor(Math.min(cssW / player.effect.w, cssH / player.effect.h)));
      const base = Math.min(fitted, 8);
      scale = base * zoom;
    } else {
      const pad = 20;
      const maxW = Math.max(1, player.stage.clientWidth - pad);
      const maxH = Math.max(1, player.stage.clientHeight - pad);
      const fitted = Math.floor(Math.min(maxW / player.effect.w, maxH / player.effect.h));
      scale = Math.max(1, Math.min(state.scale, fitted || 1));
      cssW = player.effect.w * scale;
      cssH = player.effect.h * scale;
    }
    const nextScale = scale * dpr;
    const sameSize = player.canvas.width === Math.round(cssW * dpr) && player.canvas.height === Math.round(cssH * dpr);
    if (sameSize && player.scale === nextScale) return;
    player.canvas.style.width = player.fillStage ? "100%" : `${cssW}px`;
    player.canvas.style.height = player.fillStage ? "100%" : `${cssH}px`;
    player.canvas.width = Math.round(cssW * dpr);
    player.canvas.height = Math.round(cssH * dpr);
    player.scale = nextScale;
    player.dirty = true;
    draw(player);
  }

  function paintBackdrop(ctx, kind, w, h) {
    if (kind === "light") {
      ctx.fillStyle = "#ebe8f0";
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (kind === "none") return;
    if (kind === "sky") {
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "#0d0b14");
      gradient.addColorStop(1, "#221d33");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#cfc8ff";
      for (let i = 0; i < 36; i += 1) {
        if ((i * 17) % 23 < 18) continue;
        ctx.fillRect((i * 97) % w, (i * 53) % h, 2, 2);
      }
      return;
    }
    ctx.fillStyle = "#15131d";
    ctx.fillRect(0, 0, w, h);
    if (kind !== "ground") return;
    const floor = Math.floor(h * 0.78);
    ctx.fillStyle = "#4a4263";
    ctx.fillRect(0, floor, w, 2);
    const brickH = Math.max(8, Math.round(h / 48));
    for (let y = floor + 2; y < h; y += brickH) {
      const row = Math.floor((y - floor) / brickH);
      ctx.fillStyle = row < 1 ? "#2b2639" : "#211d2d";
      ctx.fillRect(0, y, w, brickH - 2);
      ctx.fillStyle = "#1a1724";
      const offset = row % 2 ? 16 : 0;
      for (let x = -offset; x < w; x += 28) ctx.fillRect(x, y, 2, brickH);
    }
  }

  function draw(player) {
    if (!player.ready) return;
    const ctx = player.canvas.getContext("2d");
    const { w, h, columns } = player.effect;
    const dw = w * player.scale;
    const dh = h * player.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, player.canvas.width, player.canvas.height);
    if (player.fillStage) paintBackdrop(ctx, player.backdrop || "dark", player.canvas.width, player.canvas.height);
    const ox = player.fillStage ? (player.canvas.width - dw) / 2 : 0;
    const oy = player.fillStage ? (player.canvas.height - dh) / 2 : 0;
    ctx.save();
    if (player.flip) {
      ctx.translate(ox + dw, oy);
      ctx.scale(-1, 1);
      ctx.drawImage(player.image, (player.frame % columns) * w, Math.floor(player.frame / columns) * h, w, h, 0, 0, dw, dh);
    } else {
      ctx.drawImage(player.image, (player.frame % columns) * w, Math.floor(player.frame / columns) * h, w, h, ox, oy, dw, dh);
    }
    ctx.restore();
    player.dirty = false;
  }

  function step(player, dt) {
    if (!player.ready || !player.active || player.playing === false) return;
    if (reduceMotion && !player.force) return;
    const count = playableCount(player.effect);
    if (player.hold > 0) {
      player.hold -= dt;
      if (player.hold > 0) return;
      player.frame = 0;
      player.dirty = true;
    }
    player.acc += dt * (player.speed || 1);
    while (player.acc >= player.effect.frameMs) {
      player.acc -= player.effect.frameMs;
      player.frame += 1;
      player.dirty = true;
      if (player.frame >= count) {
        if (player.effect.loop) player.frame = 0;
        else {
          player.frame = count - 1;
          player.hold = 700;
          player.acc = 0;
        }
        break;
      }
    }
    if (player.dirty) draw(player);
  }

  function dropGridPlayers() {
    for (const player of live) {
      if (player !== detailPlayer) live.delete(player);
    }
  }

  function buildGrid() {
    const signature = `${state.library}|${state.tier}`;
    if (signature === builtFor) return;
    builtFor = signature;
    dropGridPlayers();
    if (observer) observer.disconnect();
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const player = entry.target._player;
        if (!player) continue;
        const onScreen = entry.isIntersecting && !entry.target.parentElement.hidden;
        player.active = onScreen;
        if (onScreen) layout(player);
      }
    }, { rootMargin: "200px" });

    grid.replaceChildren();
    for (const effect of effects[state.library]) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.dataset.key = effect.key;
      const stage = document.createElement("div");
      stage.className = `stage${state.checker ? " checker" : ""}`;
      const canvas = document.createElement("canvas");
      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("h2");
      title.textContent = effect.name;
      const sub = document.createElement("p");
      sub.className = "sub";
      sub.textContent = `${label(effect.category)} · ${effect.w}×${effect.h} · ${effect.loop ? "循环" : "单次"}`;
      meta.append(title, sub);
      stage.append(canvas);
      card.append(stage, meta);
      card.addEventListener("click", () => openDetail(effect));
      grid.append(card);
      const player = createPlayer(effect, canvas, stage, false);
      stage._player = player;
      observer.observe(stage);
      requestAnimationFrame(() => layout(player));
    }
  }

  function applyFilter() {
    let shown = 0;
    for (const card of grid.children) {
      const effect = effects[state.library].find((item) => item.key === card.dataset.key);
      const visible = effect ? matches(effect) : false;
      card.hidden = !visible;
      if (visible) shown += 1;
      if (!visible && card.querySelector(".stage")._player) card.querySelector(".stage")._player.active = false;
    }
    const total = effects[state.library].length;
    $("count").hidden = false;
    $("count").textContent = shown === total ? `${total} 个特效` : `显示 ${shown} / ${total}`;
    $("empty").hidden = shown !== 0;
    $("lede").textContent = state.library === "foundry"
      ? "101 个像素特效，明亮与纯色各一套。点开一张，旁边可以调速度、背景、镜像和特写。"
      : "旧版 0.10 的 44 个 96×96 特效，每行 5 帧。这一版没有明亮 / 纯色分档。";
  }

  function fact(dl, name, value) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value;
    dl.append(dt, dd);
  }

  function optionButtons(host, options, current, onPick) {
    host.replaceChildren();
    for (const option of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = option.label;
      button.dataset.value = String(option.value);
      button.setAttribute("aria-pressed", option.value === current ? "true" : "false");
      button.addEventListener("click", () => {
        for (const item of host.querySelectorAll(".btn")) {
          item.setAttribute("aria-pressed", item === button ? "true" : "false");
        }
        onPick(option.value);
      });
      host.append(button);
    }
  }

  function detailTier() {
    return detailPlayer?.tier || state.tier;
  }

  function usageText(effect) {
    const tier = effect.library === "foundry" ? detailTier() : "grid";
    const path = effect.sheet(effect.library === "foundry" ? detailTier() : "lit").replace(/^\.\.\//, "");
    return [
      `// ${path}`,
      `// ${effect.w}×${effect.h}，每行 ${effect.columns} 帧，${effect.frameMs} ms，${effect.loop ? "循环" : "单次"}`,
      `const column = frame % ${effect.columns};`,
      `const row = Math.floor(frame / ${effect.columns});`,
      `ctx.imageSmoothingEnabled = false;`,
      `ctx.drawImage(sheet, column * ${effect.w}, row * ${effect.h}, ${effect.w}, ${effect.h}, x, y, ${effect.w}, ${effect.h});`,
      tier === "strict" ? "// 当前是纯色 strict" : ""
    ].filter(Boolean).join("\n");
  }

  function refreshFacts(effect) {
    const facts = $("detail-facts");
    facts.replaceChildren();
    fact(facts, "种类", effect.loop ? "循环" : "单次");
    fact(facts, "时长", `${((playableCount(effect) * effect.frameMs) / 1000).toFixed(2)} 秒，${playableCount(effect)} 帧，每帧 ${effect.frameMs} 毫秒`);
    fact(facts, "画布", `${effect.w} × ${effect.h} 像素`);
    if (effect.library === "foundry") fact(facts, "风格", detailTier() === "lit" ? "明亮" : "纯色");
    if (effect.tags.length) fact(facts, "标签", effect.tags.join("、"));
  }

  function restartDetail() {
    if (!detailPlayer) return;
    detailPlayer.frame = 0;
    detailPlayer.acc = 0;
    detailPlayer.hold = 0;
    detailPlayer.dirty = true;
    draw(detailPlayer);
  }

  function openDetail(effect) {
    selected = effect;
    const stage = $("detail-stage");
    stage.className = "detail-stage stage";
    if (detailPlayer) live.delete(detailPlayer);
    detailPlayer = createPlayer(effect, $("detail-canvas"), stage, true);
    detailPlayer.active = true;
    detailPlayer.fillStage = true;
    detailPlayer.backdrop = "dark";
    detailPlayer.playing = true;
    detailPlayer.speed = 1;
    detailPlayer.zoom = 1;
    detailPlayer.flip = false;
    detailPlayer.tier = effect.library === "foundry" ? state.tier : "lit";
    $("detail-kicker").textContent = `${label(effect.category)} / ${effect.id}`;
    $("detail-title").textContent = effect.name;
    $("detail-desc").textContent = effect.description;
    refreshFacts(effect);
    $("d-code").textContent = usageText(effect);
    $("d-play").textContent = "暂停";
    $("d-play").setAttribute("aria-pressed", "true");
    $("d-flip").setAttribute("aria-pressed", "false");
    $("d-zoom").setAttribute("aria-pressed", "false");
    $("d-sheet-btn").setAttribute("aria-pressed", "false");
    $("d-sheet").hidden = true;
    $("d-sheet").replaceChildren();
    optionButtons($("d-speed"), [
      { value: 0.25, label: "0.25×" },
      { value: 0.5, label: "0.5×" },
      { value: 1, label: "1×" }
    ], 1, (value) => {
      detailPlayer.speed = value;
    });
    optionButtons($("d-bg"), [
      { value: "light", label: "抹白" },
      { value: "sky", label: "天空" },
      { value: "ground", label: "地面" },
      { value: "dark", label: "黑夜" },
      { value: "none", label: "无" }
    ], "dark", (value) => {
      detailPlayer.backdrop = value;
      detailPlayer.stage.classList.toggle("checker", value === "none");
      detailPlayer.dirty = true;
      draw(detailPlayer);
    });
    $("d-style-row").hidden = effect.library !== "foundry";
    if (effect.library === "foundry") {
      optionButtons($("d-style"), [
        { value: "lit", label: "明亮" },
        { value: "strict", label: "纯色" }
      ], detailPlayer.tier, (value) => {
        detailPlayer.tier = value;
        detailPlayer.ready = false;
        detailPlayer.image.src = effect.sheet(value);
        refreshFacts(effect);
        $("d-code").textContent = usageText(effect);
        if (!$("d-sheet").hidden) showSheet(effect);
      });
    }
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => layout(detailPlayer));
    history.replaceState(null, "", `#${encodeURIComponent(effect.key)}`);
  }

  function showSheet(effect) {
    const img = document.createElement("img");
    img.src = effect.sheet(effect.library === "foundry" ? detailTier() : "lit");
    img.alt = `${effect.name} 精灵图`;
    const note = document.createElement("p");
    const rows = Math.ceil(effect.frames / effect.columns);
    note.textContent = `${effect.frames} 帧，${effect.w}×${effect.h}，每行 ${effect.columns} 帧，共 ${rows} 行。末帧为空的单次特效，播放时会停在它前面。`;
    $("d-sheet").replaceChildren(img, note);
    $("d-sheet").hidden = false;
  }

  function closeDetail() {
    if (detailPlayer) live.delete(detailPlayer);
    detailPlayer = null;
    selected = null;
    if (dialog.open) dialog.close();
    history.replaceState(null, "", location.pathname + location.search);
  }

  function render() {
    renderControls();
    buildGrid();
    applyFilter();
    if (selected && selected.library === state.library) openDetail(selected);
  }

  function tick(now) {
    const dt = lastTick ? Math.min(80, now - lastTick) : 16;
    lastTick = now;
    for (const player of live) step(player, dt);
    requestAnimationFrame(tick);
  }

  $("checker").addEventListener("click", () => {
    state.checker = !state.checker;
    $("checker").setAttribute("aria-pressed", state.checker ? "true" : "false");
    for (const stage of document.querySelectorAll(".stage")) {
      stage.classList.toggle("checker", state.checker);
    }
  });

  $("query").addEventListener("input", (event) => {
    state.query = event.target.value;
    applyFilter();
  });

  $("d-play").addEventListener("click", (event) => {
    if (!detailPlayer) return;
    detailPlayer.playing = !detailPlayer.playing;
    event.currentTarget.setAttribute("aria-pressed", detailPlayer.playing ? "true" : "false");
    event.currentTarget.textContent = detailPlayer.playing ? "暂停" : "播放";
  });
  $("d-again").addEventListener("click", restartDetail);
  $("d-flip").addEventListener("click", (event) => {
    if (!detailPlayer) return;
    detailPlayer.flip = !detailPlayer.flip;
    event.currentTarget.setAttribute("aria-pressed", detailPlayer.flip ? "true" : "false");
    draw(detailPlayer);
  });
  $("d-zoom").addEventListener("click", (event) => {
    if (!detailPlayer) return;
    detailPlayer.zoom = detailPlayer.zoom === 1 ? 2 : 1;
    event.currentTarget.setAttribute("aria-pressed", detailPlayer.zoom > 1 ? "true" : "false");
    layout(detailPlayer);
  });
  $("d-sheet-btn").addEventListener("click", (event) => {
    if (!detailPlayer) return;
    const open = $("d-sheet").hidden;
    event.currentTarget.setAttribute("aria-pressed", open ? "true" : "false");
    if (open) showSheet(detailPlayer.effect);
    else $("d-sheet").hidden = true;
  });
  $("d-copy").addEventListener("click", async (event) => {
    const text = $("d-code").textContent;
    try {
      await navigator.clipboard.writeText(text);
      event.currentTarget.textContent = "已复制";
    } catch (error) {
      event.currentTarget.textContent = "请手动复制";
    }
    setTimeout(() => {
      event.currentTarget.textContent = "复制";
    }, 1200);
  });

  $("close").addEventListener("click", closeDetail);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDetail();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDetail();
  });
  window.addEventListener("resize", () => {
    for (const player of live) layout(player);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== $("query")) {
      event.preventDefault();
      $("query").focus();
    }
  });

  async function main() {
    try {
      const [foundry, legacy] = await Promise.all([
        fetch("../pack.json").then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        }),
        fetch("../legacy/0.10.0/pack.json").then((response) => {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        })
      ]);
      effects = {
        foundry: foundry.effects.map(normalizeFoundry),
        legacy: legacy.effects.map(normalizeLegacy)
      };
    } catch (error) {
      $("lede").textContent = "读不到特效目录。请在仓库根目录运行 python -m http.server，然后打开 /gallery/。直接双击 HTML 时浏览器会拦截这些文件。";
      return;
    }

    const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
    const fromHash = [...effects.foundry, ...effects.legacy].find((effect) => effect.key === hash);
    if (fromHash) state.library = fromHash.library;
    render();
    if (fromHash) openDetail(fromHash);
    requestAnimationFrame(tick);
  }

  main();
})();
