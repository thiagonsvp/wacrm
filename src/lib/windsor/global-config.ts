import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { tokenFromWindsorUrl } from '@/lib/windsor/mcp'

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

/** Read the deployment-wide Windsor token from the configured dashboard URL. */
export async function loadGlobalWindsorToken(): Promise<string | null> {
  const { data, error } = await admin()
    .from('windsor_global_config')
    .select('dashboard_url,api_key')
    .eq('singleton', true)
    .maybeSingle()
  if (error) throw error
  if (data?.dashboard_url) {
    const url = decrypt(data.dashboard_url)
    const token = tokenFromWindsorUrl(url)
    if (token) return token
  }
  // Temporary compatibility with the first global-config rollout. Once the
  // administrator saves the complete URL, this fallback is no longer used.
  return data?.api_key ? decrypt(data.api_key) : null
}
