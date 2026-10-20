'use client';

import { MantineProvider } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { type ReactNode, useState } from 'react';
import { Provider } from 'react-redux';
import { theme, Toaster } from '@corecheck/ui';
import { makeStore } from '../lib/store';

export function Providers({ children }: { children: ReactNode }) {
  const [store] = useState(makeStore);
  return (
    <Provider store={store}>
      <MantineProvider theme={theme}>
        <ModalsProvider>
          <Toaster />
          {children}
        </ModalsProvider>
      </MantineProvider>
    </Provider>
  );
}
