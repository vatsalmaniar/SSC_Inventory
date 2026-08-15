#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Number range acceptance test.
#
# Tests every document series through the REST API using REAL user sessions —
# NOT the SQL editor. The SQL editor connects as postgres, which bypasses RLS
# and cannot see a missing grant; that is exactly how a SECURITY INVOKER
# allocator reached production and broke PO approval for every user while
# backend testing reported it as working.
#
#   SUPABASE_PAT=sbp_... ./scripts/test-number-ranges.sh
#
# Creates throwaway documents, deletes them, and restores counters that were
# advanced WITHOUT a document ever existing. Counters that a document did hold
# are deliberately left advanced — winding a counter backwards is the one
# operation that causes number reuse.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
PROJ=kvjihrlbntxcdadogmhn
PUB=sb_publishable_kgrGHkw1jDvlLIOF3cPKiw_2ucunE3P
PAT="${SUPABASE_PAT:-}"
[ -z "$PAT" ] && { echo "Set SUPABASE_PAT first."; exit 1; }

PASS=0; FAIL=0
ok(){   printf "  \033[32m✓\033[0m %-34s %s\n" "$1" "$2"; PASS=$((PASS+1)); }
bad(){  printf "  \033[31m✗\033[0m %-34s %s\n" "$1" "$2"; FAIL=$((FAIL+1)); }
check(){ # name expected actual
  if [[ "$3" == *"$2"* ]]; then ok "$1" "$3"; else bad "$1" "got: $3  (wanted $2)"; fi
}

sql(){ curl -s -X POST "https://api.supabase.com/v1/projects/$PROJ/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d "$(jq -Rn --arg q "$1" '{query:$q}')"; }

SR=$(curl -s "https://api.supabase.com/v1/projects/$PROJ/api-keys?reveal=true" -H "Authorization: Bearer $PAT" \
     | python3 -c "import sys,json;print([k['api_key'] for k in json.load(sys.stdin) if k.get('name')=='service_role'][0])")

# A real access token for a user, without their password. No email is sent.
tok(){
  local H
  H=$(curl -s -X POST "https://$PROJ.supabase.co/auth/v1/admin/generate_link" \
      -H "apikey: $SR" -H "Authorization: Bearer $SR" -H "Content-Type: application/json" \
      -d "{\"type\":\"magiclink\",\"email\":\"$1@ssccontrol.com\"}" \
      | python3 -c "import sys,json;print(json.load(sys.stdin).get('hashed_token',''))")
  [ -z "$H" ] && { echo ""; return; }
  curl -s -X POST "https://$PROJ.supabase.co/auth/v1/verify" -H "apikey: $SR" \
    -H "Content-Type: application/json" -d "{\"type\":\"magiclink\",\"token_hash\":\"$H\"}" \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))"
}
rpc(){ # token, function, json body (optional)
  local B="${3:-}"; [ -z "$B" ] && B='{}'
  curl -s -X POST "https://$PROJ.supabase.co/rest/v1/rpc/$2" -H "apikey: $PUB" \
    -H "Authorization: Bearer $1" -H "Content-Type: application/json" --data-binary "$B"; }
msg(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('message', d) if isinstance(d,dict) else d)"; }

ADMIN=$(tok vatsal.maniar); OPS=$(tok hiral.patel); SALES=$(tok aarth.joshi)
for t in ADMIN OPS SALES; do [ -z "${!t}" ] && { echo "could not mint $t token"; exit 1; }; done

