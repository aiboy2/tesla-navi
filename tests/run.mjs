// index.html 자동 검증. 실행: npm test
// 실제 위치 대신 가짜 navigator.geolocation을 넣어 측정 로직·요약·원칙 위반 여부를 확인한다.
// 실차/실제 GPS 동작은 이 테스트로 검증되지 않는다 (사용자 실측 필요).
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}
// 가짜 위치 콜백 안에서 페이지 코드가 던진 예외도 실패로 집계
process.on('uncaughtException', e => { failed++; console.log('  FAIL 페이지 예외: ' + e.message); });

// 가짜 위치 제공자. opts로 시나리오 조절
function makeGeo(o = {}) {
  let lat = 37.5665, n = 0;
  const st = { inFlight: 0, maxInFlight: 0, gcp: 0, watches: 0, cleared: 0 };
  const pos = (sameTs) => ({
    coords: { latitude: (lat += 0.0001), longitude: 126.978, accuracy: 8,
              speed: o.nullSpeed ? null : 15, heading: o.nullSpeed ? null : 90, altitude: 30 },
    timestamp: sameTs ? 1700000000000 : Date.now()
  });
  const geo = {
    watchPosition(ok) { st.watches++; return setInterval(() => ok(pos(false)), o.watchMs ?? 200); },
    clearWatch(id) { st.cleared++; clearInterval(id); },
    getCurrentPosition(ok, err) {
      st.gcp++; n++;
      if (o.neverRespond) return;
      st.inFlight++; st.maxInFlight = Math.max(st.maxInFlight, st.inFlight);
      setTimeout(() => {
        st.inFlight--;
        if (o.errEvery && n % o.errEvery === 0) err({ code: 3, message: 'Timeout' });
        else ok(pos(o.sameTs));
      }, o.latency ?? 50);
    }
  };
  return { geo, st };
}

async function load(settings, geoOpts) {
  const { geo, st } = makeGeo(geoOpts);
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message)));
  const dom = new JSDOM(HTML, {
    url: 'https://aiboy2.github.io/tesla-navi/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w.navigator, 'geolocation', { value: geo, configurable: true });
      w.localStorage.setItem('p0.settings', JSON.stringify(settings));
      w.addEventListener('error', e => errors.push(String(e.message)));
    }
  });
  await sleep(20);
  const w = dom.window, d = w.document;
  return { w, d, st, errors, $: id => d.getElementById(id),
           session: () => JSON.parse(w.localStorage.getItem('p0.session') || 'null') };
}

const base = { mode: 'A', interval: 1000, high: 1, maxAge: 0, timeout: 10000 };

console.log('[정적 검사]');
{
  check('VERSION 상수 존재 (p0-YYYY-MM-DD.N 형식)', /var VERSION = 'p\d+-\d{4}-\d{2}-\d{2}\.\d+'/.test(HTML));
  // 원칙: 위치를 서버로 보내지 않는다 → 네트워크 전송 API 사용 금지
  const banned = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'navigator.share'];
  const hit = banned.filter(b => HTML.includes(b));
  check('네트워크 전송 API 미사용', hit.length === 0, hit);
  const ext = HTML.match(/<script[^>]+src=|<link[^>]+href=["']https?:/g);
  check('외부 스크립트/스타일 미사용', !ext, ext);
}

console.log('[A 단독: watchPosition]');
{
  const t = await load(base, { watchMs: 200 });
  t.$('startBtn').click(); await sleep(1100); t.$('startBtn').click();
  const s = t.session();
  check('스크립트 에러 없음', t.errors.length === 0, t.errors);
  check('watch 1회 등록 후 정지 시 해제', t.st.watches === 1 && t.st.cleared === 1, t.st);
  check('getCurrentPosition 호출 안 함', t.st.gcp === 0, t.st.gcp);
  const a = s.entries.filter(e => e.s === 'A' && e.ok).length;
  check('A 갱신 4회 이상 기록', a >= 4, a);
  check('A 갱신 횟수 화면 = 기록', Number(t.$('A-count').textContent) === a);
  check('요약 화면 표시', t.$('overlay').classList.contains('show'));
  check('정지 시각 기록', !!s.end);
  t.w.close();
}

console.log('[B 단독: getCurrentPosition 주기, 에러 섞임]');
{
  const t = await load({ ...base, mode: 'B', interval: 500 }, { latency: 120, errEvery: 3 });
  t.$('startBtn').click(); await sleep(2100); t.$('startBtn').click();
  const s = t.session(), B = s.entries.filter(e => e.s === 'B');
  check('스크립트 에러 없음', t.errors.length === 0, t.errors);
  check('요청이 겹치지 않음 (동시 요청 최대 1)', t.st.maxInFlight === 1, t.st.maxInFlight);
  check('주기대로 4~5회 요청', t.st.gcp >= 4 && t.st.gcp <= 5, t.st.gcp);
  check('watchPosition 호출 안 함', t.st.watches === 0);
  check('timeout 에러(code 3) 기록', B.some(e => !e.ok && e.code === 3), B);
  check('응답시간 기록', B.filter(e => e.ok).every(e => e.lt >= 100));
  check('요약에 에러 집계 표시', t.$('sumTable').textContent.includes('code 3'));
  t.w.close();
}

console.log('[B: 같은 timestamp 반복(캐시 의심), speed null]');
{
  const t = await load({ ...base, mode: 'B', interval: 300 }, { latency: 20, sameTs: true, nullSpeed: true });
  t.$('startBtn').click(); await sleep(1000); t.$('startBtn').click();
  const ok = t.session().entries.filter(e => e.s === 'B' && e.ok);
  check('2회째부터 같은 timestamp 반복으로 집계', ok.slice(1).every(e => e.rep === 1) && ok.length >= 3, ok.length);
  check('speed null 표시', t.$('B-spd').textContent === 'null');
  t.w.close();
}

console.log('[B: 콜백이 오지 않을 때 watchdog]');
{
  const t = await load({ ...base, mode: 'B', timeout: 100 }, { neverRespond: true });
  t.$('startBtn').click(); await sleep(5300); t.$('startBtn').click();
  const nocb = t.session().entries.filter(e => e.code === 'nocb').length;
  check('timeout+5초 뒤 "콜백 없음" 기록 후 재요청', nocb === 1 && t.st.gcp === 2, { nocb, gcp: t.st.gcp });
  t.w.close();
}

console.log('[A+B 동시, 새로고침 후 이전 세션 복원]');
{
  const t = await load({ ...base, mode: 'AB', interval: 500 }, { watchMs: 300 });
  t.$('startBtn').click(); await sleep(1100); t.$('startBtn').click();
  const s = t.session();
  check('A, B 모두 기록', s.entries.some(e => e.s === 'A') && s.entries.some(e => e.s === 'B'));
  // 같은 localStorage로 다시 로드
  const saved = t.w.localStorage.getItem('p0.session');
  t.w.close();
  const dom = new JSDOM(HTML, { url: 'https://aiboy2.github.io/tesla-navi/', runScripts: 'dangerously',
    beforeParse(w) { w.localStorage.setItem('p0.session', saved); } });
  await sleep(20);
  const d = dom.window.document;
  check('이전 세션 요약 버튼 활성', d.getElementById('sumBtn').disabled === false);
  dom.window.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
