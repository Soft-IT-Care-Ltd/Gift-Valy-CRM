// RBAC seed data & types — SPEC §2.
// Permissions are granular strings; the per-role sets below are the SEED matrix.
// Admin can edit the matrix per role and grant/revoke per-user overrides at runtime.

export const ROLE_NAMES = [
  "Admin",
  "Manager",
  "TeamLeader",
  "SalesExecutive",
  "Packing",
  "Accounts",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const ROLE_LABELS: Record<RoleName, string> = {
  Admin: "Admin / Owner",
  Manager: "Manager",
  TeamLeader: "Team Leader",
  SalesExecutive: "Sales Executive",
  Packing: "Packing / Operations",
  Accounts: "Accounts",
};

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
}

export const PERMISSION_DEFS: PermissionDef[] = [
  // Leads
  { key: "leads.create", label: "Create leads", group: "Leads" },
  { key: "leads.bulk", label: "Bulk daily lead counts", group: "Leads" },
  { key: "leads.view_own", label: "View own leads", group: "Leads" },
  { key: "leads.view_team", label: "View team leads", group: "Leads" },
  { key: "leads.view_all", label: "View all leads", group: "Leads" },
  { key: "leads.edit", label: "Edit leads", group: "Leads" },
  { key: "leads.reassign", label: "Reassign leads", group: "Leads" },
  // Orders
  { key: "orders.create", label: "Create orders", group: "Orders" },
  { key: "orders.view_own", label: "View own orders", group: "Orders" },
  { key: "orders.view_team", label: "View team orders", group: "Orders" },
  { key: "orders.view_all", label: "View all orders", group: "Orders" },
  { key: "orders.edit", label: "Edit orders", group: "Orders" },
  { key: "orders.approve_edit", label: "Approve order edits", group: "Orders" },
  { key: "orders.cancel", label: "Cancel orders", group: "Orders" },
  { key: "orders.trash", label: "Trash & restore orders", group: "Orders" },
  { key: "orders.pack", label: "Packing queue & mark packed", group: "Orders" },
  { key: "invoice.generate", label: "Generate invoices", group: "Orders" },
  // Money
  { key: "payments.create", label: "Record payments", group: "Money" },
  { key: "payments.verify", label: "Verify payments", group: "Money" },
  { key: "wallets.manage", label: "Manage wallets (company accounts)", group: "Money" },
  { key: "expenses.create", label: "Record expenses", group: "Money" },
  { key: "purchases.create", label: "Purchase entry", group: "Money" },
  // Catalog
  { key: "catalog.view", label: "View catalog (products & packages)", group: "Catalog" },
  { key: "catalog.manage", label: "Manage catalog (categories, products, packages)", group: "Catalog" },
  // Stock
  { key: "stock.view", label: "View stock (read)", group: "Stock" },
  { key: "stock.adjust", label: "Adjust stock", group: "Stock" },
  // Courier
  { key: "courier.manage", label: "Manage courier & shipments", group: "Courier" },
  { key: "courier.approve_return", label: "Approve returns (stock restore)", group: "Courier" },
  // Reports
  { key: "reports.own", label: "Own reports", group: "Reports" },
  { key: "reports.team", label: "Team reports", group: "Reports" },
  { key: "reports.all", label: "All reports", group: "Reports" },
  { key: "reports.pnl", label: "P&L / costing reports", group: "Reports" },
  // Targets
  { key: "targets.view_own", label: "View own target", group: "Targets" },
  { key: "targets.view_team", label: "View team targets", group: "Targets" },
  { key: "targets.manage", label: "Set targets & rewards", group: "Targets" },
  // Attendance
  { key: "attendance.own", label: "Own check-in / check-out", group: "Attendance" },
  { key: "attendance.view_all", label: "View all attendance", group: "Attendance" },
  // Admin
  { key: "users.manage", label: "Manage users & teams", group: "Admin" },
  { key: "settings.manage", label: "Manage settings", group: "Admin" },
  { key: "audit.view", label: "View audit log", group: "Admin" },
  { key: "dashboard.owner", label: "Owner dashboard", group: "Admin" },
];

export const ALL_PERMISSION_KEYS = PERMISSION_DEFS.map((p) => p.key);

// Seed permission matrix per SPEC §2.1 / §2.2.
// Manager: all operational modules + reports; NO user-role editing; P&L only if
// Admin enables it later from the matrix UI (so reports.pnl is NOT seeded).
// SalesExecutive: *.view_own + *.create only — never costs/profit/others' data.
export const ROLE_MATRIX: Record<RoleName, string[]> = {
  Admin: ALL_PERMISSION_KEYS,
  Manager: [
    "leads.create", "leads.bulk", "leads.view_own", "leads.view_team", "leads.view_all",
    "leads.edit", "leads.reassign",
    "orders.create", "orders.view_own", "orders.view_team", "orders.view_all",
    "orders.edit", "orders.approve_edit", "orders.cancel", "orders.trash",
    "orders.pack",
    "invoice.generate",
    "payments.create", "payments.verify", "wallets.manage",
    "expenses.create", "purchases.create",
    "catalog.view", "catalog.manage",
    "stock.view", "stock.adjust",
    "courier.manage", "courier.approve_return",
    "reports.own", "reports.team", "reports.all",
    "targets.view_own", "targets.view_team", "targets.manage",
    "attendance.own", "attendance.view_all",
  ],
  TeamLeader: [
    "leads.create", "leads.bulk", "leads.view_own", "leads.view_team", "leads.edit", "leads.reassign",
    "orders.create", "orders.view_own", "orders.view_team", "orders.approve_edit",
    "invoice.generate",
    "payments.create",
    "catalog.view",
    "reports.own", "reports.team",
    "targets.view_own", "targets.view_team",
    "attendance.own",
  ],
  SalesExecutive: [
    "leads.create", "leads.view_own",
    "orders.create", "orders.view_own",
    "invoice.generate",
    "payments.create",
    "catalog.view",
    "reports.own",
    "targets.view_own",
    "attendance.own",
  ],
  Packing: [
    "orders.pack",
    "catalog.view",
    "stock.view",
    "attendance.own",
  ],
  Accounts: [
    "payments.create", "payments.verify", "wallets.manage",
    "expenses.create", "purchases.create",
    "catalog.view",
    "stock.view",
    "courier.manage",
    "reports.pnl",
    "attendance.own",
  ],
};
