import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import type { AiCredentials } from '@/lib/ai/types'

export async function loadGlobalAiCredentials(): Promise<AiCredentials | null> {
  const { data, error } = await supabaseAdmin()
    .from('ai_global_config')
    .select('provider,model,api_key')
    .eq('singleton', true)
    .maybeSingle()
  if (error?.code === '42P01') return null
  if (error) throw error
  if (!data?.api_key || !data.model) return null
  return {
    provider: 'openai',
    model: data.model,
    apiKey: decrypt(data.api_key),
  }
}
