import type { Metadata } from 'next';
import ConsoleList from '@/components/console/ConsoleList';

export const metadata: Metadata = { title: 'DialMind · Claims Console' };

export default function ConsolePage() {
  return <ConsoleList />;
}
