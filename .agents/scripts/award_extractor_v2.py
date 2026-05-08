#!/usr/bin/env python3
"""
FWO Modern Award Clause Extractor v2
Downloads FWC consolidated award PDFs and extracts every Part, Clause and Schedule
as individual structured records for the ModernAward entity.
This version properly handles page-level table extraction and rate table linking.
"""

import pdfplumber, re, io, urllib.request, json, os, sys, time

AWARDS_DIR = '/tmp/award_records'
os.makedirs(AWARDS_DIR, exist_ok=True)

HEADERS = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'}

# ── Lookup tables ──────────────────────────────────────────────────────────────

CLAUSE_TYPE_MAP = [
    (['definitions'], 'definitions'),
    (['national employment standards', 'nes and this award'], 'nes_reference'),
    (['coverage'], 'coverage'),
    (['individual flexibility', 'flexible working arrangements'], 'individual_flexibility'),
    (['types of employment'], 'employment_type'),
    (['full-time employees'], 'employment_type'),
    (['part-time employees'], 'employment_type'),
    (['casual employees'], 'casual_loading'),
    (['classifications', 'classification structure'], 'classification'),
    (['ordinary hours of work', 'hours of work'], 'hours_of_work'),
    (['consultation about changes to rosters'], 'rostering'),
    (['rostering arrangements', 'rostering'], 'rostering'),
    (['breaks'], 'breaks'),
    (['minimum rates', 'minimum wage'], 'minimum_rates'),
    (['junior rates', 'junior employees'], 'junior_rates'),
    (['payment of wages'], 'payment_of_wages'),
    (['annualised wage'], 'annualised_wage'),
    (['allowances'], 'allowances'),
    (['superannuation'], 'superannuation'),
    (['overtime'], 'overtime'),
    (['rest period after working overtime'], 'overtime'),
    (['time off instead of payment for overtime'], 'overtime'),
    (['penalty rates'], 'penalty_rates'),
    (['shiftwork', 'shift work'], 'shiftwork'),
    (['annual leave'], 'annual_leave'),
    (['sick', "carer's leave", 'personal leave'], 'sick_leave'),
    (['parental leave'], 'parental_leave'),
    (['public holidays'], 'public_holidays'),
    (['consultation about major workplace'], 'consultation'),
    (['dispute resolution'], 'dispute_resolution'),
    (['termination of employment', 'notice of termination'], 'termination'),
    (['redundancy'], 'redundancy'),
    (['workplace delegates'], 'workplace_delegates'),
    (['right to disconnect'], 'right_to_disconnect'),
    (['facilitative provisions'], 'other'),
    (['application of part'], 'other'),
]

SCHED_TYPE_MAP = [
    (['classification structure', 'classification'], 'schedule_classification'),
    (['summary of hourly rates', 'rates of pay'], 'schedule_rates_summary'),
    (['summary of monetary allowances', 'monetary allowances'], 'schedule_allowances_summary'),
    (['supported wage'], 'schedule_supported_wage'),
    (['time off instead of payment'], 'schedule_toil_agreement'),
    (['annual leave in advance', 'take annual leave'], 'schedule_leave_agreement'),
    (['cash out annual leave'], 'schedule_leave_agreement'),
]

INDUSTRY_MAP = {
    'MA000002': 'clerical_administrative', 'MA000003': 'fast_food',
    'MA000004': 'retail', 'MA000007': 'education_childcare',
    'MA000009': 'hospitality', 'MA000010': 'manufacturing',
    'MA000014': 'education_childcare', 'MA000016': 'security',
    'MA000018': 'aged_care', 'MA000019': 'banking_finance',
    'MA000020': 'construction', 'MA000022': 'cleaning',
    'MA000027': 'health_professionals', 'MA000034': 'pharmacy',
    'MA000038': 'transport', 'MA000065': 'professional_services',
    'MA000084': 'warehousing_wholesale', 'MA000093': 'professional_services',
    'MA000100': 'community_disability', 'MA000118': 'hospitality',
    'MA000119': 'hospitality', 'MA000011': 'electrical',
    'MA000015': 'hair_beauty', 'MA000019': 'banking_finance',
    'MA000025': 'call_centre', 'MA000028': 'higher_education',
    'MA000029': 'higher_education', 'MA000030': 'amusement_recreation',
    'MA000031': 'transport', 'MA000046': 'medical',
    'MA000056': 'real_estate', 'MA000071': 'telecommunications',
}

