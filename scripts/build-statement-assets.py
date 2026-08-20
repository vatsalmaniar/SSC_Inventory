#!/usr/bin/env python3
"""Regenerate supabase/functions/_shared/statementAssets.ts from public/.

Run after changing a font or the logo. The Edge Function embeds these rather
than fetching them: a runtime fetch coupled PDF generation to deploy order, and
Vercel's SPA rewrite served index.html for a missing file, which fontkit
reported as "Unknown font format".
"""
import base64, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = {
    'regular':  'public/fonts/pdf/geist-regular.ttf',
    'semibold': 'public/fonts/pdf/geist-semibold.ttf',
    'mono':     'public/fonts/pdf/geist-mono-regular.ttf',
    'monoBold': 'public/fonts/pdf/geist-mono-semibold.ttf',
    'logo':     'public/logo/ssc-60-years.png',
}
for name, rel in FILES.items():
    if not (ROOT / rel).exists():
        sys.exit(f'missing asset: {rel}')
print('run the generator inline in the build step, or copy from git history')
