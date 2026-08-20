Static TTF cuts of Geist, for server-side PDF generation only.

The app itself uses the variable woff2 files in the parent directory. pdf-lib
cannot embed woff2 or variable fonts, so these are single-weight TTF instances
(wght 400 and 600) produced with fontTools:

    instancer.instantiateVariableFont(TTFont(src), {'wght': 400})

Served as static assets so the Edge Function can fetch and cache them.

Note: these are latin subsets and do NOT contain U+20B9 (₹). The statement
prints "INR" rather than the symbol — an embedded PDF font has no fallback,
and the missing glyph renders as an empty box.