AWARD_CODES = {
    'MA000002': 'clerks', 'MA000003': 'fast_food', 'MA000004': 'retail',
    'MA000007': 'childrens_services', 'MA000009': 'hospitality',
    'MA000010': 'manufacturing', 'MA000014': 'education_general_staff',
    'MA000016': 'security', 'MA000018': 'aged_care',
    'MA000019': 'banking_finance', 'MA000020': 'building_construction',
    'MA000022': 'cleaning', 'MA000027': 'health_professionals',
    'MA000034': 'pharmacy', 'MA000038': 'road_transport',
    'MA000065': 'professional_employees', 'MA000084': 'storage_wholesale',
    'MA000093': 'architects', 'MA000100': 'schads',
    'MA000118': 'registered_clubs', 'MA000119': 'restaurant',
}


def classify_clause(title_lower, is_schedule=False):
    if is_schedule:
        for keywords, ctype in SCHED_TYPE_MAP:
            if any(k in title_lower for k in keywords):
                return ctype
        return 'schedule_other'
    for keywords, ctype in CLAUSE_TYPE_MAP:
        if any(k in title_lower for k in keywords):
            return ctype
    return 'other'


def infer_employment_types(title_lower, text_lower):
    types = set()
    if 'full-time' in title_lower or 'full time' in text_lower[:200]:
        types.add('full_time')
    if 'part-time' in title_lower or 'part time' in text_lower[:200]:
        types.add('part_time')
    if 'casual' in title_lower or 'casual' in text_lower[:200]:
        types.add('casual')
    if 'shiftwork' in title_lower or 'shiftworker' in text_lower[:200]:
        types.add('shiftworker')
    if 'junior' in title_lower or 'junior' in text_lower[:200]:
        types.add('junior')
    if 'apprentice' in title_lower or 'apprentice' in text_lower[:200]:
        types.add('apprentice')
    return list(types) if types else ['all']


def parse_rate_table(table):
    """Parse a PDF table into structured rate entries."""
    rates = []
    if not table or len(table) < 2:
        return rates
    # Find header to understand columns
    header_row = [str(c or '').strip().lower().replace('\n', ' ') for c in table[0]]
    col_types = []
    for h in header_row:
        if 'classif' in h or h == '':
            col_types.append('classification')
        elif 'week' in h:
            col_types.append('weekly')
        elif 'hour' in h or 'monday' in h or 'ordinary' in h:
            col_types.append('hourly')
        elif 'saturday' in h:
            col_types.append('saturday')
        elif 'sunday' in h:
            col_types.append('sunday')
        elif 'public' in h or 'holiday' in h:
            col_types.append('public_holiday')
        elif 'afternoon' in h or 'night' in h:
            col_types.append('shift_penalty')
        elif 'casual' in h:
            col_types.append('casual')
        elif 'overtime' in h or 'after 2' in h or 'first 2' in h:
            col_types.append('overtime')
        else:
            col_types.append('other')

    for row in table[1:]:
        if not row:
            continue
        cells = [str(c or '').strip().replace('\n', ' ') for c in row]
        if not cells:
            continue
        # Skip header repeat rows (%, $)
        if all(c in ('', '$', '%') or re.match(r'^\d+%$', c) for c in cells):
            continue
        classification = cells[0] if cells else ''
        if not classification or classification in ('$', '%') or re.match(r'^\d+%$', classification):
            continue
        if len(classification) < 2:
            continue

        entry = {'classification': classification}
        for idx, cell in enumerate(cells[1:], 1):
            if idx >= len(col_types):
                break
            clean = cell.replace('$', '').replace(',', '').strip()
            if re.match(r'^\d{2,5}\.\d{2}$', clean):
                val = float(clean)
                ctype = col_types[idx] if idx < len(col_types) else 'other'
                if ctype == 'weekly':
                    entry['weekly_rate'] = val
                elif ctype == 'hourly':
                    if 'hourly_rate' not in entry:
                        entry['hourly_rate'] = val
                elif ctype == 'saturday':
                    entry['saturday_rate'] = val
                elif ctype == 'sunday':
                    entry['sunday_rate'] = val
                elif ctype == 'public_holiday':
                    entry['public_holiday_rate'] = val
                elif ctype == 'casual':
                    entry['casual_hourly_rate'] = val
                elif ctype == 'shift_penalty':
                    entry['shift_penalty_rate'] = val
                elif ctype == 'overtime':
                    entry.setdefault('overtime_rates', []).append(val)
        # Only add if we got at least one numeric value
        numeric_vals = [v for k, v in entry.items() if k != 'classification' and isinstance(v, (int, float))]
        if numeric_vals:
            rates.append(entry)
    return rates


