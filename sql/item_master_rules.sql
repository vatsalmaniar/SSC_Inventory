-- ═══════════════════════════════════════════════════════════════════════════
-- ITEM MASTER RULES  ·  brand, taxonomy and the part code, enforced in the DB
--
-- src/lib/itemTaxonomy.js decides what the New Item form may offer, but nothing
-- ever checked what actually gets STORED. The form is one of several ways into
-- the items table — an import, an RPC or a direct API call bypasses it
-- entirely — so the rules lived only where they were easiest to walk around.
--
-- What went wrong without them:
--   · SRL1-24D, a slim relay, was saved as 'Terminal Block Accessories /
--     DIN Rail / ECAP'. Every value legal, the combination nonsense.
--   · 121 items carry no category at all.
--   · 279 more are classified against combinations the taxonomy does not allow,
--     including four Mitsubishi servo motor sets filed under HMI.
--   · brand is free text, so one typo makes a 95th brand nobody notices.
--
-- Postgres cannot read a .js file, so the taxonomy has to live here. These two
-- tables become the truth; itemTaxonomy.js is seeded FROM them and stops being
-- a second source that can drift.
--
-- NOTHING HERE HIDES AN ITEM. There is no RLS change, no filter, no read path
-- touched — every trigger below fires on INSERT/UPDATE only. All 9,857 items
-- keep loading everywhere they load today.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists item_brands (
  brand      text primary key,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);
comment on table item_brands is
  'Every brand an item may carry. Adding one is a deliberate act via add_item_brand(), not a typo in a form field. is_active=false keeps a brand readable on existing items but off the New Item list.';

create table if not exists item_taxonomy (
  brand       text not null,
  category    text not null,
  subcategory text not null,
  series      text,
  created_at  timestamptz not null default now()
);
comment on table item_taxonomy is
  'Allowed category/subcategory/series per brand. A brand with rows here is CURATED — its items are validated. A brand with none stays free text, exactly as before.';

create unique index if not exists item_taxonomy_key
  on item_taxonomy (brand, category, subcategory, coalesce(series, ''));
create index if not exists idx_item_taxonomy_brand on item_taxonomy (brand);

alter table item_brands   enable row level security;
alter table item_taxonomy enable row level security;
drop policy if exists ib_read on item_brands;
create policy ib_read on item_brands for select to authenticated using (true);
drop policy if exists it_read on item_taxonomy;
create policy it_read on item_taxonomy for select to authenticated using (true);

-- Seed the brands from what items already carry, so day one changes nothing.
insert into item_brands (brand)
select distinct brand from items where brand is not null and btrim(brand) <> ''
on conflict (brand) do nothing;

