#!/usr/bin/env python3
"""
FWO Network-Intercepting Scraper
=================================
Strategy:
1. Intercept all XHR/fetch/API responses while the page loads
2. Extract JSON-LD, embedded script state, and semantic HTML
3. Wait for stable content (networkidle + readyState complete + stable text)
4. Save multi-layer output: JSON APIs, JSON-LD, semantic HTML, clean text
5. Deduplicate by canonical URL + content hash
6. Auto-retry on failures
"""

import asyncio
import json
import hashlib
import re
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse, urljoin

try:
    from playwright.async_api import async_playwright, TimeoutError as PwTimeout
except ImportError:
    print("Installing playwright...")
    os.system("pip install playwright -q && playwright install chromium --with-deps -q")
    from playwright.async_api import async_playwright, TimeoutError as PwTimeout

OUTPUT_DIR = Path("/app/.agents/fwo_data")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Canonical URLs to scrape — ordered by priority
PAGES = [
    # NES
    "https://www.fairwork.gov.au/employment-conditions/national-employment-standards",
    "https://www.fairwork.gov.au/employment-conditions/national-employment-standards/maximum-weekly-hours",
    # Awards
    "https://www.fairwork.gov.au/employment-conditions/awards",
    "https://www.fairwork.gov.au/employment-conditions/awards/award-and-agreement-free-employees",
    # Hours & Overtime
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters",
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/hours-of-work",
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/hours-of-work/when-overtime-applies",
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/breaks",
    # Leave
    "https://www.fairwork.gov.au/leave/annual-leave",
    "https://www.fairwork.gov.au/leave/annual-leave/payment-for-annual-leave",
    "https://www.fairwork.gov.au/leave/annual-leave/taking-annual-leave",
    "https://www.fairwork.gov.au/leave/sick-and-carers-leave",
    "https://www.fairwork.gov.au/leave/sick-and-carers-leave/paid-sick-and-carers-leave",
    "https://www.fairwork.gov.au/leave/long-service-leave",
    "https://www.fairwork.gov.au/leave/parental-leave",
    "https://www.fairwork.gov.au/leave/family-and-domestic-violence-leave",
    # Pay
    "https://www.fairwork.gov.au/pay-and-wages/minimum-wages",
    "https://www.fairwork.gov.au/pay-and-wages/allowances-penalty-rates-and-other-payments",
    "https://www.fairwork.gov.au/pay-and-wages/allowances-penalty-rates-and-other-payments/penalty-rates",
    "https://www.fairwork.gov.au/pay-and-wages/allowances-penalty-rates-and-other-payments/overtime-pay",
    "https://www.fairwork.gov.au/pay-and-wages/tax-and-superannuation",
    "https://www.fairwork.gov.au/pay-and-wages/paying-wages",
    "https://www.fairwork.gov.au/pay-and-wages/paying-wages/pay-slips",
    "https://www.fairwork.gov.au/pay-and-wages/paying-wages/record-keeping",
    # Employment contracts
    "https://www.fairwork.gov.au/employment-conditions/contracts",
    # Casual employment
    "https://www.fairwork.gov.au/employee-entitlements/types-of-employees/casual-part-time-and-full-time/casual-employees",
    # Ending employment
    "https://www.fairwork.gov.au/ending-employment/notice-and-final-pay",
    "https://www.fairwork.gov.au/ending-employment/notice-and-final-pay/final-pay",
    "https://www.fairwork.gov.au/ending-employment/redundancy",
    "https://www.fairwork.gov.au/ending-employment/unfair-dismissal",
    # Public holidays
    "https://www.fairwork.gov.au/employment-conditions/public-holidays",
    # Right to disconnect
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/right-to-disconnect",
    # Agreements
    "https://www.fairwork.gov.au/employment-conditions/agreements",
]

