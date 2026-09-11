import type { Role, User } from "@routepulse/shared";

export type DemoCredential = {
  role: Role;
  email: string;
  password: string;
  name: string;
};

/** The public sandbox can be disabled with DEMO_AUTH_ENABLED=false. */
export const demoAuthEnabled = () => process.env.DEMO_AUTH_ENABLED !== "false";

export const demoCredentials: DemoCredential[] = [
  {
    role: "admin",
    email: "chieftainofthedunedain.bgp+routepulse.admin@gmail.com",
    password: "RoutePulseDemo!Admin2026",
    name: "RoutePulse Demo Admin",
  },
  {
    role: "dispatcher",
    email: "chieftainofthedunedain.bgp+routepulse.dispatcher@gmail.com",
    password: "RoutePulseDemo!Dispatch2026",
    name: "RoutePulse Demo Dispatcher",
  },
  {
    role: "driver",
    email: "chieftainofthedunedain.bgp+routepulse.driver@gmail.com",
    password: "RoutePulseDemo!Driver2026",
    name: "RoutePulse Demo Driver",
  },
  {
    role: "customer",
    email: "chieftainofthedunedain.bgp+routepulse.customer@gmail.com",
    password: "RoutePulseDemo!Customer2026",
    name: "RoutePulse Demo Customer",
  },
];

export function demoUserForRole(role: Role, email?: string, name?: string): User {
  const credential = demoCredentials.find((candidate) => candidate.role === role);
  return {
    id: `demo_${role}`,
    organizationId: "org_demo",
    email: email || credential?.email || `demo.${role}@routepulse.demo`,
    name: name || credential?.name || `RoutePulse Demo ${role}`,
    role,
  };
}

export function demoUserFromCredentials(email: string, password: string): User | null {
  const credential = demoCredentials.find(
    (candidate) => candidate.email.toLowerCase() === email.trim().toLowerCase() && candidate.password === password,
  );
  return credential ? demoUserForRole(credential.role, credential.email, credential.name) : null;
}

