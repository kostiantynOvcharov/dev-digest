# Breaking change — removed or renamed public surface

Removing or renaming a **public** HTTP route, method, or response field breaks
every existing client. Treat it as a backward-incompatible change. Renaming is
*remove + add* — the old name is gone, so it is still a break, not a rename.

Only applies to the **public** API surface (routes a client calls, fields a client
reads). Internal helpers, private types, and tests are out of scope.

## Bad

```diff
-  return { userId: user.id, name: user.name };
+  return { id: user.id, name: user.name };   // clients reading `userId` now get undefined
```

```diff
-  app.get('/api/users/:id', getUser);
+  app.get('/api/v2/members/:id', getMember); // old route 404s for every existing caller
```

## Good

```ts
// Keep the old field/route alongside the new one; deprecate, don't delete.
return { userId: user.id, id: user.id, name: user.name }; // both, for one major cycle
```

Flag as: **CRITICAL** when a public route or response field is removed or renamed
without a backward-compatible alias. Cite the exact removed (`-`) diff line.
