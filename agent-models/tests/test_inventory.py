import json

import pytest

from agent_models import inventory


def test_model_catalog_parser_lists_supported_ids_and_efforts():
    catalog = json.dumps(
        {
            "models": [
                {
                    "slug": "model-a",
                    "visibility": "list",
                    "supported_reasoning_levels": [{"effort": "low"}, {"effort": "high"}],
                },
                {"slug": "hidden", "visibility": "hide", "supported_reasoning_levels": []},
            ]
        }
    )
    assert inventory.parse_codex(catalog) == ["model-a\tlow,high"]


def test_authoritative_empty_catalog_is_distinct_from_invalid_output():
    assert inventory.parse_codex('{"models":[]}') == []
    for raw in ('{}', '{"models":null}', '{"models":[],"models":[]}'):
        with pytest.raises(ValueError):
            inventory.parse_codex(raw)


def test_reference_check_does_not_start_provider_processes(monkeypatch, tmp_path):
    from agent_models import reference

    monkeypatch.setattr(reference, "live", lambda: pytest.fail("health check launched provider"))
    assert reference.inspect()["inventory_checked"] is False


def test_models_marks_and_sorts_free_first(monkeypatch, capsys):
    def run(*args, **kwargs):
        kwargs["stdout"].write(json.dumps({"data": [
            {"providerID": provider, "id": model, "enabled": True, "variants": []}
            for provider, model in (("paid", "model"), ("opencode", "example-free"),
                                     ("opencode", "glm-5.3-flash-free"), ("opencode", "big-pickle"))]}))
        return type("Result", (), {"returncode": 0})()

    monkeypatch.setattr(
        inventory.subprocess,
        "run",
        run,
    )
    inventory.show("opencode")
    assert capsys.readouterr().out.splitlines() == [
        "opencode/example-free\t-\tfree-logged",
        "opencode/glm-5.3-flash-free\t-\tfree",
        "opencode/big-pickle\t-\tfree-logged",
        "paid/model\t-\tunverified",
    ]


def test_models_failure_reports_stderr(monkeypatch):
    monkeypatch.setattr(
        inventory.subprocess,
        "run",
        lambda *args, **kwargs: type(
            "Result", (), {"stdout": "", "stderr": "not logged in", "returncode": 1}
        )(),
    )
    with pytest.raises(RuntimeError, match="inventory failed"):
        inventory.show("opencode")


@pytest.mark.parametrize("provider,model", [
    ("opencode-go", "deepseek-v4.1-flash"), ("opencode-go", "gpt-6-luna"),
    ("local", "model"), ("free-proxy", "model"),
])
def test_model_name_does_not_establish_billing_or_included_quota(provider, model):
    rows = inventory.parse_opencode(json.dumps({"data": [{
        "providerID": provider, "id": model, "enabled": True, "variants": [],
    }]}))
    assert rows[0]["id"] == provider + "/" + model
    assert rows[0]["listing_tier"] == "unverified"
