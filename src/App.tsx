import { useState, useRef, useCallback, useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import Login from './pages/Login';
import AppShell, { AppShellHandle } from './layout/AppShell';
import FileImport from './modules/FileImport';
import FixtureDesigner from './components/FixtureDesigner';
import { ProcessedFile } from './modules/FileImport/types';

const queryClient = new QueryClient();

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentFile, setCurrentFile] = useState<ProcessedFile | null>(null);
  const [currentView, setCurrentView] = useState<'import' | 'design'>('import');
  const [designMode, setDesignMode] = useState(false);
  const appShellRef = useRef<AppShellHandle>(null);

  // Listen for session reset to clear the file
  useEffect(() => {
    const handleSessionReset = () => {
      setCurrentFile(null);
      setCurrentView('import');
      setDesignMode(false);
    };

    window.addEventListener('session-reset', handleSessionReset);
    return () => window.removeEventListener('session-reset', handleSessionReset);
  }, []);

  const handleLogin = (credentials: { username: string; password: string }) => {
    console.log('Login with:', credentials);
    setIsLoggedIn(true);
  };

  const handleLogout = useCallback(() => {
    setIsLoggedIn(false);
    setCurrentFile(null);
    setCurrentView('import');
    setDesignMode(false);
  }, []);

  const handleToggleDesignMode = useCallback(() => {
    setDesignMode(!designMode);
  }, [designMode]);

  const handleFileLoaded = useCallback((file: ProcessedFile | null) => {
    setCurrentFile(file);
    if (file && appShellRef.current) {
      appShellRef.current.setViewOrientation('iso');
    }
  }, []);

  if (!isLoggedIn) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute='class' defaultTheme='light' enableSystem>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Login onLogin={handleLogin} />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute='class' defaultTheme='light' enableSystem>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <AppShell
            ref={appShellRef}
            onLogout={handleLogout}
            onToggleDesignMode={handleToggleDesignMode}
            designMode={designMode}
            isProcessing={false}
            fileStats={currentFile ? {
              name: currentFile.metadata.name,
              triangles: currentFile.metadata.triangles,
              size: `${(currentFile.metadata.size / 1024 / 1024).toFixed(2)} MB`
            } : undefined}
            currentFile={currentFile}
          >
            {currentView === 'import' ? (
              <FileImport onFileLoaded={handleFileLoaded} />
            ) : (
              <FixtureDesigner
                currentFile={currentFile}
                onFileLoaded={handleFileLoaded}
              />
            )}
          </AppShell>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
