/*
 * BIMTC 공유 데이터 저장소 (bimtc-store.js)
 * - localStorage 기반. 공개 사이트 / 비즈미팅 콘솔 / 관리자 콘솔이 같은 DB를 공유한다.
 * - 실제 회원가입·로그인, 신청·사전등록·1:1요청·예약·공지(CMS)를 영구 저장한다.
 * - 같은 브라우저(기기) 범위에서 동작. 여러 기기 공유는 배포 시 서버 DB 연결 필요.
 * 사용: window.BimtcStore
 */
(function () {
  var KEY = 'bimtc_db_v1';
  var listeners = [];

  function nowISO() { return new Date().toISOString(); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function seed() {
    return {
      accounts: [
        // 데모 계정 (실제 가입도 가능). 비밀번호는 데모용 평문.
        { id: uid(), type: 'exhibitor', name: '굿모닝병원', country: '대한민국', category: '종합병원', email: 'exhibitor@bimtc.test', password: '1234', interests: ['건강검진', '척추·관절'], createdAt: nowISO() },
        { id: uid(), type: 'buyer', name: 'Ivanov Medical Group', country: '러시아', category: '의료관광 에이전시', email: 'buyer@bimtc.test', password: '1234', interests: ['건강검진', '중입자치료'], createdAt: nowISO() }
      ],
      // 매칭 대상 디렉터리(승인된 참가기업·바이어). 파트너 찾기에 노출.
      directory: [
        { id: 'd1', type: 'buyer', name: 'Saigon Wellness Tour', country: '베트남', org: '아웃바운드 여행사', tags: ['뷰티', '웰니스'] },
        { id: 'd2', type: 'exhibitor', name: '리팅성형외과', country: '대한민국', org: '성형외과', tags: ['성형', '리프팅'] },
        { id: 'd3', type: 'buyer', name: 'Mongol Med Travel', country: '몽골', org: '의료 중개', tags: ['건강검진', '성형'] },
        { id: 'd4', type: 'exhibitor', name: '좋은강안병원', country: '대한민국', org: '종합병원', tags: ['검진', '재활'] },
        { id: 'd5', type: 'buyer', name: 'Almaty Health Partners', country: '카자흐스탄', org: '헬스케어 유통', tags: ['뷰티', '검진'] },
        { id: 'd6', type: 'exhibitor', name: '부산365mc병원', country: '대한민국', org: '비만·체형', tags: ['비만', '검진'] }
      ],
      applications: [], // 참가/비즈미팅 신청 {id,orgName,contact,type,field,purpose,preferredDate,status,createdAt}
      visitors: [],     // 참관 사전등록 {id,name,phone,email,org,interests,day,createdAt}
      requests: [],     // 1:1 미팅 요청 {id,fromEmail,fromName,fromType,toName,toDirId,message,status,createdAt}
      reservations: [], // 예약 {id,ownerEmail,day,table,slot,partner,createdAt}
      matches: [],      // 관리자 매칭 확정 {id,a,b,status}
      notices: [
        { id: uid(), tag: '모집', title: '2026 부산국제의료관광컨벤션 참가기업 모집 안내', date: '2026.06.10', on: true },
        { id: uid(), tag: '매칭', title: '바이어 비즈니스 미팅 사전 매칭 신청 접수', date: '2026.06.02', on: true },
        { id: uid(), tag: '등록', title: '참관객 사전등록 오픈 및 사전등록 혜택 안내', date: '2026.05.21', on: true },
        { id: uid(), tag: '안내', title: '부스 배치도 및 참가 신청 절차 공지', date: '2026.05.08', on: false }
      ],
      session: null // 로그인된 사용자 email
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) { var s = seed(); localStorage.setItem(KEY, JSON.stringify(s)); return s; }
      return JSON.parse(raw);
    } catch (e) { var s2 = seed(); return s2; }
  }

  function save(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
    emit();
  }

  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  // 다른 탭에서의 변경 반영
  window.addEventListener('storage', function (e) { if (e.key === KEY) emit(); });

  var API = {
    _load: load,
    onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    reset: function () { localStorage.removeItem(KEY); load(); emit(); },

    // ---- 인증 ----
    signup: function (o) {
      var db = load();
      if (!o.email || !o.password) return { ok: false, error: '이메일과 비밀번호를 입력하세요.' };
      if (db.accounts.some(function (a) { return a.email.toLowerCase() === o.email.toLowerCase(); }))
        return { ok: false, error: '이미 가입된 이메일입니다.' };
      var user = { id: uid(), type: o.type || 'exhibitor', name: o.name || '', country: o.country || '', category: o.category || '', email: o.email, password: o.password, interests: o.interests || [], createdAt: nowISO() };
      db.accounts.push(user); db.session = user.email; save(db);
      return { ok: true, user: user };
    },
    login: function (email, password) {
      var db = load();
      var u = db.accounts.find(function (a) { return a.email.toLowerCase() === (email || '').toLowerCase(); });
      if (!u) return { ok: false, error: '등록되지 않은 이메일입니다.' };
      if (u.password !== password) return { ok: false, error: '비밀번호가 일치하지 않습니다.' };
      db.session = u.email; save(db);
      return { ok: true, user: u };
    },
    logout: function () { var db = load(); db.session = null; save(db); },
    currentUser: function () { var db = load(); return db.session ? db.accounts.find(function (a) { return a.email === db.session; }) || null : null; },

    // ---- 참가/비즈미팅 신청 ----
    addApplication: function (a) { var db = load(); var rec = Object.assign({ id: uid(), status: 'pending', createdAt: nowISO() }, a); db.applications.unshift(rec); save(db); return rec; },
    listApplications: function () { return load().applications; },
    setApplicationStatus: function (id, status) { var db = load(); db.applications = db.applications.map(function (x) { return x.id === id ? Object.assign({}, x, { status: status }) : x; }); save(db); },

    // ---- 참관 사전등록 ----
    addVisitor: function (v) { var db = load(); var rec = Object.assign({ id: uid(), createdAt: nowISO() }, v); db.visitors.unshift(rec); save(db); return rec; },
    listVisitors: function () { return load().visitors; },

    // ---- 파트너/디렉터리 ----
    listPartners: function () {
      var db = load(); var me = db.session;
      var fromDir = db.directory.slice();
      // 승인된 참가기업 계정도 파트너로 노출
      db.accounts.forEach(function (a) { if (a.email !== me) fromDir.push({ id: 'a_' + a.id, type: a.type, name: a.name, country: a.country, org: a.category, tags: a.interests || [] }); });
      return fromDir;
    },

    // ---- 1:1 요청 ----
    addRequest: function (r) { var db = load(); var rec = Object.assign({ id: uid(), status: 'pending', createdAt: nowISO() }, r); db.requests.unshift(rec); save(db); return rec; },
    listRequests: function () { return load().requests; },
    // 현재 사용자가 받은 요청
    inboxRequests: function () { var db = load(); var me = db.session; return db.requests.filter(function (r) { return r.toEmail === me; }); },
    sentRequests: function () { var db = load(); var me = db.session; return db.requests.filter(function (r) { return r.fromEmail === me; }); },
    setRequestStatus: function (id, status) { var db = load(); db.requests = db.requests.map(function (x) { return x.id === id ? Object.assign({}, x, { status: status }) : x; }); save(db); },
    // 첫 로그인 사용자에게 데모 수신요청 시드(비어있을 때만)
    seedInboxFor: function (email) {
      var db = load();
      var has = db.requests.some(function (r) { return r.toEmail === email; });
      if (has) return;
      var seeds = [
        { fromName: 'Tashkent Medical Tour', fromType: 'buyer', country: '우즈베키스탄', org: '의료관광 에이전시', message: '심혈관 검진 패키지 제휴에 관심이 있습니다.' },
        { fromName: 'Bangkok Beauty Co.', fromType: 'buyer', country: '태국', org: '뷰티 유통', message: '피부·레이저 시술 송출 협력을 희망합니다.' }
      ];
      seeds.forEach(function (s) { db.requests.unshift({ id: uid(), fromEmail: 'seed_' + uid() + '@x', fromName: s.fromName, fromType: s.fromType, country: s.country, org: s.org, toEmail: email, toName: '', message: s.message, status: 'pending', createdAt: nowISO() }); });
      save(db);
    },

    // ---- 예약 ----
    listReservations: function (day) { var db = load(); var me = db.session; return db.reservations.filter(function (r) { return (!day || r.day === day); }); },
    myReservations: function () { var db = load(); var me = db.session; return db.reservations.filter(function (r) { return r.ownerEmail === me; }); },
    reservationAt: function (day, table, slot) { var db = load(); return db.reservations.find(function (r) { return r.day === day && r.table === table && r.slot === slot; }) || null; },
    addReservation: function (o) {
      var db = load();
      var exists = db.reservations.find(function (r) { return r.day === o.day && r.table === o.table && r.slot === o.slot; });
      if (exists) return { ok: false, error: '이미 예약된 시간입니다.', reservation: exists };
      var rec = Object.assign({ id: uid(), ownerEmail: db.session, createdAt: nowISO() }, o);
      db.reservations.push(rec); save(db); return { ok: true, reservation: rec };
    },
    removeReservation: function (id) { var db = load(); db.reservations = db.reservations.filter(function (r) { return r.id !== id; }); save(db); },

    // ---- 관리자: 매칭 ----
    listMatches: function () { return load().matches; },
    addMatch: function (m) { var db = load(); db.matches.unshift(Object.assign({ id: uid(), status: 'done' }, m)); save(db); },

    // ---- 공지(CMS) ----
    listNotices: function () { return load().notices; },
    publishedNotices: function () { return load().notices.filter(function (n) { return n.on; }); },
    addNotice: function (n) { var db = load(); db.notices.unshift(Object.assign({ id: uid(), on: true }, n)); save(db); },
    toggleNotice: function (id) { var db = load(); db.notices = db.notices.map(function (x) { return x.id === id ? Object.assign({}, x, { on: !x.on }) : x; }); save(db); },
    updateNotice: function (id, patch) { var db = load(); db.notices = db.notices.map(function (x) { return x.id === id ? Object.assign({}, x, patch) : x; }); save(db); }
  };

  window.BimtcStore = API;
  load(); // 초기 시드 보장
})();
