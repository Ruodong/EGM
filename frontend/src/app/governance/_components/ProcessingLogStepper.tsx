'use client';

import { Check } from 'lucide-react';
import clsx from 'clsx';

const STEPS = [
  { label: 'Draft', number: 1 },
  { label: 'Submitted', number: 2 },
  { label: 'In Progress', number: 3 },
  { label: 'Completed', number: 4 },
];

const STATUS_INDEX: Record<string, number> = {
  Draft: 0,
  Submitted: 1,
  'In Progress': 2,
  Completed: 3,
};

interface ProcessingLogStepperProps {
  currentStatus: string;
}

export function ProcessingLogStepper({ currentStatus }: ProcessingLogStepperProps) {
  const currentIdx = STATUS_INDEX[currentStatus] ?? 0;

  return (
    <div className="flex items-center justify-between w-full py-4" data-testid="processing-log-stepper">
      {STEPS.map((step, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;

        return (
          <div key={step.label} className="flex items-center flex-1 last:flex-none">
            {/* Step circle + label */}
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors',
                  isCompleted
                    ? 'bg-green-500 border-green-500 text-white'
                    : isCurrent
                      ? 'bg-egm-teal border-egm-teal text-white'
                      : 'bg-white border-gray-300 text-gray-400',
                )}
                data-testid={`step-circle-${step.number}`}
              >
                {isCompleted ? <Check className="h-4 w-4" /> : step.number}
              </div>
              <span
                className={clsx(
                  'mt-1.5 text-xs font-medium whitespace-nowrap',
                  isCompleted
                    ? 'text-green-600'
                    : isCurrent
                      ? 'text-egm-teal'
                      : 'text-gray-400',
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connecting line */}
            {i < STEPS.length - 1 && (
              <div
                className={clsx(
                  'flex-1 h-0.5 mx-3 mt-[-1rem]',
                  i < currentIdx ? 'bg-green-500' : 'bg-gray-200',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
