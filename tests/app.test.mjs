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
  // 테슬라 브라우저 글꼴에 없는 화살표·기호·이모지는 X 박스로 나옴 (2026-11-17 실차) → 화면 글자로 쓰지 않고 SVG 사용
  const glyphs = [...(HTML + CORE).matchAll(/[\u2190-\u21ff\u2300-\u23ff\u2460-\u27bf\u2900-\u2bff\u{1F000}-\u{1FAFF}]/gu)].map(m => m[0]);
  check('화살표·기호·이모지 글자 미사용', glyphs.length === 0, [...new Set(glyphs)]);
  // 테슬라 브라우저에서 카카오 기본 터치 조작이 안 됨 (2026-11-17 실차) -> 앱이 직접 처리하는 구조 유지
  check('지도 조작을 앱이 직접 처리 (카카오 기본 끔 + touch-action none)', /setDraggable\(false\)/.test(HTML) && /#map\{[^}]*touch-action:none/.test(HTML));
  check('REST 키를 코드에 하드코딩하지 않음', !/KakaoAK [0-9a-f]{32}/i.test(HTML));
  // 저장소 추적 파일 전체에서 32자리 16진수(카카오 키 형식)는 공개용 JS 키와 테스트용 가짜 키만 허용
  const { execSync } = await import('node:child_process');
  const ALLOWED_KEYS = ['a53568cf2b599d80652c79eba7b6a5ca', '0123456789abcdef0123456789abcdef'];
  const files = execSync('git ls-files', { cwd: new URL('..', import.meta.url) }).toString().split('\n')
    .filter(f => f && !f.endsWith('package-lock.json'));
  const leaks = [];
  for (const f of files) {
    const txt = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const m of txt.matchAll(/\b[0-9a-f]{32}\b/gi)) if (!ALLOWED_KEYS.includes(m[0].toLowerCase())) leaks.push(f + ':' + m[0].slice(0, 6) + '…');
  }
  check('저장소에 비공개 키로 보이는 값 없음', leaks.length === 0, leaks);
}

console.log('[정적 검사: 카카오/네이버 사이트 진단 스크립트 k.js]');
{
  const K = readFileSync(new URL('../k.js', import.meta.url), 'utf8');
  const banned = ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'new Image', 'import('];
  check('k.js는 아무 데로도 전송하지 않음', banned.every(b => !K.replace(/^\s*\/\/.*$/gm, '').includes(b)), banned.filter(b => K.replace(/^\s*\/\/.*$/gm, '').includes(b)));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