# Already scraped (from previous sessions) — skip to avoid duplicate work
ALREADY_DONE = {
    "https://www.fairwork.gov.au/employment-conditions",
    "https://www.fairwork.gov.au/employment-conditions/national-employment-standards",
    "https://www.fairwork.gov.au/employment-conditions/national-employment-standards/maximum-weekly-hours",
    "https://www.fairwork.gov.au/employment-conditions/awards",
    "https://www.fairwork.gov.au/employment-conditions/awards/award-and-agreement-free-employees",
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters",
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/hours-of-work/when-overtime-applies",
    "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/breaks",
    "https://www.fairwork.gov.au/leave/annual-leave",
    "https://www.fairwork.gov.au/leave/annual-leave/payment-for-annual-leave",
    "https://www.fairwork.gov.au/leave/sick-and-carers-leave",
    "https://www.fairwork.gov.au/leave/long-service-leave",
    "https://www.fairwork.gov.au/pay-and-wages/tax-and-superannuation",
}

# Seen content hashes to deduplicate
SEEN_HASHES = set()

def slugify(url: str) -> str:
    """Convert URL to a safe filename slug."""
    parsed = urlparse(url)
    path = parsed.path.strip("/").replace("/", "__")
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", path)[:120]

def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]

def get_output_path(url: str, existing_files: list) -> Path:
    """Generate a sequentially numbered output file path."""
    slug = slugify(url)
    # Find next available number
    existing_nums = []
    for f in existing_files:
        m = re.match(r"^(\d+)_", f.name)
        if m:
            existing_nums.append(int(m.group(1)))
    next_num = max(existing_nums, default=0) + 1
    return OUTPUT_DIR / f"{next_num:03d}_{slug}.json"

def extract_jsonld(html: str) -> list:
    """Extract all JSON-LD blocks from HTML."""
    results = []
    pattern = re.compile(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        re.DOTALL | re.IGNORECASE
    )
    for match in pattern.finditer(html):
        try:
            data = json.loads(match.group(1).strip())
            results.append(data)
        except Exception:
            pass
    return results

def extract_embedded_state(html: str) -> list:
    """Extract any JSON embedded in script tags (window.__STATE__, __NEXT_DATA__, etc.)."""
    results = []
    patterns = [
        r'window\.__(?:STATE|DATA|STORE|INITIAL_STATE|REDUX_STATE)__\s*=\s*({.+?});',
        r'window\.__NEXT_DATA__\s*=\s*({.+?})\s*;?\s*</script>',
        r'<script id="__NEXT_DATA__"[^>]*>({.+?})</script>',
    ]
    for pat in patterns:
        for match in re.finditer(pat, html, re.DOTALL):
            try:
                data = json.loads(match.group(1))
                results.append(data)
            except Exception:
                pass
    return results

def clean_text(raw: str) -> str:
    """Clean extracted text: collapse whitespace, remove nav boilerplate."""
    # Remove common nav/footer patterns
    lines = raw.splitlines()
    cleaned = []
    skip_patterns = [
        "Skip to main content", "Go to home page", "Fair Work Ombudsman",
        "LOGIN REGISTER", "Open search box", "Did you find what",
        "Visit Fair Work on", "Subscribe to email", "Accessibility Copyright",
        "Find information for...", "About us", "Resources", "Get help",
    ]
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        if any(p in stripped for p in skip_patterns):
            continue
        if len(stripped) < 3:
            continue
        cleaned.append(stripped)
    return "\n".join(cleaned)

async def wait_for_stable_content(page, timeout=15000):
    """Wait for page to reach stable state."""
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=timeout)
    except PwTimeout:
        pass
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout)
    except PwTimeout:
        pass
    # Wait for main content to appear
    for selector in ["main", "article", "[role='main']", ".content", "#content"]:
        try:
            await page.wait_for_selector(selector, timeout=3000)
            break
        except PwTimeout:
            continue
    # Stability check: wait for text to stop changing
    prev_len = 0
    for _ in range(5):
        text = await page.inner_text("body")
        cur_len = len(text)
        if cur_len == prev_len and cur_len > 500:
            break
        prev_len = cur_len
        await asyncio.sleep(0.8)

