-- ============================================================
-- whatsapp_config: chavear o vínculo UAZAPI pelo id da instância
--
-- Até aqui o vínculo entre a empresa e sua instância era o
-- `uazapi_instance_name`. Isso funcionou enquanto o nome era imutável
-- (só existia colando credenciais na mão). O painel de instâncias
-- adiciona um botão "Renomear", e a partir daí o nome deixa de servir
-- como chave: renomear a instância vinculada quebraria o badge
-- "vinculada", o carimbo automático de posse, a guarda de 409 em
-- src/app/api/whatsapp/config/route.ts e a URL de foto de perfil em
-- src/app/api/whatsapp/webhook/uazapi/[configId]/route.ts.
--
-- O `id` da instância na UAZAPI é estável e único. Ele passa a ser a
-- chave; `uazapi_instance_name` continua existindo como espelho
-- legível (o webhook o usa para montar a URL de foto de perfil) e é
-- reescrito junto com o id a cada bind e a cada rename.
--
-- Nullable de propósito: linhas existentes só ganham o id quando o
-- painel as adota (ver o carimbo automático em
-- src/lib/whatsapp/uazapi-ownership.ts).
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT;

-- O lookup "outra empresa já reivindicou esta instância?" roda em todo
-- bind e é o que impede duas empresas de compartilharem um número.
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_uazapi_instance_id
  ON whatsapp_config(uazapi_instance_id)
  WHERE uazapi_instance_id IS NOT NULL;
