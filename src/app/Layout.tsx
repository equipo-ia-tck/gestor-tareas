import { createContext, useContext, useEffect } from 'react';

/** Permite a una vista pedir todo el ancho (el tablero) en lugar de la columna centrada. */
export const WideContext = createContext<(wide: boolean) => void>(() => {});

export function useWideLayout(wide: boolean) {
  const setWide = useContext(WideContext);
  useEffect(() => {
    setWide(wide);
    return () => setWide(false);
  }, [wide, setWide]);
}
