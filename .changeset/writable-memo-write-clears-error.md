---
"@solidjs/signals": patch
---

Writing to a writable memo now recovers it after its derivation throws, including when the written value equals its last good value. Readers continue to see the old error until the replacement commits.
