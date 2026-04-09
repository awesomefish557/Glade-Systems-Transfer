import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Sonde root error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            padding: '1.5rem',
            fontFamily: 'system-ui, sans-serif',
            background: '#0e0d0c',
            color: '#e8e4dc',
          }}
        >
          <h1 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem' }}>Sonde could not finish loading</h1>
          <p style={{ margin: '0 0 1rem', opacity: 0.9, maxWidth: 520 }}>
            Something threw during startup. Open the browser console for the stack trace. If you just deployed, try a hard refresh
            or clear this site&apos;s service worker (Application → Service Workers → Unregister).
          </p>
          <pre
            style={{
              fontSize: '0.75rem',
              padding: '0.75rem',
              background: '#1a1816',
              border: '1px solid #2a2825',
              overflow: 'auto',
              maxWidth: '100%',
            }}
          >
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
