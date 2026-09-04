"""
FastAPI 백엔드 — crew.py 를 감싼 얇은 API 래퍼.
(Skala-career-helper의 api/main.py 구조를 '사업 이전지 추천' 주제로 변환)

실행:
    uvicorn api.main:app --reload --port 8001
"""
from __future__ import annotations

from typing import Any, List, Optional
import logging
import os
import time
import uuid
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()  # relocation_helper/.env 를 프로세스 환경으로 로드 (OPENAI/NCP/소진공 키)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from geo.naver_geocode import geocode, GeocodeError, precision_at_least, PRECISION_MIN_FOR_TRDAR
from geo.sanggwon_join import lookup_trdar, get_trdar_geometry
from data_sources.sosangong import stores_in_radius, SosangongError
from data_sources.seoul_market import lookup_metric, list_industries
import staymove

app = FastAPI(title="상권 이전 컨설팅 API", version="1.0.0")

# 개발 편의를 위한 관대한 CORS (배포 시 도메인 제한 권장)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def warm_runtime_models():
    """Move expensive model/index loading to server startup instead of first analysis request."""
    if os.getenv("WARMUP_MODELS", "true").lower() == "false":
        return
    try:
        from ml.runtime import warmup as warm_ml
        warm_ml()
        logging.info("ML runtime warmup complete")
    except Exception:
        logging.exception("ML warmup failed; lazy loading will be attempted on request")
    try:
        from policy_rag.src.retrieve import _load_runtime
        _load_runtime()
        logging.info("Policy RAG runtime warmup complete")
    except Exception:
        logging.exception("RAG warmup failed; lazy loading will be attempted on request")


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
    return {
        "status": "ok",
        "service": "stay-or-move",
        "demo_mode": os.getenv("DEMO_MODE", "true").lower() != "false",
        "naver_geocode_key": bool(os.getenv("NCP_APIGW_KEY_ID") and os.getenv("NCP_APIGW_KEY")),
        "openai_key": bool(os.getenv("OPENAI_API_KEY")),
        "policy_rag_index": (Path(__file__).resolve().parents[1] / "policy_rag" / "vector_db" / "policy.index").exists(),
        "ml_artifacts": (Path(__file__).resolve().parents[1] / "ml" / "artifacts" / "v2_sales_gbm.joblib").exists(),
        "single_llm_call": True,
    }


# ── Stay or Move: 계산 + 자연어 설명 (핵심 엔드포인트) ──
_ANALYSIS_CACHE: dict[str, tuple[float, dict]] = {}
_ANALYSIS_CACHE_TTL_SECONDS = 600


def _purge_expired_analysis_cache() -> None:
    now = time.time()
    expired = [key for key, (saved_at, _) in _ANALYSIS_CACHE.items() if now - saved_at > _ANALYSIS_CACHE_TTL_SECONDS]
    for key in expired:
        _ANALYSIS_CACHE.pop(key, None)


@app.post("/staymove")
def staymove_endpoint(payload: dict, explain: bool = True, use_rag: bool = True, use_ml: bool = True):
    """현재 매장 + 후보 계약조건 → Rule + ML + 후보별 Policy RAG + 선택적 AI 설명.

    explain=false 이면 외부 LLM API 호출 없이 빠르게 구조화 결과만 반환하고, 이 결과를
    서버 메모리에 잠시 캐시해 `/staymove/explain`이 이어서 AI 설명만 비동기로 붙일 수 있게 한다
    (체감속도 개선을 위한 2단계 호출 — 클라이언트가 계산값을 그대로 되돌려보내 LLM 프롬프트에
    주입하는 방식은 프롬프트 인젝션 표면이 되므로 쓰지 않는다).
    explain=true(기존 단일호출 경로)는 그대로 동작한다.
    """
    try:
        result = staymove.run(payload, explain=explain, use_rag=use_rag, use_ml=use_ml)
        if not explain:
            _purge_expired_analysis_cache()
            analysis_id = uuid.uuid4().hex
            _ANALYSIS_CACHE[analysis_id] = (time.time(), result)
            result = {**result, "analysis_id": analysis_id}
        return result
    except ValueError as e:
        # Rule Engine의 입력값 검증 오류 — 이미 사용자에게 보여줄 수 있는 한국어 문구.
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001
        # 예상하지 못한 오류는 원인을 화면에 노출하지 않고 서버 로그로만 남긴다.
        logging.exception("분석 서버 오류")
        raise HTTPException(status_code=500, detail="분석 서버 연결을 확인해주세요.") from e


