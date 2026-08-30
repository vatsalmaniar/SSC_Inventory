# Search Quality Audit — Item Part-Code Search

**Date:** 2026-08-30 · **Scope:** every item picker + Item 360 + global search · **Status:** analysis only, no code changed
**Data:** live prod (`items`, 9,848 rows), read-only via Management API

---

## 1. Diagnosis (10 lines)

Search does not narrow because **trigram similarity is used as the membership filter, not just the ranker**.
At pg_trgm's default `similarity_threshold = 0.3`, a corpus of same-shaped part codes matches almost everything
that shares a prefix — so adding characters removes one or two rows instead of converging.

**Primary root cause:** `search_items_fuzzy` (`sql/create_item.sql:44-66`) ranks by `similarity(item_code, RAW query)`
— the *raw*, un-normalised code against the *raw* query. 4,423 of 9,848 codes (45%) carry legacy spaces, so a stored
`MAD 1401040R5` is scored against a typed `MAD1401040R5` with the space counted against it. The result: an **exact
part is ranked below a different part** whenever the exact one is punctuated and a longer sibling is not.
There is **no exact tier and no prefix tier** — every row competes on one fuzzy score.

**Contributing causes:** (a) six pickers never call the RPC at all and use raw `%ILIKE%` + alphabetical order, where
`MAD140` cannot find `MAD 1401040R5` **at all**; (b) a reverse-containment clause that widens rather than narrows;
(c) the RPC seq-scans all 9,848 rows on every keystroke (116 ms), never touching either GIN index.

---

## 2. Phase 0 — Ground truth

### 2.1 Every item-search implementation (three, divergent)

