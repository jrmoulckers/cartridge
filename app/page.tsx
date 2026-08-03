import { PLATFORMS } from '../lib/platforms.ts';

const INGESTION_LABEL: Record<string, string> = {
  'official-api': 'Official API',
  'unofficial-api': 'Unofficial API',
  manual: 'Manual entry',
};

export default function Home() {
  return (
    <main>
      <h1>cartridge</h1>
      <p>
        Track the games you&rsquo;re playing, have played, and want to play — across Steam,
        Xbox, PlayStation and Nintendo.
      </p>
      <h2>Platforms</h2>
      <ul>
        {PLATFORMS.map((platform) => (
          <li key={platform.id}>
            {platform.label} — {INGESTION_LABEL[platform.ingestion]}
          </li>
        ))}
      </ul>
    </main>
  );
}
