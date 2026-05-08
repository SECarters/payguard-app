#!/usr/bin/env python3
"""
FWO Modern Award Full Clause Extractor
Downloads FWC consolidated award PDFs and extracts every Part, Clause, Subclause,
and Schedule as individual structured records ready for the ModernAward entity.

Usage:
  python3 award_extractor.py [MA_NUMBER]    # single award
  python3 award_extractor.py all            # all awards
  python3 award_extractor.py tier1          # top 20 awards by coverage

Output: JSON files in /tmp/award_records/<MA_NUMBER>.json
        Each file contains a list of records, one per clause/section.
"""

import pdfplumber, re, urllib.request, io, json, os, sys, time

AWARDS_DIR = '/tmp/award_records'
os.makedirs(AWARDS_DIR, exist_ok=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
}

# ─── CLAUSE TYPE CLASSIFIER ─────────────────────────────────────────────────

CLAUSE_TYPE_MAP = {
    'title': 'other',
    'definitions': 'definitions',
    'national employment standards': 'nes_reference',
    'coverage': 'coverage',
    'individual flexibility': 'individual_flexibility',
    'flexible working': 'individual_flexibility',
    'types of employment': 'employment_type',
    'full-time': 'employment_type',
    'part-time': 'employment_type',
    'casual employee': 'casual_loading',
    'casual employees': 'casual_loading',
    'classifications': 'classification',
    'ordinary hours': 'hours_of_work',
    'hours of work': 'hours_of_work',
    'rostering': 'rostering',
    'breaks': 'breaks',
    'minimum rates': 'minimum_rates',
    'minimum wage': 'minimum_rates',
    'junior rates': 'junior_rates',
    'junior employees': 'junior_rates',
    'payment of wages': 'payment_of_wages',
    'annualised wage': 'annualised_wage',
    'allowances': 'allowances',
    'superannuation': 'superannuation',
    'overtime': 'overtime',
    'penalty rates': 'penalty_rates',
    'shiftwork': 'shiftwork',
    'shift work': 'shiftwork',
    'annual leave': 'annual_leave',
    'sick': 'sick_leave',
    "carer's leave": 'sick_leave',
    'personal leave': 'sick_leave',
    'parental leave': 'parental_leave',
    'public holidays': 'public_holidays',
    'consultation': 'consultation',
    'dispute resolution': 'dispute_resolution',
    'termination': 'termination',
    'notice of termination': 'termination',
    'redundancy': 'redundancy',
    'workplace delegates': 'workplace_delegates',
    'right to disconnect': 'right_to_disconnect',
    'classification structure': 'schedule_classification',
    'summary of hourly rates': 'schedule_rates_summary',
    'summary of monetary allowances': 'schedule_allowances_summary',
    'supported wage': 'schedule_supported_wage',
    'time off instead of payment': 'schedule_toil_agreement',
    'annual leave in advance': 'schedule_leave_agreement',
    'cash out annual leave': 'schedule_leave_agreement',
}

EMPLOYMENT_TYPE_MAP = {
    'full-time': 'full_time',
    'full time': 'full_time',
    'part-time': 'part_time',
    'part time': 'part_time',
    'casual': 'casual',
    'shiftwork': 'shiftworker',
    'shift work': 'shiftworker',
    'junior': 'junior',
    'apprentice': 'apprentice',
}

INDUSTRY_MAP = {
    'MA000002': 'clerical_administrative',
    'MA000003': 'fast_food',
    'MA000004': 'retail',
    'MA000007': 'education_childcare',
    'MA000009': 'hospitality',
    'MA000010': 'manufacturing',
    'MA000014': 'education_childcare',
    'MA000016': 'security',
    'MA000018': 'aged_care',
    'MA000019': 'banking_finance',
    'MA000020': 'construction',
    'MA000022': 'cleaning',
    'MA000027': 'health_professionals',
    'MA000034': 'pharmacy',
    'MA000038': 'transport',
    'MA000065': 'professional_services',
    'MA000084': 'warehousing_wholesale',
    'MA000093': 'professional_services',
    'MA000100': 'community_disability',
    'MA000118': 'hospitality',
    'MA000119': 'hospitality',
}

