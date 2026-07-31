// ==UserScript==
// @name         Torn - Big Al's Bunker Buck Calculator
// @namespace    https://github.com/torn-bunker-bb-calculator
// @version      0.7.0
// @description  Live cache prices + Bunker Buck value calculator for Big Al's Bunker. Highlights profitable buys on the Item Market/Bazaar, shows a floating Bunker-vs-market comparison (backed by weav3r's real auction sales history) when an item's detail view is open, and max profitable bid hints on the Auction House. Uses weav3r.dev and the official Torn API.
// @author       Fuyune [3387109]
// @homepageURL  https://github.com/De-Wohli/userscripts/tree/main/Torn/bunker-buck-calculator
// @supportURL   https://github.com/De-Wohli/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/De-Wohli/userscripts/main/Torn/bunker-buck-calculator/greasemonkey.meta.js
// @downloadURL  https://raw.githubusercontent.com/De-Wohli/userscripts/main/Torn/bunker-buck-calculator/greasemonkey.user.js
// @match        https://www.torn.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.torn.com
// @connect      weav3r.dev
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Fixed game constants
  //
  // Bunker Buck costs and trade-in tables are not exposed by any API -
  // they're fixed game values maintained by the community (see the
  // "BB Cost Calculator" google sheet this script was built against).
  // If Torn ever rebalances these, update the numbers below.
  // ------------------------------------------------------------------

  const CACHE_DEFS = [
    { key: 'armor', itemName: 'Armor Cache', bbCost: 60 },
    { key: 'melee', itemName: 'Melee Cache', bbCost: 30 },
    { key: 'small', itemName: 'Small Arms Cache', bbCost: 20 },
    { key: 'medium', itemName: 'Medium Arms Cache', bbCost: 50 },
    { key: 'heavy', itemName: 'Heavy Arms Cache', bbCost: 70 },
  ];

  // Keyed by Torn's official sub_type (weapons) / type (armor) strings,
  // exactly as returned by GET /v2/torn/items.
  const TRADE_IN_TABLE = {
    'Pistol': { yellow: 4, orange: 12, orange2: 18, red: 36, red2: 54 },
    'SMG': { yellow: 4, orange: 12, orange2: 18, red: 36, red2: 54 },
    'Clubbing': { yellow: 6, orange: 18, orange2: 27, red: 54, red2: 81 },
    'Piercing': { yellow: 6, orange: 18, orange2: 27, red: 54, red2: 81 },
    'Slashing': { yellow: 6, orange: 18, orange2: 27, red: 54, red2: 81 },
    'Shotgun': { yellow: 10, orange: 30, orange2: 45, red: 90, red2: 135 },
    'Rifle': { yellow: 10, orange: 30, orange2: 45, red: 90, red2: 135 },
    'Machine gun': { yellow: 14, orange: 42, orange2: 63, red: 126, red2: 189 },
    'Heavy artillery': { yellow: 14, orange: 42, orange2: 63, red: 126, red2: 189 },
    // Armor has no "2 bonus" tier in the trade-in table.
    'Armor': { yellow: 12, orange: 26, orange2: null, red: 108, red2: null },
  };

  const CATEGORY_LABELS = Object.keys(TRADE_IN_TABLE);

  const ITEMS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // item list barely changes
  const PRICE_CACHE_TTL_MS = 3 * 60 * 1000; // matches weav3r's own cache window

  // ------------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------------

  const store = {
    get(key, fallback) {
      const raw = GM_getValue(key, undefined);
      if (raw === undefined) return fallback;
      try { return JSON.parse(raw); } catch { return fallback; }
    },
    set(key, value) {
      GM_setValue(key, JSON.stringify(value));
    },
  };

  function getApiKey() {
    return store.get('tbb_torn_api_key', '');
  }
  function setApiKey(key) {
    store.set('tbb_torn_api_key', key.trim());
  }
  function getBbPriceOverride() {
    return store.get('tbb_bb_price_override', null);
  }
  function setBbPriceOverride(value) {
    store.set('tbb_bb_price_override', value);
  }

  // ------------------------------------------------------------------
  // HTTP helpers
  // ------------------------------------------------------------------

  function httpJson(url, { method = 'GET', body } = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url,
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        data: body ? JSON.stringify(body) : undefined,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`HTTP ${res.status} for ${url}`));
            return;
          }
          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(new Error(`Bad JSON from ${url}: ${e.message}`));
          }
        },
        onerror: () => reject(new Error(`Network error for ${url}`)),
        ontimeout: () => reject(new Error(`Timeout for ${url}`)),
        timeout: 15000,
      });
    });
  }

  function httpGetJson(url) {
    return httpJson(url);
  }

  // ------------------------------------------------------------------
  // Torn official API (v2) - requires the user's own key (Public access
  // level is sufficient for every endpoint this script calls)
  // ------------------------------------------------------------------

  function indexByName(list, nameField) {
    const byName = new Map();
    for (const item of list) byName.set(item[nameField], item);
    return { list, byName };
  }

  function indexItems(list) {
    const byId = new Map();
    for (const item of list) byId.set(item.id, item);
    return { ...indexByName(list, 'name'), byId };
  }

  const Torn = {
    _itemsPromise: null,

    // Returns { list, byName, byId }, backed by a 24h on-disk cache
    // (item list barely changes) shared across tabs/reloads.
    async itemsIndexed() {
      const cached = store.get('tbb_items_cache', null);
      if (cached && Date.now() - cached.ts < ITEMS_CACHE_TTL_MS) {
        return indexItems(cached.data);
      }
      if (this._itemsPromise) return this._itemsPromise;

      const key = getApiKey();
      if (!key) throw new Error('No Torn API key set');

      this._itemsPromise = httpGetJson(
        `https://api.torn.com/v2/torn/items?key=${encodeURIComponent(key)}`
      )
        .then((json) => {
          if (json.error) throw new Error(`Torn API error: ${json.error.error}`);
          store.set('tbb_items_cache', { ts: Date.now(), data: json.items });
          return indexItems(json.items);
        })
        .finally(() => {
          this._itemsPromise = null;
        });
      return this._itemsPromise;
    },

    // Cached in GM storage (shared across tabs, unlike an in-memory
    // cache) with the same TTL as the refresh cycle, so a manual
    // refresh click or a second tab opened within that window reuses
    // the result instead of re-hitting the API.
    async itemMarketLowest(itemId) {
      const cache = store.get('tbb_itemmarket_cache', {});
      const cached = cache[itemId];
      if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
        return cached.price;
      }

      const key = getApiKey();
      if (!key) throw new Error('No Torn API key set');
      const json = await httpGetJson(
        `https://api.torn.com/v2/market/${itemId}/itemmarket?key=${encodeURIComponent(key)}&limit=5`
      );
      if (json.error) throw new Error(`Torn API error: ${json.error.error}`);
      const listings = json.itemmarket?.listings || [];
      const price = listings.length ? Math.min(...listings.map((l) => l.price)) : null;

      cache[itemId] = { ts: Date.now(), price };
      store.set('tbb_itemmarket_cache', cache);
      return price;
    },
  };

  // ------------------------------------------------------------------
  // weav3r.dev API (public, no key required)
  // ------------------------------------------------------------------

  const Weav3r = {
    _marketplacePromise: null,
    _rankedCache: new Map(), // in-memory only - per-item lookups, fine to lose on reload

    // Returns { list, byName }, backed by a short-lived on-disk cache
    // matching weav3r's own server-side cache window.
    async marketplaceIndexed() {
      const cached = store.get('tbb_weav3r_marketplace_cache', null);
      if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
        return indexByName(cached.data, 'item_name');
      }
      if (this._marketplacePromise) return this._marketplacePromise;

      this._marketplacePromise = httpGetJson('https://weav3r.dev/api/marketplace')
        .then((json) => {
          store.set('tbb_weav3r_marketplace_cache', { ts: Date.now(), data: json.items });
          return indexByName(json.items, 'item_name');
        })
        .finally(() => {
          this._marketplacePromise = null;
        });
      return this._marketplacePromise;
    },

    // params must include at least one filter per weav3r's contract
    // (weaponName/rarity/etc). Returns an array of comparable listings.
    async rankedWeapons(params) {
      const qs = new URLSearchParams(params).toString();
      const cached = this._rankedCache.get(qs);
      if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
        return cached.data;
      }
      const json = await httpGetJson(`https://weav3r.dev/api/ranked-weapons?${qs}`);
      const data = json.weapons || [];
      this._rankedCache.set(qs, { ts: Date.now(), data });
      return data;
    },

    // Not part of weav3r's published OpenAPI contract - found by
    // inspecting the JS bundle behind their own /rw-value page. Powers
    // a much richer valuation (real auction sales history, percentiles,
    // live comps) than /ranked-weapons alone can. Confirmed to work
    // unauthenticated. Since it's undocumented it could change or
    // disappear without notice, so callers should treat failures as
    // routine and fall back rather than depend on it exclusively.
    async rwValue(body) {
      const cacheKey = JSON.stringify(body);
      const cached = this._rwValueCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
        return cached.data;
      }
      const json = await httpJson('https://weav3r.dev/api/rw-value', { method: 'POST', body });
      this._rwValueCache.set(cacheKey, { ts: Date.now(), data: json });
      return json;
    },
    _rwValueCache: new Map(),
  };

  // ------------------------------------------------------------------
  // Price aggregation
  // ------------------------------------------------------------------

  async function getCachePrices() {
    const [tornItems, weav3rMarket] = await Promise.all([
      Torn.itemsIndexed().catch(() => null),
      Weav3r.marketplaceIndexed().catch(() => null),
    ]);

    const results = [];
    for (const def of CACHE_DEFS) {
      const entry = { ...def, officialLowest: null, weav3rMarket: null, weav3rLowest: null, error: null };

      const tornItem = tornItems?.byName.get(def.itemName);
      if (tornItem) {
        try {
          entry.officialLowest = await Torn.itemMarketLowest(tornItem.id);
        } catch (e) {
          entry.error = e.message;
        }
        entry.officialBase = tornItem.value?.market_price ?? null;
      }

      const w = weav3rMarket?.byName.get(def.itemName);
      if (w) {
        entry.weav3rMarket = w.market_price ?? null;
        entry.weav3rLowest = w.lowest_price ?? w.bazaar_average ?? null;
      }

      const candidates = [entry.officialLowest, entry.weav3rLowest, entry.weav3rMarket, entry.officialBase]
        .filter((v) => typeof v === 'number' && v > 0);
      entry.cheapest = candidates.length ? Math.min(...candidates) : null;
      entry.bbValue = entry.cheapest ? entry.cheapest / entry.bbCost : null;

      results.push(entry);
    }
    return results;
  }

  function summarizeBB(cachePrices) {
    const values = cachePrices.map((c) => c.bbValue).filter((v) => typeof v === 'number');
    if (!values.length) return { avg: null, min: null, max: null };
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { avg, min: Math.min(...values), max: Math.max(...values) };
  }

  // ------------------------------------------------------------------
  // Formatting helpers
  // ------------------------------------------------------------------

  function fmtMoney(n) {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function tierKeyFor(rarity, bonusCount) {
    const r = rarity.toLowerCase();
    if (r === 'yellow') return 'yellow';
    if (bonusCount >= 2) return r === 'orange' ? 'orange2' : 'red2';
    return r; // 'orange' | 'red'
  }

  function bbCountFor(category, rarity, bonusCount) {
    const table = TRADE_IN_TABLE[category];
    if (!table) return null;
    const key = tierKeyFor(rarity, bonusCount);
    const value = table[key];
    return value ?? table[rarity.toLowerCase()] ?? null;
  }

  // ------------------------------------------------------------------
  // UI - floating panel
  // ------------------------------------------------------------------

  GM_addStyle(`
    /* Torn's own site-wide CSS can out-specificity plain element
       selectors on a page we don't control, so every text color below
       is set explicitly (never relying on inheritance) and !important
       is used to guard against exactly that kind of bleed-through. */
    #tbb-panel {
      position: fixed;
      z-index: 999999;
      width: 340px;
      background: #1b1e23;
      color: #e6e6e6 !important;
      border: 1px solid #33373f;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      font: 12px/1.4 -apple-system, Segoe UI, Roboto, sans-serif;
      top: 90px;
      right: 20px;
    }
    #tbb-panel * { box-sizing: border-box; color: #e6e6e6; }
    #tbb-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px; cursor: move; background: #23272e;
      border-bottom: 1px solid #33373f; border-radius: 8px 8px 0 0;
      user-select: none;
    }
    #tbb-header strong { font-size: 12.5px; color: #f2c94c !important; }
    #tbb-header .tbb-actions button {
      background: none; border: none; color: #aab0bb !important; cursor: pointer;
      font-size: 13px; margin-left: 6px; padding: 2px 4px;
    }
    #tbb-header .tbb-actions button:hover { color: #fff !important; }
    #tbb-body { padding: 10px; max-height: 70vh; overflow-y: auto; }
    #tbb-body.tbb-collapsed { display: none; }
    .tbb-section-title {
      font-weight: 600; color: #9fd3ff !important; margin: 10px 0 4px; font-size: 11.5px;
      text-transform: uppercase; letter-spacing: .03em;
    }
    .tbb-section-title:first-child { margin-top: 0; }
    table.tbb-table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    table.tbb-table th, table.tbb-table td {
      padding: 3px 4px; text-align: right; color: #e6e6e6 !important;
    }
    table.tbb-table th:first-child, table.tbb-table td:first-child { text-align: left; }
    table.tbb-table th {
      color: #8a90a0 !important; font-weight: 500; border-bottom: 1px solid #33373f;
    }
    table.tbb-table tr:nth-child(odd) td { background: rgba(255,255,255,0.02); }
    .tbb-bbprice-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
    .tbb-bbprice-row input {
      width: 100px; background: #12141a; border: 1px solid #33373f; color: #e6e6e6 !important;
      padding: 3px 5px; border-radius: 4px; font-size: 11.5px;
    }
    .tbb-calc-row { display: flex; gap: 6px; margin-bottom: 6px; }
    .tbb-calc-row select, .tbb-calc-row input {
      flex: 1; background: #12141a; border: 1px solid #33373f; color: #e6e6e6 !important;
      padding: 4px 5px; border-radius: 4px; font-size: 11.5px;
    }
    .tbb-calc-row select option { color: #000; }
    .tbb-calc-row label { display: flex; align-items: center; gap: 4px; white-space: nowrap; font-size: 11.5px; }
    #tbb-verdict {
      margin-top: 8px; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
      text-align: center;
    }
    #tbb-verdict.tbb-good { background: rgba(60,180,90,0.18); color: #6adf8f !important; }
    #tbb-verdict.tbb-bad { background: rgba(220,80,80,0.18); color: #ff8a8a !important; }
    #tbb-verdict.tbb-neutral { background: rgba(140,140,140,0.15); color: #c8c8c8 !important; }
    .tbb-note { color: #8a90a0 !important; font-size: 10.5px; margin-top: 6px; }
    .tbb-note strong { color: #e6e6e6 !important; }
    .tbb-badge {
      display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 3px;
      font-size: 10.5px; font-weight: 600; vertical-align: middle;
    }
    .tbb-badge.tbb-good { background: #1f4d2e; color: #7ee69a !important; }
    .tbb-badge.tbb-bad { background: #4d1f1f; color: #ff9a9a !important; }
    .tbb-badge.tbb-bid-hint { background: #1c2b40; color: #8ec9ff !important; }
    .tbb-badge.tbb-auction-hint {
      display: block; clear: both; box-sizing: border-box; width: 100%;
      margin: 4px 0 0; padding: 3px 6px;
      font: 11px/1.3 -apple-system, Segoe UI, Roboto, sans-serif;
    }
    /* outline (not border) so it doesn't shift Torn's own tile layout/padding */
    .tbb-profitable-tile {
      outline: 2px solid #3ecf66 !important;
      outline-offset: -2px;
      background: rgba(62,207,102,0.12) !important;
      border-radius: 6px;
    }
    .tbb-refresh-spin { animation: tbb-spin 0.8s linear infinite; display: inline-block; }
    @keyframes tbb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

    #tbb-item-modal {
      position: fixed;
      z-index: 999998;
      width: 300px;
      background: #1b1e23;
      color: #e6e6e6 !important;
      border: 1px solid #33373f;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.45);
      font: 12px/1.4 -apple-system, Segoe UI, Roboto, sans-serif;
      top: 90px;
      left: 400px;
    }
    #tbb-item-modal * { box-sizing: border-box; color: #e6e6e6; }
    #tbb-item-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px; cursor: move; background: #23272e;
      border-bottom: 1px solid #33373f; border-radius: 8px 8px 0 0;
      user-select: none;
    }
    #tbb-item-modal-header strong { font-size: 12.5px; color: #f2c94c !important; }
    #tbb-item-modal-close {
      background: none; border: none; color: #aab0bb !important; cursor: pointer;
      font-size: 13px; padding: 2px 4px;
    }
    #tbb-item-modal-close:hover { color: #fff !important; }
    #tbb-item-modal-body { padding: 10px; }
    .tbb-item-modal-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11.5px; }
    .tbb-item-modal-row span { color: #8a90a0 !important; }
    .tbb-item-modal-row strong { color: #e6e6e6 !important; }
    #tbb-item-modal-verdict {
      margin-top: 8px; padding: 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
      text-align: center;
    }
    #tbb-item-modal-verdict.tbb-good { background: rgba(60,180,90,0.18); color: #6adf8f !important; }
    #tbb-item-modal-verdict.tbb-bad { background: rgba(220,80,80,0.18); color: #ff8a8a !important; }
    #tbb-item-modal-verdict.tbb-neutral { background: rgba(140,140,140,0.15); color: #c8c8c8 !important; }
    #tbb-item-modal-notes {
      display: none; margin-top: 6px; font-size: 10.5px; color: #8a90a0 !important;
    }
  `);

  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = 'tbb-panel';
    const pos = store.get('tbb_panel_pos', null);
    if (pos) { panel.style.top = pos.top; panel.style.left = pos.left; panel.style.right = 'auto'; }

    panel.innerHTML = `
      <div id="tbb-header">
        <strong>Bunker Buck Calculator</strong>
        <span class="tbb-actions">
          <button id="tbb-refresh" title="Refresh prices">&#8635;</button>
          <button id="tbb-settings" title="Set Torn API key">&#9881;</button>
          <button id="tbb-collapse" title="Collapse">&#8211;</button>
        </span>
      </div>
      <div id="tbb-body">
        <div class="tbb-section-title">Cache prices</div>
        <div id="tbb-cache-table">Loading…</div>
        <div class="tbb-bbprice-row">
          <span>1 BB =</span>
          <input id="tbb-bbprice" type="text" placeholder="auto" />
          <button id="tbb-bbprice-reset" title="Reset to computed average">reset</button>
        </div>

        <div class="tbb-section-title">Sell vs. trade-in calculator</div>
        <div class="tbb-calc-row">
          <select id="tbb-category"></select>
          <select id="tbb-rarity">
            <option value="yellow">Yellow</option>
            <option value="orange">Orange</option>
            <option value="red">Red</option>
          </select>
        </div>
        <div class="tbb-calc-row">
          <label><input type="checkbox" id="tbb-bonus2" /> 2 bonuses</label>
          <input id="tbb-sellprice" type="text" placeholder="Market/bazaar price ($)" />
        </div>
        <div id="tbb-verdict" class="tbb-neutral">Enter a sell price to compare.</div>
        <div class="tbb-note">
          Prices from weav3r.dev and the official Torn API (item market lowest listing).
          Trade-in values are fixed game constants, not live data.
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    const categorySelect = panel.querySelector('#tbb-category');
    for (const cat of CATEGORY_LABELS) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    }

    makeDraggable(panel, panel.querySelector('#tbb-header'));
    wirePanelEvents(panel);
    updateBonus2Availability(panel);
    return panel;
  }

  // Armor has no "2 bonuses" trade-in tier, unlike every weapon category.
  function updateBonus2Availability(panel) {
    const category = panel.querySelector('#tbb-category').value;
    const bonus2 = panel.querySelector('#tbb-bonus2');
    const isArmor = category === 'Armor';
    bonus2.disabled = isArmor;
    bonus2.title = isArmor ? 'Armor has no 2-bonus trade-in tier' : '';
    if (isArmor) bonus2.checked = false;
  }

  function makeDraggable(panel, handle, posKey = 'tbb_panel_pos') {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const left = e.clientX - offsetX;
      const top = e.clientY - offsetY;
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      store.set(posKey, { left: panel.style.left, top: panel.style.top });
    });
  }

  let latestCachePrices = [];
  let latestBBSummary = { avg: null, min: null, max: null };
  let latestItemsIndex = null; // { list, byName, byId } from Torn.itemsIndexed(), used by the DOM tagger

  // Floating modal shown whenever a weapon/armor's "View Info" detail
  // panel is open (see scanForItemInfoPanels/isPanelActive below) -
  // separate from the main calculator panel so it can be repositioned
  // independently.
  let itemModal = null;

  function buildItemModal() {
    const modal = document.createElement('div');
    modal.id = 'tbb-item-modal';
    modal.style.display = 'none';
    const pos = store.get('tbb_item_modal_pos', null);
    if (pos) { modal.style.top = pos.top; modal.style.left = pos.left; }

    modal.innerHTML = `
      <div id="tbb-item-modal-header">
        <strong id="tbb-item-modal-title">Item</strong>
        <button id="tbb-item-modal-close" title="Hide">&#8211;</button>
      </div>
      <div id="tbb-item-modal-body">
        <div class="tbb-item-modal-row"><span>Bunker trade-in</span><strong id="tbb-item-modal-bb">—</strong></div>
        <div class="tbb-item-modal-row"><span>Market value (weav3r)</span><strong id="tbb-item-modal-market">—</strong></div>
        <div class="tbb-item-modal-row"><span>This listing</span><strong id="tbb-item-modal-listing">—</strong></div>
        <div id="tbb-item-modal-verdict" class="tbb-neutral"></div>
        <div id="tbb-item-modal-notes"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#tbb-item-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    makeDraggable(modal, modal.querySelector('#tbb-item-modal-header'), 'tbb_item_modal_pos');
    itemModal = modal;
  }

  function renderCacheTable(panel, cachePrices, summary) {
    const container = panel.querySelector('#tbb-cache-table');
    const rows = cachePrices
      .map((c) => {
        const bbVal = c.bbValue ? fmtMoney(c.bbValue) : '—';
        const cheapest = c.cheapest ? fmtMoney(c.cheapest) : (c.error ? 'error' : '—');
        return `<tr><td>${c.itemName}</td><td>${c.bbCost} BB</td><td>${cheapest}</td><td>${bbVal}</td></tr>`;
      })
      .join('');

    container.innerHTML = `
      <table class="tbb-table">
        <thead><tr><th>Cache</th><th>BB cost</th><th>Cheapest</th><th>$/BB</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="tbb-note">
        Avg $/BB: <strong>${fmtMoney(summary.avg)}</strong> &nbsp;|&nbsp;
        Conservative (cheapest cache): <strong>${fmtMoney(summary.min)}</strong>
      </div>
    `;

    const bbPriceInput = panel.querySelector('#tbb-bbprice');
    const override = getBbPriceOverride();
    if (override) {
      bbPriceInput.value = override;
    } else if (summary.avg) {
      bbPriceInput.placeholder = Math.round(summary.avg).toLocaleString('en-US');
    }
  }

  function currentBBPrice() {
    const override = getBbPriceOverride();
    if (override) return override;
    return latestBBSummary.avg;
  }

  function runCalculator(panel) {
    const category = panel.querySelector('#tbb-category').value;
    const rarity = panel.querySelector('#tbb-rarity').value;
    const bonus2 = panel.querySelector('#tbb-bonus2').checked;
    const sellRaw = panel.querySelector('#tbb-sellprice').value.replace(/[^0-9.]/g, '');
    const sellPrice = sellRaw ? parseFloat(sellRaw) : null;

    const bbPrice = currentBBPrice();
    const bbCount = bbCountFor(category, rarity, bonus2 ? 2 : 1);
    const verdict = panel.querySelector('#tbb-verdict');

    if (!bbCount) {
      verdict.className = 'tbb-neutral';
      verdict.textContent = 'No 2-bonus trade-in tier for this category at this rarity.';
      return;
    }
    if (!bbPrice) {
      verdict.className = 'tbb-neutral';
      verdict.textContent = 'No BB price available yet - refresh or set one manually.';
      return;
    }

    const tradeInValue = bbCount * bbPrice;

    if (sellPrice === null || Number.isNaN(sellPrice)) {
      verdict.className = 'tbb-neutral';
      verdict.textContent = `Trade-in: ${bbCount} BB ≈ ${fmtMoney(tradeInValue)}. Enter a sell price to compare.`;
      return;
    }

    const diff = tradeInValue - sellPrice;
    if (Math.abs(diff) < sellPrice * 0.02) {
      verdict.className = 'tbb-neutral';
      verdict.textContent = `About even: trade-in ${fmtMoney(tradeInValue)} vs sell ${fmtMoney(sellPrice)}.`;
    } else if (diff > 0) {
      verdict.className = 'tbb-good';
      verdict.textContent = `Trade in for ${bbCount} BB (${fmtMoney(tradeInValue)}) — beats selling by ${fmtMoney(diff)}.`;
    } else {
      verdict.className = 'tbb-bad';
      verdict.textContent = `Sell instead (${fmtMoney(sellPrice)}) — trade-in only worth ${fmtMoney(tradeInValue)}.`;
    }
  }

  function wirePanelEvents(panel) {
    panel.querySelector('#tbb-collapse').addEventListener('click', () => {
      const body = panel.querySelector('#tbb-body');
      body.classList.toggle('tbb-collapsed');
    });

    panel.querySelector('#tbb-settings').addEventListener('click', () => {
      const current = getApiKey();
      const next = prompt(
        'Enter your Torn API key (Public access level is enough).\nUsed only for direct calls to api.torn.com from this browser.',
        current
      );
      if (next !== null) {
        setApiKey(next);
        refreshPrices(panel);
      }
    });

    panel.querySelector('#tbb-refresh').addEventListener('click', () => refreshPrices(panel));

    panel.querySelector('#tbb-bbprice').addEventListener('change', (e) => {
      const val = e.target.value.replace(/[^0-9.]/g, '');
      setBbPriceOverride(val ? parseFloat(val) : null);
      runCalculator(panel);
    });
    panel.querySelector('#tbb-bbprice-reset').addEventListener('click', () => {
      setBbPriceOverride(null);
      panel.querySelector('#tbb-bbprice').value = '';
      renderCacheTable(panel, latestCachePrices, latestBBSummary);
      runCalculator(panel);
    });

    for (const id of ['tbb-category', 'tbb-rarity', 'tbb-bonus2', 'tbb-sellprice']) {
      const el = panel.querySelector(`#${id}`);
      el.addEventListener('input', () => runCalculator(panel));
      el.addEventListener('change', () => runCalculator(panel));
    }
    panel.querySelector('#tbb-category').addEventListener('change', () => updateBonus2Availability(panel));
  }

  async function refreshPrices(panel) {
    const refreshBtn = panel.querySelector('#tbb-refresh');
    refreshBtn.classList.add('tbb-refresh-spin');
    try {
      if (!getApiKey()) {
        panel.querySelector('#tbb-cache-table').innerHTML =
          '<div class="tbb-note">Set your Torn API key (gear icon) to pull official market prices. weav3r-only data still loads without one.</div>';
      }
      const [items, prices] = await Promise.all([
        Torn.itemsIndexed().catch(() => null),
        getCachePrices(),
      ]);
      latestItemsIndex = items;
      latestCachePrices = prices;
      latestBBSummary = summarizeBB(latestCachePrices);
      renderCacheTable(panel, latestCachePrices, latestBBSummary);
      runCalculator(panel);
      runScans(); // retry anything the page-scan couldn't evaluate before this data was ready
    } catch (e) {
      panel.querySelector('#tbb-cache-table').innerHTML = `<div class="tbb-note">Error: ${e.message}</div>`;
    } finally {
      refreshBtn.classList.remove('tbb-refresh-spin');
    }
  }

  // ------------------------------------------------------------------
  // Page detection
  // ------------------------------------------------------------------

  function isItemMarketPage() {
    return (
      (location.pathname === '/page.php' && location.search.includes('sid=ItemMarket')) ||
      location.pathname.startsWith('/imarket.php')
    );
  }
  function isBazaarPage() {
    return location.pathname.startsWith('/bazaar.php');
  }
  function isBunkerPage() {
    return location.pathname === '/page.php' && location.search.includes('sid=bunker');
  }
  function isAuctionHousePage() {
    return location.pathname.startsWith('/amarket.php');
  }

  function relevantPage() {
    return isItemMarketPage() || isBazaarPage() || isBunkerPage() || isAuctionHousePage();
  }

  // ------------------------------------------------------------------
  // DOM tagging shared helpers
  //
  // Confirmed against real markup from the Item Market and Bazaar pages.
  // Rarity is NOT rendered as visible text on either page - it's a
  // "glow-<color>" class on the item image - and bonuses are marked by
  // a "data-bonus-attachment-title" attribute (which correctly excludes
  // the damage/accuracy stat icons, which look similar but lack it).
  // Both markers are plain, non-hashed conventions shared across pages.
  //
  // The outer listing container IS a hashed CSS-module class (e.g.
  // "itemTile___smVqb" / "itemDescription___TknAN"), so only its stable
  // prefix (before "___") is matched - the hash suffix changes on every
  // Torn deploy but the prefix tracks the source component name.
  //
  // Big Al's Bunker (page.php?sid=bunker) hasn't been sampled yet, so
  // this may not tag anything there until its markup is confirmed too.
  // ------------------------------------------------------------------

  const CONTAINER_SELECTOR = '[class*="itemTile___"], [class*="itemDescription___"]';
  const taggedElements = new WeakSet();
  const skippedElements = new WeakSet();

  function byTestIdOrClassPrefix(root, testId, classPrefixes) {
    const byTestId = root.querySelector(`[data-testid="${testId}"]`);
    if (byTestId) return byTestId;
    for (const prefix of classPrefixes) {
      const el = root.querySelector(`[class*="${prefix}___"]`);
      if (el) return el;
    }
    return null;
  }

  function detectRarity(container) {
    const el = container.querySelector(
      '[class*="glow-yellow"], [class*="glow-orange"], [class*="glow-red"]'
    );
    const m = el?.className.match(/glow-(yellow|orange|red)/i);
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
  }

  function parsePrice(text) {
    const m = (text || '').match(/\$\s?[\d,]+/);
    return m ? parseFloat(m[0].replace(/[^0-9.]/g, '')) : null;
  }

  // The item ID is embedded in the "View Info" button's aria-controls
  // (e.g. "wai-itemInfo-657") and in the detail panel's own id
  // ("wai-itemInfo-657-<instance>"). Preferred over name matching since
  // it can't be thrown off by punctuation/casing differences.
  function itemIdFromAriaControls(value) {
    const m = (value || '').match(/wai-itemInfo-(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function categoryForItem({ id, name }) {
    const item =
      (id != null && latestItemsIndex?.byId.get(id)) ||
      (name && latestItemsIndex?.byName.get(name));
    if (!item) return null;
    if (item.type === 'Armor') return 'Armor';
    if (item.type === 'Weapon' && item.sub_type) return item.sub_type;
    return null;
  }

  // ------------------------------------------------------------------
  // Item Market / Bazaar - highlight potentially profitable buys
  //
  // A quiet visual cue rather than another text badge: green-highlight
  // a whole tile when buying it at the listed price and immediately
  // trading it in for Bunker Bucks would net more than it cost. Unlike
  // the removed sell-vs-trade-in badge, this only marks the good case -
  // no highlight is shown for listings that aren't worth it.
  // ------------------------------------------------------------------

  function evaluateTileProfitability(container, rarity) {
    const bonusCount = container.querySelectorAll('[data-bonus-attachment-title]').length;
    const nameEl = byTestIdOrClassPrefix(container, 'name', ['name']);
    const priceEl = byTestIdOrClassPrefix(container, 'price', ['priceAndTotal', 'price']);
    if (!nameEl || !priceEl) return null;

    const controlsEl = container.querySelector('[aria-controls^="wai-itemInfo-"]');
    const id = itemIdFromAriaControls(controlsEl?.getAttribute('aria-controls'));
    const category = categoryForItem({ id, name: nameEl.textContent.trim() });
    const price = parsePrice(priceEl.textContent);
    if (!category || !price) return null;

    const bbCount = bbCountFor(category, rarity, bonusCount);
    const bbPrice = currentBBPrice();
    if (!bbCount || !bbPrice) return null;

    return { price, bbCount, tradeInValue: bbCount * bbPrice };
  }

  function highlightTile(container, result) {
    container.classList.add('tbb-profitable-tile');
    container.title = `Bunker trade-in: ${result.bbCount} BB ≈ ${fmtMoney(result.tradeInValue)} vs buy price ${fmtMoney(result.price)} - profit of ${fmtMoney(result.tradeInValue - result.price)} if traded in`;
  }

  function scanForProfitableTiles(root) {
    if (!isItemMarketPage() && !isBazaarPage()) return;

    for (const container of root.querySelectorAll(CONTAINER_SELECTOR)) {
      if (taggedElements.has(container) || skippedElements.has(container)) continue;
      try {
        const rarity = detectRarity(container);
        if (!rarity) {
          skippedElements.add(container); // not a ranked/bonus item - never becomes one
          continue;
        }
        const result = evaluateTileProfitability(container, rarity);
        if (!result) continue; // e.g. items index not loaded yet - retry next scan
        if (result.tradeInValue > result.price) highlightTile(container, result);
        taggedElements.add(container); // decided either way - price won't change for this listing
      } catch (e) {
        console.warn('[BB Calc] failed to evaluate tile profitability', e, container);
        skippedElements.add(container);
      }
    }
  }

  // ------------------------------------------------------------------
  // Auction House (amarket.php) - max profitable bid hint
  //
  // This page is NOT the React redesign the Item Market/Bazaar use -
  // it's Torn's older server-rendered markup with plain, stable class
  // names (no hashed "___xxxxx" suffixes at all here). Each listing is
  // an <li id="..."> inside ul.items-list, carrying an "item" attribute
  // with the numeric item ID directly - no need to parse it out of an
  // aria-controls/href string. Real weapon bonuses live in
  // ".iconsbonuses .bonus-attachment-icons"; the damage/accuracy stat
  // icons use a visually similar but differently-named ".bonus-attachment"
  // wrapper (no "-icons" suffix), which is what distinguishes them.
  //
  // The ceiling shown doesn't need the current bid at all: it's just
  // the Bunker trade-in value for that rarity/bonus combo, since paying
  // more than that guarantees a loss versus just trading the item in.
  // The current bid (".c-bid-wrap") is read only to flag when it has
  // already exceeded that ceiling.
  // ------------------------------------------------------------------

  const AUCTION_LISTING_SELECTOR = 'ul.items-list > li[id]';

  function auctionListingId(li) {
    const withAttr = li.querySelector('[item]');
    const attrId = parseInt(withAttr?.getAttribute('item'), 10);
    if (!Number.isNaN(attrId)) return attrId;
    const link = li.querySelector('a[href*="iteminfo.php?ID="]');
    const m = link?.getAttribute('href').match(/ID=(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function evaluateAuctionListing(li) {
    const rarity = detectRarity(li);
    if (!rarity) return null;

    const bonusCount = li.querySelectorAll('.bonus-attachment-icons').length;
    const id = auctionListingId(li);
    const name = li.querySelector('.item-name')?.textContent.trim();
    const category = categoryForItem({ id, name });
    if (!category) return null;

    const bbCount = bbCountFor(category, rarity, bonusCount);
    const bbPrice = currentBBPrice();
    if (!bbCount || !bbPrice) return null;

    const currentBid = parsePrice(li.querySelector('.c-bid-wrap')?.textContent);
    return { bbCount, tradeInValue: bbCount * bbPrice, currentBid };
  }

  // Appended at the end of the <li> rather than spliced in between the
  // row's other children: this page lays listings out with floats (the
  // "clear" div alongside it is a classic clearfix), and inserting a
  // new element mid-row broke that flow. clear:both + full width in
  // the CSS keeps it a clean line below the row regardless.
  function tagAuctionListing(li, result) {
    const overThreshold = result.currentBid != null && result.currentBid >= result.tradeInValue;
    const badge = document.createElement('div');
    badge.className = 'tbb-badge tbb-auction-hint ' + (overThreshold ? 'tbb-bad' : 'tbb-bid-hint');
    badge.title = `Bunker trade-in value for this rarity/bonus: ${result.bbCount} BB`;
    badge.textContent = overThreshold
      ? `Current bid already exceeds max profitable bid of ${fmtMoney(result.tradeInValue)}`
      : `Max profitable bid: ${fmtMoney(result.tradeInValue)}`;
    li.appendChild(badge);
    return badge;
  }

  // Cheap fingerprint of what's currently rendered in this row. Paging
  // through the Auction House reuses the same <li> nodes and rewrites
  // their content via AJAX rather than creating fresh ones, so a plain
  // "have I seen this node before" check (as used elsewhere in this
  // file) goes stale the moment the node is recycled for a different
  // item - this re-checks on every scan and only skips redoing the
  // work when the row's content actually hasn't changed.
  function auctionListingSignature(li) {
    const bid = li.querySelector('.c-bid-wrap')?.textContent.trim() || '';
    return `${auctionListingId(li)}|${bid}`;
  }

  const auctionRowState = new WeakMap(); // li -> { signature, badge }

  function scanAuctionListings(root) {
    if (!isAuctionHousePage()) return;

    for (const li of root.querySelectorAll(AUCTION_LISTING_SELECTOR)) {
      const signature = auctionListingSignature(li);
      const prev = auctionRowState.get(li);
      if (prev && prev.signature === signature) continue; // row unchanged since last pass

      if (prev?.badge) prev.badge.remove(); // stale badge from before this node got recycled

      try {
        // Not a ranked item at all - genuinely permanent, safe to stop
        // rechecking until the row's content itself changes.
        if (!detectRarity(li)) {
          auctionRowState.set(li, { signature, badge: null });
          continue;
        }

        const result = evaluateAuctionListing(li);
        if (!result) continue; // transient (price/items index not loaded yet) - retry, don't lock in
        auctionRowState.set(li, { signature, badge: tagAuctionListing(li, result) });
      } catch (e) {
        console.warn('[BB Calc] failed to evaluate auction listing', e, li);
        auctionRowState.set(li, { signature, badge: null });
      }
    }
  }

  // ------------------------------------------------------------------
  // Item detail ("View Info") panel
  //
  // Opened by clicking the (i) icon on a tile. Rarity lives in the
  // "Quality:" row as a "<color>___<hash>" class - a different
  // convention than the tile's "glow-<color>" - and each real
  // weapon/armor bonus gets its own row labelled exactly "Bonus:".
  // Counting those rows is more precise than counting bonus icons here,
  // since (unlike on the tile) this panel's bonus icons don't carry a
  // distinguishing attribute to tell them apart from the damage/
  // accuracy/quality/coverage stat icons, which reuse similar classes.
  // ------------------------------------------------------------------

  const ITEM_INFO_SELECTOR = '[id^="wai-itemInfo-"]';

  function propertyRows(panel, label) {
    const rows = [];
    for (const titleEl of panel.querySelectorAll('[class*="title___"]')) {
      if (titleEl.textContent.trim().toLowerCase() === label.toLowerCase()) {
        rows.push(titleEl.parentElement);
      }
    }
    return rows;
  }

  function detectRarityFromQualityRow(panel) {
    for (const row of propertyRows(panel, 'Quality:')) {
      for (const el of row.querySelectorAll('[class]')) {
        const match = [...el.classList].find((c) => /^(yellow|orange|red)___/i.test(c));
        if (match) {
          const color = match.split('___')[0];
          return color[0].toUpperCase() + color.slice(1).toLowerCase();
        }
      }
    }
    return null;
  }

  // The same "Quality:" row also carries the exact quality % (e.g.
  // "122.64%"). Rarity color alone spans a huge value range - a
  // rock-bottom yellow and a top-of-tier yellow can be worlds apart in
  // price - so this is needed to find genuinely comparable listings
  // rather than everything sharing just the same color.
  function detectQualityPercent(panel) {
    for (const row of propertyRows(panel, 'Quality:')) {
      const m = row.textContent.match(/(-?\d+(?:\.\d+)?)%/);
      if (m) return parseFloat(m[1]);
    }
    return null;
  }

  // "Bonus:" rows carry an aria-label like "17% Execute Bonus" on their
  // value span - both the name and its numeric % drive price heavily
  // within a given weapon/rarity (e.g. Execute vs. a filler bonus), so
  // both are used to narrow the market-value comparison further.
  function detectBonuses(panel) {
    const bonuses = [];
    for (const row of propertyRows(panel, 'Bonus:')) {
      const label = row.querySelector('[aria-label]')?.getAttribute('aria-label');
      const m = label?.match(/(\d+(?:\.\d+)?)%\s+(.+?)\s+Bonus/i);
      if (m) bonuses.push({ bonus: m[2], value: parseFloat(m[1]) });
    }
    return bonuses;
  }

  // Generic reader for simple numeric property rows like "Damage:" and
  // "Accuracy:" - both are plain numbers with no unit/suffix to strip.
  function detectStatValue(panel, label) {
    for (const row of propertyRows(panel, label)) {
      const m = row.textContent.match(/(-?\d+(?:\.\d+)?)/);
      if (m) return parseFloat(m[1]);
    }
    return null;
  }

  // The detail panel doesn't repeat the specific listing's price, so
  // this prefers the price off the tile that was expanded to open it
  // (an adjacent list item) and falls back to the panel's own "Value:"
  // row (Torn's average market value) if no such tile is found.
  function findComparisonPrice(panel) {
    let sib = panel.closest('li')?.previousElementSibling;
    for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
      const tile = sib.matches?.(CONTAINER_SELECTOR) ? sib : sib.querySelector?.(CONTAINER_SELECTOR);
      const priceEl = tile && byTestIdOrClassPrefix(tile, 'price', ['priceAndTotal', 'price']);
      if (priceEl) return { price: parsePrice(priceEl.textContent), label: 'this listing' };
    }
    for (const row of propertyRows(panel, 'Value:')) {
      const price = parsePrice(row.textContent);
      if (price) return { price, label: 'avg. value - no exact listing price found' };
    }
    return null;
  }

  // itemName comes off the already-resolved id via latestItemsIndex
  // rather than scraping it from the description sentence ("The X is
  // a ... Weapon."), which would need fragile trimming/punctuation
  // handling for no benefit - the id is already authoritative.
  function evaluateItemInfoPanel(panel) {
    const id = itemIdFromAriaControls(panel.id);
    const rarity = detectRarityFromQualityRow(panel);
    if (!id || !rarity) return null;

    const bonusCount = propertyRows(panel, 'Bonus:').length;
    const bonuses = bonusCount ? detectBonuses(panel) : [];
    const category = categoryForItem({ id });
    const itemName = latestItemsIndex?.byId.get(id)?.name;
    const priceInfo = findComparisonPrice(panel);
    if (!category || !itemName || !priceInfo) return null;

    const bbCount = bbCountFor(category, rarity, bonusCount);
    const bbPrice = currentBBPrice();
    if (!bbCount || !bbPrice) return null;

    return {
      itemName,
      rarity,
      category,
      qualityPercent: detectQualityPercent(panel),
      damage: detectStatValue(panel, 'Damage:'),
      accuracy: detectStatValue(panel, 'Accuracy:'),
      bonuses,
      listingPrice: priceInfo.price,
      priceLabel: priceInfo.label,
      bbCount,
      tradeInValue: bbCount * bbPrice,
    };
  }

  // A tile's own "View Info" button carries aria-expanded, toggling
  // true/false as that specific listing's panel opens/closes. This is
  // the panel's originating tile (same lookup as findComparisonPrice),
  // so it's used as the live "is this panel actually the one currently
  // selected for details" signal - panels don't get untagged/removed
  // from the DOM when closed, only visually collapsed.
  function isPanelActive(panel) {
    let sib = panel.closest('li')?.previousElementSibling;
    for (let i = 0; i < 3 && sib; i++, sib = sib.previousElementSibling) {
      const tile = sib.matches?.(CONTAINER_SELECTOR) ? sib : sib.querySelector?.(CONTAINER_SELECTOR);
      const trigger = tile?.querySelector('[aria-controls^="wai-itemInfo-"]');
      if (trigger) return trigger.getAttribute('aria-expanded') === 'true';
    }
    return false;
  }

  // Fallback path only: a blind rarity-color match (e.g. "all yellow
  // BT MP9") is far too broad - yellow alone spans a huge quality
  // range, and one stale or bugged rock-bottom listing can badly skew
  // a plain minimum - so this narrows to quality% within a small
  // tolerance band, and tries the detected bonus name first before
  // falling back to quality-only if that combination returns nothing
  // (e.g. a naming mismatch between Torn's display name and weav3r's
  // bonus filter values). Armor uses "armorPiece" instead of
  // "weaponName" per weav3r's contract.
  async function fetchRankedWeaponsEstimate({ category, itemName, rarity, qualityPercent, bonuses }) {
    const baseParams =
      category === 'Armor'
        ? { tab: 'armor', armorPiece: itemName, rarity: rarity.toLowerCase() }
        : { tab: 'weapons', weaponName: itemName, rarity: rarity.toLowerCase() };
    if (qualityPercent != null) {
      baseParams.minQuality = Math.max(0, qualityPercent - 3);
      baseParams.maxQuality = qualityPercent + 3;
    }

    const query = async (params) => {
      const weapons = await Weav3r.rankedWeapons(params);
      const prices = weapons.map((w) => w.price).filter((p) => typeof p === 'number' && p > 0);
      return prices.length ? { min: Math.min(...prices), count: prices.length } : null;
    };

    if (bonuses?.[0]?.bonus) {
      const withBonus = await query({ ...baseParams, bonus1: bonuses[0].bonus.toLowerCase() });
      if (withBonus) return withBonus;
    }
    return query(baseParams); // fall back to quality-matched, any bonus
  }

  // Prefers weav3r's undocumented /rw-value endpoint (see Weav3r.rwValue
  // above): it draws on real auction sales history rather than just
  // current asks, which is a materially better answer to "what's this
  // actually worth" than a live-listing minimum can be. Falls back to
  // the documented /ranked-weapons search if that ever errors or its
  // shape changes, so this feature keeps working even if the
  // undocumented endpoint disappears.
  async function fetchMarketValue(base) {
    try {
      const json = await Weav3r.rwValue({
        itemName: base.itemName,
        rarity: base.rarity,
        damage: base.damage ?? null,
        accuracy: base.accuracy ?? null,
        quality: base.qualityPercent ?? null,
        bonuses: (base.bonuses || []).slice(0, 2),
      });
      if (json?.result) {
        return {
          fairEstimate: json.result.fairEstimate ?? null,
          cheapestAsk: json.result.liveMinAsk ?? null,
          sampleSize: json.result.auctionSampleSize ?? 0,
          notes: json.assessment?.notes || [],
        };
      }
    } catch (e) {
      console.warn('[BB Calc] weav3r rw-value lookup failed, falling back', e);
    }

    try {
      const fallback = await fetchRankedWeaponsEstimate(base);
      return fallback
        ? { fairEstimate: null, cheapestAsk: fallback.min, sampleSize: fallback.count, notes: [] }
        : null;
    } catch (e) {
      console.warn('[BB Calc] weav3r ranked-weapons fallback also failed', e);
      return null;
    }
  }

  function renderItemModal(base, market, fetchingMarket) {
    if (!itemModal) return;
    itemModal.style.display = 'block';
    itemModal.querySelector('#tbb-item-modal-title').textContent = `${base.itemName} · ${base.rarity}`;
    itemModal.querySelector('#tbb-item-modal-bb').textContent = fmtMoney(base.tradeInValue);
    itemModal.querySelector('#tbb-item-modal-listing').textContent =
      base.listingPrice != null ? `${fmtMoney(base.listingPrice)} (${base.priceLabel})` : '—';

    const marketEl = itemModal.querySelector('#tbb-item-modal-market');
    if (fetchingMarket) {
      marketEl.textContent = 'Loading…';
    } else if (market?.fairEstimate != null) {
      marketEl.textContent = `${fmtMoney(market.fairEstimate)} (${market.sampleSize} recent sales)`;
    } else if (market?.cheapestAsk != null) {
      marketEl.textContent = `${fmtMoney(market.cheapestAsk)} cheapest ask (${market.sampleSize} comps)`;
    } else {
      marketEl.textContent = 'No comparable listings found';
    }

    const notesEl = itemModal.querySelector('#tbb-item-modal-notes');
    if (market?.notes?.length) {
      notesEl.textContent = market.notes.join(' ');
      notesEl.style.display = 'block';
    } else {
      notesEl.style.display = 'none';
    }

    const verdictEl = itemModal.querySelector('#tbb-item-modal-verdict');
    const reference = market?.fairEstimate ?? market?.cheapestAsk ?? (fetchingMarket ? null : base.listingPrice);
    if (reference == null) {
      verdictEl.className = 'tbb-neutral';
      verdictEl.textContent = fetchingMarket ? 'Comparing against market…' : 'Not enough data to compare.';
    } else if (base.tradeInValue > reference) {
      verdictEl.className = 'tbb-good';
      verdictEl.textContent = `Bunker trade-in beats market by ${fmtMoney(base.tradeInValue - reference)}`;
    } else {
      verdictEl.className = 'tbb-bad';
      verdictEl.textContent = `Market value beats Bunker trade-in by ${fmtMoney(reference - base.tradeInValue)}`;
    }
  }

  function hideItemModal() {
    if (itemModal) itemModal.style.display = 'none';
  }

  const modalStateByPanel = new WeakMap(); // panel -> { base, marketValue, fetching }

  function scanForItemInfoPanels(root) {
    if (!relevantPage()) return;

    const activePanel = Array.from(root.querySelectorAll(ITEM_INFO_SELECTOR)).find(isPanelActive);
    if (!activePanel) {
      hideItemModal();
      return;
    }

    let state = modalStateByPanel.get(activePanel);
    if (!state) {
      let base;
      try {
        base = evaluateItemInfoPanel(activePanel);
      } catch (e) {
        console.warn('[BB Calc] failed to evaluate item info panel', e, activePanel);
        return;
      }
      if (!base) return; // retry next scan - e.g. items index not loaded yet
      state = { base, marketValue: undefined, fetching: false };
      modalStateByPanel.set(activePanel, state);
    }

    if (state.marketValue === undefined && !state.fetching) {
      state.fetching = true;
      fetchMarketValue(state.base).then((marketValue) => {
        state.marketValue = marketValue;
        state.fetching = false;
        if (isPanelActive(activePanel)) renderItemModal(state.base, marketValue, false);
      });
    }

    renderItemModal(state.base, state.marketValue, state.fetching);
  }

  // Also called directly from refreshPrices(): a row that couldn't be
  // evaluated because pricing/category data wasn't loaded yet isn't
  // retried until something re-scans it, and relying solely on
  // incidental DOM mutations isn't reliable here - e.g. the Auction
  // House's countdown timers likely update via text changes, which
  // the observer below (childList only) doesn't even watch for.
  function runScans() {
    try {
      scanForProfitableTiles(document.body);
      scanAuctionListings(document.body);
      scanForItemInfoPanels(document.body);
    } catch (e) {
      console.warn('[BB Calc] scan error', e);
    }
  }

  function startDomWatcher() {
    const debouncedScan = debounce(runScans, 800);
    const observer = new MutationObserver(debouncedScan);
    observer.observe(document.body, { childList: true, subtree: true });
    debouncedScan();
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // ------------------------------------------------------------------
  // Menu commands
  // ------------------------------------------------------------------

  GM_registerMenuCommand('Bunker Calc: Set Torn API key', () => {
    const next = prompt('Torn API key (Public access level is enough):', getApiKey());
    if (next !== null) setApiKey(next);
  });
  GM_registerMenuCommand('Bunker Calc: Clear cached data', () => {
    store.set('tbb_items_cache', null);
    store.set('tbb_weav3r_marketplace_cache', null);
    store.set('tbb_itemmarket_cache', null);
    alert('Cached item list and prices cleared. Refresh the page.');
  });

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------

  function init() {
    if (!relevantPage()) return;
    const panel = buildPanel();
    buildItemModal();
    refreshPrices(panel);
    startDomWatcher();
    setInterval(() => refreshPrices(panel), PRICE_CACHE_TTL_MS);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
  }
})();
