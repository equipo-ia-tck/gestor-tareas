import { AppProvider } from './AppContext';
import { useRoute, type Route } from './router';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '../components/Toast';
import { CommandCenterProvider } from '../features/command/CommandCenter';
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
  }
}

export function App() {
  const route = useRoute();
  return (
    <ToastProvider>
      <AppProvider>
        <CommandCenterProvider>
        <div className="grid h-dvh grid-cols-[220px_1fr] max-sm:grid-cols-1">
          <div className="max-sm:hidden"><Sidebar route={route} /></div>
          <main className="overflow-y-auto">
            <div className="mx-auto max-w-3xl px-6 py-6 max-sm:px-4">
              <BackupReminder />
              <View route={route} />
            </div>
          </main>
        </div>
        </CommandCenterProvider>
      </AppProvider>
    </ToastProvider>
  );
}