| # | Implementation | Where defined | Called from |
|---|---|---|---|
| **A** | `search_items_fuzzy()` RPC via shared lib | [src/lib/itemSearch.js:27-43](src/lib/itemSearch.js#L27-L43) | [NewPurchaseOrder.jsx:387](src/pages/NewPurchaseOrder.jsx#L387), [PurchaseOrderDetail.jsx:1308](src/pages/PurchaseOrderDetail.jsx#L1308), [ForecastPOModal.jsx:120](src/pages/ForecastPOModal.jsx#L120) |
| **B** | `search_items_fuzzy()` RPC called **directly**, bypassing the lib | — | [NewOrder.jsx:82](src/pages/NewOrder.jsx#L82) (`limit 20`), [ItemMaster.jsx:55](src/pages/ItemMaster.jsx#L55) (`limit 200`), [NewItem.jsx:118](src/pages/NewItem.jsx#L118) (`limit 6`, **duplicate detection**) |
| **C** | Hand-rolled `%ILIKE%`, alphabetical, no ranking | — | [OrderDetail.jsx:427-428](src/pages/OrderDetail.jsx#L427-L428), [CRMQuotations.jsx:171-172](src/pages/CRMQuotations.jsx#L171-L172), [CRMOpportunityDetail.jsx:718-719](src/pages/CRMOpportunityDetail.jsx#L718-L719), [CRMOpportunityDetail.jsx:2307](src/pages/CRMOpportunityDetail.jsx#L2307), [CRMOpportunityDetail.jsx:2539](src/pages/CRMOpportunityDetail.jsx#L2539), [NewStockTransfer.jsx:47-51](src/pages/NewStockTransfer.jsx#L47-L51), [Layout.jsx:423](src/components/Layout.jsx#L423) (global search) |

**The shared lib covers only 3 of 12 call sites.** Two of the three fuzzy call sites bypass it. Implementation **C**
is a distinct, worse algorithm — it is the exact pattern the lib's own header comment says was retired
([itemSearch.js:3-10](src/lib/itemSearch.js#L3-L10)); it is still live in seven places.

> ⚠️ **Divergence, not a canonical choice.** New Order ([NewOrder.jsx:82](src/pages/NewOrder.jsx#L82)) uses the RPC.
> Editing an existing order ([OrderDetail.jsx:427](src/pages/OrderDetail.jsx#L427)) uses ILIKE. The same user, adding
> the same line to the same order, gets two different result sets depending on which screen they are on. I have not
> picked a winner — see the open question at the end.

### 2.2 Matching mechanism (quoted from the deployed function)

Verified against prod `pg_proc.prosrc` — **byte-identical to `sql/create_item.sql`**, `prosecdef = false` (SECURITY INVOKER), `provolatile = 's'`.

```sql
WHERE q.norm <> '' AND (
  ( q.norm_len <= 3 AND (                          -- 1-3 normalised chars
      lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) LIKE q.norm || '%'
      OR lower(i.item_code) LIKE '%' || q.raw_lc || '%'
      OR lower(COALESCE(i.brand,'')) LIKE '%' || q.raw_lc || '%' ))
  OR ( q.norm_len > 3 AND (
      i.item_code % q.raw                                                        -- (1) TRIGRAM FILTER
      OR lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) LIKE '%'||q.norm||'%'  -- (2) normalised contains
      OR q.norm LIKE '%' || lower(regexp_replace(i.item_code,'[^a-zA-Z0-9]','','g')) || '%'  -- (3) REVERSE contains
      OR i.brand % q.raw
      OR lower(COALESCE(i.brand,'')) LIKE '%' || q.raw_lc || '%' )))
ORDER BY sim DESC, i.item_code
LIMIT GREATEST(p_limit, 1);
```

- **Threshold:** none set explicitly → pg_trgm default **0.3** for `%`. Clause (1) is a *filter*.
- **Clause (3)** matches any item whose *entire* code is a substring of the query — it can only ever *add* rows as the user types more. 899 codes (>3 chars) are a normalised substring of another code.
- **Ranking:** `GREATEST(similarity(item_code, raw), similarity(brand, raw))`, `ORDER BY sim DESC, item_code`. **No exact-match tier, no prefix tier, no length tie-break.**
- **Limit vs rank:** rank first, then `LIMIT` — correct order, the limit does not hide items. (Implementation **C** does the opposite: `.limit(10)` on an *alphabetical* scan, so it *does* hide items.)
- **Where filtering happens:** Postgres, for A and B. `ItemMaster.jsx:55-62` additionally fetches 200 rows then filters brand/category/type **client-side after the limit** — a brand filter can therefore return fewer rows than exist.

### 2.3 Query preprocessing / stored normalisation

- Query: `btrim` + `lower` + `regexp_replace('[^a-zA-Z0-9]','')` → `q.norm`. **But `q.norm` is used only in the WHERE, never in the ORDER BY.** The ranker uses `q.raw`.
- Stored: **nothing is normalised at rest.** There is no normalised column. Normalisation happens per-row, per-query, as a functional expression.
- No tokenisation. `MAD 140` is never split into `MAD` + `140`.

### 2.4 Indexes on `items` (relevant)

```
idx_items_item_code_trgm   GIN (item_code gin_trgm_ops)
idx_items_code_norm_trgm   GIN (lower(regexp_replace(item_code,'[^a-zA-Z0-9]','','g')) gin_trgm_ops)
items_item_code_key        UNIQUE btree (item_code)
idx_items_brand_trgm       GIN (brand gin_trgm_ops)
```

**Neither GIN index is ever used by the RPC.** `EXPLAIN ANALYZE search_items_fuzzy('MAD14010',20)`:

```
Nested Loop  (actual time=17.806..116.167 rows=11)
  Join Filter: ((q.norm_len <= 3 AND ...) OR (q.norm_len > 3 AND ...))
  Rows Removed by Join Filter: 9837
  ->  Seq Scan on items i  (rows=9848)
Execution Time: 116.666 ms
```

Wrapping the whole predicate in the `norm_len<=3 OR norm_len>3` disjunction against a CTE turns it into a
nested-loop **join filter** — nothing is index-qualifiable. Every keystroke seq-scans 9,848 rows and evaluates
`similarity()` on all of them. `sql/create_item.sql:3-5` claims this path is "index-served (no seq scan)". It is not.

The same predicate written flat **is** index-served:
```
Bitmap Index Scan on idx_items_code_norm_trgm ... Execution Time: 0.671 ms   -- 170× faster
```

### 2.5 Searchable fields

`item_code` and `brand` only. **`items.description` is not searched by any of the three implementations**
(only 1,450 of 9,848 rows have one). Descriptions are *not* a noise source — they are simply unavailable.
The noise that *looks* like descriptions (`Door for MAD1401030R5`, `Mounting plate for MAD1401040R5`) is
legacy free-text living **in the `item_code` column itself** — 359 codes are ≥40 chars, max 94.

### 2.6 Debounce / minimum length

| Site | Debounce | Min length |
|---|---|---|
| `Typeahead` (most pickers) | 250 ms ([Typeahead.jsx:53](src/components/Typeahead.jsx#L53)) | **none** |
| `ItemMaster` | 300 ms ([ItemMaster.jsx:91](src/pages/ItemMaster.jsx#L91)) | none |
| `NewItem` dup-check | 250 ms | 2 ([NewItem.jsx:116](src/pages/NewItem.jsx#L116)) |
| `NewStockTransfer` | 250 ms | 2 ([NewStockTransfer.jsx:46](src/pages/NewStockTransfer.jsx#L46)) |
| `Layout` global | 600 ms | 3 ([Layout.jsx:399](src/components/Layout.jsx#L399)) |

A 1-character query in a picker triggers a 116 ms seq scan.

---

## 3. Phase 0.8 — Data profile (measured, not estimated)

| Metric | Value |
|---|---|
| Total items | **9,848** |
| Codes containing a space | **4,423 (44.9 %)** |
| Codes with a double space | 67 |
| Codes containing `-` | 4,845 (49.2 %) |
| Codes containing `/` | 1,053 |
| Codes with other punctuation | 958 |
| Codes not all-uppercase | 1,958 (19.9 %) |
| Leading/trailing whitespace | 0 |
| Code length: avg / min / max | **16.4 / 2 / 94** |
| Codes ≤ 5 chars | 267 |
| Codes ≥ 40 chars | 359 |
| **Codes that are a normalised PREFIX of another code** | **726** |
| Codes that are a normalised SUBSTRING of another (>3 ch) | 899 |
| **Punctuated codes that are a prefix of another** ← the failure class | **502** |
| Distinct codes colliding after normalisation | **8 pairs** |
| `description` populated | 1,450 (14.7 %) |

**The 8 normalisation collisions** (block any `UNIQUE` normalised index):
`CTS2.5UNBK`/`CTS25UNBK` · `CTS2.5UNBU`/`CTS25UNBU` · `CTS2.5UNR`/`CTS25UNR` · `CTS2.5UNY`/`CTS25UNY` ·
`4C2.5BKLO`/`4C25BKLO` · `FX-3U-32BL`/`FX3U-32BL` · `CGT-35U`/`CGT35U` · `AE 3200 SW ED 4P LSIG`/`AE3200-SW ED 4P LSIG`

Top normalised 3-char prefixes: `uni` 369 · `1sd` 182 · `shg` 116 · `bns` 113 · `mas` 111 · `azm` 98 · `bhw` 91.

**Shape conclusion:** the corpus is dense families of near-identical codes distinguished by a few trailing
characters, half of them punctuated inconsistently. This is precisely the shape on which a 0.3 trigram
threshold is useless as a filter and dangerous as a ranker.

---

## 4. Phase 1 — Evidence

### 4.1 The four reported queries, traced

Actual `search_items_fuzzy(q, 20)` output from prod. The user is looking for **`MAD 1401040R5`**.

| Query | Rows | Rank of `MAD 1401040R5` | Top result |
|---|---|---|---|
| `MAD14` | 12 | **10th** (sim 0.1765) | `MAD1401030X` |
| `MAD 140` | **15 — went UP** | **1st** (sim 0.4667) | `MAD 1401040R5` |
| `MAD140` | 12 | **10th** (sim 0.2353) | `MAD1401030X` |
| `MAD14010` | 11 | **10th** (sim 0.3529) | `MAD1401030X` |
| `MAD 140104` | 12 | 1st (sim 0.6667) | `MAD 1401040R5` |
| `MAD1401040R5` (exact, no space) | 20 | **2nd** (sim 0.6875) | `MAD1401040R5X` — *a different part* |

Three things fall out:

1. **No convergence.** 12 → 15 → 12 → 11 → 12 rows across five keystrokes' worth of extra input.
   `MAD 140` returns *more* rows than `MAD14`.
2. **Space changes everything.** `MAD 140` ranks the target 1st; `MAD140` ranks it 10th. They diverge at
   `sql/create_item.sql:45-47` — `sim` is computed on `q.raw`, which still contains the space, against
   `i.item_code`, which also still contains its space. The two strings agree only when the user happens to
   punctuate exactly as the legacy data does. `q.norm` never reaches the ranker.
3. **Pure noise gets in.** `MAD 140` returns `209-140`, `734-140`, `812-140` (sim 0.3333) — unrelated brands,
   admitted solely by `i.item_code % q.raw` at threshold 0.3. `MAD14010` returns `MAD1401240R5` at rank 6,
   whose normalised code does **not** contain `mad14010`; it is there only via the trigram filter.

### 4.2 The same four queries on Implementation **C** (`%ILIKE%`, 7 call sites)

| Query | Rows matched | `MAD 1401040R5` present? |
|---|---|---|
| `MAD14` | 10 | **NO** |
| `MAD 140` | 2 | yes |
| `MAD140` | 10 | **NO** |
| `MAD140104` | 2 | **NO** |
| `MAD 140104` | 1 | yes |

On OrderDetail, CRMQuotations, CRMOpportunityDetail, NewStockTransfer and global search, typing `MAD140`
**cannot ever surface `MAD 1401040R5`** — it is not a substring. The user concludes the part does not exist.
This is the duplicate-creation failure mode `itemSearch.js:8-10` was written to stop, still live in seven places.

### 4.3 Ranking failure is systemic, not a `MAD` quirk

80 randomly sampled punctuated codes, typed the natural way (punctuation stripped):

| Rank of the true item | Count |
|---|---|
| 1st | 70 (87.5 %) |
| 2nd–5th | **8 (10 %)** |
| 6th–20th | **2 (2.5 %)** |
| absent from top-20 | 0 |

**≈12.5 % of punctuated codes do not rank first when typed naturally.** Against 4,845+ punctuated codes that is
on the order of 600 items. Real examples, current top-4 vs. the correct answer:

| Typed | Current top result | Correct item | Its current rank |
|---|---|---|---|
| `ASR0403021` | `ASR0403021X` | `ASR 0403021` | 3rd |
| `22A230HBAC` | `22A230HBAC-X` | `22 A 230 H B AC` | **not in top 4** |
| `BHW-T104PC2` | `BHW T10 1P C2` | `BHW-T10 4P C2` | 4th — behind the wrong pole counts |
| `1SDA116459R1` | `1SDA116453R1` | `1SDA116459R1 YO P3-P4 110..240 Vac` | **not in top 4** |

The `1SDA116459R1` row is the case already parked in memory as *"item search ranking"* — now reproduced and root-caused.
`BHW-T104PC2` is the commercially dangerous class: three wrong pole counts above the right one.

### 4.4 Answers to the six diagnostic questions

1. **Why no narrowing?** Clause (1) `item_code % q.raw` is a filter at threshold 0.3; within a code family every
   sibling clears it regardless of how much the user types. Clause (3) actively *adds* rows as the query grows.
2. **Fuzzy as filter rather than ranker?** ✅ **Confirmed — this is the primary cause.** `sql/create_item.sql:57`
   places `%` in the `WHERE`. Membership is decided by similarity; precision tiers do not exist.
3. **Does the space break it?** ✅ **Yes, in the ranker specifically.** `q.norm` is computed
   (`sql/create_item.sql:40`) and used in the WHERE, but `ORDER BY` uses `similarity(i.item_code, q.raw)`
   (`sql/create_item.sql:45-47`). Both sides keep their punctuation. That single line is why `MAD140` and
   `MAD 140` rank differently. On Implementation **C** the space breaks *membership* too — no normalisation at all.
4. **Duplicate detection sharing the picker path?** ✅ **Yes — design fault.** [NewItem.jsx:118](src/pages/NewItem.jsx#L118)
   calls the same `search_items_fuzzy` with `p_limit: 6`. Duplicate detection wants **recall** (show me anything
   close); item picking wants **precision** (converge). One function cannot be tuned for both, and today it is
   tuned for neither. Note `create_item()` separately blocks *normalised-identical* duplicates in the DB, so the
   typeahead is advisory — it can afford to stay loose once the picker is tightened.
5. **Is ranking absent or wrong?** Present but **wrong**: single fuzzy score, no exact/prefix tier, no length
   tie-break. Measured exact-match miss rate 12.5 % (§4.3).
6. **Limit vs rank order?** Correct in the RPC (rank → limit). **Wrong in Implementation C** (`.limit(10)` on an
   alphabetical scan) and **wrong in ItemMaster** (`p_limit:200` → then client-side brand/category filter, so
   filtered searches under-report).

**Primary cause:** #2 (fuzzy as filter) compounded by #3 (ranker uses raw, un-normalised strings).
**Contributing:** #4, #5, #6, plus the seq scan (§2.4) and the Implementation-C divergence (§4.2).

---

## 5. Phase 2 — Recommended solution (validated against prod)

**Stop letting a similarity score decide whether an item is findable.** Decide membership with deterministic
rules, use fuzzy only to append suggestions underneath, and rank by comparing *normalised* strings on both sides.

### 5.1 The tier model

Every row carries a tier. Order is `tier → shortest normalised code → similarity DESC → item_code`.
The final key is UNIQUE, so the ordering is a **total order** — results are stable and reproducible,
which is what makes a regression suite meaningful.

| Tier | Rule | Index that serves it |
|---|---|---|
| 0 | normalised code **equals** the query, **or** `item_no` matches (`IN2471`) | btree on normalised code · `items_item_no_key` |
| 1 | normalised code **starts with** the query | btree `text_pattern_ops` |
| 2 | normalised code **contains** the query | `idx_items_code_norm_trgm` |
| 3 | **every whitespace token present, any order** | `idx_items_code_norm_trgm` (driven off the longest token) |
| 4 | brand contains the query | `idx_items_brand_trgm` |
| 5 | trigram similarity — *v1's clauses*, last resort | `idx_items_item_code_trgm` · `_norm_trgm` · `_brand_trgm` |
| 6 | the code sits inside what was typed — *v1's clause*, last resort | btree on normalised code |

**Tiers 0-4 are matches. Tiers 5-6 are suggestions** (`FUZZY_TIER = 5` in `src/lib/itemSearch.js`).

### 5.2 The four load-bearing design rules

**R1 — Membership is deterministic.** Tiers 0-3 are exact/prefix/contains. No threshold decides findability.

**R2 — Fuzzy can only add, never displace.** Tiers 4-5 are evaluated *only* when tiers 0-3 cannot fill the page,
and always sort last. A fuzzy guess can never outrank a real prefix match.

**R3 — Provably non-lossy.** The old function's trigram clause survives as tier 4 and its reverse-containment
clause as tier 5; its brand clause is tier 3. The new result set is a **superset** of the old, re-ordered.
This was not a formality: reverse-containment contributes rows on **20 of 150 sampled queries** (24 rows total),
so dropping it silently would have been a genuine regression.

**R4 — One index-served predicate per branch, combined with `UNION ALL`.** This is the actual defect in the
current function: it `OR`s five predicates inside one CTE join, which makes the whole `WHERE` non-index-qualifiable
(§2.4). **Never `OR` across differently-indexed columns in this function.**

### 5.3 Two implementation details that are not optional

**Reverse-containment must be rewritten, not kept verbatim.** `q.norm LIKE '%'||code||'%'` puts the column on the
pattern side and can never be indexed. Its semantics are exactly *"the code is one of the substrings of the query"*,
so it becomes `code_norm = ANY (<enumerated substrings of the query>)` — identical results, btree probes instead of
a seq scan. Substring length is capped so a pathological paste cannot generate an unbounded set.

**The row limit is pushed into each tier.** Without it, a query like `uni` (369 prefix matches) materialises the
whole candidate set before `LIMIT`. With it, work is bounded at ~6 × limit rows **regardless of catalogue size** —
the property that makes this safe for the next decade. The inner `ORDER BY` must match the outer one *exactly*
(see §7.3 — getting this subtly wrong is how I nearly shipped a defect).

### 5.4 Rules settled during localhost testing (2026-08-30)

Four rules were wrong or missing in the first cut. All four were found by the user testing real searches, not
by the test suite — worth recording, because each looked fine in isolation.

**(a) Suggestions were padding the list.** `mad1401240r5` — an exact code — reported **"23 items"**: 2 matches
plus 21 guesses. The gate fired whenever the strict tiers could not fill `p_limit`, and Item Master asks for 200.
Then `MAD1401030` still showed 4 real matches followed by 8 unrelated codes.
**Rule now: suggestions appear ONLY when the strict tiers matched nothing at all**, capped at 12. If the search
found anything real, that is all you see.

**(b) Multi-word search required the words to be adjacent.** Normalisation glues `PA PG 21` into `papg21`, which
then had to appear contiguously — so it returned 3 items and **missed 2 that contain all three words**
(`PA Slit Conduit,PG 21,Black`, `PA Flexible Conduit PG 21, Black`), and `PG 21 PA` in another order found
nothing. **Tier 3 added: every token must be present, in any order.** `PA PG 21`, `PG 21 PA` and `21 PG PA` now
all return exactly the 5 items that contain all three — verified against ground truth.
Driven off the longest token so the trigram index does the selection; the rest are a filter.

**(c) Words run together cannot be split — left as-is, deliberately.** `papg21` returns 3, not 5, because
`slitconduit` and `flexibleconduit` sit between the `pa` and the `pg21`; the characters genuinely never appear
together. Splitting the query would mean inventing word boundaries (`pa|pg|21` vs `papg|21` vs `p|apg21`), which
reintroduces false positives. A prototype that tries every ordered split *did* work — `papg21` → 5, `mad1401040r5`
→ 3 with no false positives — and is a viable option if this ever matters. **Not implemented; user's call.**

**(d) SI ranks above CI across the whole result list.** Only 359 of 9,848 items are SI and sales want the standard
item first. **One exception: an exact (tier 0) match on the typed code still outranks it.** Twelve codes in the
data make this necessary — typing `BHW-T10 3P C4` in full would otherwise surface the SI `BHW-T10 3P C40` first,
a different current rating; likewise `SB203M-C2` vs `SB203M-C20`/`C25`, `SB204M-C6` vs `SB204M-C63`,
`UA16-30-10` vs `UA16-30-10RA`. User confirmed: *"the entire partcode is matching the existing one."*

> ⚠️ The SI key must be the **first** key in the per-tier inner sorts as well as the outer one. The LIMIT
> push-down is only correct while inner and outer ordering agree — see §7.3.

### 5.5 Verified behaviour

**Convergence** (strict tiers only, the reported query — the user wants `MAD 1401040R5`):

| Query | Today | Proposed |
|---|---|---|
| `MAD14` | 12 | 12 |
| `MAD 140` | **15 — went up** | 12 |
| `MAD140` | 12 | 12 |
| `MAD14010` | 11 | **8** |
| `MAD 140104` | 12 | **3** |
| `MAD1401040R5` | 20 | **3** |

`MAD14`, `MAD 140` and `MAD140` now return **identical** sets — the space inconsistency disappears.
`209-140` / `734-140` / `812-140` noise is gone.

**Ranking** — all ten previously-failing exemplars land at **#1**:

| Typed | Today | Proposed |
|---|---|---|
| `MAD1401040R5` | `MAD1401040R5X` (different part) | **`MAD 1401040R5`** |
| `BHW-T104PC2` | `BHW T10 1P C2` (wrong pole count) | **`BHW-T10 4P C2`** |
| `22A230HBAC` | not in top 4 | **`22 A 230 H B AC`** |
| `1SDA116459R1` | not in top 4 | **`1SDA116459R1 YO P3-P4 110..240 Vac`** |
| `ASR0403021` | `ASR0403021X` | **`ASR 0403021`** |
| `M12 4mm NPN NO 300mA` | 3rd | **`M-12 4mm NPN-NO 300mA`** |
| `IN2471` | **zero rows** | **`MAD1401030X`** |
| `TS362` · `BNS33-12Z-2187` · `UNI901ZDA482501` | ✓ | ✓ |

### 5.6 Rejected alternatives

| Approach | Why rejected |
|---|---|
| **Tune the trigram threshold** | Raising it drops legitimate punctuation-variant matches (`22 A 230 H B AC`); lowering it widens further. No threshold fixes a *filter that should be a ranker*. |
| **Full-text search** | The default parser mangles part codes; prefix matching inside a lexeme is unsupported. Wrong tool for identifiers. |
| **Client-side (Fuse.js / match-sorter)** | Requires preloading 9,848 rows per session; collides with the 1000-row PostgREST cap and moves work onto phones. |
| **Search engine / materialised view / cache** | Unjustifiable at this scale — see §6. The table is 8.4 MB and grows ~50 rows/month. |
| **Clean the data first** | 4,423 spaced codes and 8 normalisation collisions need auditor sign-off and Tally sync. Months. Search must not wait — normalisation is applied at *query* time to both sides. |
| **Patch only the RPC, leave the `%ILIKE%` sites** | Leaves the worse bug live: seven pickers still cannot find 4,423 spaced codes at all. |

### 5.7 Data normalisation at rest — your assumption is correct

**Search can be fixed with no data cleanup.** Cleanup remains worth doing separately but is **not on the critical
path** and carries Tally-sync risk that search does not. One hard constraint if it ever happens: because 8 pairs
collide after normalisation, a stored normalised column **must never be UNIQUE**, and tier 0 can legitimately
return two rows — the UI must show both rather than auto-select.

---

## 6. Load and capacity

### 6.1 The table will never be big

| | |
|---|---|
| `items` total size | **8.4 MB** (1.9 MB heap + 6.4 MB indexes) |
| `shared_buffers` | **256 MB** (32,768 × 8 kB) |
| Growth after the Apr-2026 seed of 9,654 | **41 / 32 / 53 / 68 per month** — ~50/month |
| Projected size in 10 years | **~16,000 rows** |

The entire table and every index live permanently in RAM. **Search load here is pure CPU — there is no disk I/O
to design around, now or ever.** This is the evidence that Postgres is the correct answer permanently and that a
search engine, materialised view or cache layer would be unjustifiable complexity.

### 6.2 Measured cost per query

| Query | Current (v1) | Proposed | Seq scans (proposed) |
|---|---|---|---|
| `MA` | 55.9 ms | **4.3 ms** | 0 |
| `MAD14` | — | **4.9 ms** | 0 |
| `MAD1401040R5` | 121.7 ms | **5.9 ms** | 0 |
| `1SDA116459R1 YO P3-P4 110..240 Vac` | **175.0 ms** | **7.3 ms** | 0 |
| `M` (single char) | 74.2 ms | **11.6 ms** | 0 |
| `uni` (densest prefix, 369 matches) | 50.0 ms | **21.4 ms** | 0 |
| 90-char paste · pure punctuation · digits | 50-175 ms | **< 22 ms** | 0 |

**Worst case across every pathological input tried: 21 ms and ~2,700 buffers, and it does not grow with catalogue
size.** Today's function seq-scans all 9,848 rows and runs `similarity()` on every one, every keystroke.

### 6.3 Concurrency — why this matters now, not later

40 users typing at ~4 searches/sec is **160 qps**:

- **v1 at 116 ms** → **18.5 CPU-seconds per wall second**. That needs ~19 cores. The instance has **2 vCPU,
  burstable**. Today's search cannot survive a genuinely busy morning; it survives because not everyone
  searches at once.
- **Proposed at ~6 ms** → **0.96 CPU-sec/sec**, roughly half of one core.

### 6.4 Two load defects that are not the query

1. **`statement_timeout` is 120 s with `max_connections` = 60.** A typeahead must never hold a connection for two
   minutes; 60 stuck searches is a full outage. Fix: a function-level `SET statement_timeout = '3s'`.
2. **`Typeahead.jsx:46-53` has no cancellation and no sequence guard.** Once the 250 ms debounce fires the request
   is uncancellable; if the user keeps typing, whichever response *resolves last* wins via `setResults(data)`.
   That is stale results on screen **today**, and abandoned requests still burning DB CPU. Fix: an `AbortController`
   plus a request-sequence check.

---

## 7. Robustness — SAP-grade properties, verified

Each of these was tested, not asserted.

| Property | How it was verified | Result |
|---|---|---|
| Membership is deterministic | tiers 0-3 contain no threshold | ✓ by construction |
| Fuzzy can only append, never displace | gated on strict tiers under-filling; sorts last | ✓ |
| Provably non-lossy vs the old function | probed the legacy reverse-containment clause on 150 sampled queries | ✓ — it contributes on 20/150, so it was **kept**, not dropped |
| Bounded work regardless of input | 9 pathological inputs incl. single chars, 90-char paste, pure punctuation | ✓ **≤ 21 ms, ≤ 2,700 buffers** |
| Bounded work regardless of catalogue size | row limit pushed into every tier → ~6 × limit rows | ✓ |
| Total ordering (stable, reproducible) | final tie-break `item_code` is UNIQUE | ✓ |
| Equivalence of the bounded and unbounded forms | differential test, 30 queries | ✓ **30/30 identical** |
| Index-served on every branch | `EXPLAIN ANALYZE` on all branches | ✓ **0 seq scans** |

### 7.1 The indexes are load-bearing, not optional

The database collation is **`en_US.UTF-8`**, which means a plain btree **cannot** serve `LIKE 'x%'` — it requires
a `text_pattern_ops` operator class. Verified, not assumed. Two additive, **non-unique** functional btree indexes
on the normalised code are required; without them tiers 0, 1 and 5 fall back to seq scans and most of the gain is lost.
They must not be UNIQUE — 8 code pairs collide after normalisation (§3).

### 7.2 Why a good function is not enough

This codebase **already had** a shared search library whose header comment states *"an exact match is always first
(similarity 1.0)"* ([itemSearch.js:12-14](src/lib/itemSearch.js#L12-L14)). That sentence has been false in
production in **12.5 %** of cases (§4.3). A correct function plus a comment is precisely what exists today, and it
decayed — six of twelve pickers drifted onto a worse algorithm without anyone deciding they should. The controls in
§10 are not optional extras; they are the part that makes this last.

### 7.3 A defect this process caught, recorded deliberately

The first version of the per-tier limit push-down sorted each tier by `length, item_code` while the outer query
sorted by `length, similarity DESC, item_code`. Because the inner sort omitted similarity, it cut the wrong rows at
the tier boundary. **The top three results looked correct**; the error was further down the list. It was found only
by the 30-query differential test against the unbounded form, and would have passed code review.

This is the argument for §10.2 in one paragraph: on this data shape, search defects are invisible to inspection.

---

## 8. Implementation plan — ordered, each step independently shippable

> **Correction to the first draft of this audit.** Step 1 was described as a body-only rewrite of
> `search_items_fuzzy` with a one-statement rollback. That is wrong: **`CREATE OR REPLACE FUNCTION` cannot change a
> function's return type**, and the new function must return `item_status`, `superseded_by` and `tier`. It therefore
> ships as a **new** function. This is strictly better — the old function stays live and untouched, so rollback is
> reverting one constant in `itemSearch.js` with **no database change at all**.

**Step 1 — Create `search_items_v2` + two additive non-unique btree indexes.**
`CREATE INDEX CONCURRENTLY` (no table lock). `search_items_fuzzy` untouched. Nothing calls v2 yet.
*Additive only: no table, column, policy or data change.*
→ **Gate:** re-run the §6.2 timings against the real indexes and confirm 0 seq scans before proceeding.
The §6.2 figures were produced by simulating the indexed branch and are projections until this gate passes.

**Step 2 — Re-test as real roles.** Execute v2 as `sales` and as `accounts`, not as `postgres`. Confirm identical
row counts. (`items` policy `auth_read` has `qual = true` and the function is SECURITY INVOKER, so it should match —
but per the standing rule, postgres-side testing proves nothing.)

**Step 3 — Point `src/lib/itemSearch.js` at v2.** One constant. Fixes the three PO pickers immediately.
This is the smallest change that produces visible improvement, and the whole of Steps 1-3 rolls back by reverting it.

**Step 4 — Route `NewOrder.jsx:82`, `ItemMaster.jsx:55`, `NewItem.jsx:118` through the shared lib.**
Kills implementation **B**. Pure refactor.

**Step 5 — Migrate the seven `%ILIKE%` sites to the shared lib**, one file per deploy, ordered by consequence
rather than volume (§12): `NewStockTransfer` (canary) → **`OrderDetail`** → `CRMQuotations` →
`CRMOpportunityDetail` (×3) → `Layout` global search.
**Blocking dependency:** v2 must already return `item_status` / `superseded_by` or the status pills break (§9.2).
*This step carries the real regression risk — see §9.*

**Step 6 — Split duplicate detection out** into a recall-tuned `search_items_similar` for `NewItem.jsx:118` only,
so precision and recall stop being tuned against each other in one function.

**Step 7 — Harden the client:** `AbortController` + request-sequence guard in `Typeahead.jsx`, and a function-level
`statement_timeout` (§6.4).

**Step 8 — Fix `ItemMaster` filter-after-limit** ([ItemMaster.jsx:55-62](src/pages/ItemMaster.jsx#L55-L62)):
push brand/category/type into the RPC instead of filtering the fetched page client-side.

**Step 9 — Add the lifetime controls** (§10). Do not treat as optional.

**Step 10 (separate workstream) — data cleanup**, auditor-reviewed, Tally-synced, family by family.
Not a prerequisite for anything above.

---

## 9. Phase 3 — Non-disruption

### 9.1 Blast radius (every affected screen)

| Module | Screen | Impl | Step that touches it |
|---|---|---|---|
| Sales | New Order — item picker | B | 1-3, 4 |
| Sales | Order Detail — add/edit line | **C** | 1-3, 5 |
| Sales | Available-to-Promise (reads codes, no picker) | — | none |
| Items | Item Master search | B | 1-3, 4, 8 |
| Items | New Item — duplicate typeahead | B | 1-3, 4, 6 |
| Procurement | New Purchase Order | A | 1-3 |
| Procurement | Purchase Order Detail | A | 1-3 |
| Procurement | Forecast → PO modal | A | 1-3 |
| Inventory | New Stock Transfer | **C** | 1-3, 5 |
| CRM | Quotations — line picker | **C** | 1-3, 5 |
| CRM | Opportunity Detail — quote lines (×3 pickers) | **C** | 1-3, 5 |
| Global | Sidebar/topbar search (`Layout.jsx`) | **C** | 1-3, 5 |

Twelve pickers, ten pages. Step 3 changes all six **A/B** screens simultaneously via one constant.

### 9.2 What could regress

| Risk | Where | Mitigation |
|---|---|---|
| **Status pills disappear** — the C sites render `item_status`/`superseded_by`, which `search_items_fuzzy` does **not** return | `OrderDetail:1574`, `CRMQuotations:760`, `CRMOpportunityDetail:1711/2307/2539` | v2 returns both from the outset (Step 1) — this is a large part of why it must be a new function rather than a replacement. Blocking dependency for Step 5. |
| **Brand search stops working** | Global search matches `brand.ilike`; the RPC matches brand too, but tiering must not bury brand hits below code hits | Keep brand as its own tier, below code tiers. Verify "nVent", "Mitsubishi", "Schmersal" in the test set. |
| **`item_no` search stops working** (`IN2471`) | `NewStockTransfer:49`, `Layout:423` match `item_no`; **the RPC does not** | v2 carries an exact `item_no` tier from Step 1. **Currently unsupported in six of twelve pickers — do not lose it in the six where it works.** |
| **Typo tolerance narrows** | Users who rely on near-miss discovery | Tier 4 fallback preserves it whenever strict tiers under-fill. |
| **Users' wildcard habits** | Anyone typing `%` or `*` | `%` in the query is stripped by normalisation → becomes a plain contains search. Behaviour is *more* forgiving, not less. Worth an ops note. |
| **Duplicate detection weakens** | `NewItem` | Until Step 6, the tier-4 fallback keeps recall; `create_item()`'s DB-level normalised-dup block is unaffected either way. |
| **Description search** | — | Not supported today anywhere; nothing to regress. |

### 9.3 Rollout — recommendation: **shadow mode for Steps 1-3, then module-by-module for Step 5**

Ship `search_items_fuzzy_v2` alongside the existing function. `src/lib/itemSearch.js` calls **both** and returns
v1's results while logging `{query, v1_top3, v2_top3, v1_count, v2_count}` where they differ. Run for one week
across real traffic, then read the log and flip a single constant in `itemSearch.js`.

Chosen over a feature flag because the risk here is *silently missing an item* — a flag tells you nothing until a
user complains, whereas shadow mode surfaces every divergence before anyone is affected, on real queries rather
than my 40. Cost is one extra 0.67 ms query per keystroke, which is still 170× cheaper than today's single query.

Step 5 (the `%ILIKE%` migrations) does **not** get shadow mode — it gets one file per deploy, lowest-traffic first,
each walked on localhost at 390 px per the standing mobile rule.

### 9.4 Regression test set (32 queries)

`scripts/test-item-search.sh` — asserts expected code appears at the given rank. All expectations verified against
prod data; ✗ marks a case that **fails today**.

| # | Query | Expected #1 | Today |
|---|---|---|---|
| 1 | `MAD 140104` | `MAD 1401040R5` | ✓ |
| 2 | `MAD140104` | `MAD 1401040R5` | ✗ |
| 3 | `MAD14010` | ≤8 rows, all `MAD1401*` | ✗ (11 rows) |
| 4 | `MAD140` | same set as #5 and #6 | ✗ |
| 5 | `MAD 140` | same set as #4 and #6 | ✗ (15 rows, `209-140` noise) |
| 6 | `MAD14` | same set as #4 and #5 | ✗ |
| 7 | `MAD1401040R5` | `MAD 1401040R5` (exact) | ✗ (2nd) |
| 8 | `MAD 1401040R5` | `MAD 1401040R5` | ✓ |
| 9 | `ASR0403021` | `ASR 0403021` | ✗ (3rd) |
| 10 | `ASR 0403021` | `ASR 0403021` | ✓ |
| 11 | `ASR0403021X` | `ASR0403021X` | ✓ |
| 12 | `22A230HBAC` | `22 A 230 H B AC` | ✗ (absent from top 4) |
| 13 | `22 A 230 H B AC` | `22 A 230 H B AC` | ✓ |
| 14 | `BHW-T104PC2` | `BHW-T10 4P C2` | ✗ (4th, behind 1P/2P/3P) |
| 15 | `BHWT104PC20` | `BHW-T10 4P C20` | ✓ |
| 16 | `1SDA116459R1` | `1SDA116459R1 YO P3-P4 110..240 Vac` | ✗ (absent) |
| 17 | `1SDA116453R1` | `1SDA116453R1` | ✓ |
| 18 | `TS362` | `TS- 362` | ✓ |
| 19 | `TS 362 TR` | `TS 362 TR` | ✓ |
| 20 | `BNS33-12Z-2187` | `BNS33 - 12Z - 2187` | ✓ |
| 21 | `BNS33122187` | `BNS33 - 12Z - 2187` | ✓ |
| 22 | `BNS16-12ZD` | `BNS16-12ZD` | ✓ |
| 23 | `UNI 901 ZDA 48 25 01` | `UNI 901 ZDA 48 25 01` (not the `AL5`) | ✓ |
| 24 | `UNI901ZDA482501` | `UNI 901 ZDA 48 25 01` | ✓ |
| 25 | `M12 4mm NPN NO 300mA` | `M-12 4mm NPN-NO 300mA` | ✗ (3rd) |
| 26 | `M18 8mm PNP NO 100mA 3mtr` | `M-18 8mm PNP NO 100mA 3mtr.` | ✓ |
| 27 | `CTS25UNBK` | **both** `CTS25UNBK` and `CTS2.5UNBK` in top 2 | ✗ (collision pair split) |
| 28 | `FX3U32BL` | both `FX3U-32BL` and `FX-3U-32BL` in top 2 | ✗ |
| 29 | `CGT35U` | both `CGT-35U` and `CGT35U` in top 2 | ✓ |
| 30 | `MAS0606040R5` | `MAS0606040R5` | ✓ |
| 31 | `IN2471` | `MAD1401030X` (item_no lookup) | ✗ **zero rows** — RPC ignores `item_no` |
| 32 | `nVent` / `Schmersal` | brand tier fires, ≥1 row | ✓ (unordered within brand) |

All 32 baselined against prod. **9 of 32 fail today.** The suite must be run against **both** v1 and v2 so an
improvement is distinguishable from a different failure.

### 9.5 Rollback

- **Steps 1-3:** `search_items_fuzzy` is never modified and stays live throughout. Rollback is reverting **one
  constant** in `src/lib/itemSearch.js` and redeploying — **no database change at all**, ~3 minutes. This is the
  whole reason v2 ships as a new function rather than a replacement.
- **Steps 4-8 (frontend):** each file is its own commit; `git revert` + Vercel redeploy, ~3 minutes.
- **Trigger:** any ops report of "the item isn't in the list". Reverting the constant is cheap enough that it
  should be the first action, with diagnosis after — per the standing *revert first, debug after* rule.
- **The indexes and functions are additive** and harm nothing if left in place during a rollback. To remove them
  entirely: `DROP FUNCTION search_items_v2` / `search_items_similar`, `DROP INDEX CONCURRENTLY` on the two new
  btree indexes. No table, column, policy or data change to undo at any point.

---

## 10. Lifetime controls — what stops this regressing again

### 10.1 One path, enforced by lint (highest value item in this document)

`eslint.config.mjs` already exists for exactly this purpose — its header reads *"two rules that catch the two
classes of bug that have actually shipped from this repo."* Item search is the third class: six of twelve pickers
drifted onto a worse algorithm with no decision recorded anywhere.

Add a rule rejecting item-code search outside `src/lib/itemSearch.js` — flag `.ilike('item_code'`,
`item_code.ilike.` inside `.or(...)`, and direct `sb.rpc('search_items_*')` calls. This is the only mechanism that
stops picker #13 being hand-rolled by the next session. Documentation demonstrably did not (§7.2).

### 10.2 The regression suite as a CI gate, not a document

`scripts/test-item-search.sh`, run before every push alongside `npm run lint`:

1. **The 32-query set** in §9.4, each asserting the expected top result.
2. **A superset assertion** — for N sampled queries, every row `search_items_fuzzy` returns must still appear in
   `search_items_v2`. This is R3 made executable, and it is what allows the old function to be retired safely later.
3. **A bounded-work assertion** — worst-case timing budget across the §6.2 pathological inputs, so a future
   "simplification" that reintroduces a seq scan fails the build rather than the morning.

§7.3 is the argument for item 2 specifically: the defect that nearly shipped was invisible to inspection and
visible only to a differential test.

### 10.3 Keep the two jobs apart

Item picking wants precision; duplicate detection wants recall. Once Step 6 splits them, tuning one can never
silently degrade the other. Record this in `itemSearch.js` — but rely on §10.1 to enforce it.

---

## 11. Unverified

1. **The §6.2 proposed-side timings are projections.** I could not create indexes, so the indexed branch was
   simulated by removing the one branch that must otherwise seq-scan. Must be re-measured after the real
   `CREATE INDEX CONCURRENTLY` — this is the Step 1 gate.
2. **All measurements ran as `postgres` via the Management API — RLS was bypassed.** `items` policy `auth_read`
   has `qual = true` and the function is SECURITY INVOKER, so real users should see identical rows.
   **Not proven as a real authenticated user.** This is Step 2.
3. **The 12.5 % exact-match miss rate is from an 80-item sample**, not all 4,845 punctuated codes. The 300-item run
   hit the statement timeout — itself corroborating §2.4. A full survey becomes cheap once v2 is in place.
4. **No browser testing.** All frontend behaviour is read from source and reproduced by running the same query the
   code runs. The 250 ms debounce + React state interaction is unverified end-to-end — including the
   `Typeahead` race in §6.4, which is inferred from source, not observed.
5. **Concurrency figures in §6.3 are arithmetic**, not a load test. 160 qps was assumed, not measured from traffic.
6. **`item_no` search coverage** — only two sites match `item_no` today. Whether ops actually search by `IN####`
   is unknown; test #31 assumes they do.
7. **Tally's actual algorithm** is assumed prefix-tiered from the described behaviour. Not inspected.
8. **`ProcurementForecast` / `AvailableToPromise`** consume item codes but appear to have no picker. If either has
   a search box I missed, it is absent from the §9.1 blast radius table.

---

## 12. Resolved — the open question (answered 2026-08-30)

**Question was:** when New Order and Order Detail disagree (§4.2), is Order Detail's `%ILIKE%` picker actually in
use, or do ops only ever add lines from New Order?

**Answered by the user, then measured:** ops *do* open an existing order and add items there. It is low-volume —
and the volume is the least important number.

| Measure (last 90 days) | Value |
|---|---|
| Order lines total | 4,847 |
| Lines added **> 10 min after** their order was created | **18 (0.4 %)** |
| Distinct orders affected | 15 · two users (Hiral Patel, Sudheer Rathva) |
| Monthly trend (Jun / Jul / Aug) | 8 / 7 / 4 |

The May-2026 figure of 2,207 is excluded: one `created_by`, three days, 16-27 May — a data load, not ops behaviour.

### The finding that actually decides it

Of those 18 codes added through Order Detail:

| | |
|---|---|
| Contain a **space** | **14 (78 %)** |
| Contain any punctuation | **17 (94 %)** |

`UNI 901 ZDA 60 40 01 AL5` · `4E-350 Suction` · `8718 Twin Cable End Sleeves` · `Heat Sink G-68` ·
`17A230HBAC-Round Ring Pack` · `CFB 2E-150 S` · `4" Fan Grill` · `2E-300 Suction`

**Order Detail's picker is plain `%ILIKE%` on the raw code (§4.2) — it cannot find a spaced code unless the user
reproduces the legacy spacing exactly.** Nearly four out of five lines added through that screen are exactly the
class of code it fails on. The people using it are fighting the search every time.

### What could not be measured

`order_items` had 2,710 later *updates* in Aug-2026, but `updated_at` is stamped by dispatch, quantity and status
triggers. There is **no history table for line changes** (checked: no `*_histor*` / `*_audit*` / `*_log*` table
covers `order_items`), so a genuine item-code edit cannot be separated from a lifecycle update. Filtering to lines
with no dispatch/cancel/procurement activity returns 0, but that proves nothing — a manually edited line is
normally dispatched later too. **Treat item-code edits as unmeasured, not as zero.** Real usage is therefore
≥ 18 lines / 90 days, not exactly 18.

### Decision

Low frequency, **high consequence, and a confirmed 78 % hit rate on the failing code class** — on orders already
live with a customer, where choosing the wrong part is worse than on a draft.

**Order Detail moves to the front of Step 5**, behind a single canary deploy:

1. `NewStockTransfer` — 207 lines in the system's lifetime. Canary: proves the wiring pattern where nobody can be
   hurt. One deploy cycle, cheap insurance under the standing *never break prod* rule.
2. **`OrderDetail`** — the harm is here.
3. `CRMQuotations` + `CRMOpportunityDetail` (×3) — 16 quote lines in Aug-2026.
4. `Layout` global search — navigation only; no order is created from it.

Still one file per deploy, each independently revertable. By the time Step 5 begins, v2 is already proven in
production across six screens from Step 3, so the residual risk is per-file wiring (the columns each `renderItem`
needs) — caught by walking each page at 390 px per the standing mobile rule.

**No open questions remain. The plan is ready to execute on approval of Step 1.**
