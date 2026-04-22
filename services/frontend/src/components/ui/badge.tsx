import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-indigo-50  text-indigo-700  border-indigo-200',
        secondary:   'bg-slate-100  text-slate-700   border-slate-200',
        outline:     'bg-white      text-slate-600   border-slate-200',
        green:       'bg-emerald-50 text-emerald-700 border-emerald-200',
        red:         'bg-red-50     text-red-700     border-red-200',
        amber:       'bg-amber-50   text-amber-700   border-amber-200',
        blue:        'bg-blue-50    text-blue-700    border-blue-200',
        purple:      'bg-purple-50  text-purple-700  border-purple-200',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
);
Badge.displayName = 'Badge';