-- Seed the taxonomy from itemTaxonomy.js as it stands today.
insert into item_taxonomy (brand, category, subcategory, series)
values
    ('Mitsubishi Electric','FA','Compact PLC','FX2N'),
    ('Mitsubishi Electric','FA','Compact PLC','FX3G'),
    ('Mitsubishi Electric','FA','Compact PLC','FX3GA'),
    ('Mitsubishi Electric','FA','Compact PLC','FX3S'),
    ('Mitsubishi Electric','FA','Compact PLC','FX3U'),
    ('Mitsubishi Electric','FA','Compact PLC','FX5S'),
    ('Mitsubishi Electric','FA','Compact PLC','FX5U'),
    ('Mitsubishi Electric','FA','Compact PLC','FX5UJ'),
    ('Mitsubishi Electric','FA','Compact PLC','FX5 Expansion'),
    ('Mitsubishi Electric','FA','Modular PLC','iQ-R'),
    ('Mitsubishi Electric','FA','Modular PLC','Q Series'),
    ('Mitsubishi Electric','FA','Modular PLC','PLC Cables'),
    ('Mitsubishi Electric','FA','Modular I/O','MELSEC MIO'),
    ('Mitsubishi Electric','FA','GOC','GOC'),
    ('Mitsubishi Electric','FA','HMI (GOT)','GS'),
    ('Mitsubishi Electric','FA','HMI (GOT)','GT10'),
    ('Mitsubishi Electric','FA','HMI (GOT)','GT21'),
    ('Mitsubishi Electric','FA','HMI (GOT)','GT25'),
    ('Mitsubishi Electric','FA','HMI (GOT)','GT27'),
    ('Mitsubishi Electric','FA','Inverter (VFD)','FR-A840'),
    ('Mitsubishi Electric','FA','Inverter (VFD)','FR-CS'),
    ('Mitsubishi Electric','FA','Inverter (VFD)','FR-D720'),
    ('Mitsubishi Electric','FA','Inverter (VFD)','FR-D740'),
    ('Mitsubishi Electric','FA','Inverter (VFD)','FR-E740'),
    ('Mitsubishi Electric','FA','Inverter (VFD)','FR-E840'),
    ('Mitsubishi Electric','FA','Inverter (VFD)','Inverter Accessories'),
    ('Mitsubishi Electric','FA','Servo','HG-JR'),
    ('Mitsubishi Electric','FA','Servo','HG-KN'),
    ('Mitsubishi Electric','FA','Servo','HG-SN'),
    ('Mitsubishi Electric','FA','Servo','HG-SR'),
    ('Mitsubishi Electric','FA','Servo','HJ-KS'),
    ('Mitsubishi Electric','FA','Servo','MR-J4'),
    ('Mitsubishi Electric','FA','Servo','MR-JE-A'),
    ('Mitsubishi Electric','FA','Servo','MR-JE-AS'),
    ('Mitsubishi Electric','FA','Servo','MR-JE-B'),
    ('Mitsubishi Electric','FA','Servo','MR-JET'),
    ('Mitsubishi Electric','FA','Servo','Servo Cables'),
    ('Mitsubishi Electric','FA','Servo','Servo Connectors'),
    ('Mitsubishi Electric','FA','Servo','Servo Accessories'),
    ('Mitsubishi Electric','LVS','ACB','Contactor'),
    ('Mitsubishi Electric','LVS','ACB','Distribution Box'),
    ('Mitsubishi Electric','LVS','MCCB',null),
    ('Mitsubishi Electric','LVS','MCB',null),
    ('Mitsubishi Electric','LVS','MPCB',null),
    ('Mitsubishi Electric','LVS','RCCB',null),
    ('Mitsubishi Electric','LVS','Contactor','Contactor'),
    ('nVent Hoffman','Cable Tray & Wire Way','Cable Tray & Wire Way','CT'),
    ('nVent Hoffman','Enclosure Accessories','Accessories','Floor Stand'),
    ('nVent Hoffman','Enclosure Accessories','Accessories','Inner Door'),
    ('nVent Hoffman','Enclosure Accessories','Accessories','Mounting Plate'),
    ('nVent Hoffman','Enclosure Accessories','Accessories','Plinth'),
    ('nVent Hoffman','Enclosure Accessories','Accessories','Rain Hood'),
    ('nVent Hoffman','Hazardous SS Enclosure','Accessories','Floor Stand'),
    ('nVent Hoffman','Hazardous SS Enclosure','Hazardous Location','EXE'),
    ('nVent Hoffman','Hazardous SS Enclosure','Wall Mounted','EXE'),
    ('nVent Hoffman','Mild Steel Enclosure','Accessories','Floor Stand'),
    ('nVent Hoffman','Mild Steel Enclosure','Accessories','Inner Door'),
    ('nVent Hoffman','Mild Steel Enclosure','Accessories','Mounting Plate'),
    ('nVent Hoffman','Mild Steel Enclosure','Accessories','Rain Hood'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','EKSS'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','MCD'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','MCS'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','Mounting Plate'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','NCD'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','NCD-HT'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','NCS'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','NCS-HT'),
    ('nVent Hoffman','Mild Steel Enclosure','Floor Standing','Plinth'),
    ('nVent Hoffman','Mild Steel Enclosure','HMI Enclosure','Mounting Plate'),
    ('nVent Hoffman','Mild Steel Enclosure','Junction Box','STB'),
    ('nVent Hoffman','Mild Steel Enclosure','Terminal Box','SSTB'),
    ('nVent Hoffman','Mild Steel Enclosure','Terminal Box','STB'),
    ('nVent Hoffman','Mild Steel Enclosure','Wall Mounted','Door Hardware'),
    ('nVent Hoffman','Mild Steel Enclosure','Wall Mounted','Inner Door'),
    ('nVent Hoffman','Mild Steel Enclosure','Wall Mounted','MAD'),
    ('nVent Hoffman','Mild Steel Enclosure','Wall Mounted','MAS'),
    ('nVent Hoffman','Mild Steel Enclosure','Wall Mounted','Mounting Plate'),
    ('nVent Hoffman','Mild Steel Enclosure','Wall Mounted','Plain Door'),
    ('nVent Hoffman','Mild Steel Enclosure','Wall Mounted','Rain Hood'),
    ('nVent Hoffman','Stainless Steel Enclosure','Floor Standing','EKDS'),
    ('nVent Hoffman','Stainless Steel Enclosure','Floor Standing','EKSS'),
    ('nVent Hoffman','Stainless Steel Enclosure','Floor Standing','MSC'),
    ('nVent Hoffman','Stainless Steel Enclosure','Floor Standing','Mounting Plate'),
    ('nVent Hoffman','Stainless Steel Enclosure','Hazardous Location','EXE'),
    ('nVent Hoffman','Stainless Steel Enclosure','Terminal Box','MSC'),
    ('nVent Hoffman','Stainless Steel Enclosure','Terminal Box','SSTB'),
    ('nVent Hoffman','Stainless Steel Enclosure','Wall Mounted','ADR'),
    ('nVent Hoffman','Stainless Steel Enclosure','Wall Mounted','ASR'),
    ('nVent Hoffman','Stainless Steel Enclosure','Wall Mounted','EXE'),
    ('nVent Hoffman','Stainless Steel Enclosure','Wall Mounted','MSC'),
    ('nVent Hoffman','Terminal Box','Terminal Box',null),
    ('nVent Hoffman','Thermal Management','Thermal Management',null),
    ('Connectwell','Terminal Block Accessories','DIN Rail','CA'),
    ('Connectwell','Terminal Block Accessories','DIN Rail','CDINS'),
    ('Connectwell','Terminal Block Accessories','DIN Rail','CDS'),
    ('Connectwell','Terminal Block Accessories','DIN Rail','ECAP'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CBDT'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CBS'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CDL'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CM'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CMB'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CP'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CSB'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CSC'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CSTS'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CX'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','CY'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','DDFL'),
    ('Connectwell','Terminal Block Accessories','End / Partition Plate','EP'),
    ('Connectwell','Terminal Block Accessories','End Clamp','CA'),
    ('Connectwell','Terminal Block Accessories','Marker','GMH'),
    ('Connectwell','Terminal Block Accessories','Marker','MC'),
    ('Connectwell','Terminal Block Accessories','Mounting / Hardware','CA'),
    ('Connectwell','Terminal Block Accessories','Mounting / Hardware','CSB'),
    ('Connectwell','Terminal Block Accessories','Mounting / Hardware','DDFL'),
    ('Connectwell','Terminal Block Accessories','Mounting / Hardware','SCS'),
    ('Connectwell','Terminal Block Accessories','Plug / Isolation','CX'),
    ('Connectwell','Terminal Block Accessories','Shorting Link / Jumper','CA'),
    ('Connectwell','Terminal Block Accessories','Shorting Link / Jumper','CBDT'),
    ('Connectwell','Terminal Block Accessories','Shorting Link / Jumper','CP'),
    ('Connectwell','Terminal Block Accessories','Shorting Link / Jumper','JX'),
    ('Connectwell','Terminal Block Accessories','Tool','SCM'),
    ('Connectwell','Terminal Blocks','Component','CX'),
    ('Connectwell','Terminal Blocks','Disconnect / Knife','CKT'),
    ('Connectwell','Terminal Blocks','Disconnect / Knife','CY'),
    ('Connectwell','Terminal Blocks','Disconnect / Knife','DDFL'),
    ('Connectwell','Terminal Blocks','Feed Through','CBB'),
    ('Connectwell','Terminal Blocks','Feed Through','CBS'),
    ('Connectwell','Terminal Blocks','Feed Through','CM'),
    ('Connectwell','Terminal Blocks','Feed Through','CP'),
    ('Connectwell','Terminal Blocks','Feed Through','CSC'),
    ('Connectwell','Terminal Blocks','Feed Through','CTS'),
    ('Connectwell','Terminal Blocks','Feed Through','CX'),
    ('Connectwell','Terminal Blocks','Feed Through','CY'),
    ('Connectwell','Terminal Blocks','Fuse','CF'),
    ('Connectwell','Terminal Blocks','Fuse','CP'),
    ('Connectwell','Terminal Blocks','Fuse','CX'),
    ('Connectwell','Terminal Blocks','Fuse','CY'),
    ('Connectwell','Terminal Blocks','Fuse','DDFL'),
    ('Connectwell','Terminal Blocks','Grounding / Earth','CENC'),
    ('Connectwell','Terminal Blocks','Grounding / Earth','CGT'),
    ('Connectwell','Terminal Blocks','Grounding / Earth','CP'),
    ('Connectwell','Terminal Blocks','Grounding / Earth','CSC'),
    ('Connectwell','Terminal Blocks','Grounding / Earth','CTS'),
    ('Connectwell','Terminal Blocks','Grounding / Earth','CX'),
    ('Connectwell','Terminal Blocks','Panel Mount','CM'),
    ('Connectwell','Terminal Blocks','Panel Mount','CMB'),
    ('Connectwell','Terminal Blocks','Pluggable','CX'),
    ('Connectwell','Terminal Blocks','Power Distribution','CDB'),
    ('Connectwell','Terminal Blocks','Power Distribution','CMDB'),
    ('Connectwell','Terminal Blocks','Power Distribution','CX'),
    ('Connectwell','Terminal Blocks','Power Distribution','DB'),
    ('Connectwell','Terminal Blocks','Power Distribution','PDB'),
    ('Connectwell','Terminal Blocks','Stud / Heavy Duty','CSTS'),
    ('Connectwell','Terminal Blocks','Three Level','CP'),
    ('Connectwell','Terminal Blocks','Three Level','CTL'),
    ('Connectwell','Terminal Blocks','Two Level','CDL'),
    ('Connectwell','Terminal Blocks','Two Level','CP'),
    ('Connectwell','Terminal Blocks','Two Level','CX'),
    ('Connectwell','Relay','Slim Relay','CSER'),
    ('Connectwell','Relay','Slim Relay','CSR'),
    ('Connectwell','Relay','Slim Relay','SRL'),
    ('Connectwell','Relay','Modular Relay','CRB'),
    ('Connectwell','Relay','Modular Relay','CRLA'),
    ('Connectwell','Relay','Modular Relay','CRLD'),
    ('Connectwell','Relay','Modular Relay','CRMA'),
    ('Connectwell','Relay','Modular Relay','CRS'),
    ('Connectwell','Relay','IMRE','CRB'),
    ('Connectwell','Relay','IMRE','CRLA'),
    ('Connectwell','Relay','IMRE','CRLD'),
    ('Connectwell','Relay','IMRE','CRS'),
    ('Connectwell','Relay','CIMRE','CIMRE'),
    ('Connectwell','Power Supply','SMPS','CSS'),
    ('Connectwell','Power Supply','Redundancy','CDR'),
    ('Connectwell','Monitoring','Fan Monitor','CFTD'),
    ('Connectwell','Monitoring','Fan Monitor','CFTDPR')