AWARD_CODE_MAP = {
    'MA000002': 'clerks',
    'MA000003': 'fast_food',
    'MA000004': 'retail',
    'MA000007': 'childrens_services',
    'MA000009': 'hospitality',
    'MA000010': 'manufacturing',
    'MA000014': 'education_general_staff',
    'MA000016': 'security',
    'MA000018': 'aged_care',
    'MA000019': 'banking_finance',
    'MA000020': 'building_construction',
    'MA000022': 'cleaning',
    'MA000027': 'health_professionals',
    'MA000034': 'pharmacy',
    'MA000038': 'road_transport',
    'MA000065': 'professional_employees',
    'MA000084': 'storage_wholesale',
    'MA000093': 'architects',
    'MA000100': 'schads',
    'MA000118': 'registered_clubs',
    'MA000119': 'restaurant',
}

def classify_clause(title_lower):
    for keyword, ctype in CLAUSE_TYPE_MAP.items():
        if keyword in title_lower:
            return ctype
    return 'other'

def infer_employment_types(text_lower, clause_type):
    types = []
    if clause_type in ('minimum_rates', 'nes_reference', 'other', 'definitions', 'coverage'):
        return ['all']
    for keyword, etype in EMPLOYMENT_TYPE_MAP.items():
        if keyword in text_lower:
            if etype not in types:
                types.append(etype)
    return types if types else ['all']

def extract_rates_from_table(table):
    """Extract structured rate entries from a PDF table."""
    rates = []
    if not table or len(table) < 2:
        return rates
    for row in table[1:]:
        if not row: continue
        cells = [str(c or '').strip().replace('\n', ' ') for c in row]
        if not cells[0] or cells[0] == '$': continue
        dollar_vals = []
        for c in cells[1:]:
            clean = c.replace('$', '').replace(',', '').strip()
            if re.match(r'^\d{2,5}\.\d{2}$', clean):
                dollar_vals.append(float(clean))
        if dollar_vals and len(cells[0]) > 1:
            entry = {'classification': cells[0]}
            if len(dollar_vals) >= 2:
                val1, val2 = dollar_vals[0], dollar_vals[1]
                if val1 > 100:
                    entry['weekly_rate'] = val1
                    entry['hourly_rate'] = val2
                else:
                    entry['hourly_rate'] = val1
            elif len(dollar_vals) == 1:
                if dollar_vals[0] > 100:
                    entry['weekly_rate'] = dollar_vals[0]
                else:
                    entry['hourly_rate'] = dollar_vals[0]
            if entry.get('weekly_rate') and not entry.get('hourly_rate'):
                entry['hourly_rate'] = round(entry['weekly_rate'] / 38, 2)
            rates.append(entry)
    return rates

def extract_penalties_from_text(text):
    """Extract penalty rate entries from clause text."""
    penalties = []
    patterns = [
        r'(Monday to Friday|Saturday|Sunday|Public [Hh]oliday|Overtime|Early morning|Late night|[Mm]idnight)[^\n]*?(\d{3})(?:%|\s+per cent)',
        r'(\d{3}(?:\.\d+)?)\s*%\s+of[^\n]*(?:minimum|base|ordinary)',
    ]
    seen = set()
    for pattern in patterns:
        for m in re.finditer(pattern, text):
            groups = m.groups()
            key = m.group(0)[:50]
            if key not in seen:
                seen.add(key)
                if len(groups) == 2:
                    penalties.append({
                        'day_or_period': groups[0].strip() if groups[0] else '',
                        'percentage': float(groups[1]) if groups[1] else None,
                        'rate_multiplier': round(float(groups[1]) / 100, 2) if groups[1] else None,
                        'notes': m.group(0)[:120]
                    })
    return penalties

