#!/usr/bin/env python3
"""
eSSL / eTimeTrackLite -> app attendance connector.

Runs on the office server (same box as the eSSL software + SQL Server).
READ-ONLY: it only SELECTs from the attendance DB, then POSTs new punches to
the essl-sync Edge Function over HTTPS (outbound only). Keeps a local watermark
so it resumes cleanly after Sundays/outages and never re-sends (server de-dupes
on external_ref = essl:<DeviceLogId>, which is globally unique).

eTimeTrackLite architecture (auto-handled): punches are split into MONTHLY
tables  DeviceLogs_<month>_<year>  (plus a live base table `DeviceLogs`). This
connector reads the CURRENT month + previous month + the base table, and rolls
over to the new month automatically. First run starts from "now" so it does NOT
re-import history (set ETT_BACKFILL=1 to import everything in the active tables).

Self-configuring: auto-detects DATABASE, the punch table BASE name, and the
COLUMN names; everything can be forced via env vars. Uses pyodbc (reliable for
named instances like HOST\\SQLEXPRESS).

    python essl_connector.py --discover   # one-off: prints everything
    python essl_connector.py              # run forever (what NSSM runs)
"""
import os, sys, json, time, logging, re, threading, datetime as dt
import requests

try:
    import pyodbc
except ImportError:
    print("Missing dependency: pip install pyodbc requests", file=sys.stderr)
    raise

# ── config ────────────────────────────────────────────────────────────
SQL_SERVER   = os.environ.get("ETT_SQL_SERVER", "")
SQL_USER     = os.environ.get("ETT_SQL_USER", "")
SQL_PASSWORD = os.environ.get("ETT_SQL_PASSWORD", "")
SQL_DATABASE = os.environ.get("ETT_SQL_DATABASE", "")
SQL_TABLE    = os.environ.get("ETT_SQL_TABLE", "")      # force base/sample table
COL_ID       = os.environ.get("ETT_COL_ID", "")
COL_USER     = os.environ.get("ETT_COL_USER", "")
COL_DATE     = os.environ.get("ETT_COL_DATE", "")
COL_DEVICE   = os.environ.get("ETT_COL_DEVICE", "")
SYNC_URL     = os.environ.get("ESSL_SYNC_URL", "")
SYNC_SECRET  = os.environ.get("ESSL_CONNECTOR_SECRET", "")
POLL_SECONDS = int(os.environ.get("ETT_POLL_SECONDS", "120"))
# A stuck SELECT used to block the loop forever: no error, no retry, no log line, and the
# service still reporting "Running". These two bound that.
QUERY_TIMEOUT = int(os.environ.get("ETT_QUERY_TIMEOUT", "30"))    # seconds per SQL statement
CYCLE_TIMEOUT = int(os.environ.get("ETT_CYCLE_TIMEOUT", "180"))   # whole cycle; exceeded -> exit for restart
BATCH        = int(os.environ.get("ETT_BATCH", "500"))
BACKFILL     = bool(os.environ.get("ETT_BACKFILL", ""))
STATE_FILE   = os.environ.get("ETT_STATE_FILE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "essl_state.json"))
SOURCE       = os.environ.get("ETT_SOURCE", "essl-etimetracklite")
try:
    DEVICE_MAP = json.loads(os.environ.get("ETT_DEVICE_MAP", "{}"))
except Exception:
    DEVICE_MAP = {}

USER_COLS   = ['UserId','UserID','Userid','EmployeeCode','EmployeeId','EmpId','EnrollNumber','EnrollNo','PIN','EmpCode','CardNo','UserCode']
DATE_COLS   = ['LogDate','PunchDate','PunchTime','AttDateTime','DeviceLogDate','LogDateTime','Log_Date','DateTime','TransactionTime','RecordTime','CheckTime']
ID_COLS     = ['DeviceLogId','DeviceLogID','LogId','LogID','SrNo','Sr_No','TransactionId','RecordId','Id','ID']
DEVICE_COLS = ['DeviceId','DeviceID','SerialNumber','SerialNo','DeviceSN','SN','MachineNumber','MachineId','DeviceCode']

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("essl-connector")

# ── SQL Server connection ─────────────────────────────────────────────
_DRIVER = None
def _driver():
    global _DRIVER
    if _DRIVER:
        return _DRIVER
    avail = list(pyodbc.drivers())
    for d in ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server",
              "ODBC Driver 13 for SQL Server", "SQL Server Native Client 11.0", "SQL Server"):
        if d in avail:
            _DRIVER = d
            return d
    raise RuntimeError("No SQL Server ODBC driver found. Install 'ODBC Driver 18 for SQL Server'. Present: " + str(avail))

