import { useEffect, useState } from 'react';
import { requestPersistentStorage } from '../../data/backup';

/** true/false según el navegador haya concedido almacenamiento persistente; null si no lo soporta. */
export function usePersistence() {
  const [persisted, setPersisted] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    void requestPersistentStorage().then(setPersisted);
  }, []);
  return persisted;
}
