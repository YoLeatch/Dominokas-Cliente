import { useState, useEffect } from 'react';
import { TitleBar } from './components/common/TitleBar';
import { useSteamUser } from './hooks/useSteamUser';
import SteamWaitingPage from './pages/SteamWaitingPage';
import SteamErrorPage from './pages/SteamErrorPage';
import EnterMatchPage from './pages/EnterMatchPage';
import MatchConfigPage from './pages/MatchConfigPage';
import MatchCreatedPage from './pages/MatchCreatedPage';
import DraftScreenPage from './pages/DraftScreenPage';
import PlayerWaitingPage from './pages/PlayerWaitingPage';
import BanScreenPage from './pages/BanScreenPage';
import MatchInProgressPage from './pages/MatchInProgressPage';
import ServerConsolePage from './pages/ServerConsolePage';
import SettingsPage from './pages/SettingsPage';
import { DraftProvider } from './context/DraftContext';
import { UpdateModal } from './components/common/UpdateModal';

export type Page =
  | 'steam-waiting'
  | 'steam-error'
  | 'enter-match'
  | 'match-config'
  | 'match-created'
  | 'player-waiting'
  | 'ban-screen'
  | 'draft-screen'
  | 'match-in-progress'
  | 'server-console'
  | 'settings';

function App() {
  const { user, loading, error } = useSteamUser();
  const [currentPage, setCurrentPage] = useState<Page>('steam-waiting');

  // Roteamento Automático inteligente: Só redireciona se estiver nas páginas iniciais
  useEffect(() => {
    const initialPages: Page[] = ['steam-waiting', 'steam-error', 'enter-match'];
    const isAtStart = initialPages.includes(currentPage);

    if (loading) {
      if (currentPage !== 'steam-waiting') setCurrentPage('steam-waiting');
    } else if (error || !user) {
      if (currentPage !== 'steam-error') setCurrentPage('steam-error');
    } else if (user && isAtStart) {
      // Só empurra para 'enter-match' se o usuário acabou de logar ou estava em erro
      if (currentPage !== 'enter-match') setCurrentPage('enter-match');
    }
  }, [user, loading, error, currentPage]);

  const renderPage = () => {
    switch (currentPage) {
      case 'steam-waiting': return <SteamWaitingPage />;
      case 'steam-error': return <SteamErrorPage errorMessage={error} />;
      case 'enter-match': return <EnterMatchPage onNavigate={setCurrentPage as any} />;
      case 'match-config': return <MatchConfigPage onNavigate={setCurrentPage as any} />;
      case 'match-created': return <MatchCreatedPage onNavigate={setCurrentPage as any} />;
      case 'player-waiting': return <PlayerWaitingPage onNavigate={setCurrentPage as any} />;
      case 'ban-screen': return <BanScreenPage onNavigate={setCurrentPage as any} />;
      case 'draft-screen': return <DraftScreenPage onNavigate={setCurrentPage as any} />;
      case 'match-in-progress': return <MatchInProgressPage onNavigate={setCurrentPage as any} />;
      case 'server-console': return <ServerConsolePage onNavigate={setCurrentPage as any} />;
      case 'settings': return <SettingsPage onBack={() => setCurrentPage('match-config')} />;
      default: return <EnterMatchPage onNavigate={setCurrentPage as any} />;
    }
  };

  return (
    <DraftProvider>
      <div style={{ width: '100%', height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-dark)' }}>
        <TitleBar />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {renderPage()}
        </div>
        
        {/* Versão do Programa */}
        <div style={{ 
          position: 'absolute', 
          bottom: '10px', 
          right: '15px', 
          fontSize: '10px', 
          color: 'rgba(100, 116, 139, 0.5)', 
          fontFamily: "'Geist Mono', monospace", 
          pointerEvents: 'none',
          letterSpacing: '0.5px'
        }}>
          v0.1 beta (ainda em desenvolvimento)
        </div>
      </div>
      <UpdateModal />
    </DraftProvider>
  );
}

export default App;
