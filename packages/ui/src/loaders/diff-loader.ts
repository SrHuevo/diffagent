import type { LoaderFunctionArgs } from 'react-router';
import { queryClient } from '../lib/query-client';
import { diffOptions } from '../queries/diff';
import { repoInfoOptions } from '../queries/info';

export interface DiffLoaderData {
  ref: string;
  theme: 'light' | 'dark' | null;
  view: 'split' | 'unified' | null;
}

export async function diffLoader({ request }: LoaderFunctionArgs): Promise<DiffLoaderData> {
  const url = new URL(request.url);
  const ref = url.searchParams.get('ref') || 'work';
  const theme = url.searchParams.get('theme') as 'light' | 'dark' | null;
  const view = url.searchParams.get('view') as 'split' | 'unified' | null;

  await Promise.all([
    queryClient.ensureQueryData(diffOptions(false, ref)),
    queryClient.ensureQueryData(repoInfoOptions(ref)),
  ]);

  return { ref, theme, view };
}
