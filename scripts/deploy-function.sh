#!/usr/bin/env bash
# Deploy a Supabase Edge Function with the RIGHT JWT setting, and prove it afterwards.
#
# WHY THIS EXISTS — 11 Sep 2026, two outages in 24 hours.
# `supabase functions deploy` defaults verify_jwt to TRUE. essl-sync is server-to-server:
# the attendance connector authenticates with the x-connector-secret header, not a user
# login. Deployed without --no-verify-jwt, Supabase's gateway rejected every call with 401
# BEFORE our code ran. The connector was healthy and kept calling every 2 minutes; we
# refused all of it. Attendance stopped at 18:06 on the 10th and again at 12:20 on the 11th,
# and both times the silence was read as a server fault at the office. It was ours.
#
# Nothing fails loudly when the flag is forgotten: the deploy succeeds, the function reports
# ACTIVE, and the damage only shows up as missing attendance hours later. So the flag cannot
# be left to memory.
#
#   ./scripts/deploy-function.sh essl-sync
#
# Needs SUPABASE_ACCESS_TOKEN (an sbp_ token) in the environment.
set -euo pipefail

PROJECT_REF="kvjihrlbntxcdadogmhn"

# The canon. A function is listed here ONLY if callers cannot present a Supabase JWT:
#   essl-sync        the office attendance connector          -> x-connector-secret
#   resend-webhook   Resend's delivery callbacks              -> signature
#   whatsapp-webhook Meta's inbound messages                  -> verify token
# Everything else is called by the app with a signed-in user and MUST keep verify_jwt on,
# because that check is what stops the open internet reaching it.
NO_JWT=" essl-sync resend-webhook whatsapp-webhook "

fn="${1:-}"
if [ -z "$fn" ]; then
  echo "usage: $0 <function-name>" >&2
  echo "functions needing --no-verify-jwt:${NO_JWT}" >&2
  exit 2
fi
if [ ! -d "supabase/functions/$fn" ]; then
  echo "No such function: supabase/functions/$fn" >&2
  exit 2
fi
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "SUPABASE_ACCESS_TOKEN is not set (needs an sbp_ token)." >&2
  exit 2
fi

if [[ "$NO_JWT" == *" $fn "* ]]; then
  want_jwt="false"; flag="--no-verify-jwt"
else
  want_jwt="true";  flag=""
fi

echo "Deploying $fn  (verify_jwt should end up $want_jwt)"
# shellcheck disable=SC2086
supabase functions deploy "$fn" $flag --project-ref "$PROJECT_REF"

# Deploying is not the same as deploying correctly. Ask the platform what it actually stored.
got=$(curl -sS "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/$fn" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      | python3 -c 'import json,sys; print(str(json.load(sys.stdin)["verify_jwt"]).lower())')

if [ "$got" != "$want_jwt" ]; then
  echo "" >&2
  echo "DEPLOY IS WRONG: $fn has verify_jwt=$got, expected $want_jwt." >&2
  [ "$want_jwt" = "false" ] && echo "Callers will get 401 and the function will look dead. Re-run with --no-verify-jwt." >&2
  exit 1
fi
echo "verified: $fn verify_jwt=$got"

# For the secret-authenticated ones, prove an unauthenticated call reaches OUR code rather
# than being stopped at the gateway — that is the exact difference the flag makes.
if [ "$want_jwt" = "false" ]; then
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$PROJECT_REF.supabase.co/functions/v1/$fn")
  if [ "$code" = "401" ]; then
    echo "WARNING: the gateway is still returning 401 for an anonymous call. Check the flag." >&2
    exit 1
  fi
  echo "verified: anonymous call reaches the function (HTTP $code)"
fi
