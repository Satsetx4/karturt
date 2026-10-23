export type F3UatScenario = {
  id: string;
  actor: string;
  action: string;
  expected: string;
};

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
    id: "cash-transfer-race",
    actor: "Treasurer and Resident",
    action: "Race cash verification against an online transfer request for the same due periods.",
    expected: "Independent PostgreSQL sessions produce one canonical allocation outcome with no duplicate payment or skipped older unpaid period.",
  },
  {
    id: "receipt-and-report-tenant-isolation",
    actor: "Resident, Treasurer, and RT Chairman",
    action: "Read receipts and RT reports while presenting another household or RT identifier.",
    expected: "Receipts and reports stay within the authenticated household or RT scope.",
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

  return [
    "KartuRT V1 F3 UAT plan — offline rehearsal only",
    "This command prints a static scenario list. It does not load database clients, call provider APIs, or start an app server.",
    "Live execution remains disabled until F2 independently verifies an isolated synthetic-only staging target.",
    ...rows,
  ].join("\n");
}