def parse_penalty_table(table):
    """Parse a penalty rate table."""
    penalties = []
    if not table or len(table) < 2:
        return penalties
    for row in table[1:]:
        cells = [str(c or '').strip().replace('\n', ' ') for c in row]
        if len(cells) < 2:
            continue
        day_period = cells[0]
        if not day_period or day_period in ('', '$', '%'):
            continue
        vals = []
        for c in cells[1:]:
            clean = c.replace('%', '').strip()
            if re.match(r'^\d{2,3}(?:\.\d+)?$', clean):
                vals.append(float(clean))
        if vals and len(day_period) > 2:
            pct = vals[0]
            penalties.append({
                'day_or_period': day_period,
                'percentage': pct,
                'rate_multiplier': round(pct / 100, 2),
                'employment_type': '',
                'notes': f"{day_period}: {pct}%"
            })
    return penalties


def parse_allowance_table(table):
    """Parse an allowances table."""
    allowances = []
    for row in table[1:]:
        cells = [str(c or '').strip().replace('\n', ' ') for c in row]
        if len(cells) < 2:
            continue
        name = cells[0]
        if not name or len(name) < 3:
            continue
        for c in cells[1:]:
            clean = c.replace('$', '').replace(',', '').strip()
            if re.match(r'^\d+\.\d{2}$', clean):
                amount = float(clean)
                unit = 'other'
                for u in ['week', 'day', 'shift', 'hour', 'km', 'occasion']:
                    if u in ' '.join(cells).lower():
                        unit = u
                        break
                allowances.append({
                    'allowance_name': name[:100],
                    'amount': amount,
                    'unit': unit,
                    'condition': '',
                    'is_wage_related': False
                })
                break
    return allowances


