import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RemoteApp } from '@/components/remote/RemoteApp';

export const metadata: Metadata = { title: 'Кинозал — пульт' };

export default function RemotePage() {
  return (
    <Suspense>
      <RemoteApp />
    </Suspense>
  );
}
