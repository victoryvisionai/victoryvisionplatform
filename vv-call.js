/* Victory Vision shared calling module.
 * One implementation for calls.html, contacts.html and deals.html.
 *
 * Usage:
 *   <script src="https://unpkg.com/@telnyx/webrtc@2.27.8/lib/bundle.js"></script>
 *   <script src="vv-call.js"></script>
 *   VVCall.init({ customerId: CUSTOMER_ID });
 *   VVCall.dial(contactObject);
 *
 * v2 (2026-11-16) - why calls stopped going out after the Oct 13 rollout:
 *  - The Telnyx client was created once at page load and reused for every dial.
 *    When its WebSocket dropped (laptop sleep, Wi-Fi change, idle tab) the client
 *    object still existed, so connect() returned it as-is and newCall() went
 *    nowhere. Telnyx has no record of those calls at all.
 *  - The timer started at dial time, so a dead call looked like a live one
 *    ("Calling... 01:01") and got logged to calls/journey as a "brief" call.
 *  - Login errors were written to the status line and then overwritten by
 *    "Calling...", so the real reason was never visible.
 * Now: every dial confirms the client is logged in (telnyx.ready) and rebuilds it
 * if not; a watchdog catches a call that never reaches Telnyx, reconnects and
 * retries once; the timer starts on answer; dead attempts are not logged.
 */
