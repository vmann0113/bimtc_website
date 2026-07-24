/*
 * BIMTC ↔ Supabase 연동 (bimtc-supabase.js)
 * - 실제 회원가입/로그인(Auth), 사전등록·신청·요청·예약·공지(DB)를 담당.
 * - supabase-js v2 를 CDN에서 로드해 window.BimtcDB 로 노출.
 * - 세 화면(메인/비즈미팅/관리자)이 이 모듈 하나를 공유한다.
 */
(function () {
  var SUPABASE_URL = 'https://xkomxbskwvtofpglback.supabase.co';
  var SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhrb214YnNrd3Z0b2ZwZ2xiYWNrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ0NjIxNzYsImV4cCI6MjEwMDAzODE3Nn0.YVBpieLDFP4AyeapuiRmjrDyZYdAHfiudnUdRPG65mo';

  var _client = null;
  var _ready = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function ready() {
    if (_ready) return _ready;
    _ready = (async function () {
      if (!window.supabase) {
        await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
      }
      _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      return _client;
    })();
    return _ready;
  }

  var DB = {
    ready: ready,
    client: function () { return _client; },

    // ---------- Auth ----------
    async signup(o) {
      var sb = await ready();
      var res = await sb.auth.signUp({
        email: o.email, password: o.password,
        options: { data: { type: o.type || 'exhibitor', name: o.name || '', country: o.country || '', category: o.category || '', interests: o.interests || [] } }
      });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, user: res.data.user, session: res.data.session };
    },
    async login(email, password) {
      var sb = await ready();
      var res = await sb.auth.signInWithPassword({ email: email, password: password });
      if (res.error) return { ok: false, error: res.error.message };
      return { ok: true, user: res.data.user, session: res.data.session };
    },
    async logout() { var sb = await ready(); await sb.auth.signOut(); },
    // ---------- 부스 신청 / 견적 ----------
    async takenBooths() {
      var sb = await ready();
      var r = await sb.rpc('taken_booths');
      var set = {};
      (r.data || []).forEach(function (row) { (row.booth_ids || []).forEach(function (id) { set[id] = 1; }); });
      return set;
    },
    async addBoothApplication(a) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      var res = await sb.from('booth_applications').insert({
        profile_id: u ? u.id : null, company: a.company, contact: a.contact, email: a.email, phone: a.phone,
        booth_type: a.booth_type, booth_ids: a.booth_ids || [], addons: a.addons || {},
        subtotal: a.subtotal, vat: a.vat, total: a.total,
        fam_tour: !!a.fam_tour, returning_company: a.returning_company || null,
        discount: a.discount || 0, early_bird: a.early_bird || null,
        applicant: a.applicant || {}
      }).select().single();
      return res.error ? { ok: false, error: res.error.message } : { ok: true, row: res.data };
    },
    async isAdmin() { var u = await this.currentUser(); return !!(u && u.is_admin); },
    async getLayout() {
      var sb = await ready();
      var r = await sb.from('site_settings').select('value').eq('key', 'booth_layout').maybeSingle();
      return (r.data && r.data.value) ? r.data.value : null;
    },
    async saveLayout(obj) {
      var sb = await ready();
      var r = await sb.from('site_settings').upsert({ key: 'booth_layout', value: obj, updated_at: new Date().toISOString() }).select().single();
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async listBoothApplications() { var sb = await ready(); var r = await sb.from('booth_applications').select('*').order('created_at', { ascending: false }); return r.data || []; },
    async setBoothStatus(id, status) { var sb = await ready(); await sb.from('booth_applications').update({ status: status }).eq('id', id); },
    async myApprovedBooths() {
      var sb = await ready(); var u = (await sb.auth.getUser()).data.user; if (!u) return { count: 0, approved: 0 };
      var r = await sb.from('booth_applications').select('status').eq('profile_id', u.id);
      var rows = (r.data || []).filter(function (x) { return x.status !== 'cancelled'; });
      return { count: rows.length, approved: rows.filter(function (x) { return x.status === 'approved'; }).length };
    },

    async currentUser() {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      if (!u) return null;
      var p = await sb.from('profiles').select('*').eq('id', u.id).single();
      return p.data ? Object.assign({ email: u.email }, p.data) : { id: u.id, email: u.email };
    },
    async isAdmin() {
      var u = await this.currentUser();
      return !!(u && u.is_admin);
    },

    // ---------- 참관 사전등록 ----------
    async addVisitor(v) {
      var sb = await ready();
      var res = await sb.from('visitor_registrations').insert({
        name: v.name, phone: v.phone, email: v.email, org: v.org, interests: v.interests || [], visit_day: v.day || 'both'
      }).select().single();
      return res.error ? { ok: false, error: res.error.message } : { ok: true, row: res.data };
    },
    async listVisitors() { var sb = await ready(); var r = await sb.from('visitor_registrations').select('*').order('created_at', { ascending: false }); return r.data || []; },
    async checkRegistration(email) {
      var sb = await ready();
      var r = await sb.rpc('check_registration', { p_email: email });
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true, rows: r.data || [] };
    },

    // ---------- 신청 ----------
    async addApplication(a) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      var res = await sb.from('applications').insert({
        profile_id: u ? u.id : null, applicant_type: a.applicant_type, org_name: a.org_name,
        contact: a.contact, field: a.field, purpose: a.purpose, preferred_date: a.preferred_date || 'any'
      }).select().single();
      return res.error ? { ok: false, error: res.error.message } : { ok: true, row: res.data };
    },
    async listApplications() { var sb = await ready(); var r = await sb.from('applications').select('*').order('created_at', { ascending: false }); return r.data || []; },
    async setApplicationStatus(id, status) { var sb = await ready(); await sb.from('applications').update({ status: status }).eq('id', id); },

    // ---------- 파트너(프로필) ----------
    async listPartners() {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      var r = await sb.from('profiles').select('*');
      var rows = (r.data || []).filter(function (p) { return !u || p.id !== u.id; });
      return rows;
    },

    // ---------- 1:1 요청 (날짜·시간 포함) ----------
    async addRequest(r) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      var res = await sb.from('match_requests').insert({ from_profile: u.id, to_profile: r.to_profile, message: r.message || '', day: r.day || null, slot_idx: (r.slot != null ? r.slot : null) }).select().single();
      return res.error ? { ok: false, error: res.error.message } : { ok: true, row: res.data };
    },
    // 특정 파트너가 요청/예약으로 이미 잡힌 (day-slot) 목록
    async partnerBusy(partnerId) {
      var sb = await ready();
      var busy = {};
      var mr = await sb.from('match_requests').select('day,slot_idx,status,from_profile,to_profile').or('from_profile.eq.' + partnerId + ',to_profile.eq.' + partnerId);
      (mr.data || []).forEach(function (x) { if (x.day != null && x.slot_idx != null && x.status !== 'declined') busy[x.day + '-' + x.slot_idx] = 1; });
      var rv = await sb.from('reservations').select('day,slot_idx,owner_profile,guest_profile').or('owner_profile.eq.' + partnerId + ',guest_profile.eq.' + partnerId);
      (rv.data || []).forEach(function (x) { busy[x.day + '-' + x.slot_idx] = 1; });
      return busy;
    },
    async inboxRequests() {
      var sb = await ready(); var u = (await sb.auth.getUser()).data.user; if (!u) return [];
      var r = await sb.from('match_requests').select('*, from:profiles!match_requests_from_profile_fkey(name,type,country,category)').eq('to_profile', u.id).order('created_at', { ascending: false });
      return r.data || [];
    },
    async sentRequests() {
      var sb = await ready(); var u = (await sb.auth.getUser()).data.user; if (!u) return [];
      var r = await sb.from('match_requests').select('*').eq('from_profile', u.id);
      return r.data || [];
    },
    async sentRequestsDetailed() {
      var sb = await ready(); var u = (await sb.auth.getUser()).data.user; if (!u) return [];
      var r = await sb.from('match_requests').select('*, to:profiles!match_requests_to_profile_fkey(name,type,country,category)').eq('from_profile', u.id).order('created_at', { ascending: false });
      return r.data || [];
    },
    async deleteRequest(id) { var sb = await ready(); var r = await sb.from('match_requests').delete().eq('id', id); return r.error ? { ok: false, error: r.error.message } : { ok: true }; },
    async setRequestStatus(id, status) { var sb = await ready(); await sb.from('match_requests').update({ status: status }).eq('id', id); },
    // 요청 수락 → 예약 생성(빈 테이블 자동 배정) + 양측 정보 기록
    async acceptRequest(req, myName) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      var day = req.day, slot = req.slot_idx;
      if (day == null || slot == null) { await this.setRequestStatus(req.id, 'accepted'); return { ok: true, noSlot: true }; }
      var ex = await sb.from('reservations').select('table_idx').eq('day', day).eq('slot_idx', slot);
      var used = {}; (ex.data || []).forEach(function (x) { used[x.table_idx] = 1; });
      var table = -1; for (var i = 0; i < 10; i++) { if (!used[i]) { table = i; break; } }
      if (table < 0) return { ok: false, error: '해당 시간대에 빈 테이블이 없습니다.' };
      var ins = await sb.from('reservations').insert({ owner_profile: u.id, guest_profile: req.from_profile, day: day, slot_idx: slot, table_idx: table, host_name: myName || '', guest_name: (req.from && req.from.name) || req.fromName || '', partner_name: (req.from && req.from.name) || '' }).select().single();
      if (ins.error) return { ok: false, error: (ins.error.code === '23505' ? '해당 시간이 이미 예약되었습니다.' : ins.error.message) };
      await this.setRequestStatus(req.id, 'accepted');
      return { ok: true, table: table };
    },

    // ---------- 예약 ----------
    async listReservations(day) { var sb = await ready(); var q = sb.from('reservations').select('*'); if (day) q = q.eq('day', day); var r = await q; return r.data || []; },
    async myReservations() { var sb = await ready(); var u = (await sb.auth.getUser()).data.user; if (!u) return []; var r = await sb.from('reservations').select('*').or('owner_profile.eq.' + u.id + ',guest_profile.eq.' + u.id); return r.data || []; },
    async removeReservation(id) { var sb = await ready(); await sb.from('reservations').delete().eq('id', id); },
    async rescheduleReservation(id, day, slot) {
      var sb = await ready();
      var ex = await sb.from('reservations').select('id,table_idx').eq('day', day).eq('slot_idx', slot);
      var used = {}; (ex.data || []).forEach(function (x) { if (x.id !== id) used[x.table_idx] = 1; });
      var table = -1; for (var i = 0; i < 10; i++) { if (!used[i]) { table = i; break; } }
      if (table < 0) return { ok: false, error: '해당 시간대에 빈 테이블이 없습니다.' };
      var up = await sb.from('reservations').update({ day: day, slot_idx: slot, table_idx: table }).eq('id', id).select().single();
      if (up.error) return { ok: false, error: (up.error.code === '23505' ? '해당 시간이 이미 예약되었습니다.' : up.error.message) };
      return { ok: true, table: table };
    },

    // ---------- 매칭(관리자) ----------
    async listMatchRequests() { var sb = await ready(); var r = await sb.from('match_requests').select('*, from:profiles!match_requests_from_profile_fkey(name), to:profiles!match_requests_to_profile_fkey(name)').order('created_at', { ascending: false }); return r.data || []; },

    // ---------- 공지(CMS) ----------
    async publishedNotices() { var sb = await ready(); var r = await sb.from('notices').select('*').eq('published', true).order('published_at', { ascending: false }); return r.data || []; },
    async listNotices() { var sb = await ready(); var r = await sb.from('notices').select('*').order('published_at', { ascending: false }); return r.data || []; },
    async addNotice(n) { var sb = await ready(); var res = await sb.from('notices').insert({ tag: n.tag, title: n.title, published: n.published !== false }).select().single(); return res.data; },
    async toggleNotice(id, on) { var sb = await ready(); await sb.from('notices').update({ published: on }).eq('id', id); }
  };

  window.BimtcDB = DB;
})();
