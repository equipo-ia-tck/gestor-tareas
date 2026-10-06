import { AppProvider } from './AppContext';
import { routeHref, useRoute, type Route } from './router';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '../components/Toast';
import { CommandCenterProvider } from '../features/command/CommandCenter';
import { HistoryBridge } from '../features/history/HistoryBridge';
import { BulkBar } from '../features/selection/BulkBar';
import { SelectionProvider, useSelection } from '../features/selection/SelectionContext';
import { SearchView } from '../features/views/SearchView';
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
  return (
    <main
      className="overflow-y-auto"
      // Clic en una zona vacía: se quita la selección.
      onClick={(e) => { if (!(e.target as HTMLElement).closest('[data-task-id], button, a, input, textarea, select, [role="toolbar"]')) clear(); }}
    >
      <div className="mx-auto max-w-3xl px-6 py-6 pb-28 max-sm:px-4">
        <BackupReminder />
        <View route={route} />
      </div>
    </main>
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
            <div className="grid h-dvh grid-cols-[220px_1fr] max-sm:grid-cols-1">
              <div className="max-sm:hidden"><Sidebar route={route} /></div>
              <Main route={route} />
            </div>
            <BulkBar />
          </CommandCenterProvider>
        </SelectionProvider>
      </AppProvider>
    </ToastProvider>
  );
}
