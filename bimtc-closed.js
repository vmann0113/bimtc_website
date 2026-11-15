/*
 * BIMTC 행사 종료 처리 (bimtc-closed.js)
 * ─────────────────────────────────────────────────────────────────────────
 * 행사가 끝난 뒤 "온라인 접수만" 닫고 감사 인사를 보여 주는 공통 스크립트.
 * 신청 폼이 있는 단독 페이지(walkin / program / buyer-apply / invite / rsvp …)에서
 * bimtc-config.js 다음에 한 줄 불러 쓰면 된다.
 *
 *   <script src="bimtc-config.js"></script>
 *   <script src="bimtc-closed.js"></script>
 *
 * 켜지는 조건 : bimtc-config.js 의 closed:true (또는 closedAt 경과)
 * 끄는 방법   : bimtc-config.js 의 closed 를 false 로 — 이 파일은 손댈 필요 없다.
 *
 * 페이지에서 쓰는 표시(속성)
 *   data-closed="block"  … 이 영역을 '접수 마감 + 감사 인사' 카드로 바꾼다 (신청 폼에 붙인다)
 *   data-closed="hide"   … 이 영역을 감춘다 (신청 버튼·안내 띠 등)
 *   data-closed="allow"  … 종료 뒤에도 그대로 둔다 (내역 조회 폼처럼 접수가 아닌 것)
 *
 * 아무 표시가 없어도 ① 맨 위 감사 띠 ② form 제출 차단 은 자동으로 적용된다.
 * (data-closed="allow" 가 붙은 form 과 그 안의 버튼은 차단하지 않는다)
 */
