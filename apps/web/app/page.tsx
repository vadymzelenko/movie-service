import Link from 'next/link';
import { Smartphone, Tv } from 'lucide-react';

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 p-8">
      <h1 className="text-4xl font-bold tracking-tight">Кинозал</h1>
      <div className="grid w-full max-w-xl gap-4 sm:grid-cols-2">
        <Link href="/tv" className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-8 transition hover:bg-surface-2">
          <Tv className="size-12" />
          <span className="text-lg font-semibold">Телевизор</span>
          <span className="text-center text-sm text-muted">Откройте в браузере Smart TV</span>
        </Link>
        <Link href="/remote" className="flex flex-col items-center gap-3 rounded-2xl bg-surface p-8 transition hover:bg-surface-2">
          <Smartphone className="size-12" />
          <span className="text-lg font-semibold">Пульт</span>
          <span className="text-center text-sm text-muted">Или отсканируйте QR-код на экране TV</span>
        </Link>
      </div>
    </main>
  );
}