def extract_allowances_from_text(text):
    """Extract monetary allowances from clause text."""
    allowances = []
    pattern = r'([A-Za-z][^\n]{2,50})\s+\$\s*(\d+\.\d{2})\s+(?:per\s+)?(week|day|shift|hour|occasion|km|kilometre)'
    for m in re.finditer(pattern, text, re.IGNORECASE):
        allowances.append({
            'allowance_name': m.group(1).strip()[-80:],
            'amount': float(m.group(2)),
            'unit': m.group(3).lower(),
            'condition': '',
            'is_wage_related': False
        })
    return allowances

def extract_variation_history(text):
    """Extract PR variation references."""
    refs = re.findall(r'\[(?:Varied|Inserted|Substituted|Deleted)[^\]]{0,200}\]', text)
    return ' '.join(refs[:5])  # keep first 5

def extract_cross_refs(text):
    """Extract cross-references to other clauses."""
    refs = re.findall(r'clause\s+([\d]+[A-Z]?(?:\.\d+)?)', text, re.IGNORECASE)
    schedule_refs = re.findall(r'Schedule\s+([A-Z])', text)
    all_refs = list(set([f"clause {r}" for r in refs] + [f"Schedule {r}" for r in schedule_refs]))
    return all_refs[:10]

# ─── MAIN PARSER ─────────────────────────────────────────────────────────────

