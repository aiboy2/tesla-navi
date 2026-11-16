// 내비 앱(index.html) 정적 검사: 위치 전송 대상 제한, 키 하드코딩 금지. (jsdom은 ES module을 실행하지 않으므로 화면 흐름은 브라우저/실차에서 확인)
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const CORE = readFileSync(new URL('../nav-core.js', import.meta.url), 'utf8');
let failed = 0, passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

console.log('[정적 검사: 위치는 카카오로만]');
{
  const ALLOWED = ['dapi.kakao.com', 'apis-navi.kakaomobility.com'];
  const hosts = [...HTML.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map(m => m[1]);
  const bad = hosts.filter(h => !ALLOWED.includes(h));
  check('외부 주소는 카카오 도메인만', bad.length === 0, bad);
  const fetches = HTML.match(/fetch\(/g) || [];
  check('fetch는 길찾기 1곳만', fetches.length === 1 && /fetch\(DIRECTIONS_URL/.test(HTML), fetches.length);
  const banned = ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource'];
  check('다른 전송 API 미사용', banned.every(b => !HTML.includes(b) && !CORE.includes(b)));
  check('nav-core.js는 네트워크 미사용', !/fetch\(|https?:\/\//.test(CORE));
  check('VERSION 형식', /const VERSION = 'p\d+-\d{4}-\d{2}-\d{2}\.\d+'/.test(HTML));
  check('REST 키를 코드에 하드코딩하지 않음', !/KakaoAK [0-9a-f]{32}/i.test(HTML));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
