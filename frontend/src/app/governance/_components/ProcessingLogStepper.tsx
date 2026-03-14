'use client';

import { CheckOutlined, WarningOutlined } from '@ant-design/icons';
import clsx from 'clsx';

const BASE_STEPS = [
  { key: 'Draft', label: 'Draft', number: 1 },
  { key: 'Submitted', label: 'Submitted', number: 2 },
  { key: 'In Progress', label: 'In Progress', number: 3 },
  { key: 'Completed', label: 'Completed', number: 4 },
];

interface ProcessingLogStepperProps {
  currentStatus: string;
  /** Domain name to display when status is Information Inquiry, e.g. "Diversity by Design" */
  infoInquiryDomain?: string;
}

export function ProcessingLogStepper({ currentStatus, infoInquiryDomain }: ProcessingLogStepperProps) {
  const isInfoInquiry = currentStatus === 'Information Inquiry';

  // When status is Information Inquiry, insert it as a separate step between Submitted and In Progress
  const steps = isInfoInquiry
    ? [
        { key: 'Draft', label: 'Draft', number: 1 },
        { key: 'Submitted', label: 'Submitted', number: 2 },
        { key: 'Information Inquiry', label: infoInquiryDomain ? `Information Inquiry - ${infoInquiryDomain}` : 'Information Inquiry', number: 3 },
        { key: 'In Progress', label: 'In Progress', number: 4 },
        { key: 'Completed', label: 'Completed', number: 5 },
      ]
    : BASE_STEPS;

  // Find current step index
  const currentIdx = steps.findIndex(s => s.key === currentStatus);
  const activeIdx = currentIdx >= 0 ? currentIdx : 0;

  return (
    <div className="flex items-center justify-between w-full py-4" data-testid="processing-log-stepper">
      {steps.map((step, i) => {
        const isCompleted = i < activeIdx;
        const isCurrent = i === activeIdx;
        const isInquiryStep = step.key === 'Information Inquiry';

        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            {/* Step circle + label */}
            <div className="flex flex-col items-center">
              <div
                className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors',
                  isCompleted
                    ? 'bg-green-500 border-green-500 text-white'
                    : isCurrent && isInquiryStep
                      ? 'bg-amber-500 border-amber-500 text-white'
                      : isCurrent
                        ? 'bg-egm-teal border-egm-teal text-white'
                        : 'bg-white border-gray-300 text-gray-400',
                )}
                data-testid={`step-circle-${step.number}`}
              >
                {isCompleted ? (
                  <CheckOutlined style={{ fontSize: 16 }} />
                ) : isCurrent && isInquiryStep ? (
                  <WarningOutlined style={{ fontSize: 16 }} />
                ) : (
                  step.number
                )}
              </div>
              <span
                className={clsx(
                  'mt-1.5 text-xs font-medium whitespace-nowrap',
                  isCompleted
                    ? 'text-green-600'
                    : isCurrent && isInquiryStep
                      ? 'text-amber-600'
                      : isCurrent
                        ? 'text-egm-teal'
                        : 'text-gray-400',
                )}
              >
                {step.label}
              </span>
            </div>

            {/* Connecting line */}
            {i < steps.length - 1 && (
              <div
                className={clsx(
                  'flex-1 h-0.5 mx-3 mt-[-1rem]',
                  i < activeIdx ? 'bg-green-500' : 'bg-gray-200',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