def parse_award_to_records(ma_number, award_name, pdf_bytes):
    """
    Parse a consolidated award PDF into individual clause records.
    Returns a list of dicts, each representing one clause/section.
    """
    records = []
    
    source_url = f"https://www.fwc.gov.au/documents/awards/pdf/{ma_number.lower()}.pdf"
    award_code = AWARD_CODE_MAP.get(ma_number, ma_number.lower())
    industry = INDUSTRY_MAP.get(ma_number, 'general')

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        total_pages = len(pdf.pages)

        # ── 1. Build full text + collect all tables per page ──────────────────
        pages_text = []
        pages_tables = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            pages_text.append(text)
            pages_tables.append(page.extract_tables() or [])

        full_text = "\n".join(pages_text)

        # ── 2. Extract award-level metadata ───────────────────────────────────
        amend_match = re.search(r'amendments up to and including\s+(\d+ \w+ \d{4})', full_text)
        last_amended = amend_match.group(1) if amend_match else None

        pr_match = re.search(r'amendments up to and including[^\(]+\(([^)]+)\)', full_text)
        last_amended_pr = pr_match.group(1) if pr_match else None

        # ── 3. Build Part map ─────────────────────────────────────────────────
        # Find "Part N—Title" in TOC and in body
        part_map = {}  # clause_num (str) -> (part_num, part_title)
        part_pattern = re.compile(
            r'^Part\s+(\d+)[—–\-]+\s*(.+?)(?:\s*\.{4,}.*)?$', re.MULTILINE
        )
        current_part_num = "1"
        current_part_title = "Application and Operation of this award"
        for m in part_pattern.finditer(full_text):
            pnum = m.group(1)
            ptitle = re.sub(r'\s*\.{4,}.*$', '', m.group(2)).strip()
            if ptitle and len(ptitle) > 3:
                part_map[pnum] = ptitle

        # ── 4. Split text into clauses ────────────────────────────────────────
        # Pattern: clause starts with "NN." or "NNA." on its own line followed by a title
        clause_split_pattern = re.compile(
            r'\n(\d+[A-Z]?)\.\s+([A-Z][^\n]{2,80})\n', re.MULTILINE
        )
        schedule_split_pattern = re.compile(
            r'\nSchedule\s+([A-Z]+)[—–\-]+\s*([^\n]+)\n', re.MULTILINE
        )

        # Find all clause start positions
        clause_starts = []
        for m in clause_split_pattern.finditer(full_text):
            clause_starts.append({
                'pos': m.start(),
                'number': m.group(1),
                'title': m.group(2).strip(),
                'is_schedule': False,
                'schedule_id': None,
            })

        # Find schedule starts
        sched_seen = set()
        for m in schedule_split_pattern.finditer(full_text):
            sid = m.group(1)
            stitle = m.group(2).strip()
            key = f"Sched_{sid}_{stitle[:20]}"
            if key not in sched_seen:
                sched_seen.add(key)
                clause_starts.append({
                    'pos': m.start(),
                    'number': f"Schedule {sid}",
                    'title': stitle,
                    'is_schedule': True,
                    'schedule_id': sid,
                })

        # Sort by position
        clause_starts.sort(key=lambda x: x['pos'])

        # Deduplicate (TOC entries vs body entries — keep those with most content)
        deduped = []
        seen_numbers = {}
        for cs in clause_starts:
            num = cs['number']
            if num not in seen_numbers:
                seen_numbers[num] = cs
                deduped.append(cs)
            else:
                # Keep the later one (body) if it has a longer text chunk
                prev = seen_numbers[num]
                if cs['pos'] > prev['pos']:
                    seen_numbers[num] = cs
                    # Replace in deduped
                    for i, d in enumerate(deduped):
                        if d['number'] == num:
                            deduped[i] = cs
                            break

        # Now extract text for each clause
        for i, cs in enumerate(deduped):
            start_pos = cs['pos']
            end_pos = deduped[i + 1]['pos'] if i + 1 < len(deduped) else len(full_text)
            clause_text = full_text[start_pos:end_pos].strip()

            # Skip if this looks like a TOC entry (very short or mostly dots)
            if len(clause_text) < 80 or clause_text.count('.') > len(clause_text) * 0.3:
                continue

            number = cs['number']
            title = cs['title']
            title_lower = title.lower()
            is_schedule = cs['is_schedule']
            schedule_id = cs['schedule_id']

            # Determine part
            if not is_schedule:
                # Use part_map: find which part this clause belongs to
                # Most awards have clauses 1-5 in Part 1, etc.
                # We do a simple ordered walk
                part_num = current_part_num
                part_title = part_map.get(current_part_num, '')
                # Try to find a Part heading in the text leading up to this clause
                preceding_text = full_text[max(0, start_pos - 200):start_pos]
                pm = re.search(r'Part\s+(\d+)[—–\-]+\s*([^\n]+)', preceding_text)
                if pm:
                    current_part_num = pm.group(1)
                    current_part_title = re.sub(r'\s*\.{4,}.*$', '', pm.group(2)).strip()
                    part_num = current_part_num
                    part_title = current_part_title
            else:
                part_num = "Schedule"
                part_title = "Schedules"

            # Classify
            clause_type = classify_clause(title_lower)
            if is_schedule:
                if 'classification' in title_lower or 'classification structure' in title_lower:
                    clause_type = 'schedule_classification'
                elif 'hourly rates' in title_lower or 'rates of pay' in title_lower:
                    clause_type = 'schedule_rates_summary'
                elif 'monetary allowances' in title_lower or 'allowances' in title_lower:
                    clause_type = 'schedule_allowances_summary'
                elif 'supported wage' in title_lower:
                    clause_type = 'schedule_supported_wage'
                elif 'time off' in title_lower:
                    clause_type = 'schedule_toil_agreement'
                elif 'annual leave' in title_lower:
                    clause_type = 'schedule_leave_agreement'
                elif 'cash out' in title_lower:
                    clause_type = 'schedule_leave_agreement'
                else:
                    clause_type = 'schedule_other'

            applies_to = infer_employment_types(clause_text.lower(), clause_type)

            # Extract structured data
            key_rates = []
            key_penalties = []
            key_allowances = []
            casual_loading = None

            # Find tables that fall within this clause's text range
            for page_tbls in pages_tables:
                for tbl in page_tbls:
                    if not tbl: continue
                    flat = ' '.join(str(c or '') for row in tbl for c in row)
                    # Check if table content appears in clause text
                    first_cell = str(tbl[0][0] if tbl[0] else '').strip()[:30]
                    if first_cell and first_cell in clause_text:
                        if clause_type in ('minimum_rates', 'junior_rates', 'schedule_rates_summary', 'penalty_rates', 'schedule_classification'):
                            extracted = extract_rates_from_table(tbl)
                            key_rates.extend(extracted)

            if clause_type in ('penalty_rates', 'overtime', 'shiftwork'):
                key_penalties = extract_penalties_from_text(clause_text)

            if clause_type in ('allowances', 'schedule_allowances_summary'):
                key_allowances = extract_allowances_from_text(clause_text)

            # Casual loading
            if clause_type in ('casual_loading', 'casual_employees', 'employment_type', 'minimum_rates'):
                cl_m = re.search(r'(\d+(?:\.\d+)?)\s*%\s*(?:casual\s+loading|loading)', clause_text, re.IGNORECASE)
                if cl_m:
                    casual_loading = float(cl_m.group(1))
                else:
                    cl_m2 = re.search(r'casual loading of (\d+(?:\.\d+)?)\s*(?:per cent|percent|%)', clause_text, re.IGNORECASE)
                    if cl_m2:
                        casual_loading = float(cl_m2.group(1))

            # Effective date
            eff_m = re.search(r'ppc\s+(\d{2}[A-Za-z]{3}\d{2,4}|\d+\s+\w+\s+\d{4})', clause_text)
            effective_date = eff_m.group(1) if eff_m else (last_amended or '01Jul25')

            variation_history = extract_variation_history(clause_text)
            cross_refs = extract_cross_refs(clause_text)
            
            # Notes: extract NOTE: lines
            notes_raw = re.findall(r'NOTE[^\n:]*:([^\n]+(?:\n[^\n]+)*?)(?=\nNOTE|\n\d+\.|\Z)', clause_text[:3000])
            notes = ' | '.join(n.strip()[:200] for n in notes_raw[:3])

            # Keywords
            keywords = ', '.join(filter(None, [
                ma_number, award_name, award_code, industry,
                f"part {part_num}", part_title,
                f"clause {number}", title,
                clause_type.replace('_', ' '),
                'fair work', 'modern award', 'australia',
            ]))

            record = {
                'ma_number': ma_number,
                'award_name': award_name,
                'award_code': award_code,
                'industry': industry,
                'last_amended': last_amended,
                'last_amended_pr': last_amended_pr,
                'source_url': source_url,
                'source_type': 'FWC_consolidated_award_PDF',
                'extracted_at': '2026-05-08',
                'part_number': str(part_num),
                'part_title': current_part_title if not is_schedule else 'Schedules',
                'clause_number': number,
                'clause_title': title,
                'clause_type': clause_type,
                'is_schedule': is_schedule,
                'schedule_identifier': schedule_id or '',
                'full_text': clause_text[:8000],  # cap at 8K chars
                'key_rates': key_rates[:30],
                'key_penalties': key_penalties[:20],
                'key_allowances': key_allowances[:20],
                'casual_loading_percent': casual_loading,
                'effective_date': effective_date,
                'variation_history': variation_history[:500],
                'notes': notes[:500],
                'cross_references': cross_refs,
                'applies_to_employment_types': applies_to,
                'searchable_keywords': keywords,
            }
            records.append(record)

    return records


