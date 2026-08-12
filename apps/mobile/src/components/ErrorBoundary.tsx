import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, Pressable } from 'react-native';
import { AlertTriangle, RefreshCw } from 'lucide-react-native';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error);
    console.error('Error info:', errorInfo.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View className="flex-1 bg-slate-900 items-center justify-center px-6">
          <View className="bg-slate-800 rounded-2xl p-8 items-center max-w-sm w-full">
            <View className="bg-red-500/20 rounded-full p-4 mb-4">
              <AlertTriangle size={40} color="#EF4444" strokeWidth={2} />
            </View>

            <Text className="text-white text-xl font-semibold text-center mb-2">
              Something went wrong
            </Text>

            <Text className="text-slate-400 text-center text-sm mb-6">
              We encountered an unexpected error. Please try again.
            </Text>

            {__DEV__ && this.state.error && (
              <View className="bg-slate-900 rounded-lg p-3 mb-6 w-full">
                <Text className="text-red-400 text-xs font-mono" numberOfLines={4}>
                  {this.state.error.message}
                </Text>
              </View>
            )}

            <Pressable
              onPress={this.handleReset}
              className="bg-amber-500 rounded-xl py-3 px-6 flex-row items-center active:bg-amber-600"
            >
              <RefreshCw size={18} color="#0F172A" strokeWidth={2} />
              <Text className="text-slate-900 font-semibold text-base ml-2">
                Try Again
              </Text>
            </Pressable>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}
