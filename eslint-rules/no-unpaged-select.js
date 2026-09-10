// Flag a Supabase .from('<large table>') whose query is not paged.
//
// WHY THIS IS A REAL RULE AND NOT A no-restricted-syntax SELECTOR
// The obvious selector — "a .from() with no .range() next to it" — cannot be written
// in esquery, because the .range() is usually chained onto a DIFFERENT expression:
//
//     fetchAll((from, to) => {
//       let q = sb.from('orders').select(...)      // .from() is here
//       if (role === 'sales') q = q.eq(...)
//       return q.range(from, to)                   // .range() is on `q`, three lines later
//     })
//
// A selector attempt flagged both of those as unpaged. This walks up to the enclosing
// statement instead and reads its source, which sees the whole query however it is built.
//
// WHAT IT CATCHES: PostgREST caps a select at 1000 rows and truncates SILENTLY — no
// error, no warning, the page just under-reports. Three dashboards were doing this:
// /procurement read 1,000 of 1,498 purchase orders and understated open POs, total
// value, the vendor leaderboard, the funnel and the SLA scores by a third.

// Tables measured over (or heading for) 1000 rows. A named list, not every from():
// a lookup of attendance_config must not be flagged, and a rule people routinely
// disable is worse than no rule.
const BIG = new Set([
  'orders', 'order_items', 'order_dispatches',
  'purchase_orders', 'po_items',
  'inventory', 'items',
  'grn', 'grn_items',
  'attendance_punches', 'attendance_days',
  'customer_dues_bills', 'customers',
])

// Any of these in the enclosing scope means the cap is already handled.
// selectByCodes / chunk / slice are the repo's chunked-IN helpers: the query is run
// once per batch of ids, so the 1000-row cap is already respected by construction.
const PAGED = [
  'fetchAll', '.range(', '.single()', '.maybeSingle()', 'count:', '.limit(',
  'selectByCodes', 'chunk', 'slice',
]

// Scoped to ONE parent record — cannot approach 1000 rows however big the table is.
// This is what the detail pages do: sb.from('order_items').select(...).eq('order_id', id).
const SCOPED = [
  ".eq('id'", '.eq("id"', ".eq('order_id'", ".eq('po_id'", ".eq('grn_id'",
  ".eq('order_number'", ".eq('po_number'", ".eq('profile_id'", ".eq('employee_id'",
  ".in('id'", ".in('order_id'", ".eq('dispatch_id'", ".eq('customer_id'", ".eq('vendor_id'",
]

// Writes have no row cap. Only a read can be truncated.
const WRITES = ['.update(', '.insert(', '.upsert(', '.delete(']

export default {
  meta: {
    type: 'problem',
    docs: { description: 'Supabase select on a >1000-row table must be paged' },
    schema: [],
  },
  create(context) {
    const src = context.sourceCode ?? context.getSourceCode()
    return {
      CallExpression(node) {
        if (node.callee?.type !== 'MemberExpression') return
        if (node.callee.property?.name !== 'from') return
        const arg = node.arguments[0]
        if (!arg || arg.type !== 'Literal' || !BIG.has(arg.value)) return

        // Walk up to the enclosing FUNCTION, not merely the enclosing statement.
        // The builder pattern spreads one query over several statements:
        //     let q = sb.from('orders').select(...)   <- statement 1
        //     if (role === 'sales') q = q.eq(...)     <- statement 2
        //     return q.range(from, to)                <- statement 3, the paging
        // Stopping at statement 1 sees no .range() and reports a false positive.
        // The function body is the smallest scope that contains the whole query.
        let n = node
        while (n.parent && !/Function/.test(n.parent.type)) n = n.parent
        const scope = n.parent || n
        const text = src.getText(scope)

        // The .from() node itself tells us nothing about what follows, so read the
        // statement this call belongs to and decide from the whole chain.
        let stmt = node
        while (stmt.parent && !/Statement|Declaration/.test(stmt.parent.type)) stmt = stmt.parent
        const chain = src.getText(stmt.parent || stmt)

        if (!chain.includes('.select(')) return                 // a write, not a read
        if (WRITES.some(w => chain.includes(w))) return
        if (SCOPED.some(e => chain.includes(e))) return         // one parent record
        if (PAGED.some(p => text.includes(p) || chain.includes(p))) return

        context.report({
          node,
          message:
            `'${arg.value}' can exceed PostgREST's 1000-row cap and a plain .select() ` +
            `truncates SILENTLY — no error, the page just under-reports. Wrap it in ` +
            `fetchAll() from src/lib/fetchAll.js, or add .range() with a stable ` +
            `tiebreaker order. Count-only, .single() and .maybeSingle() are exempt.`,
        })
      },
    }
  },
}
