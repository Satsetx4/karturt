import {
  boolean,
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  date,
  uniqueIndex,
  unique,
  uuid,
  varchar,
  bigint,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accountTypeEnum = pgEnum("account_type", ["resident", "official", "system_admin"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "locked", "disabled"]);
export const officialRoleEnum = pgEnum("official_role", ["treasurer", "rt_chairman"]);
export const householdStatusEnum = pgEnum("household_status", ["active", "inactive"]);
export const billingYearStatusEnum = pgEnum("billing_year_status", ["draft", "open", "closed"]);
export const monthlyDueStatusEnum = pgEnum("monthly_due_status", ["unpaid", "waived"]);
export const monthlyDueWaiverReasonEnum = pgEnum("monthly_due_waiver_reason", ["not_yet_resident"]);

export const rtUnits = pgTable("rt_units", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 40 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  rwCode: varchar("rw_code", { length: 40 }).notNull(),
  village: varchar("village", { length: 120 }).notNull(),
  district: varchar("district", { length: 120 }),
  city: varchar("city", { length: 120 }),
  province: varchar("province", { length: 120 }),
  timezone: varchar("timezone", { length: 80 }).notNull().default("Asia/Jakarta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rt_units_code_rw_uq").on(table.code, table.rwCode, table.village),
]);

export const rtSettings = pgTable("rt_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull().references(() => rtUnits.id, { onDelete: "restrict" }),
  dueDay: smallint("due_day").notNull().default(10),
  currency: varchar("currency", { length: 3 }).notNull().default("IDR"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rt_settings_rt_unit_uq").on(table.rtUnitId),
  check("rt_settings_due_day_ten", sql`${table.dueDay} = 10`),
  check("rt_settings_currency_idr", sql`${table.currency} = 'IDR'`),
]);

export const houses = pgTable("houses", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull().references(() => rtUnits.id, { onDelete: "restrict" }),
  number: varchar("number", { length: 40 }).notNull(),
  label: varchar("label", { length: 120 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("houses_rt_number_uq").on(table.rtUnitId, sql`upper(${table.number})`),
  unique("houses_rt_id_uq").on(table.rtUnitId, table.id),
]);

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull().references(() => rtUnits.id, { onDelete: "restrict" }),
  houseId: uuid("house_id").notNull(),
  status: householdStatusEnum("status").notNull().default("active"),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "households_rt_house_fk",
    columns: [table.rtUnitId, table.houseId],
    foreignColumns: [houses.rtUnitId, houses.id],
  }).onDelete("restrict"),
  unique("households_rt_id_uq").on(table.rtUnitId, table.id),
  uniqueIndex("households_one_active_per_house_uq")
    .on(table.rtUnitId, table.houseId)
    .where(sql`${table.status} = 'active'`),
  check(
    "households_dates_match_status",
    sql`(${table.status} = 'active' and ${table.endsOn} is null) or (${table.status} = 'inactive' and ${table.endsOn} is not null and ${table.endsOn} >= ${table.startsOn})`,
  ),
]);

export const people = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull().references(() => rtUnits.id, { onDelete: "restrict" }),
  householdId: uuid("household_id"),
  fullName: varchar("full_name", { length: 160 }).notNull(),
  phone: varchar("phone", { length: 32 }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "people_rt_household_fk",
    columns: [table.rtUnitId, table.householdId],
    foreignColumns: [households.rtUnitId, households.id],
  }).onDelete("restrict"),
  unique("people_rt_id_uq").on(table.rtUnitId, table.id),
  unique("people_rt_household_id_uq").on(table.rtUnitId, table.householdId, table.id),
  check("people_name_not_blank", sql`length(trim(${table.fullName})) > 0`),
]);

export const authUser = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  twoFactorEnabled: boolean("twoFactorEnabled").notNull().default(false),
});

export const authSession = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => authUser.id, { onDelete: "cascade" }),
});

export const authAccount = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const authVerification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const authTwoFactor = pgTable("twoFactor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backupCodes").notNull(),
  userId: text("userId").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  verified: boolean("verified").notNull().default(false),
  failedVerificationCount: integer("failedVerificationCount").notNull().default(0),
  lockedUntil: timestamp("lockedUntil", { withTimezone: true }),
}, (table) => [uniqueIndex("two_factor_user_uq").on(table.userId)]);

export const authRateLimit = pgTable("rateLimit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("lastRequest", { mode: "number" }).notNull(),
});

export const appAccounts = pgTable("app_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").references(() => rtUnits.id, { onDelete: "restrict" }),
  authUserId: text("auth_user_id").notNull().unique().references(() => authUser.id, { onDelete: "restrict" }),
  accountType: accountTypeEnum("account_type").notNull(),
  status: accountStatusEnum("status").notNull().default("active"),
  loginIdentifier: varchar("login_identifier", { length: 100 }).notNull(),
  personId: uuid("person_id"),
  householdId: uuid("household_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "app_accounts_rt_person_fk",
    columns: [table.rtUnitId, table.personId],
    foreignColumns: [people.rtUnitId, people.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "app_accounts_rt_household_fk",
    columns: [table.rtUnitId, table.householdId],
    foreignColumns: [households.rtUnitId, households.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "app_accounts_resident_person_household_fk",
    columns: [table.rtUnitId, table.householdId, table.personId],
    foreignColumns: [people.rtUnitId, people.householdId, people.id],
  }).onDelete("restrict"),
  unique("app_accounts_rt_id_type_uq").on(table.rtUnitId, table.id, table.accountType),
  uniqueIndex("app_accounts_login_identifier_uq")
    .on(table.rtUnitId, table.accountType, sql`lower(${table.loginIdentifier})`)
    .where(sql`${table.accountType} <> 'system_admin'`),
  uniqueIndex("app_accounts_system_admin_login_uq")
    .on(sql`lower(${table.loginIdentifier})`)
    .where(sql`${table.accountType} = 'system_admin'`),
  uniqueIndex("app_accounts_active_resident_household_uq")
    .on(table.rtUnitId, table.householdId)
    .where(sql`${table.accountType} = 'resident' and ${table.status} = 'active'`),
  check(
    "app_accounts_type_scope_valid",
    sql`(${table.accountType} = 'resident' and ${table.rtUnitId} is not null and ${table.personId} is not null and ${table.householdId} is not null) or (${table.accountType} = 'official' and ${table.rtUnitId} is not null and ${table.personId} is not null and ${table.householdId} is null) or (${table.accountType} = 'system_admin' and ${table.rtUnitId} is null and ${table.personId} is null and ${table.householdId} is null)`,
  ),
]);

