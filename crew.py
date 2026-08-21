"""
상권 이전(移轉) 컨설팅 Crew
- Skala-career-helper의 CrewAI 4-에이전트 순차 구조를 '사업 이전지 추천' 주제로 변환.
- 입력: 현재 사업지 + 이전 후보 3곳
- 출력: 자연어 상담 리포트(마크다운) + 단계별 Pydantic 구조화 결과

실행:
    from crew import RelocationCrew
    result = RelocationCrew().run_single({...})
"""
from __future__ import annotations

import os
from typing import List, Optional

from pydantic import BaseModel, Field

from crewai import Agent, Crew, Process, Task
from crewai.project import CrewBase, agent, task, crew

# 웹 검색 툴은 SERPER_API_KEY 가 있을 때만 붙인다(선택).
try:
    from crewai_tools import SerperDevTool, ScrapeWebsiteTool
    _HAS_SEARCH = bool(os.getenv("SERPER_API_KEY"))
except Exception:  # 패키지 미설치 시에도 동작하도록
    _HAS_SEARCH = False


# =====================================================================
#  입력 스키마 (프론트/백엔드가 보내는 형태)
# =====================================================================
class CandidateSite(BaseModel):
    """이전 후보지 1곳."""
    site_id: str = Field(..., description="후보 식별자: 'A' / 'B' / 'C'")
    name: str = Field(..., description="후보지 이름 또는 주소 (예: '성수동 카페거리 1층')")
    note: str = Field("", description="사용자 메모: 임대료·평수·권리금 등 아는 정보")


class RelocationInput(BaseModel):
    """이전 컨설팅 1건의 입력."""
    business_id: str
    business_name: str
    industry: str = Field(..., description="업종 (예: '개인 카페', '분식 배달전문')")
    current_site: str = Field(..., description="현재 사업지 주소/설명")
    relocation_reason: str = Field(..., description="이전을 고려하는 이유")
    candidate_sites: List[CandidateSite] = Field(..., description="이전 후보지 3곳")
    priorities: str = Field("", description="우선순위(선택): 예 '임대료 절감 > 유동인구'")
    budget: str = Field("", description="예산/임대 조건(선택)")


# =====================================================================
#  출력 스키마 (각 에이전트가 반환하는 구조화 결과)
# =====================================================================
class BusinessProfile(BaseModel):
    """1단계 결과 — 현재 사업 정체성과 새 입지 필수 조건."""
    one_line: str = Field(..., description="이 사업을 한 줄로 정의")
    industry: str
    target_customer: str = Field(..., description="핵심 고객층")
    current_site_summary: str = Field(..., description="현재 상권 특성 요약")
    relocation_drivers: List[str] = Field(..., description="이전을 유발한 진짜 요인들")
    must_haves: List[str] = Field(..., description="새 입지가 반드시 갖춰야 할 조건")
    risk_sensitivities: List[str] = Field(..., description="감수 불가한 리스크")


class SiteEvaluation(BaseModel):
    """후보지 1곳의 정성 평가."""
    site_id: str
    name: str
    foot_traffic: str = Field(..., description="유동인구 성격")
    rent_level: str = Field(..., description="임대료 수준(높음/보통/낮음 + 근거)")
    competition: str = Field(..., description="경쟁 강도")
    accessibility: str = Field(..., description="접근성(교통/주차/가시성)")
    customer_match: str = Field(..., description="타깃 고객 적합성")
    evidence: List[str] = Field(default_factory=list, description="근거/출처 요지")


class CandidateSitesReport(BaseModel):
    """2단계 결과 — 후보 3곳 비교 분석."""
    sites: List[SiteEvaluation]
    market_commentary: str = Field(..., description="후보지 전반에 대한 총평")


class RankedSite(BaseModel):
    """채점된 후보지."""
    site_id: str
    name: str
    total_score: int = Field(..., ge=0, le=100)
    score_breakdown: dict = Field(
        ..., description="배점표 항목별 점수 (고객적합성/수익성/리스크/접근성)"
    )
    strengths: List[str]
    risks: List[str]


class RelocationFitReview(BaseModel):
    """3단계 결과 — 순위·추천."""
    ranking: List[RankedSite] = Field(..., description="점수 높은 순")
    recommended_site_id: str
    decision: str = Field(..., description="immediate / conditional / reconsider")
    key_rationale: str = Field(..., description="추천 핵심 근거")


