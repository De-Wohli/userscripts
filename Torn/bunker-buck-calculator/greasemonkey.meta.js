// ==UserScript==
// @name         Torn - Big Al's Bunker Buck Calculator
// @namespace    https://github.com/torn-bunker-bb-calculator
// @version      0.8.2
// @description  Live cache prices + Bunker Buck value calculator for Big Al's Bunker. Shows an integrated value line (Bunker Bucks vs. weav3r's real market sales, whichever is higher) directly in a weapon/armor's detail view on the Item Market, Bazaar, and Auction House. Uses weav3r.dev and the official Torn API.
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
