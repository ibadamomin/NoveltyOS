import { useSyncExternalStore } from 'react';
import { onDataChange } from './db';

let version = 0;
onDataChange((source) => {
  if (source === 'remote') version++;
});

/** Changes whenever data arrives from the cloud; add it to a screen's reload dependencies. */
export function useDataVersion() {
  return useSyncExternalStore(
    (cb) => onDataChange((source) => source === 'remote' && cb()),
    () => version,
  );
}
