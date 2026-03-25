import type { LoaderFunctionArgs } from 'react-router';
import { queryClient } from '../lib/query-client';
import { treePathsOptions, treeInfoOptions, treeFileContentOptions, treeEntriesOptions } from '../queries/tree';

export interface TreeLoaderData {
  path: string;
  type: 'file' | 'dir';
  theme: 'light' | 'dark' | null;
}

export async function treeLoader({ request }: LoaderFunctionArgs): Promise<TreeLoaderData> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  const type = (url.searchParams.get('type') || 'dir') as 'file' | 'dir';
  const theme = url.searchParams.get('theme') as 'light' | 'dark' | null;

  const fetches: Promise<unknown>[] = [
    queryClient.ensureQueryData(treePathsOptions()),
    queryClient.ensureQueryData(treeInfoOptions()),
  ];

  if (type === 'file' && path) {
    fetches.push(queryClient.ensureQueryData(treeFileContentOptions(path)));
  } else {
    fetches.push(queryClient.ensureQueryData(treeEntriesOptions(path || undefined)));
  }

  await Promise.all(fetches);

  return { path, type, theme };
}
