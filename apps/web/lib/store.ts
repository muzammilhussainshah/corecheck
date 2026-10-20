import { configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { actionToasts } from '@corecheck/ui';
import { api } from './api';
import { SUCCESS_MESSAGES } from './toasts';

/** One store per browser tab; created inside the client provider. */
export const makeStore = () => {
  const store = configureStore({
    reducer: { [api.reducerPath]: api.reducer },
    middleware: (getDefault) =>
      getDefault().concat(api.middleware, actionToasts(SUCCESS_MESSAGES)),
  });
  // Enables refetchOnFocus.
  setupListeners(store.dispatch);
  return store;
};

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore['getState']>;