on conflict do nothing;


-- ── The single validator ────────────────────────────────────────────────────
-- The report below and the trigger further down both call THIS. One rule, one
-- implementation: a report that disagrees with the trigger is worse than no
-- report, because it tells you the coast is clear when it isn't.
--
-- Returns NULL when the combination is acceptable, otherwise the reason in
-- words a buyer can act on.
create or replace function item_master_violation(
  p_brand text, p_category text, p_subcategory text, p_series text
) returns text
language plpgsql
stable
set search_path to public, pg_temp
as $$
declare v_curated boolean;
begin
  if p_brand is null or btrim(p_brand) = '' then
    return 'Brand is required.';
  end if;
  if not exists (select 1 from item_brands b where b.brand = p_brand) then
    return format('Brand "%s" is not on the approved list. Add it first.', p_brand);
  end if;

  -- A brand with no taxonomy rows is NOT curated: it keeps free-text
  -- category/subcategory/series, exactly as it does today. Roughly 91 of the 94
  -- brands are in this position and must stay unaffected.
  select exists (select 1 from item_taxonomy t where t.brand = p_brand) into v_curated;
  if not v_curated then return null; end if;

  if p_category is null or btrim(p_category) = '' then
    return format('%s is a standardised brand — a category is required.', p_brand);
  end if;
  if not exists (select 1 from item_taxonomy t where t.brand = p_brand and t.category = p_category) then
    return format('"%s" is not a category for %s.', p_category, p_brand);
  end if;
  if p_subcategory is not null and btrim(p_subcategory) <> ''
     and not exists (select 1 from item_taxonomy t
                      where t.brand = p_brand and t.category = p_category
                        and t.subcategory = p_subcategory) then
    return format('"%s" is not a subcategory of %s / %s.', p_subcategory, p_brand, p_category);
  end if;
  if p_series is not null and btrim(p_series) <> ''
     and not exists (select 1 from item_taxonomy t
                      where t.brand = p_brand and t.category = p_category
                        and t.subcategory = p_subcategory and t.series = p_series) then
    return format('"%s" is not a series under %s / %s.', p_series, p_category, p_subcategory);
  end if;
  return null;
