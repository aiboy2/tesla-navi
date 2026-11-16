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

// 카카오모빌리티 길찾기 응답 → 내부 경로 구조
export function buildRoute(resp) {
  const r = resp && resp.routes && resp.routes[0];
  if (!r) throw new Error('경로 응답이 비어 있습니다');
  if (r.result_code !== 0) throw new Error(r.result_msg || ('길찾기 실패 (코드 ' + r.result_code + ')'));
  const pts = [], rawGuides = [];
  for (const s of r.sections || []) {
    for (const road of s.roads || []) {
      const v = road.vertexes || [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        const p = { lat: v[i + 1], lng: v[i] }, last = pts[pts.length - 1];
        if (!last || last.lat !== p.lat || last.lng !== p.lng) pts.push(p);
      }
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
  return { pts, cum, total: cum[cum.length - 1], guides,
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

// 경로 이탈 → 재탐색 판단. 정확도가 나쁘면 기준을 넓힌다.
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
export function turnIcon(g) {
  if (!g) return '↑';
  const t = g.guidance || '';
  if (g.type === 101 || /도착|목적지/.test(t)) return '🏁';
  if (/유턴|U턴/.test(t)) return '⮌';
  if (/좌회전/.test(t)) return '↰';
  if (/우회전/.test(t)) return '↱';
  if (/왼쪽/.test(t)) return '↖';
  if (/오른쪽/.test(t)) return '↗';
  if (/경유/.test(t)) return '◉';
  return '↑';
}
export function guideText(g) {
  if (!g) return '';
  return g.guidance + (g.name && !g.guidance.includes(g.name) ? ' · ' + g.name : '');
}
