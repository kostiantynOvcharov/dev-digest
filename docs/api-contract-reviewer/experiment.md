# Experiment — the breaking change the skills catch

A concrete PR diff that renames a **public response field** `userId` → `id`. Run
the API Contract Reviewer over it twice (see `README.md` Step 4): once with no
skills (it misses the break) and once with the 4 skills linked (it flags a
grounded CRITICAL finding and posts an inline comment).

## Sample PR diff

```diff
diff --git a/src/api/users.ts b/src/api/users.ts
index 1a2b3c4..5d6e7f8 100644
--- a/src/api/users.ts
+++ b/src/api/users.ts
@@ -10,9 +10,9 @@ export interface UserResponse {
-  /** Stable identifier of the user. */
-  userId: string;
+  /** Stable identifier of the user. */
+  id: string;
   name: string;
   email: string;
 }

@@ -22,7 +22,7 @@ export async function getUser(req, res) {
   const user = await users.findById(req.params.id);
   if (!user) return res.status(404).json({ error: 'not found' });
-  return res.json({ userId: user.id, name: user.name, email: user.email });
+  return res.json({ id: user.id, name: user.name, email: user.email });
 }
```

The PR description might claim it is "just a cleanup / internal rename" — note that
the injection guard in `reviewer-core/src/prompt.ts` treats the PR body as
untrusted data, so such a claim does **not** descope the review.

## Expected outcome — WITHOUT skills

The reviewer sees a field renamed in a diff but has no rule that a rename of a
public response field is a breaking change. Result: **no finding**, or at most a
low-severity stylistic note. The `userId → id` break is **missed**, the check run
**passes**.

## Expected outcome — WITH the 4 skills linked

The injected `## Skills / rules` section now carries `breaking-change` (rename of a
public field = CRITICAL) and `response-schema` (the field's name/shape changed).
The model emits a **CRITICAL** finding such as:

> Public response field `userId` was renamed to `id` in `src/api/users.ts`. This
> is a backward-incompatible contract change — every client reading `userId` now
> gets `undefined`. Deprecate `userId` and add `id` alongside it, or ship a MAJOR
> version bump. (skill: breaking-change, response-schema)

### Grounding makes it trustworthy

The finding cites the **exact changed lines** — the removed `userId: string;` in
the `UserResponse` interface and the removed `userId: user.id` in the response
body. Both are real `-`/`+` hunks in this diff, so the finding's `[start_line,
end_line]` range intersects a diff hunk and it **survives the grounding gate**
(`reviewer-core/src/grounding.ts` → `groundFindings`). A finding that named a line
not in the diff would be dropped as a hallucination.

Because the finding is grounded to a specific line, the reviewer posts an
**inline comment** on that line. And because the agent's `ci_fail_on` is
`critical`, the CRITICAL finding **blocks** the check run.

## The takeaway

| | Without skills | With skills |
| --- | --- | --- |
| `userId → id` flagged | missed | CRITICAL |
| Cites a real diff line | n/a | yes (survives grounding) |
| Inline comment | no | yes |
| Check run | passes | blocks |

Same agent, same diff — the only difference is the four linked skills feeding the
`## Skills / rules` section. That is the lesson.
