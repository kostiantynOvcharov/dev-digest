# Deprecation policy — deprecate, never silently remove

A public field, route, or parameter must not be deleted outright. Mark it
`@deprecated`, keep it working for at least one major cycle, and remove it only in
a later, announced MAJOR release. A silent removal gives clients no migration path.

A correct deprecation:
- keeps the old surface functional,
- adds an `@deprecated` JSDoc tag (or an API `Deprecation` / `Sunset` header) that
  names the replacement,
- and only then is the removal scheduled.

## Bad

```diff
 interface UserResponse {
-  /** Legacy field. */
-  userId: string;        // deleted with no deprecation, no replacement note
   id: string;
 }
```

## Good

```ts
interface UserResponse {
  /** @deprecated Use `id` instead. Removed in v4.0.0. */
  userId: string; // kept and functional through the deprecation window
  id: string;
}
```

Flag as: **CRITICAL** when a public field/route is removed without a prior
`@deprecated` marker and replacement. **WARNING** when it is deprecated correctly
but the removal timeline/replacement is unstated. Cite the removed diff line.
