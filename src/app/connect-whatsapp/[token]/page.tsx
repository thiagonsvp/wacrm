import { WhatsappConnectionClient } from './whatsapp-connection-client';

export const dynamic = 'force-dynamic';

export default async function WhatsappConnectionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <WhatsappConnectionClient token={token} />;
}
