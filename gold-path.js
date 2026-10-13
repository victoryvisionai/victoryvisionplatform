/* Victory Vision Gold path (shared by member pages).
 *
 * 1. Gold explanations on Send, Schedule, Text, Call and Video. When GOLD_GATES_LIVE is 1, a Starter member's
 *    action shows a short explanation instead of running. The draft stays on the page, and a manual route
 *    (Gmail, phone, copy) is offered. While the flag is 0, nothing is intercepted.
 * 2. At most one proactive Gold card per session, at the right moment (gold_in_app_offer applies the
 *    suppression rules). Off until GOLD_INAPP_LIVE is 1. Add ?gold_preview=1 to any page to see a sample card.
 * 3. The upgrade section on Settings: renders into #vvUpgrade, checkout runs server-side (billing/gold-checkout).
 *
 * Fails open: if the status cannot be loaded or anything here errors, the page behaves exactly as before.
 * Load with: <script src="/gold-path.js" defer></script>   (vv-call.js also loads it)
 */
(function (w, d) {
  'use strict';
  if (w.VVGold) return;

  var SB = 'https://nyyvsdkumxvuwimmucdb.supabase.co';
  var ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55eXZzZGt1bXh2dXdpbW11Y2RiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM3MzY5OTQsImV4cCI6MjA1OTMxMjk5NH0.7m7R_8mBhp7X8itl5cR81xbX2AjJUm2SIPR0FUv6ouU';
  var HOOK = 'https://victoryvision.app.n8n.cloud/webhook/';
  var N8N_HOST = 'victoryvision.app.n8n.cloud';
  var UPGRADE = '/settings#upgrade';
  var ANDREW = 'andrew@victoryvisionai.com';
  var TEAM = [ANDREW, 'glaze@vvdoh.com', 'glaze@equitablecap.com'];
  var nativeFetch = w.fetch ? w.fetch.bind(w) : null;
  var S = null, loading = null;

  // Starter actions that are part of Gold. Exact paths only (call/mass-dial-status must not match).
  var RULES = {
    '/webhook/emails/send':              { moment: 'send_attempt',  kind: 'email' },
    '/webhook/emails/schedule':          { moment: 'send_attempt',  kind: 'email' },
    '/webhook/emails/template-send':     { moment: 'send_attempt',  kind: 'campaign' },
    '/webhook/emails/template-schedule': { moment: 'send_attempt',  kind: 'campaign' },
    '/webhook/templates/schedule':       { moment: 'send_attempt',  kind: 'campaign' },
    '/webhook/emails/usergenerated':     { moment: 'send_attempt',  kind: 'campaign' },
    '/webhook/sms/create':               { moment: 'sms_attempt',   kind: 'sms' },
    '/webhook/sms/mass':                 { moment: 'sms_attempt',   kind: 'sms' },
    '/webhook/call/mass-dial':           { moment: 'call_attempt',  kind: 'call_auto' },
    '/webhook/calls/enroll-ai':          { moment: 'call_attempt',  kind: 'call_auto' },
    '/webhook/ai-video':                 { moment: 'video_attempt', kind: 'video' },
    '/webhook/media/video-refine':       { moment: 'video_attempt', kind: 'video' }
  };

  var COPY = {
    email:     { title: 'Send this from your Gmail, or let Gold send it', msg: 'Sending from Victory Vision is part of Gold. Your draft is kept, and you can send it from your own Gmail.' },
    campaign:  { title: 'Your campaign is ready. Gold sends it for you.', msg: 'Scheduled sending is part of Gold. Your campaign and drafts are kept.' },
    sms:       { title: 'Text from your phone, or let Gold send it', msg: 'Texting from Victory Vision is part of Gold. Your message is kept.' },
    call:      { title: 'Call from your phone, or let Gold dial for you', msg: 'Calling from Victory Vision is part of Gold.' },
    call_auto: { title: 'Automated calling is part of Gold', msg: 'Automated and AI calling are part of Gold. Your list is kept.' },
    video:     { title: 'AI video is part of Gold', msg: 'AI video is part of Gold. Your prompt is kept.' }
  };
  var WHY = 'On Starter, Victory Vision prepares your targets and drafts, and you send them yourself. ' +
            'Gold connects your email, phone and calendar so sending, calling and follow-up happen for you, and Andrew helps you set it up.';

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function money(c) { var v = Number(c || 0) / 100; return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v % 1 ? 2 : 0 }); }
  function ss(k, v) { try { if (v === undefined) return w.sessionStorage.getItem(k); w.sessionStorage.setItem(k, v); } catch (e) { return null; } }
  function page() { return (location.pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'home').slice(0, 60); }
  function param(k) { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } }

  function token() {
    try {
      var v = JSON.parse(w.localStorage.getItem('sb-nyyvsdkumxvuwimmucdb-auth-token') || 'null');
      var s = v && (v.currentSession || v);
      return (s && s.access_token) || null;
    } catch (e) { return null; }
  }
  function myEmail() {
    try { var p = JSON.parse(atob(token().split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return String(p.email || '').toLowerCase(); }
    catch (e) { return ''; }
  }
  function rpc(fn, args) {
    var t = token();
    if (!t || !nativeFetch) return Promise.resolve(null);
    return nativeFetch(SB + '/rest/v1/rpc/' + fn, {
      method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {})
    }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function status(force) {
    if (S && !force) return Promise.resolve(S);
    if (loading && !force) return loading;
    loading = rpc('my_gold_status').then(function (r) { if (r && r.ok) S = r; loading = null; return S; });
    return loading;
  }
  function isGold(s) { return !!s && String(s.plan || '').toLowerCase() === 'gold'; }
  function gated() { return !!(S && S.gates_live && !isGold(S)); }
  function logOffer(moment, st, ctx, id) {
    return rpc('gold_offer_event', { p_moment: moment, p_status: st, p_context: ctx || {}, p_offer_id: id || null });
  }

  function textOf(html) {
    var s = String(html || '');
    if (!/<[a-z!\/]/i.test(s)) return s;
    s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n');
    try { s = new DOMParser().parseFromString(s, 'text/html').body.textContent || ''; } catch (e) { s = s.replace(/<[^>]+>/g, ''); }
    return s.replace(/\n{3,}/g, '\n\n').trim();
  }
  function bodyOf(b) {
    if (!b) return {};
    if (typeof b === 'string') { try { var j = JSON.parse(b); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
    if (typeof FormData !== 'undefined' && b instanceof FormData) { var o = {}; b.forEach(function (v, k) { if (typeof v === 'string') o[k] = v; }); return o; }
    return {};
  }
  function copy(text) {
    try { if (navigator.clipboard && w.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); }); } catch (e) {}
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try { var t = d.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;top:-1000px;opacity:0'; d.body.appendChild(t); t.select(); var ok = d.execCommand('copy'); t.remove(); return ok; } catch (e) { return false; }
  }

  // What the member was about to send, so the manual route can carry it.
  function draftOf(kind, b) {
    var first = function (arr) { return Array.isArray(arr) && arr.length ? arr[0] : null; };
    var e = (first(b.emails)) || ((first(b.templates) || {}).variations ? first(first(b.templates).variations) : null) || {};
    return {
      to: b.to || '', cc: b.cc || '', subject: b.subject || e.subject || '',
      body: textOf(b.body || b.body_html || e.body || b.message || ''),
      phone: b.phone || b.phone_number || '', name: b.name || '',
      prompt: b.chat || b.prompt || ''
    };
  }
  function gmailUrl(x) {
    var body = x.body.length > 1800 ? x.body.slice(0, 1800) + '\n\n[Draft continues. The full text is on your clipboard.]' : x.body;
    var q = 'view=cm&fs=1&to=' + encodeURIComponent(x.to) + (x.cc ? '&cc=' + encodeURIComponent(x.cc) : '') +
            '&su=' + encodeURIComponent(x.subject) + '&body=' + encodeURIComponent(body);
    return 'https://mail.google.com/mail/?' + q;
  }
  function telOf(p) { var n = String(p || '').replace(/[^0-9+]/g, ''); if (/^\d{10}$/.test(n)) n = '+1' + n; else if (/^1\d{10}$/.test(n)) n = '+' + n; return n; }

  // ---------- styles ----------
  function css() {
    if (d.getElementById('vvgCss')) return;
    var s = d.createElement('style');
    s.id = 'vvgCss';
    s.textContent =
      '.vvg-ov{position:fixed;inset:0;background:rgba(10,20,40,.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.vvg-box{background:#fff;border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.25)}' +
      '.vvg-hd{background:linear-gradient(135deg,#0A3161,#1a5490);color:#fff;padding:16px 18px;border-radius:12px 12px 0 0;display:flex;gap:12px;justify-content:space-between;align-items:flex-start}' +
      '.vvg-hd h3{margin:0;font-size:17px;line-height:1.35;color:#fff}.vvg-x{background:none;border:0;color:#fff;font-size:24px;line-height:1;cursor:pointer;padding:0 2px;margin:0}.vvg-x:hover{background:none;opacity:.8}' +
      '.vvg-bd{padding:16px 18px 18px;color:#1f2937;font-size:14px;line-height:1.55}.vvg-bd p{margin:0 0 10px}' +
      '.vvg-kept{background:#ecfdf3;border:1px solid #b7ebc9;color:#166534;border-radius:8px;padding:8px 10px;font-size:13px;margin:0 0 12px}' +
      '.vvg-row{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}' +
      '.vvg-btn{display:inline-block;border:0;border-radius:8px;padding:10px 14px;margin:0;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;text-align:center;line-height:1.2;box-sizing:border-box}' +
      '.vvg-gold{background:#B31942;color:#fff}.vvg-gold:hover{background:#951536}.vvg-sec{background:#eef2f7;color:#0A3161}.vvg-sec:hover{background:#e1e8f1}.vvg-link{background:none;color:#64748b;padding:10px 6px}.vvg-link:hover{background:none;color:#0A3161}' +
      '.vvg-btn[disabled]{opacity:.6;cursor:default}.vvg-note{font-size:12px;color:#64748b;margin-top:8px}' +
      '.vvg-card{position:fixed;right:16px;bottom:16px;z-index:99990;max-width:360px;width:calc(100% - 32px);background:#fff;border-radius:12px;box-shadow:0 12px 36px rgba(10,49,97,.25);border-top:4px solid #B31942;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:14px 16px 12px;color:#1f2937}' +
      '.vvg-card h4{margin:0 26px 6px 0;font-size:15px;color:#0A3161;line-height:1.35}.vvg-card p{margin:0;font-size:13px;line-height:1.5}.vvg-card .vvg-x{position:absolute;top:8px;right:10px;color:#94a3b8;font-size:20px}' +
      '.vvg-kick{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#B31942;font-weight:700;margin-bottom:4px}' +
      '.vvg-up{border:1px solid #e3e8f0;border-radius:12px;padding:18px;margin:16px 0;background:#fff;scroll-margin-top:80px}' +
      '.vvg-up h3{margin:0 0 6px;font-size:19px;color:#0A3161}.vvg-up p{margin:0 0 10px;color:#334155;font-size:14px;line-height:1.55}' +
      '.vvg-top{display:flex;flex-wrap:wrap;gap:16px;justify-content:space-between;align-items:flex-start}.vvg-top>div:first-child{flex:1 1 320px;min-width:0}' +
      '.vvg-price{font-size:28px;font-weight:800;color:#0A3161;white-space:nowrap}.vvg-price span{font-size:14px;font-weight:500;color:#64748b}' +
      '.vvg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:12px 0}' +
      '.vvg-col{border:1px solid #e3e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc}.vvg-col.g{background:#fff8f0;border-color:#f3d7b5}' +
      '.vvg-col h4{margin:0 0 8px;font-size:14px;color:#0A3161}.vvg-col ul{margin:0;padding-left:18px;font-size:13px;line-height:1.6;color:#334155}' +
      '.vvg-work{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 12px}.vvg-chip{background:#eef2f7;color:#0A3161;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600}' +
      '.vvg-msg{margin-top:10px;font-size:14px;border-radius:8px;padding:10px 12px;display:none}.vvg-msg.ok{display:block;background:#ecfdf3;color:#166534}.vvg-msg.err{display:block;background:#fef2f2;color:#991b1b}' +
      '.vvg-up details{margin-top:14px;font-size:13px;color:#334155}.vvg-up summary{cursor:pointer;font-weight:600;color:#0A3161}' +
      '.vvg-tbl{width:100%;border-collapse:collapse;margin-top:8px}.vvg-tbl td{padding:5px 4px;border-bottom:1px solid #eef2f7}.vvg-tbl td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
      '.vvg-bar{height:8px;background:#e5e7eb;border-radius:99px;overflow:hidden;margin:6px 0 4px}.vvg-bar i{display:block;height:100%;background:linear-gradient(90deg,#0A3161,#1a6fc4)}' +
      '@media(max-width:520px){.vvg-row .vvg-btn{flex:1 1 100%}.vvg-price{font-size:24px}}';
    (d.head || d.documentElement).appendChild(s);
  }

  // ---------- Gold explanation (Send / Text / Call / Video) ----------
  function explain(rule, draft) {
    css();
    var old = d.getElementById('vvgGate'); if (old) old.remove();
    var c = COPY[rule.kind] || COPY.email, offerId = null, done = false;
    var ov = d.createElement('div');
    ov.className = 'vvg-ov'; ov.id = 'vvgGate';
    var manual = '';
    if (rule.kind === 'email' && draft.to) manual = '<a class="vvg-btn vvg-sec" data-a="gmail" target="_blank" rel="noopener" href="' + esc(gmailUrl(draft)) + '">Open in Gmail</a><button class="vvg-btn vvg-sec" data-a="copy">Copy draft</button>';
    else if ((rule.kind === 'email' || rule.kind === 'campaign') && (draft.subject || draft.body)) manual = '<button class="vvg-btn vvg-sec" data-a="copy">Copy the email</button>';
    else if (rule.kind === 'sms' && draft.phone) manual = '<a class="vvg-btn vvg-sec" data-a="sms" href="sms:' + esc(telOf(draft.phone)) + '?&body=' + encodeURIComponent(draft.body) + '">Text from your phone</a><button class="vvg-btn vvg-sec" data-a="copy">Copy message</button>';
    else if (rule.kind === 'sms' && draft.body) manual = '<button class="vvg-btn vvg-sec" data-a="copy">Copy message</button>';
    else if (rule.kind === 'call' && draft.phone) manual = '<a class="vvg-btn vvg-sec" data-a="tel" href="tel:' + esc(telOf(draft.phone)) + '">Call from your phone</a><button class="vvg-btn vvg-sec" data-a="copy">Copy number</button>';
    else if (rule.kind === 'video' && draft.prompt) manual = '<button class="vvg-btn vvg-sec" data-a="copy">Copy prompt</button>';
    var who = draft.name ? ' to ' + esc(draft.name) : '';
    ov.innerHTML =
      '<div class="vvg-box" role="dialog" aria-modal="true" aria-labelledby="vvgT">' +
        '<div class="vvg-hd"><h3 id="vvgT">' + esc(c.title) + '</h3><button class="vvg-x" data-a="close" aria-label="Close">&times;</button></div>' +
        '<div class="vvg-bd">' +
          '<div class="vvg-kept">' + (rule.kind === 'call' ? 'Nothing was dialed' + who + '.' : 'Nothing was lost. ' + esc(c.msg.split('. ').slice(1).join('. ') || 'Your work is kept.')) + '</div>' +
          '<p>' + esc(WHY) + '</p>' +
          (S && S.credits && S.credits.gold_allowance ? '<p style="font-size:13px;color:#475569">Gold includes ' + fmt(S.credits.gold_allowance) + ' credits a month' + (S.gold_price_cents ? ' for ' + money(S.gold_price_cents) + ' a year' : '') + '.</p>' : '') +
          (manual ? '<div class="vvg-row">' + manual + '</div>' : '') +
          '<div class="vvg-row"><button class="vvg-btn vvg-gold" data-a="gold">See what Gold adds</button><button class="vvg-btn vvg-link" data-a="close">Not now</button></div>' +
          '<div class="vvg-note" id="vvgNote"></div>' +
        '</div>' +
      '</div>';
    d.body.appendChild(ov);
    var ctx = { page: page(), kind: rule.kind, endpoint: rule.path || null };
    logOffer(rule.moment, 'presented', ctx).then(function (r) { if (r && r.offer_id) offerId = r.offer_id; });
    function finish(st, extra) {
      if (done) return; done = true;
      var go = function () { logOffer(rule.moment, st, extra || {}, offerId); };
      if (offerId) go(); else setTimeout(go, 1200); // let the "presented" row land first
    }
    function close() { finish('dismissed'); ov.remove(); d.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    d.addEventListener('keydown', onKey);
    ov.addEventListener('click', function (e) {
      if (e.target === ov) return close();
      var a = e.target.closest && e.target.closest('[data-a]'); if (!a) return;
      var act = a.getAttribute('data-a'), note = d.getElementById('vvgNote');
      if (act === 'close') return close();
      if (act === 'gold') { finish('clicked'); w.open(UPGRADE.replace('#', '?gold_from=' + encodeURIComponent(rule.moment) + '#'), '_blank'); note.textContent = 'Gold opened in a new tab. This page and your draft are unchanged.'; return; }
      if (act === 'copy') {
        var txt = rule.kind === 'call' ? telOf(draft.phone) : rule.kind === 'video' ? draft.prompt :
          (draft.subject ? 'Subject: ' + draft.subject + '\n\n' : '') + draft.body;
        copy(txt).then(function (ok) { note.textContent = ok ? 'Copied.' : 'Could not copy automatically. Select the text on the page instead.'; });
        finish('dismissed', { manual: 'copy' });
        return;
      }
      if (act === 'gmail') { if (draft.body.length > 1800) copy((draft.subject ? 'Subject: ' + draft.subject + '\n\n' : '') + draft.body); finish('dismissed', { manual: 'gmail' }); note.textContent = 'Gmail opened in a new tab with your draft.'; return; }
      if (act === 'sms' || act === 'tel') finish('dismissed', { manual: act });
    });
    var g = ov.querySelector('[data-a="gold"]'); if (g) g.focus();
  }

  function blocked(rule) {
    var c = COPY[rule.kind] || COPY.email;
    return new Response(JSON.stringify({ success: false, ok: false, gold_required: true, message: c.msg, error: c.msg }), {
      status: 402, statusText: 'Gold plan required', headers: { 'Content-Type': 'application/json' }
    });
  }
  function ruleFor(url) {
    try {
      var u = new URL(url, location.href);
      if (u.hostname !== N8N_HOST) return null;
      var r = RULES[u.pathname.replace(/\/+$/, '')];
      return r ? { moment: r.moment, kind: r.kind, path: u.pathname } : null;
    } catch (e) { return null; }
  }
  function exempt(rule, b) {
    if (rule.kind !== 'email') return false;
    if (b.to_email && !b.to) return true; // reports a member sends to themselves (ai.html)
    var to = String(b.to || '').toLowerCase().split(/[,;\s]+/).filter(Boolean);
    var me = myEmail();
    return to.length > 0 && to.every(function (x) { return TEAM.indexOf(x) >= 0 || x === me; });
  }

  if (nativeFetch) {
    w.fetch = function (input, init) {
      try {
        if (gated()) {
          var rule = ruleFor(typeof input === 'string' ? input : (input && input.url) || String(input));
          if (rule) {
            var b = bodyOf(init && init.body);
            if (!exempt(rule, b)) { explain(rule, draftOf(rule.kind, b)); return Promise.resolve(blocked(rule)); }
          }
        }
      } catch (e) { /* fail open */ }
      return nativeFetch(input, init);
    };
  }

  // In-browser calls (vv-call.js) never touch fetch for the dial itself, so wrap VVCall.dial.
  function wrapCall() {
    var V = w.VVCall;
    if (!V || typeof V.dial !== 'function' || V.__vvGold) return;
    var orig = V.dial;
    V.dial = function (c) {
      try {
        if (gated() && c) {
          explain({ moment: 'call_attempt', kind: 'call', path: 'vvcall.dial' }, { phone: c.phone_number || c.phone || '', name: c.name || '', body: '', subject: '', to: '' });
          return;
        }
      } catch (e) { /* fail open */ }
      return orig.apply(V, arguments);
    };
    V.__vvGold = true;
  }

  // ---------- proactive card ----------
  function card(o) {
    css();
    if (d.getElementById('vvgCard')) return;
    var el = d.createElement('div');
    el.className = 'vvg-card'; el.id = 'vvgCard'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Gold');
    el.innerHTML = '<button class="vvg-x" data-a="close" aria-label="Close">&times;</button>' +
      '<div class="vvg-kick">' + (o.preview ? 'Preview · Gold' : 'Gold') + '</div>' +
      '<h4>' + esc(o.headline) + '</h4><p>' + esc(o.body) + '</p>' +
      '<div class="vvg-row" style="margin-top:10px"><button class="vvg-btn vvg-gold" data-a="gold">' + esc(o.cta_label || 'See what Gold adds') + '</button><button class="vvg-btn vvg-link" data-a="close">Not now</button></div>';
    d.body.appendChild(el);
    el.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-a]'); if (!a) return;
      var act = a.getAttribute('data-a');
      if (!o.preview && o.offer_id) logOffer(o.moment, act === 'gold' ? 'clicked' : 'dismissed', { page: page() }, o.offer_id);
      el.remove();
      if (act === 'gold') w.open(UPGRADE.replace('#', '?gold_from=' + encodeURIComponent(o.moment || 'card') + '#'), '_blank');
    });
  }
  function proactive() {
    var pg = page();
    if (/^(settings|calrissian|login|signup|index|home|resetpassword|forgotpassword|changepassword|404page)$/.test(pg)) return;
    if (param('gold_preview') === '1') {
      return card({ preview: true, moment: 'first_output', headline: 'You have the plan. Gold runs it.',
        body: 'Starter prepares the targets and drafts. Gold connects your email, phone and calendar so sending, calling and follow-up happen for you.', cta_label: 'See what Gold adds' });
    }
    var em = myEmail(); if (!em) return;
    var key = 'vvGoldCard:' + em;
    if (ss(key)) return;
    ss(key, '1');
    rpc('gold_in_app_offer', { p_page: pg }).then(function (r) { if (r && r.show) card(r); });
  }

  // ---------- Settings: upgrade section ----------
  function li(a) { return '<ul>' + a.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>'; }
  function priceTable(s) {
    var seen = {}, rows = (s.prices || []).filter(function (p) { if (seen[p.label]) return false; seen[p.label] = 1; return true; });
    if (!rows.length) return '';
    return '<details><summary>What uses credits</summary><p style="margin:8px 0 0;font-size:13px">Reading, copying and exporting are always free.</p>' +
      '<table class="vvg-tbl">' + rows.map(function (p) { return '<tr><td>' + esc(p.label) + '</td><td>' + fmt(p.credits) + ' credits</td></tr>'; }).join('') + '</table></details>';
  }
  function usage(s) {
    var c = s.credits || {}; if (!c.allowance) return '';
    var pct = Math.min(100, Math.round((c.used_month || 0) / c.allowance * 100));
    return '<div style="margin-top:12px;font-size:13px;color:#334155"><strong>' + fmt(c.used_month) + '</strong> of ' + fmt(c.allowance) + ' credits used this month' +
      (c.reset ? ' · resets ' + esc(c.reset) : '') + '<div class="vvg-bar"><i style="width:' + pct + '%"></i></div></div>';
  }
  function renderUpgrade(el) {
    if (!el) return;
    css();
    el.classList.add('vvg-up');
    el.innerHTML = '<p style="color:#64748b">Loading your plan…</p>';
    var flag = param('gold'), from = param('gold_from');
    status(true).then(function (s) {
      if (!s) { el.innerHTML = '<p>We could not load plan details right now. Questions about Gold? Email <a href="mailto:' + ANDREW + '">' + ANDREW + '</a>.</p>'; return; }
      var banner = '';
      if (flag === 'success') banner = '<div class="vvg-msg ok" id="vvgBanner">' + (isGold(s) ? 'Welcome to Gold. Everything is unlocked.' : 'Payment received. Your account is switching to Gold, which usually takes under a minute.') + '</div>';
      else if (flag === 'cancel') banner = '<div class="vvg-msg ok" id="vvgBanner" style="background:#f1f5f9;color:#334155">Checkout was cancelled and nothing was charged. Your plan is unchanged.</div>';

      if (isGold(s)) {
        el.innerHTML = banner +
          '<div class="vvg-top"><div><div class="vvg-kick">Your plan</div><h3>You’re on Gold</h3>' +
          '<p>' + esc(s.status === 'active' ? 'Active' : (s.status || '')) + (s.term_end ? ' · renews ' + esc(String(s.term_end).slice(0, 10)) : '') + (s.cancel_at_period_end ? ' · set to end at the close of this term' : '') + '</p>' +
          '<p>Sending, calling, texting and AI video run from Victory Vision, with implementation help from Andrew. Questions or changes: <a href="mailto:' + ANDREW + '?subject=Gold%20account">' + ANDREW + '</a>.</p></div></div>' +
          usage(s) + priceTable(s);
        if (flag === 'success') history.replaceState(null, '', location.pathname + '#upgrade');
        return;
      }

      var w0 = s.work || {}, chips = [];
      [['contacts', 'contacts'], ['campaigns', 'campaigns'], ['emails_prepared', 'emails prepared'], ['meetings', 'meetings'], ['victories', 'victories']].forEach(function (k) {
        if (Number(w0[k[0]]) > 0) chips.push('<span class="vvg-chip">' + fmt(w0[k[0]]) + ' ' + k[1] + '</span>');
      });
      var c = s.credits || {};
      var trialNote = '';
      if (s.status === 'trial' && s.trial_ends_at) {
        var dl = Math.ceil((new Date(s.trial_ends_at) - Date.now()) / 864e5);
        if (dl >= 0) trialNote = '<p><strong>Your trial ends in ' + dl + ' day' + (dl === 1 ? '' : 's') + '.</strong> Everything you build stays with you on either plan.</p>';
      }
      el.innerHTML = banner +
        '<div class="vvg-top"><div><div class="vvg-kick">Upgrade</div><h3>Gold: Victory Vision runs the plan with you</h3>' +
        '<p>' + esc(WHY) + '</p>' + trialNote + '</div>' +
        (s.gold_price_cents ? '<div class="vvg-price">' + money(s.gold_price_cents) + '<span> / year</span></div>' : '') + '</div>' +
        '<div class="vvg-grid">' +
          '<div class="vvg-col"><h4>Starter' + (String(s.plan || '').toLowerCase() === 'starter' ? ' (your plan)' : '') + '</h4>' + li([
            'Targets, contacts, goals and weekly plans',
            'Campaigns and AI-drafted outreach you send from your Gmail',
            'Deal search and deal emails',
            'Social posts, landing pages and presentations',
            fmt(c.starter_allowance || 2500) + ' credits a month',
            'Weekly office hours through Operator’s Edge']) + '</div>' +
          '<div class="vvg-col g"><h4>Gold adds</h4>' + li([
            'Sending, scheduling and follow-up from your connected mailbox',
            'Calling and texting from Victory Vision, including AI calls',
            'AI video, plus ads launch and management',
            'A dedicated sending domain and mailbox, set up for you',
            fmt(c.gold_allowance || 15000) + ' credits a month',
            'Implementation help from Andrew']) + '</div>' +
        '</div>' +
        (chips.length ? '<p style="margin-bottom:4px"><strong>Your work so far.</strong> Gold picks up from here, and nothing you’ve prepared is lost.</p><div class="vvg-work">' + chips.join('') + '</div>' : '') +
        '<div class="vvg-row"><button class="vvg-btn vvg-gold" id="vvgBuy">Upgrade to Gold</button>' +
        '<a class="vvg-btn vvg-sec" href="mailto:' + ANDREW + '?subject=Question%20about%20Gold">Talk to Andrew first</a></div>' +
        '<div class="vvg-msg" id="vvgMsg"></div>' +
        usage(s) + priceTable(s);

      var btn = d.getElementById('vvgBuy'), msg = d.getElementById('vvgMsg');
      var say = function (t, ok) { msg.className = 'vvg-msg ' + (ok ? 'ok' : 'err'); msg.textContent = t; };
      btn.addEventListener('click', function () {
        var t = token();
        if (!t) return say('Please sign in again, then try once more.', false);
        btn.disabled = true; btn.textContent = 'Opening secure checkout…'; msg.className = 'vvg-msg';
        nativeFetch(HOOK + 'billing/gold-checkout', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify({ context: { moment: from || (location.hash === '#upgrade' ? 'pricing_view' : 'settings'), page: 'settings' } })
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (j && j.ok && j.mode === 'checkout' && j.url) { btn.textContent = 'Redirecting to Stripe…'; location.href = j.url; return; }
          if (j && j.ok && j.mode === 'request') { btn.textContent = 'Request sent'; return say(j.message, true); }
          if (j && j.code === 'already_gold') { say('You are already on Gold.', true); return renderUpgrade(el); }
          btn.disabled = false; btn.textContent = 'Upgrade to Gold';
          say((j && j.error) || 'Something went wrong. Please try again, or email ' + ANDREW + '.', false);
        }).catch(function () {
          btn.disabled = false; btn.textContent = 'Upgrade to Gold';
          say('We could not reach checkout. Please try again, or email ' + ANDREW + '.', false);
        });
      });

      if (flag === 'cancel') logOffer('pricing_view', 'dismissed', { page: 'settings', reason: 'checkout_cancelled' });
      if (flag === 'success') { // Stripe webhook usually lands within seconds; re-check a few times.
        var n = 0, t2 = setInterval(function () {
          status(true).then(function (s2) { if (isGold(s2) || ++n >= 6) { clearInterval(t2); if (isGold(s2)) renderUpgrade(el); } });
        }, 5000);
      }
      if (location.hash === '#upgrade' || from) setTimeout(function () { try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {} }, 300);
    });
  }

  w.VVGold = { status: status, renderUpgrade: renderUpgrade, explain: explain, isGated: gated, _rules: RULES };

  function boot() {
    wrapCall();
    status().then(function () { wrapCall(); });
    var up = d.getElementById('vvUpgrade');
    if (up) renderUpgrade(up);
    setTimeout(proactive, 6000);
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})(window, document);