def connect(database):
    cs = (f"DRIVER={{{_driver()}}};SERVER={SQL_SERVER};DATABASE={database};"
          f"UID={SQL_USER};PWD={SQL_PASSWORD};Encrypt=no;TrustServerCertificate=yes;")
    conn = pyodbc.connect(cs, timeout=15)   # login timeout
    conn.timeout = QUERY_TIMEOUT            # per-statement timeout (pyodbc's connect timeout is login only)
    return conn

def _b(name):
    return '[' + name + ']'

def _pick(cols, prefs):
    low = {c.lower(): c for c in cols}
    for p in prefs:
        if p.lower() in low:
            return low[p.lower()]
    return None

def _user_databases():
    with connect("master") as c:
        cur = c.cursor()
        cur.execute("SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0")
        return [r[0] for r in cur.fetchall()]

def _tables_cols(conn):
    cur = conn.cursor()
    cur.execute("SELECT t.name, c.name FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id")
    m = {}
    for tn, cn in cur.fetchall():
        m.setdefault(tn, []).append(cn)
    return m

def _rowcount(conn, table):
    cur = conn.cursor()
    cur.execute("SELECT SUM(p.rows) FROM sys.tables t JOIN sys.partitions p ON p.object_id=t.object_id "
                "AND p.index_id IN (0,1) WHERE t.name = ?", table)
    r = cur.fetchone()
    return int(r[0]) if r and r[0] is not None else 0

# ── source detection (db + base table + columns) ──────────────────────
_SRC = None
def _period(table):
    m = re.search(r'_(\d{1,2})_(\d{4})$', table)
    return (int(m.group(2)), int(m.group(1))) if m else (0, 0)   # (year, month)
def _base_name(table):
    m = re.match(r'^(.*?)_\d{1,2}_\d{4}$', table)
    return m.group(1) if m else table

def resolve_source(verbose=False):
    global _SRC
    if _SRC:
        return _SRC
    dbs = [SQL_DATABASE] if SQL_DATABASE else _user_databases()
    cands = []   # (period, rows, db, table, cols)
    for db in dbs:
        try:
            with connect(db) as conn:
                tabs = _tables_cols(conn)
                names = [SQL_TABLE] if SQL_TABLE else list(tabs.keys())
                for t in names:
                    cols = tabs.get(t)
                    if not cols:
                        continue
                    user = COL_USER or _pick(cols, USER_COLS)
                    date = COL_DATE or _pick(cols, DATE_COLS)
                    if not (user and date):
                        continue
                    n = _rowcount(conn, t)
                    if verbose:
                        log.info("  candidate %s.%s  rows=%d  user=%s date=%s", db, t, n, user, date)
                    if n <= 0:
                        continue
                    cands.append((_period(t), n, db, t, cols))
        except Exception as e:
            if verbose:
                log.warning("  skip db %s: %s", db, e)
            continue
    if not cands:
        raise RuntimeError("No punch table found. Set ETT_SQL_DATABASE / ETT_SQL_TABLE / ETT_COL_* explicitly.")
    cands.sort(key=lambda c: (c[0], c[1]))          # prefer LATEST month, then biggest
    _, rows, db, table, cols = cands[-1]
    src = {'db': db, 'base': _base_name(table), 'sample_table': table, 'rows': rows,
           'id':     COL_ID or _pick(cols, ID_COLS),
           'user':   COL_USER or _pick(cols, USER_COLS),
           'date':   COL_DATE or _pick(cols, DATE_COLS),
           'device': COL_DEVICE or _pick(cols, DEVICE_COLS)}
    if not src['id']:
        raise RuntimeError("No id column detected on %s — set ETT_COL_ID." % table)
    _SRC = src
    log.info("SOURCE base=%s.%s (latest=%s, %d rows) [id=%s user=%s date=%s device=%s]",
             db, src['base'], table, rows, src['id'], src['user'], src['date'], src['device'])
    return src

