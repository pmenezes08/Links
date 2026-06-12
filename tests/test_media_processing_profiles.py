"""Unit coverage for image optimization profiles (avatar dimension caps)."""

from __future__ import annotations

import pytest

PIL = pytest.importorskip("PIL")
from PIL import Image  # noqa: E402


def _make_image(path, width: int, height: int, fmt: str = "JPEG"):
    img = Image.new("RGB", (width, height), (0, 206, 200))
    img.save(path, format=fmt)
    return path


def _dims(path):
    with Image.open(path) as img:
        return img.width, img.height


def test_avatar_profile_caps_portrait_height(tmp_path):
    from backend.services import media_processing

    path = str(tmp_path / "portrait.jpg")
    _make_image(path, 800, 2000)

    assert media_processing.optimize_image_file(path, "avatar") is True
    width, height = _dims(path)
    assert height == 512
    assert width == round(800 * (512 / 2000))


def test_avatar_profile_caps_landscape_width(tmp_path):
    from backend.services import media_processing

    path = str(tmp_path / "landscape.jpg")
    _make_image(path, 2000, 800)

    assert media_processing.optimize_image_file(path, "avatar") is True
    width, height = _dims(path)
    assert width == 512
    assert height == round(800 * (512 / 2000))


def test_avatar_profile_leaves_small_images_alone(tmp_path):
    from backend.services import media_processing

    path = str(tmp_path / "small.jpg")
    _make_image(path, 100, 100)

    assert media_processing.optimize_image_file(path, "avatar") is True
    assert _dims(path) == (100, 100)


def test_feed_profile_still_caps_width_only(tmp_path):
    from backend.services import media_processing

    # Tall portrait under the feed width cap must stay untouched (existing behavior).
    path = str(tmp_path / "feed_portrait.jpg")
    _make_image(path, 1000, 3000)

    assert media_processing.optimize_image_file(path, "feed") is True
    assert _dims(path) == (1000, 3000)


def test_unknown_profile_falls_back_to_feed(tmp_path):
    from backend.services import media_processing

    path = str(tmp_path / "wide.jpg")
    _make_image(path, 4000, 1000)

    assert media_processing.optimize_image_file(path, "does-not-exist") is True
    width, height = _dims(path)
    assert width == 1920
    assert height == int(1000 * (1920 / 4000))
