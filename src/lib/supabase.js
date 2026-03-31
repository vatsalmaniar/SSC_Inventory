import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://kvjihrlbntxcdadogmhn.supabase.co'
const SUPABASE_KEY = 'sb_publishable_kgrGHkw1jDvlLIOF3cPKiw_2ucunE3P'

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY)
