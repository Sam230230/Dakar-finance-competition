# 백엔드(FastAPI) 이미지.
#
# 크기를 좌우하는 두 가지를 여기서 못박는다.
#   1. torch 는 기본 인덱스에서 받으면 CUDA 빌드(2GB 이상)가 온다. CPU 휠을 명시한다.
#   2. 임베딩 모델(458MB)을 빌드 때 굽는다. 안 그러면 첫 요청이 그걸 내려받고,
#      Render 디스크는 휘발성이라 재시작마다 다시 받는다.
FROM python:3.11-slim

# lightgbm 이 libgomp 를 필요로 한다. 나머지는 휠로 해결된다.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf

COPY requirements.txt ./

# CPU 전용 torch 를 먼저 깔아 둔다. 뒤이어 오는 sentence-transformers 가
# 이미 설치된 걸 보고 CUDA 빌드를 다시 끌어오지 않는다.
RUN pip install --upgrade pip \
 && pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install -r requirements.txt

# 임베딩 모델을 이미지에 포함. policy_rag 인덱스가 이 모델로 만들어져 있어
# 다른 모델을 쓰면 벡터 공간이 어긋나 검색이 조용히 망가진다.
ARG EMBEDDING_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${EMBEDDING_MODEL}')"

COPY . .

# Render 는 $PORT 를 주입한다. 로컬에서 그냥 실행할 때를 위해 기본값을 둔다.
ENV PORT=8000
EXPOSE 8000

# 워커 1개로 둔다. 워밍업된 모델이 프로세스마다 225MB 를 차지하므로,
# 워커를 늘리려면 메모리도 그만큼 올려야 한다.
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
