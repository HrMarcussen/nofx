import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { 
      hasError: false, 
      error: null, 
      errorInfo: null 
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // CRITICAL: Log the ACTUAL error with full details
    console.error('🚨 ERROR BOUNDARY CAUGHT:', {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      error: error,
      errorInfo: errorInfo,
      name: error.name,
      cause: (error as any).cause,
    });
    
    this.setState({
      error,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div style={{ padding: '20px', color: 'red', background: '#1E2329', border: '2px solid red', borderRadius: '8px', margin: '20px' }}>
          <h2>❌ Error Caught by Error Boundary!</h2>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: '10px' }}>
              Click for error details
            </summary>
            <div style={{ background: '#0B0E11', padding: '15px', borderRadius: '4px' }}>
              <p><strong>Error Name:</strong> {this.state.error?.name}</p>
              <p><strong>Error Message:</strong> {this.state.error?.message}</p>
              <p><strong>Error String:</strong> {this.state.error?.toString()}</p>
              <hr style={{ margin: '10px 0' }} />
              <p><strong>Stack Trace:</strong></p>
              <pre style={{ fontSize: '11px', overflow: 'auto' }}>{this.state.error?.stack}</pre>
              <hr style={{ margin: '10px 0' }} />
              <p><strong>Component Stack:</strong></p>
              <pre style={{ fontSize: '11px', overflow: 'auto' }}>{this.state.errorInfo?.componentStack}</pre>
            </div>
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
