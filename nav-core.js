// nav-core.js — 내비 계산 로직 (DOM/지도 SDK 없음). index.html과 tests에서 공용으로 사용.
// 좌표는 {lat, lng}, 거리 m, 시간 s.

const RAD = Math.PI / 180, R = 6371000;

export function dist(a, b) {
  const dLa = (b.lat - a.lat) * RAD, dLo = (b.lng - a.lng) * RAD;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

// 점 p를 선분 a-b에 투영. 짧은 구간이므로 a 기준 평면 근사.
function project(p, a, b) {
  const k = Math.cos(a.lat * RAD) * R * RAD, m = R * RAD;
  const bx = (b.lng - a.lng) * k, by = (b.lat - a.lat) * m;
  const px = (p.lng - a.lng) * k, py = (p.lat - a.lat) * m;
  const L2 = bx * bx + by * by;
  let t = L2 > 0 ? (px * bx + py * by) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - t * bx, dy = py - t * by;
  return { t, d: Math.sqrt(dx * dx + dy * dy) };
}

// 카카오모빌리티 길찾기 응답 -> 내부 경로 구조
export function buildRoute(resp, index = 0) {
  const r = resp && resp.routes && resp.routes[index];
  if (!r) throw new Error('경로 응답이 비어 있습니다');
  if (r.result_code !== 0) throw new Error(r.result_msg || ('길찾기 실패 (코드 ' + r.result_code + ')'));
  const pts = [], rawGuides = [], roads = [];
  for (const s of r.sections || []) {
    for (const road of s.roads || []) {
      const v = road.vertexes || [], from = Math.max(0, pts.length - 1);
      for (let i = 0; i + 1 < v.length; i += 2) {
        const p = { lat: v[i + 1], lng: v[i] }, last = pts[pts.length - 1];
        if (!last || last.lat !== p.lat || last.lng !== p.lng) pts.push(p);
      }
      // 도로별 이름·정체 상태 (경로선 색칠, 현재 도로명 표시용). from/to는 pts 인덱스
      if (pts.length - 1 > from) roads.push({ from, to: pts.length - 1, name: road.name || '', traffic: road.traffic_state || 0 });
    }
    for (const g of s.guides || []) rawGuides.push(g);
  }
  if (pts.length < 2) throw new Error('경로 좌표가 부족합니다');
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  // 안내 지점을 경로 위 누적거리(along)에 대응시킨다. 같은 곳을 두 번 지나는 경로 대비: 앞에서부터 처음 가까워지는 지점 우선
  let from = 0;
  const guides = rawGuides.map(g => {
    const p = { lat: g.y, lng: g.x };
    let idx = -1, best = Infinity, bestIdx = from;
    for (let i = from; i < pts.length; i++) {
      const d = dist(p, pts[i]);
      if (d < 10) { idx = i; break; }
      if (d < best) { best = d; bestIdx = i; }
    }
    if (idx < 0) idx = bestIdx;
    from = idx;
    return { lat: p.lat, lng: p.lng, along: cum[idx], distance: g.distance || 0, duration: g.duration || 0,
             type: g.type, guidance: g.guidance || '', name: g.name || '' };
  });
  const sm = r.summary || {};
  return { pts, cum, total: cum[cum.length - 1], guides, roads,
           summary: { distance: sm.distance, duration: sm.duration, toll: sm.fare ? sm.fare.toll : 0 } };
}

// 현재 위치를 경로에 맞춘다. hint: 직전 구간 인덱스 (탐색 범위 축소)
export function locate(route, p, hint = 0) {
  const n = route.pts.length;
  const scan = (lo, hi) => {
    let best = { d: Infinity, seg: 0, t: 0 };
    for (let i = Math.max(0, lo); i < Math.min(n - 1, hi); i++) {
      const q = project(p, route.pts[i], route.pts[i + 1]);
      if (q.d < best.d) best = { d: q.d, seg: i, t: q.t };
    }
    return best;
  };
  let b = scan(hint - 20, hint + 400);
  if (b.d > 80) { const all = scan(0, n); if (all.d < b.d) b = all; }
  const segLen = route.cum[b.seg + 1] - route.cum[b.seg];
  return { along: route.cum[b.seg] + b.t * segLen, off: b.d, seg: b.seg };
}

// 진행 상황: 다음 안내, 남은 거리/시간
export function progress(route, along) {
  const gs = route.guides;
  let ni = -1;
  for (let i = 0; i < gs.length; i++) {
    if (gs[i].type === 100) continue;             // 출발지 안내 제외
    if (gs[i].along > along + 3) { ni = i; break; }
  }
  const remainDist = Math.max(0, route.total - along);
  if (ni < 0) return { next: null, after: null, distToNext: remainDist, remainDist, remainTime: 0 };
  const next = gs[ni], distToNext = Math.max(0, next.along - along);
  let remainTime = next.distance > 0 ? next.duration * Math.min(1, distToNext / next.distance) : 0;
  for (let i = ni + 1; i < gs.length; i++) remainTime += gs[i].duration;
  const after = gs[ni + 1] && (gs[ni + 1].along - next.along) < 150 ? gs[ni + 1] : null;
  return { next, nextIndex: ni, after, distToNext, remainDist, remainTime };
}

// 경로 이탈 -> 재탐색 판단. 정확도가 나쁘면 기준을 넓힌다.
export function createRerouteMonitor({ threshold = 50, holdMs = 5000, cooldownMs = 20000 } = {}) {
  let since = null, lastAt = -Infinity;
  return {
    update(off, accuracy, now) {
      const lim = Math.max(threshold, (accuracy || 0) * 1.5);
      if (off <= lim) { since = null; return false; }
      if (since === null) since = now;
      if (now - since >= holdMs && now - lastAt >= cooldownMs) { lastAt = now; since = null; return true; }
      return false;
    },
    reset() { since = null; }
  };
}

// 음성 안내 시점: 각 안내 지점마다 임계 거리별 1회
export function createAnnouncer(thresholds = [500, 200, 50]) {
  const done = new Set();
  return {
    check(key, d) {
      for (const t of thresholds) {
        if (d <= t && d > t * 0.4 - 10 && !done.has(key + '@' + t)) {
          thresholds.filter(x => x >= t).forEach(x => done.add(key + '@' + x));
          return t;
        }
      }
      return null;
    },
    reset() { done.clear(); }
  };
}

// 휴대폰/차량 키보드 입력 보정: 전각 문자, 공백·줄바꿈, 자동 대문자, "KakaoAK " 접두어 붙여넣기 대응
export function normalizeKey(raw) {
  const v = String(raw || '').normalize('NFKC').replace(/^\s*KakaoAK/i, '').replace(/[\s​-‍﻿]+/g, '').toLowerCase();
  return { key: v, ok: /^[0-9a-f]{32}$/.test(v), length: v.length };
}

export function formatDist(m) {
  if (m == null || isNaN(m)) return '—';
  if (m < 1000) return (m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10) + 'm';
  return (m / 1000).toFixed(m < 10000 ? 1 : 0) + 'km';
}
export function spokenDist(m) {
  if (m < 1000) return (m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50) + '미터';
  return (Math.round(m / 100) / 10) + '킬로미터';
}
export function formatEta(nowMs, sec) {
  const d = new Date(nowMs + sec * 1000), h = d.getHours(), mi = d.getMinutes();
  return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + ':' + String(mi).padStart(2, '0');
}
export function formatDur(sec) {
  const m = Math.round(sec / 60);
  return m < 60 ? m + '분' : Math.floor(m / 60) + '시간 ' + (m % 60) + '분';
}
// 안내 아이콘 종류 (화면에서 SVG로 그림 — 테슬라 브라우저 글꼴에 화살표·특수기호 글자가 없어 X 박스로 나옴)
export function turnIcon(g) {
  if (!g) return 'straight';
  const t = g.guidance || '';
  if (g.type === 101 || /도착|목적지/.test(t)) return 'arrive';
  if (/유턴|U턴/.test(t)) return 'uturn';
  if (/좌회전/.test(t)) return 'left';
  if (/우회전/.test(t)) return 'right';
  if (/왼쪽/.test(t)) return 'keepLeft';
  if (/오른쪽/.test(t)) return 'keepRight';
  if (/경유/.test(t)) return 'via';
  return 'straight';
}
export function guideText(g) {
  if (!g) return '';
  return g.guidance + (g.name && !g.guidance.includes(g.name) ? ' · ' + g.name : '');
}

// ---------- 화면 표시용 계산 ----------

// 카카오 traffic_state: 0 정보없음, 1 정체, 2 지연, 3 서행, 4 원활, 6 사고
export function trafficLevel(state) {
  return state === 1 || state === 6 ? 'jam' : state === 2 ? 'slow' : state === 3 ? 'slow' : 'free';
}
// 경로를 정체 단계가 같은 구간끼리 묶는다 -> [{level, from, to}] (pts 인덱스, 끝점 공유)
export function trafficRuns(route) {
  const runs = [];
  for (const rd of route.roads || []) {
    const level = trafficLevel(rd.traffic), last = runs[runs.length - 1];
    if (last && last.level === level && last.to === rd.from) last.to = rd.to;
    else runs.push({ level, from: rd.from, to: rd.to });
  }
  if (!runs.length) runs.push({ level: 'free', from: 0, to: route.pts.length - 1 });
  return runs;
}
// 경로 위 위치(along)의 도로 이름
export function roadNameAt(route, along) {
  for (const rd of route.roads || []) if (route.cum[rd.to] >= along) return rd.name;
  return '';
}

// 각도 a -> b 의 최단 회전량 (-180~180)
export function angleDiff(a, b) { return ((b - a) % 360 + 540) % 360 - 180; }

// GPS 사이를 이어 그리는 보간기. 새 위치가 오면 "지금 화면 위치 -> 새 위치"를 평균 수신 간격 동안 이동.
// 화면은 매 프레임 at(now)로 위치를 받아 그린다 -> 1초마다 툭툭 옮기지 않고 부드럽게 움직임.
export function createSmoother({ snapMeters = 150, minMs = 80, maxMs = 1200 } = {}) {
  let from = null, to = null, t0 = 0, dur = 0, lastAt = 0, avg = 300;
  const lerp = (a, b, k) => a + (b - a) * k;
  function at(now) {
    if (!to) return null;
    if (!from || dur <= 0) return { ...to };
    const k = Math.max(0, Math.min(1, (now - t0) / dur));
    return { lat: lerp(from.lat, to.lat, k), lng: lerp(from.lng, to.lng, k),
             heading: (from.heading + angleDiff(from.heading, to.heading) * k + 360) % 360 };
  }
  return {
    push(p, now) {
      const cur = at(now);
      if (lastAt) avg = avg * 0.7 + Math.max(minMs, Math.min(maxMs, now - lastAt)) * 0.3;
      lastAt = now;
      const next = { lat: p.lat, lng: p.lng, heading: p.heading == null ? (cur ? cur.heading : 0) : p.heading };
      if (!cur || dist(cur, next) > snapMeters) { from = null; to = next; dur = 0; return; }   // 큰 점프는 바로 이동
      from = cur; to = next; t0 = now; dur = avg;
    },
    at
  };
}

// 속도·다음 안내까지 거리로 지도 확대 단계 결정 (카카오 레벨: 작을수록 확대). 경계에서 흔들리지 않게 여유를 둔다.
export function autoLevel(kmh, distToNext, current) {
  if (distToNext != null && distToNext < 250) return 2;          // 회전 직전엔 크게
  const steps = [[0, 3], [45, 4], [85, 5]];                        // 시속 기준
  let want = 3;
  for (const [v, lv] of steps) if (kmh >= v) want = lv;
  if (current != null && want !== current && current >= 3 && current <= 5) {
    // 현재 단계 경계에서 ±5km/h 안쪽이면 유지
    const lo = steps.find(x => x[1] === current)[0], hiStep = steps.find(x => x[1] === current + 1);
    if (kmh >= lo - 5 && (!hiStep || kmh < hiStep[0] + 5)) return current;
  }
  return want;
}

// 대안 경로 포함 응답(alternatives=true) -> 성공한 경로들. 첫 번째(추천) 실패면 에러
export function buildRoutes(resp) {
  const n = (resp && resp.routes && resp.routes.length) || 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    try { out.push(buildRoute(resp, i)); } catch (e) { if (i === 0) throw e; }
  }
  if (!out.length) throw new Error('경로 응답이 비어 있습니다');
  // 거의 같은 경로(거리·시간 차이 1% 미만) 중복 제거
  return out.filter((r, i) => !out.slice(0, i).some(q =>
    Math.abs(q.summary.distance - r.summary.distance) < q.summary.distance * 0.01 &&
    Math.abs(q.summary.duration - r.summary.duration) < q.summary.duration * 0.01));
}
// 경로 후보 이름표: 첫 번째는 "추천", 그 외 특징(최단 시간·최단 거리·무료)
export function routeTags(list) {
  const minT = Math.min(...list.map(r => r.summary.duration)), minD = Math.min(...list.map(r => r.summary.distance));
  const anyToll = list.some(r => r.summary.toll > 0);
  return list.map((r, i) => {
    const t = [];
    if (i === 0) t.push('추천');
    if (list.length > 1 && r.summary.duration === minT) t.push('최단 시간');
    if (list.length > 1 && r.summary.distance === minD) t.push('최단 거리');
    if (anyToll && !(r.summary.toll > 0)) t.push('무료');
    if (!t.length) t.push('대안 ' + i);
    return t;
  });
}
