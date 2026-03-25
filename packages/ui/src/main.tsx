import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query-client';
import { RootLayout } from './layouts/root-layout';
import { DiffPage } from './components/diff/diff-page';
import { TreePage } from './components/tree/tree-page';
import { TourTreePage } from './components/tree/tour-tree-page';
import { diffLoader } from './loaders/diff-loader';
import { treeLoader } from './loaders/tree-loader';
import { tourLoader } from './loaders/tour-loader';
import 'nprogress/nprogress.css';
import './styles/app.css';

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <Navigate to="/diff" replace /> },
      { path: '/diff', element: <DiffPage />, loader: diffLoader },
      { path: '/tree', element: <TreePage />, loader: treeLoader },
      { path: '/tour/:tourId', element: <TourTreePage />, loader: tourLoader },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