class ExplainRequest(BaseModel):
    analysis_id: str


@app.post("/staymove/explain")
def staymove_explain(req: ExplainRequest):
    """1단계(`/staymove?explain=false`)에서 캐시된 계산 결과에 AI 설명만 비동기로 붙인다.

    캐시가 없거나 만료되었으면 410을 반환한다 — 클라이언트가 보낸 값으로 대신 계산하는
    fallback은 두지 않는다(그 fallback 자체가 이 캐시 방식을 쓰는 이유를 무력화한다).
    """
    _purge_expired_analysis_cache()
    cached = _ANALYSIS_CACHE.get(req.analysis_id)
    if not cached:
        raise HTTPException(status_code=410, detail="분석 결과가 만료되었습니다. 다시 분석해주세요.")
    _, facts = cached
    try:
        batch, llm_seconds = staymove.explain_facts(facts)
    except Exception as e:  # noqa: BLE001
        logging.exception("AI 설명 생성 실패")
        raise HTTPException(status_code=500, detail="AI 설명을 생성하지 못했습니다.") from e
    return {
        "candidates": [
            {"site_id": site_id, "ai_explanation": explanation}
            for site_id, explanation in batch["explanations"].items()
        ],
        "comparison_summary": batch["comparison_text"] or None,
        "overall": batch["overall"],
        "performance": {
            "llm_seconds": round(llm_seconds, 3),
            "llm_calls": 1,
            **(batch.get("performance_extra") or {}),
        },
    }


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


DEMO_LOCATIONS = {
    "current": {"address": "서울 마포구 양화로 33", "lat": 37.54934177, "lng": 126.9129994},
    "A": {"address": "서울 마포구 망원로 50", "lat": 37.5567129, "lng": 126.9024385},
    "B": {"address": "서울 마포구 월드컵로13길 18", "lat": 37.55569902707, "lng": 126.90918875592},
    "C": {"address": "서울 마포구 동교로 162", "lat": 37.5556279, "lng": 126.9199317},
}


def _area_payload(*, address: str, lat: float, lng: float, road_address: Optional[str] = None,
                  precision: str = "point"):
    """좌표 → 상권 + 그 좌표가 상권을 특정할 만큼 정확한 주소에서 나왔는지.

    precision 기본값이 "point" 인 것은 지도 클릭처럼 주소를 거치지 않은 호출 때문이다.
    그 경우 좌표 자체가 사용자가 찍은 지점이라 주소 단위를 따질 필요가 없다.
    """
    match = lookup_trdar(lat, lng)
    return {
        "address": address,
        "road_address": road_address or address,
        "lat": lat,
        "lng": lng,
        "precision": precision,
        # 상권 지표를 이 주소의 것으로 읽어도 되는지. 구·동 단위면 False.
        "trdar_reliable": precision == "point" or precision_at_least(precision),
        "precision_required": PRECISION_MIN_FOR_TRDAR,
        "matched": match.matched,
        "trdar_cd": match.trdar_cd,
        "trdar_nm": match.trdar_nm,
        "distance_m": match.distance_m,
        "note": match.note,
        "boundary": get_trdar_geometry(match.trdar_cd) if match.trdar_cd else None,
    }


