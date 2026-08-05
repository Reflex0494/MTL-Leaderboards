const SERIES_COLORS = [
  "--series-1", "--series-2", "--series-3", "--series-4",
  "--series-5", "--series-6", "--series-7", "--series-8",
];
const MAX_SERIES = 8;

const state = {
  topN: 5,
  customSteamIds: [], // used when topN === 0
  players: [], // {steam_id, display_name, prestige_level}
  history: { players: {} }, // full data/history.json
};

const el = (id) => document.getElementById(id);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function timeAgo(iso) {
  if (!iso) return "";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Average seconds per prestige level, estimated from our own collected
// history: (time between first and last observed snapshot) / (levels
// gained over that span). Returns null when we haven't observed a level
// change yet (not enough data, not "zero").
function avgSecondsPerPrestige(points) {
  if (!points || points.length < 2) return null;
  const sorted = [...points].sort((a, b) => new Date(a.t) - new Date(b.t));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const levelsGained = last.prestigeLevel - first.prestigeLevel;
  if (levelsGained <= 0) return null;
  const seconds = (new Date(last.t) - new Date(first.t)) / 1000;
  return seconds / levelsGained;
}

function formatDuration(seconds) {
  if (seconds == null) return "—";
  const days = seconds / 86400;
  if (days >= 1) return `${days.toFixed(1)}d`;
  const hours = seconds / 3600;
  if (hours >= 1) return `${hours.toFixed(1)}h`;
  const mins = seconds / 60;
  if (mins >= 1) return `${Math.round(mins)}m`;
  return `${Math.round(seconds)}s`;
}

async function fetchJSON(url) {
  const res = await fetch(`${url}?_=${Date.now()}`); // bust GH Pages/CDN caching
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- Status ----------
async function refreshStatus() {
  try {
    const s = await fetchJSON("data/status.json");
    const line = el("status-line");
    const ok = s.lastFetch && s.lastFetch.ok !== false;
    line.innerHTML = `<span class="dot${ok ? "" : " error"}"></span>` +
      (s.lastFetch && s.lastFetch.at
        ? `Last fetch ${timeAgo(s.lastFetch.at)}${ok ? "" : " (failed)"} · `
        : "") +
      `${s.snapshotCount} snapshot${s.snapshotCount === 1 ? "" : "s"} collected · polling every ${Math.round(s.fetchIntervalSeconds / 60)}m`;
  } catch {
    el("status-line").textContent = "Could not load status data.";
  }
}

// ---------- Latest table ----------
async function refreshLatestTable() {
  const data = await fetchJSON("data/latest.json");
  const body = el("lb-body");
  if (!data.snapshot || data.entries.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="empty-state">No data yet — waiting on the first update.</td></tr>`;
    return;
  }
  const playersMap = state.history.players || {};
  body.innerHTML = data.entries.map((e) => `
    <tr>
      <td class="num">${e.rank}</td>
      <td class="name">${escapeHtml(e.display_name)}</td>
      <td class="center">${e.prestige_level.toLocaleString()}</td>
      <td class="num">${formatDuration(avgSecondsPerPrestige(playersMap[e.steam_id]?.points))}</td>
      <td>${escapeHtml(timeAgo(e.achieved_at))}</td>
    </tr>
  `).join("");
}

// ---------- Player search ----------
async function loadPlayers() {
  state.history = await fetchJSON("data/history.json");
  state.players = Object.entries(state.history.players || {})
    .map(([steamId, p]) => {
      const last = p.points[p.points.length - 1];
      return { steam_id: steamId, display_name: p.displayName, prestige_level: last ? last.prestigeLevel : 0 };
    })
    .sort((a, b) => b.prestige_level - a.prestige_level);
}

function setupPlayerSearch() {
  const input = el("player-search");
  const list = el("suggestion-list");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { list.classList.remove("open"); list.innerHTML = ""; return; }
    const matches = state.players
      .filter((p) => p.display_name.toLowerCase().includes(q) && !state.customSteamIds.includes(p.steam_id))
      .slice(0, 8);
    if (matches.length === 0) { list.classList.remove("open"); list.innerHTML = ""; return; }
    list.innerHTML = matches.map((p) =>
      `<div data-steam-id="${p.steam_id}">${escapeHtml(p.display_name)} <span style="opacity:.6">— ${p.prestige_level}</span></div>`
    ).join("");
    list.classList.add("open");
  });

  list.addEventListener("click", (e) => {
    const target = e.target.closest("[data-steam-id]");
    if (!target) return;
    const sid = target.dataset.steamId;
    if (!state.customSteamIds.includes(sid) && state.customSteamIds.length < MAX_SERIES) {
      state.customSteamIds.push(sid);
      el("top-n").value = "0";
      state.topN = 0;
      renderChips();
      renderChartFromState();
    }
    input.value = "";
    list.classList.remove("open");
    list.innerHTML = "";
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest("#player-suggestions")) list.classList.remove("open");
  });
}

function renderChips() {
  const row = el("chip-row");
  if (state.topN !== 0) { row.innerHTML = ""; return; }
  row.innerHTML = state.customSteamIds.map((sid, i) => {
    const p = state.players.find((pp) => pp.steam_id === sid);
    const name = p ? p.display_name : sid;
    const color = cssVar(SERIES_COLORS[i % SERIES_COLORS.length]);
    return `<span class="chip"><span class="swatch" style="background:${color}"></span>${escapeHtml(name)}<button data-remove="${sid}">×</button></span>`;
  }).join("");
  row.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.customSteamIds = state.customSteamIds.filter((sid) => sid !== btn.dataset.remove);
      renderChips();
      renderChartFromState();
    });
  });
}

el("top-n").addEventListener("change", (e) => {
  state.topN = parseInt(e.target.value, 10);
  renderChips();
  renderChartFromState();
});

// ---------- Chart ----------
function renderChartFromState() {
  const playersMap = state.history.players || {};
  let steamIds;
  if (state.topN > 0) {
    steamIds = state.players.slice(0, state.topN).map((p) => p.steam_id);
  } else {
    steamIds = state.customSteamIds;
  }
  const seriesObj = {};
  for (const sid of steamIds) {
    const p = playersMap[sid];
    if (p) seriesObj[sid] = { steamId: sid, displayName: p.displayName, points: p.points };
  }
  renderChart(seriesObj);
}

function renderChart(seriesObj) {
  const svg = el("chart");
  const empty = el("chart-empty");
  const legend = el("legend");
  const seriesList = Object.values(seriesObj).filter((s) => s.points.length > 0);
  // Rank order — highest current prestige first — regardless of the order
  // the data arrived in or players were added, so the legend/colors always
  // read top-to-bottom the same way the leaderboard does.
  seriesList.sort((a, b) => b.points[b.points.length - 1].prestigeLevel - a.points[a.points.length - 1].prestigeLevel);

  if (seriesList.length === 0 || !seriesList.some((s) => s.points.length > 1)) {
    svg.innerHTML = "";
    legend.innerHTML = "";
    empty.style.display = "block";
    return;
  }
  empty.style.display = "none";

  const W = 1000, H = 340;
  const padL = 46, padR = 16, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  let tMin = Infinity, tMax = -Infinity, vMax = 0;
  for (const s of seriesList) {
    for (const p of s.points) {
      const t = new Date(p.t).getTime();
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      if (p.prestigeLevel > vMax) vMax = p.prestigeLevel;
    }
  }
  if (tMin === tMax) tMin -= 3600 * 1000;
  vMax = Math.max(1, Math.ceil(vMax * 1.15));

  const x = (t) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
  const y = (v) => padT + plotH - (v / vMax) * plotH;

  let svgParts = [];

  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const v = Math.round((vMax / steps) * i);
    const gy = y(v);
    svgParts.push(`<line class="gridline" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" />`);
    svgParts.push(`<text class="axis-label" x="${padL - 8}" y="${gy + 4}" text-anchor="end">${v}</text>`);
  }
  svgParts.push(`<line class="baseline" x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" />`);

  const fmt = (t) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  svgParts.push(`<text class="axis-label" x="${padL}" y="${H - 6}" text-anchor="start">${fmt(tMin)}</text>`);
  svgParts.push(`<text class="axis-label" x="${W - padR}" y="${H - 6}" text-anchor="end">${fmt(tMax)}</text>`);

  const legendItems = [];
  const endpoints = [];
  seriesList.forEach((s, i) => {
    const colorVar = SERIES_COLORS[i % SERIES_COLORS.length];
    const color = cssVar(colorVar);
    // Beyond 8 series the fixed palette has to repeat a hue (never invent an
    // unvalidated 9th color) — dash the line and hollow the markers for the
    // repeats so they stay visually distinct from their color-twin, not just
    // legend-distinct.
    const isRepeat = i >= SERIES_COLORS.length;
    const pts = [...s.points].sort((a, b) => new Date(a.t) - new Date(b.t));
    const pathD = pts.map((p, idx) => `${idx === 0 ? "M" : "L"} ${x(new Date(p.t).getTime()).toFixed(2)} ${y(p.prestigeLevel).toFixed(2)}`).join(" ");
    svgParts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${isRepeat ? ' stroke-dasharray="6 4"' : ""} />`);

    const last = pts[pts.length - 1];
    const lx = x(new Date(last.t).getTime());
    const ly = y(last.prestigeLevel);
    svgParts.push(isRepeat
      ? `<circle cx="${lx}" cy="${ly}" r="5" fill="var(--surface-1)" stroke="${color}" stroke-width="2.5" />`
      : `<circle cx="${lx}" cy="${ly}" r="5" fill="${color}" stroke="var(--surface-1)" stroke-width="2" />`);
    endpoints.push({ lx, ly, name: s.displayName });

    const swatch = isRepeat
      ? `style="background:transparent;border:2px solid ${color}"`
      : `style="background:${color}"`;
    legendItems.push(`<div class="legend-item"><span class="legend-swatch" ${swatch}></span>${escapeHtml(s.displayName)}</div>`);
  });

  // Direct end-labels for every series. When values tie (or sit close
  // together) the labels would overlap, so instead of dropping the
  // colliding ones, nudge them apart vertically and reconnect each to its
  // actual data point with a thin leader line — every name stays visible.
  const MIN_GAP = 14;
  endpoints.sort((a, b) => a.ly - b.ly);
  endpoints.forEach((p) => { p.labelY = p.ly; });
  for (let i = 1; i < endpoints.length; i++) {
    if (endpoints[i].labelY - endpoints[i - 1].labelY < MIN_GAP) {
      endpoints[i].labelY = endpoints[i - 1].labelY + MIN_GAP;
    }
  }
  for (const p of endpoints) {
    const onRight = p.lx > W - 140;
    const labelAnchor = onRight ? "end" : "start";
    const labelX = onRight ? p.lx - 10 : p.lx + 10;
    if (Math.abs(p.labelY - p.ly) > 0.5) {
      svgParts.push(`<line class="end-leader" x1="${p.lx}" y1="${p.ly}" x2="${labelX}" y2="${p.labelY}" />`);
    }
    svgParts.push(`<text class="end-label emph" x="${labelX}" y="${p.labelY + 4}" text-anchor="${labelAnchor}">${escapeHtml(p.name)}</text>`);
  }

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = svgParts.join("\n");
  legend.innerHTML = legendItems.join("");

  setupHover(svg, seriesList, { x, y, tMin, tMax, padL, padR, W });
}

function setupHover(svg, seriesList, scales) {
  const tooltip = el("tooltip");
  const wrap = svg.parentElement;

  svg.onmousemove = (evt) => {
    const rect = svg.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const frac = Math.min(1, Math.max(0, (px - scales.padL * (rect.width / scales.W)) / ((scales.W - scales.padL - scales.padR) * (rect.width / scales.W))));
    const targetT = scales.tMin + frac * (scales.tMax - scales.tMin);

    const rows = seriesList.map((s) => {
      let nearest = s.points[0];
      let best = Infinity;
      for (const p of s.points) {
        const d = Math.abs(new Date(p.t).getTime() - targetT);
        if (d < best) { best = d; nearest = p; }
      }
      return { name: s.displayName, val: nearest.prestigeLevel, t: nearest.t };
    });

    const colorFor = (i) => cssVar(SERIES_COLORS[i % SERIES_COLORS.length]);
    tooltip.innerHTML = `<div class="t-time">${new Date(rows[0].t).toLocaleString()}</div>` +
      rows.map((r, i) => `<div class="t-row"><span class="name"><span class="t-dot" style="background:${colorFor(i)}"></span>${escapeHtml(r.name)}</span><span class="val">${r.val}</span></div>`).join("");
    tooltip.style.display = "block";
    tooltip.style.left = `${Math.min(px + 16, wrap.clientWidth - 180)}px`;
    tooltip.style.top = `10px`;
  };
  svg.onmouseleave = () => { tooltip.style.display = "none"; };
}

// ---------- Init ----------
async function init() {
  setupPlayerSearch();
  await refreshStatus();
  await loadPlayers();
  await refreshLatestTable();
  renderChartFromState();

  setInterval(refreshStatus, 5 * 60 * 1000);
  setInterval(async () => {
    await loadPlayers();
    await refreshLatestTable();
    renderChartFromState();
  }, 10 * 60 * 1000);
}

init();
