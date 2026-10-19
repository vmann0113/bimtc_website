/* BIMTC 자체 화상미팅 — 1:1 WebRTC.
   영상은 두 사람 브라우저끼리 직접 오간다(서버 경유 없음).
   연결 신호만 Supabase Realtime 으로 주고받는다. */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var app = $('#app');
  var SLOTS = ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'];
  var DAY = { D1: '11월 13일(금)', D2: '11월 14일(토)' };

  function esc(v) { return String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function gate(title, body, backHome) {
    app.className = 'gate';
    app.innerHTML = '<div class="card"><h1>' + esc(title) + '</h1><p>' + body + '</p>'
      + (backHome === false ? '' : '<a class="home" href="bizmeeting.html">← 비즈미팅으로 돌아가기</a>') + '</div>';
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
      + '<div><div class="ttl">' + esc(other || '상대방') + '</div><div class="sub">' + esc(when) + ' · 1:1 비즈니스 미팅</div></div>'
      + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">'
      + '<span class="pill" id="status">준비 중</span><span class="pill" id="clock">30:00</span></div></div>'
      + '<div class="stage"><video id="remote" autoplay playsinline></video>'
      + '<video id="local" autoplay playsinline muted></video>'
      + '<div class="note" id="note"></div></div>'
      + '<div class="ctrl">'
      + '<button class="btn go" id="join">미팅 입장</button>'
      + '<button class="btn" id="mic" disabled>마이크 끄기</button>'
      + '<button class="btn" id="cam" disabled>카메라 끄기</button>'
      + '<button class="btn" id="share" disabled>화면 공유</button>'
      + '<button class="btn end" id="leave">나가기</button></div>';
    setNote('미팅 입장을 눌러 주세요', '카메라와 마이크 사용을 허용하면 상대방과 연결됩니다. 설치할 프로그램은 없습니다.');
    $('#join').onclick = join;
    $('#leave').onclick = function () { try { send({ t: 'bye' }); } catch (e) {} cleanup(); location.href = 'bizmeeting.html'; };
    $('#mic').onclick = function () { toggle('audio', this, '마이크'); };
    $('#cam').onclick = function () { toggle('video', this, '카메라'); };
    $('#share').onclick = share;
  }

  function toggle(kind, btn, label) {
    if (!localStream) return;
    var t = localStream.getTracks().filter(function (x) { return x.kind === kind; })[0];
    if (!t) return;
    t.enabled = !t.enabled;
    btn.textContent = t.enabled ? (label + ' 끄기') : (label + ' 켜기');
    btn.className = 'btn' + (t.enabled ? '' : ' off');
  }

  function startClock() {
    var left = 30 * 60;
    timer = setInterval(function () {
      left--;
      var e = $('#clock'); if (!e) return;
      if (left <= 0) { clearInterval(timer); e.textContent = '시간 종료'; return; }
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
      btn.textContent = '화면 공유'; btn.className = 'btn';
      return;
    }
    try {
      var ds = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenTrack = ds.getVideoTracks()[0];
      screenTrack.onended = function () {
        if (!screenTrack) return;
        screenTrack = null;
        replaceVideo(localStream.getVideoTracks()[0]);
        btn.textContent = '화면 공유'; btn.className = 'btn';
      };
      await replaceVideo(screenTrack);
      btn.textContent = '공유 중지'; btn.className = 'btn off';
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
        setStatus('상대 퇴장');
        setNote('상대방이 미팅을 나갔습니다', '다시 들어오면 자동으로 연결됩니다.');
      }
    } catch (e) {}
  }

  async function connect() {
    var ice = await window.BimtcDB.getIceServers();
    pc = new RTCPeerConnection({ iceServers: ice });
    localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });

    pc.ontrack = function (ev) { $('#remote').srcObject = ev.streams[0]; setNote(null); setStatus('연결됨'); };
    pc.onicecandidate = function (ev) { if (ev.candidate) send({ t: 'ice', c: ev.candidate }); };
    pc.onconnectionstatechange = function () {
      var st = pc.connectionState;
      if (st === 'connected') { setStatus('연결됨'); setNote(null); }
      else if (st === 'disconnected') setStatus('연결 불안정');
      else if (st === 'failed') {
        setStatus('연결 실패');
        setNote('연결하지 못했습니다', '병원·회사 내부망에서 막힐 수 있습니다. 휴대전화 네트워크로 바꿔 보시거나 사무국(051-461-4276~8)으로 연락해 주세요.');
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
    setNote('카메라·마이크를 준비하고 있습니다', '브라우저가 묻는 사용 허용에 [허용]을 눌러 주세요.');
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (e) {
      joined = false; $('#join').disabled = false;
      setNote('카메라·마이크를 쓸 수 없습니다', '주소창의 자물쇠 아이콘에서 카메라·마이크를 허용한 뒤 다시 눌러 주세요. 다른 프로그램이 카메라를 쓰고 있어도 이 문제가 생깁니다.');
      return;
    }
    $('#local').srcObject = localStream;
    ['mic', 'cam', 'share'].forEach(function (id) { $('#' + id).disabled = false; });
    $('#join').style.display = 'none';
    setNote('상대방을 기다리고 있습니다', '상대가 입장하면 자동으로 연결됩니다.');
    setStatus('상대 대기 중');
    startClock();
    await connect();
  }

  (async function start() {
    var id = (location.search.match(/[?&]id=([0-9a-fA-F-]{36})/) || [])[1];
    if (!id) { gate('미팅 주소가 올바르지 않습니다', '비즈미팅 화면의 <b>[미팅 참가]</b> 버튼으로 들어와 주세요.'); return; }
    if (!window.isSecureContext) { gate('보안 연결이 필요합니다', '화상 미팅은 https 주소에서만 됩니다.'); return; }
    if (!navigator.mediaDevices || !window.RTCPeerConnection) {
      gate('이 브라우저로는 화상 미팅을 할 수 없습니다', '크롬·엣지·사파리 최신 버전으로 열어 주세요.'); return;
    }
    var r;
    try { r = await window.BimtcDB.getMeeting(id); } catch (e) { r = { ok: false, error: e.message }; }
    if (!r || !r.ok) { gate('미팅에 들어갈 수 없습니다', esc((r && r.error) || '알 수 없는 오류') + '<br>로그인 상태를 확인해 주세요.'); return; }
    meeting = r.meeting; isCaller = r.isCaller; window.__meId = r.meId;
    room();
  })();
})();
