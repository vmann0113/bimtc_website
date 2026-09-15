/*
 * BIMTC 부스 참가 인보이스 (bimtc-invoice.js)
 * - 관리자(admin.html)와 신청자(booth.html)가 같은 인보이스를 발행하도록 한 곳에 모았다.
 * - 번호는 신청 건 ID 로 만든다. 예전에는 신청자 화면이 날짜+난수로 번호를 만들어
 *   DB 에 저장되지 않았고 관리자 화면 번호와도 달라, 입금 문의 시 대조할 수 없었다.
 * - 금액은 DB 에 저장된 값(서버 재계산 결과)을 그대로 쓴다. 화면에서 다시 계산하지 않으므로
 *   얼리버드 마감 뒤에 다시 받아도 신청 당시 금액이 유지된다.
 * window.BimtcInvoice 로 전역 노출.
 */
(function () {
  function number(id) {
    return 'BIMTC-' + String(id || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
  }

  // cfg, now 는 테스트용 주입 인자. 생략하면 BIMTC_CONFIG 와 현재 시각을 쓴다.
  function html(b, cfg, now) {
    // 신청자가 입력한 값이 그대로 HTML로 들어가면 인보이스 창에서 스크립트가 실행된다.
    // 이 창은 window.open('','_blank')이라 여는 페이지와 같은 오리진 → 세션까지 노출됨. 반드시 이스케이프.
    const esc=(v)=>String(v==null?'':v).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
    const won=(v)=>esc(((v||0).toLocaleString())+'원');
    const CFG=cfg||window.BIMTC_CONFIG||{};
    const unit=(CFG.boothLayout&&CFG.boothLayout.unitPrice&&CFG.boothLayout.unitPrice[b.booth_type])||0;
    const n=(b.booth_ids||[]).length; const boothCost=unit*n;
    const disc=b.discount||0;
    const addonTotal=Math.max(0,(b.subtotal||0)-boothCost+disc);
    const ad=b.addons||{}; const adNames=Object.keys(ad).filter(k=>ad[k]).map(k=>k+(ad[k]===true?'':' ×'+ad[k])).join(', ');
    const no=number(b.id);
    const d=now||new Date(); const today=d.getFullYear()+'. '+(d.getMonth()+1)+'. '+d.getDate();
    const ap=b.applicant||{};
    const row=(k,v)=>'<tr><td style="padding:6px 10px;color:#5E7289;border-bottom:1px solid #eef2f7;width:120px;">'+esc(k)+'</td><td style="padding:6px 10px;border-bottom:1px solid #eef2f7;font-weight:600;">'+esc(v||'-')+'</td></tr>';
    const item=(name,qty,amt)=>'<tr><td style="padding:9px 10px;border-bottom:1px solid #e6ebf2;">'+esc(name)+'</td><td style="padding:9px 10px;text-align:center;border-bottom:1px solid #e6ebf2;">'+esc(qty)+'</td><td style="padding:9px 10px;text-align:right;border-bottom:1px solid #e6ebf2;">'+esc(amt)+'</td></tr>';
    let items=item(b.booth_type==='space'?'독립부스 (Space Only)':'조립부스 (Package Booth)', n+'개', won(boothCost));
    if(adNames) items+=item('부가서비스: '+adNames,'-',won(addonTotal));
    if(b.fam_tour) items+=item('팸투어 참가','-','-');
    if(disc){ let dl='할인'; const parts=[]; if(b.early_bird) parts.push(b.early_bird==='phase1'?'1차 얼리버드':'2차 얼리버드'); if(b.returning_company) parts.push('재참가'); if(parts.length) dl+=' ('+parts.join(' + ')+')'; items+=item(dl,'-','− '+won(disc)); }
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>INVOICE '+no+'</title></head><body style="font-family:Pretendard,-apple-system,sans-serif;color:#0F2440;max-width:720px;margin:0 auto;padding:36px 28px;">'
      +'<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0B5FA5;padding-bottom:14px;">'
      +'<div><div style="font-size:26px;font-weight:800;">INVOICE · 인보이스</div><div style="font-size:13px;color:#5E7289;margin-top:4px;">2026 부산국제의료관광컨벤션 (BIMTC) 부스 참가</div></div>'
      +'<div style="text-align:right;font-size:13px;color:#5E7289;">No. '+no+'<br>발행일 '+today+'</div></div>'
      +'<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:18px;">'
      +row('기업명',b.company)+row('대표자',ap.ceo)+row('사업자번호',ap.bizno)+row('주소',ap.addr)+row('담당자',(b.contact||'')+(b.phone?' · '+b.phone:''))+row('이메일',b.email)+row('부스 위치',(b.booth_ids||[]).join(', '))
      +'</table>'
      +'<table style="width:100%;border-collapse:collapse;font-size:13.5px;margin-top:22px;"><thead><tr style="background:#F0F5FA;"><th style="padding:9px 10px;text-align:left;">항목</th><th style="padding:9px 10px;text-align:center;width:80px;">수량</th><th style="padding:9px 10px;text-align:right;width:150px;">금액</th></tr></thead><tbody>'+items+'</tbody></table>'
      +'<div style="margin-left:auto;width:280px;font-size:14px;margin-top:14px;">'
      +'<div style="display:flex;justify-content:space-between;padding:5px 0;color:#5E7289;"><span>공급가액</span><span style="font-weight:700;color:#0F2440;">'+won(b.subtotal)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:5px 0;color:#5E7289;border-bottom:1px solid #e6ebf2;"><span>부가세 (10%)</span><span style="font-weight:700;color:#0F2440;">'+won(b.vat)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:9px 0;font-size:16px;font-weight:800;"><span>합계 (최종 입금액)</span><span style="color:#0B5FA5;">'+won(b.total)+'</span></div></div>'
      +'<div style="margin-top:26px;background:#F0F5FA;border-radius:10px;padding:14px 16px;font-size:13.5px;"><b>입금 계좌</b> · 부산은행 101-2008-3507-06 (예금주: (사)부산권의료산업협의회 손영신)</div>'
      +'<div style="margin-top:18px;font-size:12px;color:#8295ab;line-height:1.7;">(사)부산권의료산업협의회 · 부산광역시 동구 중앙대로 365, 3층 · T. 051-461-4276~8 · F. 051-442-6006 · bmia0528@naver.com</div>'
      +'</body></html>';
  }

  // 새 창에 인보이스를 열고 인쇄 대화상자를 띄운다. 팝업이 차단되면 false.
  function open(b) {
    var w = window.open('', '_blank');
    if (!w) return false;
    w.document.write(html(b)); w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) {} }, 400);
    return true;
  }

  window.BimtcInvoice = { number: number, html: html, open: open };
})();
