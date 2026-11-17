Hand-made fake reports (NOT real bugs). Written by us on 2026-11-16 to test the real verifier's
not_reproduced path against the default case (42482847). They are labelled hand-made wherever reported.
- hand_made_fake_asan_claim.txt: text that claims an ASan crash but is just prose.
- hand_made_fake_config.ucl: ordinary-looking config with a variable and an .include.
- hand_made_fake_random.bin: 4096 random bytes (seed 1).
- hand_made_fake_deep_nesting.ucl: 3000 nested braces.
- hand_made_fake_near_miss.ucl: `"\"` (3 bytes). It is ARVO 42482847's crashing input `"\` with the string properly closed: a near miss that should NOT crash.
- hand_made_fake_empty.bin: an empty file (0 bytes).
- hand_made_fake_large_config.ucl: 500 ordinary service blocks (valid UCL, 40322 bytes, CRLF line endings).
