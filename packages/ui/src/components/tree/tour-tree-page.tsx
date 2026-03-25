import { useLoaderData } from 'react-router';
import type { TourLoaderData } from '../../loaders/tour-loader';
import { TreePage } from './tree-page';

export function TourTreePage() {
  const { tourId, theme } = useLoaderData<TourLoaderData>();

  return <TreePage tourId={tourId} initialTheme={theme} />;
}