# =====================================================================
#  Crew 정의 (4 에이전트 · 4 태스크 · 순차 처리)
# =====================================================================
@CrewBase
class RelocationCrew:
    """사업 이전지 추천 컨설팅 크루."""

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    def _llm(self) -> str:
        # litellm 규약: OpenAI 모델명. .env 로 교체 가능.
        return os.getenv("OPENAI_MODEL_NAME", "gpt-4o-mini")

    def _search_tools(self):
        return [SerperDevTool(), ScrapeWebsiteTool()] if _HAS_SEARCH else []

    # ---- 에이전트 ----
    @agent
    def site_analyst(self) -> Agent:
        return Agent(config=self.agents_config["site_analyst"], llm=self._llm(), verbose=True)

    @agent
    def location_scout(self) -> Agent:
        return Agent(
            config=self.agents_config["location_scout"],
            llm=self._llm(),
            tools=self._search_tools(),  # 검색 툴은 조건부
            verbose=True,
        )

    @agent
    def fit_evaluator(self) -> Agent:
        return Agent(config=self.agents_config["fit_evaluator"], llm=self._llm(), verbose=True)

    @agent
    def consulting_reporter(self) -> Agent:
        return Agent(config=self.agents_config["consulting_reporter"], llm=self._llm(), verbose=True)

    # ---- 태스크 (output_pydantic 로 스키마 강제) ----
    @task
    def analyze_business_task(self) -> Task:
        return Task(config=self.tasks_config["analyze_business_task"], output_pydantic=BusinessProfile)

    @task
    def analyze_sites_task(self) -> Task:
        return Task(config=self.tasks_config["analyze_sites_task"], output_pydantic=CandidateSitesReport)

    @task
    def evaluate_fit_task(self) -> Task:
        return Task(config=self.tasks_config["evaluate_fit_task"], output_pydantic=RelocationFitReview)

    @task
    def build_report_task(self) -> Task:
        # 최종 리포트는 자연어 → 마크다운 파일. Pydantic 강제 안 함.
        return Task(config=self.tasks_config["build_report_task"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,  # 앞 결과를 다음 단계 context 로 전달
            memory=False,
            verbose=True,
        )

    # =================================================================
    #  실행 헬퍼
    # =================================================================
    @staticmethod
    def _to_inputs(raw: dict) -> dict:
        """RelocationInput 검증 후, tasks.yaml 의 {플레이스홀더}에 맞는 dict 로 변환."""
        data = RelocationInput(**raw)

        # 후보지 3곳을 프롬프트용 텍스트 블록으로 렌더링
        lines = []
        for s in data.candidate_sites:
            note = f" | 메모: {s.note}" if s.note else ""
            lines.append(f"- [{s.site_id}] {s.name}{note}")
        candidate_sites_block = "\n".join(lines)

        return {
            "business_id": data.business_id,
            "business_name": data.business_name,
            "industry": data.industry,
            "current_site": data.current_site,
            "relocation_reason": data.relocation_reason,
            "priorities": data.priorities or "명시 안 함",
            "budget": data.budget or "명시 안 함",
            "candidate_sites_block": candidate_sites_block,
        }

    def run_single(self, raw: dict):
        """이전 컨설팅 1건 실행."""
        inputs = self._to_inputs(raw)
        return self.crew().kickoff(inputs=inputs)

    def run_batch(self, raw_list: List[dict]):
        """여러 사업자를 한 번에 실행 (프롬프트는 1인 기준 유지)."""
        inputs_list = [self._to_inputs(r) for r in raw_list]
        return self.crew().kickoff_for_each(inputs=inputs_list)


# 로컬 목(mock) 데이터 — 스모크 테스트용
MOCK_BUSINESSES = [
    {
        "business_id": "biz-001",
        "business_name": "아무개 커피",
        "industry": "개인 카페 (체류형, 20~30대 대상)",
        "current_site": "서울 관악구 대학가 이면도로 2층, 25평",
        "relocation_reason": "건물 재계약 시 임대료 30% 인상 통보, 2층이라 가시성 낮음",
        "candidate_sites": [
            {"site_id": "A", "name": "성수동 카페거리 1층", "note": "임대료 높음, 권리금 있음, 15평"},
            {"site_id": "B", "name": "망원동 주택가 코너 1층", "note": "임대료 보통, 주차 어려움, 20평"},
            {"site_id": "C", "name": "여의도 오피스가 지하1층", "note": "임대료 보통, 주말 공동화 우려, 30평"},
        ],
        "priorities": "가시성 확보 > 임대료 안정 > 넓은 평수",
        "budget": "보증금 5천 / 월세 250만 이내 희망",
    },
]


if __name__ == "__main__":
    # python crew.py  →  목 데이터 1건으로 전체 파이프라인 실행
    result = RelocationCrew().run_single(MOCK_BUSINESSES[0])
    print("\n" + "=" * 60 + "\n최종 리포트\n" + "=" * 60)
    print(result)
