import { useState, useRef, useCallback, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { Toaster as Sonner } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useAuthStore } from './stores/authStore';
import LoginPage from './pages/auth/Login';
import RegisterPage from './pages/auth/Register';
import ForgotPasswordPage from './pages/auth/ForgotPassword';
import VerifyEmailPage from './pages/auth/VerifyEmail';
import ResetPasswordPage from './pages/auth/ResetPassword';
import AppShell, { AppShellHandle } from './layout/AppShell';
import FileImport from './modules/FileImport';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProcessedFile } from './modules/FileImport/types';

const queryClient = new QueryClient();

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuthStore();
  
  console.log('[ProtectedRoute] isAuthenticated:', isAuthenticated, 'isLoading:', isLoading);
  
  if (isLoading) {
    console.log('[ProtectedRoute] Showing loading screen');
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }
  
  if (!isAuthenticated) {
    console.log('[ProtectedRoute] Not authenticated, redirecting to login');
    return <Navigate to="/auth/login" replace />;
  }
  
  console.log('[ProtectedRoute] Authenticated, rendering children');
  return <>{children}</>;
};

const MainApp = () => {
  const [currentFile, setCurrentFile] = useState<ProcessedFile | null>(null);
  const [designMode, setDesignMode] = useState(false);
  const appShellRef = useRef<AppShellHandle>(null);
  const { logout, fetchCurrentUser, isAuthenticated } = useAuthStore();

  console.log('[MainApp] Rendering, isAuthenticated:', isAuthenticated);

  useEffect(() => {
    console.log('[MainApp] Component mounted, checking authentication');
    // Only fetch user once on mount if authenticated
    if (isAuthenticated) {
      console.log('[MainApp] User is authenticated, fetching user data');
      fetchCurrentUser().catch((error) => {
        console.error('[MainApp] Failed to fetch user:', error);
        // Don't block the app if user fetch fails
        // User is already authenticated via token
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - only run once on mount

  useEffect(() => {
    const handleSessionReset = () => {
      setCurrentFile(null);
      setDesignMode(false);
    };

    window.addEventListener('session-reset', handleSessionReset);
    return () => window.removeEventListener('session-reset', handleSessionReset);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
    setCurrentFile(null);
    setCurrentView('import');
    setDesignMode(false);
  }, [logout]);

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
  );
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <ThemeProvider attribute='class' defaultTheme='light' enableSystem>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            <Routes>
              <Route path="/auth/login" element={<LoginPage />} />
              <Route path="/auth/register" element={<RegisterPage />} />
              <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/auth/verify" element={<VerifyEmailPage />} />
              <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
              <Route
                path="/*"
                element={
                  <ProtectedRoute>
                    <MainApp />
                  </ProtectedRoute>
                }
              />
            </Routes>
          </TooltipProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