# ─── AWARD LIST ───────────────────────────────────────────────────────────────

ALL_AWARDS = [
    ("MA000002", "Clerks—Private Sector Award 2020"),
    ("MA000009", "Hospitality Industry (General) Award 2020"),
    ("MA000004", "General Retail Industry Award 2020"),
    ("MA000003", "Fast Food Industry Award 2010"),
    ("MA000100", "Social, Community, Home Care and Disability Services Industry Award 2010"),
    ("MA000020", "Building and Construction General On-site Award 2020"),
    ("MA000065", "Professional Employees Award 2020"),
    ("MA000038", "Road Transport and Distribution Award 2020"),
    ("MA000010", "Manufacturing and Associated Industries and Occupations Award 2020"),
    ("MA000018", "Aged Care Award 2010"),
    ("MA000119", "Restaurant Industry Award 2020"),
    ("MA000022", "Cleaning Services Award 2020"),
    ("MA000027", "Health Professionals and Support Services Award 2020"),
    ("MA000016", "Security Services Industry Award 2020"),
    ("MA000084", "Storage Services and Wholesale Award 2020"),
    ("MA000034", "Pharmacy Industry Award 2020"),
    ("MA000014", "Educational Services (Schools) General Staff Award 2020"),
    ("MA000007", "Children's Services Award 2010"),
    ("MA000118", "Registered and Licensed Clubs Award 2020"),
    ("MA000093", "Architects Award 2020"),
    # Tier 2
    ("MA000019", "Banking, Finance and Insurance Award 2020"),
    ("MA000011", "Electrical, Electronic and Communications Contracting Award 2020"),
    ("MA000015", "Hair and Beauty Industry Award 2010"),
    ("MA000056", "Real Estate Industry Award 2020"),
    ("MA000030", "Amusement, Events and Recreation Award 2020"),
    ("MA000025", "Contract Call Centres Award 2020"),
    ("MA000046", "Medical Practitioners Award 2020"),
    ("MA000049", "Nursery Award 2020"),
    ("MA000031", "Passenger Vehicle Transportation Award 2020"),
    ("MA000028", "Higher Education Industry—General Staff—Award 2020"),
    ("MA000029", "Higher Education Industry—Academic Staff—Award 2020"),
    ("MA000071", "Telecommunications Services Award 2020"),
    ("MA000044", "Gardening and Landscaping Services Award 2020"),
    ("MA000045", "Meat Industry Award 2020"),
    ("MA000039", "Road Transport (Long Distance Operations) Award 2020"),
    ("MA000073", "Waste Management Award 2020"),
    ("MA000080", "Paper, Printing and Stationery Award 2020"),
    ("MA000082", "Sporting Organisations Award 2020"),
    ("MA000055", "Quarrying Award 2020"),
    ("MA000041", "Sugar Industry Award 2010"),
    ("MA000043", "Textile, Clothing, Footwear and Associated Industries Award 2010"),
    ("MA000013", "Graphic Arts, Printing and Publishing Award 2010"),
    ("MA000012", "Fitness Industry Award 2010"),
    ("MA000021", "Business Equipment Award 2010"),
    ("MA000059", "Electrical Power Industry Award 2020"),
    ("MA000069", "Stevedoring Industry Award 2020"),
    ("MA000074", "Water Industry Award 2020"),
    ("MA000075", "Wine Industry Award 2020"),
    ("MA000091", "Aluminium Industry Award 2020"),
    ("MA000092", "Animal Care and Veterinary Services Award 2020"),
    ("MA000094", "Asphalt Industry Award 2020"),
    ("MA000096", "Book Industry Award 2020"),
    ("MA000098", "Cement, Lime and Quarrying Award 2020"),
    ("MA000089", "Vehicle Repair, Services and Retail Award 2020"),
    ("MA000032", "Pest Control Industry Award 2020"),
    ("MA000033", "Plumbing and Fire Sprinklers Award 2020"),
    ("MA000047", "Miscellaneous Award 2020"),
    ("MA000053", "Poultry Processing Award 2010"),
    ("MA000058", "Dry Cleaning and Laundry Industry Award 2010"),
    ("MA000060", "Grain Handling Award 2020"),
    ("MA000061", "Funeral Industry Award 2020"),
    ("MA000062", "Gas Industry Award 2020"),
    ("MA000064", "Port Authorities Award 2020"),
    ("MA000066", "Racing Industry Employees Award 2020"),
    ("MA000067", "Rail Industry Award 2020"),
    ("MA000070", "Surveying Award 2020"),
    ("MA000076", "Wool, Hide and Pelt Industry Award 2020"),
    ("MA000077", "Vehicle Manufacturing, Repair, Services and Retail Award 2020"),
    ("MA000078", "Pharmacy Industry Award 2020"),
    ("MA000081", "Silviculture Award 2020"),
    ("MA000083", "State Government Agencies Award 2010"),
    ("MA000085", "Sugar Industry Award 2010"),
    ("MA000086", "Travelling Shows Award 2020"),
    ("MA000090", "Wool Storage, Sampling and Testing Award 2020"),
    ("MA000101", "Coal Industry Award 2010"),
    ("MA000102", "Commercial Sales Award 2020"),
    ("MA000104", "Miscellaneous Award 2020"),
    ("MA000107", "Food, Beverage and Tobacco Manufacturing Award 2020"),
    ("MA000108", "Marine Tourism and Charter Vessels Award 2020"),
    ("MA000109", "Mobile Crane Hiring Award 2020"),
    ("MA000115", "Aboriginal and Torres Strait Islander Health Workers Award 2020"),
    ("MA000117", "Real Estate Industry Award 2020"),
    ("MA000120", "Children's Services Award 2010"),
    ("MA000122", "Aquaculture Industry Award 2020"),
    ("MA000008", "Horticulture Award 2020"),
    ("MA000035", "Pastoral Award 2020"),
    ("MA000042", "Supported Employment Services Award 2020"),
    ("MA000051", "Outdoor Hospitality Industry Award 2020"),
    ("MA000099", "Cemetery Industry Award 2020"),
    ("MA000057", "Premix Concrete Award 2020"),
    ("MA000113", "Plumbing and Fire Sprinklers Award 2020"),
    ("MA000006", "Broadcasting, Recorded Entertainment and Cinemas Award 2020"),
]

