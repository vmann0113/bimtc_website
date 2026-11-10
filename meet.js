/* BIMTC 자체 화상미팅 — 1:1 WebRTC.
   영상은 두 사람 브라우저끼리 직접 오간다(서버 경유 없음).
   연결 신호만 Supabase Realtime 으로 주고받는다. */
(function () {
  // 화면 언어 — 주소의 ?lang= · 저장해 둔 값 · 브라우저 언어 순으로 고른다 (bizmeeting.html 과 같은 규칙).
  var EN = (function(){
    try{
      var q=(location.search||'').match(/[?&]lang=(ko|en)/);
      if(q){ try{ localStorage.setItem('bimtc_lang', q[1]); }catch(e){} return q[1]==='en'; }
      var s=localStorage.getItem('bimtc_lang');
      if(s==='en') return true;
      if(s==='ko') return false;
      return String(navigator.language||navigator.userLanguage||'').toLowerCase().indexOf('ko')!==0;
    }catch(e){ return false; }
  })();
  function T(ko, en){ return EN ? en : ko; }
  // 서버에서 오는 오류 문구는 한국어로 돌아온다(bimtc-supabase.js). 영어 화면에서만 바꿔 보여 준다.
  var ERR_EN = {
    '로그인이 필요합니다': 'You need to sign in first',
    '미팅을 찾을 수 없습니다': 'This meeting was not found',
    '이 미팅의 참가자가 아닙니다': 'You are not a participant in this meeting'
  };
  function errT(m){ return EN ? (ERR_EN[m] || m) : m; }
  try{
    document.documentElement.lang = EN ? 'en' : 'ko';
    if (EN) document.title = 'Video meeting · BIMTC 2026';
  }catch(e){}
  var $ = function (s) { return document.querySelector(s); };
  var app = $('#app');
  var SLOTS = ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'];
  var DAY = EN ? { D1: 'Nov 13 (Fri)', D2: 'Nov 14 (Sat)' } : { D1: '11월 13일(금)', D2: '11월 14일(토)' };

  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function gate(title, body, backHome) {
    app.className = 'gate';
    app.innerHTML = '<div class="card"><h1>' + esc(title) + '</h1><p>' + body + '</p>'
      + (backHome === false ? '' : '<a class="home" href="bizmeeting.html">← ' + T('비즈미팅으로 돌아가기','Back to Business Matching') + '</a>') + '</div>';
  }

  var pc = null, ch = null, localStream = null, screenTrack = null, timer = null;
  var meeting = null, isCaller = false, joined = false, pending = [];

  function setStatus(t) { var e = $('#status'); if (e) e.textContent = t; }
  function setNote(h, p) {
    var e = $('#note'); if (!e) return;
    if (h === null) { e.style.display = 'none'; return; }
    e.style.display = 'block';
    e.innerHTML = '<h2>' + esc(h) + '</h2><p>' + esc(p || '') + '</p>';
  }
  function cleanup() {
    try { if (timer) clearInterval(timer); } catch (e) {}
    try { if (ch) window.BimtcDB.realtimeRemove(ch); } catch (e) {}
    try { if (pc) pc.close(); } catch (e) {}
    try { if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (screenTrack) screenTrack.stop(); } catch (e) {}
  }
  window.addEventListener('beforeunload', cleanup);

  function room() {
    var other = (meeting.owner_profile === window.__meId) ? meeting.guest_name : meeting.host_name;
    var when = (DAY[meeting.day] || meeting.day) + ' ' + (SLOTS[meeting.slot_idx] || '');
    app.className = 'wrap';
    app.innerHTML =
      '<div class="bar">'
      + '<div><div class="ttl">' + esc(other || T('상대방','Partner')) + '</div><div class="sub">' + esc(when) + ' · ' + T('1:1 비즈니스 미팅','1:1 business meeting') + '</div></div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<span class="pill" id="status">' + T('준비 중','Getting ready') + '</span><span class="pill" id="clock">30:00</span></div></div>'
      + '<div class="stage"><video id="remote" autoplay playsinline></video>'
      + '<video id="local" autoplay playsinline muted></video>'
      + '<div class="note" id="note"></div></div>'
      + '<div class="ctrl">'
      + '<button class="btn go" id="join">' + T('미팅 입장','Join meeting') + '</button>'
      + '<button class="btn" id="mic" disabled>' + T('마이크 끄기','Mute') + '</button>'
      + '<button class="btn" id="cam" disabled>' + T('카메라 끄기','Stop video') + '</button>'
      + '<button class="btn" id="share" disabled>' + T('화면 공유','Share screen') + '</button>'
      + '<button class="btn end" id="leave">' + T('나가기','Leave') + '</button></div>';
    setNote(T('미팅 입장을 눌러 주세요','Press Join meeting'),
            T('카메라와 마이크 사용을 허용하면 상대방과 연결됩니다. 설치할 프로그램은 없습니다.',
              'Allow camera and microphone and you will be connected. Nothing to install.'));
    $('#join').onclick = join;
    $('#leave').onclick = function () { try { send({ t: 'bye' }); } catch (e) {} cleanup(); location.href = 'bizmeeting.html'; };
    $('#mic').onclick = function () { toggle('audio', this, T('마이크','Mic'), T('마이크 켜기','Unmute'), T('마이크 끄기','Mute')); };
    $('#cam').onclick = function () { toggle('video', this, T('카메라','Camera'), T('카메라 켜기','Start video'), T('카메라 끄기','Stop video')); };
    $('#share').onclick = share;
  }

  function toggle(kind, btn, label, onLabel, offLabel) {
    if (!localStream) return;
    var t = localStream.getTracks().filter(function (x) { return x.kind === kind; })[0];
    if (!t) return;
    t.enabled = !t.enabled;
    btn.textContent = t.enabled ? offLabel : onLabel;
    btn.className = 'btn' + (t.enabled ? '' : ' off');
  }

  function startClock() {
    var left = 30 * 60;
    timer = setInterval(function () {
      left--;
      var e = $('#clock'); if (!e) return;
      if (left <= 0) { clearInterval(timer); e.textContent = T('시간 종료','Time is up'); return; }
      e.textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    }, 1000);
  }

  async function replaceVideo(track) {
    if (!pc || !track) return;
    var s = pc.getSenders().filter(function (x) { return x.track && x.track.kind === 'video'; })[0];
    if (s) await s.replaceTrack(track);
  }

  async function share() {
    var btn = $('#share');
    if (screenTrack) {
      screenTrack.stop(); screenTrack = null;
      await replaceVideo(localStream.getVideoTracks()[0]);
      btn.textContent = T('화면 공유','Share screen'); btn.className = 'btn';
      return;
    }
    try {
      var ds = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenTrack = ds.getVideoTracks()[0];
      screenTrack.onended = function () {
        if (!screenTrack) return;
        screenTrack = null;
        replaceVideo(localStream.getVideoTracks()[0]);
        btn.textContent = T('화면 공유','Share screen'); btn.className = 'btn';
      };
      await replaceVideo(screenTrack);
      btn.textContent = T('공유 중지','Stop sharing'); btn.className = 'btn off';
    } catch (e) { /* 사용자가 취소 */ }
  }

  function send(payload) { try { ch.send({ type: 'broadcast', event: 'sig', payload: payload }); } catch (e) {} }

  async function makeOffer() {
    var o = await pc.createOffer();
    await pc.setLocalDescription(o);
    send({ t: 'offer', sdp: pc.localDescription });
  }

  async function onSignal(m) {
    if (!m || !pc) return;
    try {
      if (m.t === 'here') {
        if (isCaller && !pc.remoteDescription) await makeOffer();
        return;
      }
      if (m.t === 'offer' && !isCaller) {
        await pc.setRemoteDescription(m.sdp);
        var a = await pc.createAnswer();
        await pc.setLocalDescription(a);
        send({ t: 'answer', sdp: pc.localDescription });
        pending.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); }); pending = [];
      } else if (m.t === 'answer' && isCaller) {
        await pc.setRemoteDescription(m.sdp);
        pending.forEach(function (c) { pc.addIceCandidate(c).catch(function () {}); }); pending = [];
      } else if (m.t === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(m.c);
        else pending.push(m.c);
      } else if (m.t === 'bye') {
        setStatus(T('상대 퇴장','Partner left'));
        setNote(T('상대방이 미팅을 나갔습니다','Your partner left the meeting'),
                T('다시 들어오면 자동으로 연결됩니다.','You will be reconnected automatically when they return.'));
      }
    } catch (e) {}
  }

  async function connect() {
    var ice = await window.BimtcDB.getIceServers();
    pc = new RTCPeerConnection({ iceServers: ice });
    localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

    pc.ontrack = function (ev) { $('#remote').srcObject = ev.streams[0]; setNote(null); setStatus(T('연결됨','Connected')); };
    pc.onicecandidate = function (ev) { if (ev.candidate) send({ t: 'ice', c: ev.candidate }); };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      if (st === 'connected') { setStatus(T('연결됨','Connected')); setNote(null); }
      else if (st === 'disconnected') setStatus(T('연결 불안정','Unstable connection'));
      else if (st === 'failed') {
        setStatus(T('연결 실패','Connection failed'));
        setNote(T('연결하지 못했습니다','Could not connect'),
                T('병원·회사 내부망에서 막힐 수 있습니다. 휴대전화 네트워크로 바꿔 보시거나 사무국(051-461-4276~8)으로 연락해 주세요.',
                  'Hospital or office networks often block this. Try a mobile network, or contact the secretariat at +82-51-461-4276.'));
      }
    };

    ch = await window.BimtcDB.realtimeChannel('meet-' + meeting.id, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'sig' }, function (p) { onSignal(p.payload); });
    await new Promise(function (res) {
      ch.subscribe(function (s) { if (s === 'SUBSCRIBED') res(); });
      setTimeout(res, 8000);
    });
    send({ t: 'here' });
  }

  async function join() {
    if (joined) return;
    joined = true;
    $('#join').disabled = true;
    setNote(T('카메라·마이크를 준비하고 있습니다','Getting your camera and microphone ready'),
            T('브라우저가 묻는 사용 허용에 [허용]을 눌러 주세요.','Choose Allow when the browser asks for permission.'));
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      joined = false; $('#join').disabled = false;
      setNote(T('카메라·마이크를 쓸 수 없습니다','Camera or microphone is not available'),
              T('주소창의 자물쇠 아이콘에서 카메라·마이크를 허용한 뒤 다시 눌러 주세요. 다른 프로그램이 카메라를 쓰고 있어도 이 문제가 생깁니다.',
                'Open the padlock icon in the address bar, allow camera and microphone, then press again. Another app using the camera causes this too.'));
      return;
    }
    $('#local').srcObject = localStream;
    ['mic', 'cam', 'share'].forEach(function (id) { $('#' + id).disabled = false; });
    $('#join').style.display = 'none';
    setNote(T('상대방을 기다리고 있습니다','Waiting for your partner'),
            T('상대가 입장하면 자동으로 연결됩니다.','You will be connected as soon as they join.'));
    setStatus(T('상대 대기 중','Waiting'));
    startClock();
    await connect();
  }

  (async function start() {
    var id = (location.search.match(/[?&]id=([0-9a-fA-F-]{36})/) || [])[1];
    if (!id) { gate(T('미팅 주소가 올바르지 않습니다','This meeting link is not valid'),
                     T('비즈미팅 화면의 <b>[미팅 참가]</b> 버튼으로 들어와 주세요.','Please enter through the <b>[Join meeting]</b> button on the Business Matching page.')); return; }
    if (!window.isSecureContext) { gate(T('보안 연결이 필요합니다','A secure connection is required'),
                                        T('화상 미팅은 https 주소에서만 됩니다.','Video meetings only work on an https address.')); return; }
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
      gate(T('이 브라우저로는 화상 미팅을 할 수 없습니다','This browser cannot run the video meeting'),
           T('크롬·엣지·사파리 최신 버전으로 열어 주세요.','Please open it in a recent Chrome, Edge or Safari.')); return;
    }
    var r;
    try { r = await window.BimtcDB.getMeeting(id); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || !r.ok) { gate(T('미팅에 들어갈 수 없습니다','You cannot enter this meeting'),
                            esc(errT((r && r.error) || '') || T('알 수 없는 오류','Unknown error')) + '<br>' + T('로그인 상태를 확인해 주세요.','Please check that you are signed in.')); return; }
    meeting = r.meeting; isCaller = r.isCaller; window.__meId = r.meId;
    room();
  })();
})();
