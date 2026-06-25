#!/usr/bin/env node

// The route catalog is seeded through the canonical RBAC seed because page
// routes, sidebar visibility, modules, and permissions must stay in sync.
require("./seed-rbac");
