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
        try {
          await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js');
        } catch (e) {
          await loadScript('https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.min.js');
        }
      }
      _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
      return _client;
    })();
    return _ready;
  }

  // rentals 는 선택한 비품이 있을 때만 payload 에 넣는다.
  // booth_applications.rentals 컬럼이 아직 없는 환경에서도 기존 신청이 그대로 동작하게 하기 위함.
  function withRentals(row, r) {
    if (r && typeof r === 'object' && Object.keys(r).some(function (k) { return Number(r[k]) > 0; })) row.rentals = r;
    return row;
  }

  var DB = {
    ready: ready,
    client: function () { return _client; },
    // 화상 미팅 시그널링용 채널. client() 는 초기화 전에 null 일 수 있어 ready() 를 거친다.
    async realtimeChannel(name, opts) {
      var sb = await ready();
      return sb.channel(name, opts || {});
    },
    async realtimeRemove(ch) {
      try { var sb = await ready(); sb.removeChannel(ch); } catch (e) {}
    },

    // ---------- Auth ----------
    async signup(o) {
      var sb = await ready();
      var res = await sb.auth.signUp({
        email: o.email, password: o.password,
        options: { data: { type: o.type || 'exhibitor', name: o.name || '', country: o.country || '', category: o.category || '', dept: o.dept || '', phone: o.phone || '', interests: o.interests || [], first_name: o.firstName || '', last_name: o.lastName || '', job_title: o.jobTitle || '', industry: o.industry || '', landline: o.landline || '', attend_mode: o.attendMode || 'onsite' } }
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
    async resetPassword(email) {
      var sb = await ready();
      var base = location.origin + location.pathname.replace(/[^\/]*$/, '') ;
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async updatePassword(pw) {
      var sb = await ready();
      var r = await sb.auth.updateUser({ password: pw });
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async updateProfile(fields) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      if (!u) return { ok: false, error: '로그인이 필요합니다' };
      var r = await sb.from('profiles').update(fields).eq('id', u.id);
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async myBoothApplications() {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user; if (!u) return [];
      var r = await sb.from('booth_applications').select('*').eq('profile_id', u.id).order('created_at', { ascending: false });
      return r.data || [];
    },
    async listNotifications() { var sb = await ready(); var r = await sb.from('notification_queue').select('*').order('created_at', { ascending: false }); return r.error ? [] : (r.data || []); },
    async setNotificationStatus(id, status) { var sb = await ready(); var r = await sb.from('notification_queue').update({ status: status }).eq('id', id); return r.error ? { ok: false, error: r.error.message } : { ok: true }; },
    // ---------- 부스 신청 / 견적 ----------
    async takenBooths() {
      var sb = await ready();
      var r = await sb.rpc('taken_booths');
      var set = {};
      (r.data || []).forEach(function (row) { (row.booth_ids || []).forEach(function (id) { set[id] = 1; }); });
      return set;
    },
    async uploadLogo(file) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      if (!u) return { ok: false, error: '로그인이 필요합니다' };
      var ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [''])[0].toLowerCase();
      var path = u.id + '/' + Date.now() + ext;
      var r = await sb.storage.from('logos').upload(path, file, { upsert: false });
      if (r.error) return { ok: false, error: r.error.message };
      var pub = sb.storage.from('logos').getPublicUrl(path);
      return { ok: true, url: pub.data.publicUrl, name: file.name };
    },
    async addBoothApplication(a) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      var res = await sb.from('booth_applications').insert(withRentals({
        profile_id: u ? u.id : null, company: a.company, contact: a.contact, email: a.email, phone: a.phone,
        booth_type: a.booth_type, booth_ids: a.booth_ids || [], addons: a.addons || {},
        subtotal: a.subtotal, vat: a.vat, total: a.total,
        fam_tour: !!a.fam_tour, returning_company: a.returning_company || null,
        discount: a.discount || 0, early_bird: a.early_bird || null,
        logo_url: a.logo_url || null, logo_name: a.logo_name || null,
        applicant: a.applicant || {}
      }, a.rentals)).select().single();
      return res.error ? { ok: false, error: res.error.message } : { ok: true, row: res.data };
    },
    async updateBoothApplication(id, a) {
      var sb = await ready();
      var r = await sb.from('booth_applications').update(withRentals({
        company: a.company, contact: a.contact, email: a.email, phone: a.phone,
        booth_type: a.booth_type, booth_ids: a.booth_ids || [], addons: a.addons || {},
        subtotal: a.subtotal, vat: a.vat, total: a.total,
        fam_tour: !!a.fam_tour, returning_company: a.returning_company || null,
        discount: a.discount || 0, early_bird: a.early_bird || null,
        logo_url: a.logo_url || null, logo_name: a.logo_name || null,
        applicant: a.applicant || {},
        rentals: a.rentals || {}        // 수정에서는 항상 보낸다. 안 그러면 비품을 모두 뺄 수 없다.
      }, a.rentals)).eq('id', id).select();
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data || !r.data.length) return { ok: false, error: '수정할 수 없는 상태입니다 (입금완료·반려된 신청은 사무국으로 연락해 주세요)' };
      return { ok: true, row: r.data[0] };
    },
    async isAdmin() { var u = await this.currentUser(); return !!(u && u.is_admin); },
    async listMembers() {
      var sb = await ready();
      var r = await sb.from('profiles').select('*').order('created_at', { ascending: false });
      return r.data || [];
    },
    async getLayout() {
      var sb = await ready();
      var r = await sb.from('site_settings').select('value').eq('key', 'booth_layout').maybeSingle();
      return (r.data && r.data.value) ? r.data.value : null;
    },
    async getEarlyBird() {
      var sb = await ready();
      var r = await sb.from('site_settings').select('value, updated_at').eq('key', 'early_bird').maybeSingle();
      if (r.data && r.data.updated_at) window.__bimtcEbOvTs = r.data.updated_at; // 저장 시각 (오픈 전 잠금값 판별용)
      return (r.data && r.data.value) ? r.data.value : null;
    },
    // 사무국이 예약 현황판에서 닫아 둔 시간대. { 'D1-3-5': 1, ... } 형태로 site_settings 에 보관한다
    // (기존에는 화면 state 에만 있어 새로고침하면 사라졌다).
    // 부스 단가·할인율. 서버 재계산 트리거와 같은 값을 읽어 화면 금액이 갈라지지 않게 한다.
    async getPricing() {
      var sb = await ready();
      var r = await sb.from('site_settings').select('value').eq('key', 'pricing').maybeSingle();
      return (r.data && r.data.value) ? r.data.value : null;
    },
    async getClosedSlots() {
      var sb = await ready();
      var r = await sb.from('site_settings').select('value').eq('key', 'closed_slots').maybeSingle();
      return (r.data && r.data.value) ? r.data.value : {};
    },
    async saveClosedSlots(obj) {
      var sb = await ready();
      var r = await sb.from('site_settings').upsert({ key: 'closed_slots', value: obj, updated_at: new Date().toISOString() });
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async saveEarlyBird(obj) {
      var sb = await ready();
      var r = await sb.from('site_settings').upsert({ key: 'early_bird', value: obj, updated_at: new Date().toISOString() });
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    // 홈페이지 공개용: 승인된 참가기업만 (public_exhibitors 뷰 — [v8] SQL)
    async listPublicExhibitors() {
      var sb = await ready();
      var r = await sb.from('public_exhibitors').select('*');
      return r.error ? [] : (r.data || []);
    },
    async saveLayout(obj) {
      var sb = await ready();
      var r = await sb.from('site_settings').upsert({ key: 'booth_layout', value: obj, updated_at: new Date().toISOString() }).select().single();
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    // 부스 유치 대상 명단 (관리자 전용 · booth_prospects)
    async listProspects() {
      var sb = await ready();
      var r = await sb.from('booth_prospects').select('*').order('seq', { ascending: true });
      if (r.error) return [];
      return r.data || [];
    },
    // 여러 사람이 같은 화면을 보므로, 마지막으로 본 시각 이후 바뀐 행만 주기적으로 받아온다
    async listProspectChanges(since) {
      var sb = await ready();
      var q = sb.from('booth_prospects').select('id,seq,source,status,memo,contacted_at,joined_manual,updated_at,updated_by,name,med_type,tel,mgr_name,mgr_dept,mgr_email,target_countries,address,org_type,src_key');
      if (since) q = q.gt('updated_at', since);
      var r = await q;
      if (r.error) return [];
      return r.data || [];
    },
    // 유치 대상 기관 추가. 이미 있는 곳(기관명|전화|우편번호가 같은 곳)은 건너뛴다.
    async addProspects(rows) {
      var sb = await ready();
      var clean = [], seen = {};
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        var name = String(r.name || '').trim();
        if (!name) continue;
        var tel = String(r.tel || '').trim(), zip = String(r.zipcode || '').trim();
        var key = name + '|' + tel + '|' + zip;
        if (seen[key]) continue;            // 붙여넣기 안에서 중복된 줄
        seen[key] = 1;
        clean.push({ src_key: key, name: name, tel: tel || null, zipcode: zip || null,
          org_type: String(r.org_type || '의료기관').trim() || null,
          med_type: String(r.med_type || '').trim() || null,
          found_type: String(r.found_type || '').trim() || null,
          ceo: String(r.ceo || '').trim() || null,
          address: String(r.address || '').trim() || null,
          target_countries: String(r.target_countries || '').trim() || null,
          mgr_name: String(r.mgr_name || '').trim() || null,
          mgr_dept: String(r.mgr_dept || '').trim() || null,
          mgr_email: String(r.mgr_email || '').trim() || null,
          memo: String(r.memo || '').trim() || null,
          source: 'manual' });
      }
      if (!clean.length) return { ok: true, added: 0, skipped: 0 };
      var added = 0;
      for (var j = 0; j < clean.length; j += 100) {    // 한 번에 100건씩
        var part = clean.slice(j, j + 100);
        var res = await sb.from('booth_prospects')
          .upsert(part, { onConflict: 'src_key', ignoreDuplicates: true })
          .select('id');
        if (res.error) return { ok: false, error: res.error.message, added: added };
        added += (res.data || []).length;
      }
      return { ok: true, added: added, skipped: clean.length - added };
    },
    // 기관 정보 수정 (이름 오탈자·연락처 등). 유치 표시·메모는 건드리지 않는다.
    async updateProspectInfo(id, fields) {
      var sb = await ready();
      var name = String(fields.name == null ? '' : fields.name).trim();
      if (!name) return { ok: false, error: '기관명을 입력하세요' };
      var tel = String(fields.tel || '').trim();
      var zip = String(fields.zipcode || '').trim();
      var f = {
        name: name,
        tel: tel || null,
        zipcode: zip || null,
        med_type: String(fields.med_type || '').trim() || null,
        org_type: String(fields.org_type || '').trim() || null,
        ceo: String(fields.ceo || '').trim() || null,
        address: String(fields.address || '').trim() || null,
        target_countries: String(fields.target_countries || '').trim() || null,
        mgr_name: String(fields.mgr_name || '').trim() || null,
        mgr_dept: String(fields.mgr_dept || '').trim() || null,
        mgr_email: String(fields.mgr_email || '').trim() || null,
        src_key: name + '|' + tel + '|' + zip   // 나중에 같은 기관을 또 붙여넣어도 중복되지 않도록 맞춰 둔다
      };
      var r = await sb.from('booth_prospects').update(f).eq('id', id).select('id');
      if (r.error) {
        if (String(r.error.code) === '23505' || /duplicate key/i.test(r.error.message || '')) {
          return { ok: false, error: '같은 기관(기관명·대표전화)이 이미 명단에 있습니다' };
        }
        return { ok: false, error: r.error.message };
      }
      if (!r.data || !r.data.length) return { ok: false, error: '수정 권한이 없거나 대상을 찾지 못했습니다' };
      return { ok: true };
    },
    // 직접 추가한 곳만 지울 수 있다. 원본 명단(source='excel')은 지워지지 않는다.
    async deleteProspect(id) {
      var sb = await ready();
      var r = await sb.from('booth_prospects').delete().eq('id', id).eq('source', 'manual').select('id');
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data || !r.data.length) return { ok: false, error: '원본 명단은 삭제할 수 없습니다' };
      return { ok: true };
    },
    // 삭제는 '바뀐 행' 조회로 알 수 없다. 건수만 가볍게 받아 와 비교한다(행은 받지 않음).
    async countProspects() {
      var sb = await ready();
      var r = await sb.from('booth_prospects').select('id', { count: 'exact', head: true });
      if (r.error) return null;
      return typeof r.count === 'number' ? r.count : null;
    },
    async updateProspect(id, fields) {
      var sb = await ready();
      var f = {};
      if (fields.status !== undefined) f.status = fields.status;
      if (fields.memo !== undefined) f.memo = fields.memo;
      if (fields.contacted_at !== undefined) f.contacted_at = fields.contacted_at;
      if (fields.joined_manual !== undefined) f.joined_manual = fields.joined_manual;
      if (!Object.keys(f).length) return { ok: true };
      var r = await sb.from('booth_prospects').update(f).eq('id', id);
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    // ── 온라인 바이어 사전신청 (가입 없이 받은 별도 명단) ──
    // 신청 접수는 공개 함수 online_buyer_apply 가 하고(buyer-apply.html), 여기는 관리자용 조회·정리만 한다.
    async listOnlineBuyerLeads() {
      var sb = await ready();
      var r = await sb.from('online_buyer_leads').select('*').order('created_at', { ascending: false });
      if (r.error) return [];
      return r.data || [];
    },
    async updateOnlineBuyerLead(id, fields) {
      var sb = await ready();
      var f = {};
      if (fields.status !== undefined) f.status = fields.status;
      if (fields.memo !== undefined) f.memo = fields.memo;
      if (fields.moved_at !== undefined) f.moved_at = fields.moved_at;
      if (fields.moved_profile !== undefined) f.moved_profile = fields.moved_profile;
      if (!Object.keys(f).length) return { ok: true };
      var r = await sb.from('online_buyer_leads').update(f).eq('id', id);
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async deleteOnlineBuyerLead(id) {
      var sb = await ready();
      var r = await sb.from('online_buyer_leads').delete().eq('id', id);
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    // 사무국이 전화로 본인 확인을 한 뒤 임시 비밀번호를 발급한다.
    // 실제 변경은 Edge Function(admin-reset-password)에서만 하고, 거기서 관리자인지 다시 확인한다.
    async adminResetPassword(profileId) {
      var sb = await ready();
      var r = await sb.functions.invoke('admin-reset-password', { body: { user_id: profileId } });
      if (r.error) {
        var msg = '';
        try { msg = (await r.error.context.json()).error; } catch (e) { }
        return { ok: false, error: msg || r.error.message || '비밀번호 재설정에 실패했습니다.' };
      }
      var d = r.data || {};
      if (!d.ok) return { ok: false, error: d.error || '비밀번호 재설정에 실패했습니다.' };
      return { ok: true, password: d.password, name: d.name, email: d.email };
    },
    async listBoothApplications() { var sb = await ready(); var r = await sb.from('booth_applications').select('*').order('created_at', { ascending: false }); return r.data || []; },
    async adminDeleteMember(profileId) {
      var sb = await ready();
      var r = await sb.rpc('admin_delete_member', { target_id: profileId });
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true };
    },
    async grantMatchRight(p) {
      var sb = await ready();
      var r = await sb.from('booth_applications').insert({
        profile_id: p.id, company: p.name || '(공동 참가)', contact: '공동 참가 (부스 공유)',
        email: p.email || '', phone: p.phone || '', booth_type: 'package', booth_ids: [],
        subtotal: 0, vat: 0, total: 0, status: 'approved'
      }).select();
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true };
    },
    async adminUpdateApplication(id, fields) {
      var sb = await ready();
      var r = await sb.from('booth_applications').update(fields).eq('id', id).select();
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data || !r.data.length) return { ok: false, error: '수정 권한이 없거나 대상을 찾지 못했습니다' };
      return { ok: true, row: r.data[0] };
    },
    async setBoothStatus(id, status) {
      var sb = await ready();
      var r = await sb.from('booth_applications').update({ status: status }).eq('id', id).select();
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data || !r.data.length) return { ok: false, error: '권한이 없거나 대상을 찾지 못했습니다' };
      return { ok: true };
    },
    async setBoothPaid(id, on) { var sb = await ready(); var r = await sb.from('booth_applications').update({ paid: on, paid_at: on ? new Date().toISOString() : null }).eq('id', id); return !r.error; },
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
      });
      return res.error ? { ok: false, error: res.error.message } : { ok: true };
    },
    async listVisitors() { var sb = await ready(); var r = await sb.from('visitor_registrations').select('*').order('created_at', { ascending: false }); return r.data || []; },
    async addInquiry(q) {
      var sb = await ready();
      var res = await sb.from('inquiries').insert({ name: q.name, org: q.org, email: q.email, category: q.category, message: q.message });
      return res.error ? { ok: false, error: res.error.message } : { ok: true };
    },
    async listInquiries() { var sb = await ready(); var r = await sb.from('inquiries').select('*').order('created_at', { ascending: false }); return r.data || []; },
    async deleteAccount() {
      var sb = await ready();
      var r = await sb.rpc('delete_my_account');
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true };
    },
    async checkInquiries(email) {
      var sb = await ready();
      var r = await sb.rpc('check_inquiries', { p_email: email });
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true, rows: r.data || [] };
    },
    async setInquiryAnswer(id, answer) {
      var sb = await ready();
      var r = await sb.from('inquiries').update({ answer: answer, status: 'answered' }).eq('id', id);
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
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
    async setApplicationStatus(id, status) {
      var sb = await ready();
      var r = await sb.from('applications').update({ status: status }).eq('id', id).select();
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data || !r.data.length) return { ok: false, error: '권한이 없거나 대상을 찾지 못했습니다' };
      return { ok: true };
    },

    // ---------- 파트너(프로필) ----------
    // 파트너 목록은 RPC 로만 받는다. 이메일·전화 등 민감정보는 내려오지 않고,
    // 참가기업은 사무국 승인 부스가 있는 곳만 나온다.
    async listPartners() {
      var sb = await ready();
      var r = await sb.rpc('match_partners');
      if (r.error) return [];
      return r.data || [];
    },

    // ---------- 1:1 요청 (날짜·시간 포함) ----------
    async addRequest(r) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      if (!u) return { ok: false, error: '로그인이 만료되었습니다. 다시 로그인해 주세요.' };
      var res = await sb.from('match_requests').insert({ from_profile: u.id, to_profile: r.to_profile, message: r.message || '', day: r.day || null, slot_idx: (r.slot != null ? r.slot : null), interpreter: !!r.interpreter, mode: r.mode || 'onsite' }).select().single();
      return res.error ? { ok: false, error: res.error.message } : { ok: true, row: res.data };
    },
    // 특정 파트너가 요청/예약으로 이미 잡힌 (day-slot) 목록
    async partnerBusy(partnerId) {
      var sb = await ready();
      var busy = {};
      var rpc = await sb.rpc('partner_busy', { p_partner: partnerId });
      if (!rpc.error) {
        (rpc.data || []).forEach(function (x) { busy[x.day + '-' + x.slot_idx] = 1; });
        return busy;
      }
      // RPC 미설치 환경 폴백 (본인 관련 행만 보임)
      var mr = await sb.from('match_requests').select('day,slot_idx,status,from_profile,to_profile').or('from_profile.eq.' + partnerId + ',to_profile.eq.' + partnerId);
      (mr.data || []).forEach(function (x) { if (x.day != null && x.slot_idx != null && x.status !== 'declined') busy[x.day + '-' + x.slot_idx] = 1; });
      var rv = await sb.from('reservations').select('day,slot_idx,owner_profile,guest_profile').or('owner_profile.eq.' + partnerId + ',guest_profile.eq.' + partnerId);
      (rv.data || []).forEach(function (x) { busy[x.day + '-' + x.slot_idx] = 1; });
      return busy;
    },
    // 받은/보낸 요청도 RPC 로 받는다 (상대 정보는 민감정보 제외)
    async _matchRequests() {
      var sb = await ready();
      var r = await sb.rpc('my_match_requests');
      if (r.error) return [];
      return (r.data || []).map(function (x) {
        var other = {
          id: x.other_id, name: x.other_name, type: x.other_type, country: x.other_country,
          category: x.other_category, first_name: x.other_first_name, last_name: x.other_last_name,
          job_title: x.other_job_title, attend_mode: x.other_attend_mode
        };
        return {
          id: x.id, direction: x.direction, from_profile: x.from_profile, to_profile: x.to_profile,
          message: x.message, status: x.status, created_at: x.created_at, day: x.day,
          slot_idx: x.slot_idx, interpreter: x.interpreter, mode: x.mode,
          from: x.direction === 'in' ? other : null,
          to: x.direction === 'out' ? other : null
        };
      });
    },
    async inboxRequests() {
      var rows = await this._matchRequests();
      return rows.filter(function (x) { return x.direction === 'in'; });
    },
    async sentRequests() {
      var sb = await ready(); var u = (await sb.auth.getUser()).data.user; if (!u) return [];
      var r = await sb.from('match_requests').select('*').eq('from_profile', u.id);
      return r.data || [];
    },
    async sentRequestsDetailed() {
      var rows = await this._matchRequests();
      return rows.filter(function (x) { return x.direction === 'out'; });
    },
    async deleteRequest(id) { var sb = await ready(); var r = await sb.from('match_requests').delete().eq('id', id); return r.error ? { ok: false, error: r.error.message } : { ok: true }; },
    async setRequestStatus(id, status) {
      var sb = await ready();
      var r = await sb.from('match_requests').update({ status: status }).eq('id', id).select();
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data || !r.data.length) return { ok: false, error: '권한이 없거나 대상을 찾지 못했습니다' };
      return { ok: true };
    },
    // 요청 수락 → 예약 생성(빈 테이블 자동 배정) + 양측 정보 기록
    // 미팅은 '참가기업 자기 부스'에서 한다. (라운지 테이블 배정 방식 폐지)
    // 요청한 쪽이 참가기업이든 바이어든, 장소는 언제나 참가기업의 부스다.
    // 내 부스가 아니라 '상대 참가기업'의 부스를 읽어야 하므로 RPC 로 조회한다
    async boothPlaceOf(profileId) {
      var sb = await ready();
      var r = await sb.rpc('booth_place_of', { p_profile: profileId });
      if (r.error || !r.data) return '독립부스 (사무국 안내)';
      return r.data;
    },
    async acceptRequest(req, myName) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      var day = req.day, slot = req.slot_idx;
      if (day == null || slot == null) { await this.setRequestStatus(req.id, 'accepted'); return { ok: true, noSlot: true }; }

      // 둘 중 참가기업 쪽의 부스를 장소로 쓴다
      var me = (await sb.from('profiles').select('type').eq('id', u.id).maybeSingle()).data;
      var exhibitorId = (me && me.type === 'buyer') ? req.from_profile : u.id;
      var place = await this.boothPlaceOf(exhibitorId);

      var ins = await sb.from('reservations').insert({
        owner_profile: u.id, guest_profile: req.from_profile, day: day, slot_idx: slot,
        table_idx: null, place: place, mode: req.mode || 'onsite', host_name: myName || '',
        guest_name: (req.from && req.from.name) || req.fromName || '',
        partner_name: (req.from && req.from.name) || '', interpreter: !!req.interpreter
      }).select().single();
      if (ins.error) {
        var m = ins.error.message || '';
        if (/이미 다른 미팅/.test(m)) return { ok: false, error: '그 시간에는 이미 다른 미팅이 잡혀 있습니다. 다른 시간으로 요청해 주세요.' };
        return { ok: false, error: m };
      }
      await this.setRequestStatus(req.id, 'accepted');
      return { ok: true, place: place };
    },

    // ---------- 예약 ----------
    async listReservations(day) { var sb = await ready(); var q = sb.from('reservations').select('*'); if (day) q = q.eq('day', day); var r = await q; return r.data || []; },
    async myReservations() { var sb = await ready(); var u = (await sb.auth.getUser()).data.user; if (!u) return []; var r = await sb.from('reservations').select('*').or('owner_profile.eq.' + u.id + ',guest_profile.eq.' + u.id); return r.data || []; },
    // 사무국이 확정 미팅에 화상 링크를 넣는다 (중국 바이어는 텐센트 회의 등 접속 가능한 것으로)
    // 홈페이지 자체 화상미팅 — 내가 당사자인 미팅만 가져온다
    async getMeeting(id) {
      var sb = await ready();
      var u = (await sb.auth.getUser()).data.user;
      if (!u) return { ok: false, error: '로그인이 필요합니다' };
      var r = await sb.from('reservations').select('*').eq('id', id).maybeSingle();
      if (r.error) return { ok: false, error: r.error.message };
      var m = r.data;
      if (!m) return { ok: false, error: '미팅을 찾을 수 없습니다' };
      var mine = (m.owner_profile === u.id) || (m.guest_profile === u.id);
      var adm = false;
      try { var pr = await sb.from('profiles').select('is_admin').eq('id', u.id).maybeSingle(); adm = !!(pr.data && pr.data.is_admin); } catch (e) {}
      if (!mine && !adm) return { ok: false, error: '이 미팅의 참가자가 아닙니다' };
      // 먼저 요청한 쪽(owner)이 연결을 거는 쪽이 되도록 고정한다. 둘이 동시에 걸면 연결이 꼬인다.
      return { ok: true, meeting: m, meId: u.id, isCaller: m.owner_profile === u.id };
    },
    // ---------- 비즈매칭 오픈 스위치 ----------
    async bizMatchingOpen() {
      var sb = await ready();
      var r = await sb.from('site_settings').select('value').eq('key', 'biz_matching').maybeSingle();
      return !!(r.data && r.data.value && r.data.value.open);
    },
    async setBizMatchingOpen(on) {
      var sb = await ready();
      var r = await sb.from('site_settings').upsert({ key: 'biz_matching', value: { open: !!on }, updated_at: new Date().toISOString() });
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async getIceServers() {
      var sb = await ready();
      var r = await sb.from('site_settings').select('value').eq('key', 'webrtc').maybeSingle();
      var v = (r.data && r.data.value) || {};
      return (v.iceServers && v.iceServers.length) ? v.iceServers
        : [{ urls: 'stun:stun.l.google.com:19302' }];
    },
    async setMeetingLink(id, platform, url) {
      var sb = await ready();
      var r = await sb.from('reservations')
        .update({ platform: platform || null, meet_url: (url || '').trim() || null })
        .eq('id', id).select('id');
      if (r.error) return { ok: false, error: r.error.message };
      if (!r.data || !r.data.length) return { ok: false, error: '권한이 없거나 대상을 찾지 못했습니다' };
      return { ok: true };
    },
    async setMeetingMode(id, mode) {
      var sb = await ready();
      var r = await sb.from('reservations').update({ mode: mode }).eq('id', id).select('id');
      if (r.error) return { ok: false, error: r.error.message };
      return { ok: true };
    },
    async removeReservation(id) {
      var sb = await ready();
      var r = await sb.from('reservations').delete().eq('id', id);
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    // 미팅은 참가기업 부스에서 한다. 라운지 테이블 배정은 폐지됐으므로 날짜·시간만 바꾼다.
    // 같은 사람이 같은 시간에 두 건을 갖는 것은 DB 트리거(guard_meeting_overlap)가 막는다.
    async rescheduleReservation(id, day, slot) {
      var sb = await ready();
      var up = await sb.from('reservations').update({ day: day, slot_idx: slot }).eq('id', id).select();
      if (up.error) return { ok: false, error: up.error.message };
      if (!up.data || !up.data.length) return { ok: false, error: '권한이 없거나 대상을 찾지 못했습니다' };
      return { ok: true };
    },

    // ---------- 매칭(관리자) ----------
    async listMatchRequests() { var sb = await ready(); var r = await sb.from('match_requests').select('*, from:profiles!match_requests_from_profile_fkey(name,first_name,last_name), to:profiles!match_requests_to_profile_fkey(name,first_name,last_name)').order('created_at', { ascending: false }); return r.data || []; },

    // ---------- 공지(CMS) ----------
    async publishedNotices() { var sb = await ready(); var r = await sb.from('notices').select('*').eq('published', true).order('published_at', { ascending: false }); return r.data || []; },
    async listNotices() { var sb = await ready(); var r = await sb.from('notices').select('*').order('published_at', { ascending: false }); return r.data || []; },
    async addNotice(n) { var sb = await ready(); var res = await sb.from('notices').insert({ tag: n.tag, title: n.title, published: n.published !== false }).select().single(); return res.data; },
    async toggleNotice(id, on) {
      var sb = await ready();
      var r = await sb.from('notices').update({ published: on }).eq('id', id);
      return r.error ? { ok: false, error: r.error.message } : { ok: true };
    },
    async updateNotice(id, fields) { var sb = await ready(); var r = await sb.from('notices').update(fields).eq('id', id); return !r.error; },
    async deleteNotice(id) { var sb = await ready(); var r = await sb.from('notices').delete().eq('id', id); return !r.error; }
  };

  window.BimtcDB = DB;
})();
