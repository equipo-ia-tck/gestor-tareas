import { createContext, useContext, useEffect } from 'react';

/**
 * Permite a una vista pedir todo el ancho (el tablero) en lugar de la columna centrada, o `'full'`: todo el ancho y el
 * alto de la ventana, sin scroll de página (la vista gestiona el suyo, como el Calendario).
 */
export type WideMode = boolean | 'full';
export const WideContext = createContext<(wide: WideMode) => void>(() => {});

export function useWideLayout(wide: WideMode) {
  const setWide = useContext(WideContext);
  useEffect(() => {
    setWide(wide);
    return () => setWide(false);
  }, [wide, setWide]);
}
