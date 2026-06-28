# Response schema — type, optionality, nullability

Changing the **type**, **optionality**, or **nullability** of a public response
field breaks clients that parse it, even when the field name is unchanged.

- Narrowing a type (e.g. `string | number` → `string`) breaks clients sending the
  dropped variant.
- Changing a primitive type (`string` → `number`) breaks every consumer's parser.
- Making a previously-always-present field optional/nullable forces clients to
  handle a case they never had to.
- Adding a **required** request field breaks existing callers that omit it.

## Bad

```diff
 interface UserResponse {
-  id: string;
+  id: number;            // string → number: clients parsing a string now break
-  email: string;
+  email: string | null;  // was always present; now nullable without warning
 }
```

## Good

```ts
// Additive only: new field is optional, existing fields keep their type/shape.
interface UserResponse {
  id: string;
  email: string;
  displayName?: string; // new, optional — old clients ignore it safely
}
```

Flag as: **CRITICAL** when a public response field's type is changed/narrowed, or
a non-null field becomes nullable/optional, or a new required request field is
added. **WARNING** for an additive optional field that is under-documented. Cite
the changed diff line.
