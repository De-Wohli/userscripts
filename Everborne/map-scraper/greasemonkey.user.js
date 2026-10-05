// ==UserScript==
// @name         Everborne Map Scraper
// @namespace    https://github.com/everborne-map
// @version      2.6.0
// @description  Scrapes the current tile from Everborne and sends it to your local map server.
// @author       everborne-map
// @homepageURL  https://github.com/De-Wohli/userscripts/tree/main/Everborne/map-scraper
// @supportURL   https://github.com/De-Wohli/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/De-Wohli/userscripts/main/Everborne/map-scraper/greasemonkey.meta.js
// @downloadURL  https://raw.githubusercontent.com/De-Wohli/userscripts/main/Everborne/map-scraper/greasemonkey.user.js
// @match        https://everborne.com/play.php*
// @match        https://www.everborne.com/play.php*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      evm.fuyune.de
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ── Config defaults ────────────────────────────────────────────────
  const DEFAULT_SERVER = 'https://evm.fuyune.de';

  function getSetting(key, def) { return GM_getValue(key, def); }
  function setSetting(key, val) { GM_setValue(key, val); }

  function getServer() { return getSetting('em_server', DEFAULT_SERVER).replace(/\/$/, ''); }
  function getApiKey() { return getSetting('em_api_key', ''); }

  // ── Inject styles ──────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    .em-ui, .em-ui * { box-sizing: border-box; }
    .em-ui {
      --em-ink: #18272c;
      --em-ink-2: #213439;
      --em-line: #3a535a;
      --em-brass: #c9a227;
      --em-brass-hi: #e0bb45;
      --em-chalk: #ebe5d3;
      --em-lichen: #93ab9e;
      --em-rust: #e07a5f;
      --em-moss: #7fbf8a;
      --em-serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
      --em-sans: system-ui, "Segoe UI", Roboto, sans-serif;
      font: 13px/1.4 var(--em-sans);
      color: var(--em-chalk);
      text-align: left;
    }
    .em-ui button:focus-visible, .em-ui input:focus-visible, .em-ui textarea:focus-visible {
      outline: 2px solid var(--em-brass);
      outline-offset: 1px;
    }
    @keyframes em-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .em-ui *, .em-ui *::before, .em-ui *::after { animation: none !important; transition: none !important; }
    }

    /* ── Dock ── */
    #em-bar {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 999999;
      display: flex;
      flex-direction: column-reverse;
      align-items: flex-end;
      gap: 8px;
    }
    #em-toolbox-btn {
      display: flex;
      align-items: center;
      gap: 9px;
      margin: 0;
      padding: 5px 14px 5px 5px;
      background: var(--em-ink);
      color: var(--em-chalk);
      border: 1px solid var(--em-line);
      border-radius: 999px;
      font: 600 13px/1 var(--em-sans);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,0.45);
    }
    #em-toolbox-btn:hover { border-color: var(--em-brass); }
    .em-compass {
      position: relative;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid var(--em-brass);
      background: var(--em-ink-2);
      flex: none;
    }
    .em-compass::before {
      content: '';
      position: absolute;
      left: 50%;
      top: 3px;
      width: 6px;
      height: 16px;
      margin-left: -3px;
      background: linear-gradient(var(--em-rust) 50%, var(--em-chalk) 50%);
      clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
      transition: transform 0.3s ease;
    }
    #em-toolbox-btn[aria-expanded="true"] .em-compass::before { transform: rotate(180deg); }
    .em-pos-label { color: var(--em-lichen); font-weight: 400; }

    #em-toolbox-panel {
      width: 250px;
      padding: 6px;
      background: var(--em-ink);
      border: 1px solid var(--em-line);
      border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.45);
    }
    #em-toolbox-panel[hidden] { display: none; }
    .em-group + .em-group { border-top: 1px solid var(--em-line); margin-top: 6px; padding-top: 6px; }
    .em-group-label { padding: 4px 8px 2px; font: 600 12px/1.3 var(--em-serif); color: var(--em-lichen); }
    .em-item {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      margin: 0;
      padding: 7px 8px;
      background: transparent;
      color: var(--em-chalk);
      border: none;
      border-radius: 6px;
      font: 500 13px/1.3 var(--em-sans);
      text-align: left;
      cursor: pointer;
    }
    .em-item:hover { background: var(--em-ink-2); }
    .em-item small { display: block; color: var(--em-lichen); font-size: 11px; font-weight: 400; }
    .em-ico { width: 18px; text-align: center; flex: none; }
    .em-item--primary { background: var(--em-brass); color: #1d1704; }
    .em-item--primary small { color: #3d3210; }
    .em-item--primary:hover { background: var(--em-brass-hi); }
    .em-item.is-busy { cursor: progress; opacity: 0.75; }
    .em-item.is-busy::after {
      content: '';
      margin-left: auto;
      width: 12px;
      height: 12px;
      flex: none;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: em-spin 0.8s linear infinite;
    }
    .em-footer { display: flex; gap: 4px; }
    .em-footer .em-item { justify-content: center; color: var(--em-lichen); }
    .em-footer .em-item:hover { color: var(--em-chalk); }

    /* ── Windows ── */
    .em-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      background: rgba(8,14,16,0.62);
    }
    .em-overlay[hidden] { display: none; }
    .em-modal {
      width: min(460px, 100%);
      max-height: 90vh;
      overflow-y: auto;
      padding: 18px 20px 20px;
      background: var(--em-ink);
      border: 1px solid var(--em-line);
      border-radius: 12px;
      box-shadow: 0 24px 60px rgba(0,0,0,0.5);
    }
    #em-cfg-modal, #em-coord-modal { width: min(360px, 100%); }
    .em-modal h2 {
      margin: 0 0 4px;
      font: 600 20px/1.2 var(--em-serif);
      color: var(--em-chalk);
      cursor: grab;
      user-select: none;
    }
    .em-modal h2:active { cursor: grabbing; }
    .em-modal h3 { margin: 16px 0 6px; font: 600 14px/1.3 var(--em-serif); color: var(--em-chalk); }
    .em-sub { margin: 0 0 14px; font-size: 12px; color: var(--em-lichen); }

    .em-field { margin-bottom: 10px; }
    .em-field label { display: block; margin-bottom: 4px; font-size: 12px; color: var(--em-lichen); }
    .em-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .em-field input, .em-field textarea {
      width: 100%;
      height: auto;
      margin: 0;
      padding: 6px 9px;
      background: var(--em-ink-2);
      color: var(--em-chalk);
      border: 1px solid var(--em-line);
      border-radius: 6px;
      box-shadow: none;
      font: 13px/1.4 var(--em-sans);
    }
    .em-field textarea { resize: vertical; min-height: 54px; }
    .em-field input:focus, .em-field textarea:focus {
      outline: none;
      border-color: var(--em-brass);
      box-shadow: 0 0 0 2px rgba(201,162,39,0.25);
    }
    .em-features { margin: 0 0 10px; padding: 0; list-style: none; font-size: 12px; color: var(--em-lichen); }
    .em-features li { padding: 4px 0; border-bottom: 1px dashed var(--em-line); }
    .em-features strong { color: var(--em-chalk); font-weight: 600; }
    .em-error { margin-top: 8px; font-size: 12px; color: var(--em-rust); }
    .em-error[hidden] { display: none; }

    .em-row { display: flex; gap: 8px; align-items: center; margin-top: 16px; }
    .em-submit, .em-cancel {
      margin: 0;
      padding: 8px 16px;
      border-radius: 6px;
      font: 600 13px/1.2 var(--em-sans);
      cursor: pointer;
    }
    .em-submit { background: var(--em-brass); color: #1d1704; border: 1px solid var(--em-brass); }
    .em-submit:hover { background: var(--em-brass-hi); }
    .em-submit:disabled { opacity: 0.6; cursor: progress; }
    .em-cancel { background: transparent; color: var(--em-lichen); border: 1px solid var(--em-line); font-weight: 400; }
    .em-cancel:hover { background: var(--em-ink-2); color: var(--em-chalk); }

    /* ── Area grid (the 3×3 around the character) ── */
    .em-area {
      display: grid;
      grid-template-columns: repeat(var(--em-cols, 3), 1fr);
      gap: 3px;
      padding: 3px;
      margin-bottom: 4px;
      background: var(--em-line);
      border-radius: 9px;
      overflow: hidden;
    }
    #em-modal.em-modal--wide { width: min(580px, 100%); }
    .em-cell { position: relative; margin: 0; aspect-ratio: 1; background: var(--em-ink-2); overflow: hidden; }
    .em-cell img { display: block; width: 100%; height: 100%; object-fit: cover; transition: opacity 0.2s; }
    .em-cell-empty { display: grid; place-items: center; height: 100%; font-size: 11px; color: var(--em-lichen); }
    .em-cell figcaption {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      padding: 12px 4px 3px;
      background: linear-gradient(transparent, rgba(10,18,20,0.88));
      font: 11px/1.2 var(--em-sans);
      font-variant-numeric: tabular-nums;
      text-align: center;
      color: var(--em-chalk);
    }
    .em-cell.is-detail { outline: 3px solid var(--em-brass); outline-offset: -3px; }
    .em-cell.is-detail figcaption { color: var(--em-brass-hi); font-weight: 600; }
    .em-cell::before { content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none; transition: background 0.2s; }
    .em-cell[data-state="saving"]::before { background: rgba(24,39,44,0.6); }
    .em-cell[data-state="saving"]::after {
      content: '';
      position: absolute;
      z-index: 2;
      left: 50%; top: 50%;
      width: 16px; height: 16px;
      margin: -8px 0 0 -8px;
      border: 2px solid var(--em-chalk);
      border-right-color: transparent;
      border-radius: 50%;
      animation: em-spin 0.8s linear infinite;
    }
    .em-cell[data-state="saved"]::before { background: rgba(127,191,138,0.22); box-shadow: inset 0 0 0 2px var(--em-moss); }
    .em-cell[data-state="failed"]::before { background: rgba(224,122,95,0.28); box-shadow: inset 0 0 0 2px var(--em-rust); }
    .em-cell[data-state="skipped"] img { opacity: 0.3; }
    .em-legend { margin: 6px 0 0; font-size: 11px; color: var(--em-lichen); }
    .em-legend b { color: var(--em-brass-hi); font-weight: 600; }

    /* ── Toast ── */
    .em-toast {
      position: fixed;
      right: 18px;
      bottom: 72px;
      z-index: 9999998;
      max-width: min(380px, calc(100vw - 36px));
      padding: 9px 14px;
      background: var(--em-ink);
      border: 1px solid var(--em-line);
      border-left: 3px solid var(--em-moss);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      transition: opacity 0.3s;
    }
    .em-toast--err { border-left-color: var(--em-rust); }

  `;
  document.head.appendChild(style);

  // ── Floating dock ──────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'em-bar';
  bar.className = 'em-ui';
  bar.innerHTML = `
    <button type="button" id="em-toolbox-btn" aria-expanded="false" aria-controls="em-toolbox-panel" title="Everborne Map tools">
      <span class="em-compass" aria-hidden="true"></span>
      <span id="em-pos"><span class="em-pos-label">Position unknown</span></span>
    </button>
    <div id="em-toolbox-panel" hidden>
      <div class="em-group">
        <div class="em-group-label">Map</div>
        <button type="button" class="em-item em-item--primary" id="em-save-btn">
          <span class="em-ico" aria-hidden="true">📍</span>
          <span><span class="em-item-label">Save area</span><small>Your 3×3, or the watchtower's 5×5 when open</small></span>
        </button>
        <button type="button" class="em-item" id="em-save-res-btn">
          <span class="em-ico" aria-hidden="true">🌿</span>
          <span><span class="em-item-label">Save gather</span><small>Open Gather or Wild Beasts first</small></span>
        </button>
        <button type="button" class="em-item" id="em-save-buildings-btn">
          <span class="em-ico" aria-hidden="true">🏘</span>
          <span><span class="em-item-label">Save buildings</span><small>Open the Buildings tab first</small></span>
        </button>
      </div>
      <div class="em-group">
        <div class="em-group-label">Warehouse</div>
        <button type="button" class="em-item" id="em-save-ledger-btn">
          <span class="em-ico" aria-hidden="true">📒</span>
          <span><span class="em-item-label">Save ledger</span><small>Open the Warehouse Ledger first</small></span>
        </button>
        <button type="button" class="em-item" id="em-save-stock-btn">
          <span class="em-ico" aria-hidden="true">📦</span>
          <span><span class="em-item-label">Save stock</span><small>Open the ledger's Inventory panel first</small></span>
        </button>
      </div>
      <div class="em-group">
        <div class="em-group-label">People</div>
        <button type="button" class="em-item" id="em-save-memory-btn">
          <span class="em-ico" aria-hidden="true">🧠</span>
          <span><span class="em-item-label">Save memory</span><small>Open the Memory window first</small></span>
        </button>
        <button type="button" class="em-item" id="em-chars-btn">
          <span class="em-ico" aria-hidden="true">👤</span>
          <span><span class="em-item-label">Save skills</span><small>Open the Skills window first</small></span>
        </button>
      </div>
      <div class="em-group em-footer">
        <button type="button" class="em-item" id="em-map-btn">Open map</button>
        <button type="button" class="em-item" id="em-cfg-btn">Settings</button>
      </div>
    </div>
  `;
  document.body.appendChild(bar);

  const toolboxBtn = document.getElementById('em-toolbox-btn');
  const toolboxPanel = document.getElementById('em-toolbox-panel');
  function setToolboxOpen(isOpen) {
    toolboxPanel.hidden = !isOpen;
    toolboxBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
  toolboxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setToolboxOpen(toolboxPanel.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target)) setToolboxOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    setToolboxOpen(false);
    overlay.hidden = true;
    cfgOverlay.hidden = true;
  });

  function setBusy(btn, busy) {
    btn.disabled = busy;
    btn.classList.toggle('is-busy', busy);
  }

  function createOverlay(id, modalId, html) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'em-ui em-overlay';
    el.hidden = true;
    el.innerHTML = `<div class="em-modal" id="${modalId}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(el);
    return el;
  }

  // ── Preview/confirm overlay ────────────────────────────────────────
  const overlay = createOverlay('em-overlay', 'em-modal', '');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });

  // ── Settings overlay ───────────────────────────────────────────────
  const cfgOverlay = createOverlay('em-cfg-overlay', 'em-cfg-modal', `
      <h2>Settings</h2>
      <p class="em-sub">Where saved tiles are sent.</p>
      <div class="em-field">
        <label for="em-cfg-server">Map server URL</label>
        <input id="em-cfg-server" type="text" placeholder="http://localhost:3000" autocomplete="off">
      </div>
      <div class="em-field">
        <label for="em-cfg-key">API key</label>
        <input id="em-cfg-key" type="password" placeholder="Paste your editor key" autocomplete="new-password">
      </div>
      <div class="em-row">
        <button type="button" class="em-submit" id="em-cfg-save">Save settings</button>
        <button type="button" class="em-cancel" id="em-cfg-cancel">Cancel</button>
      </div>
  `);

  const coordOverlay = createOverlay('em-coord-overlay', 'em-coord-modal', `
      <h2>Where are you?</h2>
      <p class="em-sub">The map isn't visible, so your position can't be read. Enter the coordinates of the tile to update.</p>
      <div class="em-pair">
        <div class="em-field">
          <label for="em-coord-x">X</label>
          <input id="em-coord-x" type="number" step="1" placeholder="123" autocomplete="off">
        </div>
        <div class="em-field">
          <label for="em-coord-y">Y</label>
          <input id="em-coord-y" type="number" step="1" placeholder="456" autocomplete="off">
        </div>
      </div>
      <div class="em-row">
        <button type="button" class="em-submit" id="em-coord-save">Use coordinates</button>
        <button type="button" class="em-cancel" id="em-coord-cancel">Cancel</button>
      </div>
  `);

  // ── Button handlers ────────────────────────────────────────────────
  document.getElementById('em-map-btn').addEventListener('click', () => {
    window.open(getServer(), '_blank');
  });

  document.getElementById('em-cfg-btn').addEventListener('click', () => {
    const cfgModal = document.getElementById('em-cfg-modal');
    cfgModal.style.cssText = '';
    cfgOverlay.style.alignItems = '';
    cfgOverlay.style.justifyContent = '';
    document.getElementById('em-cfg-server').value = getServer();
    document.getElementById('em-cfg-key').value = getApiKey();
    cfgOverlay.hidden = false;
    document.getElementById('em-cfg-server').focus();
  });

  document.getElementById('em-cfg-save').addEventListener('click', () => {
    const srv = document.getElementById('em-cfg-server').value.trim();
    const key = document.getElementById('em-cfg-key').value.trim();
    if (srv) setSetting('em_server', srv);
    if (key) setSetting('em_api_key', key);
    cfgOverlay.hidden = true;
    showToast('Settings saved.', 'ok');
  });
  document.getElementById('em-cfg-cancel').addEventListener('click', () => { cfgOverlay.hidden = true; });
  cfgOverlay.addEventListener('click', (e) => { if (e.target === cfgOverlay) cfgOverlay.hidden = true; });

  // ── Extraction ─────────────────────────────────────────────────────
  document.getElementById('em-save-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-btn');
    setBusy(saveBtn, true);

    try {
      const wtGrid = findWatchtowerGrid();
      showPreviewModal(await (wtGrid ? extractWatchtowerArea(wtGrid) : extractArea()));
      setToolboxOpen(false);
    } catch (err) {
      showToast('Couldn\'t read the map: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      setBusy(saveBtn, false);
    }
  });

  document.getElementById('em-save-res-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-res-btn');
    setBusy(saveBtn, true);

    try {
      let tileCoords = null;
      try {
        const { cx, cy } = getMapGridContext();
        tileCoords = { x: cx, y: cy };
      } catch (err) {
        tileCoords = await promptForTileCoordinates();
        if (!tileCoords) throw new Error('Coordinate entry cancelled.');
      }

      const loc = extractLocDescData();
      const resources = extractResourceSnapshotFromGatherModal();
      const beasts = extractWildBeastsFromModal();

      if (!resources.length && !beasts.length) {
        throw new Error('Open the Gather or Wild Beasts modal first.');
      }

      const uniqueResources = uniqueByName(resources);
      const uniqueBeasts = uniqueByName(beasts);

      const featureRows = [
        ...loc.features,
        ...uniqueResources.map((r) => ({
          name: `Resource: ${r.name}${r.biome ? ` (${r.biome})` : ''}`,
          description: [
            r.quality_label ? `Quality: ${r.quality_label}` : null,
            r.availability ? `Availability: ${r.availability}` : null,
          ].filter(Boolean).join(' | '),
        })),
        ...uniqueBeasts.map((b) => ({
          name: `Wild Beast: ${b.name}`,
          description: [
            b.diet ? `Diet: ${b.diet}` : null,
          ].filter(Boolean).join(' | '),
        })),
      ];

      const resourceTags = [
        ...uniqueResources.flatMap((r) => [r.name, r.biome]),
        ...uniqueBeasts.map((b) => b.name),
      ]
        .map(normalizeTag)
        .filter(Boolean);

      const payload = {
        x: tileCoords.x,
        y: tileCoords.y,
        city_name: loc.city_name,
        city_race: null,
        terrain_name: loc.terrain_name,
        terrain_description: loc.terrain_description,
        features: featureRows,
        resource_tags: [...new Set(resourceTags)],
        notes: '',
        image_base64: null,
        merge: true,
      };

      await postTile(payload);
      showToast(`Gather data saved for (${tileCoords.x}, ${tileCoords.y}).`, 'ok');
    } catch (err) {
      showToast('Gather save failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      setBusy(saveBtn, false);
    }
  });

  document.getElementById('em-save-ledger-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-ledger-btn');
    setBusy(saveBtn, true);

    try {
      const ledger = extractWarehouseLedgerFromModal();
      if (!ledger) throw new Error('Open the Warehouse Ledger modal first.');
      if (!ledger.entries.length) throw new Error('No ledger rows found to import.');

      // Best-effort only: a warehouse with a registered city doesn't need
      // tile coords to be identified, so don't block the save if this fails.
      let tileCoords = null;
      try {
        const { cx, cy } = getMapGridContext();
        tileCoords = { x: cx, y: cy };
      } catch (_) { /* no map grid visible right now — that's fine */ }

      const entriesWithLocation = tileCoords
        ? ledger.entries.map(e => ({ ...e, tile_x: tileCoords.x, tile_y: tileCoords.y }))
        : ledger.entries;

      const result = await gmJson('POST', '/api/ledger/import', { entries: entriesWithLocation });
      const skippedNote = ledger.skippedSelfUnresolved
        ? `, ${ledger.skippedSelfUnresolved} skipped (couldn't confirm your own name)`
        : '';
      showToast(`Ledger saved: ${result.inserted} new, ${result.skipped} already known${skippedNote}.`, 'ok');
    } catch (err) {
      showToast('Ledger save failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      setBusy(saveBtn, false);
    }
  });

  document.getElementById('em-save-stock-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-stock-btn');
    setBusy(saveBtn, true);

    try {
      const inventory = extractWarehouseInventoryFromModal();
      if (!inventory) throw new Error('Open the Warehouse Ledger modal first.');
      if (!inventory.items.length) throw new Error('No inventory items found — open the Inventory panel in the modal.');
      if (!inventory.warehouseName) throw new Error('Could not identify this warehouse.');

      let tileCoords = null;
      try {
        const { cx, cy } = getMapGridContext();
        tileCoords = { x: cx, y: cy };
      } catch (_) { /* no map grid visible right now — that's fine */ }

      const result = await gmJson('POST', '/api/warehouses/stock-snapshot', {
        warehouse_name: inventory.warehouseName,
        city_name: inventory.cityName,
        tile_x: tileCoords ? tileCoords.x : null,
        tile_y: tileCoords ? tileCoords.y : null,
        items: inventory.items,
      });
      showToast(`Stock saved: ${result.imported} item/quality row(s) synced.`, 'ok');
    } catch (err) {
      showToast('Stock save failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      setBusy(saveBtn, false);
    }
  });

  document.getElementById('em-save-buildings-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-buildings-btn');
    setBusy(saveBtn, true);

    try {
      const buildings = extractBuildingsFromPanel();
      if (!buildings) throw new Error('Open the Buildings tab first.');
      if (!buildings.length) throw new Error('No buildings found in the panel.');

      // Unlike the ledger/stock scrapers, there's no location info in this
      // panel at all — and the character/city panel it lives in replaces
      // the world map grid rather than overlaying it, so both are almost
      // never available at once. Three tiers: read the grid live if it's
      // there; otherwise fall back to the last position the background
      // poller saw (see refreshCachedPosition); otherwise ask by hand.
      let tileCoords = null;
      let source = 'live';
      try {
        const { cx, cy } = getMapGridContext();
        tileCoords = { x: cx, y: cy };
        refreshCachedPosition(); // we're right here — keep the cache fresh too
      } catch (err) {
        if (cachedPosition) {
          tileCoords = { x: cachedPosition.x, y: cachedPosition.y };
          source = `cached, ${cachedPositionAge()}`;
        } else {
          tileCoords = await promptForTileCoordinates();
          if (!tileCoords) throw new Error('Coordinate entry cancelled.');
          source = 'entered manually';
        }
      }

      const result = await postTile({
        x: tileCoords.x,
        y: tileCoords.y,
        buildings,
        merge: true,
      });
      showToast(`Buildings saved: ${buildings.length} found at (${tileCoords.x}, ${tileCoords.y}) [${source}].`, 'ok');
    } catch (err) {
      showToast('Buildings save failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      setBusy(saveBtn, false);
    }
  });

  document.getElementById('em-save-memory-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-memory-btn');
    setBusy(saveBtn, true);

    try {
      const entries = extractMemoryFromModal();
      if (!entries) throw new Error('Open the Memory modal first.');
      if (!entries.length) throw new Error('No remembered people found to import.');

      const result = await gmJson('POST', '/api/characters/memory/import', { entries });
      const collisionNote = result.collisions.length
        ? `, ${result.collisions.length} name(s) left for manual merge (shared by more than one person): ${result.collisions.join(', ')}`
        : '';
      showToast(
        `Memory saved: ${result.charactersCreated} new, ${result.charactersUpdated} updated, ${result.aliasesLinked} ledger name(s) auto-linked${collisionNote}.`,
        'ok'
      );
    } catch (err) {
      showToast('Memory save failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      setBusy(saveBtn, false);
    }
  });

  // Pulls the numeric tile id out of a decoded "<numericId>|<hash>" string —
  // or, since the game started prefixing it, "<prefix>:<numericId>|<hash>"
  // (e.g. "0:2135|228a2e9e..."). parseInt alone stops at the first ':' and
  // silently returns just the prefix, which is what broke world-position
  // detection: always take the last ':'-separated segment before the '|' so
  // both the old and new shapes resolve to the same numeric id.
  function parseNumericIdFromDecoded(decoded) {
    const idPart = decoded.split('|')[0];
    const idStr = idPart.includes(':') ? idPart.split(':').pop() : idPart;
    const id = parseInt(idStr, 10);
    return isNaN(id) ? null : id;
  }

  // Decode the numeric tile ID from a tile image src.
  // The src is /tile.php?id=<base64> where base64 decodes to "<numericId>|<hash>"
  // (see parseNumericIdFromDecoded for the "<prefix>:<numericId>|<hash>" case).
  // e.g. "MjI0NXw..." → "2245|60ec..." → 2245
  function decodeTileIdFromSrc(src) {
    try {
      const match = src.match(/[?&]id=([A-Za-z0-9+/=]+)/);
      if (!match) return null;
      return parseNumericIdFromDecoded(atob(match[1]));
    } catch (e) {
      return null;
    }
  }

  // First entry wins; names compared case-insensitively.
  function uniqueByName(list) {
    const byName = new Map();
    for (const item of list) {
      const key = String(item.name || '').trim().toLowerCase();
      if (key && !byName.has(key)) byName.set(key, item);
    }
    return [...byName.values()];
  }

  function normalizeTag(str) {
    return String(str || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function promptForTileCoordinates() {
    return new Promise((resolve) => {
      const xInput = document.getElementById('em-coord-x');
      const yInput = document.getElementById('em-coord-y');
      const saveBtn = document.getElementById('em-coord-save');
      const cancelBtn = document.getElementById('em-coord-cancel');
      const modal = document.getElementById('em-coord-modal');

      if (!xInput || !yInput || !saveBtn || !cancelBtn || !modal) {
        resolve(null);
        return;
      }

      coordOverlay.hidden = false;
      xInput.value = '';
      yInput.value = '';
      makeDraggable(modal, modal.querySelector('h2'));
      xInput.focus();

      const close = (result) => {
        coordOverlay.hidden = true;
        saveBtn.removeEventListener('click', onSave);
        cancelBtn.removeEventListener('click', onCancel);
        coordOverlay.removeEventListener('click', onBackdropClick);
        document.removeEventListener('keydown', onEscape);
        resolve(result);
      };

      const onSave = () => {
        const x = Number.parseInt(xInput.value, 10);
        const y = Number.parseInt(yInput.value, 10);
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          showToast('Enter valid integer coordinates.', 'err');
          return;
        }
        close({ x, y });
      };

      const onCancel = () => close(null);
      const onBackdropClick = (e) => { if (e.target === coordOverlay) close(null); };
      const onEscape = (e) => { if (e.key === 'Escape') close(null); };

      saveBtn.addEventListener('click', onSave);
      cancelBtn.addEventListener('click', onCancel);
      coordOverlay.addEventListener('click', onBackdropClick);
      document.addEventListener('keydown', onEscape);
    });
  }

  function getMapGridContext() {
    const GRID_COLS = 3;
    const CENTER_IDX = 4;

    const mapGrid = document.querySelector('.map-grid');
    if (!mapGrid) throw new Error('No map grid found on this page.');

    const tileWraps = Array.from(mapGrid.querySelectorAll('.tile-wrap'));
    if (tileWraps.length < 9) throw new Error(`Expected 9 tiles in the grid, found ${tileWraps.length}.`);

    const centerImg = tileWraps[CENTER_IDX].querySelector('.tile-img');
    if (!centerImg || !centerImg.src) throw new Error('Center tile has no image — cannot determine world position.');
    const centerId = decodeTileIdFromSrc(centerImg.src);
    if (!centerId) throw new Error('Could not decode world position from center tile image URL.');

    const bottomCenterImg = tileWraps[CENTER_IDX + GRID_COLS].querySelector('.tile-img');
    if (!bottomCenterImg || !bottomCenterImg.src) throw new Error('Bottom-center tile has no image — cannot determine world width.');
    const bottomCenterId = decodeTileIdFromSrc(bottomCenterImg.src);
    if (!bottomCenterId || bottomCenterId <= centerId) throw new Error('Could not determine world width from tile images.');

    const worldWidth = bottomCenterId - centerId;
    const cx = centerId % worldWidth;
    const cy = Math.floor(centerId / worldWidth);

    return { mapGrid, tileWraps, worldWidth, cx, cy };
  }

  // ── Cached position (background) ────────────────────────────────────
  // The character/city panel that hosts the Buildings tab replaces the
  // world map grid entirely rather than overlaying it, so by the time
  // that tab is open there's nothing left to read a tile position from.
  // Keep a lightweight, continuously-refreshed cache of the last known
  // position instead, so
  // Save Buildings doesn't need the map to be visible at the exact
  // moment it's clicked — just at some point recently.
  let cachedPosition = null; // { x, y, cachedAt }

  function refreshCachedPosition() {
    try {
      const { cx, cy } = getMapGridContext();
      cachedPosition = { x: cx, y: cy, cachedAt: Date.now() };
      // Only touch the DOM when the position actually changed.
      const posEl = document.getElementById('em-pos');
      const posText = `${cx}, ${cy}`;
      if (posEl && posEl.textContent !== posText) posEl.textContent = posText;
    } catch (_) {
      // Map grid not visible right now — leave whatever was cached before alone.
    }
  }

  function cachedPositionAge() {
    if (!cachedPosition) return '';
    const mins = Math.floor((Date.now() - cachedPosition.cachedAt) / 60000);
    if (mins < 1) return 'just now';
    if (mins === 1) return '1 minute ago';
    return `${mins} minutes ago`;
  }

  refreshCachedPosition();
  setInterval(refreshCachedPosition, 3000);

  function extractLocDescData() {
    const cityEl = document.querySelector('#locDesc h4');
    const city_name = cityEl ? cityEl.textContent.trim() : null;

    const terrainEl = document.querySelector('#locDesc h5');
    const terrain_name = terrainEl ? terrainEl.textContent.trim() : null;

    let terrain_description = null;
    const locDesc = document.getElementById('locDesc');
    if (locDesc) {
      const firstWell = locDesc.querySelector('.collapse .well.well-sm');
      if (firstWell) terrain_description = firstWell.textContent.trim();
    }

    const features = [];
    if (locDesc) {
      locDesc.querySelectorAll('ul > li').forEach(li => {
        const nameAnchor = li.querySelector('a');
        if (!nameAnchor) return;
        const name = nameAnchor.textContent.trim();
        let sibling = li.nextElementSibling;
        let description = '';
        while (sibling && !sibling.matches('li')) {
          const well = sibling.querySelector('.well.well-sm');
          if (well) { description = well.textContent.trim(); break; }
          sibling = sibling.nextElementSibling;
        }
        if (name) features.push({ name, description });
      });
    }

    return { city_name, terrain_name, terrain_description, features };
  }

  function findVisibleModalContent(selector) {
    const nodes = Array.from(document.querySelectorAll(selector));
    for (let i = nodes.length - 1; i >= 0; i--) {
      const el = nodes[i];
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (el.closest('.modal') && !el.closest('.modal').classList.contains('show')) continue;
      return el;
    }
    return null;
  }

  function nearestGatherBiome(row) {
    let node = row.previousElementSibling;
    while (node) {
      if (node.classList && node.classList.contains('gather-biome-heading')) {
        const txt = node.textContent.trim();
        if (txt) return txt;
      }
      node = node.previousElementSibling;
    }
    return null;
  }

  function extractResourceSnapshotFromGatherModal() {
    const modal = findVisibleModalContent('.gather-modal, .modal-content.gather-modal');
    if (!modal) return [];

    const rows = Array.from(modal.querySelectorAll('.modal-body .row'));
    const out = [];

    for (const row of rows) {
      const name = row.querySelector('.col-6 b')?.textContent.trim();
      // Only gatherable rows carry a quantity input; that's what marks them.
      if (!name || !row.querySelector('.col-3 input[type="number"]')) continue;

      const infoSmall = row.querySelector('.col-6 small');
      const infoLines = infoSmall
        ? infoSmall.innerHTML
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
        : [];

      out.push({
        name,
        biome: nearestGatherBiome(row),
        quality_label: infoLines.find(l => /quality/i.test(l)) || null,
        availability: infoLines.find(l => /(abundant|common|uncommon|rare|scarce|depleted)/i.test(l)) || null,
      });
    }

    return out;
  }

  function extractWildBeastsFromModal() {
    const modal = findVisibleModalContent('#wildAnimalModalRoot .modal-content, .modal-content[data-help="modal.animalUpdate.content"]');
    if (!modal) return [];

    const rows = Array.from(modal.querySelectorAll('.wild-animal-row'));
    const out = [];

    for (const row of rows) {
      const titleRaw = row.querySelector('.wild-animal-title')?.textContent || '';
      const name = titleRaw.replace(/^[^A-Za-z0-9]+/, '').trim();
      if (!name) continue;

      out.push({
        name,
        diet: row.querySelector('.wild-animal-diet-copy')?.textContent.trim() || null,
      });
    }

    return out;
  }

  // ── Warehouse ledger ─────────────────────────────────────────────────
  // The ledger's "Who" column shows whoever moved a ware under whatever
  // name the game displays to the CURRENT viewer: a real registered
  // nickname (data-nickname, e.g. "thud"), a generic physical description
  // when the viewer doesn't know them yet ("tall adult skorn" — genuinely
  // anonymous, not just a display quirk), or the literal "you" for the
  // viewer's own moves. "you" is meaningless once this data leaves the
  // browser (whose "you"?), so it's resolved to the parser's own character
  // name — via extractCharacterName() — before anything is sent to the
  // server. Rows we can't confidently attribute are skipped rather than
  // guessed at.
  // Shared by the ledger and inventory scrapers below — both live inside
  // the same #warehouseLedgerModal, identified the same way.
  function extractWarehouseIdentity(modal) {
    const warehouseName = modal.querySelector('.modal-title')?.textContent.trim() || null;

    // Summary block's second line reads either "No city registered" or the city name.
    const summaryCityEl = modal.querySelector('.warehouse-ledger-summary .text-muted');
    let cityName = summaryCityEl ? summaryCityEl.textContent.trim() : null;
    if (cityName && /no city registered/i.test(cityName)) cityName = null;

    return { warehouseName, cityName };
  }

  function extractWarehouseLedgerFromModal() {
    const modal = findVisibleModalContent('#warehouseLedgerModal');
    if (!modal) return null;

    const { warehouseName, cityName } = extractWarehouseIdentity(modal);

    const rows = Array.from(modal.querySelectorAll('#warehouse-ledger-body tr[data-created]'));
    const entries = [];
    let skippedSelfUnresolved = 0;
    let selfName = null;

    for (const row of rows) {
      const cells = row.querySelectorAll('td');
      if (cells.length < 6) continue;

      const occurredAt = row.getAttribute('data-created');
      let mover = String(row.getAttribute('data-nickname') || '').trim().toLowerCase();
      const gameTime = cells[0].textContent.trim();
      const flow = cells[2].textContent.trim().toLowerCase();
      const itemCell = cells[3];
      const quantity = Number(cells[4].textContent.trim());
      const reason = cells[5].textContent.trim();
      if (!mover || !occurredAt || !Number.isFinite(quantity)) continue;

      // Item name sits before the trailing "<small><i class="fa-solid fa-gem"></i>N</small>" quality badge.
      const qualitySmall = itemCell.querySelector('small');
      let quality = null;
      let item = itemCell.textContent.trim();
      if (qualitySmall) {
        const qn = Number(qualitySmall.textContent.trim());
        quality = Number.isFinite(qn) ? qn : null;
        item = itemCell.textContent.replace(qualitySmall.textContent, '').trim();
      }
      if (!item) continue;

      if (mover === 'you') {
        if (selfName === null) selfName = extractCharacterName() || '';
        if (!selfName) { skippedSelfUnresolved += 1; continue; }
        mover = selfName.trim().toLowerCase();
      }

      entries.push({
        mover,
        item,
        quality,
        quantity,
        direction: flow === 'in' ? 'in' : 'out',
        reason,
        warehouse_name: warehouseName,
        city_name: cityName,
        game_time: gameTime,
        occurred_at: occurredAt,
      });
    }

    return { warehouseName, cityName, entries, skippedSelfUnresolved };
  }

  // ── Warehouse inventory (real, scanned quantities) ─────────────────────
  // A separate panel inside the same #warehouseLedgerModal — grouped by
  // item name, each group expandable into its quality tiers. This is the
  // game's own count, distinct from (and a check against) the ledger-log-
  // derived estimate: "52 Black Shroomhound Fur" broken into per-quality
  // rows ("Quality 41 → 9", "Quality 39 → 8", ...) summing back to 52.
  function extractWarehouseInventoryFromModal() {
    const modal = findVisibleModalContent('#warehouseLedgerModal');
    if (!modal) return null;

    const { warehouseName, cityName } = extractWarehouseIdentity(modal);

    const groups = Array.from(modal.querySelectorAll('#warehouse-inventory-groups .warehouse-ledger-group'));
    const items = [];

    for (const group of groups) {
      const nameSpan = group.querySelector('button .d-flex > span:first-child');
      if (!nameSpan) continue;
      // The button label is "<total qty> <item name>" — strip the leading count.
      const match = /^\s*\d+\s+(.+)$/.exec(nameSpan.textContent.trim());
      const name = (match ? match[1] : nameSpan.textContent).trim();
      if (!name) continue;

      const qualityRows = Array.from(group.querySelectorAll('.warehouse-ledger-quality-list > div'));
      for (const row of qualityRows) {
        const spans = row.querySelectorAll('span');
        if (spans.length < 2) continue;
        const qualityMatch = /Quality\s*(\d+)/.exec(spans[0].textContent);
        const quality = qualityMatch ? Number(qualityMatch[1]) : null;
        const quantity = Number(spans[1].textContent.trim());
        if (!Number.isFinite(quantity)) continue;
        items.push({ item: name, quality, quantity });
      }
    }

    return { warehouseName, cityName, items };
  }

  // ── City buildings panel ────────────────────────────────────────────────
  // The character/city overview's "Buildings" tab (#bList) — a flat list of
  // rows grouped visually under collapsible district headers, but the
  // districts carry no data we currently track, so this just flattens every
  // row into {name, type, description}, the same shape as a hand-entered
  // tile building. This panel has no location info of its own — the save
  // handler below attaches it to whichever tile the world map currently has
  // centered, so the character needs to be standing at (or the map centered
  // on) the right city when this is used.
  function extractBuildingsFromPanel() {
    const list = document.getElementById('bList');
    if (!list) return null;

    const buildings = [];
    const rows = Array.from(list.querySelectorAll('.tab-list-row-building'));
    for (const row of rows) {
      const nameLink = row.querySelector('.tab-col-name a');
      const name = nameLink ? nameLink.textContent.trim() : '';
      if (!name) continue;
      const type = (row.querySelector('.tab-col-type')?.textContent || '').trim();
      const description = (row.querySelector('.collapse.col-12 p')?.textContent || '').trim();
      buildings.push({ name, type, description });
    }
    return buildings;
  }

  // ── Memory modal ──────────────────────────────────────────────────────
  // Each remembered person is one .mem-item button carrying the game's own
  // identity data: data-target-id (a stable id — except for the "self"
  // entry, where every character's own memory book reuses 0 as a sentinel),
  // data-origin ("self" vs "nickname"), data-name, and data-subdesc (their
  // species/type). Only "person" entries are relevant here — "place" memory
  // entries carry no identity to cross-reference against the ledger.
  function extractMemoryFromModal() {
    const modal = findVisibleModalContent('#memoryModalRoot .modal-content, .modal-content[data-help="modal.memory.content"]');
    if (!modal) return null;

    const items = Array.from(modal.querySelectorAll('.mem-item[data-type="person"]'));
    const entries = [];
    for (const item of items) {
      const name = String(item.dataset.name || '').trim();
      if (!name) continue;
      entries.push({
        name,
        origin: item.dataset.origin === 'self' ? 'self' : 'nickname',
        targetId: Number(item.dataset.targetId),
        subdesc: String(item.dataset.subdesc || '').trim(),
        type: 'person',
      });
    }
    return entries;
  }

  async function extractArea() {
    // The game renders a 3×3 grid of tiles around the character:
    //
    //   index 0 | index 1 | index 2   ← top row    (dy = -1)
    //   index 3 | index 4 | index 5   ← middle row  (dy =  0)  ← character here
    //   index 6 | index 7 | index 8   ← bottom row  (dy = +1)
    //
    // mapUpdate(n, charId) uses n=1..9 as slot numbers, NOT world coordinates.
    // World coordinates are encoded in each tile's image URL as base64.
    //
    // Strategy:
    //   1. The character is always at index 4 (center). Decode its tile ID → (cx, cy).
    //   2. World width  = bottomCenter_id (index 7) − center_id (index 4).
    //      (tiles in the same column differ by exactly worldWidth in their ID)
    //   3. Tile i's world pos = (cx + dx, cy + dy) where
    //      dx = (i % 3) − 1,  dy = floor(i / 3) − 1.
    //
    // All 9 tile images are saved at once. The #locDesc text (terrain,
    // features, …) describes the selected tile, so the editable details are
    // attached to that one tile only — the center if nothing is selected.

    const GRID_COLS = 3;
    const { tileWraps, cx, cy } = getMapGridContext();
    const selectedIdx = tileWraps.findIndex(w => w.classList.contains('is-selected'));
    const detailIdx = selectedIdx >= 0 && selectedIdx < 9 ? selectedIdx : 4;

    const tiles = await Promise.all(tileWraps.slice(0, 9).map(async (wrap, idx) => {
      const imgEl = wrap.querySelector('.tile-img');
      let imageBase64 = null;
      if (imgEl && imgEl.src) {
        try {
          imageBase64 = await fetchImageAsBase64(imgEl.src);
        } catch (e) {
          console.warn('[EverborneMap] Could not fetch tile image:', e);
        }
      }
      return {
        x: cx + (idx % GRID_COLS) - 1,
        y: cy + Math.floor(idx / GRID_COLS) - 1,
        imageBase64,
        isCenter: idx === 4,
        isDetail: idx === detailIdx,
      };
    }));

    return { title: 'Save area', centerLabel: 'You', center: { x: cx, y: cy }, tiles, ...extractLocDescData() };
  }

  function fetchImageAsBase64(src) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: src,
        responseType: 'arraybuffer',
        onload(response) {
          if (response.status < 200 || response.status >= 300) {
            return reject(new Error(`Image fetch HTTP ${response.status}`));
          }
          const arr = new Uint8Array(response.response);
          let binary = '';
          arr.forEach(b => { binary += String.fromCharCode(b); });
          resolve('data:image/jpeg;base64,' + btoa(binary));
        },
        onerror(err) { reject(new Error('Network error fetching image')); },
      });
    });
  }

  // ── Preview modal ──────────────────────────────────────────────────
  // data: { center, centerLabel, title, tiles: [{ x, y, imageBase64, isCenter, isDetail }], city_name, … }
  // tiles is a square grid in reading order (3×3 map or 5×5 watchtower).
  // One tile (isDetail) gets the editable fields; every other tile is sent
  // image-only with merge=true, so existing server data on it is kept.
  // Neighbours without an image are skipped rather than saved as blank tiles.
  function showPreviewModal(data) {
    const modal = document.getElementById('em-modal');
    const detail = data.tiles.find(t => t.isDetail);
    const cols = Math.round(Math.sqrt(data.tiles.length));
    const sendable = (t) => t.isDetail || t.imageBase64;

    // Reset any previously applied drag position
    modal.style.cssText = '';
    overlay.style.alignItems = '';
    overlay.style.justifyContent = '';
    modal.classList.toggle('em-modal--wide', cols > 3);

    const cells = data.tiles.map((t, i) => `
      <figure class="em-cell${t.isDetail ? ' is-detail' : ''}" data-i="${i}"${sendable(t) ? '' : ' data-state="skipped"'}>
        ${t.imageBase64
          ? `<img src="${escapeHtml(t.imageBase64)}" alt="">`
          : '<div class="em-cell-empty">No image</div>'}
        <figcaption>${t.isCenter ? `${data.centerLabel} · ` : ''}${t.x}, ${t.y}</figcaption>
      </figure>`).join('');

    const count = data.tiles.filter(sendable).length;

    modal.innerHTML = `
      <h2>${data.title} around ${data.center.x}, ${data.center.y}</h2>
      <p class="em-sub">Saves the image of every tile below. The details go to the outlined tile.</p>

      <div class="em-area" style="--em-cols: ${cols}">${cells}</div>
      ${data.tiles.some(t => !sendable(t))
        ? '<p class="em-legend">Faded tiles have no image and will be skipped.</p>'
        : ''}

      <h3>Details for ${detail.x}, ${detail.y}</h3>
      <div class="em-pair">
        <div class="em-field">
          <label for="em-p-city">City name</label>
          <input id="em-p-city" type="text" value="${escapeHtml(data.city_name || '')}" autocomplete="off">
        </div>
        <div class="em-field">
          <label for="em-p-race">City race or faction</label>
          <input id="em-p-race" type="text" value="" autocomplete="off">
        </div>
      </div>
      <div class="em-field">
        <label for="em-p-terrain">Terrain</label>
        <input id="em-p-terrain" type="text" value="${escapeHtml(data.terrain_name || '')}" autocomplete="off">
      </div>
      <div class="em-field">
        <label for="em-p-terrain-desc">Terrain description</label>
        <textarea id="em-p-terrain-desc" rows="2" autocomplete="off">${escapeHtml(data.terrain_description || '')}</textarea>
      </div>

      ${data.features.length ? `
        <h3>Features (${data.features.length})</h3>
        <ul class="em-features">
          ${data.features.map(f => `<li><strong>${escapeHtml(f.name)}</strong>${f.description ? ': ' + escapeHtml(f.description) : ''}</li>`).join('')}
        </ul>` : ''}

      <div class="em-field">
        <label for="em-p-tags">Resource tags, comma-separated</label>
        <input id="em-p-tags" type="text" placeholder="wood, fish, stone" autocomplete="off">
      </div>
      <div class="em-field">
        <label for="em-p-notes">Notes</label>
        <textarea id="em-p-notes" rows="2" placeholder="Anything worth remembering about this place" autocomplete="off"></textarea>
      </div>

      <div id="em-p-error" class="em-error" role="alert" hidden></div>

      <div class="em-row">
        <button type="button" class="em-submit" id="em-p-confirm">Save ${count} tiles</button>
        <button type="button" class="em-cancel" id="em-p-cancel">Cancel</button>
      </div>
    `;

    overlay.hidden = false;
    makeDraggable(modal, modal.querySelector('h2'));
    document.getElementById('em-p-city').focus();

    document.getElementById('em-p-cancel').addEventListener('click', () => { overlay.hidden = true; });

    const cellEl = (i) => modal.querySelector(`.em-cell[data-i="${i}"]`);

    document.getElementById('em-p-confirm').addEventListener('click', async () => {
      const confirmBtn = document.getElementById('em-p-confirm');
      const errEl = document.getElementById('em-p-error');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Saving…';
      errEl.hidden = true;

      const tagRaw = document.getElementById('em-p-tags').value;
      const detailPayload = {
        city_name: document.getElementById('em-p-city').value.trim() || null,
        city_race: document.getElementById('em-p-race').value.trim() || null,
        terrain_name: document.getElementById('em-p-terrain').value.trim() || null,
        terrain_description: document.getElementById('em-p-terrain-desc').value.trim() || null,
        features: data.features,
        resource_tags: tagRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
        notes: document.getElementById('em-p-notes').value,
      };

      // Only (re)send tiles that aren't saved yet, so a retry after a
      // partial failure doesn't post the successful ones twice.
      const pending = data.tiles
        .map((t, i) => i)
        .filter(i => !['saved', 'skipped'].includes(cellEl(i).dataset.state));
      pending.forEach(i => { cellEl(i).dataset.state = 'saving'; });

      const results = await Promise.allSettled(pending.map(i => {
        const t = data.tiles[i];
        return postTile({
          x: t.x,
          y: t.y,
          ...(t.isDetail ? detailPayload : {}),
          image_base64: t.imageBase64 || null,
          merge: true,
        });
      }));

      const failures = [];
      results.forEach((r, k) => {
        const cell = cellEl(pending[k]);
        cell.dataset.state = r.status === 'fulfilled' ? 'saved' : 'failed';
        if (r.status === 'rejected') {
          cell.title = r.reason.message;
          failures.push(r.reason.message);
        }
      });

      if (!failures.length) {
        overlay.hidden = true;
        showToast(`Saved ${count} tiles around ${data.center.x}, ${data.center.y}.`, 'ok');
        return;
      }

      errEl.textContent = `${failures.length} of ${pending.length} tiles failed: ${failures[0]}`;
      errEl.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = failures.length === 1 ? 'Retry failed tile' : 'Retry failed tiles';
    });
  }

  // ── Map server requests ────────────────────────────────────────────
  function gmJson(method, path, body) {
    return new Promise((resolve, reject) => {
      const key = getApiKey();
      if (!key) return reject(new Error('No API key set. Open Settings to add it.'));

      GM_xmlhttpRequest({
        method,
        url: `${getServer()}${path}`,
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        data: body === undefined ? undefined : JSON.stringify(body),
        onload(response) {
          if (response.status === 401) return reject(new Error('Invalid API key.'));
          if (response.status < 200 || response.status >= 300) {
            let msg = `Server error (${response.status})`;
            try { msg = JSON.parse(response.responseText).error || msg; } catch {}
            return reject(new Error(msg));
          }
          try { resolve(JSON.parse(response.responseText)); } catch { reject(new Error('Invalid server response')); }
        },
        onerror() { reject(new Error('Could not reach map server. Is it running?')); },
      });
    });
  }
  const postTile = (payload) => gmJson('POST', '/api/tiles', payload);

  // ── Watchtower (lookout) support ────────────────────────────────────
  // The grid's tile buttons used to carry a decodable data-tile-obf id
  // ("<id>|<hash>", same scheme as the main map), which let every tile's
  // world position be computed directly. The game has since replaced that
  // with an opaque, per-session data-watchtower-token that encodes nothing
  // positional at all — so per-tile id decoding is gone for good here.
  //
  // What's still true: the grid is always a fixed 5×5 layout centered on
  // the watchtower's own tile (button index 12, labeled "Watchtower"), in
  // fixed row-major reading order — verified against a live capture, every
  // compass label ("Far Northwest", "North", …) lines up with a fixed
  // (dx, dy) offset from center. So instead of decoding each tile, we only
  // need to learn the ONE anchor point (the watchtower's own position) and
  // derive every other tile from that fixed offset table.
  const WT_GRID_COLS = 5;
  const WT_CENTER_OFFSET = Math.floor(WT_GRID_COLS / 2);
  const WT_CENTER_IDX = WT_CENTER_OFFSET * WT_GRID_COLS + WT_CENTER_OFFSET;

  // Same three-tier fallback as Save Buildings: read the live map grid if
  // it's there, fall back to the background-cached last known position,
  // and only prompt by hand if neither is available.
  async function resolveWatchtowerAnchor() {
    try {
      const { cx, cy } = getMapGridContext();
      refreshCachedPosition();
      return { x: cx, y: cy };
    } catch (err) {
      if (cachedPosition) return { x: cachedPosition.x, y: cachedPosition.y };
      const coords = await promptForTileCoordinates();
      if (!coords) throw new Error('Coordinate entry cancelled.');
      return coords;
    }
  }

  // The open watchtower's 5×5 grid, or null when no watchtower is showing.
  function findWatchtowerGrid() {
    const content = findVisibleModalContent('[data-help="modal.watchtower.content"]');
    const grid = content && content.querySelector('.wt-grid');
    return grid && grid.querySelectorAll('.wt-tile-btn').length === WT_GRID_COLS * WT_GRID_COLS ? grid : null;
  }

  // Same shape as extractArea(), for the 5×5 watchtower view. The tile you
  // clicked in the watchtower gets the details; the tower's own tile if none.
  async function extractWatchtowerArea(grid) {
    const anchor = await resolveWatchtowerAnchor();
    const buttons = Array.from(grid.querySelectorAll('.wt-tile-btn'));
    const selectedIdx = buttons.findIndex(b => b.classList.contains('is-selected') || b.getAttribute('aria-pressed') === 'true');
    const detailIdx = selectedIdx >= 0 ? selectedIdx : WT_CENTER_IDX;

    const tiles = await Promise.all(buttons.map(async (btn, i) => {
      const imgEl = btn.querySelector('img');
      let imageBase64 = null;
      if (imgEl && imgEl.src) {
        try { imageBase64 = await fetchImageAsBase64(imgEl.src); } catch {}
      }
      return {
        x: anchor.x + (i % WT_GRID_COLS) - WT_CENTER_OFFSET,
        y: anchor.y + Math.floor(i / WT_GRID_COLS) - WT_CENTER_OFFSET,
        imageBase64,
        isCenter: i === WT_CENTER_IDX,
        isDetail: i === detailIdx,
      };
    }));

    return {
      title: 'Save watchtower view',
      centerLabel: 'Tower',
      center: anchor,
      tiles,
      city_name: null,
      terrain_name: null,
      terrain_description: null,
      features: [],
    };
  }

  // ── Draggable modals ───────────────────────────────────────────────
  function makeDraggable(modal, handle) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = modal.getBoundingClientRect();
      modal.style.position = 'fixed';
      modal.style.margin = '0';
      modal.style.left = rect.left + 'px';
      modal.style.top = rect.top + 'px';
      modal.parentElement.style.alignItems = 'flex-start';
      modal.parentElement.style.justifyContent = 'flex-start';

      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = rect.left;
      const startTop = rect.top;

      handle.style.cursor = 'grabbing';

      function onMouseMove(e) {
        modal.style.left = (startLeft + e.clientX - startX) + 'px';
        modal.style.top  = (startTop  + e.clientY - startY) + 'px';
      }
      function onMouseUp() {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  makeDraggable(
    document.getElementById('em-cfg-modal'),
    document.querySelector('#em-cfg-modal h2')
  );

  // ── Save skills ────────────────────────────────────────────────────
  // Editing characters by hand lives in the web viewer; this only syncs the
  // open Skills window. The server overwrites player/notes on update, so
  // they're carried over from the existing record.
  document.getElementById('em-chars-btn').addEventListener('click', async () => {
    const btn = document.getElementById('em-chars-btn');
    setBusy(btn, true);
    try {
      const skills = extractSkillsFromPage();
      if (!skills.length) throw new Error('Open your Skills window first.');
      const name = extractCharacterName();
      if (!name) throw new Error('Could not read your character name.');

      const chars = await gmJson('GET', '/api/characters');
      const existing = chars.find(c => c.name.toLowerCase() === name.toLowerCase());
      await gmJson('POST', '/api/characters', {
        id: existing?.id,
        name,
        player: existing?.player ?? null,
        notes: existing?.notes ?? '',
        skills,
      });
      showToast(`Saved ${skills.length} skills for ${name}.`, 'ok');
    } catch (err) {
      showToast('Skills save failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      setBusy(btn, false);
    }
  });

  // ── Extract character name from the game page ──────────────────────
  function extractCharacterName() {
    // Primary: status panel header (<h4 data-help="status.name"><span>Name</span></h4>)
    const statusNameEl = document.querySelector('[data-help="status.name"] span');
    if (statusNameEl) {
      const txt = statusNameEl.textContent.trim();
      if (txt) return txt;
    }
    // Fallbacks for other layouts
    const FALLBACKS = [
      '[data-help*="char.name"]',
      '#charName',
      '#playerName',
      '#characterName',
      '.char-name',
      '.character-name',
    ];
    for (const sel of FALLBACKS) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const txt = el.textContent.trim();
          if (txt) return txt;
        }
      } catch {}
    }
    return '';
  }

  // ── Extract skills from the open game skills modal ─────────────────
  function extractSkillsFromPage() {
    // The skills modal uses .js-skill-live-card for each skill row.
    // Also search inside any visible Bootstrap modal in case multiple exist.
    const cards = document.querySelectorAll('.js-skill-live-card');
    const skills = [];
    for (const card of cards) {
      const name  = card.querySelector('.study-skill-card__name-text')?.textContent.trim();
      const level = parseInt(card.querySelector('.js-skill-level')?.textContent.trim() || '0', 10);
      const title = card.querySelector('.js-skill-title')?.textContent.trim() || '';
      if (!name) continue;
      // Skip untrained skills (level 0) to keep the list clean; adjust if you want all
      if (level === 0) continue;
      skills.push({ name, level, description: title });
    }
    return skills;
  }

  // ── Toast ──────────────────────────────────────────────────────────
  function showToast(msg, type = 'ok') {
    const toast = document.createElement('div');
    toast.className = `em-ui em-toast em-toast--${type}`;
    toast.setAttribute('role', type === 'err' ? 'alert' : 'status');
    toast.textContent = msg;
    document.body.appendChild(toast);
    // Long messages (e.g. memory-import collisions) need time to be read.
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 350);
    }, Math.min(9000, 2500 + msg.length * 40));
  }

  // ── Sanitize helpers (prevent XSS in generated HTML) ──────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

})();
