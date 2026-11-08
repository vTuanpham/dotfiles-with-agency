import hashlib
import io

import pytest

from agent_models import semantic


def test_model_download_is_verified_and_reused(tmp_path, monkeypatch):
    content = b"verified model bytes"
    digest = hashlib.sha256(content).hexdigest()
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.setattr(semantic, "FILES", {"model.onnx": ("model.onnx", digest)})
    calls = []

    def fetch(request, timeout):
        calls.append(request.full_url)
        return io.BytesIO(content)

    monkeypatch.setattr(semantic, "urlopen", fetch)
    root = semantic.model_files()
    assert (root / "model.onnx").read_bytes() == content
    assert semantic.model_files() == root and len(calls) == 1
    (root / "model.onnx").write_bytes(b"corrupt")
    assert semantic.model_files() == root and len(calls) == 2


def test_unverified_model_download_is_not_cached(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.setattr(semantic, "FILES", {"model.onnx": ("model.onnx", "0" * 64)})
    monkeypatch.setattr(semantic, "urlopen", lambda *args, **kwargs: io.BytesIO(b"bad"))
    with pytest.raises(ValueError, match="integrity"):
        semantic.model_files()
    assert not list(tmp_path.rglob("model.onnx"))


def test_optional_supplement_never_downloads_a_missing_model(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.setattr(semantic, "urlopen", lambda *args, **kwargs: pytest.fail("unexpected download"))
    with pytest.raises(ValueError, match="not cached"):
        semantic.model_files(download=False)
