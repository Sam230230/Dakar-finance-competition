import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import {
  ArrowUpRight,
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleAlert,
  Coins,
  HandCoins,
  Landmark,
  MapPin,
  Percent,
  Scale,
  UserCheck,
  Wallet,
} from "lucide-react";
import { policies, policyDistrict, additionalFundNeeded } from "./policyData.js";
import "./concepts.css";
import "./policy-concepts.css";

const ICON = { size: 15, strokeWidth: 2.2, "aria-hidden": true };
const money = (value) => Number(value).toLocaleString("ko-KR");

/* ── 시안 1. 요약 우선 카드 ──────────────────────────────────
   판단에 필요한 한도와 금리를 카드에서 가장 큰 글자로 올리고,
   대상과 업력 같은 확인용 정보는 접어 둔다 (Overview → Focus → Detail). */
function SummaryFirstCard({ policy }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="pc-a-card">
      <header>
        <span className="pc-a-type"><HandCoins {...ICON} />{policy.supportType}</span>
        <h3>{policy.name}</h3>
        <p className="pc-a-group">{policy.group}</p>
      </header>

      <div className="pc-a-figures">
        <div>
          <dt><Coins {...ICON} />지원한도</dt>
          <dd>{policy.amountLimit}</dd>
          <small>{policy.amountDetail}</small>
        </div>
        <div>
          <dt><Percent {...ICON} />금리</dt>
          <dd>{policy.interestRate}</dd>
          <small>{policy.interestDetail}</small>
        </div>
      </div>

      <p className="pc-a-target">{policy.target}</p>

      <button type="button" className="pc-a-more" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown {...ICON} className={open ? "is-open" : ""} />
        {open ? "접기" : "기관과 조건 더 보기"}
      </button>
      {open && (
        <dl className="pc-a-detail">
          <div><dt><Building2 {...ICON} />수행기관</dt><dd>{policy.agency}</dd></div>
          <div><dt><Wallet {...ICON} />자금용도</dt><dd>{policy.fundUse}</dd></div>
          <div><dt><CalendarDays {...ICON} />업력</dt><dd>{policy.businessAge}</dd></div>
          <div><dt><MapPin {...ICON} />지역</dt><dd>{policy.regionScope}</dd></div>
        </dl>
      )}

      <footer>
        <span className={policy.eligibilityNeedsCheck ? "is-check" : "is-ready"}>
          {policy.eligibilityNeedsCheck ? <CircleAlert {...ICON} /> : <BadgeCheck {...ICON} />}
          {policy.eligibilityNote}
        </span>
        <a href={policy.url} target="_blank" rel="noreferrer" aria-label={`${policy.name} 공식 공고 열기`}>
          공식 공고 <ArrowUpRight {...ICON} />
        </a>
      </footer>
    </article>
  );
}

function ConceptA() {
  return (
    <section className="pc-section" aria-labelledby="pc-a-title">
      <div className="pc-section-head">
        <div>
          <p className="cc-kicker">시안 1</p>
          <h2 id="pc-a-title">요약 우선 카드</h2>
          <p className="pc-lead">
            한도와 금리를 카드에서 가장 큰 글자로 올리고, 기관과 업력처럼 확인용 정보는 접어 둬요.
            첫 화면에서 읽을 줄이 절반으로 줄어요.
          </p>
        </div>
        <p className="pc-status">
          <CalendarClock {...ICON} />세 건 모두 예산 소진 여부 확인 필요
        </p>
      </div>
      <div className="pc-a-list">
        {policies.map((policy) => <SummaryFirstCard key={policy.id} policy={policy} />)}
      </div>
    </section>
  );
}

/* ── 시안 2. 비교 목록과 상세 ────────────────────────────────
   3건을 같은 축에 세워 한 화면에서 비교하고, 고른 한 건만 상세를 편다.
   결과지가 비교하고 결정하는 화면이라는 역할에 맞춘 구조다. */
