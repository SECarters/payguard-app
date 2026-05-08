#!/usr/bin/env python3
"""
FWO Corpus Loader
Loads and validates the FWO knowledge corpus, returning structured facts for audit use.
Usage: python3 run.py [topics]
       topics: optional comma-separated list e.g. "superannuation,overtime"
"""

import json
import os
import sys
import hashlib

CORPUS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'fwo_data')
CORPUS_DIR = os.path.abspath(CORPUS_DIR)
MASTER_INDEX_PATH = os.path.join(CORPUS_DIR, '_MASTER_INDEX.json')

def md5_file(path):
    with open(path, 'rb') as f:
        return hashlib.md5(f.read()).hexdigest()

def load_corpus(topics_filter=None):
    result = {
        'status': 'ok',
        'warnings': [],
        'corpus_meta': {},
        'files_checked': 0,
        'files_missing': [],
        'integrity_failures': [],
        'key_facts': {},
        'topic_map': {},
        'files_for_topics': {},
        'raw_content_available': [],
    }

    # Load master index
    if not os.path.exists(MASTER_INDEX_PATH):
        result['status'] = 'error'
        result['warnings'].append('CRITICAL: _MASTER_INDEX.json not found. Corpus may not be built.')
        return result

    with open(MASTER_INDEX_PATH) as f:
        master = json.load(f)

    result['corpus_meta'] = master.get('corpus_meta', {})
    result['topic_map'] = master.get('topic_map', {})

    # Determine which files to load
    file_index = master.get('file_index', {})
    all_key_facts = master.get('key_facts', {})

    if topics_filter:
        topics = [t.strip() for t in topics_filter.split(',')]
        relevant_file_ids = set()
        for topic in topics:
            matched = master.get('topic_map', {}).get(topic, [])
            if not matched:
                result['warnings'].append(f"Topic '{topic}' not found in topic_map. Available: {list(master['topic_map'].keys())}")
            relevant_file_ids.update(matched)
            result['files_for_topics'][topic] = matched
    else:
        relevant_file_ids = set(file_index.keys())

    # Check files exist and validate integrity
    for file_id in sorted(relevant_file_ids):
        info = file_index.get(file_id)
        if not info:
            result['warnings'].append(f"File ID '{file_id}' in topic map but not in file_index")
            continue

        path = os.path.join(CORPUS_DIR, info['file'])
        if not os.path.exists(path):
            result['files_missing'].append(file_id)
            result['status'] = 'degraded'
            continue

        result['files_checked'] += 1

        # Integrity check
        current_hash = md5_file(path)
        stored_hash = info.get('md5', '')
        if stored_hash and current_hash != stored_hash:
            result['integrity_failures'].append({
                'file_id': file_id,
                'file': info['file'],
                'stored_md5': stored_hash,
                'current_md5': current_hash,
                'warning': 'File has been modified since index was built'
            })

        # Load key facts
        if file_id in all_key_facts:
            result['key_facts'][file_id] = {
                'title': info['title'],
                'source_url': info['canonical_url'],
                'scraped_at': info['scraped_at'],
                'facts': all_key_facts[file_id]
            }

        result['raw_content_available'].append({
            'file_id': file_id,
            'title': info['title'],
            'file_path': f".agents/fwo_data/{info['file']}",
            'source_url': info['canonical_url'],
        })

    if result['files_missing']:
        result['warnings'].append(f"MISSING FILES: {result['files_missing']}")
    if result['integrity_failures']:
        result['warnings'].append(f"INTEGRITY WARNING: {len(result['integrity_failures'])} file(s) modified since index built")
        result['status'] = 'integrity_warning'

    return result


def main():
    topics_filter = sys.argv[1] if len(sys.argv) > 1 else None
    result = load_corpus(topics_filter)

    print("=" * 70)
    print("FWO CORPUS LOADER")
    print("=" * 70)
    print(f"Status: {result['status'].upper()}")
    meta = result['corpus_meta']
    print(f"Built:  {meta.get('built_at','unknown')}")
    print(f"Files:  {result['corpus_meta'].get('total_files','?')} total | {result['files_checked']} loaded this run")
    print(f"Source: {meta.get('source','unknown')}")
    print(f"Note:   {meta.get('currency_note','')}")
    print()

    if result['warnings']:
        print("⚠️  WARNINGS:")
        for w in result['warnings']:
            print(f"   {w}")
        print()

    if result['integrity_failures']:
        print("🔴 INTEGRITY FAILURES:")
        for f in result['integrity_failures']:
            print(f"   {f['file_id']}: {f['warning']}")
        print()

    if topics_filter:
        print(f"Topics requested: {topics_filter}")
        print(f"Files for topics:")
        for topic, fids in result['files_for_topics'].items():
            print(f"  {topic}: {fids}")
        print()

    print(f"KEY FACTS LOADED ({len(result['key_facts'])} files):")
    print("-" * 70)
    for file_id, info in sorted(result['key_facts'].items()):
        print(f"\n[{file_id}] {info['title']}")
        print(f"  Source: {info['source_url']}")
        print(f"  Scraped: {info['scraped_at']}")
        for k, v in info['facts'].items():
            print(f"  {k}: {v}")

    print()
    print(f"RAW CONTENT AVAILABLE (read these files for full detail):")
    for item in result['raw_content_available']:
        print(f"  {item['file_id']} → {item['file_path']}")

    print()
    print("=" * 70)
    print("CORPUS LOAD COMPLETE")
    print("=" * 70)

    # Also output as JSON for programmatic use
    with open('/tmp/fwo_corpus_loaded.json', 'w') as f:
        json.dump(result, f, indent=2)
    print(f"\nFull result saved to /tmp/fwo_corpus_loaded.json")


if __name__ == '__main__':
    main()
