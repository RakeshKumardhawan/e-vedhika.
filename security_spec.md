# Security Specification - E-Vedhika Portal

## 1. Data Invariants
- A post must have a valid `uid` matching the author.
- Comments must have a valid user identity.
- User profiles can only be modified by the owner.
- Identity fields (`uid`) are immutable.

## 2. Dirty Dozen Payloads (Target: DENY)

1. **Identity Spoofing (Post)**: Create a post with someone else's `uid`.
2. **Identity Spoofing (Chat)**: Send a chat message as another user.
3. **Privilege Escalation**: Update another user's profile.
4. **Invalid Type (Likes)**: Set `likes` to a string instead of a number.
5. **Shadow Field**: Add `isVerified: true` to a post object.
6. **Mass Update**: Update `content` of a post I don't own.
7. **Bypass Relational Gate**: Create a post without a title.
8. **Resource Poisoning**: Create a document with a 1MB string in the ID.
9. **PII Leak**: Attempt to list all users if not owner? (Actually profiles are public, but we limit PII).
10. **State Skipping**: Manually setting `views` to 1,000,000 in a batch.
11. **Negative Increment**: Decrementing likes (if not allowed).
12. **Anonymous Write**: Attempt to create a post without being signed in.

## 3. Test Runner Scenarios

The `firestore.rules.test.ts` (conceptual) would check:
- `create` on `/posts/` fails if `request.auth.uid != request.resource.data.uid`.
- `update` on `/users/uid` fails if `request.auth.uid != userId`.
- `write` on `/problems/` fails if `!isSignedIn()`.
