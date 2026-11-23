// nav-core.js 단위 테스트. 실행: npm test
import * as N from '../nav-core.js';

let failed = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

// 가짜 카카오 길찾기 응답: 동쪽으로 약 1km 직진 → 우회전 → 북쪽(실제로는 남쪽 아님) 약 500m → 도착
const lat0 = 37.5, lng0 = 127.0;
const dLng = 1000 / (111320 * Math.cos(lat0 * Math.PI / 180)); // 약 1km 경도 차
const dLat = 500 / 110574;                                     // 약 500m 위도 차
const vx = [];
for (let i = 0; i <= 10; i++) vx.push(lng0 + dLng * i / 10, lat0);
const v2 = [];
for (let i = 0; i <= 5; i++) v2.push(lng0 + dLng, lat0 + dLat * i / 5);
const resp = { routes: [{ result_code: 0, result_msg: '길찾기 성공',
  summary: { distance: 1500, duration: 180, fare: { toll: 0 } },
  sections: [{
    roads: [{ vertexes: vx }, { vertexes: v2 }],
    guides: [
      { x: lng0, y: lat0, distance: 0, duration: 0, type: 100, guidance: '출발지', name: '' },
      { x: lng0 + dLng, y: lat0, distance: 1000, duration: 120, type: 2, guidance: '우회전', name: '테헤란로' },
      { x: lng0 + dLng, y: lat0 + dLat, distance: 500, duration: 60, type: 101, guidance: '목적지', name: '' }
    ]
  }]
}]};

console.log('[buildRoute]');
const route = N.buildRoute(resp);
check('총거리 약 1500m', Math.abs(route.total - 1500) < 15, route.total);
check('중복 꼭짓점 제거 (11 + 5 = 16점)', route.pts.length === 16, route.pts.length);
check('우회전 안내 위치 약 1000m', Math.abs(route.guides[1].along - 1000) < 10, route.guides[1].along);
check('도착 안내 위치 = 총거리', Math.abs(route.guides[2].along - route.total) < 1);
let threw = null;
try { N.buildRoute({ routes: [{ result_code: 104, result_msg: '출발지와 도착지가 5 m 이내로 설정된 경우 경로를 탐색할 수 없음' }] }); } catch (e) { threw = e.message; }
check('실패 코드면 result_msg로 에러', threw && threw.includes('5 m'), threw);

console.log('[locate / progress]');
const p300 = { lat: lat0 + 0.00005, lng: lng0 + dLng * 0.3 };  // 300m 지점, 북쪽으로 약 5.5m 벗어남
const L = N.locate(route, p300, 0);
check('경로상 위치 약 300m', Math.abs(L.along - 300) < 5, L.along);
check('경로 이탈 거리 약 5.5m', Math.abs(L.off - 5.5) < 1, L.off);
const P = N.progress(route, L.along);
check('다음 안내 = 우회전 (출발지 제외)', P.next && P.next.guidance === '우회전', P.next);
check('다음 안내까지 약 700m', Math.abs(P.distToNext - 700) < 6, P.distToNext);
check('남은 거리 약 1200m', Math.abs(P.remainDist - 1200) < 6, P.remainDist);
check('남은 시간 = 120×0.7 + 60 = 144초', Math.abs(P.remainTime - 144) < 2, P.remainTime);
const pEnd = N.progress(route, route.total - 1);
check('도착 직전: 다음 안내 없음, 남은 거리 약 1m', pEnd.next === null && pEnd.remainDist < 2, pEnd);
const far = N.locate(route, { lat: lat0 + dLat * 0.5, lng: lng0 + dLng * 1.0005 }, 0); // 힌트가 멀어도 전체 탐색
check('힌트와 먼 위치도 찾음 (약 1250m)', Math.abs(far.along - 1250) < 10, far.along);

console.log('[재탐색 판단]');
{
  const m = N.createRerouteMonitor({ threshold: 50, holdMs: 5000, cooldownMs: 20000 });
  check('이탈 직후엔 재탐색 안 함', m.update(80, 10, 0) === false);
  check('5초 유지되면 재탐색', m.update(80, 10, 5000) === true);
  check('쿨다운 중엔 재탐색 안 함', m.update(80, 10, 11000) === false && m.update(80, 10, 16000) === false);
  check('쿨다운 후 다시 5초 유지되면 재탐색', m.update(80, 10, 26000) === true, 'x');
  const m2 = N.createRerouteMonitor();
  m2.update(80, 60, 0);
  check('정확도 60m면 기준 90m → 80m 이탈은 무시', m2.update(80, 60, 9000) === false);
  m2.update(80, 10, 10000); m2.update(10, 10, 12000);
  check('경로 복귀하면 타이머 초기화', m2.update(80, 10, 15000) === false);
}

console.log('[음성 안내 시점]');
{
  const a = N.createAnnouncer([500, 200, 50]);
  check('600m: 안내 없음', a.check('g1', 600) === null);
  check('480m: 500m 안내', a.check('g1', 480) === 500);
  check('470m: 중복 없음', a.check('g1', 470) === null);
  check('150m: 200m 안내', a.check('g1', 150) === 200);
  check('40m: 50m 안내', a.check('g1', 40) === 50);
  const b = N.createAnnouncer([500, 200, 50]);
  check('처음부터 120m면 200m 안내 1회', b.check('g2', 120) === 200 && b.check('g2', 110) === null);
}