end $$;

revoke execute on function item_master_violation(text,text,text,text) from public, anon;
grant  execute on function item_master_violation(text,text,text,text) to authenticated;


-- ── Fill in what was never written down ─────────────────────────────────────
-- itemTaxonomy.js listed the LVS categories with EMPTY series arrays, on the
-- note that the Mitsubishi LVS price list was not held yet. An empty array
-- means "no series permitted", so 535 correctly-classified items — every MCCB,
-- MCB, RCCB, MPCB, contactor and overload relay — failed a rule that had never
-- been filled in.
--
-- These combinations are taken from what the items already use. They describe
-- real Mitsubishi product structure: NF63…NF800 ARE the MCCB frames.
--
-- Deliberately NOT included, so they keep failing and stay on the worklist:
--   FA / HMI / Servo Motor        servo motors filed as touchscreens (fixed)
--   FA / Controller, FA / VFD     subcategories retired when FA was curated
--   Stud / Heavy Duty / CSB,CBDT  CSB is mounting hardware, CBDT a shorting link
--   Grounding / Earth / CY        CY is a disconnect series
--   Mild Steel / Floor Standing / SPM   not in the nVent book
insert into item_taxonomy (brand, category, subcategory, series) values
  ('Mitsubishi Electric','LVS','ACB','AE Series'),
  ('Mitsubishi Electric','LVS','ACB Accessories','ACB Accessories'),
  ('Mitsubishi Electric','LVS','Contactor','S-T / S-N'),
  ('Mitsubishi Electric','LVS','Contactor','SR (auxiliary relay)'),
  ('Mitsubishi Electric','LVS','Contactor Accessories','Auxiliary Contact / Coil'),
  ('Mitsubishi Electric','LVS','Contactor Accessories','Coil'),
  ('Mitsubishi Electric','LVS','Distribution Board','Distribution Board'),
  ('Mitsubishi Electric','LVS','Energy Meter','EMU / ME'),
  ('Mitsubishi Electric','LVS','MCB','BHW-T10'),
  ('Mitsubishi Electric','LVS','MCB','KBW-T'),
  ('Mitsubishi Electric','LVS','MCCB','NF (other)'),
  ('Mitsubishi Electric','LVS','MCCB','NF63'),
  ('Mitsubishi Electric','LVS','MCCB','NF125'),
  ('Mitsubishi Electric','LVS','MCCB','NF250'),
  ('Mitsubishi Electric','LVS','MCCB','NF400'),
  ('Mitsubishi Electric','LVS','MCCB','NF800'),
  ('Mitsubishi Electric','LVS','MCCB Accessories','Extended Rotary Handle'),
  ('Mitsubishi Electric','LVS','MCCB Accessories','Lock'),
  ('Mitsubishi Electric','LVS','MCCB Accessories','Spreader'),
  ('Mitsubishi Electric','LVS','MCCB Accessories','Terminal Plate'),
  ('Mitsubishi Electric','LVS','MCCB Accessories','UVT'),
  ('Mitsubishi Electric','LVS','MPCB','MB30'),
  ('Mitsubishi Electric','LVS','MPCB','MMP-T / CP30'),
  ('Mitsubishi Electric','LVS','Overload Relay','TH-T / TH-N'),
  ('Mitsubishi Electric','LVS','RCCB','BV-D / BVW'),
  -- FR-E820 is a genuine inverter series; the file listed FR-E840 but not this one.
  ('Mitsubishi Electric','FA','Inverter (VFD)','FR-E820')
