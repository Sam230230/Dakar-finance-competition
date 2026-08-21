"""
FastAPI 백엔드 — crew.py 를 감싼 얇은 API 래퍼.
(Skala-career-helper의 api/main.py 구조를 '사업 이전지 추천' 주제로 변환)

실행:
    uvicorn api.main:app --reload --port 8001
"""
from __future__ import annotations

from typing import Any, List, Optional

from dotenv import load_dotenv
load_dotenv()  # relocation_helper/.env 를 프로세스 환경으로 로드 (OPENAI/NCP/소진공 키)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from crew import RelocationCrew
from geo.naver_geocode import geocode, GeocodeError
from data_sources.sosangong import stores_in_radius, SosangongError
import staymove

app = FastAPI(title="상권 이전 컨설팅 API", version="1.0.0")

# 개발 편의를 위한 관대한 CORS (배포 시 도메인 제한 권장)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================================
#  요청 / 응답 모델
# =====================================================================
class CandidateSiteDTO(BaseModel):
    site_id: str = Field(..., examples=["A"])
    name: str = Field(..., examples=["성수동 카페거리 1층"])
    note: str = Field("", examples=["임대료 높음, 권리금 있음, 15평"])


class RelocateRequest(BaseModel):
    business_id: str = Field("biz-tmp", description="사업자 식별자")
    business_name: str
    industry: str
    current_site: str = Field(..., description="현재 사업지")
    relocation_reason: str
    candidate_sites: List[CandidateSiteDTO] = Field(..., min_length=1, max_length=5,
                                                    description="이전 후보지 (기본 3곳)")
    priorities: str = ""
    budget: str = ""


class RelocateResponse(BaseModel):
    business_id: str
    business_name: str
    # 핵심 출력: 자연어 상담 리포트
    report_markdown: str
    # 부가: 단계별 구조화 결과(프론트에서 뱃지/카드로 쓸 수 있음)
    profile: Optional[dict] = None
    sites: Optional[dict] = None
    fit_review: Optional[dict] = None


# =====================================================================
#  Crew 출력 → 응답 변환 헬퍼
# =====================================================================
def _pydantic_of(task_output: Any) -> Optional[dict]:
    """태스크 출력에서 Pydantic/JSON 구조를 최대한 dict 로 뽑아낸다."""
    if task_output is None:
        return None
    obj = getattr(task_output, "pydantic", None)
    if obj is not None:
        return obj.model_dump()
    data = getattr(task_output, "json_dict", None)
    if data:
        return data
    return None


def _to_response(req: RelocateRequest, crew_result: Any) -> RelocateResponse:
    """CrewOutput 을 RelocateResponse 로 변환. task 순서: 0 프로필 / 1 후보지 / 2 적합도 / 3 리포트."""
    tasks = getattr(crew_result, "tasks_output", []) or []

    def at(i):
        return tasks[i] if i < len(tasks) else None

    report_md = str(getattr(crew_result, "raw", crew_result))

    return RelocateResponse(
        business_id=req.business_id,
        business_name=req.business_name,
        report_markdown=report_md,
        profile=_pydantic_of(at(0)),
        sites=_pydantic_of(at(1)),
        fit_review=_pydantic_of(at(2)),
    )


# =====================================================================
#  엔드포인트
# =====================================================================
@app.get("/health")
def health():
    return {"status": "ok", "service": "relocation-consulting"}


# ── Stay or Move: 계산 + 자연어 설명 (핵심 엔드포인트) ──
@app.post("/staymove")
def staymove_endpoint(payload: dict, explain: bool = True):
    """현재 매장 + 후보 계약조건 → 경제성 계산·순위 + (explain=true 시) AI 자연어 설명.
    explain=false 로 호출하면 LLM 없이 숫자만 빠르게 반환."""
    try:
        return staymove.run(payload, explain=explain)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"분석 실패: {e}") from e


# ── 주소 → 좌표 (NAVER Geocoding) ──
class GeocodeRequest(BaseModel):
    addresses: List[str] = Field(..., description="현재+후보 주소 목록", min_length=1)


class GeoPointDTO(BaseModel):
    address: str
    matched: bool
    lat: Optional[float] = None
    lng: Optional[float] = None
    road_address: Optional[str] = None
    error: Optional[str] = None


@app.post("/geocode", response_model=List[GeoPointDTO])
def geocode_addresses(req: GeocodeRequest):
    """여러 주소를 한 번에 좌표로 변환. 실패한 주소는 matched=false 로 개별 반환(전체 실패 아님)."""
    out: List[GeoPointDTO] = []
    for addr in req.addresses:
        try:
            p = geocode(addr)
            out.append(GeoPointDTO(address=addr, matched=True, lat=p.lat, lng=p.lng,
                                   road_address=p.road_address))
        except GeocodeError as e:
            out.append(GeoPointDTO(address=addr, matched=False, error=str(e)))
    return out


# ── 반경 경쟁점포 (소진공) — 결과 지도 근거용 ──
class CompetitorRequest(BaseModel):
    lat: float
    lng: float
    radius_m: int = Field(300, ge=50, le=1000)
    inds_scls_cd: Optional[str] = Field(None, description="업종 소분류코드(예: 커피전문점). 없으면 전체 업종")


class CompetitorResponse(BaseModel):
    total_count: int
    stores: List[dict]  # {name, lat, lng, inds_small}


@app.post("/competitors", response_model=CompetitorResponse)
def competitors(req: CompetitorRequest):
    """후보 좌표 반경 내 (동종)업소 조회. 지도에 점으로 찍고 카운트를 근거로 사용."""
    try:
        res = stores_in_radius(req.lat, req.lng, req.radius_m, inds_scls_cd=req.inds_scls_cd)
    except SosangongError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return CompetitorResponse(
        total_count=res.total_count,
        stores=[{"name": s.name, "lat": s.lat, "lng": s.lng, "inds_small": s.inds_small}
                for s in res.stores if s.lat and s.lng],
    )


@app.post("/relocate", response_model=RelocateResponse)
def relocate(req: RelocateRequest):
    """이전 후보지 1건 분석 (동기, 수십 초 소요 가능)."""
    try:
        result = RelocationCrew().run_single(req.model_dump())
        return _to_response(req, result)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"분석 중 오류: {e}") from e


@app.post("/relocate/batch", response_model=List[RelocateResponse])
def relocate_batch(reqs: List[RelocateRequest]):
    """여러 사업자 일괄 분석."""
    try:
        results = RelocationCrew().run_batch([r.model_dump() for r in reqs])
        return [_to_response(req, res) for req, res in zip(reqs, results)]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"배치 분석 중 오류: {e}") from e
