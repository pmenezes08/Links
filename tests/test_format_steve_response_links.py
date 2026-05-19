from __future__ import annotations


def test_format_steve_preserves_headline_markdown_links():
    from bodybuilding_app import format_steve_response_links

    raw = "[BBC headline here](https://www.bbc.com/news/world-123)"
    assert format_steve_response_links(raw) == raw


def test_format_steve_citation_style_becomes_domain_link():
    from bodybuilding_app import format_steve_response_links

    assert (
        format_steve_response_links("See [[1]](https://example.com/path)")
        == "See [example.com](https://example.com/path)"
    )


def test_format_steve_bare_url_becomes_domain_link():
    from bodybuilding_app import format_steve_response_links

    assert format_steve_response_links("Link https://news.example/story?id=1 ends.") == (
        "Link [news.example](https://news.example/story?id=1) ends."
    )


def test_format_steve_numeric_bracket_label_becomes_domain():
    from bodybuilding_app import format_steve_response_links

    assert format_steve_response_links("[1](https://api.test/a)") == "[api.test](https://api.test/a)"
