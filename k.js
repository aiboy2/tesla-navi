// 카카오맵/네이버지도 웹사이트 위치 진단 (2026-11-17)
// 사용법: 테슬라 브라우저에서 map.kakao.com 또는 map.naver.com을 연 상태로 주소창에
//   javascript:import('//aiboy2.github.io/tesla-navi/k.js')
// 를 입력. 결과 패널을 사진으로 찍어 보내면 됨.
// 이 스크립트는 화면에 표시만 하고 어디로도 전송하지 않는다 (위치는 이 브라우저 안에서만 표시).
(function () {
  const V = 'k-2026-11-17.1';
  const old = document.getElementById('__tnDiag'); if (old) old.remove();
  const box = document.createElement('div'); box.id = '__tnDiag';
  box.style.cssText = 'position:fixed;left:10px;top:10px;z-index:2147483647;background:rgba(0,0,0,.92);color:#fff;' +
    'font:20px/1.45 sans-serif;padding:16px 18px;border-radius:14px;max-width:min(900px,calc(100% - 20px));max-height:calc(100% - 20px);overflow:auto;white-space:pre-wrap;word-break:break-all';
  const close = document.createElement('button'); close.textContent = '닫기';
  close.style.cssText = 'float:right;font:20px sans-serif;padding:8px 18px;margin-left:12px;border-radius:10px;border:0';
  close.onclick = () => box.remove();
  const out = document.createElement('div'); box.append(close, out); document.body.appendChild(box);
  const lines = {}; const order = [];
  const set = (k, v) => { if (!(k in lines)) order.push(k); lines[k] = v; out.textContent = order.map(x => x + ': ' + lines[x]).join('\n'); };
  const short = s => String(s).length > 160 ? String(s).slice(0, 160) + '…' : String(s);

  set('진단', V + ' @ ' + location.host + location.pathname);
  set('UA', short(navigator.userAgent));
  set('터치', 'maxTouchPoints ' + (navigator.maxTouchPoints || 0) + ' · ontouchstart ' + ('ontouchstart' in window) + ' · 화면 ' + innerWidth + 'x' + innerHeight);
  set('geolocation', 'geolocation' in navigator ? '있음' : '없음');

  // 사이트가 위치를 요청하는지 감시 (이후 사이트 버튼을 눌렀을 때 숫자가 늘면 사이트가 요청한 것)
  let siteCalls = 0;
  if (navigator.geolocation && !navigator.geolocation.__tnWrapped) {
    const g = navigator.geolocation;
    for (const m of ['getCurrentPosition', 'watchPosition']) {
      const orig = g[m].bind(g);
      g[m] = function () { siteCalls++; set('사이트 위치 요청', siteCalls + '회 (' + m + ')'); return orig.apply(null, arguments); };
    }
    g.__tnWrapped = true;
  }
  set('사이트 위치 요청', '0회 (이 패널을 띄운 뒤 사이트의 위치 버튼을 누르면 늘어나야 함)');

  // 위치 관련 화면 요소 찾기 (숨겨져 있는지 포함)
  try {
    const sel = '[class*="location" i],[id*="location" i],[class*="gps" i],[class*="myloc" i],[class*="current" i][class*="pos" i],' +
                '[title*="위치"],[aria-label*="위치"],[class*="geo" i]';
    const els = [...document.querySelectorAll(sel)].filter(e => e !== box && !box.contains(e));
    const desc = els.slice(0, 8).map(e => {
      const cs = getComputedStyle(e), r = e.getBoundingClientRect();
      const vis = cs.display === 'none' ? '숨김(display)' : cs.visibility === 'hidden' ? '숨김(visibility)' : (r.width && r.height ? '보임' : '크기0');
      return e.tagName.toLowerCase() + '.' + short(String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).replace(/\s+/g, '.')).slice(0, 60) +
             (e.getAttribute('title') || e.getAttribute('aria-label') ? ' "' + (e.getAttribute('title') || e.getAttribute('aria-label')) + '"' : '') + ' ' + vis;
    });
    const textBtns = [...document.querySelectorAll('button,a,[role=button]')].filter(e => /현\s?위치|내\s?위치/.test(e.textContent || '')).length;
    set('위치 관련 요소', els.length + '개' + (desc.length ? '\n  ' + desc.join('\n  ') : '') + '\n  "현위치/내 위치" 글자 버튼 ' + textBtns + '개');
  } catch (e) { set('위치 관련 요소', '오류 ' + e.message); }

  // 지도 객체 단서
  try {
    const keys = Object.keys(window).filter(k => /map|kakao|naver|daum/i.test(k)).slice(0, 15);
    set('전역 단서', keys.join(', ') || '없음');
    set('카카오 SDK', window.kakao && window.kakao.maps ? '있음' : '없음');
    set('네이버 SDK', window.naver && window.naver.maps ? '있음' : '없음');
  } catch (e) { set('전역 단서', '오류 ' + e.message); }

  // 권한 상태 + 이 사이트에서 직접 위치 요청 (권한 팝업이 뜨면 허용)
  if (navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then(p => set('권한', p.state), () => set('권한', '조회 실패'));
  if (navigator.geolocation) {
    set('직접 요청', '요청 중… (권한 팝업이 뜨면 허용)');
    const t0 = Date.now();
    navigator.geolocation.getCurrentPosition.call(navigator.geolocation, // 감시 카운트에 포함되지 않도록 아래에서 보정
      p => set('직접 요청', '성공 ±' + Math.round(p.coords.accuracy) + 'm · ' + (Date.now() - t0) + 'ms'),
      e => set('직접 요청', '실패 code ' + e.code + ' ' + e.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    siteCalls = 0; set('사이트 위치 요청', '0회 (이 패널을 띄운 뒤 사이트의 위치 버튼을 누르면 늘어나야 함)');
  }
})();