echo; echo "── allocators (no document written) ────────────────────────────────"
V=$(sql "select last_seq from doc_number_counters where doc_type='VENDOR'"   | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
Q=$(sql "select last_seq from doc_number_counters where doc_type='QU'"       | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
S=$(sql "select last_seq from doc_number_counters where doc_type='SPA'"      | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
K=$(sql "select last_seq from doc_number_counters where doc_type='GRN:KAV'"  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
C=$(sql "select last_seq from doc_number_counters where doc_type='CUSTOMER'" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
check "vendor code"   "VN$(printf %04d $((V+1)))"        "$(rpc "$OPS" next_vendor_code | tr -d '\"')"
check "quote number"  "SSC/QU$(printf %04d $((Q+1)))"    "$(rpc "$OPS" generate_crm_quote_number '{"p_fy":"26-27"}' | tr -d '\"')"
check "SPA number"    "SSC/SPA$(printf %04d $((S+1)))"   "$(rpc "$OPS" next_spa_no | tr -d '\"')"
check "GRN (Kaveri)"  "SSC/GRN$(printf %04d $((K+1)))/KAV" "$(rpc "$OPS" next_grn_number '{"p_fc":"KAV"}' | tr -d '\"')"
check "customer id"   "CU$(printf %04d $((C+1)))"        "$(rpc "$OPS" generate_customer_id | tr -d '\"')"
# nothing was written, so give these numbers back
sql "update doc_number_counters set last_seq=v.s from (values ('VENDOR',$V),('QU',$Q),('SPA',$S),('GRN:KAV',$K),('CUSTOMER',$C)) v(t,s) where doc_type=v.t" >/dev/null

echo; echo "── order acceptance ────────────────────────────────────────────────"
OID=$(sql "insert into orders (order_type,customer_name,customer_id,status,is_test,order_date) values ('CO','NUMBER RANGE TEST',(select id from customers limit 1),'pending_approval',true,current_date) returning id" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
CO=$(sql "select last_seq from doc_number_counters where doc_type='CO'" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
ACC="{\"order_id\":\"$OID\",\"approver_name\":\"Test\",\"order_type\":\"CO\"}"
rpc "$OPS" approve_order "$ACC" >/dev/null
check "accepted"        "SSC/CO$(printf %04d $((CO+1)))" "$(sql "select order_number from orders where id='$OID'" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['order_number'])")"
check "double accept refused" "already been accepted"   "$(rpc "$OPS" approve_order "$ACC" | msg)"
# A FRESH order for the sales attempt. Reusing the accepted one above made the
# already-accepted guard fire first, so the test passed without ever proving
# that a salesperson is refused.
OID2=$(sql "insert into orders (order_type,customer_name,customer_id,status,is_test,order_date) values ('CO','NUMBER RANGE TEST 2',(select id from customers limit 1),'pending_approval',true,current_date) returning id" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
ACC2="{\"order_id\":\"$OID2\",\"approver_name\":\"Test\",\"order_type\":\"CO\"}"
check "sales cannot accept"   "cannot change order status" "$(rpc "$SALES" approve_order "$ACC2" | msg)"
check "  ...and it stayed Temp" "Temp/" "$(sql "select order_number from orders where id='$OID2'" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['order_number'])")"
sql "delete from orders where id in ('$OID','$OID2')" >/dev/null

echo; echo "── PO approval ─────────────────────────────────────────────────────"
PID=$(sql "insert into purchase_orders (po_number,vendor_id,status,is_test,po_date,created_by,created_by_name,notes) select 'Temp/NRTEST/26-27',(select id from vendors where vendor_code='VN0005'),'pending_approval',true,current_date,(select id from profiles where username='mehul.maniar'),'Mehul Maniar','number range test' returning id" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
PO=$(sql "select last_seq from po_number_counters where po_type='PO'" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
APP="{\"p_po_id\":\"$PID\",\"p_approver_name\":\"Test\"}"
check "approved"              "SSC/PO$(printf %04d $((PO+1)))" "$(rpc "$ADMIN" approve_po "$APP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['out_po_number'] if isinstance(d,list) and d else d)")"
check "double approve refused" "already approved"              "$(rpc "$ADMIN" approve_po "$APP" | msg)"
check "sales cannot approve"   "cannot approve"                "$(rpc "$SALES" approve_po "$APP" | msg)"
sql "delete from po_revisions where po_id='$PID'; delete from po_items where po_id='$PID'; delete from purchase_orders where id='$PID'" >/dev/null

echo; echo "── item creation ───────────────────────────────────────────────────"
I=$(sql "select last_seq from doc_number_counters where doc_type='ITEM'" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
BODY='{"p_item_code":"ZZNRTEST0001","p_brand":"Connectwell","p_category":"Terminal Blocks","p_subcategory":"Feed Through","p_type":"SI","p_series":null,"p_description":"number range test","p_moq":1,"p_list_price":null,"p_discount_group_code":null}'
check "created"               "IN$((I+1))"        "$(rpc "$ADMIN" create_item_v3 "$BODY" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('item_no', d.get('message','?')))")"
check "duplicate refused"     "near-identical"    "$(rpc "$ADMIN" create_item_v3 "$BODY" | msg)"
check "sales cannot create"   "Only admin"        "$(rpc "$SALES" create_item_v3 "${BODY/ZZNRTEST0001/ZZNRTEST0002}" | msg)"
sql "delete from item_prices where item_code like 'ZZNRTEST%'; delete from items where item_code like 'ZZNRTEST%'" >/dev/null

echo; echo "── price confidentiality ───────────────────────────────────────────"
for t in purchase_orders po_items; do
  R=$(curl -s "https://$PROJ.supabase.co/rest/v1/$t?select=id&limit=2" -H "apikey: $PUB" -H "Authorization: Bearer $SALES")
  [ "$R" = "[]" ] && ok "sales blocked from $t" "[]" || bad "sales blocked from $t" "$R"
done
R=$(curl -s "https://$PROJ.supabase.co/rest/v1/v_po_status?select=po_number&limit=1" -H "apikey: $PUB" -H "Authorization: Bearer $SALES")
[ "$R" = "[]" ] && bad "sales CAN read v_po_status" "empty — Order 360 would break" || ok "sales reads v_po_status" "ok"

echo; echo "── concurrency ─────────────────────────────────────────────────────"
for i in 1 2 3 4 5 6 7 8; do sql "select next_doc_seq('RACETEST','26-27')" & done >/tmp/race.out 2>&1; wait
N=$(sql "select last_seq from doc_number_counters where doc_type='RACETEST'" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['last_seq'])")
[ "$N" = "8" ] && ok "8 concurrent callers" "counter reached 8, no collisions" || bad "8 concurrent callers" "counter=$N"
sql "delete from doc_number_counters where doc_type='RACETEST'" >/dev/null

for T in "$ADMIN" "$OPS" "$SALES"; do
  curl -s -o /dev/null -X POST "https://$PROJ.supabase.co/auth/v1/logout" -H "apikey: $PUB" -H "Authorization: Bearer $T"
done
echo; echo "═══  $PASS passed, $FAIL failed  ═══"; echo
exit $((FAIL > 0))
