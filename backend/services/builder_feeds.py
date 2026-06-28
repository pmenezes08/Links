"""Host-brokered public data connectors for Steve Build artifacts.

Artifacts run in an opaque sandbox and must never fetch arbitrary URLs. This
module exposes a small registry of vetted, keyless (or free test-key) public
data sources. Every upstream URL is built server-side from validated params.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

logger = logging.getLogger(__name__)

Params = Dict[str, Any]
FeedResult = Dict[str, Any]
FetchFn = Callable[[Params], Any]

_HTTP_TIMEOUT = 8
_MAX_ITEMS = 20
_RANDOM_BATCH_SIZE = 12
_SEQUENTIAL_RANDOM_CALLS = 5
_BUDGET_WINDOW_SECONDS = 60
_CIRCUIT_THRESHOLD = 4
_CIRCUIT_COOLDOWN_SECONDS = 120
_DEFAULT_STALE_TTL = 3600
_CONNECTOR_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


@dataclass(frozen=True)
class Connector:
    ttl: int
    attribution: str
    fetch: FetchFn
    budget_limit: int = 60
    stale_ttl: int = _DEFAULT_STALE_TTL
    random_batch: bool = False


def _clean_text(value: Any, *, max_len: int = 120) -> str:
    text = value if isinstance(value, str) else ""
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_len]


def _safe_int(value: Any, *, default: int = 0, minimum: int = 0, maximum: int = 100) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = default
    return max(minimum, min(n, maximum))


def _safe_float(value: Any) -> Optional[float]:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n != n or n in (float("inf"), float("-inf")):
        return None
    return n


def _safe_date(value: Any) -> str:
    text = _clean_text(value, max_len=10)
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return datetime.utcnow().strftime("%Y-%m-%d")
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return datetime.utcnow().strftime("%Y-%m-%d")
    return text


def _list_at(values: Any, index: int) -> Any:
    return values[index] if isinstance(values, list) and index < len(values) else None


def _http_get_json(url: str, *, params: Optional[Params] = None) -> Optional[Any]:
    try:
        import requests

        resp = requests.get(
            url,
            params=params or {},
            headers={"User-Agent": "C-Point-Builder-Feeds/1.0 (+https://c-point.co)"},
            timeout=_HTTP_TIMEOUT,
        )
        if resp.status_code != 200:
            logger.info("builder feeds: upstream %s returned %s", url, resp.status_code)
            return None
        return resp.json()
    except Exception:
        logger.warning("builder feeds: upstream fetch failed for %s", url, exc_info=True)
        return None


def _cache():
    try:
        from redis_cache import cache

        return cache
    except Exception:
        return None


def _cache_get(key: str) -> Optional[Any]:
    c = _cache()
    if c is None:
        return None
    try:
        return c.get(key)
    except Exception:
        return None


def _cache_set(key: str, value: Any, ttl: int) -> None:
    if ttl <= 0:
        return
    c = _cache()
    if c is None:
        return
    try:
        c.set(key, value, ttl=ttl)
    except Exception:
        pass


def _cache_delete(key: str) -> None:
    c = _cache()
    if c is None:
        return
    try:
        c.delete(key)
    except Exception:
        pass


def _cache_incr(key: str, ttl: int) -> Optional[int]:
    c = _cache()
    if c is None:
        return None
    try:
        if hasattr(c, "incr"):
            return c.incr(key, ttl=ttl)
        count = int(c.get(key) or 0) + 1
        c.set(key, count, ttl=ttl)
        return count
    except Exception:
        return None


def _stable_params(params: Params) -> Params:
    """Small, deterministic JSON-ish params for global cache keys."""
    out: Params = {}
    for key in sorted(params.keys()):
        if key.startswith("_"):
            continue
        value = params[key]
        if isinstance(value, (str, int, float, bool)) or value is None:
            out[key] = value
    return out


def cache_key(connector: str, params: Params) -> str:
    raw = json.dumps(_stable_params(params), sort_keys=True, separators=(",", ":"), default=str)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]
    return f"cpfeed:cache:{connector}:{digest}"


def _stale_key(connector: str, params: Params) -> str:
    return cache_key(connector, params).replace("cpfeed:cache:", "cpfeed:stale:", 1)


def _budget_key(connector: str) -> str:
    window = int(time.time() // _BUDGET_WINDOW_SECONDS)
    return f"cpfeed:budget:{connector}:{window}"


def _circuit_key(connector: str) -> str:
    return f"cpfeed:cb:{connector}"


def _failure_key(connector: str) -> str:
    return f"cpfeed:cbfail:{connector}"


def _budget_ok(connector: str, spec: Connector) -> bool:
    count = _cache_incr(_budget_key(connector), _BUDGET_WINDOW_SECONDS + 5)
    # When Redis is unavailable, continue best-effort; route-level read throttle
    # still protects C-Point from per-user spam.
    return count is None or count <= spec.budget_limit


def _circuit_open(connector: str) -> bool:
    opened_at = _cache_get(_circuit_key(connector))
    if not opened_at:
        return False
    try:
        opened = float(opened_at)
    except (TypeError, ValueError):
        return False
    if time.time() - opened < _CIRCUIT_COOLDOWN_SECONDS:
        return True
    _cache_delete(_circuit_key(connector))
    _cache_delete(_failure_key(connector))
    return False


def _record_success(connector: str) -> None:
    _cache_delete(_failure_key(connector))
    _cache_delete(_circuit_key(connector))


def _record_failure(connector: str) -> None:
    failures = _cache_incr(_failure_key(connector), _CIRCUIT_COOLDOWN_SECONDS)
    if failures is not None and failures >= _CIRCUIT_THRESHOLD:
        _cache_set(_circuit_key(connector), time.time(), ttl=_CIRCUIT_COOLDOWN_SECONDS)


def _weather(params: Params) -> Any:
    lat = _safe_float(params.get("lat"))
    lon = _safe_float(params.get("lon"))
    name = _clean_text(params.get("place") or params.get("q"), max_len=80)
    label = name
    if lat is None or lon is None:
        if not name:
            raise ValueError("place_or_lat_lon_required")
        geo = _http_get_json(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": name, "count": 1, "language": "en", "format": "json"},
        )
        result = (geo or {}).get("results") or []
        if not result:
            raise ValueError("place_not_found")
        first = result[0]
        lat = _safe_float(first.get("latitude"))
        lon = _safe_float(first.get("longitude"))
        label = ", ".join([p for p in [first.get("name"), first.get("country")] if p])
    if lat is None or lon is None:
        raise ValueError("invalid_coordinates")
    data = _http_get_json(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "current_weather": "true",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "timezone": "auto",
            "forecast_days": 7,
        },
    )
    if not data:
        raise RuntimeError("weather_unavailable")
    daily = data.get("daily") or {}
    days = []
    for i, date in enumerate((daily.get("time") or [])[:7]):
        days.append({
            "date": date,
            "weatherCode": _list_at(daily.get("weather_code"), i),
            "tempMaxC": _list_at(daily.get("temperature_2m_max"), i),
            "tempMinC": _list_at(daily.get("temperature_2m_min"), i),
            "precipitationChance": _list_at(daily.get("precipitation_probability_max"), i),
        })
    return {"location": {"name": label or f"{lat},{lon}", "lat": lat, "lon": lon}, "current": data.get("current_weather"), "daily": days}


def _country(params: Params) -> Any:
    q = _clean_text(params.get("code") or params.get("name") or params.get("q"), max_len=80)
    if not q:
        raise ValueError("country_required")
    if len(q) in (2, 3) and re.match(r"^[A-Za-z]+$", q):
        url = f"https://restcountries.com/v3.1/alpha/{quote(q)}"
    else:
        url = f"https://restcountries.com/v3.1/name/{quote(q)}"
    data = _http_get_json(url, params={"fields": "name,capital,region,subregion,population,flags,cca2,cca3,languages,currencies"})
    rows = data if isinstance(data, list) else [data]
    out = []
    for row in rows[:_MAX_ITEMS]:
        if not isinstance(row, dict):
            continue
        out.append({
            "name": ((row.get("name") or {}).get("common") or "")[:80],
            "officialName": ((row.get("name") or {}).get("official") or "")[:140],
            "code": row.get("cca2") or row.get("cca3"),
            "capital": (row.get("capital") or [None])[0],
            "region": row.get("region"),
            "subregion": row.get("subregion"),
            "population": row.get("population"),
            "flag": (row.get("flags") or {}).get("png") or (row.get("flags") or {}).get("svg"),
            "languages": list((row.get("languages") or {}).values())[:8],
            "currencies": list((row.get("currencies") or {}).keys())[:6],
        })
    return {"countries": out}


def _wikipedia(params: Params) -> Any:
    title = _clean_text(params.get("title"), max_len=140)
    search = _clean_text(params.get("search") or params.get("q"), max_len=140)
    if not title:
        if not search:
            raise ValueError("query_required")
        search_data = _http_get_json(
            "https://en.wikipedia.org/w/api.php",
            params={"action": "query", "list": "search", "srsearch": search, "srlimit": 1, "format": "json", "origin": "*"},
        )
        hits = ((search_data or {}).get("query") or {}).get("search") or []
        if not hits:
            raise ValueError("not_found")
        title = hits[0].get("title") or search
    summary = _http_get_json(f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title, safe='')}")
    if not summary:
        raise RuntimeError("wikipedia_unavailable")
    return {
        "title": summary.get("title"),
        "description": summary.get("description"),
        "extract": summary.get("extract"),
        "url": ((summary.get("content_urls") or {}).get("desktop") or {}).get("page"),
        "thumbnail": (summary.get("thumbnail") or {}).get("source"),
    }


def _meal(params: Params) -> Any:
    random_mode = bool(params.get("random"))
    meals: List[Dict[str, Any]] = []
    calls = _SEQUENTIAL_RANDOM_CALLS if random_mode else 1
    for _ in range(calls):
        if random_mode:
            data = _http_get_json("https://www.themealdb.com/api/json/v1/1/random.php")
        else:
            q = _clean_text(params.get("search") or params.get("q"), max_len=80)
            data = _http_get_json("https://www.themealdb.com/api/json/v1/1/search.php", params={"s": q})
        for meal in ((data or {}).get("meals") or [])[:_MAX_ITEMS]:
            meals.append({
                "id": meal.get("idMeal"),
                "name": meal.get("strMeal"),
                "category": meal.get("strCategory"),
                "area": meal.get("strArea"),
                "image": meal.get("strMealThumb"),
                "instructions": _clean_text(meal.get("strInstructions"), max_len=700),
                "source": meal.get("strSource"),
            })
        if not random_mode:
            break
    return {"items": _dedupe_by_id(meals)}


def _cocktail(params: Params) -> Any:
    random_mode = bool(params.get("random"))
    drinks: List[Dict[str, Any]] = []
    calls = _SEQUENTIAL_RANDOM_CALLS if random_mode else 1
    for _ in range(calls):
        if random_mode:
            data = _http_get_json("https://www.thecocktaildb.com/api/json/v1/1/random.php")
        else:
            q = _clean_text(params.get("search") or params.get("q"), max_len=80)
            data = _http_get_json("https://www.thecocktaildb.com/api/json/v1/1/search.php", params={"s": q})
        for drink in ((data or {}).get("drinks") or [])[:_MAX_ITEMS]:
            drinks.append({
                "id": drink.get("idDrink"),
                "name": drink.get("strDrink"),
                "category": drink.get("strCategory"),
                "alcoholic": drink.get("strAlcoholic"),
                "glass": drink.get("strGlass"),
                "image": drink.get("strDrinkThumb"),
                "instructions": _clean_text(drink.get("strInstructions"), max_len=700),
            })
        if not random_mode:
            break
    return {"items": _dedupe_by_id(drinks)}


def _dedupe_by_id(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    out = []
    for item in items:
        ident = item.get("id") or item.get("name") or json.dumps(item, sort_keys=True, default=str)
        if ident in seen:
            continue
        seen.add(ident)
        out.append(item)
        if len(out) >= _MAX_ITEMS:
            break
    return out


def _pokemon(params: Params) -> Any:
    q = _clean_text(params.get("name") or params.get("id") or params.get("q"), max_len=40).lower()
    if not q or not re.match(r"^[a-z0-9-]+$", q):
        raise ValueError("pokemon_required")
    data = _http_get_json(f"https://pokeapi.co/api/v2/pokemon/{quote(q)}")
    if not data:
        raise ValueError("not_found")
    return {
        "id": data.get("id"),
        "name": data.get("name"),
        "height": data.get("height"),
        "weight": data.get("weight"),
        "types": [t.get("type", {}).get("name") for t in (data.get("types") or []) if t.get("type")],
        "stats": {s.get("stat", {}).get("name"): s.get("base_stat") for s in (data.get("stats") or []) if s.get("stat")},
        "image": ((data.get("sprites") or {}).get("other") or {}).get("official-artwork", {}).get("front_default") or (data.get("sprites") or {}).get("front_default"),
    }


def _joke(params: Params) -> Any:
    category = _clean_text(params.get("category") or "Any", max_len=30)
    if not re.match(r"^[A-Za-z,]+$", category):
        category = "Any"
    data = _http_get_json(f"https://v2.jokeapi.dev/joke/{quote(category)}", params={"safe-mode": "", "amount": _RANDOM_BATCH_SIZE})
    rows = data.get("jokes") if isinstance(data, dict) and isinstance(data.get("jokes"), list) else [data]
    items = []
    for row in rows[:_MAX_ITEMS]:
        if not isinstance(row, dict) or row.get("error"):
            continue
        items.append({
            "category": row.get("category"),
            "type": row.get("type"),
            "joke": row.get("joke"),
            "setup": row.get("setup"),
            "delivery": row.get("delivery"),
        })
    return {"items": items}


def _fact(params: Params) -> Any:
    items = []
    for _ in range(_SEQUENTIAL_RANDOM_CALLS):
        data = _http_get_json("https://uselessfacts.jsph.pl/api/v2/facts/random", params={"language": "en"})
        if isinstance(data, dict) and data.get("text"):
            items.append({"text": data.get("text"), "source": data.get("source_url")})
    return {"items": _dedupe_by_id(items)}


def _advice(params: Params) -> Any:
    search = _clean_text(params.get("search") or params.get("q"), max_len=80)
    if search:
        data = _http_get_json("https://api.adviceslip.com/advice/search/" + quote(search))
        rows = (data or {}).get("slips") or []
    else:
        rows = []
        for _ in range(_SEQUENTIAL_RANDOM_CALLS):
            data = _http_get_json("https://api.adviceslip.com/advice")
            slip = (data or {}).get("slip")
            if slip:
                rows.append(slip)
    return {"items": [{"id": r.get("id"), "advice": r.get("advice")} for r in rows[:_MAX_ITEMS] if isinstance(r, dict)]}


def _technews(params: Params) -> Any:
    feed = _clean_text(params.get("feed") or "top", max_len=20).lower()
    endpoint = {"top": "topstories", "new": "newstories", "best": "beststories"}.get(feed, "topstories")
    limit = _safe_int(params.get("limit"), default=10, minimum=1, maximum=15)
    ids = _http_get_json(f"https://hacker-news.firebaseio.com/v0/{endpoint}.json") or []
    items = []
    for item_id in ids[:limit]:
        row = _http_get_json(f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json")
        if isinstance(row, dict):
            items.append({
                "id": row.get("id"),
                "title": row.get("title"),
                "url": row.get("url") or f"https://news.ycombinator.com/item?id={row.get('id')}",
                "score": row.get("score"),
                "by": row.get("by"),
                "comments": row.get("descendants"),
                "time": row.get("time"),
            })
    return {"items": items, "feed": feed}


def _sports(params: Params) -> Any:
    key = os.environ.get("THESPORTSDB_KEY", "3")
    sport = _clean_text(params.get("sport") or "Soccer", max_len=40) or "Soccer"
    league_id = _clean_text(params.get("leagueId") or params.get("league_id"), max_len=12)
    team_id = _clean_text(params.get("teamId") or params.get("team_id"), max_len=12)
    mode = _clean_text(params.get("mode"), max_len=12).lower()
    day = _safe_date(params.get("day") or params.get("date"))
    base = f"https://www.thesportsdb.com/api/v1/json/{quote(key)}"
    if league_id and re.match(r"^\d+$", league_id):
        endpoint = "eventsnextleague.php" if mode == "next" else "eventspastleague.php"
        data = _http_get_json(f"{base}/{endpoint}", params={"id": league_id})
    elif team_id and re.match(r"^\d+$", team_id):
        endpoint = "eventsnext.php" if mode == "next" else "eventslast.php"
        data = _http_get_json(f"{base}/{endpoint}", params={"id": team_id})
    else:
        data = _http_get_json(f"{base}/eventsday.php", params={"d": day, "s": sport})
    rows = []
    for event in ((data or {}).get("events") or [])[:_MAX_ITEMS]:
        rows.append({
            "id": event.get("idEvent"),
            "date": event.get("dateEvent"),
            "time": event.get("strTime"),
            "league": event.get("strLeague"),
            "season": event.get("strSeason"),
            "homeTeam": event.get("strHomeTeam"),
            "awayTeam": event.get("strAwayTeam"),
            "homeScore": event.get("intHomeScore"),
            "awayScore": event.get("intAwayScore"),
            "status": event.get("strStatus") or event.get("strProgress"),
            "venue": event.get("strVenue"),
            "thumbnail": event.get("strThumb"),
        })
    return {"events": rows, "date": day, "sport": sport}


CONNECTORS: Dict[str, Connector] = {
    "weather": Connector(ttl=900, stale_ttl=7200, budget_limit=80, attribution="Weather by Open-Meteo", fetch=_weather),
    "country": Connector(ttl=86400, stale_ttl=604800, budget_limit=80, attribution="Data: REST Countries", fetch=_country),
    "wikipedia": Connector(ttl=3600, stale_ttl=86400, budget_limit=80, attribution="From Wikipedia (CC BY-SA)", fetch=_wikipedia),
    "recipe": Connector(ttl=1800, stale_ttl=86400, budget_limit=30, attribution="Recipes by TheMealDB", fetch=_meal, random_batch=True),
    "cocktail": Connector(ttl=1800, stale_ttl=86400, budget_limit=30, attribution="Drinks by TheCocktailDB", fetch=_cocktail, random_batch=True),
    "pokemon": Connector(ttl=86400, stale_ttl=604800, budget_limit=80, attribution="Data: PokeAPI", fetch=_pokemon),
    "joke": Connector(ttl=600, stale_ttl=3600, budget_limit=25, attribution="Jokes by JokeAPI", fetch=_joke, random_batch=True),
    "fact": Connector(ttl=600, stale_ttl=3600, budget_limit=25, attribution="Facts by Useless Facts", fetch=_fact, random_batch=True),
    "advice": Connector(ttl=600, stale_ttl=3600, budget_limit=25, attribution="Advice Slip API", fetch=_advice, random_batch=True),
    "technews": Connector(ttl=300, stale_ttl=3600, budget_limit=80, attribution="Hacker News", fetch=_technews),
    "sports": Connector(ttl=300, stale_ttl=7200, budget_limit=50, attribution="Data by TheSportsDB", fetch=_sports),
}


def connector_ttl(connector: str) -> int:
    spec = CONNECTORS.get(connector)
    return spec.ttl if spec else 0


def fetch_feed(connector: str, params: Optional[Params] = None, *, refresh: bool = False) -> FeedResult:
    cid = (connector or "").strip().lower()
    if not _CONNECTOR_RE.match(cid) or cid not in CONNECTORS:
        return {"success": False, "error": "unknown_connector", "data": None}
    raw_params = params if isinstance(params, dict) else {}
    stable = _stable_params(raw_params)
    spec = CONNECTORS[cid]
    fresh_key = cache_key(cid, stable)
    stale_key = _stale_key(cid, stable)

    hit = _cache_get(fresh_key)
    if isinstance(hit, dict) and not refresh:
        return {**hit, "cached": True, "stale": False}

    stale = _cache_get(stale_key)
    if _circuit_open(cid):
        if isinstance(stale, dict):
            return {**stale, "cached": True, "stale": True, "degraded": "circuit_open"}
        return {"success": False, "error": "provider_unavailable", "data": None, "stale": False}

    if not _budget_ok(cid, spec):
        if isinstance(stale, dict):
            return {**stale, "cached": True, "stale": True, "degraded": "budget_exceeded"}
        return {"success": False, "error": "provider_budget_exceeded", "data": None, "stale": False}

    try:
        data = spec.fetch(stable)
        payload = {
            "success": True,
            "connector": cid,
            "data": data,
            "attribution": spec.attribution,
            "randomBatch": spec.random_batch,
        }
        _cache_set(fresh_key, payload, spec.ttl)
        _cache_set(stale_key, payload, spec.stale_ttl)
        _record_success(cid)
        return {**payload, "cached": False, "stale": False}
    except ValueError as exc:
        return {"success": False, "error": str(exc) or "invalid_params", "data": None}
    except Exception:
        logger.warning("builder feeds: connector %s failed", cid, exc_info=True)
        _record_failure(cid)
        if isinstance(stale, dict):
            return {**stale, "cached": True, "stale": True, "degraded": "upstream_failed"}
        return {"success": False, "error": "provider_unavailable", "data": None}
