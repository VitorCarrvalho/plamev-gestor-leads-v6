import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, subtitle, children }) => (
  <div className="bg-surface border-b border-border px-6 py-4 flex items-center justify-between gap-4 flex-wrap flex-shrink-0">
    <div className="flex flex-col min-w-0">
      <h1 className="text-lg font-semibold text-text tracking-tight">{title}</h1>
      {subtitle && <p className="text-sm text-text-muted mt-0.5">{subtitle}</p>}
    </div>
    {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
  </div>
);