async def extract_semantic_content(page) -> dict:
    """Extract content from stable semantic HTML elements."""
    result = {}

    # Try main/article first
    for selector in ["main", "article", "[role='main']"]:
        try:
            el = page.locator(selector).first
            text = await el.inner_text(timeout=3000)
            html = await el.inner_html(timeout=3000)
            if len(text) > 200:
                result["semantic_text"] = clean_text(text)
                result["semantic_html_snippet"] = html[:5000]
                result["semantic_selector"] = selector
                break
        except Exception:
            continue

    # Fallback: body text
    if "semantic_text" not in result:
        try:
            body_text = await page.inner_text("body")
            result["semantic_text"] = clean_text(body_text)
            result["semantic_selector"] = "body"
        except Exception:
            result["semantic_text"] = ""

    # Extract headings
    try:
        headings = await page.evaluate("""() => {
            const els = document.querySelectorAll('h1,h2,h3,h4');
            return Array.from(els).map(el => ({
                level: el.tagName,
                text: el.innerText.trim()
            })).filter(h => h.text.length > 2);
        }""")
        result["headings"] = headings
    except Exception:
        result["headings"] = []

    # Extract tables
    try:
        tables = await page.evaluate("""() => {
            const tables = document.querySelectorAll('table');
            return Array.from(tables).map(table => {
                const rows = Array.from(table.querySelectorAll('tr'));
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll('td,th'));
                    return cells.map(c => c.innerText.trim());
                });
            });
        }""")
        result["tables"] = tables
    except Exception:
        result["tables"] = []

    # Extract internal links
    try:
        links = await page.evaluate("""() => {
            const anchors = document.querySelectorAll('main a[href], article a[href], [role="main"] a[href]');
            const base = 'https://www.fairwork.gov.au';
            return Array.from(anchors)
                .map(a => ({
                    text: a.innerText.trim(),
                    href: a.href.startsWith('http') ? a.href : base + a.getAttribute('href')
                }))
                .filter(l => l.href.includes('fairwork.gov.au') && l.text.length > 2)
                .slice(0, 40);
        }""")
        result["internal_links"] = links
    except Exception:
        result["internal_links"] = []

    # Extract canonical URL
    try:
        canonical = await page.evaluate("""() => {
            const el = document.querySelector('link[rel="canonical"]');
            return el ? el.href : null;
        }""")
        result["canonical_url"] = canonical
    except Exception:
        result["canonical_url"] = None

    # Extract page title and meta description
    try:
        meta = await page.evaluate("""() => ({
            title: document.title,
            description: (document.querySelector('meta[name="description"]') || {}).content || null,
            og_title: (document.querySelector('meta[property="og:title"]') || {}).content || null,
        })""")
        result["meta"] = meta
    except Exception:
        result["meta"] = {}

    return result

