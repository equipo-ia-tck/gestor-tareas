import { useProjectOptions } from '../../hooks/useProjectOptions';

/** <option> de proyectos en árbol (los subproyectos con sangría) para un <select>. */
export function ProjectOptions() {
  const options = useProjectOptions('');
  return (
    <>
      {options.map(({ project, depth }) => (
        <option key={project.id} value={project.id}>{`${'   '.repeat(depth)}${depth ? '› ' : ''}${project.name}`}</option>
      ))}
    </>
  );
}
