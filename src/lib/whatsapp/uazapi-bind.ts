export interface BindCurrentConfig {
  provider: string | null
  status: string | null
  uazapi_instance_id: string | null
  uazapi_instance_name: string | null
  phone_number_id: string | null
}

export interface BindConflict {
  reason: 'replace_uazapi' | 'replace_meta'
  currentInstanceName?: string
}

export function decideBindConflict(args: {
  current: BindCurrentConfig | null
  newInstanceId: string
  newInstanceName: string
  replaceExisting: boolean
}): BindConflict | null {
  const { current, newInstanceId, replaceExisting } = args
  if (!current || replaceExisting) return null

  if (current.uazapi_instance_id === newInstanceId) return null

  if (
    current.provider === 'uazapi' &&
    current.uazapi_instance_id &&
    current.status === 'connected'
  ) {
    return {
      reason: 'replace_uazapi',
      currentInstanceName: current.uazapi_instance_name ?? undefined,
    }
  }

  if (current.provider === 'meta' && current.phone_number_id) {
    return { reason: 'replace_meta' }
  }

  return null
}

export interface BindRow {
  provider: 'uazapi'
  uazapi_base_url: string
  uazapi_instance_id: string
  uazapi_instance_name: string
  uazapi_token: string
  phone_number_id: null
  waba_id: null
  status: 'connected' | 'disconnected'
  updated_at: string
}

export function buildBindRow(args: {
  baseUrl: string
  instance: { id: string; name: string; token: string; status: string }
  encryptToken: (raw: string) => string
  now?: Date
}): BindRow {
  const { baseUrl, instance, encryptToken, now = new Date() } = args
  return {
    provider: 'uazapi',
    uazapi_base_url: baseUrl,
    uazapi_instance_id: instance.id,
    uazapi_instance_name: instance.name,
    uazapi_token: encryptToken(instance.token),
    phone_number_id: null,
    waba_id: null,
    status: instance.status === 'connected' ? 'connected' : 'disconnected',
    updated_at: now.toISOString(),
  }
}

export function buildBindInsert(
  row: BindRow,
  accountId: string,
  userId: string,
): BindRow & { account_id: string; user_id: string } {
  return { ...row, account_id: accountId, user_id: userId }
}
