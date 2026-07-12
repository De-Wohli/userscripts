// ==UserScript==
// @name         Everborne Map Scraper
// @namespace    https://github.com/everborne-map
// @version      1.8.0
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
    #em-bar {
      position: fixed;
      bottom: 18px;
      right: 18px;
      z-index: 999999;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      font-family: 'Segoe UI', system-ui, sans-serif;
    }
    .em-btn {
      padding: 6px 14px;
      border-radius: 5px;
      border: none;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.5);
      transition: opacity 0.15s;
      white-space: nowrap;
    }
    .em-btn:hover { opacity: 0.88; }
    .em-btn--save { background: #c8902a; color: #fff; }
    .em-btn--map  { background: #1e2535; color: #e8dcc8; border: 1px solid rgba(255,255,255,0.15); }
    .em-btn--cfg  { background: #1e2535; color: #8a9ab8; border: 1px solid rgba(255,255,255,0.10); font-size: 12px; padding: 4px 10px; }
    .em-btn--chars { background: #1e2535; color: #e8dcc8; border: 1px solid rgba(255,255,255,0.15); }
    .em-btn--gather { background: #1e2535; color: #b2d5a7; border: 1px solid rgba(178,213,167,0.35); }
    .em-btn--ledger { background: #1e2535; color: #7fb0e0; border: 1px solid rgba(127,176,224,0.35); }
    .em-btn--memory { background: #1e2535; color: #c99fe0; border: 1px solid rgba(201,159,224,0.35); }
    .em-btn--toolbox { background: #2a3448; color: #f0dfbf; border: 1px solid rgba(240,223,191,0.28); }
    .em-btn--chars.has-skills { background: #1a2e1a; color: #7ec87e; border: 1px solid rgba(80,200,80,0.30); }
    #em-toolbox-panel {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      background: rgba(20,26,38,0.92);
      border: 1px solid rgba(255,255,255,0.13);
      border-radius: 8px;
      box-shadow: 0 8px 18px rgba(0,0,0,0.38);
    }
    #em-toolbox-panel[hidden] { display: none; }

    #em-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.72);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #em-overlay[hidden] { display: none; }
    #em-modal {
      background: #171c27;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      width: min(440px, 96vw);
      max-height: 90vh;
      overflow-y: auto;
      color: #e8dcc8;
      font-family: 'Segoe UI', system-ui, sans-serif;
      padding: 20px;
    }
    #em-modal h2 { font-size: 16px; margin-bottom: 14px; color: #c8902a; cursor: grab; user-select: none; }
    #em-modal h2:active { cursor: grabbing; }
    #em-modal h3 { font-size: 13px; color: #8a9ab8; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; }
    .em-field { margin-bottom: 10px; }
    .em-field label { display: block; font-size: 12px; color: #8a9ab8; margin-bottom: 3px; }
    .em-field input, .em-field textarea {
      width: 100%;
      background: #1e2535;
      border: 1px solid rgba(255,255,255,0.12);
      color: #e8dcc8;
      border-radius: 4px;
      padding: 5px 9px;
      font-size: 13px;
      font-family: inherit;
    }
    .em-field textarea { resize: vertical; min-height: 54px; }
    .em-field input:focus, .em-field textarea:focus { outline: none; border-color: #c8902a; }
    .em-preview-img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 4px;
      margin-bottom: 10px;
      display: block;
    }
    .em-row { display: flex; gap: 8px; margin-top: 14px; }
    .em-submit { background: #c8902a; color: #fff; border: none; border-radius: 4px; padding: 7px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
    .em-submit:hover { background: #e0a83a; }
    .em-cancel { background: transparent; border: 1px solid rgba(255,255,255,0.15); color: #8a9ab8; border-radius: 4px; padding: 7px 14px; font-size: 13px; cursor: pointer; }
    .em-cancel:hover { background: rgba(255,255,255,0.06); }
    .em-toast {
      position: fixed;
      bottom: 80px;
      right: 18px;
      background: #1e2535;
      border: 1px solid rgba(255,255,255,0.15);
      color: #e8dcc8;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      z-index: 9999998;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      transition: opacity 0.3s;
    }
    .em-toast--ok   { border-color: #c8902a; color: #c8902a; }
    .em-toast--err  { border-color: #c0392b; color: #f08080; }

    .em-wt-save {
      position: absolute;
      top: 3px;
      right: 3px;
      background: rgba(200,144,42,0.88);
      border: none;
      border-radius: 3px;
      color: #fff;
      font-size: 11px;
      padding: 1px 5px;
      cursor: pointer;
      z-index: 10;
      line-height: 1.5;
      opacity: 0;
      transition: opacity 0.15s;
      pointer-events: auto;
    }
    .wt-tile-btn:hover .em-wt-save { opacity: 1; }
    .em-wt-save:hover { background: rgba(224,168,58,1) !important; opacity: 1 !important; }
    .em-wt-save:disabled { opacity: 0.45 !important; cursor: default; }

    #em-cfg-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.72);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #em-cfg-overlay[hidden] { display: none; }
    #em-cfg-modal {
      background: #171c27;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      width: min(360px, 96vw);
      color: #e8dcc8;
      font-family: 'Segoe UI', system-ui, sans-serif;
      padding: 20px;
    }
    #em-cfg-modal h2 { font-size: 15px; margin-bottom: 14px; color: #8a9ab8; cursor: grab; user-select: none; }
    #em-cfg-modal h2:active { cursor: grabbing; }

    #em-coord-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.72);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #em-coord-overlay[hidden] { display: none; }
    #em-coord-modal {
      background: #171c27;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      width: min(360px, 96vw);
      color: #e8dcc8;
      font-family: 'Segoe UI', system-ui, sans-serif;
      padding: 20px;
    }
    #em-coord-modal h2 { font-size: 15px; margin-bottom: 14px; color: #b2d5a7; cursor: grab; user-select: none; }
    #em-coord-modal h2:active { cursor: grabbing; }

    #em-chars-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.72);
      z-index: 9999999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #em-chars-overlay[hidden] { display: none; }
    #em-chars-modal {
      background: #171c27;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 8px;
      width: min(500px, 96vw);
      max-height: 85vh;
      overflow-y: auto;
      color: #e8dcc8;
      font-family: 'Segoe UI', system-ui, sans-serif;
      padding: 20px;
    }
    #em-chars-modal h2 { font-size: 16px; margin-bottom: 14px; color: #c8902a; cursor: grab; user-select: none; }
    #em-chars-modal h2:active { cursor: grabbing; }
    .em-chars-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #1e2535;
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 4px;
      padding: 7px 10px;
      cursor: pointer;
      transition: background 0.12s;
      margin-bottom: 4px;
    }
    .em-chars-item:hover { background: #252d3e; }
    .em-skill-row {
      display: flex;
      gap: 4px;
      margin-bottom: 5px;
      align-items: flex-start;
    }
    .em-skill-input {
      background: #1e2535;
      border: 1px solid rgba(255,255,255,0.12);
      color: #e8dcc8;
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 12px;
      font-family: inherit;
    }
    .em-skill-input:focus { outline: none; border-color: #c8902a; }
    .em-skill-del {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.12);
      color: #5a6880;
      border-radius: 4px;
      padding: 3px 7px;
      cursor: pointer;
      font-size: 13px;
    }
    .em-skill-del:hover { color: #c0392b; }
  `;
  document.head.appendChild(style);

  // ── Floating button bar ────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'em-bar';
  bar.innerHTML = `
    <button class="em-btn em-btn--toolbox" id="em-toolbox-btn" aria-expanded="false">🧰 Toolbox ▼</button>
    <div id="em-toolbox-panel" hidden>
      <button class="em-btn em-btn--save"  id="em-save-btn">📍 Save Tile</button>
      <button class="em-btn em-btn--gather" id="em-save-res-btn">🌿 Save Gather</button>
      <button class="em-btn em-btn--ledger" id="em-save-ledger-btn">📒 Save Ledger</button>
      <button class="em-btn em-btn--memory" id="em-save-memory-btn">🧠 Save Memory</button>
      <button class="em-btn em-btn--chars" id="em-chars-btn">👤 Characters</button>
      <button class="em-btn em-btn--map"   id="em-map-btn">🗺 Open Map</button>
      <button class="em-btn em-btn--cfg"   id="em-cfg-btn">⚙ Settings</button>
    </div>
  `;
  document.body.appendChild(bar);

  const toolboxBtn = document.getElementById('em-toolbox-btn');
  const toolboxPanel = document.getElementById('em-toolbox-panel');
  function setToolboxOpen(isOpen) {
    toolboxPanel.hidden = !isOpen;
    toolboxBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    toolboxBtn.textContent = isOpen ? '🧰 Toolbox ▲' : '🧰 Toolbox ▼';
  }
  setToolboxOpen(false);
  toolboxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setToolboxOpen(toolboxPanel.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target)) setToolboxOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setToolboxOpen(false);
  });

  // ── Preview/confirm overlay ────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'em-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<div id="em-modal"></div>`;
  document.body.appendChild(overlay);

  // ── Settings overlay ───────────────────────────────────────────────
  const cfgOverlay = document.createElement('div');
  cfgOverlay.id = 'em-cfg-overlay';
  cfgOverlay.hidden = true;
  cfgOverlay.innerHTML = `
    <div id="em-cfg-modal">
      <h2>⚙ Everborne Map Settings</h2>
      <div class="em-field">
        <label>Map server URL</label>
        <input id="em-cfg-server" type="text" placeholder="http://localhost:3000" autocomplete="off">
      </div>
      <div class="em-field">
        <label>API Key</label>
        <input id="em-cfg-key" type="password" placeholder="Paste your API key" autocomplete="new-password">
      </div>
      <div class="em-row">
        <button class="em-submit" id="em-cfg-save">Save</button>
        <button class="em-cancel" id="em-cfg-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(cfgOverlay);

  const coordOverlay = document.createElement('div');
  coordOverlay.id = 'em-coord-overlay';
  coordOverlay.hidden = true;
  coordOverlay.innerHTML = `
    <div id="em-coord-modal">
      <h2>Set Tile Coordinates</h2>
      <div style="font-size:12px;color:#8a9ab8;margin-bottom:10px;">
        The world tile could not be determined automatically. Enter the coordinates for the tile to update.
      </div>
      <div class="em-field">
        <label>X Coordinate</label>
        <input id="em-coord-x" type="number" step="1" placeholder="e.g. 123" autocomplete="off">
      </div>
      <div class="em-field">
        <label>Y Coordinate</label>
        <input id="em-coord-y" type="number" step="1" placeholder="e.g. 456" autocomplete="off">
      </div>
      <div class="em-row">
        <button class="em-submit" id="em-coord-save">Use Coordinates</button>
        <button class="em-cancel" id="em-coord-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(coordOverlay);

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
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Extracting…';

    try {
      const data = await extractCurrentTile();
      showPreviewModal(data);
    } catch (err) {
      showToast('Extraction failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '📍 Save Tile';
    }
  });

  document.getElementById('em-save-res-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-res-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Saving…';

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

      const uniqueResources = [];
      const resourceIndexByName = new Map();
      for (const resource of resources) {
        const key = String(resource.name || '').trim().toLowerCase();
        if (!key) continue;

        if (!resourceIndexByName.has(key)) {
          resourceIndexByName.set(key, uniqueResources.length);
          uniqueResources.push(resource);
        }
      }

      const uniqueBeasts = [];
      const beastIndexByName = new Map();
      for (const beast of beasts) {
        const key = String(beast.name || '').trim().toLowerCase();
        if (!key) continue;

        if (!beastIndexByName.has(key)) {
          beastIndexByName.set(key, uniqueBeasts.length);
          uniqueBeasts.push({
            ...beast,
            count: 1,
            ages: beast.age ? [beast.age] : [],
          });
          continue;
        }

        const idx = beastIndexByName.get(key);
        const target = uniqueBeasts[idx];
        target.count += 1;
        if (beast.age && !target.ages.includes(beast.age)) target.ages.push(beast.age);
      }

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
      saveBtn.disabled = false;
      saveBtn.textContent = '🌿 Save Gather';
    }
  });

  document.getElementById('em-save-ledger-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-ledger-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Saving…';

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

      const result = await postLedgerImport(entriesWithLocation);
      const skippedNote = ledger.skippedSelfUnresolved
        ? `, ${ledger.skippedSelfUnresolved} skipped (couldn't confirm your own name)`
        : '';
      showToast(`Ledger saved: ${result.inserted} new, ${result.skipped} already known${skippedNote}.`, 'ok');
    } catch (err) {
      showToast('Ledger save failed: ' + err.message, 'err');
      console.error('[EverborneMap]', err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = '📒 Save Ledger';
    }
  });

  document.getElementById('em-save-memory-btn').addEventListener('click', async () => {
    const saveBtn = document.getElementById('em-save-memory-btn');
    saveBtn.disabled = true;
    saveBtn.textContent = '⏳ Saving…';

    try {
      const entries = extractMemoryFromModal();
      if (!entries) throw new Error('Open the Memory modal first.');
      if (!entries.length) throw new Error('No remembered people found to import.');

      const result = await postMemoryImport(entries);
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
      saveBtn.disabled = false;
      saveBtn.textContent = '🧠 Save Memory';
    }
  });

  // Decode the numeric tile ID from a tile image src.
  // The src is /tile.php?id=<base64> where base64 decodes to "<numericId>|<hash>".
  // e.g. "MjI0NXw..." → "2245|60ec..." → 2245
  function decodeTileIdFromSrc(src) {
    try {
      const match = src.match(/[?&]id=([A-Za-z0-9+/=]+)/);
      if (!match) return null;
      const decoded = atob(match[1]);
      const id = parseInt(decoded.split('|')[0], 10);
      return isNaN(id) ? null : id;
    } catch (e) {
      return null;
    }
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
      const qtyInput = row.querySelector('.col-3 input[type="number"]');
      if (!name || !qtyInput) continue;

      const infoSmall = row.querySelector('.col-6 small');
      const infoLines = infoSmall
        ? infoSmall.innerHTML
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>/g, '')
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean)
        : [];

      const qualityLine = infoLines.find(l => /quality/i.test(l)) || null;
      const toolLine = infoLines.find(l => /tool required|no tool required/i.test(l)) || null;
      const availability = infoLines.find(l => /(abundant|common|uncommon|rare|scarce|depleted)/i.test(l)) || null;
      const requirement = infoLines.find(l => /:/i.test(l) && !/quality|tool required|no tool required|abundant|common|uncommon|rare|scarce|depleted/i.test(l)) || null;

      const rate = Array.from(row.querySelectorAll('.col-3 .text-muted'))
        .map(el => el.textContent.trim())
        .find(t => /^Rate:/i.test(t)) || null;

      const action = row.querySelector('.col-3 button')?.textContent.trim() || null;

      out.push({
        name,
        biome: nearestGatherBiome(row),
        quantity: Number(qtyInput.value) || 1,
        quality_label: qualityLine,
        tool: toolLine,
        availability,
        requirement,
        rate,
        action,
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

      const notes = Array.from(row.querySelectorAll('.row-note')).map(n => n.textContent.trim()).filter(Boolean);
      const badges = Array.from(row.querySelectorAll('.wild-animal-top-meta .badge')).map(b => b.textContent.trim()).filter(Boolean);
      const diet = row.querySelector('.wild-animal-diet-copy')?.textContent.trim() || null;
      const health = row.querySelector('.progress-bar')?.textContent.trim() || null;
      const behavior = row.querySelector('.wild-animal-behavior-text')?.textContent.trim() || null;

      out.push({
        name,
        age: notes[0] || null,
        requirement: notes[1] || null,
        status: badges[0] || null,
        leaves: badges[1] || null,
        diet,
        health,
        behavior,
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
  function extractWarehouseLedgerFromModal() {
    const modal = findVisibleModalContent('#warehouseLedgerModal');
    if (!modal) return null;

    const warehouseName = modal.querySelector('.modal-title')?.textContent.trim() || null;

    // Summary block's second line reads either "No city registered" or the city name.
    const summaryCityEl = modal.querySelector('.warehouse-ledger-summary .text-muted');
    let cityName = summaryCityEl ? summaryCityEl.textContent.trim() : null;
    if (cityName && /no city registered/i.test(cityName)) cityName = null;

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

  function postMemoryImport(entries) {
    return new Promise((resolve, reject) => {
      const key = getApiKey();
      if (!key) {
        return reject(new Error('No API key set. Open ⚙ Settings to configure it.'));
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url: `${getServer()}/api/characters/memory/import`,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        data: JSON.stringify({ entries }),
        onload(response) {
          if (response.status === 401) return reject(new Error('Invalid API key.'));
          if (response.status < 200 || response.status >= 300) {
            let msg = `Server error (${response.status})`;
            try { msg = JSON.parse(response.responseText).error || msg; } catch {}
            return reject(new Error(msg));
          }
          resolve(JSON.parse(response.responseText));
        },
        onerror() { reject(new Error('Could not reach map server. Is it running?')); },
      });
    });
  }

  async function extractCurrentTile() {
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
    //   3. The selected tile's world pos = (cx + dx, cy + dy) where
    //      dx = (selectedIdx % 3) − 1,  dy = floor(selectedIdx / 3) − 1.

    const GRID_COLS = 3;
    const { tileWraps, cx, cy } = getMapGridContext();

    // 2. Identify the selected (destination/highlighted) tile
    const selectedIdx = tileWraps.findIndex(w => w.classList.contains('is-selected'));
    if (selectedIdx < 0) throw new Error('No selected tile found. Click a tile on the game map first.');

    const selected = tileWraps[selectedIdx];

    // 3. Selected tile's offset from center in the 3×3 grid
    const dx = (selectedIdx % GRID_COLS) - 1;  // −1 = left, 0 = center, +1 = right
    const dy = Math.floor(selectedIdx / GRID_COLS) - 1; // −1 = above, 0 = same row, +1 = below

    const worldX = cx + dx;
    const worldY = cy + dy;

    // 7. Fetch selected tile image
    const imgEl = selected.querySelector('.tile-img');
    let imageBase64 = null;
    if (imgEl && imgEl.src) {
      try {
        imageBase64 = await fetchImageAsBase64(imgEl.src);
      } catch (e) {
        console.warn('[EverborneMap] Could not fetch tile image:', e);
      }
    }

    // 4. Text fields from #locDesc (character's current tile)
    const { city_name, terrain_name, terrain_description, features } = extractLocDescData();

    // Note: #locDesc reflects the character's current tile (center, index 4).
    // For neighbouring tiles we still pre-fill with whatever is available so
    // the user has something to start from — they can edit before confirming.

    return {
      x: worldX,
      y: worldY,
      city_name,
      terrain_name,
      terrain_description,
      features,
      imageBase64,
    };
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
  function showPreviewModal(data) {
    const modal = document.getElementById('em-modal');

    // Reset any previously applied drag position
    modal.style.cssText = '';
    overlay.style.alignItems = '';
    overlay.style.justifyContent = '';

    modal.innerHTML = `
      <h2>📍 Save Tile (${data.x}, ${data.y})</h2>

      ${data.imageBase64
        ? `<img class="em-preview-img" src="${sanitizeAttr(data.imageBase64)}" alt="tile preview">`
        : '<p style="color:#8a9ab8;font-size:12px;margin-bottom:10px;">No tile image found.</p>'}

      <div class="em-field">
        <label>City Name</label>
        <input id="em-p-city" type="text" value="${sanitizeAttr(data.city_name || '')}" autocomplete="off">
      </div>
      <div class="em-field">
        <label>City Race / Faction</label>
        <input id="em-p-race" type="text" value="" autocomplete="off">
      </div>
      <div class="em-field">
        <label>Terrain</label>
        <input id="em-p-terrain" type="text" value="${sanitizeAttr(data.terrain_name || '')}" autocomplete="off">
      </div>
      <div class="em-field">
        <label>Terrain Description</label>
        <textarea id="em-p-terrain-desc" rows="2" autocomplete="off">${sanitizeText(data.terrain_description || '')}</textarea>
      </div>

      <h3>Features (${data.features.length})</h3>
      <div id="em-p-features" style="font-size:12px;color:#8a9ab8;margin-bottom:8px;">
        ${data.features.map(f => `<div>• <strong>${sanitizeText(f.name)}</strong>${f.description ? ': ' + sanitizeText(f.description) : ''}</div>`).join('') || 'None'}
      </div>

      <div class="em-field">
        <label>Resource Tags <span style="font-weight:400;color:#5a6880;">(comma-separated)</span></label>
        <input id="em-p-tags" type="text" placeholder="e.g. wood, fish, stone" autocomplete="off">
      </div>
      <div class="em-field">
        <label>Notes</label>
        <textarea id="em-p-notes" rows="2" placeholder="Your personal notes…" autocomplete="off"></textarea>
      </div>

      <div id="em-p-error" style="color:#f08080;font-size:12px;margin-top:6px;display:none;"></div>

      <div class="em-row">
        <button class="em-submit" id="em-p-confirm">Send to Map</button>
        <button class="em-cancel" id="em-p-cancel">Cancel</button>
      </div>
    `;

    overlay.hidden = false;
    makeDraggable(modal, modal.querySelector('h2'));

    document.getElementById('em-p-cancel').addEventListener('click', () => { overlay.hidden = true; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.hidden = true; });

    document.getElementById('em-p-confirm').addEventListener('click', async () => {
      const confirmBtn = document.getElementById('em-p-confirm');
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Sending…';

      const tagRaw = document.getElementById('em-p-tags').value;
      const resource_tags = tagRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

      const payload = {
        x: data.x,
        y: data.y,
        city_name: document.getElementById('em-p-city').value.trim() || null,
        city_race: document.getElementById('em-p-race').value.trim() || null,
        terrain_name: document.getElementById('em-p-terrain').value.trim() || null,
        terrain_description: document.getElementById('em-p-terrain-desc').value.trim() || null,
        features: data.features,
        resource_tags,
        notes: document.getElementById('em-p-notes').value,
        image_base64: data.imageBase64 || null,
        merge: true,
      };

      const errEl = document.getElementById('em-p-error');
      errEl.style.display = 'none';

      try {
        await postTile(payload);
        overlay.hidden = true;
        showToast(`Tile (${data.x}, ${data.y}) saved!`, 'ok');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Send to Map';
      }
    });
  }

  // ── POST to server ─────────────────────────────────────────────────
  function postTile(payload) {
    return new Promise((resolve, reject) => {
      const key = getApiKey();
      if (!key) {
        return reject(new Error('No API key set. Open ⚙ Settings to configure it.'));
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url: `${getServer()}/api/tiles`,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        data: JSON.stringify(payload),
        onload(response) {
          if (response.status === 401) return reject(new Error('Invalid API key.'));
          if (response.status < 200 || response.status >= 300) {
            let msg = `Server error (${response.status})`;
            try { msg = JSON.parse(response.responseText).error || msg; } catch {}
            return reject(new Error(msg));
          }
          resolve(JSON.parse(response.responseText));
        },
        onerror() { reject(new Error('Could not reach map server. Is it running?')); },
      });
    });
  }

  function postLedgerImport(entries) {
    return new Promise((resolve, reject) => {
      const key = getApiKey();
      if (!key) {
        return reject(new Error('No API key set. Open ⚙ Settings to configure it.'));
      }

      GM_xmlhttpRequest({
        method: 'POST',
        url: `${getServer()}/api/ledger/import`,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': key,
        },
        data: JSON.stringify({ entries }),
        onload(response) {
          if (response.status === 401) return reject(new Error('Invalid API key.'));
          if (response.status < 200 || response.status >= 300) {
            let msg = `Server error (${response.status})`;
            try { msg = JSON.parse(response.responseText).error || msg; } catch {}
            return reject(new Error(msg));
          }
          resolve(JSON.parse(response.responseText));
        },
        onerror() { reject(new Error('Could not reach map server. Is it running?')); },
      });
    });
  }

  // ── Watchtower (lookout) support ────────────────────────────────────

  // Decode numeric tile ID from a data-tile-obf base64 value ("<id>|<hash>").
  function decodeObfId(obf) {
    if (!obf) return null;
    try {
      const decoded = atob(obf);
      const id = parseInt(decoded.split('|')[0], 10);
      return isNaN(id) ? null : id;
    } catch (e) {
      return null;
    }
  }

  function decorateWatchtowerGrid(grid) {
    // Bail out if already decorated
    if (grid.querySelector('.em-wt-save')) return;

    const buttons = Array.from(grid.querySelectorAll('.wt-tile-btn'));
    if (buttons.length < 6) return; // need at least two rows to compute worldWidth

    const ids = buttons.map(b => decodeObfId(b.dataset.tileObf));

    // worldWidth = vertical distance between rows = tile[colCount].id - tile[0].id
    // The grid CSS declares 5 columns.
    const COL_COUNT = 5;
    let worldWidth = null;
    for (let i = 0; i + COL_COUNT < ids.length; i++) {
      if (ids[i] !== null && ids[i + COL_COUNT] !== null) {
        const diff = ids[i + COL_COUNT] - ids[i];
        if (diff > 0) { worldWidth = diff; break; }
      }
    }
    if (!worldWidth) return;

    buttons.forEach((btn, idx) => {
      const tileId = ids[idx];
      if (tileId === null) return;

      const worldX = tileId % worldWidth;
      const worldY = Math.floor(tileId / worldWidth);

      const saveBtn = document.createElement('button');
      saveBtn.className = 'em-wt-save';
      saveBtn.type = 'button';
      saveBtn.title = `Save (${worldX}, ${worldY}) to map`;
      saveBtn.textContent = '📍';

      saveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        saveBtn.disabled = true;
        saveBtn.textContent = '⏳';
        try {
          const imgEl = btn.querySelector('img');
          let imageBase64 = null;
          if (imgEl && imgEl.src) {
            try { imageBase64 = await fetchImageAsBase64(imgEl.src); } catch {}
          }
          showPreviewModal({
            x: worldX,
            y: worldY,
            city_name: null,
            terrain_name: null,
            terrain_description: null,
            features: [],
            imageBase64,
          });
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = '📍';
        }
      });

      btn.appendChild(saveBtn);
    });
  }

  // Watch for the watchtower grid being injected into the DOM.
  const wtObserver = new MutationObserver(() => {
    const grid = document.querySelector('.wt-grid');
    if (grid) decorateWatchtowerGrid(grid);
    updateCharsBtn();
  });
  wtObserver.observe(document.body, { childList: true, subtree: true });

  // Handle the case where the grid is already present at script load time.
  const existingWtGrid = document.querySelector('.wt-grid');
  if (existingWtGrid) decorateWatchtowerGrid(existingWtGrid);

  // ── Skills modal indicator: tint the Characters button green when scraping is available ──
  function updateCharsBtn() {
    const btn = document.getElementById('em-chars-btn');
    if (!btn) return;
    const hasSkills = document.querySelector('.js-skill-live-card') !== null;
    const label = hasSkills ? '\ud83d\udcca Scrape Skills' : '\ud83d\udc64 Characters';
    // Guard: only touch the DOM when state actually changed to avoid
    // re-triggering the MutationObserver and causing an infinite loop.
    if (btn.textContent === label) return;
    btn.classList.toggle('has-skills', hasSkills);
    btn.textContent = label;
  }
  updateCharsBtn();

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

  // ── Characters overlay ─────────────────────────────────────────────
  const charsOverlay = document.createElement('div');
  charsOverlay.id = 'em-chars-overlay';
  charsOverlay.hidden = true;
  charsOverlay.innerHTML = `<div id="em-chars-modal"><h2>\u{1F464} Characters \u0026 Skills</h2><div id="em-chars-inner"></div></div>`;
  document.body.appendChild(charsOverlay);
  charsOverlay.addEventListener('click', e => { if (e.target === charsOverlay) charsOverlay.hidden = true; });

  document.getElementById('em-chars-btn').addEventListener('click', () => {
    const skills = extractSkillsFromPage();
    const charName = extractCharacterName();
    charsOverlay.hidden = false;
    const modal = document.getElementById('em-chars-modal');
    modal.style.cssText = '';
    charsOverlay.style.alignItems = '';
    charsOverlay.style.justifyContent = '';
    makeDraggable(modal, modal.querySelector('h2'));
    if (skills.length) {
      // Skills modal is open — scrape and go straight to the edit form
      gmFetchChars((err, chars) => {
        gmChars = err ? [] : chars;
        const existing = charName
          ? gmChars.find(c => c.name.toLowerCase() === charName.toLowerCase())
          : null;
        const prefill = existing
          ? { ...existing, skills }
          : { name: charName, player: null, skills };
        const notice = existing
          ? `Scraped ${skills.length} skills from the page \u2014 updating existing character.`
          : `Scraped ${skills.length} skills from the page${charName ? ` for \u201c${charName}\u201d` : ''}.`;
        gmShowEdit(prefill, notice);
      });
    } else {
      // No skills modal open — show character list
      gmLoadCharsList();
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

  let gmChars    = [];
  let gmSkills   = [];

  function gmLoadCharsList() {
    const inner = document.getElementById('em-chars-inner');
    inner.innerHTML = '<p style="color:#8a9ab8;font-size:12px;">Loading\u2026</p>';
    gmFetchChars((err, chars) => {
      if (err) {
        inner.innerHTML = `<p style="color:#f08080;font-size:12px;">${sanitizeText(String(err))}</p>`;
        return;
      }
      gmChars = chars;
      gmShowList();
    });
  }

  function gmShowList() {
    const inner = document.getElementById('em-chars-inner');
    inner.innerHTML = '';
    const key = getApiKey();

    if (!gmChars.length) {
      const empty = document.createElement('p');
      empty.style.cssText = 'color:#8a9ab8;font-size:12px;margin-bottom:10px;';
      empty.textContent = 'No characters yet.';
      inner.appendChild(empty);
    } else {
      for (const ch of gmChars) {
        const item = document.createElement('div');
        item.className = 'em-chars-item';
        item.innerHTML = `
          <div>
            <div style="font-size:13px;font-weight:600;">${sanitizeText(ch.name)}</div>
            ${ch.player ? `<div style="font-size:11px;color:#8a9ab8;">${sanitizeText(ch.player)}</div>` : ''}
          </div>
          <div style="font-size:11px;color:#5a6880;">${ch.skills.length} skill${ch.skills.length !== 1 ? 's' : ''}</div>
        `;
        item.addEventListener('click', () => gmShowEdit(ch, null));
        inner.appendChild(item);
      }
    }

    if (key) {
      const addBtn = document.createElement('button');
      addBtn.className = 'em-submit';
      addBtn.style.cssText = 'margin-top:8px;font-size:12px;padding:5px 14px;';
      addBtn.textContent = '+ New Character';
      addBtn.addEventListener('click', () => gmShowEdit(null, null));
      inner.appendChild(addBtn);
    }
  }

  function gmShowEdit(ch, scrapeNotice) {
    const inner = document.getElementById('em-chars-inner');
    gmSkills = ch ? ch.skills.map(s => ({ ...s })) : [];

    inner.innerHTML = `
      <form id="em-char-form" novalidate autocomplete="off">
        ${scrapeNotice ? `<div style="background:rgba(80,200,80,0.1);border:1px solid rgba(80,200,80,0.3);border-radius:4px;padding:6px 10px;font-size:11px;color:#7ec87e;margin-bottom:10px;">${sanitizeText(scrapeNotice)}</div>` : ''}
        <div class="em-field">
          <label>Character Name</label>
          <input id="em-char-name" type="text" value="${sanitizeAttr(ch ? ch.name : '')}" placeholder="e.g. Aldric the Bold" autocomplete="off" required>
        </div>
        <div class="em-field">
          <label>Player</label>
          <input id="em-char-player" type="text" value="${sanitizeAttr(ch && ch.player ? ch.player : '')}" placeholder="e.g. Alice" autocomplete="off">
        </div>
        <h3 style="font-size:12px;color:#8a9ab8;margin:10px 0 6px;text-transform:uppercase;letter-spacing:0.06em;">Skills</h3>
        <div id="em-skill-rows" style="margin-bottom:6px;"></div>
        <button type="button" id="em-add-skill" class="em-cancel" style="font-size:11px;padding:3px 10px;margin-bottom:10px;">+ Add Skill</button>
        <div id="em-char-err" style="color:#f08080;font-size:12px;margin-bottom:6px;display:none;"></div>
        <div class="em-row">
          <button type="button" id="em-char-save" class="em-submit">Send to Map</button>
          <button type="button" id="em-char-back" class="em-cancel">\u2190 Back</button>
        </div>
      </form>
    `;

    gmRenderSkillRows();

    document.getElementById('em-char-back').addEventListener('click', gmShowList);
    document.getElementById('em-add-skill').addEventListener('click', () => {
      gmSkills.push({ name: '', level: null, description: '' });
      gmRenderSkillRows();
    });

    document.getElementById('em-char-save').addEventListener('click', () => {
      const errEl   = document.getElementById('em-char-err');
      const saveBtn = document.getElementById('em-char-save');
      errEl.style.display = 'none';

      const name = document.getElementById('em-char-name').value.trim();
      if (!name) {
        errEl.textContent = 'Character name is required.';
        errEl.style.display = 'block';
        return;
      }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Sending\u2026';

      const payload = {
        id:     ch ? ch.id : undefined,
        name,
        player: document.getElementById('em-char-player').value.trim() || null,
        skills: gmSkills.filter(s => s.name),
      };

      gmPostChar(payload, (err, saved) => {
        if (err) {
          const errElNow = document.getElementById('em-char-err');
          const saveBtnNow = document.getElementById('em-char-save');
          if (errElNow) { errElNow.textContent = String(err); errElNow.style.display = 'block'; }
          if (saveBtnNow) { saveBtnNow.disabled = false; saveBtnNow.textContent = 'Send to Map'; }
          return;
        }
        charsOverlay.hidden = true;
        showToast(`Character "${saved.name}" saved!`, 'ok');
      });
    });
  }

  function gmRenderSkillRows() {
    const container = document.getElementById('em-skill-rows');
    container.innerHTML = '';
    gmSkills.forEach((skill, i) => {
      const row = document.createElement('div');
      row.className = 'em-skill-row';

      const nameIn = document.createElement('input');
      nameIn.className = 'em-skill-input';
      nameIn.type = 'text';
      nameIn.autocomplete = 'off';
      nameIn.placeholder = 'Skill name';
      nameIn.value = skill.name || '';
      nameIn.style.flex = '2';
      nameIn.addEventListener('input', () => { gmSkills[i].name = nameIn.value; });

      const levelIn = document.createElement('input');
      levelIn.className = 'em-skill-input';
      levelIn.type = 'number';
      levelIn.autocomplete = 'off';
      levelIn.placeholder = 'Lv';
      levelIn.min = 1;
      levelIn.value = skill.level != null ? skill.level : '';
      levelIn.style.width = '52px';
      levelIn.addEventListener('input', () => {
        gmSkills[i].level = levelIn.value === '' ? null : Number(levelIn.value);
      });

      const descIn = document.createElement('input');
      descIn.className = 'em-skill-input';
      descIn.type = 'text';
      descIn.autocomplete = 'off';
      descIn.placeholder = 'Description';
      descIn.value = skill.description || '';
      descIn.style.flex = '3';
      descIn.addEventListener('input', () => { gmSkills[i].description = descIn.value; });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'em-skill-del';
      del.textContent = '\u00D7';
      del.addEventListener('click', () => { gmSkills.splice(i, 1); gmRenderSkillRows(); });

      row.appendChild(nameIn);
      row.appendChild(levelIn);
      row.appendChild(descIn);
      row.appendChild(del);
      container.appendChild(row);
    });
  }

  function gmFetchChars(cb) {
    const key = getApiKey();
    GM_xmlhttpRequest({
      method: 'GET',
      url: `${getServer()}/api/characters`,
      headers: key ? { 'X-API-Key': key } : {},
      onload(response) {
        if (response.status === 401) return cb('Set your API key in \u2699 Settings.');
        if (response.status < 200 || response.status >= 300) return cb(`Server error (${response.status})`);
        try { cb(null, JSON.parse(response.responseText)); } catch { cb('Invalid server response'); }
      },
      onerror() { cb('Could not reach map server. Is it running?'); },
    });
  }

  function gmPostChar(payload, cb) {
    const key = getApiKey();
    if (!key) return cb('No API key set. Open \u2699 Settings to configure it.');
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${getServer()}/api/characters`,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      data: JSON.stringify(payload),
      onload(response) {
        if (response.status === 401) return cb('Invalid API key.');
        if (response.status < 200 || response.status >= 300) {
          let msg = `Server error (${response.status})`;
          try { msg = JSON.parse(response.responseText).error || msg; } catch {}
          return cb(msg);
        }
        try { cb(null, JSON.parse(response.responseText)); } catch { cb('Invalid server response'); }
      },
      onerror() { cb('Could not reach map server. Is it running?'); },
    });
  }

  // ── Toast ──────────────────────────────────────────────────────────
  function showToast(msg, type = 'ok') {
    const toast = document.createElement('div');
    toast.className = `em-toast em-toast--${type}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 350);
    }, 3000);
  }

  // ── Sanitize helpers (prevent XSS in generated HTML) ──────────────
  function sanitizeText(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
  function sanitizeAttr(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

})();
