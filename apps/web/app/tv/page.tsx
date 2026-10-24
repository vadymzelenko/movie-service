import type { Metadata } from 'next';
import { TvApp } from '@/components/tv/TvApp';

export const metadata: Metadata = { title: 'Кинозал — TV' };

export default function TvPage() {
  return <TvApp />;
}