@app.get("/demo-locations")
def demo_locations():
    """NAVER Geocoding 없이 데모 주소 4곳의 좌표/상권을 반환."""
    rows = []
    for site_id, loc in DEMO_LOCATIONS.items():
        rows.append({"site_id": site_id, **_area_payload(address=loc["address"], lat=loc["lat"], lng=loc["lng"])})
    return rows


class CommercialAreaPointRequest(BaseModel):
    lat: float
    lng: float


@app.post("/commercial-area/by-point")
def commercial_area_by_point(req: CommercialAreaPointRequest):
    """지도 클릭 좌표 → 서울시 상권코드. NAVER Geocoding 키가 없어도 동작."""
    return _area_payload(address="지도 선택 위치", lat=req.lat, lng=req.lng)


class CommercialAreaRequest(BaseModel):
    address: str


@app.post("/commercial-area")
def commercial_area(req: CommercialAreaRequest):
    """주소 → NAVER 좌표 → 서울시 상권코드(TRDAR_CD).

    data/sanggwon.geojson 이 준비된 뒤 실제 동작한다.
    """
    try:
        point = geocode(req.address)
        return _area_payload(address=req.address, road_address=point.road_address,
                             lat=point.lat, lng=point.lng, precision=point.precision)
    except GeocodeError as e:
        # 데모 주소는 REST Geocoding 키가 없어도 재현 가능하게 로컬 좌표로 폴백.
        normalized = " ".join(req.address.split())
        for loc in DEMO_LOCATIONS.values():
            if normalized == " ".join(loc["address"].split()):
                return {**_area_payload(address=loc["address"], lat=loc["lat"], lng=loc["lng"]), "demo_fallback": True}
        # 원인을 나눠야 한다. 키가 없어 실패한 걸 400 으로 내리면 프론트가 "주소를 찾지
        # 못했어요"라고 말하고, .env 가 없는 팀원은 멀쩡한 주소를 계속 고치게 된다.
        # 400 은 사용자가 고칠 수 있을 때만 쓴다. 서버 문제는 5xx 로 알리고,
        # 프론트는 5xx 면 주소 검증을 건너뛰어 진행을 막지 않는다.
        if getattr(e, "kind", "address") == "address":
            logging.warning("주소를 찾지 못했습니다: %s", e)
            raise HTTPException(status_code=400, detail="주소를 다시 확인해주세요.") from e
        logging.error("지오코딩을 쓸 수 없습니다(%s): %s", getattr(e, "kind", "?"), e)
        raise HTTPException(
            status_code=503,
            detail="주소 조회 서비스를 쓸 수 없어요. 서버의 NAVER 지도 키(.env) 설정을 확인해 주세요.",
        ) from e
    except FileNotFoundError as e:
        logging.warning("상권 데이터 파일 없음: %s", e)
        raise HTTPException(status_code=503, detail="상권 데이터를 불러오지 못했습니다.") from e


# ── 서울시 상권 근거 (로컬 전처리 DB) ──
class MarketContextRequest(BaseModel):
    trdar_codes: List[str] = Field(..., min_length=1, max_length=8)
    industry_code: str = "CS100010"


@app.get("/industries")
def industries():
    try:
        return list_industries()
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.post("/market-context")
def market_context(req: MarketContextRequest):
    out = []
    try:
        for code in req.trdar_codes:
            m = lookup_metric(code, req.industry_code)
            out.append({"trdar_cd": str(code), "matched": m is not None, "metric": m.to_dict() if m else None})
        return out
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


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
        from crew import RelocationCrew
        result = RelocationCrew().run_single(req.model_dump())
        return _to_response(req, result)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"분석 중 오류: {e}") from e


@app.post("/relocate/batch", response_model=List[RelocateResponse])
def relocate_batch(reqs: List[RelocateRequest]):
    """여러 사업자 일괄 분석."""
    try:
        from crew import RelocationCrew
        results = RelocationCrew().run_batch([r.model_dump() for r in reqs])
        return [_to_response(req, res) for req, res in zip(reqs, results)]
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"배치 분석 중 오류: {e}") from e
