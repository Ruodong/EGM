'use client';

export default function HelpPage() {
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Help & Documentation</h1>
      <div className="bg-white rounded-lg border border-border-light p-6 space-y-4">
        <div>
          <h2 className="font-semibold mb-2">Governance Request Flow</h2>
          <ol className="list-decimal list-inside text-sm text-text-secondary space-y-1">
            <li>Create a new governance request with project details</li>
            <li>Complete scoping questions to determine applicable domains</li>
            <li>Fill in the common questionnaire with shared project information</li>
            <li>Dispatch reviews to applicable governance domains</li>
            <li>Domain reviewers assess the request within their expertise</li>
            <li>Final verdict is recorded once all domain reviews complete</li>
          </ol>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Domain Reviews</h2>
          <ul className="list-disc list-inside text-sm text-text-secondary space-y-1">
            <li><strong>EA</strong> — Enterprise Architecture (via EAM)</li>
            <li><strong>BIA</strong> — Business Impact Assessment</li>
            <li><strong>RAI</strong> — Responsible AI Review</li>
            <li><strong>DATA_PRIVACY</strong> — Data Privacy & Compliance</li>
          </ul>
        </div>
        <div>
          <h2 className="font-semibold mb-2">Information Supplement Requests</h2>
          <p className="text-sm text-text-secondary">
            During domain review, reviewers can request additional information from the requestor.
            This triggers an ISR that notifies the requestor to update the common questionnaire.
          </p>
        </div>
      </div>
    </div>
  );
}