on conflict do nothing;


-- ── Enforcement ─────────────────────────────────────────────────────────────
-- Fires on INSERT always, and on UPDATE only when brand/category/subcategory/
-- series actually change.
--
-- That second half is the whole reason this is safe to switch on today. 127
-- items still have no category — the legacy backlog being cleaned up slowly —
-- and a blanket check would make every one of them unsaveable the next time
-- anyone corrected a description or an MOQ. They would have been booby-trapped
-- by a rule about a field nobody touched. Same trap that block_superseded_item
-- had to avoid with live order lines.
--
-- So: a bad NEW item is refused, a bad CHANGE is refused, and everything
-- already here stays editable and can be corrected toward valid at any pace.
create or replace function items_enforce_master_rules()
returns trigger
language plpgsql
set search_path to public
as $$
declare v_why text;
begin
  if tg_op = 'UPDATE'
     and new.brand       is not distinct from old.brand
     and new.category    is not distinct from old.category
     and new.subcategory is not distinct from old.subcategory
     and new.series      is not distinct from old.series then
    return new;
  end if;

  -- Clearing the category on an EXISTING item is allowed. "Not yet classified"
  -- is a legitimate state — 127 items are in it — and it is the step someone
  -- takes when they find a wrong category and do not yet know the right one.
  -- Blocking it would force a guess, which is how bad categories got here.
  -- A NEW item still has to be classified: that is the point of the rule.
  if tg_op = 'UPDATE' and (new.category is null or btrim(new.category) = '') then
    if new.brand is distinct from old.brand then
      v_why := item_master_violation(new.brand, null, null, null);
      -- only the brand half applies; a null category is fine on an update
      if v_why is not null and v_why not like '%category is required%' then
        raise exception '%', v_why using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;

  v_why := item_master_violation(new.brand, new.category, new.subcategory, new.series);
  if v_why is not null then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_items_master_rules on items;
