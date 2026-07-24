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
      visit: { open: false, comingLabel: '사전등록 오픈 예정' }
    },

    /* 2) 얼리버드 단계 — 상단 카운트다운 타이머가 가장 가까운 마감을 표시합니다.
       countdownEnabled:false 이면 기한 미정 → '오픈 예정' 티저를 표시합니다.
       ISO 날짜(현지시간). 지나면 자동으로 다음 단계로 넘어갑니다. */
    countdownEnabled: false,
    earlyBird: [
      { key: 'phase1', label: '1차 조기신청', end: '2026-06-30T23:59:59', discountRate: 0.20 },
      { key: 'phase2', label: '2차 조기신청', end: '2026-08-04T23:59:59', discountRate: 0.10 }
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

  // 현재 유효한 얼리버드 단계 계산
  CONFIG.currentEarlyBird = function () {
    var now = Date.now();
    for (var i = 0; i < CONFIG.earlyBird.length; i++) {
      if (now <= new Date(CONFIG.earlyBird[i].end).getTime()) return CONFIG.earlyBird[i];
    }
    return null; // 얼리버드 종료
  };

  // 배치도를 평면 셀 배열로 전개 (신청 화면이 사용)
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

  window.BIMTC_CONFIG = CONFIG;
})();
