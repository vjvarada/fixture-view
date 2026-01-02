import { useState, useRef, useCallback, useEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import AppShell, { AppShellHandle } from './layout/AppShell';
import FileImport from './modules/FileImport';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProcessedFile } from './modules/FileImport/types';

const queryClient = new QueryClient();

const App = () => {
  const [currentFile, setCurrentFile] = useState<ProcessedFile | null>(null);
  const [designMode, setDesignMode] = useState(false);
  const appShellRef = useRef<AppShellHandle>(null);

  // Listen for session reset to clear the file
  useEffect(() => {
    const handleSessionReset = () => {
      setCurrentFile(null);
      setDesignMode(false);
    };

    window.addEventListener('session-reset', handleSessionReset);
    return () => window.removeEventListener('session-reset', handleSessionReset);
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

  return (
    <ErrorBoundary name="App">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute='class' defaultTheme='light' enableSystem>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <AppShell
              ref={appShellRef}
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
              <FileImport onFileLoaded={handleFileLoaded} />
            </AppShell>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};

export default App;
