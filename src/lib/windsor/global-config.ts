import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

let adminClient: SupabaseClient | null = null

function admin(): SupabaseClient {
  if (!adminClient) {
    adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    )
  }
  return adminClient
}

/** Read the deployment-wide Windsor key without exposing it to clients. */
export async function loadGlobalWindsorToken(): Promise<string | null> {
  const { data, error } = await admin()
    .from('windsor_global_config')
    .select('api_key')
    .eq('singleton', true)
    .maybeSingle()
  if (error) throw error
  return data?.api_key ? decrypt(data.api_key) : null
}
