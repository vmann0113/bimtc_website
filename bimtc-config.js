/*
 * BIMTC 운영 설정 (bimtc-config.js)
 * ─────────────────────────────────────────────────────────
 * ★ 사무국이 직접 고치는 값들을 이 파일 한 곳에 모았습니다.
 *   - 신청 오픈/마감, 얼리버드 기간, 부스 배치도, 기존 참가업체 명단, 팸투어 옵션
 *   배치도가 바뀌면 boothLayout 부분만 교체하면 신청 화면이 자동 반영됩니다.
 * window.BIMTC_CONFIG 로 전역 노출됩니다.
 */
(function () {
  var CONFIG = {

    /* 1) 신청 오픈 여부 — false 이면 버튼이 '오픈 예정'으로 표시됩니다.
       관리자(is_admin) 계정은 오픈 전에도 신청 기능을 테스트할 수 있습니다. */
    apply: {
      booth: { open: false, comingLabel: '부스 신청 오픈 예정' },
      buyer: { open: false, comingLabel: '바이어 신청 오픈 예정' },
      visit: { open: true, comingLabel: '사전등록 오픈 예정' }
    },

    /* 2) 얼리버드 단계 — 상단 카운트다운 타이머가 가장 가까운 마감을 표시합니다.
       countdownEnabled:false 이면 기한 미정 → '오픈 예정' 티저를 표시합니다.
       ISO 날짜(현지시간). 지나면 자동으로 다음 단계로 넘어갑니다. */
    countdownEnabled: false,
    earlyBird: [
      { key: 'phase1', label: '1차 조기신청', end: '2026-09-30T23:59:59', discountRate: 0.20 },
      { key: 'phase2', label: '2차 조기신청', end: '2026-10-31T23:59:59', discountRate: 0.10 }
    ],

    /* 3) 기존(직전) 참가업체 — 연속참가 할인 대상(본 행사 1회 이상 참여업체 10% 추가). */
    returningDiscountRate: 0.10,
    returningCompanies: [
      '부산365mc병원', '삼성리한여성의원', '좋은강안병원', '비비비당',
      '에스엠비 웰니스', '범어사', '(주)메디펀', '한중건강관리협회',
      '부산관광공사', '온종합병원', '해운대백병원', '동의의료원',
      '리팅성형외과', '메디컬그룹 웰', '부산위생병원'
    ],

    /* 4) 부스 배치도 — 영화관 좌석식. 실제 도면에 맞춰 이 부분만 수정하세요.
       zones: 구역별. rows: 'A' 같은 행 라벨. seats: 열 개수.
       aisle: 통로로 비워둘 열 번호(1-base) 배열. blocked: 판매 안 함(기둥 등). */
    boothLayout: {
      unitPrice: { package: 2000000, space: 1800000 },
      zones: [
        {
          name: '의료관광관', color: '#0B5FA5',
          rows: [
            { row: 'A', seats: 10, aisle: [5] },
            { row: 'B', seats: 10, aisle: [5] }
          ]
        },
        {
          name: '의료체험·산업관', color: '#11A37B',
          rows: [
            { row: 'C', seats: 10, aisle: [5] },
            { row: 'D', seats: 10, aisle: [5] }
          ]
        }
      ]
    },

    /* 5) 팸투어 옵션 */
    famTour: {
      label: '팸투어(Fam Tour) 참가',
      desc: '부산 의료·관광 인프라 투어 (행사 다음날 운영). 희망 여부를 선택하세요.'
    },

    contact: { office: '(사)부산권의료산업협의회', tel: '051-461-4276~8', email: 'bmia0528@naver.com' }
  };

  // 접수중인 얼리버드: 관리자가 '켜기'한 단계 (접수 오픈의 기준)
  CONFIG.earlyBirdLive = function () {
    for (var i = 0; i < CONFIG.earlyBird.length; i++) {
      var p = CONFIG.earlyBird[i];
      if (CONFIG.earlyBirdOverride[p.key] === 'on') return p;
    }
    // 수동 오픈 상태라면 날짜 기준 단계 표시
    if (CONFIG.apply && CONFIG.apply.booth && CONFIG.apply.booth.open) return CONFIG.currentEarlyBird();
    return null;
  };
  // 현재 유효한 얼리버드 단계 계산 (관리자 온/오프 오버라이드 우선, 기본은 날짜 기준)
  // CONFIG.earlyBirdOverride = { phase1:'on'|'off'|'auto', phase2:... } — DB(site_settings.early_bird)에서 로드됨
  CONFIG.earlyBirdOverride = CONFIG.earlyBirdOverride || window.__bimtcEbOv || {};
  CONFIG.currentEarlyBird = function () {
    var now = Date.now();
    for (var i = 0; i < CONFIG.earlyBird.length; i++) {
      var p = CONFIG.earlyBird[i];
      var mode = CONFIG.earlyBirdOverride[p.key] || 'auto';
      if (mode === 'on') return p;
      if (mode === 'off') continue;
      if (now <= new Date(p.end).getTime()) return p;
    }
    return null; // 얼리버드 종료
  };
  // DB 설정을 로드해 오버라이드 적용 (부스신청·홈 페이지가 mount 시 호출)
  CONFIG.loadEarlyBirdOverride = async function () {
    try {
      if (!window.BimtcDB || !window.BimtcDB.getEarlyBird) return null;
      var v = await window.BimtcDB.getEarlyBird();
      if (v && typeof v === 'object') { CONFIG.earlyBirdOverride = v; window.__bimtcEbOv = v; }
      return CONFIG.earlyBirdOverride;
    } catch (e) { return null; }
  };

  // 배치도를 평면 셀 배열로 전개 (구버전 폴백용)
  CONFIG.boothCells = function () {
    var out = [];
    CONFIG.boothLayout.zones.forEach(function (z) {
      z.rows.forEach(function (r) {
        var cells = [];
        for (var c = 1; c <= r.seats; c++) {
          var isAisle = (r.aisle || []).indexOf(c) >= 0;
          var isBlocked = (r.blocked || []).indexOf(c) >= 0;
          cells.push({
            id: r.row + String(c).padStart(2, '0'),
            aisle: isAisle, blocked: isBlocked, zone: z.name, color: z.color
          });
        }
        out.push({ zone: z.name, color: z.color, row: r.row, cells: cells });
      });
    });
    return out;
  };

  /* 0813 배치도(사무국 제작 이미지) 기반 기본 배치. 셀 1칸 = 3m×3m 부스.
     좌·우 벽면 라인 29칸(좌측 하단 3칸은 비즈니스 존), 상단 STAGE+행사공간,
     중앙 3열×2칸 폭 블록 5단(3+3+3+3+4), 하단 아일랜드 2×2 × 4개 — 총 167부스.
     부스 배치 편집(관리자)에서 수정 후 저장하면 이 기본값 대신 DB 배치가 사용됩니다. */
  CONFIG.blueprintLayout = (function () {
    var zones = [
      { key: 'z1', name: '메디컬존', color: '#8FC784' },
      { key: 'z2', name: '관광웰니스존', color: '#BBDCEF' },
      { key: 'z4', name: '플레잉존', color: '#F2B33D' },
      { key: 'z5', name: '독립부스 구역 (전화 문의)', color: '#9AA7B5' }
    ];
    var cells = {};
    function put(r, c, t, z) { cells[r + '_' + c] = z ? { t: t, z: z } : { t: t }; }
    function block(r0, r1, c0, c1, z) { for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) put(r, c, 'sell', z); }
    var r;
    for (r = 0; r <= 1; r++) for (var c1 = 4; c1 <= 7; c1++) put(r, c1, 'stage');    // STAGE
    for (r = 2; r <= 4; r++) for (var c2 = 3; c2 <= 8; c2++) put(r, c2, 'seating');  // 행사 공간
    // 좌·우 벽면 라인 (r2~28): 최상단 2칸(양쪽)은 부스 없음 · 플레잉 9 · 관광웰니스 9 · 메디컬 나머지
    for (r = 2; r <= 28; r++) {
      var z = r <= 10 ? 'z4' : r <= 19 ? 'z2' : 'z1';
      if (r >= 26) { put(r, 0, 'biz'); } else { put(r, 0, 'sell', z); }  // 좌측 하단 3칸 = 비즈니스
      put(r, 11, 'sell', z === 'z1' || r >= 26 ? 'z1' : z);              // 우측은 끝까지 판매
    }
    // 중앙 블록: 3열(각 2칸 폭) × 5단 (3+3+3+3+4행)
    var bands = [[8, 10, 'z4'], [12, 14, 'z2'], [16, 18, 'z2'], [20, 22, 'z1'], [24, 27, 'z1']];
    bands.forEach(function (b) {
      [[2, 3], [5, 6], [8, 9]].forEach(function (cc) { block(b[0], b[1], cc[0], cc[1], b[2]); });
    });
    // 하단 아일랜드 2×2 × 4 = 독립부스 구역 (온라인 선택 불가 · 사무국 전화 배정) — 렌더러가 +0.5칸 이동해 중앙 정렬
    [[0, 1], [3, 4], [6, 7], [9, 10]].forEach(function (cc) { block(30, 31, cc[0], cc[1], 'z5'); });
    return { rows: 35, cols: 12, zones: zones, cells: cells, doors: { B10: 1 },
      typeColors: { stage: '#c3c8cf', seating: '#A8CE6B', biz: '#D284C7' }, special: [], blueprint: '0813' };
  })();

  window.BIMTC_CONFIG = CONFIG;
})();
