import React, { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { createLogger } from '@/utils/logger';

const logger = createLogger('ErrorBoundary');

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback UI component */
  fallback?: ReactNode;
  /** Name of the boundary for logging */
  name?: string;
  /** Callback when error is caught */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  /** Whether to show detailed error info (dev only) */
  showDetails?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
}

/**
 * React Error Boundary Component
 * 
 * Catches JavaScript errors in child component tree and displays fallback UI.
 * Use this to prevent crashes from propagating and crashing the entire app.
 * 
 * @example
 * <ErrorBoundary name="3DScene" onError={logToService}>
 *   <ThreeDScene />
 * </ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { name, onError } = this.props;
    
    // Log the error
    logger.error(`Error in ${name || 'component'}:`, error.message);
    logger.debug('Error stack:', error.stack);
    logger.debug('Component stack:', errorInfo.componentStack);
    
    // Update state with error info
    this.setState({ errorInfo });
    
    // Call custom error handler
    if (onError) {
      onError(error, errorInfo);
    }
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  toggleDetails = (): void => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  render(): ReactNode {
    const { hasError, error, errorInfo, showDetails } = this.state;
    const { children, fallback, name, showDetails: alwaysShowDetails } = this.props;

    if (hasError) {
      // Use custom fallback if provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="flex items-center justify-center w-full h-full min-h-[200px] p-4 bg-background">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="w-5 h-5" />
                Something went wrong
              </CardTitle>
              <CardDescription>
                {name ? `An error occurred in the ${name} component.` : 'An unexpected error occurred.'}
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {error?.message || 'Unknown error'}
              </p>
              
              {(alwaysShowDetails || import.meta.env.DEV) && (
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between"
                    onClick={this.toggleDetails}
                  >
                    <span>Technical Details</span>
                    {showDetails ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </Button>
                  
                  {showDetails && (
                    <div className="mt-2 p-2 bg-muted rounded-md overflow-auto max-h-[200px]">
                      <pre className="text-xs font-mono whitespace-pre-wrap">
                        {error?.stack}
                      </pre>
                      {errorInfo?.componentStack && (
                        <pre className="text-xs font-mono whitespace-pre-wrap mt-2 pt-2 border-t">
                          {errorInfo.componentStack}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
            
            <CardFooter>
              <Button onClick={this.handleReset} className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
            </CardFooter>
          </Card>
        </div>
      );
    }

    return children;
  }
}

/**
 * Specialized error boundary for 3D canvas/WebGL errors
 */
export class Canvas3DErrorBoundary extends Component<
  Omit<ErrorBoundaryProps, 'name'>,
  ErrorBoundaryState
> {
  constructor(props: Omit<ErrorBoundaryProps, 'name'>) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error('3D Canvas error:', error.message);
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  render(): ReactNode {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      if (fallback) return fallback;

      return (
        <div className="flex flex-col items-center justify-center w-full h-full bg-muted/50 rounded-lg p-8">
          <AlertTriangle className="w-12 h-12 text-destructive mb-4" />
          <h3 className="text-lg font-semibold mb-2">3D Viewer Error</h3>
          <p className="text-sm text-muted-foreground text-center mb-4 max-w-sm">
            The 3D viewer encountered an error. This may be due to WebGL issues or memory constraints.
          </p>
          {error && (
            <p className="text-xs text-muted-foreground font-mono mb-4 p-2 bg-muted rounded">
              {error.message}
            </p>
          )}
          <div className="flex gap-2">
            <Button onClick={this.handleReset}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Reload Viewer
            </Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Refresh Page
            </Button>
          </div>
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
