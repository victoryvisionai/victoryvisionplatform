/* Victory Bot: the in-app guide, shared by every member page.
 *
 * Shows the one or two next actions for the signed-in member (victory_bot_next), scrolls them across the chest
 * plate, and takes the member there in two clicks: the bullet opens the page, then the button to press lights up.
 * Also records page visits (victory_bot_event). A link with ?vb=<key> (from the bot or an email) lights up the
 * same button on arrival.
 *
 * LIVE = 0 shows the bot to team accounts only (or to anyone with ?vbot=1). Set LIVE = 1 for every member.
 * Team accounts can add ?vbot_as=<member email> to see what that member would see.
 * Fails open: any error here leaves the page exactly as it was.
 */
(function (w, d) {
  'use strict';
  if (w.VVBot) return;

  var LIVE = 0;
  var SB = 'https://nyyvsdkumxvuwimmucdb.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eXZzZGt1bXh2dXdpbW11Y2RiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3MzY5OTQsImV4cCI6MjA1OTMxMjk5NH0.7m7R_8mBhp7X8itl5cR81xbX2AjJUm2SIPR0FUv6ouU';
  var TEAM = ['andrew@victoryvisionai.com', 'glaze@vvdoh.com', 'glaze@equitablecap.com'];
  var NAVY = '#0B3063', RED = '#BA1340';

  // Where each action lands: an optional first step to click for the member, then the button to light up.
  var CAT = {
    profile:  { sel: '#dcSaveBtn' },
    drafts:   { pre: '#tab-drafts', sel: '[onclick*="sendDraftAsIs"]' },
    deals:    { sel: '[onclick*="expressInterest"]' },
    gmail:    { txt: 'gmail' },
    contacts: { txt: 'import' },
    campaign: { sel: '#createCampaignBtn' },
    ai:       { sel: '#refreshPriorityBtn' }
  };

  var HOOK = 'https://victoryvision.app.n8n.cloud/webhook/bot/chat';
  var URLS = { profile: '/companyprofile', drafts: '/messages', deals: '/deals', gmail: '/settings', contacts: '/contacts', campaign: '/campaigns', ai: '/ai' };
  var NAMES = { profile: 'Review my profile', drafts: 'Open my drafts', deals: 'See my deals', gmail: 'Connect Gmail', contacts: 'Add contacts', campaign: 'Launch a campaign', ai: 'See my top move' };

  function qs(k) { var m = new RegExp('[?&]' + k + '=([^&#]*)').exec(location.search); return m ? decodeURIComponent(m[1]) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fix(s) { return String(s || '').replace(/^1 new deals$/, '1 new deal'); }
  function here(url) { return location.pathname.replace(/\.html$/, '').replace(/\/$/, '') === url; }

  function token() {
    try {
      var raw = w.localStorage.getItem('sb-nyyvsdkumxvuwimmucdb-auth-token');
      if (!raw) return null;
      var j = JSON.parse(raw), s = j.currentSession || j;
      if (!s || !s.access_token) return null;
      return { t: s.access_token, email: String((s.user || {}).email || '').toLowerCase() };
    } catch (e) { return null; }
  }
  function rpc(fn, body) {
    var tk = token();
    if (!tk || !w.fetch) return Promise.resolve(null);
    return w.fetch(SB + '/rest/v1/rpc/' + fn, {
      method: 'POST', keepalive: true,
      headers: { apikey: ANON, Authorization: 'Bearer ' + tk.t, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.ok ? r.json().catch(function () { return null; }) : null; }).catch(function () { return null; });
  }
  function ev(a, k) { try { rpc('victory_bot_event', { p_action: a, p_key: k || null, p_page: location.pathname }); } catch (e) {} }

  function findTarget(c) {
    var el = c.sel ? d.querySelector(c.sel) : null;
    if (!el && c.txt) {
      var all = d.querySelectorAll('button, a.btn, a.button, [role="button"]');
      for (var i = 0; i < all.length; i++) {
        var t = (all[i].textContent || '').toLowerCase();
        if (t.indexOf(c.txt) >= 0 && !/disconnect/.test(t) && all[i].offsetParent !== null) { el = all[i]; break; }
      }
    }
    return el && el.offsetParent !== null ? el : null;
  }
  function waitFor(fn, ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function tick() {
        var v = null; try { v = fn(); } catch (e) {}
        if (v) return res(v);
        if (Date.now() - t0 > ms) return res(null);
        setTimeout(tick, 350);
      })();
    });
  }
  function guide(key) {
    var c = CAT[key]; if (!c) return;
    ev('bot_arrive', key);
    var step = Promise.resolve();
    if (c.pre) step = waitFor(function () { return d.querySelector(c.pre); }, 8000).then(function (p) { if (p) { try { p.click(); } catch (e) {} } });
    step.then(function () { return waitFor(function () { return findTarget(c); }, 12000); }).then(function (el) {
      if (!el) return;
      try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
      el.classList.add('vvbot-target');
      var tag = d.createElement('div'); tag.className = 'vvbot-tag'; tag.textContent = 'Click here';
      d.body.appendChild(tag);
      function place() { var r = el.getBoundingClientRect(); tag.style.top = (w.scrollY + r.top - 34) + 'px'; tag.style.left = (w.scrollX + r.left) + 'px'; }
      place();
      var iv = setInterval(place, 400);
      function done() { clearInterval(iv); el.classList.remove('vvbot-target'); if (tag.parentNode) tag.parentNode.removeChild(tag); }
      el.addEventListener('click', function () { ev('bot_done', key); done(); }, { once: true });
      setTimeout(done, 90000);
    });
  }

  function botSvg(u, rank) {
    var O = '#5E6876', L = '#DDE2E9', M = '#C2C9D3', hot = u >= 3;
    var face = u >= 2 ? NAVY : '#FFFFFF', vee = hot ? '#FF4D5E' : (u === 2 ? '#FFFFFF' : NAVY), trim = hot ? RED : NAVY;
    var ys = rank >= 3 ? [179, 187, 195] : rank === 2 ? [182, 191] : [186], chev = '';
    for (var i = 0; i < ys.length; i++) { var y = ys[i]; chev += 'M-109 ' + y + ' L-97 ' + (y + 8) + ' L-85 ' + y + ' M109 ' + y + ' L97 ' + (y + 8) + ' L85 ' + y + ' '; }
    var logo = '<path d="M166 268 L18 10 L128 10 L256 226" stroke="' + RED + '"/><path d="M82 20 L219 258 L251 258 L366 10 L330 10" stroke="' + NAVY + '"/><path d="M170 10 L296 10 L240 130" stroke="' + RED + '"/>';
    var crest = hot ? '-5,6 5,6 2,-18 -2,-18' : (u === 2 ? '-4,6 4,6 2,-9 -2,-9' : '-4,6 4,6 2,-2 -2,-2');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-132 -22 264 232" width="160" height="141" aria-hidden="true">' +
      '<polygon points="-96,204 -92,166 -60,148 -22,140 22,140 60,148 92,166 96,204" fill="' + M + '" stroke="' + O + '" stroke-width="1.5"/>' +
      '<polygon points="-96,204 -92,166 -60,148 -22,140 0,140 0,204" fill="' + L + '"/>' +
      '<polygon points="-14,120 14,120 18,142 -18,142" fill="#9AA3B0" stroke="' + O + '" stroke-width="1.5"/>' +
      '<polygon points="-58,150 58,150 64,160 58,204 -58,204 -64,160" fill="#FFFFFF" stroke="' + trim + '" stroke-width="2.5"/>' +
      '<polygon points="-124,180 -72,167 -72,206 -116,206" fill="' + L + '" stroke="' + O + '" stroke-width="1.5"/>' +
      '<polygon points="124,180 72,167 72,206 116,206" fill="' + M + '" stroke="' + O + '" stroke-width="1.5"/>' +
      '<path d="' + chev + '" stroke="' + trim + '" stroke-width="3" fill="none"/>' +
      '<polygon points="-128,148 -64,132 -62,160 -126,176" fill="#FFFFFF" stroke="' + trim + '" stroke-width="2"/>' +
      '<polygon points="128,148 64,132 62,160 126,176" fill="#FFFFFF" stroke="' + trim + '" stroke-width="2"/>' +
      '<g transform="translate(-112,148) skewY(-14) scale(0.08)" fill="none" stroke-width="24">' + logo + '</g>' +
      '<g transform="translate(81,139.5) skewY(14) scale(0.08)" fill="none" stroke-width="24">' + logo + '</g>' +
      '<polygon points="-26,6 26,6 46,30 42,70 16,124 -16,124 -42,70 -46,30" fill="' + L + '" stroke="' + O + '" stroke-width="1.5"/>' +
      '<polygon points="0,6 26,6 46,30 42,70 16,124 0,124" fill="' + M + '"/>' +
      '<polygon points="-40,32 -18,32 0,84 18,32 40,32 12,116 -12,116" fill="' + face + '" stroke="' + (u >= 2 ? O : NAVY) + '" stroke-width="1.5"/>' +
      '<path d="M-29 39 L0 101 L29 39" stroke="' + vee + '" stroke-width="6" fill="none"/>' +
      '<polygon points="-46,40 -54,46 -52,70 -43,68" fill="' + trim + '"/><polygon points="46,40 54,46 52,70 43,68" fill="' + trim + '"/>' +
      '<polygon points="' + crest + '" fill="' + (u === 2 ? '#FFFFFF' : trim) + '" stroke="' + O + '" stroke-width="1"/>' +
      '</svg>';
  }

  // Small head, wide chest screen: the chest is where the member looks.
  function botSvg2(u, rank) {
    var O = '#5E6876', L = '#DDE2E9', M = '#C2C9D3', hot = u >= 3;
    var face = u >= 2 ? NAVY : '#FFFFFF', vee = hot ? '#FF4D5E' : (u === 2 ? '#FFFFFF' : NAVY), trim = hot ? RED : NAVY;
    var chev = '', n = rank >= 3 ? 3 : rank === 2 ? 2 : 1, top = hot ? -6 : -3;
    for (var i = 0; i < n; i++) { var y = 191 + i * 7; chev += 'M138 ' + y + ' L150 ' + (y + 6) + ' L162 ' + y + ' '; }
    var logo = '<path d="M166 268 L18 10 L128 10 L256 226" stroke="' + RED + '"/><path d="M82 20 L219 258 L251 258 L366 10 L330 10" stroke="' + NAVY + '"/><path d="M170 10 L296 10 L240 130" stroke="' + RED + '"/>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -6 300 228" width="230" height="175" aria-hidden="true">' +
      '<polygon points="10,96 18,80 90,70 210,70 282,80 290,96 290,214 10,214" fill="' + M + '" stroke="' + O + '" stroke-width="1.5"/>' +
      '<polygon points="10,96 18,80 90,70 150,70 150,214 10,214" fill="' + L + '"/>' +
      '<polygon points="142,60 158,60 160,72 140,72" fill="#9AA3B0" stroke="' + O + '" stroke-width="1"/>' +
      '<rect x="38" y="100" width="224" height="86" rx="8" fill="#FFFFFF" stroke="' + trim + '" stroke-width="3"/>' +
      '<polygon points="12,74 78,60 80,78 14,94" fill="#FFFFFF" stroke="' + trim + '" stroke-width="2"/>' +
      '<polygon points="288,74 222,60 220,78 286,94" fill="#FFFFFF" stroke="' + trim + '" stroke-width="2"/>' +
      '<g transform="translate(33,71.5) skewY(-12) scale(0.06)" fill="none" stroke-width="26">' + logo + '</g>' +
      '<g transform="translate(245,66.5) skewY(12) scale(0.06)" fill="none" stroke-width="26">' + logo + '</g>' +
      '<path d="' + chev + '" stroke="' + trim + '" stroke-width="3" fill="none"/>' +
      '<polygon points="137,4 163,4 173,16 171,36 158,62 142,62 129,36 127,16" fill="' + L + '" stroke="' + O + '" stroke-width="1.2"/>' +
      '<polygon points="150,4 163,4 173,16 171,36 158,62 150,62" fill="' + M + '"/>' +
      '<polygon points="130,17 141,17 150,43 159,17 170,17 156,58 144,58" fill="' + face + '" stroke="' + (u >= 2 ? O : NAVY) + '" stroke-width="1"/>' +
      '<path d="M135.5 20.5 L150 51 L164.5 20.5" stroke="' + vee + '" stroke-width="3.5" fill="none"/>' +
      '<polygon points="127,20 123,23 124,35 128,34" fill="' + trim + '"/><polygon points="173,20 177,23 176,35 172,34" fill="' + trim + '"/>' +
      '<polygon points="148,4 152,4 151,' + top + ' 149,' + top + '" fill="' + (u === 2 ? '#FFFFFF' : trim) + '" stroke="' + O + '" stroke-width="0.8"/>' +
      '</svg>';
  }

  var CSS = '#vvbot{position:fixed;left:14px;bottom:10px;z-index:2147483000;display:flex;align-items:flex-end;gap:6px;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
    '#vvbot>*{pointer-events:auto}' +
    '.vvbot-bot{position:relative;width:230px;height:175px;cursor:grab;touch-action:none;user-select:none;filter:drop-shadow(0 4px 10px rgba(0,0,0,.35))}' +
    '.vvbot-bot svg{display:block;animation:vvbotBob 3.2s ease-in-out infinite}' +
    '.vvbot-chest{position:absolute;left:14.6%;width:70.8%;top:48.5%;height:33.5%;overflow:hidden;display:flex;flex-direction:column;justify-content:center;cursor:pointer;font-size:19px;font-weight:700;line-height:1.15;color:' + NAVY + ';animation:vvbotBob 3.2s ease-in-out infinite}' +
    '.vvbot-hot .vvbot-chest{color:' + RED + '}' +
    '.vvbot-chest small{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;white-space:nowrap;color:' + RED + ';margin:0 0 4px 3px}' +
    '.vvbot-chest span{display:inline-block;white-space:nowrap;padding-left:100%;animation:vvbotTick 9s linear infinite}' +
    '@keyframes vvbotTick{from{transform:translateX(0)}to{transform:translateX(-100%)}}' +
    '@keyframes vvbotBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}' +
    '.vvbot-card{position:relative;background:#fff;border:2px solid ' + NAVY + ';border-radius:10px;padding:10px 12px 8px;width:290px;max-width:calc(100vw - 30px);margin-bottom:22px;box-shadow:0 6px 18px rgba(0,0,0,.3);text-align:left}' +
    '.vvbot-hot .vvbot-card{border-color:' + RED + '}' +
    '.vvbot-h{cursor:grab;touch-action:none;user-select:none;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:' + RED + ';margin:0 18px 6px 0}' +
    '.vvbot-go{display:flex;gap:8px;align-items:center;padding:7px 8px;margin:0 -4px;border-radius:7px;text-decoration:none;color:' + NAVY + '}' +
    '.vvbot-go:hover{background:#EEF2F8}' +
    '.vvbot-n{flex:none;width:20px;height:20px;border-radius:50%;background:' + NAVY + ';color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}' +
    '.vvbot-go b{display:block;font-size:14px;font-weight:700;line-height:1.2;color:' + NAVY + '}' +
    '.vvbot-go i{display:block;font-style:normal;font-size:12px;line-height:1.3;color:#5E6876}' +
    '.vvbot-f{font-size:11px;color:#5E6876;margin-top:5px}' +
    '.vvbot-x{position:absolute;top:4px;right:6px;border:0;background:none;font-size:18px;line-height:1;color:#5E6876;cursor:pointer;padding:2px 4px}' +
    '.vvbot-target{outline:3px solid ' + RED + '!important;outline-offset:3px!important;animation:vvbotPulse 1.2s ease-in-out infinite!important}' +
    '@keyframes vvbotPulse{0%,100%{box-shadow:0 0 0 0 rgba(186,19,64,.6)}50%{box-shadow:0 0 0 12px rgba(186,19,64,0)}}' +
    '.vvbot-tag{position:absolute;z-index:2147482999;background:' + RED + ';color:#fff;font:700 12px/1 -apple-system,"Segoe UI",Arial,sans-serif;padding:6px 9px;border-radius:6px;pointer-events:none}' +
    '.vvbot-log{display:none;max-height:210px;overflow-y:auto;margin:6px -2px 0;padding:0 2px}' +
    '.vvbot-log.on{display:block}' +
    '.vvbot-m{font-size:13px;line-height:1.45;margin:6px 0;padding:7px 9px;border-radius:9px;white-space:pre-wrap;word-wrap:break-word}' +
    '.vvbot-m.q{background:' + NAVY + ';color:#fff;margin-left:26px}' +
    '.vvbot-m.a{background:#EEF2F8;color:#1B2433;margin-right:10px}' +
    '.vvbot-m.a a{display:inline-block;margin-top:6px;background:' + RED + ';color:#fff;font-weight:700;text-decoration:none;padding:5px 10px;border-radius:6px}' +
    '.vvbot-ask{display:flex;gap:6px;margin:8px 0 0}' +
    '.vvbot-ask input{flex:1;min-width:0;border:1px solid #9AA3B0;border-radius:7px;padding:7px 9px;font-size:13px;color:#1B2433;background:#fff;outline:none}' +
    '.vvbot-ask input:focus{border-color:' + NAVY + '}' +
    '.vvbot-ask button{flex:none;border:0;border-radius:7px;background:' + NAVY + ';color:#fff;font-size:13px;font-weight:700;padding:7px 11px;cursor:pointer}' +
    '.vvbot-ask button:disabled{opacity:.5;cursor:default}' +
    '.vvbot-flip{flex-direction:row-reverse}' +
    '.vvbot-drag .vvbot-bot,.vvbot-drag .vvbot-h{cursor:grabbing}' +
    '@media (max-width:640px){#vvbot{flex-direction:column-reverse}.vvbot-bot{width:170px;height:129px}.vvbot-bot svg{width:170px;height:129px}.vvbot-chest{font-size:14px}.vvbot-chest small{font-size:8px;margin-bottom:2px}.vvbot-card{max-width:200px}}' +
    '@media (prefers-reduced-motion:reduce){.vvbot-bot svg,.vvbot-chest{animation:none}}';

  function ensureCss() {
    if (d.getElementById('vvbot-css')) return;
    var st = d.createElement('style'); st.id = 'vvbot-css'; st.textContent = CSS; d.head.appendChild(st);
  }

  // Drag the bot or the card title to move both anywhere. The spot is remembered on this device.
  // A drag never counts as a click; a plain click on the bot opens or closes the card.
  function drag(box, bot, title, onTap) {
    function put(rx, ry) {
      var vw = w.innerWidth || 1200, vh = w.innerHeight || 800, rw = bot.offsetWidth || 160, rh = bot.offsetHeight || 141, s = box.style;
      rx = Math.max(0, Math.min(vw - rw, rx)); ry = Math.max(0, Math.min(vh - rh, ry));
      var right = rx + rw / 2 > vw / 2, low = ry + rh / 2 > vh / 2;
      s.left = right ? 'auto' : rx + 'px'; s.right = right ? (vw - rx - rw) + 'px' : 'auto';
      s.top = low ? 'auto' : ry + 'px'; s.bottom = low ? (vh - ry - rh) + 'px' : 'auto';
      s.alignItems = low ? 'flex-end' : 'flex-start';
      if (right) box.classList.add('vvbot-flip'); else box.classList.remove('vvbot-flip');
    }
    function grip(el, tap) {
      var sx = 0, sy = 0, ox = 0, oy = 0, down = false, moved = false, tgt = null;
      el.addEventListener('pointerdown', function (e) {
        if (e.button) return;
        var r = bot.getBoundingClientRect();
        down = true; moved = false; tgt = e.target; sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        try { el.setPointerCapture(e.pointerId); } catch (x) {}
      });
      el.addEventListener('pointermove', function (e) {
        if (!down) return;
        var dx = e.clientX - sx, dy = e.clientY - sy;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
        moved = true; box.classList.add('vvbot-drag'); put(ox + dx, oy + dy);
        if (e.preventDefault) e.preventDefault();
      });
      el.addEventListener('pointerup', function () {
        if (!down) return;
        down = false; box.classList.remove('vvbot-drag');
        if (moved) { var r = bot.getBoundingClientRect(); try { w.localStorage.setItem('vvbot_pos', JSON.stringify([Math.round(r.left), Math.round(r.top)])); } catch (x) {} }
        else if (tap) tap(tgt);
      });
      el.addEventListener('pointercancel', function () { down = false; box.classList.remove('vvbot-drag'); });
    }
    grip(bot, onTap); grip(title, null);
    try { var p = JSON.parse(w.localStorage.getItem('vvbot_pos') || 'null'); if (p && p.length === 2) put(+p[0], +p[1]); } catch (x) {}
    w.addEventListener('resize', function () { if (box.style.left || box.style.right) { var r = bot.getBoundingClientRect(); put(r.left, r.top); } });
  }

  // Ask box: sends the question with the member's own session token; the reply is written from their data.
  function chat(box) {
    var log = box.querySelector('.vvbot-log'), form = box.querySelector('.vvbot-ask'), inp = form.querySelector('input'), btn = form.querySelector('button');
    var hist = [], busy = false;
    function add(cls, text) {
      var key = null;
      var body = String(text || '').replace(/\[\[([a-z]+)\]\]/g, function (x, k) { if (URLS[k] && !key) key = k; return ''; }).replace(/\s+$/, '');
      var m = d.createElement('div'); m.className = 'vvbot-m ' + cls; m.textContent = body;
      if (key && cls === 'a') {
        var a = d.createElement('a'); a.href = URLS[key] + '?vb=' + key; a.textContent = NAMES[key] + ' →';
        a.addEventListener('click', function (e) { ev('bot_click', key); if (here(URLS[key])) { e.preventDefault(); guide(key); } });
        m.appendChild(d.createElement('br')); m.appendChild(a);
      }
      log.className = 'vvbot-log on'; log.appendChild(m); log.scrollTop = log.scrollHeight;
      return m;
    }
    inp.addEventListener('keydown', function (e) { e.stopPropagation(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = inp.value.replace(/^\s+|\s+$/g, ''), tk = token();
      if (!q || busy) return;
      if (!tk) { add('a', 'Please sign in again so I can see your account.'); return; }
      busy = true; btn.disabled = true; inp.value = ''; add('q', q);
      var wait = add('a', 'Thinking…');
      w.fetch(HOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tk.t, message: q, history: hist.slice(-6), page: location.pathname, as: qs('vbot_as') }) })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (j) {
          var reply = j && j.reply ? String(j.reply) : '';
          if (wait.parentNode) wait.parentNode.removeChild(wait);
          if (reply) { add('a', reply); hist.push({ role: 'user', content: q }, { role: 'assistant', content: reply }); }
          else add('a', 'I could not get an answer just now. Try once more in a moment.');
          busy = false; btn.disabled = false;
        });
    });
  }

  function render(data) {
    var acts = (data && data.actions) || [];
    if (!acts.length || d.getElementById('vvbot')) return;
    var u = Math.max(1, Math.min(3, +data.urgency || 1)), rank = +data.rank || 1, wins = +data.wins || 0;
    var min = false; try { min = w.sessionStorage.getItem('vvbot_min') === '1'; } catch (e) {}
    ensureCss();
    var tick = acts.map(function (a) { return esc(fix(a.label)) + (a.sub ? ', ' + esc(a.sub) : ''); }).join(' &nbsp;&#9670;&nbsp; ');
    var dur = Math.max(7, Math.round(acts.map(function (a) { return a.label + ', ' + (a.sub || ''); }).join('   ').length * 0.22));
    var items = acts.map(function (a, i) {
      return '<a class="vvbot-go" href="' + esc(a.url) + '?vb=' + esc(a.key) + '" data-key="' + esc(a.key) + '" data-url="' + esc(a.url) + '">' +
        '<span class="vvbot-n">' + (i + 1) + '</span><span><b>' + esc(fix(a.label)) + '</b><i>' + esc(a.sub || '') + '</i></span></a>';
    }).join('');
    var box = d.createElement('div');
    box.id = 'vvbot'; if (u >= 3) box.className = 'vvbot-hot';
    box.innerHTML = '<div class="vvbot-bot" title="Victory Bot">' + botSvg2(u, rank) +
      '<div class="vvbot-chest" data-key="' + esc(acts[0].key) + '" data-url="' + esc(acts[0].url) + '"><small>' + (u >= 3 ? 'DO THIS NOW' : 'YOUR NEXT MOVE') + '</small><span style="animation-duration:' + dur + 's">' + tick + '</span></div></div>' +
      '<div class="vvbot-card"' + (min ? ' style="display:none"' : '') + '><button class="vvbot-x" type="button" aria-label="Hide">&times;</button>' +
      '<div class="vvbot-h">' + (u >= 3 ? 'Do this now' : 'Your next move') + '</div>' + items +
      '<div class="vvbot-log" aria-live="polite"></div><form class="vvbot-ask"><input type="text" maxlength="500" placeholder="Ask me anything" aria-label="Ask Victory Bot"><button type="submit">Ask</button></form>' +
      '<div class="vvbot-f">' + (wins ? wins + ' win' + (wins === 1 ? '' : 's') + ' this month' : 'Two clicks each') + '</div></div>';
    d.body.appendChild(box);
    var card = box.querySelector('.vvbot-card');
    function setMin(v) { card.style.display = v ? 'none' : ''; try { w.sessionStorage.setItem('vvbot_min', v ? '1' : '0'); } catch (e) {} }
    box.querySelector('.vvbot-x').addEventListener('click', function (e) { e.stopPropagation(); setMin(true); ev('bot_dismiss'); });
    drag(box, box.querySelector('.vvbot-bot'), box.querySelector('.vvbot-h'), function (t) {
      var c = t && t.closest ? t.closest('.vvbot-chest') : null;
      if (!c) { setMin(card.style.display !== 'none'); return; }
      var key = c.getAttribute('data-key'), url = c.getAttribute('data-url');
      ev('bot_click', key);
      if (here(url)) { ensureCss(); guide(key); } else location.href = url + '?vb=' + key;
    });
    chat(box);
    var links = box.querySelectorAll('.vvbot-go');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function (e) {
        var key = this.getAttribute('data-key');
        ev('bot_click', key);
        if (here(this.getAttribute('data-url'))) { e.preventDefault(); ensureCss(); guide(key); }
      });
    }
  }

  function boot() {
    var tk = token(); if (!tk) return;
    ev('page_view');
    var team = TEAM.indexOf(tk.email) >= 0;
    var arrive = qs('vb');
    if (arrive && CAT[arrive]) { ensureCss(); setTimeout(function () { guide(arrive); }, 600); }
    if (!(LIVE || team || qs('vbot') === '1')) return;
    var as = team ? qs('vbot_as') : null;
    rpc('victory_bot_next', as ? { p_email: as } : {}).then(function (data) {
      if (!data) return;
      try { render(data); ev('bot_show', ((data.actions || [])[0] || {}).key); } catch (e) {}
    });
  }

  w.VVBot = { guide: guide, version: 3 };
  function start() { setTimeout(function () { try { boot(); } catch (e) {} }, 1500); }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
})(window, document);