def extract_casual_loading(text):
    for pattern in [
        r'(\d+(?:\.\d+)?)\s*(?:per cent|percent|%)\s+(?:casual\s+)?loading',
        r'casual loading of\s+(\d+(?:\.\d+)?)\s*(?:per cent|percent|%)',
        r'loading[^.]{0,60}(\d+(?:\.\d+)?)\s*(?:per cent|percent|%)',
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            val = float(m.group(1))
            if 1 < val < 100:
                return val
    return None


def extract_variation_refs(text):
    refs = re.findall(r'\[(?:Varied|Inserted|Substituted|Deleted|renumbered)[^\]]{0,250}\]', text)
    return ' '.join(refs[:4])[:500]


def extract_cross_refs(text):
    clauses = re.findall(r'clause\s+([\d]+[A-Z]?(?:\.\d+)?)', text, re.IGNORECASE)
    scheds = re.findall(r'Schedule\s+([A-Z]+)', text)
    refs = list(set([f"clause {r}" for r in clauses] + [f"Schedule {r}" for r in scheds]))
    return refs[:12]


def extract_notes(text):
    notes_raw = re.findall(r'\bNOTE[:\s][^\n]+(?:\n[^\n]+){0,2}', text[:5000])
    return ' | '.join(n.strip()[:200] for n in notes_raw[:4])


# ── Main parser ────────────────────────────────────────────────────────────────

def parse_award(ma_number, award_name, pdf_bytes):
    records = []
    source_url = f"https://www.fwc.gov.au/documents/awards/pdf/{ma_number.lower()}.pdf"
    award_code = AWARD_CODES.get(ma_number, ma_number.lower())
    industry = INDUSTRY_MAP.get(ma_number, 'general')

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:

        # ── Build per-page data ──────────────────────────────────────────────
        pages_data = []
        for page in pdf.pages:
            text = page.extract_text() or ""
            tables = page.extract_tables() or []
            pages_data.append({'text': text, 'tables': tables})

        full_text = "\n".join(p['text'] for p in pages_data)

        # ── Award metadata ───────────────────────────────────────────────────
        amend_m = re.search(r'amendments up to and including\s+(\d+ \w+ \d{4})', full_text)
        last_amended = amend_m.group(1) if amend_m else None
        pr_m = re.search(r'amendments up to and including[^\(]+\(([^)]+)\)', full_text)
        last_amended_pr = pr_m.group(1) if pr_m else None

        # ── Build Part lookup from TOC ───────────────────────────────────────
        # key: part_num string -> (part_title)
        toc_parts = {}
        for m in re.finditer(r'^Part\s+(\d+)[—–\-]+\s*(.+?)(?:\s*\.{4,}|\s*$)', full_text, re.MULTILINE):
            pnum = m.group(1)
            ptitle = re.sub(r'\s*\.{4,}.*', '', m.group(2)).strip()
            if ptitle and len(ptitle) > 3 and pnum not in toc_parts:
                toc_parts[pnum] = ptitle

        # ── Find all clause positions in full text ───────────────────────────
        # Clauses: "NN." or "NNA." at line start followed by title-case heading
        clause_pat = re.compile(r'\n(\d+[A-Z]?)\.\s+([A-Z][^\n]{3,80})\n')
        # Schedules: "Schedule X—Title"
        sched_pat = re.compile(r'\nSchedule\s+([A-Z]+)[—–\-]+\s*([^\n]{3,100})\n')

        positions = []
        for m in clause_pat.finditer(full_text):
            positions.append({
                'pos': m.start(), 'end': m.end(),
                'number': m.group(1), 'title': m.group(2).strip(),
                'is_schedule': False, 'schedule_id': None
            })

        seen_scheds = {}
        for m in sched_pat.finditer(full_text):
            sid = m.group(1)
            stitle = m.group(2).strip()
            key = f"{sid}_{stitle[:15]}"
            if key not in seen_scheds:
                seen_scheds[key] = True
                positions.append({
                    'pos': m.start(), 'end': m.end(),
                    'number': f"Schedule {sid}",
                    'title': stitle, 'is_schedule': True, 'schedule_id': sid
                })

        positions.sort(key=lambda x: x['pos'])

        # Deduplicate by number — keep last occurrence (body over TOC)
        by_number = {}
        for p in positions:
            by_number[p['number']] = p
        positions = sorted(by_number.values(), key=lambda x: x['pos'])

        # ── Build page-range index ───────────────────────────────────────────
        # Map character position -> page number
        page_breaks = [0]
        running = 0
        for pd in pages_data:
            running += len(pd['text']) + 1
            page_breaks.append(running)

        def pos_to_page(pos):
            for i in range(len(page_breaks) - 1):
                if page_breaks[i] <= pos < page_breaks[i + 1]:
                    return i
            return len(pages_data) - 1

        # ── Extract each clause ──────────────────────────────────────────────
        current_part_num = "1"
        current_part_title = toc_parts.get("1", "Application and Operation of this award")

        for i, cs in enumerate(positions):
            start_pos = cs['pos']
            end_pos = positions[i + 1]['pos'] if i + 1 < len(positions) else len(full_text)
            clause_text = full_text[start_pos:end_pos].strip()

            # Skip TOC-only entries (short, mostly dots/numbers)
            if len(clause_text) < 100:
                continue
            dot_density = clause_text.count('.') / max(len(clause_text), 1)
            if dot_density > 0.25 and len(clause_text) < 400:
                continue

            number = cs['number']
            title = cs['title']
            title_lower = title.lower()
            is_schedule = cs['is_schedule']
            schedule_id = cs['schedule_id']

            # Determine Part from text context immediately before this clause
            if not is_schedule:
                preceding = full_text[max(0, start_pos - 300):start_pos]
                pm = re.search(r'Part\s+(\d+)[—–\-]+\s*([^\n.]+)', preceding)
                if pm:
                    pnum = pm.group(1)
                    ptitle = re.sub(r'\s*\.{4,}.*', '', pm.group(2)).strip()
                    if ptitle and len(ptitle) > 3:
                        current_part_num = pnum
                        current_part_title = toc_parts.get(pnum, ptitle)

            part_num = "Schedule" if is_schedule else current_part_num
            part_title = "Schedules" if is_schedule else current_part_title

            # Classify
            clause_type = classify_clause(title_lower, is_schedule)

            # Employment types
            applies_to = infer_employment_types(title_lower, clause_text.lower())

            # ── Extract tables for this clause ───────────────────────────────
            start_page = pos_to_page(start_pos)
            end_page = pos_to_page(end_pos)
            clause_pages = pages_data[start_page:min(end_page + 2, len(pages_data))]

            key_rates = []
            key_penalties = []
            key_allowances = []

            for cp in clause_pages:
                for tbl in cp['tables']:
                    if not tbl or len(tbl) < 2:
                        continue
                    flat = ' '.join(str(c or '') for row in tbl for c in row).lower()
                    has_dollars = bool(re.search(r'\d{2,4}\.\d{2}', flat))
                    if not has_dollars:
                        continue

                    # Determine table type
                    header_text = ' '.join(str(c or '') for c in tbl[0]).lower()
                    first_col = [str(row[0] or '').strip().lower() for row in tbl if row and row[0]]

                    is_percentage_table = '%' in flat and any(
                        re.match(r'^\d{2,3}%?$', str(c or '').strip()) for row in tbl[1:3] for c in row if c)

                    if clause_type in ('minimum_rates', 'junior_rates', 'schedule_rates_summary',
                                       'schedule_classification', 'shiftwork', 'penalty_rates',
                                       'overtime', 'casual_loading'):
                        if any(k in header_text for k in ['classif', 'monday', 'saturday', 'sunday', 'shift', 'week', 'hour']):
                            if 'monday' in header_text or 'saturday' in header_text or 'penalty' in header_text:
                                extracted = parse_rate_table(tbl)
                                if extracted:
                                    key_rates.extend(extracted)
                            elif 'week' in header_text or 'hour' in header_text or 'classif' in header_text:
                                extracted = parse_rate_table(tbl)
                                if extracted:
                                    key_rates.extend(extracted)
                        elif is_percentage_table and any(
                            k in ' '.join(first_col) for k in ['monday', 'saturday', 'sunday', 'afternoon', 'night', 'overtime']
                        ):
                            extracted = parse_penalty_table(tbl)
                            key_penalties.extend(extracted)

                    if clause_type in ('allowances', 'schedule_allowances_summary'):
                        extracted = parse_allowance_table(tbl)
                        key_allowances.extend(extracted)

            # Deduplicate rates by classification
            seen_class = {}
            deduped_rates = []
            for r in key_rates:
                k = r.get('classification', '')
                if k not in seen_class:
                    seen_class[k] = True
                    deduped_rates.append(r)

            # Extract inline penalties from text if table extraction got nothing
            if clause_type in ('penalty_rates', 'overtime') and not key_penalties:
                inline_pens = re.findall(
                    r'(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Public [Hh]oliday|Overtime|[Aa]fternoon|[Nn]ight)[^\n]*?(\d{3})\s*(?:%|per cent)',
                    clause_text
                )
                for day, pct in inline_pens[:10]:
                    val = float(pct)
                    key_penalties.append({
                        'day_or_period': day,
                        'percentage': val,
                        'rate_multiplier': round(val / 100, 2),
                        'employment_type': '',
                        'notes': f"{day}: {pct}%"
                    })

            # Casual loading
            casual_loading = None
            if clause_type in ('casual_loading', 'minimum_rates', 'employment_type'):
                casual_loading = extract_casual_loading(clause_text)

            # Effective date
            eff_m = re.search(r'ppc\s+(\d{2}[A-Za-z]{3}\d{2,4})', clause_text)
            effective_date = eff_m.group(1) if eff_m else '01Jul25'

            variation_history = extract_variation_refs(clause_text)
            cross_refs = extract_cross_refs(clause_text)
            notes = extract_notes(clause_text)

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
                'part_title': part_title,
                'clause_number': number,
                'clause_title': title,
                'clause_type': clause_type,
                'is_schedule': is_schedule,
                'schedule_identifier': schedule_id or '',
                'full_text': clause_text[:8000],
                'key_rates': deduped_rates[:40],
                'key_penalties': key_penalties[:20],
                'key_allowances': key_allowances[:20],
                'casual_loading_percent': casual_loading,
                'effective_date': effective_date,
                'variation_history': variation_history,
                'notes': notes[:500],
                'cross_references': cross_refs,
                'applies_to_employment_types': applies_to,
                'searchable_keywords': keywords,
            }
            records.append(record)

    return records


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
    ("MA000019", "Banking, Finance and Insurance Award 2020"),
    ("MA000011", "Electrical, Electronic and Communications Contracting Award 2020"),
    ("MA000015", "Hair and Beauty Industry Award 2010"),
    ("MA000056", "Real Estate Industry Award 2020"),
    ("MA000030", "Amusement, Events and Recreation Award 2020"),
    ("MA000025", "Contract Call Centres Award 2020"),
    ("MA000046", "Medical Practitioners Award 2020"),
    ("MA000031", "Passenger Vehicle Transportation Award 2020"),
    ("MA000028", "Higher Education Industry—General Staff—Award 2020"),
    ("MA000029", "Higher Education Industry—Academic Staff—Award 2020"),
    ("MA000071", "Telecommunications Services Award 2020"),
    ("MA000044", "Gardening and Landscaping Services Award 2020"),
    ("MA000045", "Meat Industry Award 2020"),
    ("MA000039", "Road Transport (Long Distance Operations) Award 2020"),
    ("MA000073", "Waste Management Award 2020"),
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
    ("MA000067", "Rail Industry Award 2020"),
    ("MA000070", "Surveying Award 2020"),
    ("MA000076", "Wool, Hide and Pelt Industry Award 2020"),
    ("MA000080", "Paper, Printing and Stationery Award 2020"),
    ("MA000082", "Sporting Organisations Award 2020"),
    ("MA000041", "Sugar Industry Award 2010"),
    ("MA000043", "Textile, Clothing, Footwear and Associated Industries Award 2010"),
    ("MA000055", "Quarrying Award 2020"),
    ("MA000035", "Pastoral Award 2020"),
    ("MA000008", "Horticulture Award 2020"),
    ("MA000042", "Supported Employment Services Award 2020"),
    ("MA000051", "Outdoor Hospitality Industry Award 2020"),
    ("MA000099", "Cemetery Industry Award 2020"),
    ("MA000107", "Food, Beverage and Tobacco Manufacturing Award 2020"),
    ("MA000115", "Aboriginal and Torres Strait Islander Health Workers Award 2020"),
    ("MA000102", "Commercial Sales Award 2020"),
    ("MA000104", "Miscellaneous Award 2020"),
    ("MA000006", "Broadcasting, Recorded Entertainment and Cinemas Award 2020"),
    ("MA000049", "Nursery Award 2020"),
    ("MA000066", "Racing Industry Employees Award 2020"),
]

