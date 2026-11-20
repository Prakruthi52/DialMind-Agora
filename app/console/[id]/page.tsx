import type { Metadata } from 'next';
import SessionDetail from '@/components/console/SessionDetail';

export const metadata: Metadata = { title: 'DialMind · Call review' };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SessionDetail id={id} />;
}
