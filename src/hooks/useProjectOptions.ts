import { useMemo } from 'react';
import { useApp } from '../app/AppContext';
import { flattenTree, projectPath, projectTree } from '../domain/projects';
import { fuzzyScore } from '../domain/text';
import type { Project } from '../domain/types';

export interface ProjectOption {
  project: Project;
  depth: number;
  /** "caixa / Sprint 14". */
  path: string;
}

/**
 * Proyectos activos para un selector: sin búsqueda, en árbol (con profundidad para sangrar);
 * con búsqueda, por coincidencia difusa sobre la ruta completa.
 */
export function useProjectOptions(query: string): ProjectOption[] {
  const { projects, projectMap } = useApp();
  return useMemo(() => {
    const all = flattenTree(projectTree(projects)).map((n) => ({ project: n.project, depth: n.depth, path: projectPath(n.project.id, projectMap) }));
    if (!query.trim()) return all;
    return all
      .map((o) => ({ o, s: fuzzyScore(query, o.path) }))
      .filter((x) => x.s !== null)
      .sort((a, b) => b.s! - a.s!)
      .map(({ o }) => ({ ...o, depth: 0 }));
  }, [projects, projectMap, query]);
}