(function (global) {
  'use strict';

  var EP = {
    user:  'https://victoryvision.app.n8n.cloud/webhook/user/get',
    script:'https://victoryvision.app.n8n.cloud/webhook/call/script',
    coach: 'https://victoryvision.app.n8n.cloud/webhook/call/coach',
    log:   'https://victoryvision.app.n8n.cloud/webhook/calls/log'
  };

  var READY_TIMEOUT_MS = 12000;   // login must finish within this
  var REACH_TIMEOUT_MS = 15000;   // call must leave "new/requesting" within this

  var cfg = { customerId: null, onEnd: null };
  var client = null, ready = false, lastError = '', connecting = null;
  var call = null, dialAt = null, answeredAt = null, reached = false, attempt = 0;
  var timerId = null, coachId = null, watchdogId = null, recog = null;
  var heard = '', script = '', contact = null, logged = false, dialDest = '', dialFrom = '';
  var session = 0;   // bumps on every dial and hang-up so late async work can't place a call

  function sameCall(a, b) { return !!(a && b && (a === b || (a.id && a.id === b.id))); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
    });
  }

  function e164(p) {
    if (!p) return '';
    var d = String(p).replace(/[^0-9]/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d.charAt(0) === '1') return '+' + d;
    return d ? '+' + d : '';
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(t, isError) {
    var e = $('vvcStatus');
    if (!e) return;
    e.textContent = t;
    e.style.color = isError ? '#c0392b' : '#667';
    e.style.fontWeight = isError ? '600' : '400';
  }

  function errText(e) {
    if (!e) return 'unknown error';
    if (typeof e === 'string') return e;
    if (e.message) return e.message;
    if (e.error && e.error.message) return e.error.message;
    try { return JSON.stringify(e); } catch (x) { return 'unknown error'; }
  }

  // ---------- modal ----------
  function ensureModal() {
    if ($('vvCallModal')) return;
    var d = document.createElement('div');
    d.id = 'vvCallModal';
    d.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99999;align-items:center;justify-content:center;';
    d.innerHTML =
      '<div style="background:#fff;border-radius:10px;max-width:640px;width:92%;max-height:90vh;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif">' +
        '<div style="background:linear-gradient(135deg,#0A3161,#1a5490);color:#fff;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">' +
          '<div><h3 style="margin:0;font-size:18px" id="vvcName">Call</h3>' +
          '<div style="font-size:12px;opacity:.85" id="vvcMeta">&nbsp;</div></div>' +
          '<span id="vvcClose" style="cursor:pointer;font-size:26px;line-height:1">&times;</span>' +
        '</div>' +
        '<div style="padding:18px">' +
          '<div id="vvcStatus" style="text-align:center;color:#667;font-size:13px">Preparing...</div>' +
          '<div id="vvcTimer" style="text-align:center;font-size:26px;font-weight:700;color:#0A3161;margin:6px 0">00:00</div>' +
          '<div style="background:#f8f9fa;border:2px solid #0A3161;border-radius:8px;padding:14px;margin:14px 0">' +
            '<h4 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#0A3161">Call Script</h4>' +
            '<div id="vvcScript" style="font-size:14px;line-height:1.7;white-space:pre-wrap;max-height:260px;overflow-y:auto">Generating...</div>' +
          '</div>' +
          '<div id="vvcCoach"></div>' +
          '<textarea id="vvcNotes" placeholder="Notes during the call..." style="width:100%;min-height:80px;padding:8px;border:1px solid #ccc;border-radius:6px;font-size:13px;font-family:inherit"></textarea>' +
          '<button id="vvcHangup" style="width:100%;padding:14px;margin-top:10px;background:#c0392b;color:#fff;border:none;border-radius:6px;font-size:16px;font-weight:600;cursor:pointer">&#9742; Hang Up</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    $('vvcHangup').addEventListener('click', function () { VVCall.hangup(); });
    $('vvcClose').addEventListener('click', function () { VVCall.hangup(); hideModal(); });
  }

  function showModal() { ensureModal(); $('vvCallModal').style.display = 'flex'; }
  function hideModal() { var m = $('vvCallModal'); if (m) m.style.display = 'none'; }

  // ---------- credentials ----------
  function loadUser() {
    // user/get is a GET with a query param. Posting to it triggers a CORS
    // preflight the endpoint does not answer, which fails the whole load.
    return fetch(EP.user + '?customer_id=' + encodeURIComponent(cfg.customerId), { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (u) {
        var uu = Array.isArray(u) ? u[0] : u;
        cfg.vvnumber = uu && uu.vvnumber ? uu.vvnumber : null;
        cfg.sipUser  = uu && uu.sip_username ? uu.sip_username : null;
        cfg.sipPass  = uu && uu.sip_password ? uu.sip_password : null;
        if (!cfg.sipUser || !cfg.sipPass) {
          lastError = 'No phone login on this account (sip_username / sip_password missing)';
          console.warn('VVCall: ' + lastError);
        }
        return uu;
      })
      .catch(function (e) { lastError = 'Could not load your phone settings'; console.warn('VVCall: user load failed', e); });
  }

  // ---------- remote audio ----------
  function ensureRemoteAudio() {
    var el = document.getElementById('vvcRemoteAudio');
    if (!el) {
      el = document.createElement('audio');
      el.id = 'vvcRemoteAudio';
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    el.muted = false;
    el.volume = 1;
    var p = el.play();
    if (p && p.catch) { p.catch(function () {}); }
    return el;
  }

  // ---------- telnyx ----------
  function isLive() {
    return !!(client && ready && client.connected !== false);
  }

  function dropClient() {
    var c = client;
    client = null; ready = false; connecting = null;
    if (c) { try { c.disconnect(); } catch (e) {} }
  }

  // Resolves with a logged-in client, or rejects with a readable reason.
  // Reuses the current client only if it is still logged in; otherwise rebuilds.
  function ensureClient() {
    if (isLive()) return Promise.resolve(client);
    if (connecting) return connecting;
    if (!cfg.sipUser || !cfg.sipPass) {
      return Promise.reject(new Error(lastError || 'No phone login on this account'));
    }
    if (!global.TelnyxWebRTC || !global.TelnyxWebRTC.TelnyxRTC) {
      return Promise.reject(new Error('Telnyx phone library did not load (check ad/script blockers)'));
    }
    dropClient();

    connecting = new Promise(function (resolve, reject) {
      var settled = false;
      function ok() { if (settled) return; settled = true; clearTimeout(t); resolve(client); }
      function fail(msg) {
        if (settled) return; settled = true; clearTimeout(t);
        lastError = msg;
        dropClient();
        reject(new Error(msg));
      }
      var t = setTimeout(function () { fail('Phone login timed out (no response from Telnyx)'); }, READY_TIMEOUT_MS);

      try {
        var c = new global.TelnyxWebRTC.TelnyxRTC({
          login: cfg.sipUser, password: cfg.sipPass,
          ringtoneFile: null, ringbackFile: null
        });
        client = c;
        c.on('telnyx.ready', function () {
          if (client !== c) return;
          ready = true; lastError = '';
          console.log('VVCall: Telnyx logged in');
          ok();
        });
        c.on('telnyx.error', function (e) {
          if (client !== c) return;
          ready = false;
          var msg = 'Phone login failed: ' + errText(e);
          console.error('VVCall: Telnyx error', e);
          lastError = msg;
          if (!settled) fail(msg);
          else if (call) setStatus(msg, true);
        });
        c.on('telnyx.socket.close', function () {
          if (client !== c) return;
          console.warn('VVCall: Telnyx socket closed');
          ready = false;
        });
        c.on('telnyx.socket.error', function (e) {
          if (client !== c) return;
          console.warn('VVCall: Telnyx socket error', e);
          ready = false;
          if (!settled) fail('Could not reach Telnyx (network or firewall)');
        });
        c.on('telnyx.notification', onNotification);
        var p = c.connect();
        if (p && p.catch) p.catch(function (e) { if (client === c) fail('Could not connect to Telnyx: ' + errText(e)); });
      } catch (e) {
        fail('Phone init failed: ' + errText(e));
      }
    });
    connecting.then(function () { connecting = null; }, function () { connecting = null; });
    return connecting;
  }

  function onNotification(n) {
    if (n && n.type === 'userMediaError') {
      setStatus('Microphone blocked - allow mic access for this site and try again', true);
      abortAttempt(false);
      return;
    }
    var c = n && n.call ? n.call : null;
    if (!c || !sameCall(c, call)) return;
    var st = c.state;
    console.log('VVCall:', n.type, '| state:', st, '| cause:', c.cause, '| sip:', c.sipCode, c.sipReason || '');

    if (st === 'trying' || st === 'ringing' || st === 'early' || st === 'answering' || st === 'active') {
      reached = true;
      clearTimeout(watchdogId);
    }
    if (st === 'trying') setStatus('Dialing...');
    if (st === 'ringing' || st === 'early') setStatus('Ringing...');
    if (st === 'active') {
      if (!answeredAt) answeredAt = Date.now();
      setStatus('Connected');
      startTimer(); startCoach();
    }
    if (st === 'hangup' || st === 'destroy') {
      var bad = c.cause && c.cause !== 'NORMAL_CLEARING';
      finish(bad ? ('Call ended: ' + c.cause + (c.sipCode ? ' (SIP ' + c.sipCode + (c.sipReason ? ' ' + c.sipReason : '') + ')' : '')) : 'Call ended', bad);
    }
  }

  // ---------- timer ----------
  function startTimer() {
    clearInterval(timerId);
    var from = answeredAt || Date.now();
    timerId = setInterval(function () {
      var s = Math.floor((Date.now() - from) / 1000);
      var e = $('vvcTimer');
      if (e) e.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
  }

  // ---------- speech ----------
  function startListening() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR || recog) return;
    try {
      recog = new SR();
      recog.continuous = true; recog.interimResults = false; recog.lang = 'en-US';
      recog.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) heard += e.results[i][0].transcript + ' ';
        }
      };
      recog.onerror = function (e) { if (e.error !== 'no-speech') console.warn('VVCall: speech', e.error); };
      recog.onend = function () { if (call && recog) { try { recog.start(); } catch (e) {} } };
      recog.start();
    } catch (e) { console.warn('VVCall: speech init', e); }
  }

  function stopListening() {
    if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
  }

  // ---------- coach ----------
  function startCoach() {
    clearInterval(coachId);
    coachId = setInterval(askCoach, 20000);
    setTimeout(askCoach, 8000);
  }

  function askCoach() {
    if (!call || !contact) return;
    fetch(EP.coach, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: cfg.customerId, contact: contact, script: script, heard: heard,
        elapsed_seconds: answeredAt ? Math.floor((Date.now() - answeredAt) / 1000) : 0
      })
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.nudge) return;
        var el = $('vvcCoach'); if (!el) return;
        el.innerHTML =
          '<div style="background:#fffbe6;border-left:3px solid #f0ad4e;padding:12px;border-radius:4px;margin-bottom:10px">' +
            '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#9a8144">' + esc(d.flag || 'none') + '</div>' +
            '<div style="font-size:15px;font-weight:600;color:#7a5b18;margin-top:4px">' + esc(d.nudge) + '</div>' +
            (d.say ? '<div style="margin-top:6px;font-style:italic;color:#0A3161">"' + esc(d.say) + '"</div>' : '') +
            (d.why ? '<div style="margin-top:4px;font-size:11px;color:#9a8144">' + esc(d.why) + '</div>' : '') +
          '</div>' + el.innerHTML;
        while (el.children.length > 3) el.removeChild(el.lastChild);
      })
      .catch(function (e) { console.warn('VVCall: coach', e); });
  }

  // ---------- logging ----------
  function logCall(c) {
    if (logged) return;
    logged = true;
    // Only log calls Telnyx actually carried. An attempt that never left the
    // browser is not a call and must not land in calls / customer_journey.
    if (!reached) { console.warn('VVCall: not logged - call never reached Telnyx'); return; }
    var start = answeredAt || dialAt;
    var dur = start ? Math.max(1, Math.floor((Date.now() - start) / 1000)) : 0;
    var ids = (c && c.telnyxIDs) ? c.telnyxIDs : {};
    var sessionId = ids.telnyxSessionId || null;
    var legId     = ids.telnyxLegId || null;
    var ccId      = ids.telnyxCallControlId || null;
    if (!contact) return;
    var notesEl = $('vvcNotes');
    console.log('VVCall: logging ' + dur + 's call with ' + (contact.name || 'unknown') + ' session=' + sessionId);
    fetch(EP.log, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: cfg.customerId,
        contact_id: contact.id || contact.contact_id,
        person_called: contact.name || '',
        number_called: contact.phone_number || '',
        duration_seconds: dur,
        notes: notesEl ? notesEl.value : '',
        transcript: heard,
        script: script,
        session_id: sessionId,
        leg_id: legId,
        call_control_id: ccId
      })
    }).then(function (r) {
      console.log('VVCall: log status ' + r.status);
      if (typeof cfg.onEnd === 'function') cfg.onEnd(contact, dur);
    }).catch(function (e) { console.warn('VVCall: log failed', e); });
  }

  function clearTimers() {
    clearInterval(timerId); clearInterval(coachId); clearTimeout(watchdogId);
  }

  // Ends a call that did reach Telnyx (or was answered): log it and close.
  function finish(statusText, isError) {
    var c = call;
    clearTimers();
    stopListening();
    logCall(c);
    call = null; dialAt = null; answeredAt = null;
    setStatus(statusText || 'Call ended', !!isError);
    if (!isError) setTimeout(hideModal, 1200);
  }

  // Kills an attempt that never reached Telnyx. Leaves the modal open with the reason.
  function abortAttempt(dropConnection) {
    var c = call;
    clearTimers();
    stopListening();
    call = null; dialAt = null; answeredAt = null; logged = true;
    if (c) { try { c.hangup(); } catch (e) {} }
    if (dropConnection) dropClient();
  }

  function placeCall(my) {
    if (my !== session) return;
    attempt++;
    reached = false; logged = false; answeredAt = null;
    setStatus(attempt > 1 ? 'Reconnected - calling again...' : 'Calling...');
    try {
      dialAt = Date.now();
      ensureRemoteAudio();
      call = client.newCall({
        destinationNumber: dialDest,
        callerNumber: dialFrom,
        audio: true,
        video: false,
        remoteElement: 'vvcRemoteAudio'
      });
      startListening();
    } catch (e) {
      console.error('VVCall: dial failed', e);
      abortAttempt(true);
      setStatus('Call failed: ' + errText(e), true);
      return;
    }
    clearTimeout(watchdogId);
    watchdogId = setTimeout(function () {
      if (!call || reached) return;
      console.warn('VVCall: call never reached Telnyx after ' + REACH_TIMEOUT_MS + 'ms (attempt ' + attempt + ')');
      abortAttempt(true);
      if (attempt < 2) {
        setStatus('Phone connection was stale - reconnecting...');
        ensureClient().then(function () { placeCall(my); }, function (e) {
          if (my === session) setStatus('Call did not go out: ' + errText(e), true);
        });
      } else {
        setStatus('Call did not go out - Telnyx never received it. ' + (lastError ? lastError : 'Check your internet connection and try again.'), true);
      }
    }, REACH_TIMEOUT_MS);
  }

  // ---------- public ----------
  var VVCall = {
    init: function (opts) {
      cfg.customerId = opts && opts.customerId ? opts.customerId : null;
      cfg.onEnd = opts && opts.onEnd ? opts.onEnd : null;
      ensureModal();
      // Warm-up only. dial() re-checks the connection, so a failure here is not fatal.
      return loadUser().then(function () {
        return ensureClient().catch(function (e) { console.warn('VVCall: warm-up login failed -', errText(e)); return null; });
      });
    },

    dial: function (c) {
      if (!c) { console.warn('VVCall: no contact'); return; }
      if (call) { setStatus('A call is already in progress'); showModal(); return; }
      var my = ++session;
      contact = c; heard = ''; script = ''; logged = false; reached = false;
      dialAt = null; answeredAt = null; attempt = 0;

      showModal();
      $('vvcName').textContent = c.name || '(no name)';
      $('vvcMeta').textContent = [c.title, c.company].filter(Boolean).join(' - ') || ' ';
      $('vvcTimer').textContent = '00:00';
      $('vvcCoach').innerHTML = '';
      $('vvcNotes').value = '';
      $('vvcScript').textContent = 'Generating...';
      setStatus('Generating script and connecting phone...');

      dialDest = e164(c.phone_number);
      if (!dialDest) { setStatus('No valid phone number on this contact', true); return; }

      // Script generation and phone login run in parallel.
      var scriptP = fetch(EP.script, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: cfg.customerId, phone_number: c.phone_number, contact: c })
      }).then(function (r) { return r.json(); })
        .then(function (d) {
          var s = d && (d.script || d.text || d.output);
          if (s && typeof s === 'object') s = s.script || s.text || JSON.stringify(s);
          return String(s || '').trim();
        })
        .catch(function () { return ''; })
        .then(function (s) {
          script = s || String(c.script || '').trim() ||
                   'Open with your name, the shared context, then one question. Then stop talking.';
          $('vvcScript').textContent = script;
        });

      var phoneP = (cfg.sipUser ? Promise.resolve() : loadUser())
        .then(ensureClient)
        .then(function () { return null; }, function (e) { return e; });

      Promise.all([scriptP, phoneP]).then(function (res) {
        var phoneErr = res[1];
        if (my !== session) return;         // hung up or redialled meanwhile
        if (phoneErr) { setStatus('Phone system not connected: ' + errText(phoneErr), true); return; }
        dialFrom = e164(cfg.vvnumber);
        if (!dialFrom) { setStatus('No caller number set in Settings', true); return; }
        placeCall(my);
      });
    },

    hangup: function () {
      session++;
      var c = call;
      if (c) { try { c.hangup(); } catch (e) {} }
      if (c) finish('Call ended', false);
      else { clearTimers(); stopListening(); hideModal(); }
    },

    close: hideModal,
    isReady: function () { return isLive(); },
    lastError: function () { return lastError; },
    endpoints: EP
  };

  global.VVCall = VVCall;

  // Gold path (contextual Gold explanations, upgrade prompts). Loaded once, fails open.
  try {
    if (!global.VVGold && !document.querySelector('script[src*="gold-path.js"]')) {
      var gp = document.createElement('script'); gp.src = '/gold-path.js?v=1'; gp.defer = true;
      (document.head || document.documentElement).appendChild(gp);
    }
  } catch (e) {}
})(window);
