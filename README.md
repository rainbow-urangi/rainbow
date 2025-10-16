# 1. 개요

이 크롬 확장은 웹 상호작용을 수집하고, 분석/자동화(=Selenium 재생) 친화 포맷으로 CSV 내보내기까지 담당하는 모듈

* **파일 구성**

  * `manifest.json` : MV3 설정(권한/서비스워커/콘텐츠 스크립트 구독)
  * `content.js` : 페이지 안에서 이벤트 수집(입력, 메뉴 클릭, SPA 라우팅, 페이지뷰)
  * `background.js` : 배치 수신/정규화/콘솔 로그/CSV 내보내기/네트워크 요청 연계

* **핵심 산출물**

  * `az_db_rows_*.csv` : DB 적재/재생용 핵심 스키마(AZ_* 열)
  * (선택) `az_analytics_*.csv` : 세션·경로 분석용 확장 스키마

* **주요 사용처**

  1. 수집된 CSV → **생성기 스크립트**로 **Selenium 실행 스크립트** 생성
  2. 또는 CSV 자체로 분석(메뉴/흐름/반복업무 군집화 등)

---

# 2. 아키텍처 & 데이터 흐름

1. `content.js`

   * 페이지에서 다음을 **비동기 수집**:

     * **입력 최종값**(디바운스 + blur/Enter): `input/change` 최종값만 기록

       * 민감정보 마스킹(비밀번호/패턴 키워드/이메일 일부)
     * **메뉴 클릭**: nav/aside/role=menuitem/aria-label 기반 자동 탐지, 라벨/트레일/식별자 수집
     * **SPA 라우팅**: `history.pushState/replaceState/popstate` 후킹 → `route_change` 이벤트
     * **페이지뷰**: 최초 진입 시 `page_view` 이벤트
   * 큐에 누적 후 **정해진 조건에서 FLUSH**:

     * 주기(기본 5초), 가시성 변경(hidden), **백그라운드가 webRequest 감지 시 요청 직전 FLUSH 트리거**

2. `background.js` (서비스워커)

   * `BATCH_EVENTS` 수신 → **AZ_* 스키마로 정규화** 후 메모리 버퍼 적재
   * **요청 URL 매핑**: 같은 탭에서 최근 감지된 `XMLHttpRequest/fetch/main_frame/beacon` 요청을 배치에 연결(AZ_api_url/method)
   * **콘솔 로그**: 서비스워커 콘솔에서 표(`console.table`)와 단건 로그 확인
   * **CSV 내보내기**:

     * **툴바 아이콘 클릭** 또는 단축키 `Ctrl+Shift+E`(Mac: `⌘+Shift+E`)
     * MV3 SW 제약으로 Blob 대신 **data: URL** 사용하여 파일 다운로드
     * 버퍼 비었을 때는 `az_readme_*.txt` 안내 파일로 응답

3. 외부(선택)

   * CSV → **Selenium 생성기**로 **재생 스크립트** 생성
   * 생성된 러너는 `AZ_USER/AZ_PASSWORD` 환경변수로 마스킹 값(`*****`)을 실제 자격증명으로 치환 후 로그인/재생

---

# 3. 설치 & 실행

## 3.1 확장 설치(개발 환경)

1. `chrome://extensions` → 우측 상단 **Developer mode** ON
2. **Load unpacked** → 이 프로젝트 루트 선택(세 파일이 동일 폴더에 있어야 함)
3. 우측 툴바에서 퍼즐 아이콘(Extensions) → 본 확장 **Pin(고정)**

## 3.2 권한/설정(`manifest.json`)

* **핵심 키**

  * `"manifest_version": 3`
  * `"background": { "service_worker": "background.js" }`
  * `"content_scripts"` : `matches: ["<all_urls>"]`, `run_at: "document_start"`, `all_frames: true`
* **권한**

  * `"permissions": ["storage", "webNavigation", "webRequest", "alarms", "downloads", "tabs"]`
  * `"host_permissions": ["<all_urls>"]`
* **action / commands**

  * `"action": { "default_title": "Export AZ CSV" }`
  * `"commands": { "export-csv": "Ctrl+Shift+E" }`

> 설치 후 **Reload**로 매번 새 코드 반영.


# 4. 수집 스키마 & 규칙

## 4.1 DB 적재/재생용(AZ_* 열)