console.log('[REST 키 입력 보정]');
{
  const K = '0123456789abcdef0123456789abcdef'; // 테스트용 가짜 키
  check('정상 키', N.normalizeKey(K).ok && N.normalizeKey(K).key === K);
  check('앞뒤 공백·줄바꿈', N.normalizeKey('  ' + K + '\n').ok);
  check('중간 공백(자동 띄어쓰기)', N.normalizeKey(K.slice(0, 10) + ' ' + K.slice(10)).ok);
  check('자동 대문자', N.normalizeKey(K.toUpperCase()).key === K);
  check('전각 문자', N.normalizeKey(K.replace(/[0-9a-f]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0))).key === K);
  check('"KakaoAK " 접두어 붙여넣기', N.normalizeKey('KakaoAK ' + K).ok);
  check('31자는 거부 + 길이 보고', !N.normalizeKey(K.slice(1)).ok && N.normalizeKey(K.slice(1)).length === 31);
  check('영문 g 등 다른 문자는 거부', !N.normalizeKey(K.slice(1) + 'g').ok);
}

console.log('[표시 형식]');
check('formatDist 347 → 350m', N.formatDist(347) === '350m', N.formatDist(347));
check('formatDist 42 → 40m', N.formatDist(42) === '40m', N.formatDist(42));
check('formatDist 2345 → 2.3km', N.formatDist(2345) === '2.3km', N.formatDist(2345));
check('turnIcon 우회전', N.turnIcon({ guidance: '우회전' }) === 'right');
check('turnIcon 좌회전/유턴/직진', N.turnIcon({ guidance: '좌회전' }) === 'left' && N.turnIcon({ guidance: '유턴' }) === 'uturn' && N.turnIcon(null) === 'straight');
check('turnIcon 도착', N.turnIcon({ type: 101, guidance: '목적지' }) === 'arrive');
check('guideText', N.guideText({ guidance: '우회전', name: '테헤란로' }) === '우회전 · 테헤란로');
check('formatEta 오후', /^오후 \d{1,2}:\d{2}$/.test(N.formatEta(new Date(2026, 10, 17, 15, 0).getTime(), 600)), N.formatEta(new Date(2026, 10, 17, 15, 0).getTime(), 600));

console.log('[화면 표시용 계산]');
{
  const rr = N.buildRoute(resp);
  check('도로 구간 2개 기록', rr.roads.length === 2 && rr.roads[0].from === 0 && rr.roads[1].to === rr.pts.length - 1, rr.roads);
  const resp2 = JSON.parse(JSON.stringify(resp));
  resp2.routes[0].sections[0].roads[0].traffic_state = 1; resp2.routes[0].sections[0].roads[1].traffic_state = 4;
  resp2.routes[0].sections[0].roads[0].name = '테헤란로'; resp2.routes[0].sections[0].roads[1].name = '강남대로';
  const r2 = N.buildRoute(resp2), runs = N.trafficRuns(r2);
  check('정체/원활 구간 분리', runs.length === 2 && runs[0].level === 'jam' && runs[1].level === 'free' && runs[0].to === runs[1].from, runs);
  check('현재 도로명', N.roadNameAt(r2, 500) === '테헤란로' && N.roadNameAt(r2, 1200) === '강남대로');
  check('각도 최단 회전', N.angleDiff(350, 10) === 20 && N.angleDiff(10, 350) === -20);
  const sm = N.createSmoother();
  sm.push({ lat: 37.5, lng: 127.0, heading: 350 }, 0);
  sm.push({ lat: 37.5, lng: 127.001, heading: 10 }, 300);
  const mid = sm.at(450), end = sm.at(2000);
  check('보간: 중간 위치', mid.lng > 127.0 && mid.lng < 127.001, mid);
  check('보간: 북쪽을 넘어 짧게 회전', (mid.heading > 350 || mid.heading < 10), mid.heading);
  check('보간: 끝나면 새 위치', Math.abs(end.lng - 127.001) < 1e-9);
  sm.push({ lat: 37.6, lng: 127.001, heading: 0 }, 2100);
  check('보간: 큰 점프는 즉시 이동', Math.abs(sm.at(2101).lat - 37.6) < 1e-9);
  check('자동 확대: 저속 3, 시내 4, 고속 5', N.autoLevel(20) === 3 && N.autoLevel(60) === 4 && N.autoLevel(100) === 5);
  check('자동 확대: 회전 직전 2', N.autoLevel(60, 200, 4) === 2);
  check('자동 확대: 경계 흔들림 방지', N.autoLevel(43, 1000, 4) === 4 && N.autoLevel(88, 1000, 4) === 4 && N.autoLevel(91, 1000, 4) === 5);
}

console.log('[여러 경로]');
{
  const multi = JSON.parse(JSON.stringify(resp));
  const alt = JSON.parse(JSON.stringify(resp.routes[0])); alt.summary = { distance: 1400, duration: 240, fare: { toll: 0 } };
  const alt2 = JSON.parse(JSON.stringify(resp.routes[0])); alt2.summary = { distance: 1505, duration: 181, fare: { toll: 0 } };  // 추천과 거의 같음
  const bad = { result_code: 104, result_msg: 'x' };
  multi.routes[0].summary = { distance: 1500, duration: 180, fare: { toll: 1000 } };
  multi.routes.push(alt, alt2, bad);
  const rs = N.buildRoutes(multi);
  check('실패 경로·중복 경로 제외', rs.length === 2, rs.length);
  const tags = N.routeTags(rs);
  check('이름표: 추천=최단 시간, 대안=최단 거리·무료', tags[0].join() === '추천,최단 시간' && tags[1].join() === '최단 거리,무료', tags);
  let err = null; try { N.buildRoutes({ routes: [bad] }); } catch (e) { err = e.message; }
  check('추천 경로 실패면 에러', err === 'x', err);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
