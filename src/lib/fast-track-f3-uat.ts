export type F3UatScenario = {
  id: string;
  actor: string;
  action: string;
  expected: string;
};

export const F3_UAT_EVIDENCE_FIELDS = [
  { id: "candidate-sha", label: "Candidate commit SHA", value: "<full 40-character Git SHA>" },
  {
    id: "deployment-target-identity",
    label: "Deployment / staging target identity",
    value: "<Vercel Preview deployment ID and environment; Neon project ID, root branch ID, and endpoint ID>",
  },
  { id: "observed-at", label: "Observation time", value: "<ISO 8601 timestamp with timezone>" },
  { id: "verified-by", label: "Verifier", value: "<authorized verifier role or non-personal reviewer ID>" },
  {
    id: "scenario-results",
    label: "Scenario results",
    value: "<PASS, FAIL, or NOT RUN per scenario, with a sanitized evidence reference>",
  },
] as const;

export const F3_UAT_SCENARIOS: readonly F3UatScenario[] = [
  {
    id: "annual-period-status",
    actor: "Resident",
    action: "Review all twelve annual billing cards.",
    expected: "Future unpaid periods remain not due and do not appear as arrears.",
  },
  {
    id: "online-current-and-overdue",
    actor: "Resident",
    action: "Request online payment for current and overdue periods.",
    expected: "Only current and overdue periods can be requested.",
  },
  {
    id: "online-future-period-denied",
    actor: "Resident",
    action: "Attempt an online payment request for a future period.",
    expected: "The request is denied without payment, claim, or due-status changes.",
  },
  {
    id: "resident-household-scope",
    actor: "Resident",
    action: "Open annual cards, receipts, and payment history.",
    expected: "Only the resident's own household is visible; other-household and other-RT reads are denied.",
  },
  {
    id: "treasurer-future-cash",
    actor: "Treasurer",
    action: "Record and verify cash collected for a future period.",
    expected: "The future cash payment is accepted only through the treasurer verification flow.",
  },
  {
    id: "cash-oldest-first-through-target",
    actor: "Treasurer",
    action: "Record cash through a selected future target period.",
    expected: "Oldest unpaid periods through the target are allocated first; paid, waived, and not-due periods are skipped; later periods are untouched.",
  },
  {
    id: "payment-request-role-and-rt-boundary",
    actor: "Treasurer, Resident, RT Chairman, and System Admin",
    action: "Verify a resident online payment request from active, inactive, and cross-RT accounts.",
    expected: "Only an active treasurer assigned to the same RT can verify the request.",
  },
  {
    id: "receipt-active-allocation",
    actor: "Resident and Treasurer",
    action: "Review a paid month card after cash and online payment verification.",
    expected: "The receipt shows the canonical allocated amount, payment method, and Jakarta verification time; reversed allocations are excluded.",
  },
  {
    id: "payment-retry-idempotency",
    actor: "Treasurer",
    action: "Retry the same cash submission and reuse its idempotency key with a different payload.",
    expected: "An identical retry returns the original result; a changed payload conflicts without creating a second payment.",
  },
  {
    id: "payment-request-cancellation",
    actor: "Resident",
    action: "Cancel the resident's own pending online transfer request, then attempt cancellation using another household or RT request identity.",
    expected: "Only the active resident who owns the request can cancel it; cancellation releases its claims, leaves dues unpaid, creates no payment or allocation, and records one audit event. A foreign request is denied without disclosure or mutation.",
  },
  {
    id: "payment-reversal-and-repayment",
    actor: "Treasurer and Resident",
    action: "Reverse an active verified cash or transfer payment, review the due and receipt, then repay with a fresh idempotency key; also retry reversal and attempt it as a resident or another RT's treasurer.",
    expected: "Only an active treasurer assigned to the same RT can reverse; a pending request blocks reversal. A successful reversal preserves payment history, releases its active settlements, and removes its active receipt; each affected due returns to unpaid when the reversal leaves an outstanding balance. A second reversal is rejected. A replacement payment uses a fresh key and creates one active receipt; unauthorized attempts do not mutate state.",
  },
  {
    id: "cash-transfer-race",
    actor: "Treasurer and Resident",
    action: "Race treasurer cash recording against resident online transfer-request creation for the same due period.",
    expected: "If cash wins, the due is paid with one cash payment and no request claim; if request creation wins, the due stays unpaid with one pending claim and no cash payment. The losing operation is rejected.",
  },
  {
    id: "receipt-and-report-tenant-isolation",
    actor: "Resident, Treasurer, and RT Chairman",
    action: "Read receipts and RT reports while presenting another household or RT identifier.",
    expected: "Receipts and reports stay within the authenticated household or RT scope.",
  },
  {
    id: "mobile-viewport-smoke",
    actor: "Resident and Treasurer",
    action: "At 360×800, 390×844, and 420×900 CSS-pixel viewports, inspect annual cards, online requests, treasurer cash recording, and receipts using touch input.",
    expected: "No horizontal overflow or obscured controls; period status and receipt details remain readable; primary controls are reachable and have at least 44×44 CSS-pixel touch targets.",
  },
] as const;

