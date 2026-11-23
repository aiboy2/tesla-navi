---
name: ship
description: 변경 사항을 검증하고 GitHub Pages에 배포한다 (VERSION 올리기 → npm test → 커밋 → main 반영 → push → 배포 확인 → PROGRESS 기록). 코드 수정을 마쳐 사용자가 실기기로 테스트할 수 있게 해야 할 때 사용.
---

# ship — 검증 후 배포

순서대로 진행하고, 한 단계라도 실패하면 멈추고 원인을 고친다. 실패를 숨기고 넘어가지 않는다.

1. **VERSION 올리기** — `index.html`의 `var VERSION = 'p0-YYYY-MM-DD.N'`
   - 오늘 날짜(절대 날짜)로, 같은 날이면 N을 1 증가. Phase가 바뀌면 접두어도 변경(p1-…)
   - `import * as N from './nav-core.js?v=…'` 의 버전도 같은 값으로 (테슬라 브라우저 캐시 방지, `npm test`가 검사)
2. **자동 검증** — `npm test` (없으면 먼저 `npm install`). 전부 통과해야 진행
   - 새/변경 동작에 대한 테스트가 `tests/run.mjs`에 있는지 확인, 없으면 추가
3. **PROGRESS.md 갱신** — 현재 상태의 페이지 버전, 다음 할 일(사용자가 실측할 항목), 결정 기록
4. **커밋** — 무엇을 왜 바꿨는지 한국어로. 커밋 메시지 끝에 시스템이 지정한 attribution 줄 포함
5. **main 반영 및 push**
   - 현재 브랜치가 main이면 `git pull --ff-only` 후 `git push`
   - 작업 브랜치면: `git fetch origin` → main으로 전환 → `git pull --ff-only` → 작업 브랜치를 병합(충돌 시 해결 후 테스트 재실행) → `git push origin main`. 작업 브랜치도 push
   - force push 금지
6. **배포 확인** — 1~2분 간격으로 최대 약 5분 확인:
   `curl -s https://aiboy2.github.io/tesla-navi/ | grep -o "p[0-9]*-[0-9-]*\.[0-9]*"` 가 새 VERSION을 반환하면 성공. 네트워크 제한 등으로 확인 불가면 "배포 확인 못 함"이라고 정직하게 보고
7. **사용자 보고** (짧게)
   - 바뀐 것 / 테스트할 버전 번호(화면 상단에서 확인) / 테스트 방법
   - 자동 검증된 것과 실측이 필요한 것을 구분
