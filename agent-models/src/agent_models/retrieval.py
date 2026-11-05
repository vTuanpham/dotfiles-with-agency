"""Lexical retrieval of cached policy sections; numeric plan identities stay exact."""

import math
import re
from collections import Counter


def lexical_rank(query, passages):
    """BM25 preserves model/plan/number matches without encoding policy pages."""

    def words(text):
        return re.findall(r"[a-z]+|\d+", text.casefold())

    documents = [Counter(words(p)) for p in passages]
    terms = set(words(query))
    lengths = [sum(row.values()) for row in documents]
    average = sum(lengths) / max(len(lengths), 1) or 1
    frequency = {term: sum(term in row for row in documents) for term in terms}
    scores = []
    for row, length in zip(documents, lengths):
        score = sum(
            math.log(1 + (len(documents) - frequency[t] + 0.5) / (frequency[t] + 0.5))
            * row[t]
            * 2.2
            / (row[t] + 1.2 * (0.25 + 0.75 * length / average))
            for t in terms
            if row[t]
        )
        scores.append(score)
    return sorted((i for i in range(len(passages)) if scores[i] > 0), key=lambda i: (-scores[i], i))
