#!/usr/bin/env python3
"""
FWO Fetch-Based Scraper (curl + requests fallback)
====================================================
Uses curl with proper headers + backoff to avoid HTTP2 blocks.
Extracts: JSON-LD, semantic HTML, clean text, headings, tables, links.
"""

import subprocess
import json
import hashlib
import re
import os
import time
import sys
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

try:
    from bs4 import BeautifulSoup
except ImportError:
    os.system("pip install beautifulsoup4 lxml -q")
    from bs4 import BeautifulSoup

OUTPUT_DIR = Path("/app/.agents/fwo_data")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

SEEN_HASHES = set()

# All target pages (skip ones already done)
ALREADY_DONE_URLS = {
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

PAGES = [
    # Hours of work detail
    ("hours-of-work__detail",
     "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/hours-of-work"),
    # Leave
    ("leave__annual-taking",
     "https://www.fairwork.gov.au/leave/annual-leave/taking-annual-leave"),
    ("leave__sick-paid",
     "https://www.fairwork.gov.au/leave/sick-and-carers-leave/paid-sick-and-carers-leave"),
    ("leave__parental",
     "https://www.fairwork.gov.au/leave/parental-leave"),
    ("leave__family-domestic-violence",
     "https://www.fairwork.gov.au/leave/family-and-domestic-violence-leave"),
    # Pay
    ("pay__minimum-wages",
     "https://www.fairwork.gov.au/pay-and-wages/minimum-wages"),
    ("pay__allowances-overview",
     "https://www.fairwork.gov.au/pay-and-wages/allowances-penalty-rates-and-other-payments"),
    ("pay__penalty-rates",
     "https://www.fairwork.gov.au/pay-and-wages/allowances-penalty-rates-and-other-payments/penalty-rates"),
    ("pay__overtime",
     "https://www.fairwork.gov.au/pay-and-wages/allowances-penalty-rates-and-other-payments/overtime-pay"),
    ("pay__payslips",
     "https://www.fairwork.gov.au/pay-and-wages/paying-wages/pay-slips"),
    ("pay__record-keeping",
     "https://www.fairwork.gov.au/pay-and-wages/paying-wages/record-keeping"),
    ("pay__paying-wages",
     "https://www.fairwork.gov.au/pay-and-wages/paying-wages"),
    # Contracts
    ("contracts__overview",
     "https://www.fairwork.gov.au/employment-conditions/contracts"),
    # Casual employees
    ("employment__casual",
     "https://www.fairwork.gov.au/employee-entitlements/types-of-employees/casual-part-time-and-full-time/casual-employees"),
    # Ending employment
    ("ending__notice-final-pay",
     "https://www.fairwork.gov.au/ending-employment/notice-and-final-pay"),
    ("ending__final-pay",
     "https://www.fairwork.gov.au/ending-employment/notice-and-final-pay/final-pay"),
    ("ending__redundancy",
     "https://www.fairwork.gov.au/ending-employment/redundancy"),
    ("ending__unfair-dismissal",
     "https://www.fairwork.gov.au/ending-employment/unfair-dismissal"),
    # Public holidays
    ("conditions__public-holidays",
     "https://www.fairwork.gov.au/employment-conditions/public-holidays"),
    # Right to disconnect
    ("conditions__right-to-disconnect",
     "https://www.fairwork.gov.au/employment-conditions/hours-of-work-breaks-and-rosters/right-to-disconnect"),
    # Agreements
    ("conditions__agreements",
     "https://www.fairwork.gov.au/employment-conditions/agreements"),
    # Award classifications
    ("awards__classifications",
     "https://www.fairwork.gov.au/employment-conditions/awards/award-classifications"),
    # Fixed pay
    ("pay__annualised-salaries",
     "https://www.fairwork.gov.au/pay-and-wages/paying-wages/annual-salary"),
]


def slugify(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", s)[:80]


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def next_file_num() -> int:
    existing = list(OUTPUT_DIR.glob("*.json"))
    nums = []
    for f in existing:
        m = re.match(r"^(\d+)_", f.name)
        if m:
            nums.append(int(m.group(1)))
    return max(nums, default=0) + 1


def fetch_html(url: str, retries: int = 4, backoff: float = 3.0) -> str | None:
    """Fetch URL using curl with rotating user-agents and backoff."""
    user_agents = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    ]

    for attempt in range(retries):
        ua = user_agents[attempt % len(user_agents)]
        cmd = [
            "curl", "-s", "-L",
            "--max-time", "30",
            "--retry", "2",
            "--retry-delay", "2",
            "--http2",
            "-H", f"User-Agent: {ua}",
            "-H", "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "-H", "Accept-Language: en-AU,en;q=0.9",
            "-H", "Accept-Encoding: gzip, deflate, br",
            "-H", "Connection: keep-alive",
            "--compressed",
            url,
        ]
        try:
            result = subprocess.run(cmd, capture_output=True, timeout=40)
            if result.returncode == 0:
                html = result.stdout.decode("utf-8", errors="replace")
                if len(html) > 1000 and "<html" in html.lower():
                    return html
                print(f"  [WARN] Short response ({len(html)} chars) on attempt {attempt+1}")
            else:
                print(f"  [WARN] curl rc={result.returncode} on attempt {attempt+1}")
        except subprocess.TimeoutExpired:
            print(f"  [TIMEOUT] attempt {attempt+1}")
        except Exception as e:
            print(f"  [ERROR] {e}")

        wait = backoff * (2 ** attempt)
        print(f"  Backing off {wait:.0f}s...")
        time.sleep(wait)

    return None


def extract_jsonld(soup: BeautifulSoup) -> list:
    results = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
            results.append(data)
        except Exception:
            pass
    return results


def clean_text_from_soup(soup: BeautifulSoup) -> str:
    """Extract clean text from semantic content area."""
    # Try semantic containers first
    content = None
    for selector in ["main", "article", '[role="main"]']:
        content = soup.find(selector)
        if content:
            break

    if not content:
        content = soup.find("body")

    if not content:
        return ""

    # Remove nav, header, footer, scripts, styles
    for tag in content.find_all(["nav", "header", "footer", "script", "style", "noscript"]):
        tag.decompose()

    # Remove breadcrumb and sidebar-like elements
    for cls in ["breadcrumb", "sidebar", "nav-", "menu", "footer", "header"]:
        for tag in content.find_all(class_=re.compile(cls, re.I)):
            tag.decompose()

    lines = []
    for el in content.find_all(["p", "li", "h1", "h2", "h3", "h4", "td", "th", "dt", "dd"]):
        text = el.get_text(separator=" ", strip=True)
        if text and len(text) > 3:
            lines.append(text)

    # Deduplicate consecutive identical lines
    deduped = []
    prev = None
    for line in lines:
        if line != prev:
            deduped.append(line)
        prev = line

    return "\n".join(deduped)


def extract_headings(soup: BeautifulSoup) -> list:
    headings = []
    content = soup.find("main") or soup.find("article") or soup.find("body")
    if content:
        for tag in content.find_all(["h1", "h2", "h3", "h4"]):
            text = tag.get_text(strip=True)
            if len(text) > 2:
                headings.append({"level": tag.name.upper(), "text": text})
    return headings


def extract_tables(soup: BeautifulSoup) -> list:
    tables = []
    content = soup.find("main") or soup.find("article") or soup.find("body")
    if content:
        for table in content.find_all("table"):
            rows = []
            for tr in table.find_all("tr"):
                cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
                if any(cells):
                    rows.append(cells)
            if rows:
                tables.append(rows)
    return tables


def extract_links(soup: BeautifulSoup, base_url: str) -> list:
    links = []
    content = soup.find("main") or soup.find("article") or soup.find("body")
    if content:
        for a in content.find_all("a", href=True):
            href = a["href"]
            if href.startswith("/"):
                href = "https://www.fairwork.gov.au" + href
            text = a.get_text(strip=True)
            if "fairwork.gov.au" in href and len(text) > 2:
                links.append({"text": text, "href": href})
    # Deduplicate
    seen = set()
    deduped = []
    for l in links:
        if l["href"] not in seen:
            seen.add(l["href"])
            deduped.append(l)
    return deduped[:50]


def extract_meta(soup: BeautifulSoup) -> dict:
    meta = {}
    title_tag = soup.find("title")
    if title_tag:
        title = title_tag.get_text(strip=True)
        # Strip "| Fair Work Ombudsman" suffix
        title = re.sub(r"\s*[|\-–]\s*Fair Work.*$", "", title).strip()
        meta["title"] = title
    desc = soup.find("meta", attrs={"name": "description"})
    if desc:
        meta["description"] = desc.get("content", "")
    canonical = soup.find("link", rel="canonical")
    if canonical:
        meta["canonical"] = canonical.get("href", "")
    return meta


def scrape_page(slug: str, url: str) -> dict | None:
    if url in ALREADY_DONE_URLS:
        print(f"  [SKIP] Already scraped: {url}")
        return None

    print(f"\n{'='*60}")
    print(f"Fetching: {url}")

    html = fetch_html(url)
    if not html:
        print(f"  [FAIL] Could not fetch after retries")
        return None

    soup = BeautifulSoup(html, "lxml")

    # Extract all layers
    jsonld = extract_jsonld(soup)
    meta = extract_meta(soup)
    headings = extract_headings(soup)
    tables = extract_tables(soup)
    links = extract_links(soup, url)
    content = clean_text_from_soup(soup)

    if len(content) < 100:
        print(f"  [WARN] Very short content: {len(content)} chars — may be blocked")

    h = content_hash(content)
    if h in SEEN_HASHES:
        print(f"  [SKIP] Duplicate content")
        return None
    SEEN_HASHES.add(h)

    title = meta.get("title") or slug

    record = {
        "url": url,
        "canonical_url": meta.get("canonical") or url,
        "title": title,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "content_hash": h,
        "source_priority": "semantic_html",
        "meta": meta,
        "headings": headings,
        "tables": tables,
        "internal_links": links,
        "content": content,
    }
    if jsonld:
        record["jsonld"] = jsonld

    print(f"  [OK] Title: {title!r}")
    print(f"  [OK] Content: {len(content)} chars, Headings: {len(headings)}, Tables: {len(tables)}, Links: {len(links)}")
    if jsonld:
        print(f"  [OK] JSON-LD blocks: {len(jsonld)}")

    return record


def main():
    print(f"FWO Fetch Scraper")
    print(f"Output: {OUTPUT_DIR}")
    print(f"Pages to scrape: {len(PAGES)}")

    saved = 0
    skipped = 0
    errors = 0

    for slug, url in PAGES:
        try:
            record = scrape_page(slug, url)
            if record:
                num = next_file_num()
                out_path = OUTPUT_DIR / f"{num:03d}_{slug}.json"
                out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False))
                print(f"  [SAVED] {out_path.name}")
                saved += 1
                time.sleep(2.5)  # polite delay between requests
            else:
                skipped += 1
        except Exception as e:
            import traceback
            print(f"  [EXCEPTION] {url}: {e}")
            traceback.print_exc()
            errors += 1

    print(f"\n{'='*60}")
    print(f"DONE — Saved: {saved}, Skipped: {skipped}, Errors: {errors}")
    print(f"\nAll files in {OUTPUT_DIR}:")
    for f in sorted(OUTPUT_DIR.glob("*.json")):
        size = f.stat().st_size
        print(f"  {f.name} ({size:,} bytes)")


if __name__ == "__main__":
    main()
