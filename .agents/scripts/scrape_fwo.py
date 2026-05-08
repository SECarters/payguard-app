#!/usr/bin/env python3
"""
Fair Work Ombudsman — Employment Conditions recursive scraper.
Crawls every page under /employment-conditions and saves content to local JSON files.
"""

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import json
import os
import time
import re
from datetime import datetime

BASE_URL = "https://www.fairwork.gov.au"
START_URL = "https://www.fairwork.gov.au/employment-conditions"
OUTPUT_DIR = "/app/.agents/fwo_data"
os.makedirs(OUTPUT_DIR, exist_ok=True)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PayGuardResearch/1.0; +https://payguard.com.au)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-AU,en;q=0.9",
}

visited = set()
all_pages = []
failed = []

def clean_text(text):
    """Clean whitespace from extracted text."""
    lines = [l.strip() for l in text.splitlines()]
    lines = [l for l in lines if l]
    return "\n".join(lines)

def is_valid_url(url):
    """Check if URL is within the employment-conditions section."""
    parsed = urlparse(url)
    return (
        parsed.netloc == "www.fairwork.gov.au"
        and "/employment-conditions" in parsed.path
        and not parsed.path.endswith(('.pdf', '.doc', '.docx', '.xlsx', '.csv'))
        and "#" not in url
        and "?" not in url
    )

def scrape_page(url):
    """Scrape a single page and return structured data."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        if resp.status_code != 200:
            print(f"  [SKIP] {resp.status_code} — {url}")
            failed.append({"url": url, "status": resp.status_code})
            return None, []

        soup = BeautifulSoup(resp.text, "html.parser")

        # Extract title
        title_el = soup.find("h1")
        title = title_el.get_text(strip=True) if title_el else ""

        # Extract main content area
        main = (
            soup.find("main")
            or soup.find("div", class_=re.compile(r"content|main|body", re.I))
            or soup.find("article")
        )

        if not main:
            main = soup.find("body")

        # Remove nav, footer, sidebar, scripts, styles
        for tag in main.find_all(["nav", "footer", "script", "style", "aside", "header"]):
            tag.decompose()
        for tag in main.find_all(class_=re.compile(r"nav|menu|footer|sidebar|breadcrumb|cookie|share|social|feedback|subscribe", re.I)):
            tag.decompose()

        # Extract structured content
        content_text = clean_text(main.get_text(separator="\n"))

        # Extract all headings for structure
        headings = []
        for h in main.find_all(["h1","h2","h3","h4"]):
            headings.append({"level": h.name, "text": h.get_text(strip=True)})

        # Extract all internal links from this page (for recursive crawl)
        links = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            full_url = urljoin(BASE_URL, href)
            if is_valid_url(full_url) and full_url not in visited:
                links.append(full_url)

        # Extract any tables
        tables = []
        for table in main.find_all("table"):
            rows = []
            for tr in table.find_all("tr"):
                row = [td.get_text(strip=True) for td in tr.find_all(["td","th"])]
                if row:
                    rows.append(row)
            if rows:
                tables.append(rows)

        page_data = {
            "url": url,
            "title": title,
            "scraped_at": datetime.utcnow().isoformat(),
            "headings": headings,
            "content": content_text,
            "tables": tables,
            "child_links_found": len(links),
        }

        return page_data, list(set(links))

    except Exception as e:
        print(f"  [ERROR] {url} — {e}")
        failed.append({"url": url, "error": str(e)})
        return None, []

def slugify(url):
    """Convert URL to safe filename."""
    path = urlparse(url).path.strip("/").replace("/", "__")
    return path or "index"

def crawl():
    queue = [START_URL]
    visited.add(START_URL)

    print(f"Starting crawl from: {START_URL}")
    print(f"Output directory: {OUTPUT_DIR}\n")

    page_count = 0

    while queue:
        url = queue.pop(0)
        print(f"[{page_count+1}] Scraping: {url}")

        page_data, child_links = scrape_page(url)

        if page_data:
            page_count += 1
            all_pages.append({
                "url": url,
                "title": page_data["title"],
                "slug": slugify(url),
            })

            # Save individual page file
            filename = slugify(url) + ".json"
            filepath = os.path.join(OUTPUT_DIR, filename)
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(page_data, f, ensure_ascii=False, indent=2)

            print(f"  ✓ Saved: {filename} | Title: {page_data['title'][:60]} | {len(child_links)} new links found")

            # Add new links to queue
            for link in child_links:
                if link not in visited:
                    visited.add(link)
                    queue.append(link)

        # Polite delay — don't hammer the server
        time.sleep(1.2)

    print(f"\n{'='*60}")
    print(f"CRAWL COMPLETE")
    print(f"Pages scraped successfully: {page_count}")
    print(f"Pages failed: {len(failed)}")
    print(f"Total URLs visited: {len(visited)}")

    # Save master index
    index = {
        "scraped_at": datetime.utcnow().isoformat(),
        "total_pages": page_count,
        "failed_count": len(failed),
        "pages": all_pages,
        "failed": failed,
    }
    with open(os.path.join(OUTPUT_DIR, "_index.json"), "w") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)

    print(f"Index saved to: {OUTPUT_DIR}/_index.json")
    return page_count, len(failed)

if __name__ == "__main__":
    crawl()
