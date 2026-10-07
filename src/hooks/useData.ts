import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repo } from '../data/services';
import { todayISO } from '../domain/dates';
import { DEFAULT_SETTINGS, type ItemType, type Label, type Project, type Settings, type Task } from '../domain/types';
import { DEFAULT_ITEM_TYPES } from '../domain/workflows';

const EMPTY_TASKS: Task[] = [];
const EMPTY_PROJECTS: Project[] = [];

/** Todas las tareas no borradas. Volumen personal: se filtra en memoria con selectores puros. */
export const useTasks = () => useLiveQuery(() => repo.listTasks(), []) ?? EMPTY_TASKS;

export const useProjects = (includeArchived = false) =>
  useLiveQuery(() => repo.listProjects(includeArchived), [includeArchived]) ?? EMPTY_PROJECTS;

const EMPTY_LABELS: Label[] = [];

export const useItemTypes = (): ItemType[] => useLiveQuery(() => repo.listItemTypes(), []) ?? DEFAULT_ITEM_TYPES;

export const useLabels = () => useLiveQuery(() => repo.listLabels(), []) ?? EMPTY_LABELS;

export const useSettings = (): Settings => useLiveQuery(() => repo.getSettings(), []) ?? DEFAULT_SETTINGS;

/** Fecha de hoy que se actualiza sola al pasar la medianoche. */
export function useToday() {
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const id = setInterval(() => setToday(todayISO()), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}
