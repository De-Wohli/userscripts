// ==UserScript==
// @name         Torn - Big Al's Bunker Buck Calculator
// @namespace    https://github.com/torn-bunker-bb-calculator
// @version      0.7.0
// @description  Live cache prices + Bunker Buck value calculator for Big Al's Bunker. Highlights profitable buys on the Item Market/Bazaar, shows a floating Bunker-vs-market comparison (backed by weav3r's real auction sales history) when an item's detail view is open, and max profitable bid hints on the Auction House. Uses weav3r.dev and the official Torn API.
// @author       De-Wohli
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
