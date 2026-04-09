import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  moduleName: string
  children: ReactNode
}

type State = {
  error: Error | null
}

export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.moduleName} module error:`, error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="sonde-panel sonde-panel--error" role="alert">
          <p>{this.props.moduleName} failed to load.</p>
          <p>Try refreshing or check console.</p>
        </div>
      )
    }
    return this.props.children
  }
}
