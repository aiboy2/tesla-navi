// 카카오맵 웹사이트(map.kakao.com)에 테슬라 GPS 내 위치를 붙이는 스크립트 (시험판)
// 사용법: 테슬라 브라우저에서 map.kakao.com을 연 상태로 주소창에
//   javascript:import('//aiboy2.github.io/tesla-navi/k.js')
//
// 배경 (2026-11-17 실차 진단 k-…17.1): 사이트의 "현위치" 버튼은 있지만 눌러도 브라우저 위치 요청이 0회.
// 브라우저 위치는 ±4m로 정상. 사이트는 공개 카카오 지도 SDK(kakao.maps)를 사용 -> 사이트의 지도 객체를 잡아
// 우리가 받은 GPS로 내 위치 표시·따라가기를 직접 붙인다.
// 위치는 이 브라우저 안에서 지도에 그리기만 하고 어디로도 전송하지 않는다.
(function () {
  const V = 'k-2026-11-17.2';
  if (window.__tnK) { window.__tnK.show(); return; }   // 두 번 실행해도 하나만

  // ---------- 화면 (상태 표시 + 따라가기 버튼) ----------
  const css = document.createElement('style');
  css.textContent =
    '#__tnBar{position:fixed;right:14px;bottom:110px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;align-items:flex-end;font:18px sans-serif}' +
    '#__tnBar button{border:0;border-radius:16px;min-width:76px;height:76px;padding:0 18px;font:bold 20px sans-serif;color:#fff;background:#1a73e8;box-shadow:0 4px 14px rgba(0,0,0,.35)}' +
    '#__tnBar button.off{background:#2a2b30}' +
    '#__tnState{background:rgba(0,0,0,.8);color:#fff;border-radius:10px;padding:6px 10px;font-size:15px;max-width:420px}' +
    '.__tnMe{width:46px;height:46px}.__tnMe svg{width:46px;height:46px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}';
  document.head.appendChild(css);
  const bar = document.createElement('div'); bar.id = '__tnBar';
  bar.innerHTML = '<div id="__tnState">' + V + ' 준비 중…</div><button id="__tnFollow" class="off">내 위치</button>';
  document.body.appendChild(bar);
  const $s = bar.querySelector('#__tnState'), $f = bar.querySelector('#__tnFollow');
  const st = { map: false, gps: '위치 대기', note: '' };
  const paint = () => { $s.textContent = 'GPS ' + st.gps + ' · 지도 ' + (st.map ? '연결됨' : '찾는 중') + (st.note ? ' · ' + st.note : ''); };

  // ---------- 사이트의 지도 객체 잡기 ----------
  // kakao.maps.Map의 메서드를 감싸 두면, 사이트가 지도를 쓸 때(이동·확대·창 크기 변경) 그 지도 객체가 잡힌다.
  let map = null;
  const K = window.kakao && window.kakao.maps;
  if (!K || !K.Map) { st.note = '카카오 지도 SDK 없음 (map.kakao.com에서 실행)'; paint(); return; }
  const proto = K.Map.prototype;
  const wrapped = [];
  for (const name of Object.getOwnPropertyNames(proto)) {
    let d; try { d = Object.getOwnPropertyDescriptor(proto, name); } catch (e) { continue; }
    if (!d || typeof d.value !== 'function' || name === 'constructor') continue;
    const orig = d.value;
    proto[name] = function () { if (!map && this instanceof K.Map) { map = this; onMap(); } return orig.apply(this, arguments); };
    wrapped.push([name, orig]);
  }
  const unwrap = () => wrapped.forEach(([n, f]) => { proto[n] = f; });
  // 사이트가 지도 메서드를 부르게 유도 (창 크기 변경 -> 보통 relayout 호출)
  setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
  setTimeout(() => { if (!map) { st.note = '지도를 손가락으로 한 번 움직여 주세요'; paint(); } }, 2500);

  // ---------- 내 위치 ----------
  let pos = null, heading = 0, follow = false, overlay = null, meEl = null, lastPan = 0, lastDraw = 0;
  function onMap() {
    unwrap();
    st.map = true; st.note = ''; paint();
    meEl = document.createElement('div'); meEl.className = '__tnMe';
    meEl.innerHTML = '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="#fff"/><circle cx="22" cy="22" r="17" fill="#1a73e8"/>' +
                     '<path d="M22 8 L31 30 L22 25 L13 30 Z" fill="#fff"/></svg>';
    overlay = new K.CustomOverlay({ content: meEl, xAnchor: 0.5, yAnchor: 0.5, zIndex: 999,
                                    position: pos ? new K.LatLng(pos.lat, pos.lng) : map.getCenter() });
    if (pos) overlay.setMap(map);
    // 사용자가 지도를 끌면 따라가기 해제
    try { K.event.addListener(map, 'dragstart', () => setFollow(false)); } catch (e) {}
    if (pos) setFollow(true);
  }
  function setFollow(on) {
    follow = on; $f.className = on ? '' : 'off'; $f.textContent = on ? '따라가는 중' : '내 위치';
    if (on && map && pos) map.setCenter(new K.LatLng(pos.lat, pos.lng));
  }
  $f.onclick = () => { if (!pos) { st.note = '아직 위치 없음'; paint(); return; } setFollow(true); };
  // 사이트의 "현위치" 버튼도 우리 위치로 동작하게 (사이트 원래 동작은 막음)
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.btn_currentlocation');
    if (!b || !pos || !map) return;
    e.preventDefault(); e.stopPropagation(); setFollow(true);
  }, true);

  navigator.geolocation.watchPosition(p => {
    const c = p.coords;
    pos = { lat: c.latitude, lng: c.longitude, acc: c.accuracy };
    if (c.heading != null && !isNaN(c.heading) && (c.speed == null || c.speed > 0.8)) heading = c.heading;
    const now = Date.now();
    st.gps = '±' + Math.round(c.accuracy) + 'm' + (c.speed != null ? ' · ' + Math.round(c.speed * 3.6) + 'km/h' : '');
    if (now - lastDraw < 400) return;   // 테슬라는 초당 약 7회 -> 약 2회로
    lastDraw = now; paint();
    if (!map) return;
    const ll = new K.LatLng(pos.lat, pos.lng);
    overlay.setPosition(ll); if (!overlay.getMap()) { overlay.setMap(map); setFollow(true); }
    meEl.firstChild.style.transform = 'rotate(' + heading + 'deg)';
    if (follow && now - lastPan > 900) { lastPan = now; map.panTo(ll); }
  }, e => { st.gps = '오류 ' + e.code; paint(); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });

  window.__tnK = { V, show: () => { bar.style.display = ''; }, state: () => ({ map: !!map, pos, follow }) };
  paint();
})();