| 컬럼                   | 설명                                                            
| -------------------- | --------------------------------------------------------------- 
| **AZ_api_url**       | 직전/동일 탭에서 감지된 네트워크 요청 URL(있으면)                  
| **AZ_api_method**    | 요청 메서드(GET/POST 등)                                         
| **AZ_ip_address**    | `(unavailable-in-extension)` 고정(서버에서 채우는 컬럼)           
| **AZ_url**           | 이벤트 발생 화면 URL                                             
| **AZ_login_id**      | 확장 옵션 `loginId`(없으면 `unknown`)                            
| **AZ_event_time**    | `YYYY-MM-DD HH:MM:SS[.mmm...]` (UTC)                            
| **AZ_element_uid**   | 안정 식별자(가능하면 `#id/name/aria/data-testid/href`; 없으면 css/xpath/해시) 
| **AZ_element_type**  | `text/password/textarea/select/menu` 등                          
| **AZ_element_label** | 라벨/캡션/aria/placeholder/인접 셀 등에서 추출                       
| **AZ_data**          | 최종 입력값(비밀번호/PII 마스킹), 또는 메뉴 요약(`href=...                 

> **입력**은 **최종값만** 수집(중간 타이핑 노이즈 제거).
> **비밀번호/민감값**은 `*****`로 마스킹.
> 이메일은 사용자ID/도메인 일부만 보이도록 부분 마스킹.

## 4.2 (선택) 분석용(analytics CSV)

* 시간(ISO/UTC/epoch), 페이지(host/path/title/query), 세션(page_session_id/tab_session_id),
  요소(tag/type/uid/label/href/css/xpath), 메뉴(meta/trail/kind), API(url/method/path), fingerprint 등.

---

# 5. 동작 확인 & 내보내기

## 5.1 수집 확인(서비스워커 콘솔)

* `chrome://extensions` → 본 확장 → **Service worker** → **Inspect views**
* 페이지에서 **입력/메뉴/조회**를 하면 콘솔에 즉시:

  * `[DB ROWS] reason=... count=N`
  * 각 행의 `DB_ROW {...}`
  * (메뉴 클릭 시) `FULL_MENU { ... meta: {label, href, menuTrail, ...} }`

## 5.2 CSV 내보내기

* 방법 1) 툴바 **아이콘 클릭**
* 방법 2) 단축키 **`Ctrl+Shift+E`** (Mac: `⌘+Shift+E`)
* 결과:
  * `az_db_rows_YYYYMMDD_HHMMSS.csv`
  * (옵션) `az_analytics_YYYYMMDD_HHMMSS.csv`


# 8. 코드 개요(파일별)

## 8.1 `manifest.json`

* MV3 설정(서비스워커 `background.js`)
* content script: `<all_urls>` / `document_start` / `all_frames`
* 권한: `storage`, `webRequest`, `webNavigation`, `alarms`, `downloads`, `tabs`
* 액션/커맨드: 아이콘 클릭/단축키로 CSV 내보내기

## 8.2 `content.js`

* **CSS/XPath 생성기**: `CSS.escape` 폴리필, id/name/aria/placeholder 우선
* **라벨 추출**: `<label for>`, `element.labels`, `aria-labelledby`, `placeholder`, 인접 셀, form-group 범위
* **입력 수집**: 디바운스(예: 600ms) + `blur/Enter/change` → **최종값만** `record("change", value)`
* **메뉴 클릭**: nav/role/button/a 등 **선별 셀렉터** + trail/bounds/dataset 등 메타 수집 → 단건 즉시 전송
* **SPA 라우팅**: `history.pushState/replaceState/popstate` 후킹 → `route_change`
* **페이지뷰**: `DOMContentLoaded` 시 `page_view`
* **FLUSH 트리거**: 주기, hidden, background의 **FLUSH_REQUEST** 메시지

## 8.3 `background.js` (서비스워커)

* 이벤트 수신 → **eventToDbRow**로 AZ_* 행 생성(민감 마스킹, URL/UID/type/label/data 정규화)
* **webRequest.onBeforeRequest**로 최근 API 요청을 탭별로 기억 후, **같은 탭/같은 host**에 한해 배치에 기입
* **콘솔 출력**: `console.table` + 단건 JSON(`DB_ROW`) + 메뉴 전체 메타(`FULL_MENU`)
* **CSV 내보내기**:

  * `downloadText()` : **data: URL**로 BOM(`\ufeff`) 포함 CSV 생성
  * 아이콘/단축키 핸들러에서 `exportDbCsv()` 호출
  * 버퍼 비었을 때 `az_readme_*.txt` 생성

