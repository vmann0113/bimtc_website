/*
 * BIMTC 부스 참가 인보이스 (bimtc-invoice.js)
 * - 관리자(admin.html)와 신청자(booth.html)가 같은 문서를 발행하도록 한 곳에 모았다.
 * - 번호는 신청 건 ID 로 만든다. 예전에는 신청자 화면이 날짜+난수로 번호를 만들어
 *   DB 에 저장되지 않았고 관리자 화면 번호와도 달라, 입금 문의 시 대조할 수 없었다.
 * - 금액은 DB 에 저장된 값(서버 재계산 결과)을 그대로 쓴다. 화면에서 다시 계산하지 않으므로
 *   얼리버드 마감 뒤에 다시 받아도 신청 당시 금액이 유지된다.
 *
 * 발행하는 문서 세 가지
 *   open(b)            전체 인보이스 — 부스비 + 부가서비스 + 비품 + 할인
 *   openRental(b)      비품 렌탈 견적서 — 비품만, 참가기업이 받는 문서
 *   openRentalOrder(l) 비품 렌탈 발주 집계 — 사무국이 렌탈업체에 넘기는 문서
 * window.BimtcInvoice 로 전역 노출.
 */
(function () {
  var ORG = '(사)부산권의료산업협의회 · 부산광역시 동구 중앙대로 365, 3층 · T. 051-461-4276~8 · F. 051-442-6006 · bmia0528@naver.com';
  var EVENT = '2026 부산국제의료관광컨벤션 (BIMTC) · 2026. 11. 13(금)~14(토) · BEXCO 제1전시장 3A홀';

  function number(id) {
    return 'BIMTC-' + String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
  }

  // 신청자가 입력한 값이 그대로 HTML로 들어가면 문서 창에서 스크립트가 실행된다.
  // 이 창은 window.open('','_blank')이라 여는 페이지와 같은 오리진 → 세션까지 노출됨. 반드시 이스케이프.
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function won(v) { return esc(((v || 0).toLocaleString()) + '원'); }
  function today(now) {
    var d = now || new Date();
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate();
  }
  function rmapOf(rmap) {
    return rmap || (typeof window !== 'undefined' && window.BIMTC_RENTALS) || null;
  }

  // 신청 한 건의 비품을 품목별로 펼친다.
  // 단가표가 바뀌었을 수 있으므로 계산 합계(calc)와 신청 당시 저장액(stored)을 함께 돌려주고,
  // 둘이 다르면 문서에서 저장액을 합계로 쓰고 안내 문구를 붙인다.
  function rentalLines(b, rmap) {
    var map = rmapOf(rmap);
    var sel = (b && b.rentals) || {};
    var lines = Object.keys(sel).filter(function (k) { return Number(sel[k]) > 0; })
      .map(function (k) {
        var it = (map && map[k]) || null;
        var qty = Number(sel[k]) || 0;
        var unit = Number((it && it.p) || 0);
        return { key: k, cat: (it && it.c) || '', name: (it && it.n) || k, spec: (it && it.s) || '',
                 qty: qty, unit: unit, amt: unit * qty, known: !!it };
      });
    lines.sort(function (a, b2) {
      return String(a.cat).localeCompare(String(b2.cat), 'ko') || String(a.name).localeCompare(String(b2.name), 'ko');
    });
    var calc = lines.reduce(function (s, l) { return s + l.amt; }, 0);
    var stored = Number((b && b.rental_total) || 0);
    var priced = lines.length > 0 && lines.every(function (l) { return l.known && l.unit > 0; });
    return { lines: lines, calc: calc, stored: stored, priced: priced, matches: priced && calc === stored };
  }

  function docHead(title) {
    // color-scheme 을 고정하지 않으면 다크모드 브라우저에서 흰 배경에 흰 글씨가 된다
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><title>' + esc(title) + '</title>'
      + '<style>:root{color-scheme:light;} @media print{body{margin:0;}} table{page-break-inside:auto;} tr{page-break-inside:avoid;}</style>'
      + '</head><body style="font-family:Pretendard,-apple-system,sans-serif;color:#0F2440;background:#fff;';
  }
  function docTop(big, small, right) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0B5FA5;padding-bottom:14px;">'
      + '<div><div style="font-size:26px;font-weight:800;">' + esc(big) + '</div>'
      + '<div style="font-size:13px;color:#5E7289;margin-top:4px;">' + esc(small) + '</div></div>'
      + '<div style="text-align:right;font-size:13px;color:#5E7289;">' + right + '</div></div>';
  }
  function foot(extra) {
    return (extra || '')
      + '<div style="margin-top:18px;font-size:12px;color:#8295ab;line-height:1.7;">' + esc(ORG) + '</div>';
  }

  // ── ① 전체 인보이스 ────────────────────────────────────────────────
  // cfg, now 는 테스트용 주입 인자. 생략하면 BIMTC_CONFIG 와 현재 시각을 쓴다.
  function html(b, cfg, now) {
    var CFG = cfg || (typeof window !== 'undefined' && window.BIMTC_CONFIG) || {};
    var unit = (CFG.boothLayout && CFG.boothLayout.unitPrice && CFG.boothLayout.unitPrice[b.booth_type]) || 0;
    var n = (b.booth_ids || []).length; var boothCost = unit * n;
    var disc = b.discount || 0;
    var r = rentalLines(b);
    var rentalTotal = r.stored;
    var addonTotal = Math.max(0, (b.subtotal || 0) - boothCost + disc - rentalTotal);
    var ad = b.addons || {};
    var adNames = Object.keys(ad).filter(function (k) { return ad[k]; })
      .map(function (k) { return k + (ad[k] === true ? '' : ' ×' + ad[k]); }).join(', ');
    var no = number(b.id);
    var ap = b.applicant || {};
    var row = function (k, v) {
      return '<tr><td style="padding:6px 10px;color:#5E7289;border-bottom:1px solid #eef2f7;width:120px;">' + esc(k)
        + '</td><td style="padding:6px 10px;border-bottom:1px solid #eef2f7;font-weight:600;">' + esc(v || '-') + '</td></tr>';
    };
    var item = function (name, qty, amt, sub) {
      return '<tr><td style="padding:9px 10px;border-bottom:1px solid #e6ebf2;">' + esc(name)
        + (sub ? '<div style="font-size:11.5px;color:#8295ab;margin-top:2px;">' + esc(sub) + '</div>' : '')
        + '</td><td style="padding:9px 10px;text-align:center;border-bottom:1px solid #e6ebf2;">' + esc(qty)
        + '</td><td style="padding:9px 10px;text-align:right;border-bottom:1px solid #e6ebf2;">' + amt + '</td></tr>';
    };
    var items = item(b.booth_type === 'space' ? '독립부스 (Space Only)' : '조립부스 (Package Booth)', n + '개', won(boothCost));
    if (adNames) items += item('부가서비스: ' + adNames, '-', won(addonTotal));
    if (rentalTotal > 0) {
      if (r.matches) {
        // 단가표로 계산한 합계가 신청 당시 금액과 같을 때만 품목별로 펼친다.
        // 예전에는 '비품 렌탈 N종' 한 줄이라 품목별 단가를 대조할 수 없었다.
        items += r.lines.map(function (l) {
          return item('비품 · ' + l.name + (l.spec ? ' (' + l.spec + ')' : ''), l.qty + '개',
            won(l.amt), '단가 ' + (l.unit).toLocaleString() + '원');
        }).join('');
      } else {
        // 단가표가 바뀌었거나 품목이 사라진 경우 — 합계만 적는다 (저장된 금액이 기준)
        var rnames = r.lines.map(function (l) { return l.name + ' x' + l.qty; });
        items += item('비품 렌탈 ' + r.lines.length + '종: ' + rnames.join(', '), '-', won(rentalTotal));
      }
    }
    if (b.fam_tour) items += item('팸투어 참가', '-', '-');
    if (disc) {
      var dl = '할인'; var parts = [];
      if (b.early_bird) parts.push(b.early_bird === 'phase1' ? '1차 얼리버드' : '2차 얼리버드');
      if (b.returning_company) parts.push('재참가');
      if (parts.length) dl += ' (' + parts.join(' + ') + ')';
      items += item(dl, '-', '− ' + won(disc));
    }
    return docHead('INVOICE ' + no) + 'max-width:720px;margin:0 auto;padding:36px 28px;">'
      + docTop('INVOICE · 인보이스', '2026 부산국제의료관광컨벤션 (BIMTC) 부스 참가',
          'No. ' + esc(no) + '<br>발행일 ' + esc(today(now)))
      + '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:18px;">'
      + row('기업명', b.company) + row('대표자', ap.ceo) + row('사업자번호', ap.bizno) + row('주소', ap.addr)
      + row('담당자', (b.contact || '') + (b.phone ? ' · ' + b.phone : '')) + row('이메일', b.email)
      + row('부스 위치', (b.booth_ids || []).join(', '))
      + '</table>'
      + '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:22px;"><thead><tr style="background:#F0F5FA;">'
      + '<th style="padding:9px 10px;text-align:left;">항목</th><th style="padding:9px 10px;text-align:center;width:80px;">수량</th>'
      + '<th style="padding:9px 10px;text-align:right;width:150px;">금액</th></tr></thead><tbody>' + items + '</tbody></table>'
      + '<div style="margin-left:auto;width:280px;font-size:14px;margin-top:14px;">'
      + '<div style="display:flex;justify-content:space-between;padding:5px 0;color:#5E7289;"><span>공급가액</span><span style="font-weight:700;color:#0F2440;">' + won(b.subtotal) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;padding:5px 0;color:#5E7289;border-bottom:1px solid #e6ebf2;"><span>부가세 (10%)</span><span style="font-weight:700;color:#0F2440;">' + won(b.vat) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;padding:9px 0;font-size:16px;font-weight:800;"><span>합계 (최종 입금액)</span><span style="color:#0B5FA5;">' + won(b.total) + '</span></div></div>'
      + foot('<div style="margin-top:26px;background:#F0F5FA;border-radius:10px;padding:14px 16px;font-size:13.5px;"><b>입금 계좌</b> · 부산은행 101-2008-3507-06 (예금주: (사)부산권의료산업협의회 손영신)</div>')
      + '</body></html>';
  }

  // ── ② 비품 렌탈 견적서 (참가기업용) ────────────────────────────────
  // 전체 인보이스와 별개로 비품만 뽑는다. 참가기업이 내부 품의·예산에 쓰는 문서라
  // 품목별 단가·수량·금액을 한 줄씩 전부 적는다. 입금은 전체 인보이스로 하므로 계좌는 싣지 않는다.
  function rentalHtml(b, rmap, now) {
    var r = rentalLines(b, rmap);
    var no = number(b.id) + '-R';
    var ap = b.applicant || {};
    var supply = r.stored;                       // 합계는 언제나 신청 당시 저장액이 기준
    var vat = Math.round(supply * 0.1);
    var th = function (t, w, align) {
      return '<th style="padding:9px 10px;text-align:' + (align || 'left') + ';' + (w ? 'width:' + w + ';' : '') + '">' + esc(t) + '</th>';
    };
    var td = function (t, align, style) {
      return '<td style="padding:9px 10px;border-bottom:1px solid #e6ebf2;text-align:' + (align || 'left') + ';' + (style || '') + '">' + t + '</td>';
    };
    var body = r.lines.length
      ? r.lines.map(function (l, i) {
          return '<tr>' + td(String(i + 1), 'center', 'color:#8295ab;')
            + td(esc(l.name) + (l.spec ? '<div style="font-size:11.5px;color:#8295ab;margin-top:2px;">' + esc(l.spec) + '</div>' : '')
                 + (l.cat ? '<div style="font-size:11px;color:#9aa9bd;margin-top:2px;">' + esc(l.cat) + '</div>' : ''))
            + td(l.known ? won(l.unit) : '<span style="color:#b78a3c;">단가 확인 필요</span>', 'right')
            + td(esc(l.qty) + '개', 'center')
            + td(l.known ? won(l.amt) : '-', 'right', 'font-weight:700;')
            + '</tr>';
        }).join('')
      : '<tr>' + td('<span style="color:#8295ab;">신청한 비품이 없습니다.</span>', 'center') + '<td colspan="4"></td></tr>';
    var note = r.matches || !r.lines.length ? ''
      : '<div style="margin-top:14px;background:#FBF6E9;border:1px solid #ecd9b0;border-radius:10px;padding:12px 15px;font-size:12.5px;color:#8a6d33;line-height:1.7;">'
        + '※ 품목별 금액의 단순 합(' + won(r.calc) + ')이 신청 당시 금액과 다릅니다. 신청 뒤 단가표가 바뀌었거나 목록에서 빠진 품목이 있는 경우입니다. '
        + '<b>합계는 신청 당시 금액(' + won(r.stored) + ')이 기준</b>이며, 확인이 필요하면 사무국으로 문의해 주세요.</div>';
    return docHead('비품 렌탈 견적서 ' + no) + 'max-width:760px;margin:0 auto;padding:36px 28px;">'
      + docTop('QUOTATION · 비품 렌탈 견적서', '2026 부산국제의료관광컨벤션 (BIMTC) 참가 부스 비품',
          'No. ' + esc(no) + '<br>발행일 ' + esc(today(now)))
      + '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:18px;">'
      + '<tr><td style="padding:6px 10px;color:#5E7289;border-bottom:1px solid #eef2f7;width:120px;">기업명</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eef2f7;font-weight:600;">' + esc(b.company || '-') + '</td></tr>'
      + '<tr><td style="padding:6px 10px;color:#5E7289;border-bottom:1px solid #eef2f7;">사업자번호</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eef2f7;font-weight:600;">' + esc(ap.bizno || '-') + '</td></tr>'
      + '<tr><td style="padding:6px 10px;color:#5E7289;border-bottom:1px solid #eef2f7;">담당자</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eef2f7;font-weight:600;">' + esc((b.contact || '') + (b.phone ? ' · ' + b.phone : '') || '-') + '</td></tr>'
      + '<tr><td style="padding:6px 10px;color:#5E7289;border-bottom:1px solid #eef2f7;">부스 위치</td>'
      + '<td style="padding:6px 10px;border-bottom:1px solid #eef2f7;font-weight:600;">' + esc((b.booth_ids || []).join(', ') || '-') + '</td></tr>'
      + '</table>'
      + '<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:22px;"><thead><tr style="background:#F0F5FA;">'
      + th('No.', '42px', 'center') + th('품목 · 규격') + th('단가', '110px', 'right') + th('수량', '70px', 'center') + th('금액', '120px', 'right')
      + '</tr></thead><tbody>' + body + '</tbody></table>'
      + '<div style="margin-left:auto;width:300px;font-size:14px;margin-top:14px;">'
      + '<div style="display:flex;justify-content:space-between;padding:5px 0;color:#5E7289;"><span>비품 공급가액</span><span style="font-weight:700;color:#0F2440;">' + won(supply) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;padding:5px 0;color:#5E7289;border-bottom:1px solid #e6ebf2;"><span>부가세 (10%)</span><span style="font-weight:700;color:#0F2440;">' + won(vat) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;padding:9px 0;font-size:16px;font-weight:800;"><span>비품 합계</span><span style="color:#0B5FA5;">' + won(supply + vat) + '</span></div></div>'
      + note
      + '<div style="margin-top:22px;background:#F0F5FA;border-radius:10px;padding:14px 16px;font-size:13px;line-height:1.8;">'
      + '<b>안내</b><br>'
      + '· 이 견적서는 <b>비품 렌탈 금액만</b> 담고 있습니다. 부스비·부가서비스를 포함한 전체 금액은 인보이스 <b>No. ' + esc(number(b.id)) + '</b> 를 확인해 주세요.<br>'
      + '· 입금은 비품만 따로 하지 마시고 <b>전체 인보이스 합계로 한 번에</b> 해 주세요.<br>'
      + '· 비품 추가·변경은 입금 확인 전까지 신청 화면에서 직접 수정하실 수 있습니다.</div>'
      + foot('<div style="margin-top:14px;font-size:12px;color:#8295ab;">' + esc(EVENT) + '</div>')
      + '</body></html>';
  }

  // ── ③ 비품 렌탈 발주 집계 (사무국 → 렌탈업체) ──────────────────────
  // 품목별 총수량과, 부스별로 어디에 몇 개를 넣어야 하는지를 한 장에 담는다.
  function rentalOrderHtml(list, rmap, now) {
    var map = rmapOf(rmap) || {};
    var apps = (list || []).filter(function (b) { return b && b.status !== 'rejected' && b.status !== 'cancelled'; })
      .map(function (b) { return { b: b, r: rentalLines(b, map) }; })
      .filter(function (x) { return x.r.lines.length > 0; });
    var agg = {};
    apps.forEach(function (x) {
      x.r.lines.forEach(function (l) {
        if (!agg[l.key]) agg[l.key] = { cat: l.cat, name: l.name, spec: l.spec, unit: l.unit, known: l.known, qty: 0, who: [] };
        agg[l.key].qty += l.qty;
        agg[l.key].who.push((x.b.company || '') + ((x.b.booth_ids || []).length ? ' (' + (x.b.booth_ids || []).join(',') + ')' : '') + ' ×' + l.qty);
      });
    });
    var keys = Object.keys(agg).sort(function (a, b2) {
      return String(agg[a].cat).localeCompare(String(agg[b2].cat), 'ko') || String(agg[a].name).localeCompare(String(agg[b2].name), 'ko');
    });
    var qSum = 0, mSum = 0;
    keys.forEach(function (k) { qSum += agg[k].qty; mSum += agg[k].unit * agg[k].qty; });
    var storedSum = apps.reduce(function (s, x) { return s + x.r.stored; }, 0);

    var th = function (t, w, align) {
      return '<th style="padding:8px 9px;text-align:' + (align || 'left') + ';' + (w ? 'width:' + w + ';' : '') + '">' + esc(t) + '</th>';
    };
    var td = function (t, align, style) {
      return '<td style="padding:8px 9px;border-bottom:1px solid #e6ebf2;text-align:' + (align || 'left') + ';' + (style || '') + '">' + t + '</td>';
    };
    var sumTable = keys.length
      ? keys.map(function (k, i) {
          var a = agg[k];
          return '<tr>' + td(String(i + 1), 'center', 'color:#8295ab;')
            + td(esc(a.cat || '-'), 'left', 'color:#5E7289;font-size:12px;')
            + td('<b>' + esc(a.name) + '</b>' + (a.spec ? '<div style="font-size:11.5px;color:#8295ab;margin-top:2px;">' + esc(a.spec) + '</div>' : ''))
            + td(a.known ? won(a.unit) : '-', 'right')
            + td('<b>' + esc(a.qty) + '</b>', 'center')
            + td(a.known ? won(a.unit * a.qty) : '-', 'right')
            + td('<span style="font-size:11.5px;color:#5E7289;">' + esc(a.who.join(' / ')) + '</span>')
            + '</tr>';
        }).join('')
      : '<tr>' + td('<span style="color:#8295ab;">신청된 비품이 없습니다.</span>', 'center') + '<td colspan="6"></td></tr>';

    var byBooth = apps.slice().sort(function (x, y) {
      return String((x.b.booth_ids || [])[0] || '').localeCompare(String((y.b.booth_ids || [])[0] || ''));
    }).map(function (x) {
      return '<tr>' + td('<b>' + esc((x.b.booth_ids || []).join(', ') || '-') + '</b>', 'left', 'white-space:nowrap;')
        + td(esc(x.b.company || '-'))
        + td('<span style="font-size:12px;">' + esc(x.r.lines.map(function (l) { return l.name + ' ×' + l.qty; }).join(', ')) + '</span>')
        + td(won(x.r.stored), 'right')
        + '</tr>';
    }).join('');

    var warn = (keys.length && mSum !== storedSum)
      ? '<div style="margin-top:12px;background:#FBF6E9;border:1px solid #ecd9b0;border-radius:10px;padding:11px 14px;font-size:12.5px;color:#8a6d33;line-height:1.7;">'
        + '※ 현재 단가표로 계산한 금액(' + won(mSum) + ')과 신청 당시 저장 금액의 합(' + won(storedSum) + ')이 다릅니다. 단가표가 바뀐 뒤 신청된 건이 있으니 발주 전 확인해 주세요.</div>'
      : '';

    return docHead('비품 렌탈 발주 집계') + 'max-width:1000px;margin:0 auto;padding:32px 26px;">'
      + docTop('비품 렌탈 발주 집계', esc(EVENT),
          '발행일 ' + esc(today(now)) + '<br>참가기업 ' + apps.length + '개사 · ' + keys.length + '종 · ' + qSum + '점')
      + '<div style="font-size:15px;font-weight:800;margin:22px 0 8px;">① 품목별 발주 수량</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#F0F5FA;">'
      + th('No.', '38px', 'center') + th('분류', '110px') + th('품목 · 규격') + th('단가', '96px', 'right')
      + th('수량', '58px', 'center') + th('금액', '108px', 'right') + th('신청업체 (부스)')
      + '</tr></thead><tbody>' + sumTable + '</tbody>'
      + (keys.length ? '<tfoot><tr style="background:#F0F5FA;font-weight:800;">'
          + '<td colspan="4" style="padding:9px;text-align:right;">합계</td>'
          + '<td style="padding:9px;text-align:center;">' + esc(qSum) + '</td>'
          + '<td style="padding:9px;text-align:right;color:#0B5FA5;">' + won(mSum) + '</td><td></td></tr></tfoot>' : '')
      + '</table>' + warn
      + (apps.length ? '<div style="font-size:15px;font-weight:800;margin:26px 0 8px;">② 부스별 반입 목록</div>'
          + '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#F0F5FA;">'
          + th('부스', '110px') + th('기업명', '210px') + th('품목') + th('금액(공급가)', '110px', 'right')
          + '</tr></thead><tbody>' + byBooth + '</tbody></table>' : '')
      + '<div style="margin-top:22px;background:#F0F5FA;border-radius:10px;padding:13px 16px;font-size:12.5px;line-height:1.8;">'
      + '금액은 부가세 별도입니다. 발주 수량·반입 위치는 개막 전 사무국과 최종 확인해 주세요.</div>'
      + foot('')
      + '</body></html>';
  }

  // ── 인쇄 창 ────────────────────────────────────────────────────────
  // 새 창에 문서를 열고 인쇄 대화상자를 띄운다. 팝업이 차단되면 false.
  // 품목명·단가를 쓰려면 단가표가 필요하다. 아직 없으면 여기서 직접 받아온다
  // (어느 화면에서 열든 품목이 항상 보이도록).
  function popup(build, needPricing) {
    var w = window.open('', '_blank');   // 팝업 차단을 피하려면 클릭 직후 바로 열어야 한다
    if (!w) return false;
    function write() {
      try { w.document.open(); } catch (e) {}
      w.document.write(build()); w.document.close();
      setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    }
    if (needPricing && !window.BIMTC_RENTALS && window.BimtcDB && window.BimtcDB.getPricing) {
      try {
        w.document.write('<!doctype html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;padding:28px;color:#5E7289;">문서를 준비하고 있습니다…</body></html>');
      } catch (e) {}
      window.BimtcDB.getPricing().then(function (pr) {
        if (pr && pr.rentals) window.BIMTC_RENTALS = pr.rentals;
      })['catch'](function () {}).then(function () { write(); });
      return true;
    }
    write();
    return true;
  }

  function hasRental(b) {
    var sel = (b && b.rentals) || {};
    return Object.keys(sel).some(function (k) { return Number(sel[k]) > 0; });
  }

  function open(b) { return popup(function () { return html(b); }, hasRental(b)); }
  function openRental(b) { return popup(function () { return rentalHtml(b); }, true); }
  function openRentalOrder(list) { return popup(function () { return rentalOrderHtml(list); }, true); }

  window.BimtcInvoice = {
    number: number, html: html, open: open,
    rentalLines: rentalLines, hasRental: hasRental,
    rentalHtml: rentalHtml, openRental: openRental,
    rentalOrderHtml: rentalOrderHtml, openRentalOrder: openRentalOrder
  };
})();
