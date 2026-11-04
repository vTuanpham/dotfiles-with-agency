def main():
    """Keep the per-tool guard independent of human-page and injection startup."""
    import sys

    if sys.argv[1:] == ["guard"]:
        from . import guard

        return guard.main()
    from . import cli

    return cli.main()