(function () {
  'use strict';

  var C = (typeof window !== 'undefined' && window.BIMTC_CONFIG) || null;

  // config 를 못 읽는 페이지라도 동작하도록 같은 값을 적어 둔다 (config 가 있으면 config 가 우선)
  var FALLBACK = {
    closed: true,
    thanks: {
      ko: '2026 BIMTC에 주신 많은 관심과 성원에 감사드립니다. 내년에 더 좋은 모습으로 뵙겠습니다!',
      en: 'Thank you for your interest and support for BIMTC 2026. We look forward to seeing you again next year!'
    },
    notice: {
      ko: '2026 행사가 종료되어 온라인 접수가 마감되었습니다.',
      en: 'BIMTC 2026 has concluded and online applications are now closed.'
    }
  };

  function isClosed() {
    if (C && typeof C.isClosed === 'function') return C.isClosed();
    if (C && typeof C.closed === 'boolean') return C.closed;
    return FALLBACK.closed;
  }
  if (!isClosed()) return;

  function lang() {
    try {
      var q = (location.search || '').match(/[?&]lang=(ko|en)/);
      if (q) return q[1];
      if (/^en/i.test(document.documentElement.lang || '')) return 'en';
      var ls = localStorage.getItem('bimtc_lang');
      if (ls === 'en' || ls === 'ko') return ls;
    } catch (e) {}
    return 'ko';
  }
  var LG = lang();
  var EN = LG === 'en';

  function thanksText() {
    if (C && typeof C.thanksText === 'function') { var t = C.thanksText(LG); if (t) return t; }
    return EN ? FALLBACK.thanks.en : FALLBACK.thanks.ko;
  }
  function noticeText() {
    if (C && typeof C.closedText === 'function') { var t = C.closedText(LG); if (t) return t; }
    return EN ? FALLBACK.notice.en : FALLBACK.notice.ko;
  }

  var STYLE = [
    '.bimtc-closed-bar{position:relative;z-index:9000;background:linear-gradient(90deg,#0B2E5B 0%,#16294F 48%,#0B5FA5 100%);',
      'color:#fff;padding:13px 18px;text-align:center;font-weight:700;line-height:1.5;',
      "font-family:'Pretendard','Noto Sans KR',-apple-system,BlinkMacSystemFont,sans-serif;font-size:15px;letter-spacing:-0.01em;}",
    '.bimtc-closed-bar b{display:inline-block;background:#fff;color:#0B5FA5;border-radius:999px;',
      'padding:3px 12px;margin-right:10px;font-size:12.5px;font-weight:800;letter-spacing:0.04em;vertical-align:1px;}',
    '@media(max-width:600px){.bimtc-closed-bar{font-size:13.5px;padding:11px 14px;}',
      '.bimtc-closed-bar b{display:block;margin:0 auto 7px;width:fit-content;}}',
    '.bimtc-closed-card{max-width:620px;margin:26px auto;padding:34px 28px;background:#fff;border:1px solid #E3EAF2;',
      'border-radius:18px;box-shadow:0 10px 30px rgba(11,47,91,.07);text-align:center;',
      "font-family:'Pretendard','Noto Sans KR',-apple-system,BlinkMacSystemFont,sans-serif;}",
    '.bimtc-closed-card .ttl{font-size:21px;font-weight:800;color:#16294F;margin:0 0 12px;letter-spacing:-0.02em;}',
    '.bimtc-closed-card .msg{font-size:15.5px;color:#44607F;line-height:1.72;margin:0 0 6px;}',
    '.bimtc-closed-card .thx{font-size:15.5px;color:#0B5FA5;font-weight:700;line-height:1.72;margin:14px 0 0;}',
    '.bimtc-closed-card .home{display:inline-block;margin-top:22px;padding:12px 26px;border-radius:999px;',
      'background:#0B5FA5;color:#fff;font-weight:800;font-size:14.5px;text-decoration:none;}',
    '.bimtc-closed-card .home:hover{background:#0A5490;}',
    '.bimtc-closed-off{opacity:.45;pointer-events:none;}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('bimtc-closed-style')) return;
    var s = document.createElement('style');
    s.id = 'bimtc-closed-style';
    s.textContent = STYLE;
    (document.head || document.documentElement).appendChild(s);
  }

  function bar() {
    var d = document.createElement('div');
    d.className = 'bimtc-closed-bar';
    d.setAttribute('role', 'status');
    var b = document.createElement('b');
    b.textContent = EN ? 'THANK YOU' : '행사 종료';
    d.appendChild(b);
    d.appendChild(document.createTextNode(thanksText()));
    return d;
  }

  function card() {
    var d = document.createElement('div');
    d.className = 'bimtc-closed-card';
    var h = document.createElement('p'); h.className = 'ttl';
    h.textContent = EN ? 'Applications are closed' : '온라인 접수가 마감되었습니다';
    var m = document.createElement('p'); m.className = 'msg'; m.textContent = noticeText();
    var t = document.createElement('p'); t.className = 'thx'; t.textContent = thanksText();
    var a = document.createElement('a'); a.className = 'home'; a.href = '/';
    a.textContent = EN ? 'Go to home' : '홈페이지로 가기';
    d.appendChild(h); d.appendChild(m); d.appendChild(t); d.appendChild(a);
    return d;
  }

  function allowed(el) {
    return !!(el && el.closest && el.closest('[data-closed="allow"]'));
  }

  // <body data-closed-mode="banner"> 인 페이지는 감사 띠만 넣고 아무것도 막지 않는다.
  // (비즈미팅처럼 '확정된 일정 조회'가 주 기능인 화면 — 신청은 서버에서 이미 막힌다)
  function bannerOnly() {
    try { return (document.body && document.body.getAttribute('data-closed-mode')) === 'banner'; }
    catch (e) { return false; }
  }

  function apply() {
    injectStyle();

    // ① 맨 위 감사 띠
    if (!document.querySelector('.bimtc-closed-bar') && document.body) {
      document.body.insertBefore(bar(), document.body.firstChild);
    }
    if (bannerOnly()) return;

    // ② 신청 영역 → 마감 카드 / 숨김
    Array.prototype.forEach.call(document.querySelectorAll('[data-closed="block"]'), function (el) {
      if (el.getAttribute('data-closed-done')) return;
      el.setAttribute('data-closed-done', '1');
      el.innerHTML = '';
      el.appendChild(card());
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-closed="hide"]'), function (el) {
      el.style.display = 'none';
    });

    // ③ 남아 있는 제출 버튼은 눌러도 아무 일이 없도록 흐리게 (조회용 'allow' 는 건드리지 않는다)
    Array.prototype.forEach.call(
      document.querySelectorAll('button[type="submit"],input[type="submit"]'), function (el) {
        if (allowed(el)) return;
        el.disabled = true;
        el.classList.add('bimtc-closed-off');
      });
  }

  // ④ 어떤 경로로든 폼이 제출되지 않게 막는다 (capture 단계라 페이지 자체 핸들러보다 먼저 걸린다)
  document.addEventListener('submit', function (e) {
    if (bannerOnly() || allowed(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    try { alert(noticeText() + '\n\n' + thanksText()); } catch (err) {}
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  } else {
    apply();
  }
  // 화면을 나중에 그리는 페이지(단계형 등)에서도 표시가 유지되도록 한 번 더
  setTimeout(apply, 400);
  setTimeout(apply, 1500);

  window.BIMTC_CLOSED = { on: true, lang: LG, thanks: thanksText(), notice: noticeText(), refresh: apply };
})();