create trigger trg_items_master_rules
  before insert or update of brand, category, subcategory, series on items
  for each row execute function items_enforce_master_rules();


-- ── The part code never changes ─────────────────────────────────────────────
-- order_items, po_items, grn_items and inventory all carry item_code as PLAIN
-- TEXT, not a foreign key. Renaming an item would silently orphan every
-- document that ever used it — the history would still show the old code and
-- nothing would join. Same doctrine as po_number_is_immutable.
create or replace function item_code_is_immutable()
returns trigger
language plpgsql
set search_path to public
as $$
begin
  if new.item_code is distinct from old.item_code then
    -- service_role (a migration, a deliberate correction) may still act
    if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
      return new;
    end if;
    raise exception
      'Item code % cannot be changed. Orders, POs, GRNs and stock all reference it as text — renaming it would orphan that history. Create a new item and supersede this one instead.',
      old.item_code using errcode = 'check_violation';
  end if;
  if new.item_no is distinct from old.item_no then
    raise exception 'Item number % cannot be changed.', old.item_no using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_item_code_immutable on items;
create trigger trg_item_code_immutable
  before update of item_code, item_no on items
  for each row execute function item_code_is_immutable();


-- ── Editing an item ─────────────────────────────────────────────────────────
-- There has never been an item edit anywhere in the app. Items could only be
-- created, so every correction this week — a wrong category, a wrong MOQ — had
-- to be done by hand against the database. That is why bad data sat for months.
--
-- Not a plain UPDATE from the client: items carries auth_update USING (true),
-- so any signed-in user can currently rewrite any item. Editing the master
-- deserves the same authority as creating one.
--
-- item_code and item_no are absent from the signature on purpose. They are not
-- editable by anyone, and trg_item_code_immutable enforces that independently.
create or replace function update_item(
  p_item_no     text,
  p_brand       text,
  p_category    text,
  p_subcategory text,
  p_series      text,
  p_description text,
  p_moq         integer,
  p_type        text,
  p_notes       text default null
) returns items
language plpgsql
security definer
set search_path to public, pg_temp
as $$
declare v_role text; v_row items; v_why text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is null or v_role not in ('admin','management') then
    raise exception 'Only admin or management can edit an item.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from items where item_no = p_item_no;
  if not found then raise exception 'Item % not found.', p_item_no; end if;

  if p_type is not null and p_type not in ('SI','CI') then
    raise exception 'Type must be SI or CI.';
  end if;
  if p_moq is not null and p_moq < 1 then
    raise exception 'MOQ must be at least 1.';
  end if;

  -- Same validator the trigger uses, called here so the message comes back as a
  -- clean sentence rather than a trigger error the UI has to unwrap.
  v_why := item_master_violation(p_brand, p_category, p_subcategory, p_series);
  if v_why is not null and not (p_category is null or btrim(p_category) = '') then
    raise exception '%', v_why using errcode = 'check_violation';
  end if;

  update items set
      brand       = coalesce(nullif(btrim(p_brand), ''), brand),
      category    = nullif(btrim(coalesce(p_category, '')), ''),
      subcategory = nullif(btrim(coalesce(p_subcategory, '')), ''),
      series      = nullif(btrim(coalesce(p_series, '')), ''),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      moq         = coalesce(p_moq, moq),
      type        = coalesce(nullif(btrim(coalesce(p_type, '')), ''), type),
      notes       = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_at  = now()
    where item_no = p_item_no
  returning * into v_row;

  return v_row;
