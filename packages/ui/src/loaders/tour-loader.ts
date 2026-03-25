import type { LoaderFunctionArgs } from 'react-router';
import { queryClient } from '../lib/query-client';
import { treePathsOptions, treeInfoOptions, treeFileContentOptions, tourOptions } from '../queries/tree';

export interface TourLoaderData {
  tourId: string;
  theme: 'light' | 'dark' | null;
}

export async function tourLoader({ params, request }: LoaderFunctionArgs): Promise<TourLoaderData> {
  const tourId = params.tourId!;
  const url = new URL(request.url);
  const theme = url.searchParams.get('theme') as 'light' | 'dark' | null;

  const [tour] = await Promise.all([
    queryClient.ensureQueryData(tourOptions(tourId)),
    queryClient.ensureQueryData(treePathsOptions()),
    queryClient.ensureQueryData(treeInfoOptions()),
  ]);

  if (tour.steps.length > 0) {
    await queryClient.ensureQueryData(treeFileContentOptions(tour.steps[0].filePath));
  }

  return { tourId, theme };
}
