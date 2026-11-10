import { existsSync } from 'fs';
import { join } from 'path';

export function resolveMigrationsFolder(): string {
  const candidates = [
    join(__dirname, '..', '..', 'migrations'),
    join(__dirname, '..', 'db', 'migrations'),
    join(process.cwd(), 'migrations'),
    join(process.cwd(), 'src', 'db', 'migrations'),
  ];
  const match = candidates.find((path) => existsSync(path));
  if (!match) throw new Error(`Unable to locate migrations folder. Checked: ${candidates.join(', ')}`);
  return match;
}