def _active_tables(existing, base):
    """Tables that can hold recent punches: live base + current + previous month."""
    now = dt.datetime.now()
    prev = now.replace(day=1) - dt.timedelta(days=1)
    cands = [base, f"{base}_{now.month}_{now.year}", f"{base}_{prev.month}_{prev.year}"]
    seen, out = set(), []
    for t in cands:
        if t in existing and t not in seen:
            seen.add(t); out.append(t)
    return out

def _max_id(conn, tables, idcol):
    mx = 0
    for t in tables:
        try:
            cur = conn.cursor(); cur.execute(f"SELECT MAX({_b(idcol)}) FROM {_b(t)}")
            v = cur.fetchone()[0]
            if v is not None:
                mx = max(mx, int(v))
        except Exception:
            pass
    return mx

# ── watermark (PER-TABLE — each monthly table has its own DeviceLogId seq) ──
def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except Exception:
        return {}

def save_state(s):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STATE_FILE)

def _table_max(conn, table, idcol):
    try:
        cur = conn.cursor(); cur.execute(f"SELECT MAX({_b(idcol)}) FROM {_b(table)}")
        v = cur.fetchone()[0]
        return int(v) if v is not None else 0
    except Exception:
        return 0

def to_ist_iso(v):
    if isinstance(v, dt.datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
    return str(v).replace(" ", "T")[:19] + "+05:30"

# ── fetch + push ──────────────────────────────────────────────────────
def post_batch(punches, devices=None):
    body = {"source": SOURCE, "punches": punches}
    if devices:
        body["devices"] = devices
    resp = requests.post(SYNC_URL,
        headers={"x-connector-secret": SYNC_SECRET, "content-type": "application/json"},
        data=json.dumps(body), timeout=30)
    resp.raise_for_status()
    return resp.json()

# ── device health (mirrored to the app so nobody has to open the eSSL console) ──
_DEVCACHE = {"table": None, "cols": None, "checked": False}

def _find_device_table(conn):
    """Locate eSSL's device table by column shape.

    The table name differs between eTimeTrackLite builds, so match on what the columns look
    like rather than guessing a name. Cached after the first look; a build we cannot match
    simply reports no devices, which must never stop punch sync.
    """
    if _DEVCACHE["checked"]:
        return _DEVCACHE["table"], _DEVCACHE["cols"]
    _DEVCACHE["checked"] = True
    try:
        best = None                                        # (score, table, cols)
        for table, cols in _tables_cols(conn).items():
            if "devicelog" in table.lower():
                continue                                   # punch tables, not the device list
            low = {c.lower(): c for c in cols}
            idc = low.get("deviceid") or low.get("device_id")
            if not idc:
                continue
            pick = lambda *names: next((low[n] for n in names if n in low), None)
            found = {
                "id":     idc,
                # eSSL eTimeTrackLite names these DeviceFName / DeviceLocation — not the
                # DeviceName / Location the first guess assumed, which is why nothing matched.
                "name":   pick("devicefname", "devicesname", "devicename", "device_name", "name", "devicealias"),
                "serial": pick("serialnumber", "serialno", "serial_no", "machineno", "sn"),
                "loc":    pick("devicelocation", "location", "locationname", "branch", "locationid"),
                "ping":   pick("lastping", "last_ping", "lastseen", "lastactivity", "lastonline",
                               "lastconnected", "lastpingtime"),
                "status": pick("status", "isactive", "connectionstatus", "isconnected"),
            }
            # A NAME is required. Matching on a date column alone picked up unrelated tables
            # that merely carry a DeviceId — the first run reported 7 "devices" with null names
            # and ping dates of 31 Dec and 14 Aug. Score the rest so the richest table wins.
            if not found["name"]:
                continue
            score = sum(1 for k in ("serial", "loc", "ping", "status") if found[k])
            if best is None or score > best[0]:
                best = (score, table, found)
        if best:
            _DEVCACHE["table"], _DEVCACHE["cols"] = best[1], best[2]
            log.info("device table: %s %s", best[1], {k: v for k, v in best[2].items() if v})
            return best[1], best[2]
    except Exception as e:
        log.warning("device table lookup failed (ignored): %s", e)
    log.info("device table: not found - device health will not be reported")
    return None, None

def read_devices(conn):
    table, c = _find_device_table(conn)
    if not table:
        return []
    sel = [f"{_b(c['id'])} AS did"]
    for key, alias in (("name", "dname"), ("serial", "dserial"), ("loc", "dloc"),
                       ("ping", "dping"), ("status", "dstatus")):
        sel.append(f"{_b(c[key])} AS {alias}" if c[key] else f"NULL AS {alias}")
    out = []
    try:
        cur = conn.cursor()
        cur.execute(f"SELECT TOP 50 {', '.join(sel)} FROM {_b(table)}")
        for r in cur.fetchall():
            did, dname, dserial, dloc, dping, dstatus = r
            if did is None:
                continue
            out.append({
                "device_id": str(did).strip(),
                "name":      str(dname).strip()   if dname   is not None else None,
                "serial_no": str(dserial).strip() if dserial is not None else None,
                "location":  str(dloc).strip()    if dloc    is not None else None,
                "last_ping": to_ist_iso(dping)    if dping   is not None else None,
                "status":    str(dstatus).strip() if dstatus is not None else None,
            })
    except Exception as e:
        log.warning("device read failed (ignored): %s", e)
    return out


def cycle():
    src = resolve_source()
    idc = src['id']
    with connect(src['db']) as conn:
        existing = set(_tables_cols(conn).keys())
        tables = _active_tables(existing, src['base'])
        if not tables:
            log.warning("no active tables for base %s", src['base'])
            return
        state = load_state()
        wm = state.get("wm", {})          # {table_name: last DeviceLogId}
        # "Skip history" must apply ONLY to a genuine first install (empty state). It used to
        # fire for ANY table not yet seen — which includes the new monthly table created every
        # 1st of the month. That silently discarded everything already written to it, with no
        # error: on 2026-08-01 it would have dropped 65 August punches. A newly-appearing
        # monthly table can only hold punches we have never seen, so it starts at 0.
        first_install = not wm
        for t in tables:
            if t not in wm:
                skip_history = first_install and not BACKFILL
                wm[t] = _table_max(conn, t, idc) if skip_history else 0
                log.info("baseline %s at id=%s (%s)", t, wm[t],
                         "first install - skip history" if skip_history else "new table - import all")

        new, newmax = [], dict(wm)
        for t in tables:
            cur = conn.cursor()
            q = (f"SELECT {_b(idc)} AS logid, {_b(src['user'])} AS uid, {_b(src['date'])} AS logdate, "
                 f"{_b(src['device']) if src['device'] else 'NULL'} AS devid "
                 f"FROM {_b(t)} WHERE {_b(idc)} > ? ORDER BY {_b(idc)} ASC")
            cur.execute(q, wm[t])
            for r in cur.fetchall():
                new.append((t, r))
                if int(r[0]) > newmax[t]:
                    newmax[t] = int(r[0])
        if not new:
            # Heartbeat. Previously this returned silently, so "connector dead" and "no punches
            # yet today" looked identical from the server — which is why a stop on 31 Jul went
            # unnoticed until payroll needed the data. An empty POST records liveness.
            save_state({"wm": wm})
            try:
                post_batch([], read_devices(conn))
            except Exception as e:
                log.warning("heartbeat failed (not fatal): %s", e)
            return
        for i in range(0, len(new), BATCH):
            chunk = new[i:i+BATCH]
            punches, unmapped = [], set()
            for t, r in chunk:
                lid, uid, logdate, devid = int(r[0]), r[1], r[2], r[3]
                code = str(uid).strip()
                dev = str(devid).strip() if devid is not None else ""
                loc = DEVICE_MAP.get(dev)
                if dev and loc is None:
                    unmapped.add(dev)
                punches.append({"employee_code": code, "punch_at": to_ist_iso(logdate),
                                "location": loc, "external_ref": f"essl:{t}:{lid}"})
            if unmapped:
                log.warning("Unmapped DeviceIds (add to ETT_DEVICE_MAP): %s", sorted(unmapped))
            result = post_batch(punches)
            log.info("synced %d rows -> %s", len(chunk), result)
        save_state({"wm": newmax})        # advance per-table after all batches posted

# ── discover (one comprehensive dump) ─────────────────────────────────
def discover():
    print("Driver:  ", _driver())
    print("Server:  ", SQL_SERVER)
    dbs = [SQL_DATABASE] if SQL_DATABASE else _user_databases()
    print("Databases:", dbs)
    print("\n== scanning for the punch table (user-id + datetime column + rows) ==")
    try:
        src = resolve_source(verbose=True)
    except Exception as e:
        print("\n!! Auto-detect failed:", e)
        for db in dbs:
            try:
                with connect(db) as conn:
                    cur = conn.cursor()
                    cur.execute("SELECT t.name, SUM(p.rows) FROM sys.tables t "
                                "JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1) "
                                "GROUP BY t.name ORDER BY SUM(p.rows) DESC")
                    print(f"\n[{db}] tables by rows:")
                    for row in cur.fetchall()[:25]:
                        print(f"   {row[0]:<28} {row[1]}")
            except Exception as e2:
                print(f"[{db}] error: {e2}")
        return
    with connect(src['db']) as conn:
        existing = set(_tables_cols(conn).keys())
        tables = _active_tables(existing, src['base'])
        print(f"\nCHOSEN: base=`{src['base']}` in `{src['db']}`")
        print(f"  columns -> id={src['id']}  user={src['user']}  date={src['date']}  device={src['device']}")
        print("  ACTIVE tables + their current max id (per-table; first run baselines here):")
        for t in tables:
            print(f"     {t:<26} max {src['id']} = {_table_max(conn, t, src['id'])}")
        st = src['sample_table']
        cur = conn.cursor()
        if src['device']:
            cur.execute(f"SELECT DISTINCT TOP 30 {_b(src['device'])} FROM {_b(st)}")
            print(f"  DeviceIds (in {st}):", [r[0] for r in cur.fetchall()])
        cur.execute(f"SELECT DISTINCT TOP 20 {_b(src['user'])} FROM {_b(st)} ORDER BY {_b(src['user'])}")
        print("  Sample UserIds:", [r[0] for r in cur.fetchall()])
        cur.execute(f"SELECT TOP 5 {_b(src['id'])} AS logid, {_b(src['user'])} AS uid, {_b(src['date'])} AS logdate, "
                    f"{_b(src['device']) if src['device'] else 'NULL'} AS devid FROM {_b(st)} ORDER BY {_b(src['id'])} DESC")
        print("  Recent punches (id, user, date, device):")
        for r in cur.fetchall():
            print("   ", tuple(r))

def _run_cycle_guarded():
    """Run one cycle under a hard time limit.

    A hung cycle is worse than a crashed one: a dead process gets restarted by the service
    manager, a hung process never does — it just sits there reporting "Running" while
    attendance quietly stops. If a cycle overruns we exit so we get restarted. os._exit is
    deliberate: a thread blocked inside the ODBC driver cannot be killed any other way, so a
    clean shutdown would itself hang.
    """
    done, err = threading.Event(), []
    def target():
        try: cycle()
        except BaseException as e: err.append(e)
        finally: done.set()
    t = threading.Thread(target=target, daemon=True)
    t.start()
    if not done.wait(CYCLE_TIMEOUT):
        log.error("watchdog: cycle exceeded %ss (stuck query or hung connection) - exiting for restart", CYCLE_TIMEOUT)
        sys.stderr.flush(); sys.stdout.flush()
        os._exit(1)
    if err:
        raise err[0]


def main():
    if "--discover" in sys.argv:
        discover(); return
    missing = [k for k, v in {
        "ETT_SQL_SERVER": SQL_SERVER, "ETT_SQL_USER": SQL_USER, "ETT_SQL_PASSWORD": SQL_PASSWORD,
        "ESSL_SYNC_URL": SYNC_URL, "ESSL_CONNECTOR_SECRET": SYNC_SECRET,
    }.items() if not v]
    if missing:
        log.error("Missing required env vars: %s", ", ".join(missing)); sys.exit(2)
    log.info("connector up: server=%s poll=%ss url=%s backfill=%s query_timeout=%ss cycle_timeout=%ss",
             SQL_SERVER, POLL_SECONDS, SYNC_URL, BACKFILL, QUERY_TIMEOUT, CYCLE_TIMEOUT)
    while True:
        try:
            _run_cycle_guarded()
        except requests.RequestException as e:
            log.error("network error (will retry, watermark unchanged): %s", e)
        except Exception as e:
            log.exception("cycle error (will retry): %s", e)
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    main()