export type F3UatEnvironment = Readonly<Record<string, string | undefined>>;

type F3UatBlocker = {
  kind: "blocked";
  code:
    | "F3_PRODUCTION_TARGET_FORBIDDEN"
    | "F3_STAGING_PREVIEW_LABELS_REQUIRED"
    | "F3_STAGING_TARGET_IDENTITY_INCOMPLETE"
    | "F3_STAGING_TARGET_NOT_VERIFIED";
  message: string;
};

export type F3UatCommandResult =
  | { kind: "plan"; scenarios: typeof F3_UAT_SCENARIOS }
  | F3UatBlocker
  | { kind: "usage"; code: "F3_USAGE"; message: string };

function normalized(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getLiveExecutionBlocker(environment: F3UatEnvironment): F3UatBlocker {
  const appEnvironment = normalized(environment.APP_ENV);
  const databaseEnvironment = normalized(environment.DATABASE_ENV);
  const vercelEnvironment = normalized(environment.VERCEL_ENV);

  if ([appEnvironment, databaseEnvironment, vercelEnvironment].includes("production")) {
    return {
      kind: "blocked",
      code: "F3_PRODUCTION_TARGET_FORBIDDEN",
      message: "Production-shaped targets are forbidden for the Fast Track F3 runner.",
    };
  }

  if (appEnvironment !== "staging" || databaseEnvironment !== "staging" || vercelEnvironment !== "preview") {
    return {
      kind: "blocked",
      code: "F3_STAGING_PREVIEW_LABELS_REQUIRED",
      message: "Live F3 requires APP_ENV=staging, DATABASE_ENV=staging, and VERCEL_ENV=preview.",
    };
  }

  const targetIdentifiers = [
    environment.F3_STAGING_PROJECT_ID,
    environment.F3_STAGING_ROOT_BRANCH_ID,
    environment.F3_STAGING_ENDPOINT_ID,
  ];
  if (targetIdentifiers.some((identifier) => !identifier?.trim())) {
    return {
      kind: "blocked",
      code: "F3_STAGING_TARGET_IDENTITY_INCOMPLETE",
      message: "Live F3 requires project, root-branch, and endpoint identifiers for the approved staging target.",
    };
  }

  return {
    kind: "blocked",
    code: "F3_STAGING_TARGET_NOT_VERIFIED",
    message: "No F2-approved synthetic-only staging target is allowlisted; live F3 remains disabled.",
  };
}

export function resolveF3UatCommand(args: readonly string[], environment: F3UatEnvironment): F3UatCommandResult {
  if (args.length === 1 && args[0] === "--plan-only") {
    return { kind: "plan", scenarios: F3_UAT_SCENARIOS };
  }

  if (args.length === 1 && args[0] === "--execute") {
    return getLiveExecutionBlocker(environment);
  }

  return {
    kind: "usage",
    code: "F3_USAGE",
    message: "Use --plan-only. Live execution is disabled until F2 proves and approves an isolated synthetic staging target.",
  };
}

export function renderF3UatPlan(scenarios: readonly F3UatScenario[] = F3_UAT_SCENARIOS) {
  const rows = scenarios.map((scenario, index) =>
    `${index + 1}. [${scenario.id}] ${scenario.actor}: ${scenario.action} Expected: ${scenario.expected}`,
  );
  const evidenceFields = F3_UAT_EVIDENCE_FIELDS.map(({ id, label, value }) => `- ${label} (${id}): ${value}`);

  return [
    "KartuRT V1 F3 UAT plan — offline rehearsal only",
    "This command prints a static scenario list. It does not load database clients, call provider APIs, or start an app server.",
    "Live execution remains disabled until F2 independently verifies an isolated synthetic-only staging target.",
    ...rows,
    "",
    "Sanitized evidence fields — fill only during separately authorized staging UAT:",
    ...evidenceFields,
    "Record evidence without secrets, connection strings, resident personal data, or raw database catalog contents.",
  ].join("\n");
}
