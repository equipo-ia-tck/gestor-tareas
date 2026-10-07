import { useState } from 'react';
import { AppProvider, useApp } from './AppContext';
import { WideContext } from './Layout';
import { TaskDetailPanel } from '../components/TaskDetailPanel';
import { BoardView } from '../features/board/BoardView';
import { CalendarView } from '../features/calendar/CalendarView';
import { ReleasesView } from '../features/releases/ReleasesView';
import { NotesView } from '../features/notes/NotesView';
import { LogView } from '../features/log/LogView';
import { ReminderCenter } from '../features/reminders/ReminderCenter';
import { routeHref, useRoute, type Route } from './router';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '../components/Toast';
import { CommandCenterProvider } from '../features/command/CommandCenter';
import { HistoryBridge } from '../features/history/HistoryBridge';
import { BulkBar } from '../features/selection/BulkBar';
import { SelectionProvider, useSelection } from '../features/selection/SelectionContext';
import { SearchView } from '../features/views/SearchView';
import { DailySummary } from '../features/summary/DailySummary';
import { BackupReminder } from '../features/backup/BackupReminder';
import { SettingsView } from '../features/backup/SettingsView';
import { InboxView } from '../features/views/InboxView';
import { PeopleView, PersonView } from '../features/views/PeopleViews';
import { ProjectView, ProjectsView } from '../features/views/ProjectViews';
import { TodayView } from '../features/views/TodayView';
import { WeekView } from '../features/views/WeekView';

function View({ route }: { route: Route }) {
  switch (route.view) {
    case 'today': return <TodayView />;
    case 'week': return <WeekView />;
    case 'board': return <BoardView />;
    case 'all': return <BoardView />; // la antigua vista "Todo" ahora es el Tablero
    case 'releases': return <ReleasesView />;
    case 'notes': return <NotesView id={route.id} />;
    case 'log': return <LogView />;
    case 'calendar': return <CalendarView />;
    case 'inbox': return <InboxView />;
    case 'projects': return <ProjectsView />;
    case 'project': return <ProjectView key={route.id} id={route.id} />;
    case 'people': return <PeopleView />;
    case 'person': return <PersonView key={route.name} name={route.name} />;
    case 'settings': return <SettingsView />;
    case 'search': return <SearchView q={route.q} />;
  }
}

function Main({ route }: { route: Route }) {
  const { clear } = useSelection();
  const [wide, setWide] = useState(false);
  return (
    <main
      className="min-w-0 overflow-y-auto"
      // Clic en una zona vacía: se quita la selección.
      onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-task-id], button, a, input, textarea, select, [role="toolbar"], aside')) clear(); }}
    >
      <div className={`mx-auto px-6 py-6 pb-28 max-sm:px-4 ${wide ? 'max-w-none' : 'max-w-4xl'}`}>
        <BackupReminder />
        <ReminderCenter />
        <DailySummary />
        <WideContext.Provider value={setWide}>
          <View route={route} />
        </WideContext.Provider>
      </div>
    </main>
  );
}

/** Columnas: barra lateral · contenido · panel de detalle (si hay una tarea abierta). */
function Shell({ route }: { route: Route }) {
  const { detailId } = useApp();
  return (
    // En pantallas anchas el panel es una columna más; en las estrechas se superpone por la derecha.
    <div className={`grid h-dvh grid-cols-[232px_1fr] max-sm:grid-cols-1 ${detailId ? 'xl:grid-cols-[232px_1fr_420px]' : ''}`}>
      <div className="max-sm:hidden"><Sidebar route={route} /></div>
      <Main route={route} />
      {detailId && (
        <div className="fixed inset-y-0 right-0 z-30 w-[420px] max-w-full shadow-2xl xl:static xl:z-auto xl:w-auto xl:min-w-0 xl:shadow-none">
          <TaskDetailPanel />
        </div>
      )}
    </div>
  );
}

export function App() {
  const route = useRoute();
  // La búsqueda cambia en cada tecla: no debe reiniciar la selección.
  const resetKey = route.view === 'search' ? 'search' : routeHref(route);
  return (
    <ToastProvider>
      <HistoryBridge />
      <AppProvider>
        <SelectionProvider resetKey={resetKey}>
          <CommandCenterProvider>
            <Shell route={route} />
            <BulkBar />
          </CommandCenterProvider>
        </SelectionProvider>
      </AppProvider>
    </ToastProvider>
  );
}
