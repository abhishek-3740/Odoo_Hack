import React from 'react';

export function LoadingSpinner({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3',
  }[size] || 'w-6 h-6 border-2';

  return (
    <div
      className={`inline-block animate-spin rounded-full border-indigo-600 border-t-transparent ${sizeClasses} ${className}`}
      role="status"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export function LoadingScreen({ message = 'Loading DealFlow360...' }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
      <div className="flex items-center space-x-3 bg-white px-6 py-4 rounded-xl border border-slate-200 shadow-sm">
        <LoadingSpinner size="md" />
        <span className="text-sm font-medium text-slate-700">{message}</span>
      </div>
    </div>
  );
}
