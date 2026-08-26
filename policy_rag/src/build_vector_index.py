from __future__ import annotations

import json
import os

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

from common import PROCESSED_DIR, VECTOR_DIR, read_jsonl

def build_index():
    chunks = read_jsonl(PROCESSED_DIR / "chunks.jsonl")
    if not chunks:
        raise RuntimeError("chunks.jsonl이 없습니다. build_corpus.py를 먼저 실행하세요.")

    model_name = os.getenv(
        "EMBEDDING_MODEL",
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    )
    print(f"[Embedding 모델] {model_name}")
    model = SentenceTransformer(model_name)

    texts = [row["text"] for row in chunks]
    embeddings = model.encode(
        texts,
        batch_size=32,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,
    ).astype("float32")

    index = faiss.IndexFlatIP(embeddings.shape[1])
    index.add(embeddings)

    index_path = VECTOR_DIR / "policy.index"
    faiss.write_index(index, str(index_path))

    metadata_path = VECTOR_DIR / "metadata.json"
    with metadata_path.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "embedding_model": model_name,
                "chunks": chunks,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"[Vector Index 생성 완료] {index.ntotal} vectors")
    print(f"- {index_path}")
    print(f"- {metadata_path}")
    return index_path

if __name__ == "__main__":
    build_index()
