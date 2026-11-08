"""Local semantic fallback for tasks without lexical cues."""

import hashlib
import json
import os
import tempfile
from pathlib import Path
from urllib.request import Request, urlopen

REVISION = "cb3d680149bf9a3209564e1b27ab3bb355b65707"
FILES = {
    "model_quantized.onnx": ("onnx/model_quantized.onnx",
        "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1"),
    "tokenizer.json": ("tokenizer.json",
        "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0"),
}
EXAMPLES = {
    "debugging": ["Investigate the cause of incorrect behavior or a malfunction.",
                  "Two people saving at once overwrite each other's changes."],
    "coding": ["Implement or change software source code and verify it with tests."],
    "backend": ["Develop server-side software, network services and databases."],
    "design": ["Improve the appearance, usability, layout and interaction of a user interface."],
    "browser": ["Navigate, inspect and interact with a website or application in a web browser."],
    "vision": ["Interpret and compare the visual contents of images, video or screenshots."],
    "research": ["Find, evaluate and synthesize reliable sources and scientific studies."],
    "writing": ["Compose, rewrite, proofread or improve prose and written text."],
    "documents": ["Read, analyze or produce documents, reports, papers and PDFs."],
    "long-context": ["Reason across a large amount of input or many files requiring long context."],
    "data": ["Analyze datasets, tables, statistics, measurements and spreadsheets."],
    "performance": ["Improve speed, memory efficiency, throughput or causes of slow execution."],
    "terminal": ["Operate a command line shell, run terminal commands and administer a machine."],
    "tools": ["Use external tools, function calls, APIs and agent tools to complete a task."],
    "finance": ["Analyze money, financial investments, portfolios and business finances."],
    "legal": ["Interpret legislation, regulations, legal rights and agreements."],
    "tax": ["Calculate tax liabilities, deductions, tax filing requirements and returns."],
    "reasoning": ["Solve abstract logic, math and formal reasoning problems."],
}


def model_files(*, download=True):
    root = (Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) /
            "agent-models" / "semantic" / REVISION)
    if download:
        root.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name, (remote, digest) in FILES.items():
        path = root / name
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest:
            continue
        if not download:
            raise ValueError("semantic model is not cached")
        url = f"https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/{REVISION}/{remote}"
        with urlopen(Request(url, headers={"User-Agent": "model-guide/0.1"}), timeout=20) as response:
            data = response.read(30_000_001)
        if len(data) > 30_000_000 or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("semantic model download failed integrity check")
        with tempfile.NamedTemporaryFile(dir=root, delete=False) as tmp:
            temporary = Path(tmp.name)
            try:
                tmp.write(data)
                tmp.flush()
                os.replace(temporary, path)
            finally:
                temporary.unlink(missing_ok=True)
    return root


def domains(task, *, download=True):
    root = model_files(download=download)
    import numpy as np

    os.environ.setdefault("ORT_LOGGING_LEVEL", "ERROR")
    import onnxruntime as ort
    from tokenizers import Tokenizer

    ort.set_default_logger_severity(3)
    tokenizer = Tokenizer.from_file(str(root / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=128)
    tokenizer.enable_padding()
    examples = [(domain, example) for domain, values in EXAMPLES.items() for example in values]
    options = ort.SessionOptions()
    options.intra_op_num_threads = options.inter_op_num_threads = 1
    options.log_severity_level = 3
    session = ort.InferenceSession(str(root / "model_quantized.onnx"), sess_options=options,
                                   providers=["CPUExecutionProvider"])

    def encode(texts):
        encoded = tokenizer.encode_batch(texts)
        inputs = {name: np.asarray([getattr(row, attr) for row in encoded], dtype=np.int64)
                  for name, attr in (("input_ids", "ids"), ("attention_mask", "attention_mask"),
                                     ("token_type_ids", "type_ids"))}
        output = np.asarray(session.run(None, inputs)[0])
        mask = inputs["attention_mask"][:, :, None]
        embeddings = (output * mask).sum(axis=1) / mask.sum(axis=1)
        return embeddings / np.linalg.norm(embeddings, axis=1, keepdims=True)

    key = hashlib.sha256(json.dumps([ort.__version__, examples],
                                    ensure_ascii=False).encode()).hexdigest()[:16]
    cache = root / ("examples-" + key + ".npy")
    try:
        if cache.stat().st_size > 100_000:
            raise ValueError("semantic example cache too large")
        reference = np.load(cache, allow_pickle=False)
        if (reference.shape != (len(examples), 384) or reference.dtype.kind != "f"
                or not np.isfinite(reference).all()):
            raise ValueError("invalid semantic example cache")
    except (OSError, ValueError):
        reference = encode([example for _, example in examples])
        try:
            with tempfile.NamedTemporaryFile(dir=root, delete=False) as tmp:
                temporary = Path(tmp.name)
                try:
                    np.save(tmp, reference, allow_pickle=False)
                    tmp.flush()
                    os.replace(temporary, cache)
                finally:
                    temporary.unlink(missing_ok=True)
        except OSError:
            pass
    scores = reference @ encode([task])[0]
    best = {}
    for (domain, _), score in zip(examples, scores):
        best[domain] = max(best.get(domain, -1.0), float(score))
    ordered = sorted(best, key=lambda domain: best[domain], reverse=True)
    if not ordered or best[ordered[0]] < 0.30:
        return []
    return [domain for domain in ordered[:2] if best[domain] >= best[ordered[0]] - 0.03]