TIER1 = ALL_AWARDS[:20]


def process_award(ma_number, award_name):
    out_path = os.path.join(AWARDS_DIR, f'{ma_number.lower()}_records.json')
    if os.path.exists(out_path):
        with open(out_path) as f:
            existing = json.load(f)
        print(f"  {ma_number}: already extracted ({len(existing)} records) — skipping")
        return existing

    url = f"https://www.fwc.gov.au/documents/awards/pdf/{ma_number.lower()}.pdf"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            pdf_bytes = resp.read()
        if pdf_bytes[:4] != b'%PDF':
            print(f"  {ma_number}: NOT a PDF — skipping")
            return []
        records = parse_award_to_records(ma_number, award_name, pdf_bytes)
        with open(out_path, 'w') as f:
            json.dump(records, f, indent=2)
        print(f"  {ma_number}: {len(records)} clause records extracted → {out_path}")
        return records
    except Exception as e:
        print(f"  {ma_number}: FAILED — {e}")
        return []


if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else 'tier1'

    if arg == 'all':
        target = ALL_AWARDS
    elif arg == 'tier1':
        target = TIER1
    else:
        target = [(a, n) for a, n in ALL_AWARDS if a.upper() == arg.upper()]
        if not target:
            print(f"Unknown award: {arg}")
            sys.exit(1)

    print(f"Processing {len(target)} awards...")
    total_records = 0
    for ma, name in target:
        records = process_award(ma, name)
        total_records += len(records)
        time.sleep(0.3)

    print(f"\nDone. Total records extracted: {total_records}")
    print(f"Output directory: {AWARDS_DIR}")
