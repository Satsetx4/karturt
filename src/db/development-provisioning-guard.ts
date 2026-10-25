export function assertDevelopmentProvisioningEnvironment(environment: {
  appEnv: string;
  databaseEnv: string;
}) {
  if (environment.appEnv !== "development" || environment.databaseEnv !== "development") {
    throw new Error("This development-only setup script cannot run against staging or production.");
  }
}