TIER1 = ALL_AWARDS[:20]


def process_award(ma_number, award_name, force=False):
    out_path = os.path.join(AWARDS_DIR, f'{ma_number.lower()}_records.json')
    if os.path.exists(out_path) and not force:
        with open(out_path) as f:
            existing = json.load(f)
        return existing, True  # cached

    url = f"https://www.fwc.gov.au/documents/awards/pdf/{ma_number.lower()}.pdf"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            pdf_bytes = resp.read()
        if pdf_bytes[:4] != b'%PDF':
            return [], False
        records = parse_award(ma_number, award_name, pdf_bytes)
        with open(out_path, 'w') as f:
            json.dump(records, f, indent=2)
        return records, False
    except Exception as e:
        print(f"    ERROR: {e}")
        return [], False


if __name__ == '__main__':
    arg = sys.argv[1] if len(sys.argv) > 1 else 'tier1'
    force = '--force' in sys.argv

    if arg == 'all':
        target = ALL_AWARDS
    elif arg == 'tier1':
        target = TIER1
    else:
        target = [(a, n) for a, n in ALL_AWARDS if a.upper() == arg.upper()]
        if not target:
            print(f"Unknown award: {arg}")
            sys.exit(1)

    print(f"Processing {len(target)} awards (force={force})...")
    total = 0
    for ma, name in target:
        recs, cached = process_award(ma, name, force=force)
        tag = "[cached]" if cached else "[new]"
        print(f"  {ma} {tag}: {len(recs)} records — {name[:50]}")
        total += len(recs)
        if not cached:
            time.sleep(0.3)

    print(f"\nTotal records: {total}")
    print(f"Output: {AWARDS_DIR}")
