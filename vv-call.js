/* Victory Vision shared calling module.
 * One implementation for calls.html, contacts.html and deals.html.
 * Three separate copies of this logic is why fixing one page kept breaking another.
 *
 * Usage:
 *   <script src="https://unpkg.com/@telnyx/webrtc@2.27.8/lib/bundle.js"></script>
 *   <script src="vv-call.js"></script>
 *   VVCall.init({ customerId: CUSTOMER_ID });
 *   VVCall.dial(contactObject);
 *
 * The host page supplies nothing else. The modal, script generation, live coach,
 * timer, notes and logging all live here.
 */
(function (global) {
  'use strict';

  var EP = {
    user:  'https://victoryvision.app.n8n.cloud/webhook/user/get',
    script:'https://victoryvision.app.n8n.cloud/webhook/call/script',
    coach: 'https://victoryvision.app.n8n.cloud/webhook/call/coach',
    log:   'https://victoryvision.app.n8n.cloud/webhook/calls/log'
  };

  var cfg = { customerId: null, onEnd: null };
  var client = null, call = null, startedAt = null;
  var timerId = null, coachId = null, recog = null;
  var heard = '', script = '', contact = null, logged = false;

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

  function setStatus(t) { var e = $('vvcStatus'); if (e) e.textContent = t; }

  // ---------- modal ----------
  function ensureModal() {
    if ($('vvCallModal')) return;
    var a = document.createElement('audio');
    a.id = 'vvcRemoteAudio'; a.autoplay = true; a.setAttribute('playsinline','');
    document.body.appendChild(a);

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
          console.warn('VVCall: calling disabled - sip_username or sip_password missing on this user.');
        }
        return uu;
      })
      .catch(function (e) { console.warn('VVCall: user load failed', e); });
  }

  // ---------- telnyx ----------
  function connect() {
    if (client) return Promise.resolve(client);
    if (!cfg.sipUser || !cfg.sipPass) return Promise.resolve(null);
    try {
      client = new global.TelnyxWebRTC.TelnyxRTC({
        login: cfg.sipUser, password: cfg.sipPass,
        ringtoneFile: null, ringbackFile: null
      });
      client.on('telnyx.ready', function () { console.log('VVCall: Telnyx ready'); });
      client.on('telnyx.error', function (e) {
        console.error('VVCall: Telnyx error', e);
        setStatus('Phone error: ' + (e && e.message ? e.message : 'unknown'));
      });
      client.on('telnyx.notification', onNotification);
      return client.connect().then(function () {
        console.log('VVCall: WebRTC connected');
        return client;
      }).catch(function (e) {
        console.error('VVCall: connect failed', e);
        client = null;
        return null;
      });
    } catch (e) {
      console.error('VVCall: init failed', e);
      client = null;
      return Promise.resolve(null);
    }
  }

  function onNotification(n) {
    var c = n && n.call ? n.call : null;
    if (!c) return;
    console.log('VVCall:', n.type, '| state:', c.state, '| cause:', c.cause, '| sip:', c.sipCode);
    if (c.state === 'active') { setStatus('Connected'); startTimer(); startCoach(); }
    if (c.state === 'hangup' || c.state === 'destroy') {
      if (c.cause && c.cause !== 'NORMAL_CLEARING') {
        setStatus('Call rejected: ' + c.cause + (c.sipCode ? ' (SIP ' + c.sipCode + ')' : ''));
      }
      finish();
    }
  }

  // ---------- timer ----------
  function startTimer() {
    if (!startedAt) startedAt = Date.now();
    clearInterval(timerId);
    timerId = setInterval(function () {
      var s = Math.floor((Date.now() - startedAt) / 1000);
      var e = $('vvcTimer');
      if (e) e.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
  }

  // ---------- speech ----------
  function startListening() {
    var SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!SR) { console.warn('VVCall: no SpeechRecognition; coach runs without transcript.'); return; }
    try {
      recog = new SR();
      recog.continuous = true; recog.interimResults = false; recog.lang = 'en-US';
      recog.onresult = function (e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) heard += e.results[i][0].transcript + ' ';
        }
      };
      recog.onerror = function (e) { if (e.error !== 'no-speech') console.warn('VVCall: speech', e.error); };
      recog.onend = function () { if (call) { try { recog.start(); } catch (e) {} } };
      recog.start();
    } catch (e) { console.warn('VVCall: speech init', e); }
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
        elapsed_seconds: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0
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
  function logCall() {
    if (logged) return;
    logged = true;
    var dur = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
    if (!contact || dur <= 0) { console.warn('VVCall: log skipped, duration=' + dur); return; }
    var notesEl = $('vvcNotes');
    console.log('VVCall: logging ' + dur + 's call with ' + (contact.name || 'unknown'));
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
        script: script
      })
    }).then(function (r) {
      console.log('VVCall: log status ' + r.status);
      if (typeof cfg.onEnd === 'function') cfg.onEnd(contact, dur);
    }).catch(function (e) { console.warn('VVCall: log failed', e); });
  }

  function finish() {
    clearInterval(timerId); clearInterval(coachId);
    if (recog) { try { recog.onend = null; recog.stop(); } catch (e) {} recog = null; }
    logCall();
    call = null; startedAt = null;
    setStatus('Call ended');
  }

  // ---------- public ----------
  var VVCall = {
    init: function (opts) {
      cfg.customerId = opts && opts.customerId ? opts.customerId : null;
      cfg.onEnd = opts && opts.onEnd ? opts.onEnd : null;
      ensureModal();
      return loadUser().then(connect);
    },

    dial: function (c) {
      if (!c) { console.warn('VVCall: no contact'); return; }
      contact = c; heard = ''; script = ''; logged = false; startedAt = null;

      showModal();
      $('vvcName').textContent = c.name || '(no name)';
      $('vvcMeta').textContent = [c.title, c.company].filter(Boolean).join(' - ') || ' ';
      $('vvcTimer').textContent = '00:00';
      $('vvcCoach').innerHTML = '';
      $('vvcNotes').value = '';
      $('vvcScript').textContent = 'Generating...';
      setStatus('Generating script...');

      var dest = e164(c.phone_number);
      if (!dest) { setStatus('No valid phone number'); return; }

      fetch(EP.script, {
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
          return (cfg.sipUser ? Promise.resolve() : loadUser()).then(connect);
        })
        .then(function () {
          if (!client) { setStatus('Phone system not connected'); return; }
          var from = e164(cfg.vvnumber);
          if (!from) { setStatus('No caller number set in Settings'); return; }
          setStatus('Calling...');
          try {
            // Stamp the dial time here, not on the active event: if the SDK
            // never emits active, duration stays 0 and the call is never logged.
            startedAt = Date.now();
            call = client.newCall({
              destinationNumber: dest,
              callerNumber: from,
              audio: true,
              video: false,
              remoteElement: 'vvcRemoteAudio'
            });
            startTimer();
            startListening();
          } catch (e) {
            console.error('VVCall: dial failed', e);
            setStatus('Call failed: ' + e.message);
          }
        });
    },

    hangup: function () {
      if (call) { try { call.hangup(); } catch (e) {} }
      finish();
    },

    close: hideModal,
    isReady: function () { return !!client; },
    endpoints: EP
  };

  global.VVCall = VVCall;
})(window);