export const officialAssignments = pgTable("official_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull().references(() => rtUnits.id, { onDelete: "restrict" }),
  appAccountId: uuid("app_account_id").notNull(),
  appAccountType: accountTypeEnum("app_account_type").notNull().default("official"),
  role: officialRoleEnum("role").notNull(),
  startsOn: date("starts_on", { mode: "string" }).notNull(),
  endsOn: date("ends_on", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "official_assignments_official_account_fk",
    columns: [table.rtUnitId, table.appAccountId, table.appAccountType],
    foreignColumns: [appAccounts.rtUnitId, appAccounts.id, appAccounts.accountType],
  }).onDelete("restrict"),
  uniqueIndex("official_assignments_one_active_role_uq")
    .on(table.rtUnitId, table.role)
    .where(sql`${table.endsOn} is null`),
  uniqueIndex("official_assignments_one_active_role_per_account_uq")
    .on(table.appAccountId)
    .where(sql`${table.endsOn} is null`),
  check("official_assignments_official_type_only", sql`${table.appAccountType} = 'official'`),
  check("official_assignments_dates_valid", sql`${table.endsOn} is null or ${table.endsOn} >= ${table.startsOn}`),
]);

export const billingYears = pgTable("billing_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull().references(() => rtUnits.id, { onDelete: "restrict" }),
  year: smallint("year").notNull(),
  status: billingYearStatusEnum("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("billing_years_rt_year_uq").on(table.rtUnitId, table.year),
  unique("billing_years_rt_id_uq").on(table.rtUnitId, table.id),
  uniqueIndex("billing_years_one_open_per_rt_uq").on(table.rtUnitId).where(sql`${table.status} = 'open'`),
  check("billing_years_year_valid", sql`${table.year} between 2000 and 2200`),
]);

export const feeRates = pgTable("fee_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull(),
  billingYearId: uuid("billing_year_id").notNull(),
  effectiveMonth: smallint("effective_month").notNull(),
  monthlyAmount: integer("monthly_amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "fee_rates_rt_billing_year_fk",
    columns: [table.rtUnitId, table.billingYearId],
    foreignColumns: [billingYears.rtUnitId, billingYears.id],
  }).onDelete("restrict"),
  uniqueIndex("fee_rates_year_month_uq").on(table.billingYearId, table.effectiveMonth),
  unique("fee_rates_year_id_uq").on(table.billingYearId, table.id),
  check("fee_rates_effective_month_valid", sql`${table.effectiveMonth} between 1 and 12`),
  check("fee_rates_positive_amount", sql`${table.monthlyAmount} > 0`),
]);

export const monthlyDues = pgTable("monthly_dues", {
  id: uuid("id").primaryKey().defaultRandom(),
  rtUnitId: uuid("rt_unit_id").notNull(),
  householdId: uuid("household_id").notNull(),
  billingYearId: uuid("billing_year_id").notNull(),
  feeRateId: uuid("fee_rate_id"),
  month: smallint("month").notNull(),
  amount: integer("amount").notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: monthlyDueStatusEnum("status").notNull().default("unpaid"),
  waivedReason: monthlyDueWaiverReasonEnum("waived_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "monthly_dues_rt_household_fk",
    columns: [table.rtUnitId, table.householdId],
    foreignColumns: [households.rtUnitId, households.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "monthly_dues_rt_billing_year_fk",
    columns: [table.rtUnitId, table.billingYearId],
    foreignColumns: [billingYears.rtUnitId, billingYears.id],
  }).onDelete("restrict"),
  foreignKey({
    name: "monthly_dues_year_fee_rate_fk",
    columns: [table.billingYearId, table.feeRateId],
    foreignColumns: [feeRates.billingYearId, feeRates.id],
  }).onDelete("restrict"),
  uniqueIndex("monthly_dues_household_year_month_uq").on(table.householdId, table.billingYearId, table.month),
  check("monthly_dues_month_valid", sql`${table.month} between 1 and 12`),
  check("monthly_dues_due_day_ten", sql`extract(day from ${table.dueDate}) = 10`),
  check(
    "monthly_dues_status_amount_consistent",
    sql`(${table.status} = 'unpaid' and ${table.amount} > 0 and ${table.feeRateId} is not null and ${table.waivedReason} is null) or (${table.status} = 'waived' and ${table.amount} = 0 and ${table.feeRateId} is null and ${table.waivedReason} = 'not_yet_resident')`,
  ),
]);

export const schema = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  twoFactor: authTwoFactor,
  rateLimit: authRateLimit,
  rtUnits,
  rtSettings,
  houses,
  households,
  people,
  appAccounts,
  officialAssignments,
  billingYears,
  feeRates,
  monthlyDues,
};

export type AccountType = (typeof accountTypeEnum.enumValues)[number];
export type OfficialRole = (typeof officialRoleEnum.enumValues)[number];