function ConceptB() {
  const [picked, setPicked] = useState(policies[0].id);
  const active = policies.find((policy) => policy.id === picked);

  return (
    <section className="pc-section" aria-labelledby="pc-b-title">
      <div className="pc-section-head">
        <div>
          <p className="cc-kicker">시안 2</p>
          <h2 id="pc-b-title">비교 목록과 상세</h2>
          <p className="pc-lead">
            세 건을 같은 축에 세워 한도와 금리를 바로 견주고, 고른 한 건만 아래에서 자세히 봐요.
            건수가 늘어도 화면이 길어지지 않아요.
          </p>
        </div>
        <p className="pc-status">
          <CalendarClock {...ICON} />세 건 모두 예산 소진 여부 확인 필요
        </p>
      </div>

      <div className="pc-b-table" role="list">
        <div className="pc-b-head" aria-hidden="true">
          <span>정책명</span><span>지원한도</span><span>금리</span><span>자격</span><span />
        </div>
        {policies.map((policy) => (
          <button
            type="button"
            role="listitem"
            key={policy.id}
            className={`pc-b-row${policy.id === picked ? " is-picked" : ""}`}
            aria-pressed={policy.id === picked}
            onClick={() => setPicked(policy.id)}
          >
            <span className="pc-b-name">
              <strong>{policy.name}</strong>
              <em><HandCoins {...ICON} />{policy.supportType}</em>
            </span>
            <span className="pc-b-num">{policy.amountLimit}</span>
            <span className="pc-b-num">{policy.interestRate}</span>
            <span className={`pc-b-flag${policy.eligibilityNeedsCheck ? " is-check" : ""}`}>
              {policy.eligibilityNeedsCheck ? <CircleAlert {...ICON} /> : <BadgeCheck {...ICON} />}
              {policy.eligibilityNeedsCheck ? "추가 확인" : "요건 충족"}
            </span>
            <span className="pc-b-mark" aria-hidden="true" />
          </button>
        ))}
      </div>

      <article className="pc-b-detail" aria-live="polite">
        <header>
          <div>
            <p className="pc-b-group">{active.group}</p>
            <h3>{active.name}</h3>
          </div>
          <a href={active.url} target="_blank" rel="noreferrer" aria-label={`${active.name} 공식 공고 열기`}>
            공식 공고 <ArrowUpRight {...ICON} />
          </a>
        </header>
        <p className="pc-b-target"><UserCheck {...ICON} />{active.target}</p>
        <dl className="pc-b-facts">
          <div><dt><Building2 {...ICON} />수행기관</dt><dd>{active.agency}</dd></div>
          <div><dt><Wallet {...ICON} />자금용도</dt><dd>{active.fundUse}</dd></div>
          <div><dt><Coins {...ICON} />한도 세부</dt><dd>{active.amountDetail}</dd></div>
          <div><dt><Percent {...ICON} />금리 조건</dt><dd>{active.interestDetail}</dd></div>
          <div><dt><CalendarDays {...ICON} />업력</dt><dd>{active.businessAge}</dd></div>
          <div><dt><MapPin {...ICON} />지역</dt><dd>{active.regionScope}</dd></div>
        </dl>
      </article>
    </section>
  );
}

/** ?only=a 또는 ?only=b 로 한 시안만 렌더한다. 시안 이미지를 뽑을 때 쓴다. */
const only = new URLSearchParams(window.location.search).get("only");

function PolicyConcepts() {
  return (
    <main className="cc-page pc-page">
      <header className="cc-topbar">
        <strong className="cc-brand">stay or move</strong><span>정책금융 카드 재구성 시안</span>
      </header>
      <div className="cc-shell">
        <div className="cc-heading">
          <div>
            <p className="cc-kicker">정책금융 섹션</p>
            <h1>{policyDistrict}에서 확인할 정책금융</h1>
          </div>
          <p>추가 필요 이전자금 {money(additionalFundNeeded)}만원과 {policyDistrict} 기준 최대 3건</p>
        </div>

        <p className="pc-priority"><Landmark {...ICON} />추가 자금 필요성이 커 정책금융 활용 우선도가 높아요.</p>

        {only !== "b" && <ConceptA />}
        {only !== "a" && <ConceptB />}

        <div className="pc-disclaimer">
          <p><Scale {...ICON} />정책지원 후보가 검색되어도 지원금을 확보한 것으로 계산하지 않아요. 실제 지원 여부는 해당 기관 심사로 정해져요.</p>
          <p>지원한도와 금리는 공고상 조건이며 실제 승인액과 다를 수 있어요.</p>
          <p className="pc-source">출처: 기업마당과 각 기관 공식 공고, RAG 검색 결과</p>
        </div>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode><PolicyConcepts /></React.StrictMode>
);