async def scrape_page(page, url: str, network_responses: list) -> dict | None:
    """Scrape a single page with full network interception."""
    print(f"\n{'='*60}")
    print(f"Scraping: {url}")

    if url in ALREADY_DONE:
        print(f"  [SKIP] Already scraped in previous session")
        return None

    for attempt in range(3):
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await wait_for_stable_content(page)
            break
        except PwTimeout:
            print(f"  [RETRY {attempt+1}] Timeout — retrying...")
            await asyncio.sleep(2)
        except Exception as e:
            print(f"  [ERROR] {e}")
            if attempt == 2:
                return None
            await asyncio.sleep(2)

    # Get full page HTML for JSON-LD extraction
    try:
        html = await page.content()
    except Exception:
        html = ""

    # Extract layers
    jsonld = extract_jsonld(html)
    embedded_state = extract_embedded_state(html)
    semantic = await extract_semantic_content(page)

    # Filter network responses captured for this URL's domain
    relevant_api = [
        r for r in network_responses
        if "fairwork" in r.get("url", "") and r.get("body")
        and r.get("content_type", "").startswith("application/json")
    ]
    # Clear for next page
    network_responses.clear()

    # Determine best content source
    primary_text = semantic.get("semantic_text", "")
    if len(primary_text) < 200:
        print(f"  [WARN] Short content ({len(primary_text)} chars)")

    h = content_hash(primary_text)
    if h in SEEN_HASHES:
        print(f"  [SKIP] Duplicate content hash")
        return None
    SEEN_HASHES.add(h)

    # Determine page slug/title
    title = semantic.get("meta", {}).get("title", "") or url.split("/")[-1]
    # Clean title
    title = re.sub(r"\s*[|\-–]\s*Fair Work.*$", "", title).strip()

    record = {
        "url": url,
        "canonical_url": semantic.get("canonical_url") or url,
        "title": title,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "content_hash": h,
        "source_priority": "semantic_html",
        "meta": semantic.get("meta", {}),
        "headings": semantic.get("headings", []),
        "tables": semantic.get("tables", []),
        "internal_links": semantic.get("internal_links", []),
        "content": primary_text,
        "semantic_selector": semantic.get("semantic_selector"),
        "jsonld": jsonld if jsonld else None,
        "embedded_state": embedded_state if embedded_state else None,
        "api_responses": relevant_api if relevant_api else None,
    }

    # Remove None values to keep files lean
    record = {k: v for k, v in record.items() if v is not None}

    print(f"  [OK] Title: {title!r}")
    print(f"  [OK] Content: {len(primary_text)} chars")
    print(f"  [OK] Headings: {len(semantic.get('headings', []))}, Tables: {len(semantic.get('tables', []))}")
    if jsonld:
        print(f"  [OK] JSON-LD blocks: {len(jsonld)}")
    if relevant_api:
        print(f"  [OK] API responses captured: {len(relevant_api)}")

    return record

async def main():
    existing_files = list(OUTPUT_DIR.glob("*.json"))
    print(f"Output dir: {OUTPUT_DIR}")
    print(f"Existing files: {len(existing_files)}")
    print(f"Pages to scrape: {len(PAGES)}")
    print(f"Already done: {len(ALREADY_DONE)}")

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (compatible; FWO-Corpus-Builder/1.0; research)"
        )

        # Network interception setup
        network_responses = []

        async def handle_response(response):
            content_type = response.headers.get("content-type", "")
            url_r = response.url
            # Capture JSON API/XHR responses
            if (
                "application/json" in content_type
                and "fairwork.gov.au" in url_r
                and response.status == 200
            ):
                try:
                    body = await response.json()
                    network_responses.append({
                        "url": url_r,
                        "content_type": content_type,
                        "status": response.status,
                        "body": body,
                    })
                    print(f"  [NET] JSON API: {url_r}")
                except Exception:
                    pass

        page = await context.new_page()
        page.on("response", handle_response)

        saved = 0
        skipped = 0
        errors = 0

        for url in PAGES:
            try:
                record = await scrape_page(page, url, network_responses)
                if record:
                    out_path = get_output_path(url, list(OUTPUT_DIR.glob("*.json")))
                    out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False))
                    print(f"  [SAVED] {out_path.name}")
                    saved += 1
                    await asyncio.sleep(1.5)  # polite delay
                else:
                    skipped += 1
            except Exception as e:
                print(f"  [FAIL] {url}: {e}")
                errors += 1

        await browser.close()

    print(f"\n{'='*60}")
    print(f"DONE — Saved: {saved}, Skipped: {skipped}, Errors: {errors}")
    print(f"Files in {OUTPUT_DIR}:")
    for f in sorted(OUTPUT_DIR.glob("*.json")):
        size = f.stat().st_size
        print(f"  {f.name} ({size:,} bytes)")

if __name__ == "__main__":
    asyncio.run(main())
