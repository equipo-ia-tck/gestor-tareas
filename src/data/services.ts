import { FileAutosave } from './fsAutosave';
import { repo } from './repository';

export { repo };
export const autosave = new FileAutosave(repo);
