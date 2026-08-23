"""
연결 확인용 스모크 테스트.
- OPENAI_API_KEY 로드 여부, crew import, 목 입력 변환까지만 빠르게 점검한다.
- 실제 LLM 호출(비용 발생) 없이 파이프라인 배선이 맞는지 확인.
실행: python smoke_test.py
"""
import os

from crew import RelocationCrew, RelocationInput, MOCK_BUSINESSES


def main():
    print("1) 환경 변수 점검")
    print("   OPENAI_API_KEY:", "설정됨" if os.getenv("OPENAI_API_KEY") else "없음(실행 시 필요)")
    print("   SERPER_API_KEY:", "설정됨(웹검색 사용)" if os.getenv("SERPER_API_KEY") else "없음(검색 비활성)")

    print("\n2) 입력 스키마 검증")
    data = RelocationInput(**MOCK_BUSINESSES[0])
    print(f"   OK — 후보지 {len(data.candidate_sites)}곳 파싱됨: "
          f"{[c.site_id for c in data.candidate_sites]}")

    print("\n3) 프롬프트 입력 변환")
    inputs = RelocationCrew._to_inputs(MOCK_BUSINESSES[0])
    print("   후보지 블록:\n" + "\n".join("     " + l for l in inputs["candidate_sites_block"].split("\n")))

    print("\n✅ 배선 정상. 실제 분석은 `python crew.py` 또는 API `/relocate` 로 실행하세요.")


if __name__ == "__main__":
    main()