end $$;

revoke execute on function update_item(text,text,text,text,text,text,integer,text,text) from public, anon;
grant  execute on function update_item(text,text,text,text,text,text,integer,text,text) to authenticated;


-- ── An item is never deleted ────────────────────────────────────────────────
-- The items table is the backbone of the app, and its part code is the join key
-- for everything downstream — but NOT as a foreign key. order_items, po_items,
-- grn_items and inventory all carry item_code as plain text, so the database
-- would let an item be deleted without a word and leave 1,805 order codes,
-- 1,618 PO codes, 1,281 GRN codes and 3,494 stock rows pointing at nothing.
-- No error, no cascade, no way to notice until a report came out wrong.
--
-- Until now the only thing standing between that and the data was the
-- admin_write policy being FOR ALL — which permits DELETE. Four people have
-- that role.
--
-- There is no escape hatch here, deliberately. A retired part is marked, not
-- removed: item_status = 'Superseded' or 'Discontinued' keeps the row, its
-- history and its stock, and tells anyone reaching for it what to use instead.
-- If a row genuinely must go, disabling this trigger as postgres is a visible,
-- deliberate act — which is exactly the bar that decision should have to clear.
create or replace function items_are_never_deleted()
returns trigger
language plpgsql
set search_path to public
as $$
declare v_orders int; v_pos int; v_grns int; v_stock int;
begin
  select count(*) into v_orders from order_items where item_code = old.item_code;
  select count(*) into v_pos    from po_items    where item_code = old.item_code;
  select count(*) into v_grns   from grn_items   where item_code = old.item_code;
  select count(*) into v_stock  from inventory   where product_code = old.item_code;

  raise exception
    'Item % (%) cannot be deleted. Orders, POs, GRNs and stock reference it by code, not by key, so deleting it would orphan that history silently%. Mark it Superseded or Discontinued instead — the row and its history stay, and anyone reaching for it is told what to use.',
    old.item_code, old.item_no,
    case when v_orders + v_pos + v_grns + v_stock > 0
         then format(' (%s order line(s), %s PO line(s), %s GRN line(s), %s stock row(s) today)',
                     v_orders, v_pos, v_grns, v_stock)
         else '' end
    using errcode = 'check_violation';
  return null;
end $$;

drop trigger if exists trg_items_never_deleted on items;
create trigger trg_items_never_deleted
  before delete on items
  for each row execute function items_are_never_deleted();
