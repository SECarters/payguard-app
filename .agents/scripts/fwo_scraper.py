#!/usr/bin/env python3
"""
Fair Work Ombudsman — Employment Conditions full recursive scraper.
Uses Playwright (headless Chromium) to crawl all pages under /employment-conditions.
Saves each page as a JSON file and produces a master index.
"""

import asyncio
import json
import os
import re
import time
from datetime import datetime
from urllib.parse import urljoin, urlparse

from playwright.async_api import async_playwright

BASE_URL = "https://www.fairwork.gov.au"
START_URL = "https://www.fairwork.gov.au/employment-conditions"
OUTPUT_DIR = "/app/.agents/fwo_data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# All pages must start with this prefix
REQUIRED_PREFIX = "/employment-conditions"

# Extensions/paths to skip
SKIP_EXTENSIONS = ('.pdf', '.doc', '.docx', '.xlsx', '.csv', '.zip', '.xls')
SKIP_PATTERNS = [
    '/tools-and-resources/calculate-pay',
    '/tools-and-resources/templates',
    '/contact-us',
    '/about-us',
    '/newsroom',
    '/ArticleDocuments',
    'javascript:',
    'mailto:',
    '/find-my-award',   # Interactive tool, not content
    '/pay-and-conditions',  # External calculator
]

visited = set()
all_pages = []
failed = []


def is_valid_url(url):
    """Check if URL should be crawled."""
    parsed = urlparse(url)
    if parsed.netloc != "www.fairwork.gov.au":
        return False
    if not parsed.path.startswith(REQUIRED_PREFIX):
        return False
    if any(parsed.path.endswith(ext) for ext in SKIP_EXTENSIONS):
        return False
    if any(pat in url for pat in SKIP_PATTERNS):
        return False
    # Remove fragments and query strings for deduplication
    clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    return clean not in visited


def clean_url(url):
    """Normalise URL — strip fragments and query strings."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip('/')


def slugify(url):
    """Convert URL to safe filename."""
    path = urlparse(url).path.strip("/").replace("/", "__")
    return (path or "index")[:120]


def clean_text(text):
    """Clean extracted text."""
    lines = [l.strip() for l in text.splitlines()]
    lines = [l for l in lines if l]
    # Deduplicate consecutive identical lines (nav repetition)
    deduped = []
    prev = None
    for l in lines:
        if l != prev:
            deduped.append(l)
        prev = l
    return "\n".join(deduped)


async def scrape_page(page, url):
    """Load a page and extract all content + child links."""
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(1500)  # Let JS settle

        # Extract title
        title = await page.title()
        h1 = await page.query_selector("h1")
        if h1:
            title = (await h1.inner_text()).strip()

        # Extract main content — try multiple selectors
        content = ""
        for selector in ["main", ".content-area", ".field-items", "article", "#content", ".page-content"]:
            el = await page.query_selector(selector)
            if el:
                content = await el.inner_text()
                break

        if not content:
            body = await page.query_selector("body")
            if body:
                content = await body.inner_text()

        content = clean_text(content)

        # Extract headings structure
        headings = []
        for tag in ["h1", "h2", "h3", "h4"]:
            els = await page.query_selector_all(tag)
            for el in els:
                text = (await el.inner_text()).strip()
                if text:
                    headings.append({"level": tag, "text": text})

        # Extract tables
        tables = []
        table_els = await page.query_selector_all("table")
        for tbl in table_els:
            rows = []
            row_els = await tbl.query_selector_all("tr")
            for row_el in row_els:
                cells = await row_el.query_selector_all("td, th")
                row_data = []
                for cell in cells:
                    row_data.append((await cell.inner_text()).strip())
                if row_data:
                    rows.append(row_data)
            if rows:
                tables.append(rows)

        # Extract all internal links
        link_els = await page.query_selector_all("a[href]")
        child_links = []
        for el in link_els:
            href = await el.get_attribute("href")
            if not href:
                continue
            full_url = clean_url(urljoin(BASE_URL, href))
            if is_valid_url(full_url) and full_url not in visited:
                child_links.append(full_url)

        # Extract in-page navigation anchors to find sub-sections
        on_page_sections = []
        for el in await page.query_selector_all("a[href^='#']"):
            text = (await el.inner_text()).strip()
            if text:
                on_page_sections.append(text)

        return {
            "url": url,
            "title": title,
            "scraped_at": datetime.utcnow().isoformat() + "Z",
            "headings": headings,
            "on_page_sections": on_page_sections,
            "content": content,
            "tables": tables,
            "word_count": len(content.split()),
        }, list(set(child_links))

    except Exception as e:
        print(f"  [ERROR] {url} — {e}")
        failed.append({"url": url, "error": str(e)})
        return None, []


async def crawl():
    print(f"=" * 70)
    print(f"FWO Employment Conditions — Full Recursive Scraper")
    print(f"Start URL: {START_URL}")
    print(f"Output: {OUTPUT_DIR}")
    print(f"=" * 70)

    queue = [clean_url(START_URL)]
    visited.add(clean_url(START_URL))

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (compatible; PayGuardResearch/1.0)",
            viewport={"width": 1280, "height": 800},
        )
        page = await context.new_page()

        page_count = 0

        while queue:
            url = queue.pop(0)
            page_count_attempt = page_count + 1
            print(f"\n[{page_count_attempt}] → {url}")

            data, child_links = await scrape_page(page, url)

            if data:
                page_count += 1
                slug = slugify(url)
                filename = f"{str(page_count).zfill(3)}_{slug}.json"
                filepath = os.path.join(OUTPUT_DIR, filename)

                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                all_pages.append({
                    "index": page_count,
                    "url": url,
                    "title": data["title"],
                    "slug": slug,
                    "filename": filename,
                    "word_count": data["word_count"],
                    "tables_found": len(data["tables"]),
                    "child_links_found": len(child_links),
                })

                print(f"  ✓ [{page_count}] \"{data['title']}\" | {data['word_count']} words | {len(child_links)} new links | {len(data['tables'])} tables")

                for link in child_links:
                    if link not in visited:
                        visited.add(link)
                        queue.append(link)
                        print(f"    + queued: {link}")
            else:
                print(f"  ✗ FAILED")

            # Polite delay
            await asyncio.sleep(1.0)

        await browser.close()

    # Save master index
    index = {
        "scraped_at": datetime.utcnow().isoformat() + "Z",
        "source": START_URL,
        "total_pages_scraped": page_count,
        "total_urls_visited": len(visited),
        "failed_count": len(failed),
        "pages": all_pages,
        "failed": failed,
    }

    index_path = os.path.join(OUTPUT_DIR, "_index.json")
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"\n{'=' * 70}")
    print(f"CRAWL COMPLETE")
    print(f"Pages scraped: {page_count}")
    print(f"Failed: {len(failed)}")
    print(f"Total URLs discovered: {len(visited)}")
    print(f"Index saved: {index_path}")
    print(f"{'=' * 70}")

    return page_count, len(failed)


if __name__ == "__main__":
    asyncio.run(crawl())
